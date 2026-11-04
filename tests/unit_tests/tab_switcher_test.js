import "./test_helper.js";
import "../../tests/unit_tests/test_chrome_stubs.js";
import "../../content_scripts/mode.js";
import "../../content_scripts/ui_component.js";
import "../../content_scripts/tab_switcher.js";
import "../../background_scripts/main.js";
import * as bgUtils from "../../background_scripts/bg_utils.js";
import { findThumbnails, pageKey, storeThumbnail } from "../../background_scripts/thumbnails.js";

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

context("Tab switcher previews and order", () => {
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
      await Settings.set("tabSwitcherMaxThumbnails", 60);
    }
  });

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
