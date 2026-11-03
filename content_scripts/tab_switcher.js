const TabSwitcher = {
  tabSwitcherUI: null,
  // True when opened with the Alt+Q browser shortcut: releasing Alt switches to the selected tab.
  isAltCycling: false,
  // True until the switcher's iframe has loaded and shown. The first open in a tab takes a moment.
  isOpening: false,

  // - options.altCycle: set by the Alt+Q browser shortcut (see background_scripts/main.js).
  activate(sourceFrameId, options) {
    if (this.tabSwitcherUI?.showing || this.isOpening) {
      // Alt+Q pressed again while the switcher is open (or still loading).
      return this.tabSwitcherUI.postMessage({ name: "cycleNext" });
    }
    return this.open(sourceFrameId, options);
  },

  open(sourceFrameId, options) {
    this.init();
    if (!globalThis.isUnitTests) HelpDialog.abort();
    this.isAltCycling = options?.altCycle !== false;
    this.isOpening = true;
    return this.tabSwitcherUI.show(
      { name: "activate", isAltCycle: this.isAltCycling },
      { sourceFrameId, focus: true },
    ).finally(() => this.isOpening = false);
  },

  init() {
    if (!this.tabSwitcherUI) {
      this.tabSwitcherUI = new UIComponent();
      this.tabSwitcherUI.load("pages/tab_switcher_page.html", "tab-switcher-frame");

      // Alt can be released before the switcher's iframe has loaded or taken the focus. The message
      // is queued until the iframe is ready, and the page waits for its tab list before switching.
      globalThis.addEventListener("keyup", (e) => {
        const isOpenOrOpening = this.isOpening || this.tabSwitcherUI?.showing;
        if (e.key === "Alt" && this.isAltCycling && isOpenOrOpening) {
          this.tabSwitcherUI.postMessage({ name: "commitSelection" });
        }
      }, true);
    }
  },
};

globalThis.TabSwitcher = TabSwitcher;
