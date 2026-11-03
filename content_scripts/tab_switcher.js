const TabSwitcher = {
  tabSwitcherUI: null,
  // True when opened with the Alt+Q browser shortcut: releasing Alt switches to the selected tab.
  isAltCycling: false,

  // - options.altCycle: set by the Alt+Q browser shortcut (see background_scripts/main.js).
  activate(sourceFrameId, options) {
    if (this.tabSwitcherUI?.showing) {
      // Alt+Q pressed again while the switcher is open.
      this.tabSwitcherUI.postMessage({ name: "cycleNext" });
      return;
    }
    this.open(sourceFrameId, options);
  },

  open(sourceFrameId, options) {
    this.init();
    if (!globalThis.isUnitTests) HelpDialog.abort();
    this.isAltCycling = options?.altCycle === true;
    this.tabSwitcherUI.show(
      { name: "activate", isAltCycle: this.isAltCycling },
      { sourceFrameId, focus: true },
    );
  },

  init() {
    if (!this.tabSwitcherUI) {
      this.tabSwitcherUI = new UIComponent();
      this.tabSwitcherUI.load("pages/tab_switcher_page.html", "tab-switcher-frame");

      // Alt can be released before the switcher's iframe has taken the focus.
      globalThis.addEventListener("keyup", (e) => {
        if (e.key === "Alt" && this.tabSwitcherUI?.showing && this.isAltCycling) {
          this.tabSwitcherUI.postMessage({ name: "commitSelection" });
        }
      }, true);
    }
  },
};

globalThis.TabSwitcher = TabSwitcher;
