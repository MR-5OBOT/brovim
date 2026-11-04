const TabSwitcher = {
  tabSwitcherUI: null,
  isAltCycling: false,
  isOpening: false,
  altKeyIsDown: null,
  currentRequestId: null,
  cancelledPreviewRequest: null,
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
      // The activation message must reach the frame before any queued cycle messages.
      return this.opening.then((opened) => {
        if (!opened || !this.tabSwitcherUI.showing) return false;
        return this.tabSwitcherUI.postMessage({ name: "cycleNext" }).then(() => true);
      });
    }
    if (this.tabSwitcherUI?.showing) {
      return this.tabSwitcherUI.postMessage({ name: "cycleNext" }).then(() => !this.isUnavailable);
    }
    return this.open(sourceFrameId, options);
  },

  async activateFromBrowserShortcut(requestId) {
    if (this.isUnavailable) return { opened: false };
    this.currentRequestId = requestId;
    const focusedInFrame = ["IFRAME", "FRAME"].includes(document.activeElement?.tagName);
    if (this.altKeyIsDown === false && !focusedInFrame) return await this.quickSwitch(requestId);

    let complete;
    const released = new Promise((resolve) => complete = resolve);
    this.shortcutRequest = { id: requestId, complete };
    const showing = this.activate(0, { altCycle: true, requestId }).then((opened) => ({ opened }));
    try {
      return await Promise.race([showing, released]);
    } finally {
      if (this.shortcutRequest?.id === requestId) this.shortcutRequest = null;
    }
  },

  async quickSwitch(requestId) {
    this.cancelledPreviewRequest = requestId;
    this.isOpening = this.isAltCycling = false;
    const result = await chrome.runtime.sendMessage({ handler: "quickSwitchTab" });
    if (!result?.switched) HUD.show("No other tab to switch to.", 2000);
    return { opened: true, quickSwitch: true };
  },

  open(sourceFrameId, options) {
    this.init();
    if (!globalThis.isUnitTests) HelpDialog.abort();
    this.isAltCycling = options?.altCycle !== false;
    this.isOpening = true;
    this.pendingCommit = false;
    const ui = this.tabSwitcherUI;
    const requestId = options?.requestId ?? null;
    // Let an early Alt release switch directly while the hidden frame warms up. Do not send its
    // activation or fetch thumbnails if that request was already completed or cancelled.
    // Passive preview capture keeps screenshots current without delaying this interaction.
    this.opening = (async () => {
      await Promise.all([this.uiLoad, ui.iframePort]);
      if (requestId && this.cancelledPreviewRequest === requestId) return false;
      this.hideBackdrop();
      await ui.show(
        {
          name: "activate",
          isAltCycle: this.isAltCycling,
          commitOnOpen: this.pendingCommit ||
            (options?.browserShortcut === true && this.altKeyIsDown === false),
        },
        { sourceFrameId, focus: true },
      );
      return !this.isUnavailable;
    })().finally(() => {
      this.isOpening = false;
    });
    return this.opening;
  },

  init() {
    if (!this.tabSwitcherUI) {
      this.tabSwitcherUI = new UIComponent();
      this.uiLoad = this.tabSwitcherUI.load(
        "pages/tab_switcher_page.html",
        "tab-switcher-frame",
        (event) => event.data?.name === "panel" && this.placeBackdrop(event.data),
      );
    }
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
    this.cancelledPreviewRequest = requestId;
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

  onAltReleased() {
    if (this.shortcutRequest && !this.tabSwitcherUI?.showing) {
      this.shortcutRequest.complete(this.quickSwitch(this.shortcutRequest.id));
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
};

// Keeps this page's switcher preview current, like TabGlance. After the page loads, comes into
// view, changes its URL or scrolls far, wait until it looks settled (nothing visible has changed,
// shifted or finished painting for 800ms, or 4.8s have passed), then ask the background to capture
// it. A page is recaptured at most every 5s, except after a URL change, and never while Brovim's own
// UI is showing.
const TabPreview = {
  enabled: false,
  waitStart: 0, // When the current wait for the page to settle began, or 0.
  lastChange: 0,
  lastCapture: -Infinity,
  lastCaptureScrollY: 0,
  timer: null,
  pending: null,
  mutations: null,

  init() {
    this.enabled = true;
    this.mutations = new MutationObserver((records) => {
      if (records.some(isVisibleChange)) this.lastChange = performance.now();
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
    if (!this.enabled || document.hidden || !document.documentElement) return;
    const now = performance.now();
    if (reason === "route") this.lastChange = now;
    else if (reason !== "retry" && now - this.lastCapture < 5000) return;
    if (this.waitStart) return;
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
    requestAnimationFrame(() => requestIdleCallback(() => this.capture(), { timeout: 600 }));
  },

  // Resolves once this page's preview has been captured, or that wasn't possible.
  capture() {
    if (!this.enabled || document.hidden || isBrovimUiVisible()) return Promise.resolve();
    try {
      this.pending ??= chrome.runtime.sendMessage({
        handler: "captureTabThumbnail",
        url: location.href,
      }).then((result) => {
        if (result?.retry) {
          setTimeout(() => this.start("retry"), 600);
        } else if (result?.captured) {
          this.lastCapture = performance.now();
          this.lastCaptureScrollY = globalThis.scrollY;
        }
      }).catch(() => {}).finally(() => this.pending = null);
    } catch {
      // The extension was updated or removed; its replacement keeps the previews.
      this.enabled = false;
      return Promise.resolve();
    }
    return this.pending;
  },
};

// Whether a DOM change shows on screen: it's in a visible element of at least 32x32px within the
// viewport.
function isVisibleChange(record) {
  const nodes = record.type === "childList"
    ? [...record.addedNodes, record.target]
    : [record.target];
  return nodes.some((node) => {
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
  });
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
  globalThis.addEventListener("keydown", (event) => TabSwitcher.altKeyIsDown = event.altKey, true);
  globalThis.addEventListener("keyup", (event) => {
    TabSwitcher.altKeyIsDown = event.altKey;
    if (event.key === "Alt") TabSwitcher.onAltReleased();
  }, true);
  if (DomUtils.isTopFrame() && /^(https?|file):$/.test(location.protocol)) TabPreview.init();
}
