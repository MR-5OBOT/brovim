// This is the order they will be shown in the help dialog.
//
// Properties:
// - advanced: advanced commands are not shown in the help dialog by default.
// - background: whether this command has to be run by the background page.
// - desc: shown in the help dialog and command listing page.
// - details: extra help information that will only be shown on the command listing page.
// - group: commands are displayed in groups in the help dialog and command listing.
// - noRepeat: whether this command can be used with a count key prefix.
// - repeatLimit: the number of allowed repetitions of this command before the user is prompted for
//   confirmation.
// - topFrame: whether this command must be run only in the top frame of a page.
//
const allCommands = [
  //
  // Navigation
  //

  {
    name: "scrollDown",
    desc: "Scroll down",
    group: "navigation",
  },

  {
    name: "scrollUp",
    desc: "Scroll up",
    group: "navigation",
  },

  {
    name: "scrollToTop",
    desc: "Scroll to the top of the page",
    group: "navigation",
    noRepeat: true,
  },

  {
    name: "scrollToBottom",
    desc: "Scroll to the bottom of the page",
    group: "navigation",
    noRepeat: true,
  },

  {
    name: "scrollPageDown",
    desc: "Scroll a half page down",
    group: "navigation",
  },

  {
    name: "scrollPageUp",
    desc: "Scroll a half page up",
    group: "navigation",
  },

  {
    name: "scrollFullPageDown",
    desc: "Scroll a full page down",
    group: "navigation",
  },

  {
    name: "scrollFullPageUp",
    desc: "Scroll a full page up",
    group: "navigation",
  },

  {
    name: "scrollLeft",
    desc: "Scroll left",
    group: "navigation",
  },

  {
    name: "scrollRight",
    desc: "Scroll right",
    group: "navigation",
    advanced: true,
  },

  {
    name: "scrollToLeft",
    desc: "Scroll all the way to the left",
    group: "navigation",
    advanced: true,
    noRepeat: true,
  },

  {
    name: "scrollToRight",
    desc: "Scroll all the way to the right",
    group: "navigation",
    advanced: true,
    noRepeat: true,
  },

  {
    name: "reload",
    desc: "Reload the page",
    group: "navigation",
    background: true,
    options: {
      hard: "Perform a hard reload, forcing the browser to bypass its cache.",
    },
    noRepeat: true,
  },

  {
    name: "copyCurrentUrl",
    desc: "Copy the current URL to the clipboard",
    group: "navigation",
    noRepeat: true,
  },

  {
    name: "openCopiedUrlInCurrentTab",
    desc: "Open the clipboard's URL in the current tab",
    group: "navigation",
    noRepeat: true,
  },

  {
    name: "openCopiedUrlInNewTab",
    desc: "Open the clipboard's URL in a new tab",
    group: "navigation",
    noRepeat: true,
    options: {
      position: "Where to place the tab in the tab bar. " +
        "One of `start`, `before`, `after`, `end`. `after` is the default.",
    },
  },

  {
    name: "enterInsertMode",
    desc: "Enter insert mode",
    group: "navigation",
    noRepeat: true,
  },

  {
    name: "focusInput",
    desc: "Focus the first text input on the page",
    group: "navigation",
    noRepeat: true,
  },

  {
    name: "LinkHints.activateMode",
    desc: "Open a link in the current tab",
    options: {
      action: "`copy-text`. When a link is selected, " +
        "instead of clicking on the link, copy its text.",
    },
    group: "navigation",
    advanced: true,
  },

  {
    name: "LinkHints.activateModeToOpenInNewTab",
    desc: "Open a link in a new tab",
    group: "navigation",
  },

  {
    name: "LinkHints.activateModeWithQueue",
    desc: "Open multiple links in a new tab",
    group: "navigation",
    advanced: true,
    noRepeat: true,
  },

  {
    name: "LinkHints.activateModeToOpenIncognito",
    desc: "Open a link in incognito window",
    group: "navigation",
    advanced: true,
  },

  {
    name: "LinkHints.activateModeToCopyLinkUrl",
    desc: "Copy a link URL to the clipboard",
    group: "navigation",
    advanced: true,
  },

  //
  // Vomnibar
  //

  {
    name: "Vomnibar.activate",
    desc: "Open URL, bookmark or history entry",
    options: {
      query: "The text to prefill the Vomnibar with.",
      keyword: 'The keyword of a search engine defined in the "Custom search engines" ' +
        "section of the Brovim Options page. The Vomnibar will be scoped to use that search engine.",
    },
    group: "vomnibar",
    topFrame: true,
    noRepeat: true,
  },

  {
    name: "Vomnibar.activateInNewTab",
    desc: "Open URL, bookmark or history entry in a new tab",
    group: "vomnibar",
    options: {
      query: "The text to prefill the Vomnibar with.",
      keyword: 'The keyword of a search engine defined in the "Custom search engines" ' +
        "section of the Brovim Options page. The Vomnibar will be scoped to use that search engine.",
    },
    topFrame: true,
    noRepeat: true,
  },

  {
    name: "Vomnibar.activateBookmarks",
    desc: "Open a bookmark",
    group: "vomnibar",
    options: {
      query: "The text to prefill the Vomnibar with.",
    },
    topFrame: true,
    noRepeat: true,
  },

  {
    name: "Vomnibar.activateBookmarksInNewTab",
    desc: "Open a bookmark in a new tab",
    group: "vomnibar",
    options: {
      query: "The text to prefill the Vomnibar with.",
    },
    topFrame: true,
    noRepeat: true,
  },

  {
    name: "Vomnibar.activateTabSelection",
    desc: "Search through your open tabs",
    group: "vomnibar",
    topFrame: true,
    noRepeat: true,
  },

  {
    name: "TabSwitcher.activate",
    desc: "Open visual tab switcher with thumbnail previews",
    group: "tabs",
    topFrame: true,
    noRepeat: true,
  },

  {
    name: "Vomnibar.activateEditUrl",
    desc: "Edit the current URL",
    group: "vomnibar",
    topFrame: true,
    noRepeat: true,
  },

  //
  // Find
  //

  {
    name: "enterFindMode",
    desc: "Enter find mode.",
    group: "find",
    noRepeat: true,
  },

  {
    name: "performFind",
    desc: "Cycle forward to the next find match",
    group: "find",
  },

  {
    name: "performBackwardsFind",
    desc: "Cycle backward to the previous find match",
    group: "find",
  },

  //
  // History
  //

  {
    name: "goBack",
    desc: "Go back in history",
    group: "history",
  },

  {
    name: "goForward",
    desc: "Go forward in history",
    group: "history",
  },

  //
  // Tabs
  //

  {
    name: "createTab",
    desc: "Create new tab",
    options: {
      "(any url)": "Open this URL, rather than the browser's new tab page. " +
        "E.g.: `map X createTab https://example.com`",
      window: "Create the tab in a new window",
      incognito: "Create the tab in an incognito window",
      position: "Where to place the tab in the tab bar. " +
        "One of `start`, `before`, `after`, `end`. `after` is the default.",
    },
    group: "tabs",
    background: true,
    repeatLimit: 20,
  },

  {
    name: "previousTab",
    desc: "Go one tab left",
    group: "tabs",
    background: true,
  },

  {
    name: "nextTab",
    desc: "Go one tab right",
    group: "tabs",
    background: true,
  },

  {
    name: "visitPreviousTab",
    desc: "Go to previously-visited tab",
    group: "tabs",
    background: true,
  },

  {
    name: "togglePinTab",
    desc: "Pin or unpin current tab",
    group: "tabs",
    background: true,
    noRepeat: true,
  },

  {
    name: "toggleMuteTab",
    desc: "Mute or unmute current tab",
    options: {
      all: "Mute all tabs.",
      other: "Mute every tab except the current one.",
    },
    group: "tabs",
    background: true,
    noRepeat: true,
  },

  {
    name: "removeTab",
    desc: "Close current tab",
    group: "tabs",
    background: true,
    // Don't close (in one command invocation) more than the number of tabs that can be re-opened by
    // the browser.
    repeatLimit: chrome.sessions?.MAX_SESSION_RESULTS || 25,
  },

  {
    name: "restoreTab",
    desc: "Restore closed tab",
    group: "tabs",
    background: true,
    repeatLimit: 20,
  },

  {
    name: "moveTabLeft",
    desc: "Move tab to the left",
    group: "tabs",
    advanced: true,
    background: true,
  },

  {
    name: "moveTabRight",
    desc: "Move tab to the right",
    group: "tabs",
    advanced: true,
    background: true,
  },

  {
    name: "setZoom",
    desc: "Set zoom",
    group: "tabs",
    advanced: true,
    background: true,
    options: {
      level: "The zoom level. This can be a range of [0.25, 5.0]. 1.0 is the default.",
    },
    noRepeat: true,
  },

  {
    name: "zoomIn",
    desc: "Zoom in",
    group: "tabs",
    advanced: true,
    background: true,
  },

  {
    name: "zoomOut",
    desc: "Zoom out",
    group: "tabs",
    advanced: true,
    background: true,
  },

  {
    name: "zoomReset",
    desc: "Reset zoom",
    group: "tabs",
    advanced: true,
    background: true,
    noRepeat: true,
  },

  //
  // Misc
  //

  {
    name: "toggleViewSource",
    desc: "View page source",
    group: "misc",
    advanced: true,
    noRepeat: true,
  },

  {
    name: "showHelp",
    desc: "Show help",
    group: "misc",
    noRepeat: true,
    topFrame: true,
  },
];

export { allCommands };
