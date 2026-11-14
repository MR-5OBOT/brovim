//
// This wraps the vomnibar iframe, which we inject into the page to provide the vomnibar.
//
const Vomnibar = {
  vomnibarUI: null,

  // sourceFrameId here (and below) is the ID of the frame from which this request originates, which
  // may be different from the current frame.

  activate(sourceFrameId, registryEntry) {
    const options = Object.assign({}, registryEntry.options, { completer: "omni" });
    this.open(sourceFrameId, options);
  },

  activateInNewTab(sourceFrameId, registryEntry) {
    const options = Object.assign({}, registryEntry.options, { completer: "omni", newTab: true });
    this.open(sourceFrameId, options);
  },

  activateTabSelection(sourceFrameId) {
    this.open(sourceFrameId, {
      completer: "tabs",
      selectFirst: true,
    });
  },

  activateBookmarks(sourceFrameId, registryEntry) {
    const options = Object.assign({}, registryEntry.options, {
      completer: "bookmarks",
      selectFirst: true,
    });
    this.open(sourceFrameId, options);
  },

  activateBookmarksInNewTab(sourceFrameId, registryEntry) {
    const options = Object.assign({}, registryEntry.options, {
      completer: "bookmarks",
      selectFirst: true,
      newTab: true,
    });
    this.open(sourceFrameId, options);
  },

  activateEditUrl(sourceFrameId) {
    this.open(sourceFrameId, {
      completer: "omni",
      selectFirst: false,
      query: globalThis.location.href,
    });
  },

  activateBrowserPages(targetTabId) {
    HelpDialog.abort();
    if (this.vomnibarUI?.showing) this.vomnibarUI.hide(false);
    if (this.browserPagesUI?.showing) {
      this.browserPagesUI.hide();
      return;
    }
    if (this.browserPagesUI?.detached) this.browserPagesUI = null;
    if (!this.browserPagesUI) {
      this.browserPagesUI = new UIComponent();
      this.browserPagesUI.load("pages/browser_pages.html", "browser-pages-frame", null, {
        early: true,
      });
    }
    this.browserPagesUI.show({ name: "activate", targetTabId }, {
      sourceFrameId: 0,
      focus: true,
      restoreFocus: true,
    });
  },

  // Also run ahead of the first o, once the page has a moment: see vimium_frontend.js.
  init() {
    // Build the bar again if the page threw the last one away.
    if (this.vomnibarUI?.detached) this.vomnibarUI = null;
    if (!this.vomnibarUI) {
      this.vomnibarUI = new UIComponent();
      // A page still arriving on a slow network can take seconds to finish parsing.
      this.vomnibarUI.load("pages/vomnibar_page.html", "vomnibar-frame", null, { early: true });
    }
  },

  // Opens the vomnibar.
  // - vomnibarShowOptions:
  //     completer: The name of the completer to fetch results from.
  //     query: Optional. Text to prefill the Vomnibar with.
  //     selectFirst: Optional. Whether to select the first entry.
  //     newTab: Optional. Whether to open the result in a new tab.
  //     keyword: A keyword which will scope the search to a UserSearchEngine.
  open(sourceFrameId, vomnibarShowOptions) {
    if (this.browserPagesUI?.showing) this.browserPagesUI.hide(false);
    this.init();
    // The Vomnibar cannot coexist with the help dialog (it causes focus issues).
    HelpDialog.abort();
    Utils.assertType(VomnibarShowOptions, vomnibarShowOptions);
    this.vomnibarUI.show(
      Object.assign(vomnibarShowOptions, { name: "activate" }),
      { sourceFrameId, focus: true },
    );
  },
};

globalThis.Vomnibar = Vomnibar;
