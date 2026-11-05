import "./test_helper.js";
import "../../tests/unit_tests/test_chrome_stubs.js";
import "../../content_scripts/mode.js";
import "../../content_scripts/ui_component.js";
import "../../content_scripts/tab_switcher.js";
import "../../background_scripts/main.js";
import * as bgUtils from "../../background_scripts/bg_utils.js";
import {
  captureThumbnail,
  findThumbnails,
  pageKey,
  storeThumbnail,
  trimThumbnailCaches,
} from "../../background_scripts/thumbnails.js";
import * as Thumbnails from "../../background_scripts/thumbnails.js";
import * as SwitcherCommands from "../../background_scripts/tab_switcher.js";
import { getRecentTabs, getSwitcherTabs } from "../../background_scripts/recent_tabs.js";
import { selectTabSwitcherCards } from "../../lib/tab_switcher.js";

context("configured switcher shortcut", () => {
  should(
    "reserve first-page space for old pinned tabs without changing the quick-swap pair",
    () => {
      const tabs = Array.from({ length: 24 }, (_, index) => ({
        id: index,
        index,
        active: index === 0,
        pinned: index >= 21,
        discarded: index === 21,
        frozen: index === 22,
      }));
      const cards = selectTabSwitcherCards(tabs, 18);
      assert.equal(18, cards.length);
      // Pins (even sleeping ones) take the first cells, then the current/previous pair.
      assert.equal([21, 22, 23, 0, 1], cards.slice(0, 5).map((tab) => tab.id));
    },
  );
  for (const order of ["mru", "tabstrip"]) {
    should(`keep every pinned tab beyond the card limit in ${order} order`, async () => {
      await Settings.onLoaded();
      const previousOrder = Settings.get("tabSwitcherOrder");
      const tabs = Array.from({ length: 9 }, (_, index) => ({
        id: 7100 + index,
        index,
        windowId: 710,
        active: index === 0,
        pinned: [1, 4, 6, 7, 8].includes(index),
        discarded: index === 6,
        frozen: index === 7,
      }));
      stub(chrome.tabs, "query", () => Promise.resolve(tabs));
      await bgUtils.tabRecency.init();
      for (const tab of tabs.slice().reverse()) bgUtils.tabRecency.register(tab.id);
      try {
        await Settings.set("tabSwitcherOrder", order);
        const ordered = await getSwitcherTabs(710);
        assert.equal(
          [7101, 7104, 7106, 7107, 7108, 7100],
          selectTabSwitcherCards(ordered, 3).map((tab) => tab.id),
        );
      } finally {
        await Settings.set("tabSwitcherOrder", previousOrder);
      }
    });
  }
  should("attach cached previews to pinned cards beyond the recent-card limit", async () => {
    const tabs = Array.from({ length: 6 }, (_, index) => ({
      id: 7200 + index,
      index,
      active: index === 0,
      pinned: index === 5,
      url: `https://pinned-preview.example/${index}`,
    }));
    stub(chrome.tabs, "query", () => Promise.resolve(tabs));
    await bgUtils.tabRecency.init();
    for (const tab of tabs.slice().reverse()) bgUtils.tabRecency.register(tab.id);
    await storeThumbnail(tabs[5].url, false, "pinned-preview");
    const list = await sendRequestHandlers.getOpenTabsWithScreenshots({
      tab: { windowId: 720 },
      includeScreenshots: "cached",
      screenshotLimit: 3,
    });
    assert.equal("pinned-preview", list.find((tab) => tab.id === 7205).screenshot);
    assert.equal(null, list.find((tab) => tab.id === 7203).screenshot);
  });
  should(
    "include sleeping pinned tabs without exposing sleeping unpinned or hidden tabs",
    async () => {
      const tabs = [
        { id: 701, index: 0, windowId: 7, active: true },
        { id: 702, index: 1, windowId: 7, pinned: true, discarded: true },
        { id: 703, index: 2, windowId: 7, pinned: true, frozen: true },
        { id: 704, index: 3, windowId: 7, discarded: true },
        { id: 705, index: 4, windowId: 7, frozen: true },
        { id: 706, index: 5, windowId: 7, pinned: true, hidden: true },
      ];
      stub(chrome.tabs, "query", () => Promise.resolve(tabs));
      const visible = await getRecentTabs(7);
      assert.equal([701, 702, 703], visible.map((tab) => tab.id));
      stub(chrome.tabs, "get", (id) => Promise.resolve(tabs.find((tab) => tab.id === id)));
      stub(chrome.windows, "update", () => Promise.resolve());
      const selected = [];
      stub(chrome.tabs, "update", (id) => {
        selected.push(id);
        return Promise.resolve();
      });
      await sendRequestHandlers.selectSpecificTab({ id: 702, awakeOnly: true, tab: tabs[0] });
      await sendRequestHandlers.selectSpecificTab({ id: 703, awakeOnly: true, tab: tabs[0] });
      assert.equal([702, 703], selected);
    },
  );
  for (const [columns, rows] of [[3, 1], [4, 2], [6, 3]]) {
    should(`keep protected-page cycling within the ${columns * rows} recent cards`, async () => {
      await Settings.onLoaded();
      const oldColumns = Settings.get("tabSwitcherColumns");
      const oldRows = Settings.get("tabSwitcherRows");
      const limit = columns * rows;
      const tabs = Array.from({ length: limit + 3 }, (_, index) => ({
        id: 5000 + index,
        index,
        windowId: 890,
        active: index === 0,
        url: "chrome://extensions/",
      }));
      stub(
        chrome.tabs,
        "query",
        (query) => Promise.resolve(tabs.filter((tab) => !query.active || tab.active)),
      );
      stub(chrome.tabs, "sendMessage", () => Promise.reject(new Error("No receiver")));
      const selected = [];
      stub(chrome.tabs, "update", (id) => {
        for (const tab of tabs) tab.active = tab.id === id;
        bgUtils.tabRecency.register(id);
        selected.push(id);
        return Promise.resolve(tabs.find((tab) => tab.id === id));
      });
      await bgUtils.tabRecency.init();
      for (const tab of tabs.slice().reverse()) bgUtils.tabRecency.register(tab.id);
      try {
        await Settings.set("tabSwitcherColumns", columns);
        await Settings.set("tabSwitcherRows", rows);
        for (let i = 0; i < limit * 2 + 2; i++) {
          await SwitcherCommands.openTabSwitcher(tabs.find((tab) => tab.active));
        }
        assert.equal(
          Array.from({ length: limit * 2 + 2 }, (_, i) => 5000 + ((i + 1) % limit)),
          selected,
        );
      } finally {
        SwitcherCommands.endTabSwitcherCycle(890);
        await Settings.set("tabSwitcherColumns", oldColumns);
        await Settings.set("tabSwitcherRows", oldRows);
      }
    });
  }
  should(
    "include sleeping and inactive pinned tabs in protected-page cycling past the limit",
    async () => {
      await Settings.onLoaded();
      const oldColumns = Settings.get("tabSwitcherColumns");
      const oldRows = Settings.get("tabSwitcherRows");
      const tabs = Array.from({ length: 8 }, (_, index) => ({
        id: 7300 + index,
        index,
        windowId: 730,
        active: index === 0,
        pinned: index >= 5,
        discarded: index === 5,
        frozen: index === 6,
        url: "chrome://extensions/",
      }));
      stub(chrome.tabs, "query", (query) =>
        Promise.resolve(
          tabs.filter((tab) => !query.active || tab.active),
        ));
      stub(chrome.tabs, "sendMessage", () => Promise.reject(new Error("No receiver")));
      const selected = [];
      stub(chrome.tabs, "update", (id) => {
        for (const tab of tabs) tab.active = tab.id === id;
        bgUtils.tabRecency.register(id);
        selected.push(id);
        return Promise.resolve(tabs.find((tab) => tab.id === id));
      });
      await bgUtils.tabRecency.init();
      for (const tab of tabs.slice().reverse()) bgUtils.tabRecency.register(tab.id);
      try {
        await Settings.set("tabSwitcherColumns", 3);
        await Settings.set("tabSwitcherRows", 1);
        for (let i = 0; i < 7; i++) {
          await SwitcherCommands.openTabSwitcher(tabs.find((tab) => tab.active));
        }
        assert.equal([7301, 7305, 7306, 7307, 7300, 7301, 7305], selected);
      } finally {
        SwitcherCommands.endTabSwitcherCycle(730);
        await Settings.set("tabSwitcherColumns", oldColumns);
        await Settings.set("tabSwitcherRows", oldRows);
      }
    },
  );
  should("start a fresh gesture on a new modifier press after a protected-page hop", () => {
    const messages = [];
    stub(TabSwitcher, "cycle", { id: "old-hop", startedAt: 100 });
    stub(TabSwitcher, "shortcut", Utils.parseBrowserShortcut("Ctrl+Q"));
    stub(TabSwitcher, "tabSwitcherUI", null);
    stub(TabSwitcher, "isOpening", false);
    stub(TabSwitcher, "shortcutRequest", null);
    stub(chrome.runtime, "sendMessage", (message) => {
      messages.push(message);
      return Promise.resolve();
    });
    TabSwitcher.recordKeyboardEvent({
      type: "keydown",
      key: "Control",
      ctrlKey: true,
      repeat: false,
    });
    assert.equal(null, TabSwitcher.cycle);
    assert.equal([{ handler: "endTabSwitcherCycle", id: "old-hop" }], messages);
  });
  should("forward grid data requests through the owning content script", async () => {
    const replies = [];
    const request = { handler: "getTabScreenshots", urls: ["https://private.example/"] };
    stub(chrome.runtime, "sendMessage", (message) => {
      assert.equal(request, message);
      return Promise.resolve(["private-image"]);
    });
    stub(TabSwitcher, "tabSwitcherUI", {
      postMessage: (message) => {
        replies.push(message);
        return Promise.resolve();
      },
    });
    await TabSwitcher.handleUiMessage({ data: { name: "request", id: 7, message: request } });
    assert.equal([{ name: "response", id: 7, result: ["private-image"] }], replies);
  });
  should("recover if all frozen-list candidates disappear during a tab query", async () => {
    const source = { id: 911, windowId: 889, active: true, url: "chrome://extensions/" };
    let active = source;
    let eligible = [source, { id: 912, index: 1 }, { id: 913, index: 2 }];
    stub(chrome.tabs, "query", (query) => Promise.resolve(query.active ? [active] : eligible));
    stub(chrome.tabs, "sendMessage", () => Promise.reject(new Error("No receiver")));
    const selected = [];
    stub(chrome.tabs, "update", (id) => {
      selected.push(id);
      active = { ...source, id };
      return Promise.resolve(active);
    });
    await SwitcherCommands.openTabSwitcher(source);
    eligible = [914, 915, 916].map((id, index) => ({ id, index, active: index === 0 }));
    await SwitcherCommands.openTabSwitcher(active);
    assert.equal([912, 915], selected);
    SwitcherCommands.endTabSwitcherCycle(889);
  });
  for (const state of [{ discarded: true }, { frozen: true }, { hidden: true }]) {
    should(`not wake an unavailable grid selection: ${JSON.stringify(state)}`, async () => {
      stub(chrome.tabs, "get", () => Promise.resolve({ id: 901, windowId: 1, ...state }));
      stub(chrome.tabs, "update", () => {
        throw new Error("Unavailable tab was activated");
      });
      stub(chrome.windows, "update", () => {
        throw new Error("Unavailable tab's window was focused");
      });
      assert.isFalse(await sendRequestHandlers.selectSpecificTab({ id: 901, awakeOnly: true }));
    });
  }
  should("end a carried gesture if Control was released before its message arrived", () => {
    const messages = [];
    stub(TabSwitcher, "keyboardEventAt", 101);
    stub(TabSwitcher, "modifierState", { ctrlKey: false });
    stub(chrome.runtime, "sendMessage", (message) => {
      messages.push(message);
      return Promise.resolve();
    });
    TabSwitcher.rememberCycle(
      { id: "released-cycle", startedAt: 100 },
      Utils.parseBrowserShortcut("Ctrl+Q"),
    );
    assert.equal(null, TabSwitcher.cycle);
    assert.equal([{ handler: "endTabSwitcherCycle", id: "released-cycle" }], messages);
  });
  should("open with Ctrl held even when Alt is up", async () => {
    stub(globalThis, "document", { activeElement: { tagName: "BODY" } });
    stub(TabSwitcher, "modifierState", { ctrlKey: true, altKey: false });
    let shown = false;
    stub(TabSwitcher, "activate", () => {
      shown = true;
      return Promise.resolve(true);
    });
    stub(TabSwitcher, "quickSwitch", () => Promise.resolve({ opened: true, quickSwitch: true }));
    const result = await TabSwitcher.activateFromBrowserShortcut("ctrl-test", {
      shortcut: Utils.parseBrowserShortcut("Ctrl+Q"),
    });
    assert.isTrue(shown);
    assert.equal({ opened: true }, result);
  });

  should("keep a frozen order through protected-page hops, then reset after release", async () => {
    const tabs = [801, 802, 803, 804].map((id, index) => ({
      id,
      index,
      windowId: 888,
      active: index === 0,
      url: "chrome://extensions/",
    }));
    stub(
      chrome.tabs,
      "query",
      (query) => Promise.resolve(tabs.filter((t) => !query.active || t.active)),
    );
    stub(chrome.tabs, "sendMessage", () => Promise.reject(new Error("No receiver")));
    const selected = [];
    stub(chrome.tabs, "update", (id) => {
      for (const tab of tabs) tab.active = tab.id === id;
      bgUtils.tabRecency.register(id);
      selected.push(id);
      return Promise.resolve(tabs.find((t) => t.id === id));
    });
    await bgUtils.tabRecency.init();
    for (const id of [804, 803, 802, 801]) bgUtils.tabRecency.register(id);
    await SwitcherCommands.openTabSwitcher(tabs[0]);
    await SwitcherCommands.openTabSwitcher(tabs[1]);
    tabs[3].discarded = true;
    await SwitcherCommands.openTabSwitcher(tabs[2]);
    assert.equal([802, 803, 801], selected);
    SwitcherCommands.endTabSwitcherCycle(888);
    await SwitcherCommands.openTabSwitcher(tabs[0]);
    assert.equal(803, selected.at(-1));
    SwitcherCommands.endTabSwitcherCycle(888);
  });
});

context("TabSwitcher", () => {
  should("initialize and open tab switcher UI", async () => {
    let shown = false;
    TabSwitcher.tabSwitcherUI = {
      show: () => {
        shown = true;
        return Promise.resolve();
      },
    };
    await TabSwitcher.open(0);
    assert.isTrue(shown);
  });

  should("open immediately without requesting a fresh screenshot", async () => {
    let captured = false;
    stub(TabPreview, "capture", () => {
      captured = true;
      return new Promise(() => {});
    });
    TabPreview.enabled = true;
    TabSwitcher.tabSwitcherUI = { show: () => Promise.resolve() };
    try {
      await TabSwitcher.open(0);
      assert.isFalse(captured);
    } finally {
      TabPreview.enabled = false;
      TabSwitcher.tabSwitcherUI = null;
      TabSwitcher.uiLoad = TabSwitcher.opening = null;
    }
  });

  should("only throttle preview attempts after a successful capture", async () => {
    stub(globalThis, "document", {
      hidden: false,
      documentElement: { children: [] },
      getElementById: () => null,
    });
    stub(globalThis, "location", { href: "https://example.com/loading" });
    let captured = false;
    stub(chrome.runtime, "sendMessage", () => Promise.resolve(captured ? { captured: true } : {}));
    TabPreview.enabled = true;
    TabPreview.lastCapture = -Infinity;
    try {
      await TabPreview.capture();
      assert.equal(-Infinity, TabPreview.lastCapture);
      captured = true;
      await TabPreview.capture();
      assert.isTrue(Number.isFinite(TabPreview.lastCapture));
    } finally {
      TabPreview.enabled = false;
      TabPreview.lastCapture = -Infinity;
    }
  });

  should("quick switching skips sleeping tabs and stays in the source window", async () => {
    stub(chrome.tabs, "query", (query) => {
      assert.equal({ windowId: 7 }, query);
      return Promise.resolve([
        { id: 201, active: true, index: 0 },
        { id: 202, discarded: true, index: 1, lastAccessed: 300 },
        { id: 203, frozen: true, index: 2, lastAccessed: 200 },
        { id: 204, index: 3, lastAccessed: 100 },
      ]);
    });
    let selected;
    stub(chrome.tabs, "update", (id, change) => {
      selected = { id, ...change };
      return Promise.resolve();
    });
    const result = await sendRequestHandlers.quickSwitchTab({ tab: { id: 201, windowId: 7 } });
    assert.isTrue(result.switched);
    assert.equal({ id: 204, active: true }, selected);
  });

  should("fetch open tabs with screenshot placeholders from background", async () => {
    stub(chrome.tabs, "query", () =>
      Promise.resolve([
        { id: 1, index: 0, title: "Test Tab", url: "https://example.com", active: true },
      ]));
    const handler = sendRequestHandlers["getOpenTabsWithScreenshots"];
    const tabs = await handler({ tab: { windowId: 1 } });
    assert.equal(1, tabs.length);
    assert.equal("Test Tab", tabs[0].title);
    assert.equal(null, tabs[0].screenshot);
  });

  should("preserve rapid cycling while the preview frame is still starting", async () => {
    const messages = [];
    let finishLoading;
    TabSwitcher.uiLoad = new Promise((resolve) => finishLoading = resolve);
    TabSwitcher.tabSwitcherUI = {
      showing: false,
      show(message) {
        messages.push(message.name);
        this.showing = true;
        return Promise.resolve();
      },
      postMessage(message) {
        messages.push(message.name);
        return Promise.resolve();
      },
    };
    try {
      const opens = [TabSwitcher.activate(0), TabSwitcher.activate(0), TabSwitcher.activate(0)];
      assert.equal([], messages);
      finishLoading();
      await Promise.all(opens);
      assert.equal(["activate", "cycleNext", "cycleNext"], messages);
      assert.isFalse(TabSwitcher.isOpening);
    } finally {
      TabSwitcher.tabSwitcherUI = null;
      TabSwitcher.uiLoad = TabSwitcher.opening = null;
    }
  });

  should(
    "list visited tabs most recently used first, then unvisited tabs by lastAccessed",
    async () => {
      stub(chrome.tabs, "query", () =>
        Promise.resolve([
          { id: 11, index: 0, title: "a" },
          { id: 12, index: 1, title: "b" },
          { id: 13, index: 2, title: "c" },
          { id: 14, index: 3, title: "d", lastAccessed: 100 },
          { id: 15, index: 4, title: "e", lastAccessed: 200 },
          { id: 16, index: 5, title: "hidden by a Firefox tab-group extension", hidden: true },
        ]));
      await bgUtils.tabRecency.init();
      bgUtils.tabRecency.register(11);
      bgUtils.tabRecency.register(13);
      bgUtils.tabRecency.register(12);
      const tabs = await sendRequestHandlers["getOpenTabsWithScreenshots"]({
        tab: { windowId: 1 },
      });
      assert.equal([12, 13, 11, 15, 14], tabs.map((t) => t.id));
    },
  );

  should(
    "keep the active tab first and omit sleeping tabs without limiting the eligible list",
    async () => {
      const windowTabs = Array.from({ length: 15 }, (_, i) => ({ id: 100 + i, index: i }));
      windowTabs[0].active = true;
      windowTabs[1].discarded = true;
      windowTabs[2].frozen = true;
      const expected = [100, ...windowTabs.slice(3).reverse().map((t) => t.id)];
      stub(chrome.tabs, "query", () => Promise.resolve(windowTabs));
      await bgUtils.tabRecency.init();
      // Deliberately omit the active tab from recency; it must still appear first.
      for (const tab of windowTabs.slice(1)) bgUtils.tabRecency.register(tab.id);
      const tabs = await sendRequestHandlers.getOpenTabsWithScreenshots({ tab: { windowId: 1 } });
      assert.equal(expected, tabs.map((t) => t.id));
    },
  );
});

context("TabPreview first paint and repeat visits", () => {
  let captures, now;
  setup(() => {
    now = 10000;
    captures = [];
    stub(globalThis, "performance", { now: () => now });
    stub(globalThis, "document", {
      hidden: false,
      readyState: "interactive",
      documentElement: { children: [] },
      getElementById: () => null,
    });
    stub(globalThis, "location", { href: "https://preview.example/" });
    stub(globalThis, "requestAnimationFrame", (callback) => callback());
    stub(globalThis, "requestIdleCallback", (callback) => callback());
    stub(globalThis, "setInterval", () => 0);
    stub(TabPreview, "mutations", { observe() {}, disconnect() {} });
    stub(TabPreview, "enabled", true);
    stub(TabPreview, "waitStart", 0);
    stub(TabPreview, "lastCapture", -Infinity);
    stub(TabPreview, "pending", null);
    stub(chrome.runtime, "sendMessage", (message) => {
      captures.push(message);
      return Promise.resolve({ captured: true });
    });
  });

  should("capture after the first paint while the page is still loading", async () => {
    TabPreview.start("load");
    await TabPreview.pending;
    assert.equal(1, captures.length);
    assert.isTrue(captures[0].allowLoading);
  });

  should("refresh each visit even if the last successful capture was recent", async () => {
    TabPreview.lastCapture = now - 1000;
    TabPreview.start("visible");
    await TabPreview.pending;
    assert.equal(1, captures.length);
  });

  should("refine the early preview after the page finishes loading and settles", async () => {
    TabPreview.start("load");
    await TabPreview.pending;
    now += 1000;
    document.readyState = "complete";
    TabPreview.check();
    await TabPreview.pending;
    assert.equal(2, captures.length);
  });

  should("coalesce duplicate visibility requests during one settling period", async () => {
    TabPreview.start("visible");
    TabPreview.start("visible");
    await TabPreview.pending;
    assert.equal(1, captures.length);
  });

  should("retry an early rate-limited capture while resources are still loading", async () => {
    let retry;
    stub(globalThis, "setTimeout", (callback) => retry = callback);
    stub(chrome.runtime, "sendMessage", (message) => {
      captures.push(message);
      return Promise.resolve(captures.length === 1 ? { retry: true } : { captured: true });
    });
    TabPreview.start("load");
    await TabPreview.pending;
    retry();
    await TabPreview.pending;
    assert.equal(2, captures.length);
  });

  should(
    "start a new early capture after leaving and quickly returning during settling",
    async () => {
      TabPreview.start("load");
      await TabPreview.pending;
      document.hidden = true;
      TabPreview.start("visible");
      document.hidden = false;
      now += 100;
      TabPreview.start("visible");
      await TabPreview.pending;
      assert.equal(2, captures.length);
    },
  );
});

context("TabPreview navigation while settling", () => {
  should("capture a new route immediately during an existing settling period", async () => {
    const captures = [];
    stub(globalThis, "document", {
      hidden: false,
      documentElement: { children: [] },
      getElementById: () => null,
    });
    stub(globalThis, "location", { href: "https://preview.example/new-route" });
    stub(TabPreview, "enabled", true);
    stub(TabPreview, "waitStart", 100);
    stub(TabPreview, "pending", null);
    stub(globalThis, "requestAnimationFrame", (callback) => callback());
    stub(globalThis, "requestIdleCallback", (callback) => callback());
    stub(chrome.runtime, "sendMessage", (message) => {
      captures.push(message.url);
      return Promise.resolve({ captured: true });
    });
    TabPreview.start("route");
    await TabPreview.pending;
    assert.equal(["https://preview.example/new-route"], captures);
  });

  should("preserve a new route's early capture while the previous capture is pending", async () => {
    const captures = [];
    let complete;
    stub(globalThis, "document", {
      hidden: false,
      documentElement: { children: [] },
      getElementById: () => null,
    });
    stub(globalThis, "location", { href: "https://preview.example/" });
    stub(TabPreview, "enabled", true);
    stub(TabPreview, "pending", null);
    stub(chrome.runtime, "sendMessage", (message) => {
      captures.push(message.url);
      return captures.length === 1
        ? new Promise((resolve) => complete = resolve)
        : Promise.resolve({ captured: true });
    });
    const previous = TabPreview.capture(true);
    location.href = "https://preview.example/new-route";
    const next = TabPreview.capture(true);
    complete({});
    await Promise.all([previous, next]);
    assert.equal(["https://preview.example/", "https://preview.example/new-route"], captures);
  });
});

context("Tab switcher previews and order", () => {
  should(
    "keep private previews out of local storage when session storage falls back to local",
    async () => {
      stub(chrome.storage, "session", chrome.storage.local);
      const fallback = await import(
        "../../background_scripts/thumbnails.js?local-session-fallback"
      );
      const normalUrl = "https://fallback-preview.example/normal";
      const privateUrl = "https://fallback-preview.example/private";
      await fallback.storeThumbnail(normalUrl, false, "normal-preview");
      await fallback.storeThumbnail(privateUrl, true, "private-preview");
      const stored = (await chrome.storage.local.get("tabThumbnails")).tabThumbnails;
      assert.equal("normal-preview", stored[normalUrl]);
      assert.equal(undefined, stored[privateUrl]);
      assert.equal(
        ["normal-preview", null],
        await fallback.findThumbnails([normalUrl, privateUrl], false),
      );
      assert.equal(
        [null, "private-preview"],
        await fallback.findThumbnails([normalUrl, privateUrl], true),
      );
    },
  );

  should("reject background preview requests while the page's Brovim UI is visible", async () => {
    const url = "https://visible-ui-preview.example/";
    stub(chrome.tabs, "get", () => Promise.resolve({ active: true, status: "complete", url }));
    stub(chrome.tabs, "sendMessage", () => Promise.resolve({ allowed: false }));
    stub(chrome.tabs, "captureVisibleTab", () => {
      throw new Error("A visible dialog must not be captured");
    });
    assert.equal({}, await captureThumbnail(1, url));
  });

  should("allow an explicit first-paint capture before the tab has finished loading", async () => {
    const url = "https://loading-preview.example/";
    stub(chrome.tabs, "get", () => Promise.resolve({ active: true, status: "loading", url }));
    stub(chrome.tabs, "captureVisibleTab", () => {
      throw new Error("MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND");
    });
    assert.equal({}, await captureThumbnail(1, url));
    assert.equal({ retry: true }, await captureThumbnail(1, url, true));
  });

  should("use the latest capture across tracking variants of the same page", async () => {
    const url = "https://fresh-preview.example/page";
    await storeThumbnail(url, false, "older");
    await storeThumbnail(`${url}?utm_source=mail#top`, false, "newer");
    assert.equal(["newer", "newer"], await findThumbnails([url, `${url}#section`], false));
  });

  should("return cached previews immediately and keep private previews separate", async () => {
    const url = "https://immediate-preview.example/page";
    await storeThumbnail(url, false, "normal");
    await storeThumbnail(url, true, "private");
    assert.equal(["normal"], Thumbnails.getCachedThumbnails([url], false));
    assert.equal(["private"], Thumbnails.getCachedThumbnails([url], true));
  });

  should("return placeholders immediately while a cold cache is still loading", async () => {
    stub(chrome.storage.local, "get", () => new Promise(() => {}));
    const cold = await import("../../background_scripts/thumbnails.js?cold-cache");
    assert.equal([null], cold.getCachedThumbnails(["https://cold.example/"], false));
  });

  for (
    const { order, activeId, expectedId } of [
      { order: "mru", activeId: 301, expectedId: 303 },
      { order: "tabstrip", activeId: 301, expectedId: 302 },
      { order: "tabstrip", activeId: 302, expectedId: 303 },
      { order: "tabstrip", activeId: 303, expectedId: 301 },
    ]
  ) {
    should(`quick switch from ${activeId} to ${expectedId} in ${order} order`, async () => {
      stub(chrome.tabs, "query", () =>
        Promise.resolve([
          { id: 301, index: 0, active: activeId === 301 },
          { id: 304, index: 1, discarded: true },
          { id: 305, index: 2, frozen: true },
          { id: 306, index: 3, hidden: true },
          { id: 302, index: 4, active: activeId === 302 },
          { id: 303, index: 5, active: activeId === 303 },
        ]));
      let selected;
      stub(chrome.tabs, "update", (id, change) => {
        selected = { id, ...change };
        return Promise.resolve();
      });
      await Settings.onLoaded();
      await bgUtils.tabRecency.init();
      for (const id of [302, 303, 301]) bgUtils.tabRecency.register(id);
      const previousOrder = Settings.get("tabSwitcherOrder");
      await Settings.set("tabSwitcherOrder", order);
      try {
        const result = await sendRequestHandlers.quickSwitchTab({
          tab: { id: activeId, windowId: 7 },
        });
        assert.isTrue(result.switched);
        assert.equal({ id: expectedId, active: true }, selected);
      } finally {
        await Settings.set("tabSwitcherOrder", previousOrder);
      }
    });
  }

  should("match a page whose URL only gained tracking parameters or a fragment", () => {
    assert.equal(pageKey("https://a.com/p?x=1"), pageKey("https://a.com/p?utm_source=n&x=1#top"));
    assert.equal(pageKey("https://a.com/p?a=1&b=2"), pageKey("https://a.com/p?b=2&a=1"));
    assert.isFalse(pageKey("https://a.com/watch?v=A") == pageKey("https://a.com/watch?v=B"));
    assert.isFalse(pageKey("https://a.com/#/inbox") == pageKey("https://a.com/#/sent"));
  });

  should("keep the newest previews by URL, with incognito ones apart", async () => {
    await Settings.onLoaded();
    await Settings.set("tabSwitcherMaxThumbnails", 2);
    try {
      await storeThumbnail("https://a.com/1", false, "one");
      await storeThumbnail("https://a.com/2?gclid=x", false, "two");
      await storeThumbnail("https://a.com/3", false, "three");
      await storeThumbnail("https://a.com/1", true, "private");
      const urls = ["https://a.com/1", "https://a.com/2", "https://a.com/3"];
      assert.equal([null, "two", "three"], await findThumbnails(urls, false));
      assert.equal(["private", null, null], await findThumbnails(urls, true));
      assert.equal(
        ["https://a.com/2?gclid=x", "https://a.com/3"],
        Object.keys((await chrome.storage.local.get("tabThumbnails")).tabThumbnails),
      );
    } finally {
      await Settings.set(
        "tabSwitcherMaxThumbnails",
        Settings.defaultOptions.tabSwitcherMaxThumbnails,
      );
    }
  });

  should(
    "cap imported preview limits at ten and trim immediately when lowered to five",
    async () => {
      await Settings.onLoaded();
      await Settings.set("tabSwitcherMaxThumbnails", 240);
      const urls = Array.from({ length: 12 }, (_, i) => `https://preview-cap.example/${i}`);
      try {
        for (const url of urls) await storeThumbnail(url, false, url);
        assert.equal(10, (await findThumbnails(urls, false)).filter(Boolean).length);
        await Settings.set("tabSwitcherMaxThumbnails", 5);
        await trimThumbnailCaches();
        assert.equal(urls.slice(-5), (await findThumbnails(urls, false)).filter(Boolean));
      } finally {
        await Settings.set(
          "tabSwitcherMaxThumbnails",
          Settings.defaultOptions.tabSwitcherMaxThumbnails,
        );
      }
    },
  );

  should("list tabs in tab bar order from the current tab when chosen", async () => {
    stub(chrome.tabs, "query", () =>
      Promise.resolve([
        { id: 1, index: 0, title: "a" },
        { id: 2, index: 1, title: "b", active: true },
        { id: 3, index: 2, title: "c" },
      ]));
    await Settings.onLoaded();
    bgUtils.tabRecency.register(1);
    bgUtils.tabRecency.register(3);
    await Settings.set("tabSwitcherOrder", "tabstrip");
    try {
      const tabs = await sendRequestHandlers.getOpenTabsWithScreenshots({ tab: { windowId: 1 } });
      assert.equal([2, 3, 1], tabs.map((t) => t.id));
    } finally {
      await Settings.set("tabSwitcherOrder", "mru");
    }
  });
});
