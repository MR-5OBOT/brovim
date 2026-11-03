const TabSwitcher = {
  tabSwitcherUI: null,

  activate(sourceFrameId) {
    this.open(sourceFrameId);
  },

  open(sourceFrameId) {
    this.init();
    if (!globalThis.isUnitTests && typeof HelpDialog !== "undefined" && HelpDialog?.abort) {
      HelpDialog.abort();
    }
    this.tabSwitcherUI.show(
      { name: "activate" },
      { sourceFrameId, focus: true },
    );
  },

  init() {
    if (!this.tabSwitcherUI) {
      this.tabSwitcherUI = new UIComponent();
      this.tabSwitcherUI.load("pages/tab_switcher_page.html", "tab-switcher-frame");
    }
  },
};

globalThis.TabSwitcher = TabSwitcher;
