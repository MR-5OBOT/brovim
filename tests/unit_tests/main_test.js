import "./test_helper.js";
import { withPromise } from "./test_helper.js";
import "../../lib/settings.js";
import "../../background_scripts/main.js";
import * as bgUtils from "../../background_scripts/bg_utils.js";

context("search destination", () => {
  should("search in the source tab after it loses the focus", async () => {
    let info;
    stub(chrome.search, "query", (query) => info = query);
    await sendRequestHandlers.launchSearchQuery({ query: "search words", tabId: 42 });
    assert.equal({ text: "search words", tabId: 42 }, info);
  });

  should("create new search tabs beside the source tab in its window", async () => {
    let config, info;
    stub(chrome.tabs, "create", (details) => {
      config = details;
      return Promise.resolve({ id: 88 });
    });
    stub(chrome.search, "query", (query) => info = query);
    await sendRequestHandlers.launchSearchQuery({
      query: "search words",
      openInNewTab: true,
      tab: { id: 42, windowId: 7, index: 3 },
    });
    assert.equal(7, config.windowId);
    assert.equal(4, config.index);
    assert.equal({ text: "search words", tabId: 88 }, info);
  });
});

context("Alt+X", () => {
  should("close one tab per press, however long the browser repeats a held key", async () => {
    let now = 100_000;
    stub(performance, "now", () => now);
    const tab = { id: 7, index: 0, windowId: 1, active: true, pinned: false };
    stub(chrome.tabs, "query", () => Promise.resolve([tab]));
    const closed = [];
    stub(chrome.tabs, "remove", (id) => closed.push(id));
    const press = async (ms) => {
      now += ms;
      await closeTab(tab);
    };
    // Held: the press, the browser's pause, then its repeats.
    await press(0);
    await press(660);
    await press(40);
    await press(40);
    assert.equal(1, closed.length);
    // A page saw the key go up: the next press is a new one, however soon it comes.
    sendRequestHandlers.shortcutKeyReleased();
    await press(120);
    assert.equal(2, closed.length);
    // No page could see the release (a PDF, say): a quiet second ends the press.
    await press(1100);
    assert.equal(3, closed.length);
  });
});

context("Closing tabs", () => {
  should("close the tab itself, in its own window, and nothing if it has gone", async () => {
    const queries = [];
    let windowTabs;
    stub(chrome.tabs, "query", (query) => {
      queries.push(query);
      return Promise.resolve(windowTabs);
    });
    const closed = [];
    stub(chrome.tabs, "remove", (id) => closed.push(id));
    // The tab moved since the command's snapshot of it.
    windowTabs = [{ id: 5, index: 0, windowId: 2 }, { id: 6, index: 1, windowId: 2 }];
    await BackgroundCommands.removeTab({ count: 1, tab: { id: 5, index: 1, windowId: 2 } });
    assert.equal([5], closed);
    assert.equal(2, queries[0].windowId);
    windowTabs = [{ id: 6, index: 0, windowId: 2 }];
    await BackgroundCommands.removeTab({ count: 1, tab: { id: 5, index: 0, windowId: 2 } });
    assert.equal([5], closed);
  });

  should("go back to the last visited tab, not the neighbour", async () => {
    const x = { id: 1, index: 0, windowId: 2, active: true };
    const tabs = [x, { id: 2, index: 1, windowId: 2 }, { id: 3, index: 2, windowId: 2 }];
    stub(chrome.tabs, "query", () => Promise.resolve(tabs));
    await bgUtils.tabRecency.init();
    for (const id of [2, 3, 1]) bgUtils.tabRecency.register(id); // neighbour, YouTube, x.com
    const calls = [];
    stub(chrome.tabs, "update", (id) => calls.push(["show", id]) && Promise.resolve());
    stub(chrome.tabs, "remove", (id) => calls.push(["close", id]));
    await BackgroundCommands.removeTab({ count: 1, tab: x });
    assert.equal([["show", 3], ["close", 1]], calls);
  });
});

context("Mute tab groups", () => {
  let tabs;

  setup(() => {
    tabs = [
      { id: 1, audible: true, mutedInfo: { muted: false } },
      { id: 2, audible: true, mutedInfo: { muted: false } },
      { id: 3, audible: false, mutedInfo: { muted: true } },
      { id: 4, audible: false, mutedInfo: { muted: false } },
    ];
    stub(chrome.tabs, "query", (query, callback) => {
      callback(tabs.filter((tab) => query.audible == null || tab.audible === query.audible));
    });
    stub(chrome.tabs, "update", (id, { muted }) => {
      tabs.find((tab) => tab.id === id).mutedInfo.muted = muted;
    });
    stub(chrome.tabs, "sendMessage", () => Promise.resolve());
  });

  should("unmute all muted tabs when playback stops after muting the group", () => {
    const request = { tab: tabs[0], tabId: 1, registryEntry: { options: { all: true } } };
    BackgroundCommands.toggleMuteTab(request, { frameId: 0 });
    assert.equal([true, true, true, false], tabs.map((tab) => tab.mutedInfo.muted));
    for (const tab of tabs) tab.audible = false;
    BackgroundCommands.toggleMuteTab(request, { frameId: 0 });
    assert.equal([false, false, false, false], tabs.map((tab) => tab.mutedInfo.muted));
  });

  should("toggle other tabs while preserving the current tab's mute state", () => {
    const request = { tab: tabs[0], tabId: 1, registryEntry: { options: { other: true } } };
    BackgroundCommands.toggleMuteTab(request, { frameId: 0 });
    assert.equal([false, true, true, false], tabs.map((tab) => tab.mutedInfo.muted));
    BackgroundCommands.toggleMuteTab(request, { frameId: 0 });
    assert.equal([false, false, false, false], tabs.map((tab) => tab.mutedInfo.muted));
  });

  should("send each mute notification only to the requesting frame", () => {
    const routes = [];
    stub(chrome.tabs, "sendMessage", (id, message, options) => {
      routes.push({ id, handler: message.handler, options });
      return Promise.resolve();
    });
    for (const options of [{}, { all: true }, { other: true }]) {
      const request = { tab: tabs[0], tabId: 1, registryEntry: { options } };
      BackgroundCommands.toggleMuteTab(request, { frameId: 7 });
      BackgroundCommands.toggleMuteTab(request, { frameId: 7 });
    }
    assert.equal(
      Array(6).fill({ id: 1, handler: "showMessage", options: { frameId: 7 } }),
      routes,
    );
  });
});

context("HintCoordinator", () => {
  should("cancel hint collection across frames without displaying late hints", async () => {
    let resolveDescriptors, collectionStarted;
    const descriptors = new Promise((resolve) => resolveDescriptors = resolve);
    const started = new Promise((resolve) => collectionStarted = resolve);
    const activated = [];
    stub(chrome.webNavigation, "getAllFrames", () => [{ frameId: 0 }, { frameId: 1 }]);
    stub(chrome.tabs, "sendMessage", (_tabId, message) => {
      if (message.messageType === "getHintDescriptors") {
        collectionStarted();
        return descriptors;
      }
      if (message.messageType === "activateMode") activated.push(message);
      return Promise.resolve();
    });
    const collecting = HintCoordinator.prepareToActivateLinkHintsMode(0, 0, { modeIndex: 0 });
    await started;
    HintCoordinator.broadcastLinkHintsMessage({ messageType: "exit" }, { tab: { id: 0 } });
    resolveDescriptors([]);
    await collecting;
    assert.equal([], activated);
  });

  should(
    "not wait seconds for a busy embedded frame once the key frames have answered",
    async () => {
      const activated = [];
      stub(chrome.webNavigation, "getAllFrames", () => [0, 1, 2].map((frameId) => ({ frameId })));
      stub(chrome.tabs, "sendMessage", (_tabId, message, { frameId }) => {
        if (message.messageType === "getHintDescriptors") {
          // Frame 1 is an ad still loading, too busy to answer.
          return frameId === 1 ? new Promise(() => {}) : Promise.resolve([{ frameId }]);
        }
        if (message.messageType === "activateMode") activated.push(frameId);
        return Promise.resolve();
      });
      const start = Date.now();
      await HintCoordinator.prepareToActivateLinkHintsMode(0, 0, { modeIndex: 0 });
      assert.isTrue(Date.now() - start < 1000);
      assert.equal([0, 2], activated);
    },
  );

  should("prepareToActivateLinkHintsMode", async () => {
    let receivedMessages = [];
    const frameIdToHintDescriptors = {
      "0": { frameId: 0, localIndex: 123, linkText: null },
      "1": { frameId: 1, localIndex: 456, linkText: null },
    };

    stub(chrome.webNavigation, "getAllFrames", () => [{ frameId: 0 }, { frameId: 1 }]);

    stub(
      chrome.tabs,
      "sendMessage",
      withPromise((_tabId, message, options) => {
        if (message.messageType == "getHintDescriptors") {
          return frameIdToHintDescriptors[options.frameId];
        } else if (message.messageType == "activateMode") {
          receivedMessages.push(message);
        }
      }),
    );

    await HintCoordinator.prepareToActivateLinkHintsMode(0, 0, {
      modeIndex: 0,
      requestedByHelpDialog: false,
    });

    receivedMessages = receivedMessages.map(
      ({ frameId, frameIdToHintDescriptors }) => ({ frameId, frameIdToHintDescriptors }),
    );

    // Each frame should receive only the hint descriptors from the other frames.
    assert.equal([
      { frameId: 0, frameIdToHintDescriptors: { "1": frameIdToHintDescriptors[1] } },
      { frameId: 1, frameIdToHintDescriptors: { "0": frameIdToHintDescriptors[0] } },
    ], receivedMessages);
  });
});

context("Next zoom level", () => {
  // All these tests use the Chrome zoom levels, which are the default.
  should("Zoom in 0 times", async () => {
    const zoom = await nextZoomLevel(1.00, 0);
    assert.equal(1.00, zoom);
  });

  should("Zoom in 1", async () => {
    const zoom = await nextZoomLevel(1.00, 1);
    assert.equal(1.10, zoom);
  });

  should("Zoom out 1", async () => {
    const zoom = await nextZoomLevel(1.00, -1);
    assert.equal(0.90, zoom);
  });

  should("Zoom in 2", async () => {
    const zoom = await nextZoomLevel(1.00, 2);
    assert.equal(1.25, zoom);
  });

  should("Zoom out 2", async () => {
    const zoom = await nextZoomLevel(1.00, -2);
    assert.equal(0.80, zoom);
  });

  should("Zoom in from between values", async () => {
    const zoom = await nextZoomLevel(1.05, 1);
    assert.equal(1.10, zoom);
  });

  should("Zoom out from between values", async () => {
    const zoom = await nextZoomLevel(1.05, -1);
    assert.equal(1.00, zoom);
  });

  should("Zoom in past the maximum", async () => {
    const zoom = await nextZoomLevel(1.00, 15);
    assert.equal(5.00, zoom);
  });

  should("Zoom out past the minimum", async () => {
    const zoom = await nextZoomLevel(1.00, -15);
    assert.equal(0.25, zoom);
  });

  should("Zoom in from below the minimum", async () => {
    const lowZoom = 0.01; // Lowest non-broken Chrome zoom level
    const zoom = await nextZoomLevel(lowZoom, 1);
    assert.equal(0.25, zoom);
  });

  should("Zoom out from above the maximum", async () => {
    const highZoom = 9.99; // highest non-broken Chrome zoom level
    const zoom = await nextZoomLevel(highZoom, -1);
    assert.equal(5.00, zoom);
  });

  should("Zoom in from above the maximum", async () => {
    const highZoom = 9.99; // highest non-broken Chrome zoom level
    const zoom = await nextZoomLevel(highZoom, 1);
    assert.equal(5.00, zoom);
  });

  should("Zoom out from below the minimum", async () => {
    const lowZoom = 0.01; // lowest non-broken Chrome zoom level
    const zoom = await nextZoomLevel(lowZoom, -1);
    assert.equal(0.25, zoom);
  });

  should("Test Chrome 33% zoom in with float error", async () => {
    const floatZoom = 0.32999999999999996; // The value chrome actually gives for 33%.
    const zoom = await nextZoomLevel(floatZoom, 1);
    assert.equal(0.50, zoom);
  });

  should("Test Chrome 175% zoom in with float error", async () => {
    const floatZoom = 1.7499999999999998; // The value chrome actually gives for 175%.
    const zoom = await nextZoomLevel(floatZoom, 1);
    assert.equal(2.00, zoom);
  });
});

context("majorVersionHasIncreased", () => {
  should("return whether the major version has changed", () => {
    assert.equal(false, majorVersionHasIncreased(null));
    shoulda.stub(Utils, "getCurrentVersion", () => "2.0.1");
    assert.equal(false, majorVersionHasIncreased("2.0.0"));
    shoulda.stub(Utils, "getCurrentVersion", () => "2.1.0");
    assert.equal(true, majorVersionHasIncreased("2.0.0"));
  });
});
