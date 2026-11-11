//
// This content script must be run prior to domReady so that we perform some operations very early.
//

let isEnabledForUrl = false;
let normalMode = null;
let pendingEnabledCheck = null;
let enabledCheckRevision = 0;

// This is set by initializeFrame. We can only get this frame's ID from the background page.
globalThis.frameId = null;

// We track whther the current window has the focus or not.
let windowHasFocus = null;
function windowIsFocused() {
  return windowHasFocus;
}

function initWindowIsFocused() {
  DomUtils.documentReady().then(() => windowHasFocus = document.hasFocus());
  globalThis.addEventListener(
    "focus",
    forTrusted(function (event) {
      if (event.target === window) {
        windowHasFocus = true;
      }
      return true;
    }),
    true,
  );
  globalThis.addEventListener(
    "blur",
    forTrusted(function (event) {
      if (event.target === window) {
        windowHasFocus = false;
      }
      return true;
    }),
    true,
  );
}

// True if this window should be focusable (e.g. when returning focus from a UI component).
function isWindowFocusable() {
  // Avoid focusing tiny frames. See #1317.
  return !DomUtils.windowIsTooSmall() && (document.body?.tagName.toLowerCase() != "frameset");
}

// If an input grabs the focus before the user has interacted with the page, then grab it back (if
// the grabBackFocus option is set).
class GrabBackFocus extends Mode {
  constructor() {
    super();
    let listener;
    const exitEventHandler = () => {
      return this.alwaysContinueBubbling(() => {
        this.exit();
        chrome.runtime.sendMessage({
          handler: "sendMessageToFrames",
          message: { handler: "userIsInteractingWithThePage" },
        });
      });
    };

    super.init({
      name: "grab-back-focus",
      keydown: exitEventHandler,
    });

    // True after we've grabbed back focus to the page and logged it via console.log , so web devs
    // using Brovim don't get confused.
    this.logged = false;

    this.push({
      _name: "grab-back-focus-mousedown",
      mousedown: exitEventHandler,
    });

    if (this.modeIsActive) {
      if (Settings.get("grabBackFocus")) {
        this.push({
          _name: "grab-back-focus-focus",
          focus: (event) => this.grabBackFocus(event.target),
        });
        // An input may already be focused. If so, grab back the focus.
        if (document.activeElement) {
          this.grabBackFocus(document.activeElement);
        }
      } else {
        this.exit();
      }
    }

    // This mode is active in all frames. A user might have begun interacting with one frame without
    // other frames detecting this. When one GrabBackFocus mode exits, we broadcast a message to
    // inform all GrabBackFocus modes that they should exit; see #2296.
    chrome.runtime.onMessage.addListener(
      listener = ({ name }) => {
        if (name === "userIsInteractingWithThePage") {
          chrome.runtime.onMessage.removeListener(listener);
          if (this.modeIsActive) {
            this.exit();
          }
        }
        // We will not be calling sendResponse.
        return false;
      },
    );
  }

  grabBackFocus(element) {
    if (!DomUtils.isFocusable(element)) {
      return this.continueBubbling;
    }

    if (!this.logged && (element !== document.body)) {
      this.logged = true;
      if (!globalThis.vimiumDomTestsAreRunning) {
        console.log("An auto-focusing action on this page was blocked by Brovim.");
      }
    }
    // A page may refocus an editor synchronously from its blur handler.
    DomUtils.focusPage();
    return this.suppressEvent;
  }
}

// Pages can load new content dynamically and change the displayed URL using history.pushState.
// Since this can often be indistinguishable from an actual new page load for the user, we should
// also re-start GrabBackFocus for these as well. This fixes issue #1622.
handlerStack.push({
  _name: "GrabBackFocus-pushState-monitor",
  click(event) {
    // If a focusable element is focused, the user must have clicked on it. Retain focus and bail.
    if (DomUtils.isFocusable(document.activeElement)) {
      return true;
    }

    let target = event.target;

    while (target) {
      // Often, a link which triggers a content load and url change with javascript will also have
      // the new url as it's href attribute.
      if (
        (target.tagName === "A") &&
        (target.origin === document.location.origin) &&
        // Clicking the link will change the url of this frame.
        ((target.pathName !== document.location.pathName) ||
          (target.search !== document.location.search)) &&
        (["", "_self"].includes(target.target) ||
          ((target.target === "_parent") && (globalThis.parent === window)) ||
          ((target.target === "_top") && (globalThis.top === window)))
      ) {
        return new GrabBackFocus();
      } else {
        target = target.parentElement;
      }
    }
    return true;
  },
});

function installModes() {
  // Install the permanent modes. The permanently-installed insert mode tracks focus/blur events,
  // and activates/deactivates itself accordingly.
  normalMode = new NormalMode();
  normalMode.init();
  // Initialize components upon which normal mode depends.
  Scroller.init();
  FindModeHistory.init();
  new InsertMode({ permanent: true });
  if (isEnabledForUrl) {
    new GrabBackFocus();
  }
  // Return the normalMode object (for the tests).
  return normalMode;
}

// document is null in our tests.
let previousUrl = globalThis.document?.location.href;

// When we're informed by the background page that a URL in this tab has changed, we check if we
// have the correct enabled state (but only if this frame has the focus).
const checkEnabledAfterURLChange = forTrusted(function (_request) {
  // The background page can't tell if the URL has actually changed after a client-side
  // history.pushState call. To limit log spam, ignore spurious URL change events where the URL
  // didn't actually change.
  if (previousUrl == document.location.href) {
    return;
  } else {
    previousUrl = document.location.href;
  }
  // The URL changing feels like navigation to the user, so reset the scroller (see #3119).
  Scroller.reset();
  // A single-page app showed a new page: its switcher preview is due once it has settled.
  TabPreview.start("route");
  if (windowIsFocused()) {
    checkIfEnabledForUrl();
  }
});

// If our extension gets uninstalled, reloaded, or updated, the content scripts for the old version
// become orphaned: they remain running but cannot communicate with the background page or invoke
// most extension APIs. There is no Chrome API to be notified of this event, so we test for it every
// time a keystroke is pressed before we act on that keystroke. https://stackoverflow.com/a/64407849
const extensionHasBeenUnloaded = () => chrome.runtime?.id == null;

// Wrapper to install event listeners.  Syntactic sugar.
function installListener(element, event, callback) {
  element.addEventListener(
    event,
    forTrusted(function () {
      if (extensionHasBeenUnloaded()) {
        console.log("Brovim extension has been unloaded. Unloading content script.");
        onUnload();
        return;
      }
      if (isEnabledForUrl) {
        return callback.apply(this, arguments);
      } else {
        return true;
      }
    }),
    true,
  );
}

// Installing or uninstalling listeners is error prone. Instead we elect to check isEnabledForUrl
// each time so we know whether the listener should run or not.
// Note: We install the listeners even if Brovim is disabled. See comment in commit
// 6446cf04c7b44c3d419dc450a73b60bcaf5cdf02.
const installListeners = Utils.makeIdempotent(function () {
  // Key event handlers fire on window before they do on document. Prefer window for key events so
  // the page can't set handlers to grab the keys before us.
  const events = ["keydown", "keypress", "keyup", "click", "focus", "blur", "mousedown", "scroll"];
  for (const type of events) {
    installListener(globalThis, type, (event) => handlerStack.bubbleEvent(type, event));
  }
  installListener(
    document,
    "DOMActivate",
    (event) => handlerStack.bubbleEvent("DOMActivate", event),
  );
});

// Whenever we get the focus, check if we should be enabled.
const onFocus = forTrusted(function (event) {
  if (event.target === window) {
    checkIfEnabledForUrl();
  }
});

// We install these listeners directly (that is, we don't use installListener) because we still need
// to receive events when Brovim is not enabled.
globalThis.addEventListener("focus", onFocus, true);
globalThis.addEventListener("hashchange", checkEnabledAfterURLChange, true);

const onUnload = Utils.makeIdempotent(() => {
  HintCoordinator.exit({ isSuccess: false });
  handlerStack.reset();
  isEnabledForUrl = false;
  globalThis.removeEventListener("focus", onFocus, true);
  globalThis.removeEventListener("hashchange", checkEnabledAfterURLChange, true);
});

function setScrollPosition({ scrollX, scrollY }) {
  DomUtils.documentReady().then(() => {
    if (!DomUtils.isTopFrame()) return;
    Utils.nextTick(function () {
      globalThis.focus();
      document.body.focus();
      if ((scrollX > 0) || (scrollY > 0)) {
        globalThis.scrollTo(scrollX, scrollY);
      }
    });
  });
}

const flashFrame = (() => {
  let highlightedFrameElement = null;
  return () => {
    if (highlightedFrameElement == null) {
      highlightedFrameElement = DomUtils.createElement("div");

      // Create a shadow DOM wrapping the frame so the page's styles don't interfere with ours.
      const shadowDOM = highlightedFrameElement.attachShadow({ mode: "open" });

      // Inject stylesheet.
      const styleEl = DomUtils.createElement("style");
      const vimiumCssUrl = chrome.runtime.getURL("content_scripts/vimium.css");
      styleEl.textContent = `@import url("${vimiumCssUrl}");`;
      shadowDOM.appendChild(styleEl);

      const frameEl = DomUtils.createElement("div");
      frameEl.className = "vimium-reset vimium-highlighted-frame";
      shadowDOM.appendChild(frameEl);
    }

    document.documentElement.appendChild(highlightedFrameElement);
    Utils.setTimeout(200, () => highlightedFrameElement.remove());
  };
})();

//
// Called from the backend in order to change frame focus.
//
function focusThisFrame(request) {
  // It should never be the case that we get a forceFocusThisFrame request on a window that isn't
  // focusable, because the background script checks that the window is focusable before sending the
  // focusFrame message.
  if (!request.forceFocusThisFrame && !isWindowFocusable()) return;

  Utils.nextTick(function () {
    // A previous dialog's delayed focus restoration must not dismiss a newly opened one.
    const focusedUi = document.activeElement?.shadowRoot?.activeElement;
    if (request.restoreFocus && focusedUi?.matches("iframe.vimium-ui-component-visible")) return;
    globalThis.focus();
    // On Firefox, window.focus doesn't always draw focus back from a child frame (bug 554039). We
    // blur the active element if it is an iframe, which gives the window back focus as intended.
    if (document.activeElement.tagName.toLowerCase() === "iframe") {
      document.activeElement.blur();
    }
    if (request.highlight) {
      flashFrame();
    }
  });
}

// Used by the focusInput command.
globalThis.lastFocusedInput = (function () {
  // Track the most recently focused input element.
  let recentlyFocusedElement = null;
  globalThis.addEventListener(
    "focus",
    forTrusted(function (event) {
      if (DomUtils.isEditable(event.target)) {
        recentlyFocusedElement = event.target;
      }
    }),
    true,
  );
  return () => recentlyFocusedElement;
})();

// Chromium clears an embedded page's focused element when a frame of another site, such as the
// tab switcher's, takes the focus. Each frame remembers the element it lost that way, and takes it
// back when the top frame's UIComponent closes and says so (restoreFrameFocus).
const FrameFocus = {
  blurred: null, // The element that last lost the focus,
  blurredAt: 0, // and when.
  taken: null, // The element that had the focus when this frame last lost it.
  restoreUntil: 0,

  init() {
    globalThis.addEventListener(
      "blur",
      forTrusted((event) => {
        if (event.target !== window) {
          this.blurred = event.target;
          this.blurredAt = performance.now();
        } else {
          // The element loses the focus first, in the same moment.
          this.taken = performance.now() - this.blurredAt < 100 ? this.blurred : null;
        }
      }),
      true,
    );
    globalThis.addEventListener(
      "focus",
      forTrusted((event) => {
        if (event.target === window && performance.now() < this.restoreUntil) this.restore();
      }),
      true,
    );
  },

  restore() {
    this.restoreUntil = 0;
    const nothingFocused = (document.activeElement ?? document.body) === document.body;
    if (nothingFocused && this.taken?.isConnected) this.taken.focus({ preventScroll: true });
  },
};

const messageHandlers = {
  restoreFrameFocus() {
    if (DomUtils.isTopFrame()) return;
    // The frame's focus and this message arrive in either order.
    if (document.hasFocus()) FrameFocus.restore();
    else FrameFocus.restoreUntil = performance.now() + 500;
  },
  openBrowserPages(request) {
    // Browser chrome (e.g. the address bar) cannot reliably hand focus to an embedded input.
    if (!document.hasFocus() || !DomUtils.canHostExtensionFrames()) return false;
    Vomnibar.activateBrowserPages(request.targetTabId);
    return true;
  },
  async recoverPageFocus() {
    HintCoordinator.exit({ isSuccess: false });
    const visibleUi = [
      HelpDialog.helpUI,
      Vomnibar.vomnibarUI,
      Vomnibar.browserPagesUI,
      TabSwitcher.tabSwitcherUI,
    ]
      .filter((ui) => ui?.showing);
    TabSwitcher.cancel(TabSwitcher.currentRequestId);
    await Promise.all(visibleUi.map((ui) => ui.hide(false)));
    for (const mode of Mode.modes.slice().reverse()) {
      if (mode !== normalMode && mode !== InsertMode.permanentInstance) mode.exit();
    }
    DomUtils.focusPage();
    normalMode?.reset();
    Scroller.reset();
    HUD.hide(true, false);
    return true;
  },
  focusFrame(request) {
    focusThisFrame(request);
  },
  getScrollPosition(_ignoredA, _ignoredB) {
    if (DomUtils.isTopFrame()) {
      return { scrollX: globalThis.scrollX, scrollY: globalThis.scrollY };
    }
  },
  setScrollPosition,
  checkEnabledAfterURLChange,
  async refreshEnabledState() {
    await checkIfEnabledForUrl();
    if (!isEnabledForUrl) {
      HintCoordinator.exit({ isSuccess: false });
      HelpDialog.abort();
      Vomnibar.vomnibarUI?.hide(false);
      TabSwitcher.cancel(TabSwitcher.currentRequestId);
    }
  },
  async openTabSwitcher({ requestId, ...options }) {
    // The page can't show the grid: the background switches tabs, and the next tab shows it.
    if (document.fullscreenElement && document.fullscreenElement !== document.documentElement) {
      return { opened: false };
    }
    // No grid on a sandboxed page: the background switches tabs directly instead.
    if (!DomUtils.canHostExtensionFrames()) return { opened: false };
    try {
      const result = await Promise.race([
        TabSwitcher.activateFromBrowserShortcut(requestId, options),
        // The grid's frame hasn't started. The background switches directly until it does.
        Utils.eventLoopTime(800).then(() => null),
      ]);
      if (!result) {
        TabSwitcher.suspend(requestId);
        // Long past a tap: if the shortcut is still held, the next tab shows the grid at once.
        return {
          opened: false,
          held: TabSwitcher.seesShortcutKeys() && TabSwitcher.modifierHeld(),
        };
      }
      if (result.cancelled) return result;
      if (!result.opened || TabSwitcher.currentRequestId !== requestId) return { opened: false };
      if (result.quickSwitch) return { opened: true };
      const ui = TabSwitcher.tabSwitcherUI;
      const rect = ui.iframeElement.getBoundingClientRect();
      const host = ui.shadowDOM.host;
      const outsideFullscreen = document.fullscreenElement &&
        !document.fullscreenElement.contains(host);
      if (
        !ui.iframeElement.isConnected || outsideFullscreen ||
        (ui.showing && (rect.width === 0 || rect.height === 0))
      ) {
        TabSwitcher.abort(requestId);
        return { opened: false };
      }
      return { opened: true };
    } catch {
      TabSwitcher.abort(requestId);
      return { opened: false };
    }
  },
  cancelTabSwitcher({ requestId }) {
    TabSwitcher.cancel(requestId);
  },
  // The tab that a gesture left couldn't show the grid, so the background switched here.
  // - handoff: show the grid here while the shortcut is held: "held" if the tab that was left saw
  //   it held past the tap window, "unknown" if it couldn't tell. Absent if no page can tell a
  //   hold from a tap: the next press shows the grid.
  rememberTabSwitcherCycle({ cycle, shortcut, handoff }) {
    TabSwitcher.rememberCycle(cycle, shortcut);
    if (!handoff || !DomUtils.isTopFrame() || TabSwitcher.cycle?.id !== cycle.id) return;
    // A tap's release reaches this page within the usual tap window: the switch is all it wanted.
    messageHandlers.openTabSwitcher({
      requestId: crypto.randomUUID(),
      shortcut,
      cycle,
      showDelay: handoff === "held" ? 0 : TabSwitcher.showDelayMs,
    });
  },
  // Whether this page shows the switcher's grid itself, and wakes the background as the
  // shortcut's modifier goes down. See checkFrontTab in the background.
  showsTabSwitcher() {
    return DomUtils.isTopFrame() && TabSwitcher.painted && DomUtils.canHostExtensionFrames() &&
      document.contentType !== "application/pdf";
  },
  // From an embedded page of this tab: see TabSwitcher.reportKeyboardEvent.
  tabSwitcherKey({ event }) {
    if (DomUtils.isTopFrame()) TabSwitcher.recordKeyboardEvent(event, true);
  },
  // The tab became active. Also tells the background that this page captures its own preview.
  startTabPreview() {
    TabPreview.start("visible");
  },
  canCaptureTabPreview({ url }) {
    return { allowed: location.href === url && !document.hidden && !isBrovimUiVisible() };
  },
  runInTopFrame({ sourceFrameId, registryEntry }) {
    // TODO: it seems to me that we should be able to get rid of this runInTopFrame
    // command, and instead use chrome.tabs.sendMessage with a frameId 0 from the background page.
    if (DomUtils.isTopFrame()) {
      return NormalModeCommands[registryEntry.command](sourceFrameId, registryEntry);
    }
  },
  linkHintsMessage(request, sender) {
    if (HintCoordinator.willHandleMessage(request.messageType)) {
      return HintCoordinator[request.messageType](request, sender);
    }
  },
  showMessage(request) {
    HUD.show(request.message, 2000);
  },
};

async function handleMessage(request, sender) {
  // Some requests are so frequent and noisy (like checkEnabledAfterURLChange on
  // docs.google.com) that we silence debug logging for just those requests so the rest remain
  // useful.
  if (!request.silenceLogging) {
    Utils.debugLog(
      "frontend.js: onMessage:%otype:%o",
      request.handler,
      request.messageType,
      // request // Often useful for debugging.
    );
  }
  request.isTrusted = true;
  // Some request are handled elsewhere in the code base; ignore them here.
  const shouldHandleMessage = request.handler !== "userIsInteractingWithThePage" &&
    (isEnabledForUrl ||
      [
        "checkEnabledAfterURLChange",
        "refreshEnabledState",
        "recoverPageFocus",
        "openBrowserPages",
        "runInTopFrame",
        "openTabSwitcher",
        "cancelTabSwitcher",
        "rememberTabSwitcherCycle",
        "tabSwitcherKey",
        "showsTabSwitcher",
        "restoreFrameFocus",
        "startTabPreview",
        "canCaptureTabPreview",
      ].includes(request.handler));
  if (shouldHandleMessage) {
    const result = await messageHandlers[request.handler](request, sender);
    return result;
  }
}

//
// Complete initialization work that should be done prior to DOMReady.
//
async function initializePreDomReady() {
  // Run this as early as possible, so the page can't register any event handlers before us.
  installListeners();
  // NOTE: I'm blocking further Brovim initialization on this, for simplicity. If necessary
  // we could allow other tasks to run concurrently.
  await checkIfEnabledForUrl();
  if (extensionHasBeenUnloaded()) return onUnload();

  Utils.addChromeRuntimeOnMessageListener(
    Object.keys(messageHandlers),
    handleMessage,
  );
}

// Check if Brovim should be enabled or not based on the top frame's URL.
function checkIfEnabledForUrl() {
  // Coalesce simultaneous checks, retaining any focus/navigation invalidation received in flight.
  enabledCheckRevision++;
  pendingEnabledCheck ??= (async () => {
    let revision;
    do {
      revision = enabledCheckRevision;
      await updateEnabledState(revision);
    } while (revision !== enabledCheckRevision && !extensionHasBeenUnloaded());
  })().finally(() => pendingEnabledCheck = null);
  return pendingEnabledCheck;
}

async function updateEnabledState(revision) {
  // A content script left in an open tab by an extension reload or update can no longer reach the
  // background page. Shut it down instead of throwing "Extension context invalidated".
  if (extensionHasBeenUnloaded()) return onUnload();
  const checkedUrl = location.href;
  let response;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const promises = [chrome.runtime.sendMessage({ handler: "initializeFrame" })];
      if (!Settings.isLoaded()) promises.push(Settings.onLoaded());
      [response] = await Promise.all(promises);
      if (typeof response?.isEnabledForUrl === "boolean") break;
    } catch (error) {
      // An update can invalidate this context while the request is in flight.
      if (extensionHasBeenUnloaded() || /Extension context invalidated/i.test(error?.message)) {
        return onUnload();
      }
      // A background worker starting or stopping can temporarily leave no receiver/response.
      if (
        !/Receiving end does not exist|Could not establish connection|message (?:port|channel) closed|message channel closed before a response/i
          .test(error?.message)
      ) throw error;
    }
    if (revision !== enabledCheckRevision) return;
    if (attempt < 4) await new Promise((resolve) => Utils.setTimeout(150 * (attempt + 1), resolve));
    if (extensionHasBeenUnloaded()) return onUnload();
  }
  if (extensionHasBeenUnloaded()) return onUnload();
  if (revision !== enabledCheckRevision) return;
  // A route can change before the initial message listener is ready to receive invalidations.
  if (checkedUrl !== location.href) {
    enabledCheckRevision++;
    return;
  }
  // A tab can outlive its background connection. Leave its state alone and retry on the next
  // focus/navigation rather than crashing or installing modes from missing state.
  if (typeof response?.isEnabledForUrl !== "boolean") return;

  isEnabledForUrl = response.isEnabledForUrl;

  // This browser info is used by other content scripts, but can only be determinted by the
  // background page.
  Utils._isFirefox = response.isFirefox;
  Utils._firefoxVersion = response.firefoxVersion;
  Utils._browserInfoLoaded = true;
  // This is the first time we learn what this frame's ID is.
  globalThis.frameId = response.frameId;
  if (response.tabSwitcherShortcut) TabSwitcher.shortcut = response.tabSwitcherShortcut;

  if (normalMode == null) installModes();
  normalMode.setPassKeys(response.passKeys);
  // Hide the HUD if we're not enabled.
  if (!isEnabledForUrl) HUD.hide(true, false);
}

// If this content script is running in the help dialog's iframe, then use the HelpDialogPage's
// methods to control the dialog. Otherwise, load the help dialog in a UIComponent iframe.
const HelpDialog = {
  helpUI: null,

  isShowing() {
    if (globalThis.isVimiumHelpDialogPage) return true;
    return this.helpUI && this.helpUI.showing;
  },

  abort() {
    if (globalThis.isVimiumHelpDialogPage) throw new Error("This should be impossible.");
    if (this.isShowing()) {
      return this.helpUI.hide(false);
    }
  },

  async toggle(request) {
    // If we're in the help dialog page already and the user has typed a key to show the help
    // dialog, then we should hide it.
    if (globalThis.isVimiumHelpDialogPage) return HelpDialogPage.hide();

    if (this.helpUI == null) {
      await DomUtils.documentComplete();
      this.helpUI = new UIComponent();
      this.helpUI.load("pages/help_dialog_page.html", "vimium-help-dialog-frame");
    }
    if (this.isShowing()) {
      this.helpUI.hide();
    } else {
      return this.helpUI.show(
        { name: "show" },
        { focus: true, sourceFrameId: request.sourceFrameId },
      );
    }
  },
};

const testEnv = globalThis.window == null;
if (!testEnv) {
  initWindowIsFocused();
  if (!DomUtils.isTopFrame()) FrameFocus.init();
  initializePreDomReady();
}

Object.assign(globalThis, {
  brovimContentScriptsLoaded: true,
  HelpDialog,
  handlerStack,
  windowIsFocused,
  // These are exported for normal mode and link-hints mode.
  focusThisFrame,
  // Exported only for tests.
  installModes,
});
