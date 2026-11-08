const TabSwitcher = {
  tabSwitcherUI: null,
  isAltCycling: false,
  isOpening: false,
  modifierState: {},
  keyboardEventAt: 0,
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
    const focusedInFrame = ["IFRAME", "FRAME"].includes(document.activeElement?.tagName);
    if (this.modifierReleased() && !focusedInFrame) return await this.quickSwitch();

    let complete;
    const released = new Promise((resolve) => complete = resolve);
    this.shortcutRequest = { id: requestId, complete };
    const showing = this.activate(0, {
      ...options,
      altCycle: true,
      requestId,
      reverse: this.modifierState.shiftKey === true && !this.shortcut.requiresShift,
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
    // Let an early Alt release switch directly while the hidden frame warms up. Do not send its
    // activation or fetch thumbnails if that request was already completed or cancelled.
    // Passive preview capture keeps screenshots current without delaying this interaction.
    this.opening = (async () => {
      await Promise.all([this.uiLoad, ui.iframePort]);
      if (generation !== this.openingGeneration) return false;
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
        { sourceFrameId, focus: true },
      );
      return generation === this.openingGeneration && !this.isUnavailable;
    })().finally(() => {
      if (generation === this.openingGeneration) this.isOpening = false;
    });
    return this.opening;
  },

  // The shortcut's modifier goes down before its letter. Load the hidden grid frame and wake the
  // background then, so the first grid on a page opens as fast as later ones. A quick tap doesn't
  // wait for either.
  warmUp(event) {
    if (event.repeat || !Utils.isBrowserShortcutRelease(event, this.shortcut)) return;
    // Loading the frame reads settings (for the user's CSS), which can still be loading early in a
    // page's life. A script orphaned by an extension update can't reach the extension.
    if (!Settings.isLoaded() || !chrome.runtime?.id) return;
    this.init();
    chrome.runtime.sendMessage({ handler: "warmTabSwitcher" }).catch(() => {});
  },

  init() {
    if (!this.tabSwitcherUI) {
      this.tabSwitcherUI = new UIComponent();
      this.uiLoad = this.tabSwitcherUI.load(
        "pages/tab_switcher_page.html",
        "tab-switcher-frame",
        (event) => this.handleUiMessage(event),
      );
    }
  },

  async handleUiMessage({ data }) {
    if (data?.name === "panel") return this.placeBackdrop(data);
    if (data?.name !== "request") return;
    const allowed = [
      "getOpenTabsWithScreenshots",
      "getTabScreenshots",
      "selectSpecificTab",
      "closeSpecificTab",
      "endTabSwitcherCycle",
      "setTabSwitcherOverlay",
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

  recordKeyboardEvent(event) {
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
  const recordKeyboardEvent = forTrusted((event) => TabSwitcher.recordKeyboardEvent(event));
  globalThis.addEventListener("keydown", recordKeyboardEvent, true);
  globalThis.addEventListener("keyup", recordKeyboardEvent, true);
  if (DomUtils.isTopFrame()) {
    globalThis.addEventListener("keydown", forTrusted((event) => TabSwitcher.warmUp(event)), true);
    if (/^(https?|file):$/.test(location.protocol)) TabPreview.init();
  }
}
