class NormalMode extends KeyHandlerMode {
  init(options) {
    if (options == null) {
      options = {};
    }

    const defaults = {
      name: "normal",
      indicator: false, // There is normally no mode indicator in normal mode.
      commandHandler: this.commandHandler.bind(this),
    };

    super.init(Object.assign(defaults, options));

    chrome.storage.session.get(
      "normalModeKeyStateMapping",
      (items) => {
        if (items?.normalModeKeyStateMapping) {
          this.setKeyMapping(items.normalModeKeyStateMapping);
        }
      },
    );

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "session" && changes.normalModeKeyStateMapping?.newValue) {
        this.setKeyMapping(changes.normalModeKeyStateMapping.newValue);
      }
    });
  }

  onKeydown(event) {
    // A copied or native selection can outlive visual mode. Escape clears that highlight too.
    if (KeyboardUtils.isEscape(event)) globalThis.getSelection()?.removeAllRanges();
    this.keyRepeat = event.repeat;
    return super.onKeydown(event);
  }

  commandHandler({ command: registryEntry }) {
    // A held X repeats, on the tab it reopened too: one tab per press.
    if (this.keyRepeat && registryEntry.command === "restoreTab") return;
    // Count prefixes are gone, but a mapping can still repeat a command: "map J scrollDown count=5".
    const count = registryEntry.options.count ?? 1;

    if (registryEntry.topFrame) {
      // We never return to a UI-component frame (e.g. the help dialog), it might have lost the
      // focus.
      const sourceFrameId = globalThis.isVimiumUIComponent ? 0 : frameId;
      chrome.runtime.sendMessage({
        handler: "sendMessageToFrames",
        message: { handler: "runInTopFrame", sourceFrameId, registryEntry },
      });
    } else if (registryEntry.background) {
      chrome.runtime.sendMessage({ handler: "runBackgroundCommand", registryEntry, count });
    } else {
      const commandFn = NormalModeCommands[registryEntry.command];
      commandFn(count, { registryEntry });
    }
  }
}

const NormalModeCommands = {
  // Scrolling.
  scrollToBottom() {
    Scroller.scrollTo("y", "max");
  },
  scrollToTop(count) {
    Scroller.scrollTo("y", (count - 1) * Settings.get("scrollStepSize"));
  },
  scrollToLeft() {
    Scroller.scrollTo("x", 0);
  },
  scrollToRight() {
    Scroller.scrollTo("x", "max");
  },
  scrollUp(count) {
    Scroller.scrollBy("y", -1 * Settings.get("scrollStepSize") * count);
  },
  scrollDown(count) {
    Scroller.scrollBy("y", Settings.get("scrollStepSize") * count);
  },
  scrollPageUp(count) {
    Scroller.scrollBy("y", "viewSize", (-1 / 2) * count);
  },
  scrollPageDown(count) {
    Scroller.scrollBy("y", "viewSize", (1 / 2) * count);
  },
  scrollFullPageUp(count) {
    Scroller.scrollBy("y", "viewSize", -1 * count);
  },
  scrollFullPageDown(count) {
    Scroller.scrollBy("y", "viewSize", 1 * count);
  },
  scrollLeft(count) {
    Scroller.scrollBy("x", -1 * Settings.get("scrollStepSize") * count);
  },
  scrollRight(count) {
    Scroller.scrollBy("x", Settings.get("scrollStepSize") * count);
  },

  // Tab navigation: back, forward.
  goBack(count) {
    history.go(-count);
  },
  goForward(count) {
    history.go(count);
  },

  toggleViewSource() {
    chrome.runtime.sendMessage({ handler: "getCurrentTabUrl" }, function (url) {
      if (url.startsWith("view-source:")) {
        url = url.slice(12);
      } else {
        url = "view-source:" + url;
      }
      chrome.runtime.sendMessage({ handler: "openUrlInNewTab", url });
    });
  },

  copyCurrentUrl() {
    chrome.runtime.sendMessage({ handler: "getCurrentTabUrl" }, function (url) {
      HUD.copyToClipboard(url);
      // This length is determined empirically based on a 350px width of the HUD. An alternate
      // solution is to have the HUD ellipsize based on its width.
      const maxLength = 40;
      if (url.length > maxLength) {
        url = url.slice(0, maxLength - 2) + "...";
      }
      HUD.show(`Yanked ${url}`, 2000);
    });
  },

  openCopiedUrlInNewTab(count, request) {
    HUD.pasteFromClipboard((url) =>
      chrome.runtime.sendMessage({
        handler: "openUrlInNewTab",
        position: request.registryEntry.options.position,
        url,
        count,
      })
    );
  },

  openCopiedUrlInCurrentTab() {
    HUD.pasteFromClipboard((url) =>
      chrome.runtime.sendMessage({ handler: "openUrlInCurrentTab", url })
    );
  },

  // Mode changes.
  enterInsertMode() {
    // If a focusable element receives the focus, then we exit and leave the permanently-installed
    // insert-mode instance to take over.
    return new InsertMode({ global: true, exitOnFocus: true });
  },

  enterFindMode() {
    return new FindMode();
  },

  enterVisualMode() {
    const mode = new VisualMode();
    mode.init({ userLaunchedMode: true });
    return mode;
  },

  enterVisualLineMode() {
    const mode = new VisualLineMode();
    mode.init({ userLaunchedMode: true });
    return mode;
  },

  // Find.
  performFind(count) {
    for (let i = 0, end = count; i < end; i++) {
      FindMode.findNext(false);
    }
  },

  performBackwardsFind(count) {
    for (let i = 0, end = count; i < end; i++) {
      FindMode.findNext(true);
    }
  },

  // Misc.
  showHelp(sourceFrameId) {
    return HelpDialog.toggle({ sourceFrameId });
  },

  focusInput(count) {
    // Focus the first input element on the page, and create overlays to highlight all the input
    // elements, with the currently-focused element highlighted specially. Tabbing will shift focus
    // to the next input element. Pressing any other key will remove the overlays and the special
    // tab behavior.
    let element, selectedInputIndex;
    const resultSet = DomUtils.evaluateXPath(
      textInputXPath,
      XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
    );
    const visibleInputs = [];

    for (let i = 0, end = resultSet.snapshotLength; i < end; i++) {
      element = resultSet.snapshotItem(i);
      if (!DomUtils.getVisibleClientRect(element, true)) {
        continue;
      }
      visibleInputs.push({ element, index: i, rect: Rect.copy(element.getBoundingClientRect()) });
    }

    visibleInputs.sort(
      function ({ element: element1, index: i1 }, { element: element2, index: i2 }) {
        // Put elements with a lower positive tabIndex first, keeping elements in DOM order.
        if (element1.tabIndex > 0) {
          if (element2.tabIndex > 0) {
            const tabDifference = element1.tabIndex - element2.tabIndex;
            if (tabDifference !== 0) {
              return tabDifference;
            } else {
              return i1 - i2;
            }
          } else {
            return -1;
          }
        } else if (element2.tabIndex > 0) {
          return 1;
        } else {
          return i1 - i2;
        }
      },
    );

    if (visibleInputs.length === 0) {
      HUD.show("There are no inputs to focus.", 1000);
      return;
    }

    // This is a hack to improve usability on the Brovim options page. We prime the recently-focused
    // input to be the key-mappings input. Arguably, this is the input that the user is most likely
    // to use.
    const recentlyFocusedElement = lastFocusedInput();

    if (count === 1) {
      // As the starting index, we pick that of the most recently focused input element (or 0).
      const elements = visibleInputs.map((visibleInput) => visibleInput.element);
      selectedInputIndex = Math.max(0, elements.indexOf(recentlyFocusedElement));
    } else {
      selectedInputIndex = Math.min(count, visibleInputs.length) - 1;
    }

    const hints = visibleInputs.map((tuple) => {
      const hint = DomUtils.createElement("div");
      hint.className = "vimium-reset internal-vimium-input-hint vimiumInputHint";

      // minus 1 for the border
      hint.style.left = (tuple.rect.left - 1) + globalThis.scrollX + "px";
      hint.style.top = (tuple.rect.top - 1) + globalThis.scrollY + "px";
      hint.style.width = tuple.rect.width + "px";
      hint.style.height = tuple.rect.height + "px";

      return hint;
    });

    return new FocusSelector(hints, visibleInputs, selectedInputIndex);
  },

  "LinkHints.activateMode": LinkHints.activateMode.bind(LinkHints),
  "LinkHints.activateModeToOpenInNewTab": LinkHints.activateModeToOpenInNewTab.bind(LinkHints),
  "LinkHints.activateModeWithQueue": LinkHints.activateModeWithQueue.bind(LinkHints),
  "LinkHints.activateModeToOpenIncognito": LinkHints.activateModeToOpenIncognito.bind(LinkHints),
  "LinkHints.activateModeToCopyLinkUrl": LinkHints.activateModeToCopyLinkUrl.bind(LinkHints),

  "Vomnibar.activate": Vomnibar.activate.bind(Vomnibar),
  "Vomnibar.activateInNewTab": Vomnibar.activateInNewTab.bind(Vomnibar),
  "Vomnibar.activateTabSelection": Vomnibar.activateTabSelection.bind(Vomnibar),
  "Vomnibar.activateBookmarks": Vomnibar.activateBookmarks.bind(Vomnibar),
  "Vomnibar.activateBookmarksInNewTab": Vomnibar.activateBookmarksInNewTab.bind(Vomnibar),
  "Vomnibar.activateEditUrl": Vomnibar.activateEditUrl.bind(Vomnibar),

  "TabSwitcher.activate": (sourceFrameId, registryEntry) =>
    TabSwitcher.activate(sourceFrameId, registryEntry.options),
};

// The types in <input type="..."> that we consider for focusInput command. Right now this is
// recalculated in each content script. Alternatively we could calculate it once in the background
// page and use a request to fetch it each time.
// Should we include the HTML5 date pickers here?

// The corresponding XPath for such elements.
const textInputXPath = (function () {
  const textInputTypes = ["text", "search", "email", "url", "number", "password", "date", "tel"];
  const inputElements = [
    "input[" +
    "(" + textInputTypes.map((type) => '@type="' + type + '"').join(" or ") + "or not(@type))" +
    " and not(@disabled or @readonly)]",
    "textarea",
    "*[@contenteditable='' or translate(@contenteditable, 'TRUE', 'true')='true']",
  ];
  if (typeof DomUtils !== "undefined" && DomUtils !== null) {
    return DomUtils.makeXPath(inputElements);
  }
})();

class FocusSelector extends Mode {
  constructor(hints, visibleInputs, selectedInputIndex) {
    super(...arguments);
    super.init({
      name: "focus-selector",
      exitOnClick: true,
      keydown: (event) => {
        if (event.key === "Tab") {
          hints[selectedInputIndex].classList.remove("internal-vimium-selected-input-hint");
          selectedInputIndex += hints.length + (event.shiftKey ? -1 : 1);
          selectedInputIndex %= hints.length;
          hints[selectedInputIndex].classList.add("internal-vimium-selected-input-hint");
          DomUtils.simulateSelect(visibleInputs[selectedInputIndex].element);
          return this.suppressEvent;
        } else if (event.key !== "Shift") {
          this.exit();
          // Give the new mode the opportunity to handle the event.
          return this.restartBubbling;
        }
      },
    });

    const div = DomUtils.createElement("div");
    div.id = "vimiumInputMarkerContainer";
    div.className = "vimium-reset";
    for (const el of hints) {
      div.appendChild(el);
    }
    this.hintContainerEl = div;
    document.documentElement.appendChild(div);

    DomUtils.simulateSelect(visibleInputs[selectedInputIndex].element);
    if (visibleInputs.length === 1) {
      this.exit();
      return;
    } else {
      hints[selectedInputIndex].classList.add("internal-vimium-selected-input-hint");
    }
  }

  exit() {
    super.exit();
    DomUtils.removeElement(this.hintContainerEl);
    if (document.activeElement && DomUtils.isEditable(document.activeElement)) {
      return new InsertMode({
        singleton: "post-find-mode/focus-input",
        targetElement: document.activeElement,
        indicator: false,
      });
    }
  }
}

globalThis.NormalMode = NormalMode;
globalThis.NormalModeCommands = NormalModeCommands;
