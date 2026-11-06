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
import { orderTabSwitcherCards, tabSwitcherGrid } from "../../lib/tab_switcher.js";

context("cancelled switcher openings", () => {
  let finishLoading, messages;
  setup(() => {
    messages = [];
    stub(TabSwitcher, "openingGeneration", 0);
    stub(TabSwitcher, "isOpening", false);
    stub(TabSwitcher, "isAltCycling", false);
    stub(TabSwitcher, "pendingCommit", false);
    stub(TabSwitcher, "overlayId", null);
    stub(TabSwitcher, "cycle", null);
    stub(TabSwitcher, "opening", null);
    stub(TabSwitcher, "currentRequestId", null);
    stub(TabSwitcher, "uiLoad", new Promise((resolve) => finishLoading = resolve));
    stub(TabSwitcher, "tabSwitcherUI", {
      showing: false,
      show(message) {
        messages.push(message);
        this.showing = true;
        return Promise.resolve();
      },
      postMessage(message) {
        messages.push(message);
        return Promise.resolve();
      },
    });
  });

  should(
    "not reopen either of two cancelled gestures when the frame finishes loading",
    async () => {
      const first = TabSwitcher.activate(0, { requestId: "first" });
      TabSwitcher.cancel("first");
      const second = TabSwitcher.activate(0, { requestId: "second" });
      TabSwitcher.cancel("second");
      finishLoading();
      assert.equal([false, false], await Promise.all([first, second]));
      assert.equal([], messages);
      assert.isFalse(TabSwitcher.tabSwitcherUI.showing);
    },
  );

  should("not show old previews after multiple quick switches during startup", async () => {
    stub(chrome.runtime, "sendMessage", () => Promise.resolve({ switched: true }));
    const first = TabSwitcher.activate(0, { requestId: "first" });
    await TabSwitcher.quickSwitch();
    const second = TabSwitcher.activate(0, { requestId: "second" });
    await TabSwitcher.quickSwitch();
    finishLoading();
    assert.equal([false, false], await Promise.all([first, second]));
    assert.equal([], messages);
  });

  should("not clear a newer gesture's cycle when an earlier quick switch finishes", async () => {
    let finishSwitch;
    stub(chrome.runtime, "sendMessage", () => new Promise((resolve) => finishSwitch = resolve));
    TabSwitcher.cycle = { id: "first" };
    const switching = TabSwitcher.quickSwitch();
    TabSwitcher.cycle = { id: "second" };
    finishSwitch({ switched: true });
    await switching;
    assert.equal({ id: "second" }, TabSwitcher.cycle);
  });

  should("keep a newer opening active when an older cancelled opening settles", async () => {
    const first = TabSwitcher.activate(0, { requestId: "first" });
    const queued = TabSwitcher.activate(0, { requestId: "repeat" });
    TabSwitcher.cancel("repeat");
    const finishFirst = finishLoading;
    TabSwitcher.uiLoad = new Promise((resolve) => finishLoading = resolve);
    const second = TabSwitcher.activate(0, { requestId: "second" });
    const overlayId = TabSwitcher.overlayId;
    finishFirst();
    assert.equal([false, false], await Promise.all([first, queued]));
    assert.isTrue(TabSwitcher.isOpening);
    finishLoading();
    assert.isTrue(await second);
    assert.equal(["activate"], messages.map((message) => message.name));
    assert.equal(overlayId, messages[0].overlayId);
    assert.isFalse(TabSwitcher.isOpening);
  });
});

context("configured switcher shortcut", () => {
  should(
    "start at the last-used cell, then cycle adjacent visual cells across protected pages",
    async () => {
      await Settings.onLoaded();
      const previousOrder = Settings.get("tabSwitcherOrder");
      const tabs = Array.from({ length: 9 }, (_, index) => ({
        id: 9100 + index,
        index,
        windowId: 910,
        active: index === 3,
        pinned: index < 3,
        discarded: index === 0,
        frozen: index === 1,
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
        selected.push(id - 9100);
        return Promise.resolve(tabs.find((tab) => tab.id === id));
      });
      await bgUtils.tabRecency.init();
      for (const tab of tabs) bgUtils.tabRecency.register(tab.id);
      bgUtils.tabRecency.register(9106);
      bgUtils.tabRecency.register(9103);
      try {
        await Settings.set("tabSwitcherOrder", "tabstrip");
        for (let i = 0; i < 10; i++) {
          await SwitcherCommands.openTabSwitcher(tabs.find((tab) => tab.active));
        }
        assert.equal([6, 7, 8, 0, 1, 2, 3, 4, 5, 6], selected);
      } finally {
        SwitcherCommands.endTabSwitcherCycle(910);
        await Settings.set("tabSwitcherOrder", previousOrder);
      }
    },
  );
  should("keep sleeping pins in the leading cells without changing the shortcut order", () => {
    const firstPin = { id: 8010, index: 0, pinned: true, discarded: true };
    const secondPin = { id: 8011, index: 1, pinned: true, frozen: true };
    const current = { id: 8012, index: 2, active: true };
    const previous = { id: 8013, index: 3 };
    const recent = [current, previous, secondPin, firstPin];
    assert.equal([8010, 8011, 8012, 8013], orderTabSwitcherCards(recent).map((tab) => tab.id));
    assert.equal([8012, 8013, 8011, 8010], recent.map((tab) => tab.id));
    const afterVisit = [{ ...secondPin, frozen: false, active: true }, current, firstPin, previous];
    assert.equal([8010, 8011, 8012, 8013], orderTabSwitcherCards(afterVisit).map((tab) => tab.id));
  });
  should("grow the configured grid by columns and rows until every tab fits the screen", () => {
    const grid = (count, columns = 6, rows = 3) =>
      tabSwitcherGrid(count, { columns, rows, maxColumns: 10, maxRows: 6 });
    assert.equal({ columns: 6, rows: 3 }, grid(5));
    assert.equal({ columns: 6, rows: 3 }, grid(18));
    assert.equal({ columns: 7, rows: 3 }, grid(19));
    assert.equal({ columns: 7, rows: 4 }, grid(22));
    assert.equal({ columns: 8, rows: 4 }, grid(30));
    assert.equal({ columns: 10, rows: 6 }, grid(60));
    // Past the screen's limit, the keyboard pages through the rest.
    assert.equal({ columns: 10, rows: 6 }, grid(200));
    assert.equal({ columns: 3, rows: 2 }, grid(4, 3, 1));
    // A small screen never shrinks the configured grid.
    assert.equal(
      { columns: 6, rows: 3 },
      tabSwitcherGrid(40, { columns: 6, rows: 3, maxColumns: 4, maxRows: 2 }),
    );
  });
  for (const order of ["mru", "tabstrip"]) {
    should(`list every eligible tab, sleeping pins first, in ${order} order`, async () => {
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
        const cards = orderTabSwitcherCards(await getSwitcherTabs(710));
        assert.equal(
          [7101, 7104, 7106, 7107, 7108, 7100, 7102, 7103, 7105],
          cards.map((tab) => tab.id),
        );
      } finally {
        await Settings.set("tabSwitcherOrder", previousOrder);
      }
    });
  }
  should("attach cached previews to every card", async () => {
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
    });
    assert.equal("pinned-preview", list.find((tab) => tab.id === 7205).screenshot);
    assert.equal(null, list.find((tab) => tab.id === 7203).screenshot);
  });
  should(
    "include sleeping pins and frozen tabs without exposing discarded unpinned or hidden tabs",
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
      assert.equal([701, 702, 703, 705], visible.map((tab) => tab.id));
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
    should(`cycle every awake tab on protected pages with a ${columns}x${rows} grid`, async () => {
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
        // The configured size is only where the grid starts; it never hides tabs.
        assert.equal(
          Array.from({ length: limit * 2 + 2 }, (_, i) => 5000 + ((i + 1) % tabs.length)),
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
    "include sleeping and inactive pinned tabs in protected-page cycling",
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
        assert.equal([7301, 7302, 7303, 7304, 7305, 7306, 7307], selected);
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
  should("warm up only on a fresh press of the shortcut's modifier, after settings load", () => {
    const warmed = [];
    stub(TabSwitcher, "shortcut", Utils.parseBrowserShortcut("Ctrl+Q"));
    stub(TabSwitcher, "init", () => warmed.push("frame"));
    stub(chrome.runtime, "id", "brovim");
    stub(chrome.runtime, "sendMessage", (message) => {
      warmed.push(message.handler);
      return Promise.resolve();
    });
    stub(Settings, "isLoaded", () => false);
    TabSwitcher.warmUp({ key: "Control", repeat: false });
    assert.equal([], warmed);
    stub(Settings, "isLoaded", () => true);
    TabSwitcher.warmUp({ key: "Alt", repeat: false });
    TabSwitcher.warmUp({ key: "Control", repeat: true });
    assert.equal([], warmed);
    TabSwitcher.warmUp({ key: "Control", repeat: false });
    assert.equal(["frame", "warmTabSwitcher"], warmed);
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
  for (const state of [{ discarded: true }, { hidden: true }]) {
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
  should("select a frozen tab: it is still loaded and resumes when activated", async () => {
    stub(chrome.tabs, "get", () => Promise.resolve({ id: 902, windowId: 1, frozen: true }));
    stub(chrome.windows, "update", () => Promise.resolve());
    const selected = [];
    stub(chrome.tabs, "update", (id, change) => {
      selected.push({ id, ...change });
      return Promise.resolve();
    });
    await sendRequestHandlers.selectSpecificTab({ id: 902, awakeOnly: true });
    assert.equal([{ id: 902, active: true }], selected);
  });
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

  should("quick switching skips discarded tabs, not frozen ones, in its window", async () => {
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
    assert.equal({ id: 203, active: true }, selected);
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
    "keep the active tab first and omit discarded tabs without limiting the eligible list",
    async () => {
      const windowTabs = Array.from({ length: 15 }, (_, i) => ({ id: 100 + i, index: i }));
      windowTabs[0].active = true;
      windowTabs[1].discarded = true;
      windowTabs[2].frozen = true;
      // The frozen tab (102) is awake and stays listed.
      const expected = [100, ...windowTabs.slice(2).reverse().map((t) => t.id)];
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
      { order: "tabstrip", activeId: 301, expectedId: 303 },
      { order: "tabstrip", activeId: 302, expectedId: 301 },
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
