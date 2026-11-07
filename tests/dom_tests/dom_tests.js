let commandCount = null;
let commandName = null;

// Some tests have side effects on the handler stack and the active mode, so these are reset on
// setup. Also, some tests affect the focus (e.g. Vomnibar tests), so we make sure the window has
// the focus.
const initializeModeState = () => {
  globalThis.focus();
  Mode.reset();
  handlerStack.reset();
  const normalMode = installModes();
  normalMode.setPassKeys("p");
  normalMode.setKeyMapping({
    m: { options: {}, command: "m" }, // A mapped key.
    p: { options: {}, command: "p" }, // A pass key.
    z: { p: { options: {}, command: "zp" } }, // Not a pass key.
  });
  normalMode.setCommandHandler(({ command, count }) => {
    [commandName, commandCount] = [command.command, count];
  });
  commandName = null;
  commandCount = null;
  return normalMode;
};

//
// Retrieve the hint markers as an array object.
//
const getHintMarkerEls = () => Array.from(document.querySelectorAll(".vimiumHintMarker"));

const stubSettings = (key, value) => stub(Settings._settings, key, value);

HintCoordinator.sendMessage = (name, request) => {
  if (request == null) {
    request = {};
  }
  if (HintCoordinator[name]) {
    HintCoordinator[name](request);
  }
  return request;
};

const activateLinkHintsMode = () => {
  HintCoordinator.getHintDescriptors({ modeIndex: 0 }, {}, () => {});
  HintCoordinator.activateMode({
    frameId,
    frameIdToHintDescriptors: {},
    modeIndex: 0,
    originatingFrameId: frameId,
  });
  return HintCoordinator.linkHintsMode;
};

//
// Generate tests that are common to both default and filtered
// link hinting modes.
//
const createGeneralHintTests = (isFilteredMode) => {
  globalThis.vimiumOnClickAttributeName = "does-not-matter";

  context("Link hints", () => {
    setup(() => {
      initializeModeState();
      const testContent = "<a>test</a><a>tress</a>";
      document.getElementById("test-div").innerHTML = testContent;
      stubSettings("filterLinkHints", isFilteredMode);
      stubSettings("linkHintCharacters", "ab");
      stubSettings("linkHintNumbers", "12");
      stub(globalThis, "windowIsFocused", () => true);
    });

    teardown(() => document.getElementById("test-div").innerHTML = "");

    should("create hints when activated, discard them when deactivated", () => {
      const mode = activateLinkHintsMode();
      assert.isFalse(mode.containerEl == null);
      mode.deactivateMode();
      assert.isTrue(mode.containerEl == null);
    });

    should("replay buffered typing when hints finish loading", () => {
      let replayed = false;
      stub(HintCoordinator, "cacheAllKeydownEvents", {
        modeIsActive: false,
        replayKeydownEvents() {
          replayed = true;
        },
      });
      const mode = activateLinkHintsMode();
      mode.deactivateMode();
      assert.isTrue(replayed);
    });

    should("position items correctly", () => {
      const assertStartPosition = (element1, element2) => {
        assert.equal(element1.getClientRects()[0].left, element2.getClientRects()[0].left);
        assert.equal(element1.getClientRects()[0].top, element2.getClientRects()[0].top);
      };
      stub(document.body.style, "position", "static");
      let mode = activateLinkHintsMode();
      let markerEls = getHintMarkerEls();
      assertStartPosition(document.getElementsByTagName("a")[0], markerEls[0]);
      assertStartPosition(document.getElementsByTagName("a")[1], markerEls[1]);
      mode.deactivateMode();
      stub(document.body.style, "position", "relative");
      mode = activateLinkHintsMode();
      markerEls = getHintMarkerEls();
      assertStartPosition(document.getElementsByTagName("a")[0], markerEls[0]);
      assertStartPosition(document.getElementsByTagName("a")[1], markerEls[1]);
      mode.deactivateMode();
    });
  });
};

createGeneralHintTests(false);
createGeneralHintTests(true);

context("False positives in link-hint", () => {
  setup(() => {
    const testContent = '<span class="buttonWrapper">false positive<a>clickable</a></span>' +
      '<span class="buttonWrapper">clickable</span>';
    document.getElementById("test-div").innerHTML = testContent;
    stubSettings("filterLinkHints", true);
    stubSettings("linkHintNumbers", "12");
    stub(globalThis, "windowIsFocused", () => true);
  });

  teardown(() => document.getElementById("test-div").innerHTML = "");

  should("handle false positives", () => {
    const mode = activateLinkHintsMode();
    mode.deactivateMode();
    assert.equal(["clickable", "clickable"], mode.hintMarkers.map((m) => m.linkText));
  });
});

context("jsaction matching", () => {
  let element;

  setup(() => {
    stubSettings("filterLinkHints", true);
    const testContent = '<p id="test-paragraph">clickable</p>';
    document.getElementById("test-div").innerHTML = testContent;
    element = document.getElementById("test-paragraph");
  });

  teardown(() => document.getElementById("test-div").innerHTML = "");

  should("select jsaction elements", () => {
    for (const text of ["click:namespace.actionName", "namespace.actionName"]) {
      element.setAttribute("jsaction", text);
      const mode = activateLinkHintsMode();
      mode.deactivateMode();
      assert.equal(1, mode.hintMarkers.length);
      assert.equal("clickable", mode.hintMarkers[0].linkText);
      assert.equal(element, mode.hintMarkers[0].localHint.element);
    }
  });

  should("not select inactive jsaction elements", () => {
    const attributes = [
      "mousedown:namespace.actionName",
      "click:namespace._",
      "none",
      "namespace:_",
    ];
    for (const attribute of attributes) {
      element.setAttribute("jsaction", attribute);
      const linkHints = activateLinkHintsMode();
      const hintMarkers = getHintMarkerEls().filter((marker) => marker.linkText !== "Frame.");
      linkHints.deactivateMode();
      assert.equal(0, hintMarkers.length);
    }
  });
});

context("link hints for image maps", () => {
  setup(() => {
    const testContent = '<img usemap="#the-map" style="width: 50px; height: 50px">' +
      '<map name="the-map">' +
      '<area shape="rect" coords="0,0,20,50" href="#">' +
      '<area shape="rect" coords="0,30,30,50" href="#">' +
      "</area>";
    document.getElementById("test-div").innerHTML = testContent;
  });

  teardown(() => document.getElementById("test-div").innerHTML = "");

  should("generate a hint for each area in the image map", () => {
    const mode = activateLinkHintsMode();
    const markerEls = getHintMarkerEls();
    assert.equal(2, markerEls.length);
    mode.deactivateMode();
  });
});

const sendKeyboardEvent = (key, type, extra) => {
  if (type == null) type = "keydown";
  if (extra == null) extra = {};
  handlerStack.bubbleEvent(
    type,
    Object.assign(extra, {
      type,
      key,
      preventDefault() {},
      stopImmediatePropagation() {},
    }),
  );
};

const sendKeyboardEvents = (keys) => {
  for (const key of keys.split("")) {
    sendKeyboardEvent(key);
  }
};

context("Buffered keyboard events", () => {
  should("suppress keys during startup and replay them into the ready mode", () => {
    initializeModeState();
    const cache = new CacheAllKeydownEvents({ indicator: false });
    sendKeyboardEvents("m");
    cache.exit();
    assert.equal(null, commandName);
    cache.replayKeydownEvents();
    assert.equal("m", commandName);
  });
});

// TODO: For some reason, this test corrupts the state linkhints state for other tests, in particular,
// the alphabet hints tests. I haven't yet dug into why.
// const inputs = [];
// context("Test link hints for focusing input elements correctly", () => {
//   let linkHintsMode;

//   setup(() => {
//     let input;
//     initializeModeState();
//     const testDiv = document.getElementById("test-div");
//     testDiv.innerHTML = "";

//     stubSettings("filterLinkHints", false);
//     stubSettings("linkHintCharacters", "ab");

//     // Every HTML5 input type except for hidden. We should be able to activate all of them with link hints.
//     // NOTE: I'm not sure why, but "image" doesn't get a link hint in Puppeteer, so I've omitted it.
//     const inputTypes = ["button", "checkbox", "color", "date", "datetime", "datetime-local", "email", "file",
//       "month", "number", "password", "radio", "range", "reset", "search", "submit", "tel", "text",
//       "time", "url", "week"];

//     for (let type of inputTypes) {
//       input = document.createElement("input");
//       input.type = type;
//       testDiv.appendChild(input);
//       inputs.push(input);
//     }

//     // Manually add also a select element to test focus.
//     input = document.createElement("select");
//     testDiv.appendChild(input);
//     inputs.push(input);
//   });

//   teardown(() => {
//     document.getElementById("test-div").innerHTML = "";
//     // linkHintsMode.deactivateMode(); // TODO: I don't think this should be necessary.
//   });

//   should("Focus each input when its hint text is typed", () => {
//     for (var input of inputs) {
//       input.scrollIntoView(); // Ensure the element is visible so we create a link hint for it.

//       const activeListener = ensureCalled(function(event) {
//         if (event.type === "focus") { return input.blur(); }
//       });
//       input.addEventListener("focus", activeListener, false);
//       input.addEventListener("click", activeListener, false);

//       linkHintsMode = activateLinkHintsMode();
//       const [hint] = getHintMarkerEls().
//             filter(hint => input === HintCoordinator.getLocalHint(hint.hintDescriptor).element);

//       for (let char of hint.hintString)
//         sendKeyboardEvent(char);
//       linkHintsMode.deactivateMode();

//       input.removeEventListener("focus", activeListener, false);
//       input.removeEventListener("click", activeListener, false);
//     }
//   });
// });

context("Test link hints for changing mode", () => {
  let linkHints;

  setup(() => {
    initializeModeState();
    const testDiv = document.getElementById("test-div");
    testDiv.innerHTML = "<a>link</a>";
    linkHints = activateLinkHintsMode();
  });

  teardown(() => {
    document.getElementById("test-div").innerHTML = "";
    linkHints.deactivateMode();
  });

  should("change mode on shift", () => {
    assert.equal("open-in-current-tab", linkHints.mode.name);
    sendKeyboardEvent("Shift", "keydown");
    assert.equal("open-in-new-background-tab", linkHints.mode.name);
    sendKeyboardEvent("Shift", "keyup");
    assert.equal("open-in-current-tab", linkHints.mode.name);
  });
});

const createLinks = function (n) {
  for (let i = 0, end = n; i < end; i++) {
    const link = document.createElement("a");
    link.textContent = "test";
    document.getElementById("test-div").appendChild(link);
  }
};

context("Alphabet link hints", () => {
  let mode;
  setup(() => {
    initializeModeState();
    stubSettings("filterLinkHints", false);
    stubSettings("linkHintCharacters", "ab");
    stub(globalThis, "windowIsFocused", () => true);

    document.getElementById("test-div").innerHTML = "";
    // Three hints will trigger double hint chars.
    createLinks(3);
    mode = activateLinkHintsMode();
  });

  teardown(() => {
    mode.deactivateMode();
    document.getElementById("test-div").innerHTML = "";
  });

  should("label the hints correctly", () => {
    assert.equal(
      ["aa", "b", "ab"],
      mode.hintMarkers.map((m) => m.hintString),
    );
  });

  should("narrow the hints", () => {
    sendKeyboardEvent("a");
    assert.equal(
      ["", "none", ""],
      mode.hintMarkers.map((m) => m.element.style.display),
    );
  });

  should("generate the correct number of alphabet hints", () => {
    const alphabetHints = new AlphabetHints();
    for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      const hintStrings = alphabetHints.hintStrings(n);
      assert.equal(n, hintStrings.length);
    }
  });

  should("generate non-overlapping alphabet hints", () => {
    const alphabetHints = new AlphabetHints();
    for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      const hintStrings = alphabetHints.hintStrings(n);
      for (const h1 of hintStrings) {
        for (const h2 of hintStrings) {
          if (h1 !== h2) {
            assert.isFalse(0 === h1.indexOf(h2));
          }
        }
      }
    }
  });
});

context("Filtered link hints", () => {
  // In all of these tests, the order of the elements returned by getHintMarkerEls() may be
  // different from the order they are listed in the test HTML content. This is because
  // LinkHints.activateMode() sorts the elements.

  let mode;

  setup(() => {
    stubSettings("filterLinkHints", true);
    stubSettings("linkHintNumbers", "0123456789");
    stub(globalThis, "windowIsFocused", () => true);
  });

  context("Text hints", () => {
    setup(() => {
      initializeModeState();
      const testContent = "<a>test</a><a>tress</a><a>trait</a><a>track<img alt='alt text'/></a>";
      document.getElementById("test-div").innerHTML = testContent;
      mode = activateLinkHintsMode();
    });

    teardown(() => {
      document.getElementById("test-div").innerHTML = "";
      mode.deactivateMode();
    });

    should("label the hints", () => {
      const hintMarkers = getHintMarkerEls();
      const expectedMarkers = [1, 2, 3, 4].map((m) => m.toString());
      const actualMarkers = [0, 1, 2, 3].map((i) => hintMarkers[i].textContent.toLowerCase());
      assert.equal(expectedMarkers.length, actualMarkers.length);
      for (const marker of expectedMarkers) {
        assert.isTrue(actualMarkers.includes(marker));
      }
    });

    should("narrow the hints", () => {
      sendKeyboardEvent("t");
      sendKeyboardEvent("r");
      assert.equal(
        ["none", "", "", ""],
        mode.hintMarkers.map((m) => m.element.style.display),
      );
      assert.equal("3", mode.hintMarkers[1].hintString);
      sendKeyboardEvent("a");
      assert.equal("1", mode.hintMarkers[3].hintString);
    });

    // This test is the same as above, but with an extra non-matching character. The effect should
    // be the same.
    should("narrow the hints and ignore typing mistakes", () => {
      sendKeyboardEvent("t");
      sendKeyboardEvent("r");
      sendKeyboardEvent("x");
      assert.equal(
        ["none", "", "", ""],
        mode.hintMarkers.map((m) => m.element.style.display),
      );
      assert.equal("3", mode.hintMarkers[1].hintString);
      sendKeyboardEvent("a");
      assert.equal("1", mode.hintMarkers[3].hintString);
    });
  });

  context("Image hints", () => {
    setup(() => {
      initializeModeState();
      const testContent = "<a><img alt='alt text' width='10px' height='10px'/></a>" +
        "<a><img alt='alt text' title='some title' width='10px' height='10px'/></a>" +
        "<a><img title='some title' width='10px' height='10px'/></a>" +
        "<a><img src='' width='320px' height='100px'/></a>";
      document.getElementById("test-div").innerHTML = testContent;
      mode = activateLinkHintsMode();
    });

    teardown(() => {
      document.getElementById("test-div").innerHTML = "";
      mode.deactivateMode();
    });

    should("label the images", () => {
      let hintMarkers = getHintMarkerEls().map((m) => m.textContent.toLowerCase());
      // We don't know the actual hint numbers which will be assigned, so we replace them with "N".
      hintMarkers = hintMarkers.map((str) => str.replace(/^[1-4]/, "N"));
      assert.equal(4, hintMarkers.length);
      assert.isTrue(hintMarkers.includes("N: alt text"));
      assert.isTrue(hintMarkers.includes("N: some title"));
      assert.isTrue(hintMarkers.includes("N: alt text"));
      assert.isTrue(hintMarkers.includes("N"));
    });
  });

  context("Input hints", () => {
    setup(() => {
      initializeModeState();
      const testContent =
        `<input type='text' value='some value'/><input type='password' value='some value'/> \
<textarea>some text</textarea><label for='test-input'/>a label</label> \
<input type='text' id='test-input' value='some value'/> \
<label for='test-input-2'/>a label: </label><input type='text' id='test-input-2' value='some value'/>`;
      document.getElementById("test-div").innerHTML = testContent;
      mode = activateLinkHintsMode();
    });

    teardown(() => {
      document.getElementById("test-div").innerHTML = "";
      mode.deactivateMode();
    });

    should("label the input elements", () => {
      let hintMarkers = getHintMarkerEls();
      hintMarkers = getHintMarkerEls().map((m) => m.textContent.toLowerCase());
      // We don't know the actual hint numbers which will be assigned, so we replace them with "N".
      hintMarkers = hintMarkers.map((str) => str.replace(/^[0-9]+/, "N"));
      assert.equal(5, hintMarkers.length);
      assert.isTrue(hintMarkers.includes("N"));
      assert.isTrue(hintMarkers.includes("N"));
      assert.isTrue(hintMarkers.includes("N: a label"));
      assert.isTrue(hintMarkers.includes("N: a label"));
      assert.isTrue(hintMarkers.includes("N"));
    });
  });

  context("Text hint scoring", () => {
    let getActiveHintMarker;

    setup(() => {
      initializeModeState();
      const testContent = [
        { id: 0, text: "the xboy stood on the xburning deck" }, // Noise.
        { id: 1, text: "the boy stood on the xburning deck" }, // Whole word (boy).
        { id: 2, text: "on the xboy stood the xburning deck" }, // Start of text (on).
        { id: 3, text: "the xboy stood on the xburning deck" }, // Noise.
        { id: 4, text: "the xboy stood on the xburning deck" }, // Noise.
        { id: 5, text: "the xboy stood on the xburning" }, // Shortest text..
        { id: 6, text: "the xboy stood on the burning xdeck" }, // Start of word (bu)
        { id: 7, text: "test abc one - longer" }, // For tab test - 2.
        { id: 8, text: "test abc one" }, // For tab test - 1.
        { id: 9, text: "test abc one - longer still" }, // For tab test - 3.
      ].map(({ id, text }) => `<a id=\"${id}\">${text}</a>`).join(" ");
      document.getElementById("test-div").innerHTML = testContent;
      mode = activateLinkHintsMode();

      getActiveHintMarker = () => {
        return HintCoordinator.getLocalHint(
          mode.markerMatcher.activeHintMarker.hintDescriptor,
        ).element.id;
      };
    });

    teardown(() => {
      document.getElementById("test-div").innerHTML = "";
      mode.deactivateMode();
    });

    should("score start-of-word matches highly", () => {
      sendKeyboardEvents("bu");
      assert.equal("6", getActiveHintMarker());
    });

    should("score start-of-text matches highly (br)", () => {
      sendKeyboardEvents("on");
      assert.equal("2", getActiveHintMarker());
    });

    should("score whole-word matches highly", () => {
      sendKeyboardEvents("boy");
      assert.equal("1", getActiveHintMarker());
    });

    should("score shorter texts more highly", () => {
      sendKeyboardEvents("stood");
      assert.equal("5", getActiveHintMarker());
    });

    should("use tab to select the active hint", () => {
      sendKeyboardEvents("abc");
      assert.equal("8", getActiveHintMarker());
      sendKeyboardEvent("Tab", "keydown");
      assert.equal("7", getActiveHintMarker());
      sendKeyboardEvent("Tab", "keydown");
      assert.equal("9", getActiveHintMarker());
    });
  });
});

context("Input focus", () => {
  setup(() => {
    initializeModeState();
    const testContent = `<input type='text' id='first'/><input style='display:none;' id='second'/> \
<input type='password' id='third' value='some value'/>`;
    document.getElementById("test-div").innerHTML = testContent;
  });

  teardown(() => document.getElementById("test-div").innerHTML = ""),
    should("focus the first element", () => {
      NormalModeCommands.focusInput(1);
      assert.equal("first", document.activeElement.id);
    });

  should("focus the nth element", () => {
    NormalModeCommands.focusInput(100);
    assert.equal("third", document.activeElement.id);
  });

  should("activate insert mode on the first element", () => {
    NormalModeCommands.focusInput(1);
    assert.isTrue(InsertMode.permanentInstance.isActive());
  });

  should("activate insert mode on the first element", () => {
    NormalModeCommands.focusInput(100);
    assert.isTrue(InsertMode.permanentInstance.isActive());
  });

  should("activate the most recently-selected input if the count is 1", () => {
    NormalModeCommands.focusInput(3);
    NormalModeCommands.focusInput(1);
    assert.equal("third", document.activeElement.id);
  });

  should("not trigger insert if there are no inputs", () => {
    document.getElementById("test-div").innerHTML = "";
    NormalModeCommands.focusInput(1);
    assert.isFalse(InsertMode.permanentInstance.isActive());
  });
});

context("Key mapping", () => {
  let normalMode, handlerCalled, handlerCalledCount;

  setup(() => {
    normalMode = initializeModeState();
    handlerCalled = false;
    handlerCalledCount = 0;
    normalMode.setCommandHandler(({ count }) => {
      handlerCalled = true;
      handlerCalledCount = count;
    });
  });

  should("recognize first mapped key", () => {
    assert.isTrue(normalMode.isMappedKey("m"));
  });

  should("recognize second mapped key", () => {
    assert.isFalse(normalMode.isMappedKey("p"));
    sendKeyboardEvent("z");
    assert.isTrue(normalMode.isMappedKey("p"));
  });

  should("recognize pass keys", () => {
    assert.isTrue(normalMode.isPassKey("p"));
  });

  should("not mis-recognize pass keys", () => {
    assert.isFalse(normalMode.isMappedKey("p"));
    sendKeyboardEvent("z");
    assert.isTrue(normalMode.isMappedKey("p"));
  });

  should("set and call command handler", () => {
    sendKeyboardEvent("m");
    assert.isTrue(handlerCalled);
  });

  should("safely handle undefined key mapping without throwing", () => {
    normalMode.setKeyMapping(undefined);
    assert.isFalse(normalMode.isMappedKey("m"));
    sendKeyboardEvent("m");
  });

  should("not call command handler for pass keys", () => {
    sendKeyboardEvent("p");
    assert.isFalse(handlerCalled);
  });

  should("cancel a key prefix", () => {
    sendKeyboardEvent("z");
    assert.equal(false, handlerCalled);
    sendKeyboardEvent("m");
    assert.equal(true, handlerCalled);
  });

  should("cancel a prefix key on escape", () => {
    sendKeyboardEvent("z");
    sendKeyboardEvent("Escape", "keydown");
    sendKeyboardEvent("p");
    assert.equal(0, handlerCalledCount);
  });
});

context("Normal mode", () => {
  setup(() => initializeModeState());

  should("invoke commands for mapped keys", () => {
    sendKeyboardEvent("m");
    assert.equal("m", commandName);
  });

  should("invoke commands for mapped keys with a mapped prefix", () => {
    sendKeyboardEvent("z");
    sendKeyboardEvent("m");
    assert.equal("m", commandName);
  });

  should("invoke commands for mapped keys with an unmapped prefix", () => {
    sendKeyboardEvent("a");
    sendKeyboardEvent("m");
    assert.equal("m", commandName);
  });

  should("not invoke commands for pass keys", () => {
    sendKeyboardEvent("p");
    assert.equal(null, commandName);
  });

  should("not invoke commands for pass keys with an unmapped prefix", () => {
    sendKeyboardEvent("a");
    sendKeyboardEvent("p");
    assert.equal(null, commandName);
  });

  should("invoke commands for pass keys with a key queue", () => {
    sendKeyboardEvent("z");
    sendKeyboardEvent("p");
    assert.equal("zp", commandName);
  });

  should("not treat digits as a count prefix", () => {
    sendKeyboardEvent("2");
    sendKeyboardEvent("m");
    assert.equal("m", commandName);
    assert.equal(1, commandCount);
  });

  should("not handle unmapped keys", () => {
    sendKeyboardEvent("u");
    assert.equal(null, commandCount);
  });
});

context("Insert mode", () => {
  let insertMode;

  setup(() => {
    initializeModeState();
    insertMode = new InsertMode({ global: true });
  });

  should("exit on escape", () => {
    assert.isTrue(insertMode.modeIsActive);
    sendKeyboardEvent("Escape", "keydown");
    assert.isFalse(insertMode.modeIsActive);
  });

  should("resume normal mode after leaving insert mode", () => {
    assert.equal(null, commandName);
    insertMode.exit();
    sendKeyboardEvent("m");
    assert.equal("m", commandName);
  });
});

context("Triggering insert mode", () => {
  setup(() => {
    initializeModeState();

    const testContent = `<input type='text' id='first'/> \
<input style='display:none;' id='second'/> \
<input type='password' id='third' value='some value'/> \
<p id='fourth' contenteditable='true'/> \
<p id='fifth'/>`;
    document.getElementById("test-div").innerHTML = testContent;
  });

  teardown(() => {
    if (document.activeElement != null) {
      document.activeElement.blur();
    }
    document.getElementById("test-div").innerHTML = "";
  });

  should("trigger insert mode on focus of text input", () => {
    assert.isFalse(InsertMode.permanentInstance.isActive());
    document.getElementById("first").focus();
    assert.isTrue(InsertMode.permanentInstance.isActive());
  });

  should("trigger insert mode on focus of password input", () => {
    assert.isFalse(InsertMode.permanentInstance.isActive());
    document.getElementById("third").focus();
    assert.isTrue(InsertMode.permanentInstance.isActive());
  });

  should("trigger insert mode on focus of contentEditable elements", () => {
    assert.isFalse(InsertMode.permanentInstance.isActive());
    document.getElementById("fourth").focus();
    assert.isTrue(InsertMode.permanentInstance.isActive());
  });

  should("not trigger insert mode on other elements", () => {
    assert.isFalse(InsertMode.permanentInstance.isActive());
    document.getElementById("fifth").focus();
    assert.isFalse(InsertMode.permanentInstance.isActive());
  });
});

const createMode = (options) => {
  const mode = new Mode();
  mode.init(options);
  return mode;
};

context("Mode utilities", () => {
  setup(() => {
    initializeModeState();

    const testContent = `<input type='text' id='first'/> \
<input style='display:none;' id='second'/> \
<input type='password' id='third' value='some value'/>`;
    document.getElementById("test-div").innerHTML = testContent;
  });

  teardown(() => document.getElementById("test-div").innerHTML = "");

  should("not have duplicate singletons", () => {
    let mode;
    let count = 0;
    class Test extends Mode {
      constructor() {
        count += 1;
        super();
        super.init({ singleton: "test" });
      }
      exit() {
        count -= 1;
        return super.exit();
      }
    }
    assert.isTrue(count === 0);
    for (let i = 1; i <= 10; i++) {
      mode = new Test();
      assert.isTrue(count === 1);
    }
    mode.exit();
    assert.isTrue(count === 0);
  });

  should("exit on escape", () => {
    const test = createMode({ exitOnEscape: true });
    assert.isTrue(test.modeIsActive);
    sendKeyboardEvent("Escape", "keydown");
    assert.isFalse(test.modeIsActive);
  });

  should("not exit on escape if not enabled", () => {
    const test = createMode({ exitOnEscape: false });
    assert.isTrue(test.modeIsActive);
    sendKeyboardEvent("Escape", "keydown");
    assert.isTrue(test.modeIsActive);
  });

  should("exit on blur", () => {
    const element = document.getElementById("first");
    element.focus();
    const test = createMode({ exitOnBlur: element });
    assert.isTrue(test.modeIsActive);
    element.blur();
    assert.isFalse(test.modeIsActive);
  });

  should("not exit on blur if not enabled", () => {
    const element = document.getElementById("first");
    element.focus();
    const test = createMode({ exitOnBlur: false });
    assert.isTrue(test.modeIsActive);
    element.blur();
    assert.isTrue(test.modeIsActive);
  });
});

context("FindMode rendered text", () => {
  let fixture;
  setup(() => {
    initializeModeState();
    fixture = document.getElementById("test-div");
    fixture.innerHTML = "";
    globalThis.getSelection().removeAllRanges();
    stub(FindMode, "query", null);
  });
  teardown(() => {
    fixture.innerHTML = "";
    globalThis.getSelection().removeAllRanges();
  });

  should("highlight and cycle phrases across inline formatting in both directions", () => {
    fixture.innerHTML = "<p>Hello <b>world</b> and Hello <i>world</i></p>";
    assert.equal(2, FindMode.updateQuery("Hello world"));
    assert.isTrue(FindMode.execute("Hello world", { colorSelection: false }));
    assert.equal("Hello world", globalThis.getSelection().toString());
    assert.equal(
      fixture.querySelector("b").firstChild,
      FindMode.query.matches[0].range.endContainer,
    );
    for (const [backwards, expected] of [[false, 1], [false, 0], [true, 1]]) {
      const query = FindMode.getNextQueryFromRegexMatches(backwards);
      assert.isTrue(FindMode.execute(query, { colorSelection: false }));
      assert.equal(expected, FindMode.query.activeMatchIndex);
      assert.equal("Hello world", globalThis.getSelection().toString());
    }
  });

  should("include text in elements styled with display contents through a class", () => {
    fixture.innerHTML =
      '<style>.find-contents{display:contents}</style><p class="find-contents"><span>contentsneedle</span></p>';
    assert.equal(1, FindMode.updateQuery("contentsneedle"));
    assert.isTrue(FindMode.execute("contentsneedle", { colorSelection: false }));
    assert.equal("contentsneedle", globalThis.getSelection().toString());
  });

  should("refresh repeat searches after matches are replaced or added", () => {
    stub(FindModeHistory, "getQuery", () => "dynamicneedle");
    fixture.innerHTML = "<p>dynamicneedle old</p><p>dynamicneedle old</p>";
    FindMode.updateQuery("dynamicneedle");
    FindMode.execute("dynamicneedle", { colorSelection: false });
    fixture.innerHTML = "<p>replacement</p><p>dynamicneedle new</p>";
    FindMode.findNext(false);
    assert.equal("dynamicneedle", getSelection().toString());
    assert.equal("dynamicneedle new", getSelection().anchorNode.parentElement.textContent);
    assert.equal(1, FindMode.query.matchCount);
    fixture.insertAdjacentHTML("beforeend", "<p>dynamicneedle appended</p>");
    FindMode.findNext(false);
    assert.equal("dynamicneedle appended", getSelection().anchorNode.parentElement.textContent);
    FindMode.findNext(true);
    assert.equal("dynamicneedle new", getSelection().anchorNode.parentElement.textContent);
    fixture.innerHTML = "<p>no matching text</p>";
    const messages = [];
    stub(HUD, "show", (text) => messages.push(text));
    FindMode.findNext(false);
    assert.isFalse(!!FindMode.query.hasResults);
    assert.equal(["No matches for 'dynamicneedle'"], messages);
  });

  should("resume saved searches in either direction without skipping the first match", () => {
    stub(FindModeHistory, "getQuery", () => "savedneedle");
    fixture.innerHTML = "<p>savedneedle first</p><p>savedneedle last</p>";
    FindMode.findNext(false);
    assert.equal("savedneedle first", getSelection().anchorNode.parentElement.textContent);
    FindMode.findNext(false);
    assert.equal("savedneedle last", getSelection().anchorNode.parentElement.textContent);
    FindMode.query = null;
    getSelection().removeAllRanges();
    FindMode.findNext(true);
    assert.equal("savedneedle last", getSelection().anchorNode.parentElement.textContent);
  });

  should("collapse rendered whitespace across nodes but preserve preformatted spacing", () => {
    fixture.innerHTML = "<p>hello\n    <b> \tworld</b> again</p>" +
      '<pre>hello\n    world</pre><p style="white-space:pre-wrap">hello  world</p>';
    assert.equal(1, FindMode.updateQuery("hello world"));
    assert.isTrue(FindMode.execute("hello world", { colorSelection: false }));
    assert.equal("hello world", getSelection().toString());
    assert.equal(
      fixture.querySelector("b").firstChild,
      FindMode.query.matches[0].range.endContainer,
    );
    assert.equal(7, FindMode.query.matches[0].range.endOffset);
    assert.equal(1, FindMode.updateQuery("hello  world"));
    assert.equal(1, FindMode.updateQuery("hello\n    world"));
  });

  should("reveal a match inside nested scrolling panes on both axes", () => {
    fixture.innerHTML = '<div style="width:180px;height:120px;overflow:auto">' +
      '<div style="padding:300px;width:250px"><div style="width:200px;height:100px;overflow:auto">' +
      '<div style="height:1000px;width:2000px"></div><span style="margin-left:1000px">paneneedle</span>' +
      "</div></div></div>";
    const outer = fixture.firstElementChild;
    const inner = outer.firstElementChild.firstElementChild;
    FindMode.updateQuery("paneneedle");
    FindMode.execute("paneneedle", { colorSelection: false });
    const rect = getSelection().getRangeAt(0).getBoundingClientRect();
    for (const pane of [inner, outer]) {
      const bounds = pane.getBoundingClientRect();
      assert.isTrue(pane.scrollTop > 0);
      assert.isTrue(pane.scrollLeft > 0);
      assert.isTrue(rect.top >= bounds.top && rect.bottom <= bounds.bottom);
      assert.isTrue(rect.left >= bounds.left && rect.right <= bounds.right);
    }
  });

  should("repeat searches and scroll matches inside open shadow roots", () => {
    stub(FindModeHistory, "getQuery", () => "shadowrepeat");
    const host = document.createElement("section");
    fixture.append(host);
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = '<div style="height:100px;overflow:auto"><p>shadowrepeat first</p>' +
      '<div style="height:1000px"></div><p>shadowrepeat last</p></div>';
    FindMode.findNext(false);
    assert.equal(0, FindMode.query.activeMatchIndex);
    FindMode.findNext(false);
    assert.equal(1, FindMode.query.activeMatchIndex);
    assert.isTrue(root.firstElementChild.scrollTop > 0);
    FindMode.findNext(true);
    assert.equal(0, FindMode.query.activeMatchIndex);
    assert.equal(0, root.firstElementChild.scrollTop);
  });

  should("scroll the host when matching text directly inside a shadow root", () => {
    const host = document.createElement("section");
    host.style.cssText = "height:100px;overflow:auto";
    fixture.append(host);
    host.attachShadow({ mode: "open" }).innerHTML =
      '<div style="height:1000px"></div>directshadowneedle';
    FindMode.updateQuery("directshadowneedle");
    FindMode.execute("directshadowneedle", { colorSelection: false });
    assert.isTrue(host.scrollTop > 0);
  });

  should("search and highlight formatted text inside open shadow roots", () => {
    const host = document.createElement("section");
    fixture.append(host);
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = "<p>shadow <b>needle</b></p>";
    assert.equal(1, FindMode.updateQuery("shadow needle"));
    assert.equal(root, FindMode.query.matches[0].range.startContainer.getRootNode());
    assert.isTrue(FindMode.execute("shadow needle", { colorSelection: false }));
    assert.equal("shadow needle", globalThis.getSelection().toString());
  });

  should("visit slotted text once and exclude unassigned light DOM", () => {
    const host = document.createElement("section");
    host.innerHTML = '<span slot="visible">slotneedle</span><span>unassignedneedle</span>';
    fixture.append(host);
    host.attachShadow({ mode: "open" }).innerHTML = '<slot name="visible"></slot>';
    assert.equal(1, FindMode.updateQuery("slotneedle"));
    assert.equal(0, FindMode.updateQuery("unassignedneedle"));
  });

  should("preserve match order and selection proximity across shadow roots", () => {
    fixture.innerHTML = "<p>repeatneedle</p><section></section><p>repeatneedle</p>";
    const root = fixture.querySelector("section").attachShadow({ mode: "open" });
    root.innerHTML = "<p>repeatneedle</p>";
    assert.equal(3, FindMode.updateQuery("repeatneedle"));
    for (let i = 0; i < 3; i++) {
      assert.isTrue(FindMode.execute("repeatneedle", { colorSelection: false }));
      assert.equal("repeatneedle", globalThis.getSelection().toString());
      assert.equal(
        i === 1 ? root : document,
        FindMode.query.matches[i].range.startContainer.getRootNode(),
      );
      FindMode.updateQuery("repeatneedle");
      assert.equal(i, FindMode.query.activeMatchIndex);
      FindMode.getNextQueryFromRegexMatches(false);
    }
    assert.equal(0, FindMode.query.activeMatchIndex);
  });

  should("not invent matches across block elements or line breaks", () => {
    fixture.innerHTML = "<p>left</p><p>right</p><span>left</span><br><span>right</span>";
    assert.equal(0, FindMode.updateQuery("leftright"));
  });

  should("skip hidden text and include children that restore visibility", () => {
    fixture.innerHTML = '<p style="display:none">hiddenneedle</p>' +
      '<p style="visibility:hidden">hiddenneedle<span style="visibility:visible">visibleneedle</span></p>';
    assert.equal(0, FindMode.updateQuery("hiddenneedle"));
    assert.equal(1, FindMode.updateQuery("visibleneedle"));
  });

  should("keep literal matching and smartcase and handle an empty query", () => {
    fixture.innerHTML = "<p>needle.*[x] Needle.*[x]</p>";
    assert.equal(2, FindMode.updateQuery("needle.*[x]"));
    assert.equal(1, FindMode.updateQuery("Needle.*[x]"));
    assert.equal(0, FindMode.updateQuery(""));
    assert.isFalse(FindMode.execute("", { colorSelection: false }));
  });
});

context("PostFindMode", () => {
  let postFindMode;

  setup(() => {
    initializeModeState();
    const testContent = "<input type='text' id='first'/>";
    document.getElementById("test-div").innerHTML = testContent;
    document.getElementById("first").focus();
    postFindMode = new PostFindMode();
  });

  teardown(() => document.getElementById("test-div").innerHTML = ""),
    should("be a singleton", () => {
      assert.isTrue(postFindMode.modeIsActive);
      new PostFindMode();
      assert.isFalse(postFindMode.modeIsActive);
    });

  should("suppress unmapped printable keys", () => {
    sendKeyboardEvent("a");
    assert.equal(null, commandCount);
  });

  should("be deactivated on click events", () => {
    handlerStack.bubbleEvent("click", { target: document.activeElement });
    assert.isFalse(postFindMode.modeIsActive);
  });

  should("enter insert mode on immediate escape", () => {
    sendKeyboardEvent("Escape", "keydown");
    assert.equal(null, commandCount);
    assert.isFalse(postFindMode.modeIsActive);
  });

  should("return to normal browsing on subsequent escapes", () => {
    sendKeyboardEvent("a");
    sendKeyboardEvent("Escape", "keydown");
    assert.isFalse(postFindMode.modeIsActive);
    assert.isFalse(InsertMode.permanentInstance.isActive());
    sendKeyboardEvent("m");
    assert.equal("m", commandName);
  });
});

context("LinkHintsMode confirmation", () => {
  let exitIsSuccess;

  setup(() => {
    initializeModeState();
    document.getElementById("test-div").innerHTML = "<a>test</a><a>tress</a>";
    stubSettings("filterLinkHints", true);
    stub(globalThis, "windowIsFocused", () => true);
    exitIsSuccess = "not called";
    HintCoordinator.onExit = [(isSuccess) => exitIsSuccess = isSuccess];
  });

  teardown(() => {
    if (HintCoordinator.linkHintsMode != null) {
      HintCoordinator.exit({ isSuccess: false });
    }
    document.getElementById("test-div").innerHTML = "";
  });

  context("waitForEnterForFilteredHints", () => {
    let mode;

    setup(() => {
      stubSettings("waitForEnterForFilteredHints", true);
      mode = activateLinkHintsMode();
      sendKeyboardEvent("t");
      sendKeyboardEvent("e"); // Uniquely matches "test"; "tress" doesn't start with "te".
    });

    should("show the confirmation indicator, not the regular mode indicator", () => {
      assert.equal("Hit <Enter> to proceed...", mode.hintMode.options.indicator);
    });

    should("confirm successfully on Enter", () => {
      sendKeyboardEvent("Enter", "keydown");
      assert.equal(true, exitIsSuccess);
    });

    should("cancel on Escape", () => {
      sendKeyboardEvent("Escape", "keydown");
      assert.equal(false, exitIsSuccess);
    });

    should("not exit on other keyboard events", () => {
      sendKeyboardEvents("xyz");
      assert.equal("not called", exitIsSuccess);
    });
  });

  context("timeout variant (waitForEnterForFilteredHints off)", () => {
    setup(() => {
      stubSettings("waitForEnterForFilteredHints", false);
      // Fire the confirmation delay immediately, rather than waiting on a real 200ms timer.
      stub(Utils, "setTimeout", (_delay, fn) => fn());
      activateLinkHintsMode();
    });

    should("confirm successfully once the user stops typing", () => {
      sendKeyboardEvent("t");
      sendKeyboardEvent("e"); // Uniquely matches "test"; the (stubbed, immediate) timer then fires.
      assert.equal(true, exitIsSuccess);
    });
  });
});

context("GrabBackFocus", () => {
  setup(() => {
    const testContent = "<input type='text' value='some value' id='input'/>";
    document.getElementById("test-div").innerHTML = testContent;
    stubSettings("grabBackFocus", true);
  });

  teardown(() => document.getElementById("test-div").innerHTML = ""),
    should("blur an already focused input", () => {
      document.getElementById("input").focus();
      assert.isTrue(document.activeElement);
      assert.isTrue(DomUtils.isEditable(document.activeElement));
      initializeModeState();
      assert.isTrue(document.activeElement);
      assert.isFalse(DomUtils.isEditable(document.activeElement));
    });

  should("blur a newly focused input", () => {
    initializeModeState();
    document.getElementById("input").focus();
    assert.isTrue(document.activeElement);
    assert.isFalse(DomUtils.isEditable(document.activeElement));
  });

  should("exit on a key event", () => {
    initializeModeState();
    sendKeyboardEvent("a");
    document.getElementById("input").focus();
    assert.isTrue(document.activeElement);
    assert.isTrue(DomUtils.isEditable(document.activeElement));
  });

  should("exit on a mousedown event", () => {
    initializeModeState();
    handlerStack.bubbleEvent("mousedown", { target: document.body });
    document.getElementById("input").focus();
    assert.isTrue(document.activeElement);
    assert.isTrue(DomUtils.isEditable(document.activeElement));
  });
});
