const TabSwitcher = {
  tabSwitcherUI: null,
  isAltCycling: false,
  isOpening: false,
  modifierState: {},
  keyboardEventAt: 0,
  // When this page last saw the shortcut's modifier go up, in Date.now() time: see
  // heldTabSwitcherShortcut.
  modifierUpAt: 0,
  shortcut: Utils.parseBrowserShortcut(),
  cycle: null,
  currentRequestId: null,
  overlayId: null,
  openingGeneration: 0,
  shortcutRequest: null,
  pendingCommit: false,
  isUnavailable: false,
  uiLoad: null,
  opening: null,
  backdrop: null,
  // A held shortcut shows the grid after this long, as desktop Alt+Tab switchers do, so that a
  // quick tap switches tabs without flashing the grid or taking the focus. Human taps differ:
  // raise it if taps still flash the grid, lower it if the grid feels late.
  showDelayMs: 90,
  keysFrame: null, // The focused embedded page that last reported its modifier keys.
  // Whether the browser has drawn this page yet. Until it has, the page shows nothing, Brovim's
  // grid included, and gets no keys: a page still waiting for a script or stylesheet in its head,
  // as on a slow network.
  painted: false,

  activate(sourceFrameId, options) {
    if (this.isUnavailable) return Promise.resolve(false);
    this.currentRequestId = options?.requestId ?? null;
    if (this.isOpening) {
      const overlayId = this.overlayId;
      // The activation message must reach the frame before any queued cycle messages.
      return this.opening.then((opened) => {
        if (!opened || this.overlayId !== overlayId || !this.tabSwitcherUI.showing) return false;
        return this.tabSwitcherUI.postMessage({ name: "cycleNext" }).then(() => true);
      });
    }
    if (this.tabSwitcherUI?.showing) {
      return this.tabSwitcherUI.postMessage({ name: "cycleNext" }).then(() => !this.isUnavailable);
    }
    return this.open(sourceFrameId, options);
  },

  async activateFromBrowserShortcut(requestId, options = {}) {
    if (this.isUnavailable) return { opened: false };
    if (
      options.expectedOverlayId &&
      (options.expectedOverlayId !== this.overlayId || !this.tabSwitcherUI?.showing)
    ) {
      return { opened: true, cancelled: true };
    }
    this.shortcut = options.shortcut ?? this.shortcut;
    if (options.cycle || !this.tabSwitcherUI?.showing) this.cycle = options.cycle ?? null;
    this.currentRequestId = requestId;
    if (!this.tabSwitcherUI?.showing && !this.isOpening) {
      // This page can't tell a tap from a hold, nor see the release. The background switches
      // tabs, as it does on pages that Brovim can't run on, and the next tab can tell.
      if (!this.seesShortcutKeys()) {
        this.cycle = null;
        return { opened: false };
      }
      if (this.modifierReleased()) return await this.quickSwitch();
    }

    let complete;
    const released = new Promise((resolve) => complete = resolve);
    this.shortcutRequest = { id: requestId, complete };
    const showing = this.activate(0, {
      ...options,
      altCycle: true,
      requestId,
      reverse: this.modifierState.shiftKey === true && !this.shortcut.requiresShift,
      // A carried gesture is already past its first press, unless it says otherwise.
      showDelay: options.showDelay ?? (options.cycle ? 0 : this.showDelayMs),
    }).then((opened) => ({ opened }));
    try {
      return await Promise.race([showing, released]);
    } finally {
      if (this.shortcutRequest?.id === requestId) this.shortcutRequest = null;
    }
  },

  async quickSwitch() {
    this.openingGeneration++;
    this.isOpening = this.isAltCycling = false;
    const cycle = this.cycle;
    this.cycle = null;
    const result = await chrome.runtime.sendMessage({
      handler: "quickSwitchTab",
      cycle,
    });
    if (!result?.switched) HUD.show("No other tab to switch to.", 2000);
    return { opened: true, quickSwitch: true };
  },

  open(sourceFrameId, options) {
    this.init();
    // A key mapping passes no shortcut; keep the assigned one this page learned at startup.
    this.shortcut = options?.shortcut ?? this.shortcut;
    if (!globalThis.isUnitTests) HelpDialog.abort();
    this.isAltCycling = options?.altCycle !== false;
    this.isOpening = true;
    this.pendingCommit = false;
    this.overlayId = crypto.randomUUID();
    const generation = ++this.openingGeneration;
    const overlayId = this.overlayId;
    const ui = this.tabSwitcherUI;
    const held = options?.showDelay &&
      new Promise((resolve) => Utils.setTimeout(options.showDelay, resolve));
    // Let an early Alt release switch directly while the hidden frame warms up. Do not send its
    // activation or fetch thumbnails if that request was already completed or cancelled.
    // Passive preview capture keeps screenshots current without delaying this interaction.
    this.opening = (async () => {
      await Promise.all([this.uiLoad, ui.iframePort, held]);
      // The tab can be left during that wait: a grid must never open, unseen, in a hidden tab.
      if (generation !== this.openingGeneration || globalThis.document?.hidden) return false;
      this.hideBackdrop();
      await ui.show(
        {
          name: "activate",
          overlayId,
          isAltCycle: this.isAltCycling,
          shortcut: this.shortcut,
          cycle: options?.cycle,
          reverse: options?.reverse,
          commitOnOpen: this.pendingCommit,
        },
        { sourceFrameId, focus: true, restoreFocus: true },
      );
      return generation === this.openingGeneration && !this.isUnavailable;
    })().finally(() => {
      if (generation === this.openingGeneration) this.isOpening = false;
    });
    return this.opening;
  },

  // The shortcut's modifier goes down before its letter. Tell the background, which wakes it and
  // tells it this page saw the press begin, and load the hidden grid frame, so the first grid on a
  // page opens as fast as later ones.
  // - fromFrame: an embedded page reported the key, and told the background itself.
  warmUp(event, fromFrame = false) {
    if (event.repeat || !Utils.isBrowserShortcutRelease(event, this.shortcut)) return;
    // A script orphaned by an extension update can't reach the extension.
    if (!chrome.runtime?.id) return;
    if (!fromFrame) chrome.runtime.sendMessage({ handler: "warmTabSwitcher" }).catch(() => {});
    // Loading the frame reads settings (for the user's CSS), which can still be loading early in a
    // page's life.
    if (Settings.isLoaded()) this.init();
  },

  init() {
    // Build the grid's frame again if the page threw the last one away.
    if (this.tabSwitcherUI?.detached) {
      for (const port of this.tabSwitcherUI.messageChannelPorts || []) port.close();
      this.tabSwitcherUI = this.backdrop = null;
    }
    if (!this.tabSwitcherUI) {
      this.tabSwitcherUI = new UIComponent();
      this.uiLoad = this.tabSwitcherUI.load(
        "pages/tab_switcher_page.html",
        "tab-switcher-frame",
        (event) => this.handleUiMessage(event),
        // The shortcut works while a page is still arriving on a slow network.
        { early: true },
      );
    }
  },

  async handleUiMessage({ data }) {
    if (data?.name === "panel") return this.placeBackdrop(data);
    // The frame asked to be hidden just before this: say so once the page has drawn without it.
    if (data?.name === "confirmHidden") {
      if (!document.hidden) {
        await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve)));
      }
      return this.tabSwitcherUI.postMessage({ name: "hiddenConfirmed" }).catch(() => {});
    }
    if (data?.name !== "request") return;
    const allowed = [
      "getOpenTabsWithScreenshots",
      "getTabScreenshots",
      "selectSpecificTab",
      "closeSpecificTab",
      "endTabSwitcherCycle",
      "setTabSwitcherOverlay",
      "shortcutKeyReleased",
    ];
    if (!allowed.includes(data.message?.handler)) return;
    let result, error;
    try {
      // The authenticated parent port retains the source tab, window and private context even
      // when Firefox omits sender.tab for extension-iframe runtime messages.
      result = await chrome.runtime.sendMessage(data.message);
    } catch (err) {
      error = err.message;
    }
    await this.tabSwitcherUI.postMessage({
      name: "response",
      id: data.id,
      ...(error ? { error } : { result }),
    }).catch(() => {});
  },

  // For liquid glass, the page under the switcher's panel is blurred and refracted. The switcher's
  // frame can't see the page, so this element does it from the page side, where the switcher page
  // says its panel is.
  placeBackdrop({ rect }) {
    if (!this.backdrop) {
      const svg = "http://www.w3.org/2000/svg";
      const create = (tag, attributes) => {
        const el = document.createElementNS(svg, tag);
        for (const [name, value] of Object.entries(attributes)) el.setAttribute(name, value);
        return el;
      };
      const filters = create("svg", { width: 0, height: 0, style: "position: absolute" });
      const refraction = create("filter", { id: "brovim-glass-refraction" });
      refraction.append(
        create("feTurbulence", {
          type: "fractalNoise",
          baseFrequency: "0.009 0.013",
          numOctaves: 2,
          seed: 5,
        }),
        create("feDisplacementMap", {
          in: "SourceGraphic",
          scale: 14,
          xChannelSelector: "R",
          yChannelSelector: "G",
        }),
      );
      filters.append(refraction);
      this.backdrop = DomUtils.createElement("div");
      this.backdrop.className = "tab-switcher-backdrop";
      // Right after the frame: vimium.css hides it along with the frame.
      this.tabSwitcherUI.iframeElement.after(this.backdrop, filters);
    }
    this.backdrop.hidden = !rect;
    for (const side of ["left", "top", "width", "height"]) {
      if (rect) this.backdrop.style[side] = `${rect[side]}px`;
    }
  },

  hideBackdrop() {
    if (this.backdrop) this.backdrop.hidden = true;
  },

  cancel(requestId) {
    if (this.currentRequestId !== requestId) return;
    this.openingGeneration++;
    this.currentRequestId = null;
    this.isOpening = this.isAltCycling = false;
    if (this.tabSwitcherUI?.showing) this.tabSwitcherUI.hide(false);
    if (this.shortcutRequest?.id === requestId) this.shortcutRequest.complete({ opened: false });
  },

  // The grid's frame hasn't started in time. Let the background switch directly until it has,
  // rather than make every press wait for it.
  suspend(requestId) {
    if (this.currentRequestId !== requestId) return;
    this.cancel(requestId);
    const ui = this.tabSwitcherUI;
    this.isUnavailable = true;
    ui?.iframePort.then(() => {
      if (this.tabSwitcherUI === ui) this.isUnavailable = false;
    });
  },

  // This page can't show the grid at all.
  abort(requestId) {
    if (this.currentRequestId !== requestId) return;
    this.cancel(requestId);
    this.isUnavailable = true;
    const ui = this.tabSwitcherUI;
    if (ui) {
      ui.showing = false;
      ui.shadowDOM?.host.remove();
      for (const port of ui.messageChannelPorts || []) port.close();
    }
  },

  onModifierReleased() {
    if (this.shortcutRequest && !this.tabSwitcherUI?.showing) {
      if (this.shortcutRequest.released) return;
      this.shortcutRequest.released = true;
      this.shortcutRequest.complete(this.quickSwitch());
      return;
    }
    if (this.isAltCycling && this.isOpening) {
      this.pendingCommit = true;
      return;
    }
    if (this.isAltCycling && (this.isOpening || this.tabSwitcherUI?.showing)) {
      this.tabSwitcherUI.postMessage({ name: "commitSelection" });
    }
  },

  modifierReleased() {
    // A protected-page hop cannot update this page's key state. Ignore events from before the
    // gesture, rather than treating an old Ctrl-up as a release of the arriving Ctrl+Q.
    if (this.cycle && this.keyboardEventAt < this.cycle.startedAt) return false;
    return this.shortcut.modifiers.some((key) => this.modifierState[key] === false);
  },

  // Whether this page saw the shortcut's modifier go down, and not back up, during this gesture.
  modifierHeld() {
    if (this.cycle && this.keyboardEventAt < this.cycle.startedAt) return false;
    return this.shortcut.modifiers.every((key) => this.modifierState[key] === true);
  },

  // Whether the shortcut's modifier going up will reach this page. The address bar, the PDF viewer
  // and embedded pages without Brovim keep their keys to themselves, and the browser gives a page
  // none before it has drawn it.
  seesShortcutKeys() {
    if (!this.painted || !document.hasFocus()) return false;
    // The PDF viewer keeps the keys from the page (whose focused element reads as the body), and
    // a page can't give them back to it once it has taken them: only a click can.
    if (document.contentType === "application/pdf") return false;
    const focused = DomUtils.deepActiveElement();
    if (!["IFRAME", "FRAME", "EMBED", "OBJECT"].includes(focused?.tagName)) return true;
    // An embedded page with Brovim reports its modifier keys: see reportKeyboardEvent.
    return focused === this.keysFrame;
  },

  // The frozen tab a gesture left says whether the shortcut was still held at the switch to this
  // page. Returns whether this page should show the grid for it now.
  showsHeldGrid(cycleId, held) {
    if (this.cycle?.id !== cycleId) return false;
    // This page already took the gesture for a hold (see the "unknown" handoff). If the frozen
    // page saw the release before the switch, it was a tap: drop the grid.
    if (this.isOpening || this.tabSwitcherUI?.showing) {
      if (!held) {
        this.cancel(this.currentRequestId);
        this.endCycle();
      }
      return false;
    }
    // A release after the switch reached this page.
    if (held && !this.modifierReleased()) return true;
    this.endCycle();
    return false;
  },

  // Resolves once this page has the focus, or after ms.
  whenFocused(ms) {
    if (document.hasFocus()) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        globalThis.removeEventListener("focus", done, true);
        resolve();
      };
      const timer = setTimeout(done, ms);
      globalThis.addEventListener("focus", done, true);
    });
  },

  rememberCycle(cycle, shortcut) {
    this.cycle = cycle;
    this.shortcut = shortcut;
    if (this.modifierReleased()) this.endCycle();
  },

  endCycle() {
    const id = this.cycle?.id;
    this.cycle = null;
    if (id) {
      try {
        chrome.runtime.sendMessage({ handler: "endTabSwitcherCycle", id }).catch(() => {});
      } catch (error) {
        if (!/Extension context invalidated/i.test(error?.message)) throw error;
      }
    }
  },

  // In an embedded page: keys typed here don't reach the top frame, which runs the switcher. Tell
  // it about the shortcut's modifier (and Shift, which reverses the direction).
  reportKeyboardEvent(event) {
    const isModifier = Utils.isBrowserShortcutRelease(event, this.shortcut) ||
      (event.key === "Shift" && this.shortcut.modifiers.some((key) => event[key]));
    if (!isModifier || event.repeat || !chrome.runtime?.id) return;
    const { type, key, altKey, ctrlKey, metaKey, shiftKey } = event;
    try {
      // The background hears of the press first-hand: see warmUp.
      if (type === "keydown" && Utils.isBrowserShortcutRelease(event, this.shortcut)) {
        chrome.runtime.sendMessage({ handler: "warmTabSwitcher" }).catch(() => {});
      }
      chrome.runtime.sendMessage({
        handler: "sendMessageToFrames",
        frameId: 0,
        message: {
          handler: "tabSwitcherKey",
          event: { type, key, altKey, ctrlKey, metaKey, shiftKey },
        },
      }).catch(() => {});
    } catch (error) {
      if (!/Extension context invalidated/i.test(error?.message)) throw error;
    }
  },

  // - fromFrame: an embedded page of this tab reported the event.
  recordKeyboardEvent(event, fromFrame = false) {
    if (fromFrame) {
      this.keysFrame = DomUtils.deepActiveElement();
      if (event.type === "keydown") this.warmUp(event, true);
    }
    // A new primary-modifier press is a new gesture, even if its previous release happened on
    // a protected page before this page received the carried cycle.
    if (
      event.type === "keydown" && !event.repeat &&
      Utils.isBrowserShortcutRelease(event, this.shortcut) && this.cycle &&
      !this.shortcutRequest && !this.tabSwitcherUI?.showing && !this.isOpening
    ) this.endCycle();
    this.keyboardEventAt = Date.now();
    for (const key of ["altKey", "ctrlKey", "metaKey", "shiftKey"]) {
      this.modifierState[key] = event[key];
    }
    if (event.type !== "keyup" || !Utils.isBrowserShortcutRelease(event, this.shortcut)) return;
    // The event's own time, as Date.now() gives it: a busy page handles it late. Not timeOrigin +
    // timeStamp: that clock stops while the computer sleeps, and Date.now() doesn't.
    this.modifierUpAt = event.timeStamp
      ? Date.now() - (performance.now() - event.timeStamp)
      : Date.now();
    if (this.cycle && !this.shortcutRequest && !this.tabSwitcherUI?.showing && !this.isOpening) {
      this.endCycle();
    }
    this.onModifierReleased();
  },
};

// Keeps this page's switcher preview current. After the page loads, comes into
// view, changes its URL or scrolls far, wait until it looks settled (nothing visible has changed,
// shifted or finished painting for 800ms, or 4.8s have passed), then ask the background to capture
// it. A first-paint capture supplies an early preview on every load and visit; the settled capture
// refines it. Scroll captures are throttled to 5s. Never capture while Brovim's UI is showing.
const TabPreview = {
  enabled: false,
  waitStart: 0, // When the current wait for the page to settle began, or 0.
  lastChange: 0,
  lastCapture: -Infinity,
  lastCaptureScrollY: 0,
  timer: null,
  pending: null,
  pendingUrl: null,
  mutations: null,
  changed: new Set(), // Nodes changed since the last check for visible changes.

  init() {
    this.enabled = true;
    // Measuring a change as it happens would force a style and layout pass from Brovim's world,
    // and images that pass starts loading would skip the page's preloads (Chrome warns of a
    // "cross-world-for-csp resource mismatch") and download twice. Measure once the page has
    // rendered the change instead.
    this.mutations = new MutationObserver((records) => {
      if (this.changed.size === 0) {
        requestAnimationFrame(() =>
          requestIdleCallback(() => this.checkChanges(), { timeout: 150 })
        );
      }
      for (const record of records) {
        this.changed.add(record.target);
        if (record.type === "childList") {
          for (const node of record.addedNodes) this.changed.add(node);
        }
      }
    });
    // Images finishing their paint and layout shifts (from fonts loading, say) don't change the DOM.
    for (const type of ["largest-contentful-paint", "layout-shift"]) {
      try {
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (entry.hadRecentInput || entry.value <= 0.002) continue;
            this.lastChange = Math.max(this.lastChange, entry.startTime);
          }
        }).observe({ type, buffered: true });
      } catch {
        // Firefox doesn't report layout shifts.
      }
    }
    document.addEventListener("visibilitychange", () => this.start("visible"));
    let scrollTimer;
    globalThis.addEventListener("scroll", () => {
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => {
        if (Math.abs(globalThis.scrollY - this.lastCaptureScrollY) >= 600) this.start("scroll");
      }, 700);
    }, { passive: true });
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => this.start("load"), { once: true });
    } else {
      this.start("load");
    }
  },

  // - reason: "load", "visible", "route" (the URL changed), "scroll" or "retry" (a capture is
  //   still owed).
  start(reason) {
    if (!this.enabled || !document.documentElement) return;
    if (document.hidden) {
      clearInterval(this.timer);
      this.mutations?.disconnect();
      this.waitStart = 0;
      return;
    }
    const now = performance.now();
    const firstPaint = ["load", "visible", "route"].includes(reason);
    if (reason === "route") this.lastChange = now;
    else if (!firstPaint && reason !== "retry" && now - this.lastCapture < 5000) return;
    if (this.waitStart) {
      if (reason === "route") this.scheduleCapture(true);
      return;
    }
    this.waitStart = now;
    if (reason === "load") this.lastChange = now;
    this.mutations.observe(document.documentElement, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["class", "style", "src", "srcset", "hidden"],
    });
    this.timer = setInterval(() => this.check(), 250);
    if (firstPaint) this.scheduleCapture(true);
  },

  checkChanges() {
    const nodes = [...this.changed];
    this.changed.clear();
    if (nodes.some(isVisible)) this.lastChange = performance.now();
  },

  check() {
    const now = performance.now();
    const waited = now - this.waitStart;
    const settled = waited >= 350 && now - this.lastChange >= 800 &&
      document.readyState === "complete";
    if (!settled && waited < 4800) return;
    clearInterval(this.timer);
    this.mutations.disconnect();
    this.waitStart = 0;
    if (document.hidden) return;
    if (isBrovimUiVisible()) {
      setTimeout(() => this.start("retry"), 400);
      return;
    }
    // Let the page finish its current frame first.
    this.scheduleCapture();
  },

  scheduleCapture(allowLoading = false) {
    requestAnimationFrame(() =>
      requestIdleCallback(() => this.capture(allowLoading), { timeout: 150 })
    );
  },

  // Resolves once this page's preview has been captured, or that wasn't possible.
  capture(allowLoading = false) {
    if (!this.enabled || document.hidden || isBrovimUiVisible()) return Promise.resolve();
    // A slow early capture must not swallow the settled refresh that follows it.
    if (this.pending && (!allowLoading || this.pendingUrl !== location.href)) {
      return this.pending.then(() => this.capture(allowLoading));
    }
    try {
      this.pendingUrl = location.href;
      this.pending ??= chrome.runtime.sendMessage({
        handler: "captureTabThumbnail",
        url: location.href,
        allowLoading,
      }).then((result) => {
        if (result?.retry) {
          setTimeout(() => {
            if (allowLoading) this.scheduleCapture(true);
            else this.start("retry");
          }, 600);
        } else if (result?.captured) {
          this.lastCapture = performance.now();
          this.lastCaptureScrollY = globalThis.scrollY;
        }
      }).catch(() => {}).finally(() => {
        this.pending = null;
        this.pendingUrl = null;
      });
    } catch {
      // The extension was updated or removed; its replacement keeps the previews.
      this.enabled = false;
      return Promise.resolve();
    }
    return this.pending;
  },
};

// Whether a changed node shows on screen: it's in a visible element of at least 32x32px within the
// viewport.
function isVisible(node) {
  const el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  if (!el?.isConnected) return false;
  const rect = el.getBoundingClientRect();
  return rect.width * rect.height >= 1024 && rect.bottom > 0 && rect.right > 0 &&
    rect.top < globalThis.innerHeight && rect.left < globalThis.innerWidth &&
    (el.checkVisibility?.({
      checkOpacity: true,
      checkVisibilityCSS: true,
      opacityProperty: true,
      visibilityProperty: true,
    }) ?? true);
}

// Link hints, or a visible switcher, Vomnibar, HUD or help dialog.
function isBrovimUiVisible() {
  return document.getElementById("vimium-hint-marker-container") != null ||
    [...(document.documentElement?.children ?? [])].some((el) =>
      el.shadowRoot?.querySelector(".vimium-ui-component-visible")
    );
}

globalThis.TabSwitcher = TabSwitcher;
globalThis.TabPreview = TabPreview;

if (globalThis.window != null) {
  // Only real key presses: a page must not be able to fake a modifier release and commit the grid.
  const recordKeyboardEvent = forTrusted((event) =>
    DomUtils.isTopFrame()
      ? TabSwitcher.recordKeyboardEvent(event)
      : TabSwitcher.reportKeyboardEvent(event)
  );
  globalThis.addEventListener("keydown", recordKeyboardEvent, true);
  globalThis.addEventListener("keyup", recordKeyboardEvent, true);
  // A key going up whose press this frame didn't see: a browser shortcut's (the browser takes the
  // press), or one pressed in a tab that has since closed. The background closes one tab per press
  // of Alt+X: see closeTab.
  const keysDown = new Set();
  globalThis.addEventListener("keydown", forTrusted((event) => keysDown.add(event.code)), true);
  // A key whose release went to another tab (X reopened one, say) is no longer down here.
  globalThis.addEventListener(
    "blur",
    forTrusted((event) => event.target === window && keysDown.clear()),
    true,
  );
  globalThis.addEventListener(
    "keyup",
    forTrusted((event) => {
      if (keysDown.delete(event.code) || ["Alt", "Control", "Shift", "Meta"].includes(event.key)) {
        return;
      }
      if (chrome.runtime?.id) {
        chrome.runtime.sendMessage({ handler: "shortcutKeyReleased" }).catch(() => {});
      }
    }),
    true,
  );
  if (DomUtils.isTopFrame()) {
    // A page's first animation frame comes when the browser first draws it.
    requestAnimationFrame(() => TabSwitcher.painted = true);
    globalThis.addEventListener("keydown", forTrusted((event) => TabSwitcher.warmUp(event)), true);
    // The grid shows, but this page has the keyboard: the page or the browser took it back from the
    // grid's frame, and only the shortcut, which comes through the background, still reached the
    // grid. Pass the key on, before the page or Brovim's mappings act on it, and refocus the grid.
    globalThis.addEventListener(
      "keydown",
      forTrusted((event) => {
        const ui = TabSwitcher.tabSwitcherUI;
        if (!ui?.showing || ["Alt", "Control", "Shift", "Meta"].includes(event.key)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        const { key, code, repeat, altKey, ctrlKey, metaKey, shiftKey } = event;
        ui.postMessage({
          name: "keydown",
          event: { key, code, repeat, altKey, ctrlKey, metaKey, shiftKey },
        });
        ui.focus();
      }),
      true,
    );
    // The grid belongs to the tab the user is looking at. Left open in a tab that went away, it
    // would be waiting there, with a stale selection, when the user comes back.
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) TabSwitcher.cancel(TabSwitcher.currentRequestId);
    });
    if (/^(https?|file):$/.test(location.protocol)) TabPreview.init();
  }
}
