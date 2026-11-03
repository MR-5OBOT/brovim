const TabSwitcher = {
  tabSwitcherUI: null,
  isAltCycling: false,

  activate(sourceFrameId, options) {
    if (this.tabSwitcherUI?.showing) {
      this.tabSwitcherUI.postMessage({ name: "cycleNext", backwards: options?.backwards || false });
      return;
    }
    this.open(sourceFrameId, options);
  },

  open(sourceFrameId, options) {
    this.init();
    if (!globalThis.isUnitTests && typeof HelpDialog !== "undefined" && HelpDialog?.abort) {
      HelpDialog.abort();
    }
    this.isAltCycling = options?.isAlt ?? true;
    this.tabSwitcherUI.show(
      { name: "activate", isAltCycle: this.isAltCycling },
      { sourceFrameId, focus: true },
    );
  },

  init() {
    if (!this.tabSwitcherUI) {
      this.tabSwitcherUI = new UIComponent();
      this.tabSwitcherUI.load("pages/tab_switcher_page.html", "tab-switcher-frame");

      globalThis.addEventListener("keyup", (e) => {
        if (e.key === "Alt" && this.tabSwitcherUI?.showing && this.isAltCycling) {
          this.tabSwitcherUI.postMessage({ name: "commitSelection" });
        }
      }, true);
    }
  },
};

globalThis.TabSwitcher = TabSwitcher;
