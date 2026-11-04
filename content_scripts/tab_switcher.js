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
    if (!result?.switched) HUD.show("Visit another awake tab to switch between recent tabs.", 2000);
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
    this.opening = (async () => {
      await this.uiLoad;
      await ui.iframePort;
      if (requestId && this.cancelledPreviewRequest === requestId) return false;
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
      this.uiLoad = this.tabSwitcherUI.load("pages/tab_switcher_page.html", "tab-switcher-frame");
    }
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

globalThis.TabSwitcher = TabSwitcher;

if (globalThis.window != null) {
  globalThis.addEventListener("keydown", (event) => TabSwitcher.altKeyIsDown = event.altKey, true);
  globalThis.addEventListener("keyup", (event) => {
    TabSwitcher.altKeyIsDown = event.altKey;
    if (event.key === "Alt") TabSwitcher.onAltReleased();
  }, true);
}
