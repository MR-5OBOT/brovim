import "./test_helper.js";
import "../../tests/unit_tests/test_chrome_stubs.js";
import "../../lib/dom_utils.js";
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
import { getRecentTabs, getTabSwitcherData } from "../../background_scripts/recent_tabs.js";
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

  should("keep the assigned shortcut when a key mapping opens the grid", async () => {
    stub(TabSwitcher, "shortcut", Utils.parseBrowserShortcut("Ctrl+Q"));
    const opening = TabSwitcher.activate(0, { altCycle: true });
    assert.equal(["ctrlKey"], TabSwitcher.shortcut.modifiers);
    finishLoading();
    assert.isTrue(await opening);
    assert.equal(["ctrlKey"], messages[0].shortcut.modifiers);
  });

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
  should("keep the current and last-used tabs among the 12 cards", () => {
    const ids = (tabs) => tabs.map((tab) => tab.id);
    const pins = Array.from({ length: 12 }, (_, i) => ({ id: 9000 + i, index: i, pinned: true }));
    const current = { id: 9100, index: 12, active: true };
    const previous = { id: 9101, index: 13 };
    assert.equal(
      [...ids(pins.slice(0, 10)), 9100, 9101],
      ids(orderTabSwitcherCards([current, previous, ...pins], previous.id)),
    );
    // Tab-bar order can put the last-used tab far from the current one.
    const between = Array.from({ length: 14 }, (_, i) => ({ id: 9200 + i, index: 20 + i }));
    assert.equal(
      [9100, ...ids(between.slice(0, 10)), 9101],
      ids(orderTabSwitcherCards([current, ...between, previous], previous.id)),
    );
  });
  should("fill rows of the configured width, then widen only when no row fits", () => {
    const grid = (count, columns = 8) =>
      tabSwitcherGrid(count, { columns, maxColumns: 10, maxRows: 6 });
    assert.equal({ columns: 8, rows: 1 }, grid(5));
    assert.equal({ columns: 8, rows: 1 }, grid(8));
    assert.equal({ columns: 8, rows: 2 }, grid(9));
    assert.equal({ columns: 8, rows: 3 }, grid(17));
    assert.equal({ columns: 8, rows: 6 }, grid(48));
    // A full screen of rows adds columns instead.
    assert.equal({ columns: 9, rows: 6 }, grid(49));
    // Past the screen's limit, the keyboard pages through the rest.
    assert.equal({ columns: 10, rows: 6 }, grid(200));
    assert.equal({ columns: 3, rows: 2 }, grid(4, 3));
    // A small screen never shrinks the configured width, and always has a row.
    assert.equal(
      { columns: 8, rows: 2 },
      tabSwitcherGrid(40, { columns: 8, maxColumns: 4, maxRows: 2 }),
    );
    assert.equal(
      { columns: 8, rows: 1 },
      tabSwitcherGrid(40, { columns: 8, maxColumns: 4, maxRows: 0 }),
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
        const cards = orderTabSwitcherCards((await getTabSwitcherData(710)).tabs);
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
    "include sleeping pinned tabs without exposing sleeping unpinned or hidden tabs",
    async () => {
      const tabs = [
        { id: 701, index: 0, windowId: 7, active: true },
        { id: 702, index: 1, windowId: 7, pinned: true, discarded: true },
        { id: 703, index: 2, windowId: 7, pinned: true, frozen: true },
        { id: 704, index: 3, windowId: 7, discarded: true },
        { id: 705, index: 4, windowId: 7, frozen: true },
        { id: 706, index: 5, windowId: 7, pinned: true, hidden: true },
        // Restored after a browser restart and never opened again: unloaded, not "discarded".
        { id: 707, index: 6, windowId: 7, status: "unloaded" },
        { id: 708, index: 7, windowId: 7, pinned: true, status: "unloaded" },
      ];
      stub(chrome.tabs, "query", () => Promise.resolve(tabs));
      const visible = await getRecentTabs(7);
      assert.equal([701, 702, 703, 708], visible.map((tab) => tab.id));
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
  for (const columns of [3, 5, 8]) {
    should(
      `cycle the 12 most recent tabs on protected pages with ${columns} cards per row`,
      async () => {
        await Settings.onLoaded();
        const oldColumns = Settings.get("tabSwitcherColumns");
        const limit = columns * 2;
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
          for (let i = 0; i < limit * 2 + 2; i++) {
            await SwitcherCommands.openTabSwitcher(tabs.find((tab) => tab.active));
          }
          // At most 12 cards, whatever the row width: older tabs are left out.
          const cards = Math.min(tabs.length, 12);
          assert.equal(
            Array.from({ length: limit * 2 + 2 }, (_, i) => 5000 + ((i + 1) % cards)),
            selected,
          );
        } finally {
          SwitcherCommands.endTabSwitcherCycle(890);
          await Settings.set("tabSwitcherColumns", oldColumns);
        }
      },
    );
  }
  should(
    "include sleeping and inactive pinned tabs in protected-page cycling",
    async () => {
      await Settings.onLoaded();
      const oldColumns = Settings.get("tabSwitcherColumns");
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
        for (let i = 0; i < 7; i++) {
          await SwitcherCommands.openTabSwitcher(tabs.find((tab) => tab.active));
        }
        assert.equal([7301, 7302, 7303, 7304, 7305, 7306, 7307], selected);
      } finally {
        SwitcherCommands.endTabSwitcherCycle(730);
        await Settings.set("tabSwitcherColumns", oldColumns);
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
  should(
    "warm up only on a fresh press of the shortcut's modifier, the frame after settings load",
    () => {
      const warmed = [];
      stub(TabSwitcher, "shortcut", Utils.parseBrowserShortcut("Ctrl+Q"));
      stub(TabSwitcher, "init", () => warmed.push("frame"));
      stub(chrome.runtime, "id", "brovim");
      stub(chrome.runtime, "sendMessage", (message) => {
        warmed.push(message.handler);
        return Promise.resolve();
      });
      // The background learns of the press even before settings load.
      stub(Settings, "isLoaded", () => false);
      TabSwitcher.warmUp({ key: "Control", repeat: false });
      assert.equal(["warmTabSwitcher"], warmed);
      warmed.length = 0;
      stub(Settings, "isLoaded", () => true);
      TabSwitcher.warmUp({ key: "Alt", repeat: false });
      TabSwitcher.warmUp({ key: "Control", repeat: true });
      assert.equal([], warmed);
      TabSwitcher.warmUp({ key: "Control", repeat: false });
      assert.equal(["warmTabSwitcher", "frame"], warmed);
    },
  );
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
  for (
    const state of [{ discarded: true }, { frozen: true }, { status: "unloaded" }, { hidden: true }]
  ) {
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
    stub(TabSwitcher, "painted", true);
    stub(globalThis, "document", { activeElement: { tagName: "BODY" }, hasFocus: () => true });
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
  should("leave the switch to the background where the modifier can't be seen", async () => {
    stub(TabSwitcher, "painted", true);
    const frame = { tagName: "IFRAME" };
    const page = { activeElement: { tagName: "BODY" }, hasFocus: () => true };
    stub(TabSwitcher, "tabSwitcherUI", null);
    stub(TabSwitcher, "isOpening", false);
    stub(TabSwitcher, "keysFrame", null);
    stub(TabSwitcher, "modifierState", { altKey: true });
    stub(TabSwitcher, "activate", () => {
      throw new Error("Opened a grid whose release would go unseen");
    });
    stub(TabSwitcher, "quickSwitch", () => {
      throw new Error("Guessed at a release");
    });
    for (
      const [name, unseen] of [
        ["the address bar", { ...page, hasFocus: () => false }],
        ["a PDF", { ...page, contentType: "application/pdf" }],
        ["an embedded page without Brovim", { ...page, activeElement: frame }],
        ["a plugin", { ...page, activeElement: { tagName: "EMBED" } }],
        ["a frame in a shadow root", {
          ...page,
          activeElement: { tagName: "DIV", shadowRoot: { activeElement: frame } },
        }],
      ]
    ) {
      stub(globalThis, "document", unseen);
      stub(TabSwitcher, "cycle", null);
      const result = await TabSwitcher.activateFromBrowserShortcut(name, {
        cycle: { id: "carried", startedAt: 0 },
      });
      assert.equal({ opened: false }, result);
      // The background carries the gesture on to the next tab.
      assert.equal(null, TabSwitcher.cycle);
    }
  });
  should("open over an embedded page that reports its modifier keys", async () => {
    stub(TabSwitcher, "painted", true);
    const frame = { tagName: "IFRAME" };
    stub(globalThis, "document", { activeElement: frame, hasFocus: () => true });
    stub(TabSwitcher, "tabSwitcherUI", null);
    stub(TabSwitcher, "isOpening", false);
    stub(TabSwitcher, "cycle", null);
    stub(TabSwitcher, "shortcutRequest", null);
    stub(TabSwitcher, "keysFrame", null);
    stub(TabSwitcher, "modifierState", {});
    stub(TabSwitcher, "shortcut", Utils.parseBrowserShortcut("Alt+Q"));
    stub(TabSwitcher, "warmUp", () => {});
    const opened = [];
    stub(TabSwitcher, "activate", (_frameId, options) => {
      opened.push(options.showDelay);
      return Promise.resolve(true);
    });
    let quick = 0;
    stub(TabSwitcher, "quickSwitch", () => {
      quick++;
      return Promise.resolve({ opened: true, quickSwitch: true });
    });
    TabSwitcher.recordKeyboardEvent({ type: "keydown", key: "Alt", altKey: true }, true);
    assert.equal(frame, TabSwitcher.keysFrame);
    assert.equal({ opened: true }, await TabSwitcher.activateFromBrowserShortcut("held", {}));
    assert.equal([TabSwitcher.showDelayMs], opened);
    // A tap: the frame reports the release before the shortcut arrives.
    TabSwitcher.recordKeyboardEvent({ type: "keyup", key: "Alt", altKey: false }, true);
    await TabSwitcher.activateFromBrowserShortcut("tapped", {});
    assert.equal(1, quick);
    assert.equal(1, opened.length);
  });
  should("report only the shortcut's modifier, and Shift with it, from an embedded page", () => {
    const sent = [];
    stub(TabSwitcher, "shortcut", Utils.parseBrowserShortcut("Alt+Q"));
    stub(chrome.runtime, "id", "brovim");
    stub(chrome.runtime, "sendMessage", (message) => {
      sent.push(message);
      return Promise.resolve();
    });
    const event = (type, key, modifiers = {}) => ({
      type,
      key,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      repeat: false,
      ...modifiers,
    });
    for (
      const ignored of [
        event("keydown", "a"),
        event("keydown", "Control", { ctrlKey: true }),
        event("keydown", "Shift", { shiftKey: true }),
        event("keydown", "Alt", { altKey: true, repeat: true }),
      ]
    ) TabSwitcher.reportKeyboardEvent(ignored);
    assert.equal([], sent);
    TabSwitcher.reportKeyboardEvent(event("keydown", "Alt", { altKey: true }));
    TabSwitcher.reportKeyboardEvent(event("keydown", "Shift", { altKey: true, shiftKey: true }));
    TabSwitcher.reportKeyboardEvent(event("keyup", "Alt"));
    // The modifier going down also tells the background directly that this tab saw the press begin.
    assert.equal(1, sent.filter(({ handler }) => handler === "warmTabSwitcher").length);
    assert.equal("warmTabSwitcher", sent[0].handler);
    assert.equal(
      [
        ["keydown", "Alt", true, false],
        ["keydown", "Shift", true, true],
        ["keyup", "Alt", false, false],
      ],
      sent.filter(({ handler }) => handler !== "warmTabSwitcher").map(
        ({ handler, frameId, message }) => {
          assert.equal(["sendMessageToFrames", 0, "tabSwitcherKey"], [
            handler,
            frameId,
            message.handler,
          ]);
          const { type, key, altKey, shiftKey } = message.event;
          return [type, key, altKey, shiftKey];
        },
      ),
    );
  });
  should("show a held grid only after the tap window, and never for a tap", async () => {
    stub(TabSwitcher, "painted", true);
    stub(globalThis, "document", { activeElement: { tagName: "BODY" }, hasFocus: () => true });
    stub(TabSwitcher, "showDelayMs", 30);
    stub(TabSwitcher, "shortcut", Utils.parseBrowserShortcut("Alt+Q"));
    stub(TabSwitcher, "cycle", null);
    stub(TabSwitcher, "shortcutRequest", null);
    stub(TabSwitcher, "isOpening", false);
    stub(TabSwitcher, "isAltCycling", false);
    stub(TabSwitcher, "openingGeneration", 0);
    stub(TabSwitcher, "uiLoad", Promise.resolve());
    stub(TabSwitcher, "init", () => {});
    const shown = [];
    stub(TabSwitcher, "tabSwitcherUI", {
      showing: false,
      iframePort: Promise.resolve(),
      show(message, focusOptions) {
        shown.push([message.name, focusOptions.restoreFocus]);
        this.showing = true;
        return Promise.resolve();
      },
      hide() {},
    });
    const switched = [];
    stub(chrome.runtime, "sendMessage", (message) => {
      switched.push(message.handler);
      return Promise.resolve({ switched: true });
    });
    const alt = (type) => ({ type, key: "Alt", altKey: type === "keydown", repeat: false });

    TabSwitcher.recordKeyboardEvent(alt("keydown"));
    const tap = TabSwitcher.activateFromBrowserShortcut("tap", {});
    await new Promise((resolve) => setTimeout(resolve, 5));
    TabSwitcher.recordKeyboardEvent(alt("keyup"));
    assert.equal({ opened: true, quickSwitch: true }, await tap);
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal([], shown);
    assert.equal(["quickSwitchTab"], switched);

    TabSwitcher.recordKeyboardEvent(alt("keydown"));
    const hold = TabSwitcher.activateFromBrowserShortcut("hold", {});
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal([], shown);
    assert.equal({ opened: true }, await hold);
    // The grid returns the focus to whatever had it: the user may have been typing.
    assert.equal([["activate", true]], shown);
  });

  should("drop a press that waited while the press before it switched tabs", async () => {
    const source = { id: 921, windowId: 892, index: 0, active: true, url: "https://busy.example/" };
    const peer = { id: 922, windowId: 892, index: 1, url: "https://peer.example/" };
    const third = { id: 923, windowId: 892, index: 2, url: "https://third.example/" };
    let active = source;
    stub(
      chrome.tabs,
      "query",
      (query) => Promise.resolve(query.active ? [active] : [source, peer, third]),
    );
    const asked = [];
    let answer;
    stub(chrome.tabs, "sendMessage", (id, message) => {
      if (message.handler !== "openTabSwitcher") return Promise.resolve();
      asked.push(id);
      return new Promise((resolve) => answer = resolve);
    });
    stub(chrome.tabs, "update", () => {
      throw new Error("The spent press switched tabs a second time");
    });
    // A busy page takes its time to answer; an impatient second press queues behind the first.
    SwitcherCommands.noteModifierDown(source.id);
    const first = SwitcherCommands.openTabSwitcher(source);
    const second = SwitcherCommands.openTabSwitcher(source);
    while (!answer) await new Promise((resolve) => setTimeout(resolve, 1));
    // The page answers at last: it was a tap, and it has switched to the peer.
    active = { ...peer, active: true };
    answer({ opened: true });
    await Promise.all([first, second]);
    assert.equal([921], asked);
    SwitcherCommands.endTabSwitcherCycle(892);
  });
  should("switch directly only until a slow grid frame has started", async () => {
    let started;
    const ui = { showing: false, iframePort: new Promise((resolve) => started = resolve) };
    stub(TabSwitcher, "tabSwitcherUI", ui);
    stub(TabSwitcher, "currentRequestId", "slow");
    stub(TabSwitcher, "shortcutRequest", null);
    stub(TabSwitcher, "isUnavailable", false);
    TabSwitcher.suspend("stale");
    assert.isFalse(TabSwitcher.isUnavailable);
    TabSwitcher.suspend("slow");
    assert.isTrue(TabSwitcher.isUnavailable);
    assert.equal({ opened: false }, await TabSwitcher.activateFromBrowserShortcut("next", {}));
    started();
    await ui.iframePort;
    await Promise.resolve();
    assert.isFalse(TabSwitcher.isUnavailable);
  });

  should(
    "hand a held gesture to the next tab only when that tab can tell a hold from a tap",
    async () => {
      const tabs = [811, 812, 813].map((id, index) => ({
        id,
        index,
        windowId: 891,
        active: index === 0,
        url: "https://example.com/",
      }));
      stub(
        chrome.tabs,
        "query",
        (query) => Promise.resolve(tabs.filter((t) => !query.active || t.active)),
      );
      stub(chrome.tabs, "update", (id) => {
        for (const tab of tabs) tab.active = tab.id === id;
        return Promise.resolve(tabs.find((t) => t.id === id));
      });
      // In the background, the time since the service worker started.
      let now = 10_000;
      stub(performance, "now", () => now);
      let answer;
      const handoffs = [];
      stub(chrome.tabs, "sendMessage", (_id, message) => {
        if (message.handler === "openTabSwitcher") return answer();
        if (message.handler === "rememberTabSwitcherCycle") handoffs.push(message.handoff);
        return Promise.resolve();
      });
      await bgUtils.tabRecency.init();
      const press = async () => {
        for (const tab of tabs) tab.active = tab.id === 811;
        for (const id of [813, 812, 811]) bgUtils.tabRecency.register(id);
        SwitcherCommands.noteModifierDown(811);
        await SwitcherCommands.openTabSwitcher(tabs[0]);
        SwitcherCommands.endTabSwitcherCycle(891);
      };
      try {
        // The page saw the modifier still held, but couldn't show the grid: it isn't being drawn.
        answer = () => Promise.resolve({ opened: false, held: true });
        await press();
        // No page could see the keys (the address bar had the focus), and the switch was quick.
        answer = () => Promise.resolve({ opened: false });
        await press();
        // The same, but the switch came late: the release may already have been lost.
        answer = () => {
          now += 150;
          return Promise.resolve({ opened: false });
        };
        await press();
        // The press had to start the stopped background, so it arrived late itself.
        now = 30;
        answer = () => Promise.resolve({ opened: false });
        await press();
        assert.equal(["held", "unknown", undefined, undefined], handoffs);
      } finally {
        SwitcherCommands.endTabSwitcherCycle(891);
      }
    },
  );
  should(
    "show a handed-off gesture's grid after the tap window, and let a tap end it",
    async () => {
      stub(TabSwitcher, "painted", true);
      stub(globalThis, "document", { activeElement: { tagName: "BODY" }, hasFocus: () => true });
      stub(TabSwitcher, "showDelayMs", 30);
      stub(TabSwitcher, "shortcut", Utils.parseBrowserShortcut("Alt+Q"));
      stub(TabSwitcher, "cycle", null);
      stub(TabSwitcher, "shortcutRequest", null);
      stub(TabSwitcher, "isOpening", false);
      stub(TabSwitcher, "isAltCycling", false);
      stub(TabSwitcher, "openingGeneration", 0);
      stub(TabSwitcher, "modifierState", {});
      stub(TabSwitcher, "keyboardEventAt", 0);
      stub(TabSwitcher, "uiLoad", Promise.resolve());
      stub(TabSwitcher, "init", () => {});
      const shown = [];
      stub(TabSwitcher, "tabSwitcherUI", {
        showing: false,
        iframePort: Promise.resolve(),
        show(message) {
          shown.push(message.cycle?.selectedId);
          this.showing = true;
          return Promise.resolve();
        },
        hide() {},
      });
      const sent = [];
      stub(chrome.runtime, "sendMessage", (message) => {
        sent.push([message.handler, message.cycle?.selectedId]);
        return Promise.resolve({ switched: true });
      });
      // The gesture began on tab 1, which couldn't show the grid, and switched to tab 2.
      const cycle = (id) => ({
        id,
        startedAt: Date.now() - 5,
        tabIds: [1, 2, 3],
        sourceId: 1,
        selectedId: 2,
        previousId: 2,
      });
      const alt = (type) => ({ type, key: "Alt", altKey: type === "keydown", repeat: false });

      // A tap: its release reaches this tab within the tap window, and the switch was all it
      // wanted. Committing the gesture's selection, this tab, switches nowhere else.
      TabSwitcher.rememberCycle(cycle("tap"), TabSwitcher.shortcut);
      const tap = TabSwitcher.activateFromBrowserShortcut("tap", {
        cycle: cycle("tap"),
        showDelay: 30,
      });
      await new Promise((resolve) => setTimeout(resolve, 5));
      TabSwitcher.recordKeyboardEvent(alt("keyup"));
      await tap;
      await new Promise((resolve) => setTimeout(resolve, 50));
      assert.equal([], shown);
      assert.equal([["quickSwitchTab", 2]], sent);

      // A hold: the grid shows after the tap window, with the gesture's own list and selection.
      await new Promise((resolve) => setTimeout(resolve, 10));
      TabSwitcher.rememberCycle(cycle("hold"), TabSwitcher.shortcut);
      assert.equal(
        { opened: true },
        await TabSwitcher.activateFromBrowserShortcut("hold", {
          cycle: cycle("hold"),
          showDelay: 30,
        }),
      );
      assert.equal([2], shown);
    },
  );
  should("keep a handed-off grid for a hold, and drop it for a tap a busy page saw", () => {
    const cancelled = [];
    const ended = [];
    stub(TabSwitcher, "cancel", (id) => cancelled.push(id));
    stub(TabSwitcher, "endCycle", () => ended.push(TabSwitcher.cycle?.id));
    stub(TabSwitcher, "currentRequestId", "request");
    stub(TabSwitcher, "modifierReleased", () => false);
    stub(TabSwitcher, "isOpening", false);
    stub(TabSwitcher, "tabSwitcherUI", { showing: true });
    stub(TabSwitcher, "cycle", { id: "gesture" });
    // The grid this page showed for a hold stays; a newer gesture ignores the old answer.
    assert.isFalse(TabSwitcher.showsHeldGrid("gesture", true));
    assert.isFalse(TabSwitcher.showsHeldGrid("older", false));
    assert.equal([[], []], [cancelled, ended]);
    // The busy page took the release before the switch: it was a tap.
    assert.isFalse(TabSwitcher.showsHeldGrid("gesture", false));
    assert.equal([["request"], ["gesture"]], [cancelled, ended]);
    // No grid yet: show it for a hold, unless this page saw the release since.
    TabSwitcher.tabSwitcherUI.showing = false;
    assert.isTrue(TabSwitcher.showsHeldGrid("gesture", true));
    TabSwitcher.modifierReleased = () => true;
    assert.isFalse(TabSwitcher.showsHeldGrid("gesture", true));
  });

  should("wait for the focus that follows a switch, but not for long", async () => {
    let focused = false;
    stub(globalThis, "document", { hasFocus: () => focused });
    let start = Date.now();
    const waiting = TabSwitcher.whenFocused(500);
    focused = true;
    globalThis.dispatchEvent(new Event("focus"));
    await waiting;
    assert.isTrue(Date.now() - start < 400);
    focused = false;
    start = Date.now();
    await TabSwitcher.whenFocused(30);
    assert.isTrue(Date.now() - start >= 25);
  });

  should("ignore a tap reported by a tab the background already left", async () => {
    let updated = false;
    stub(chrome.tabs, "update", () => {
      updated = true;
      return Promise.resolve();
    });
    const result = await sendRequestHandlers.quickSwitchTab({
      tab: { id: 861, windowId: 7, active: false },
    });
    assert.isTrue(result.switched);
    assert.isFalse(updated);
  });

  should("remember when the modifier went up, by the key event's own time", () => {
    stub(TabSwitcher, "shortcut", Utils.parseBrowserShortcut("Alt+Q"));
    stub(TabSwitcher, "cycle", null);
    stub(TabSwitcher, "shortcutRequest", null);
    stub(TabSwitcher, "modifierState", {});
    stub(TabSwitcher, "modifierUpAt", 0);
    stub(TabSwitcher, "onModifierReleased", () => {});
    const keyup = (key, timeStamp) => ({ type: "keyup", key, altKey: false, timeStamp });
    TabSwitcher.recordKeyboardEvent(keyup("q", 10));
    assert.equal(0, TabSwitcher.modifierUpAt);
    // A busy page handles the release late: the event's time says when it happened.
    TabSwitcher.recordKeyboardEvent(keyup("Alt", 25));
    assert.equal(performance.timeOrigin + 25, TabSwitcher.modifierUpAt);
  });

  should("report a held modifier only after seeing it go down during this gesture", () => {
    stub(TabSwitcher, "shortcut", Utils.parseBrowserShortcut("Alt+Q"));
    stub(TabSwitcher, "cycle", null);
    stub(TabSwitcher, "modifierState", {});
    stub(TabSwitcher, "keyboardEventAt", 0);
    stub(TabSwitcher, "shortcutRequest", null);
    stub(TabSwitcher, "tabSwitcherUI", null);
    stub(TabSwitcher, "isOpening", false);
    stub(TabSwitcher, "isAltCycling", false);
    assert.isFalse(TabSwitcher.modifierHeld());
    TabSwitcher.recordKeyboardEvent({ type: "keydown", key: "Alt", altKey: true, repeat: false });
    assert.isTrue(TabSwitcher.modifierHeld());
    // A gesture carried here from another tab began after this page's last key event.
    stub(TabSwitcher, "cycle", { id: "later", startedAt: Date.now() + 1000 });
    assert.isFalse(TabSwitcher.modifierHeld());
    stub(TabSwitcher, "cycle", null);
    TabSwitcher.recordKeyboardEvent({ type: "keyup", key: "Alt", altKey: false, repeat: false });
    assert.isFalse(TabSwitcher.modifierHeld());
  });
  should("leave a page the browser hasn't drawn yet to the background at once", async () => {
    // Waiting for a script in its head, the page shows nothing and gets no keys: it can't tell a
    // hold from a tap. Declining at once lets the next tab do that, while the press is fresh.
    stub(globalThis, "document", { activeElement: { tagName: "BODY" }, hasFocus: () => true });
    stub(TabSwitcher, "painted", false);
    stub(TabSwitcher, "tabSwitcherUI", null);
    stub(TabSwitcher, "isOpening", false);
    stub(TabSwitcher, "isUnavailable", false);
    stub(TabSwitcher, "cycle", null);
    stub(TabSwitcher, "modifierState", {});
    stub(TabSwitcher, "keyboardEventAt", 0);
    stub(TabSwitcher, "shortcut", Utils.parseBrowserShortcut("Alt+Q"));
    let opened = 0;
    stub(TabSwitcher, "activate", () => {
      opened++;
      return Promise.resolve(true);
    });
    assert.equal({ opened: false }, await TabSwitcher.activateFromBrowserShortcut("blank", {}));
    assert.equal(0, opened);
    // Drawn, it handles the shortcut itself.
    TabSwitcher.painted = true;
    TabSwitcher.recordKeyboardEvent({ type: "keydown", key: "Alt", altKey: true, repeat: false });
    assert.equal({ opened: true }, await TabSwitcher.activateFromBrowserShortcut("drawn", {}));
    assert.equal(1, opened);
  });
  should("rebuild the grid's frame if the page threw it away", () => {
    let closed = 0;
    const old = { detached: true, messageChannelPorts: [{ close: () => closed++ }] };
    stub(TabSwitcher, "tabSwitcherUI", old);
    stub(TabSwitcher, "backdrop", {});
    stub(TabSwitcher, "uiLoad", null);
    const loads = [];
    stub(UIComponent.prototype, "load", (url, _className, _handler, options) => {
      loads.push([url, options]);
      return Promise.resolve();
    });
    TabSwitcher.init();
    assert.isTrue(TabSwitcher.tabSwitcherUI !== old);
    assert.equal(null, TabSwitcher.backdrop);
    assert.equal(1, closed);
    // It joins a page that is still arriving: the shortcut works while a page loads.
    assert.equal([["pages/tab_switcher_page.html", { early: true }]], loads);
    // A frame still in the page is kept.
    const current = TabSwitcher.tabSwitcherUI;
    TabSwitcher.init();
    assert.equal(current, TabSwitcher.tabSwitcherUI);
  });

  should(
    "keep the background running only while a tab that can't show the grid is in front",
    async () => {
      const intervals = [];
      const cleared = [];
      stub(globalThis, "setInterval", (_callback, ms) => intervals.push(ms));
      stub(globalThis, "clearInterval", (id) => cleared.push(id));
      let answer;
      stub(chrome.tabs, "sendMessage", () => answer());
      stub(chrome.tabs, "query", () => Promise.resolve([{ id: 7 }]));
      // A browser page without Brovim, or one still blank: nothing answers.
      answer = () => Promise.reject(new Error("Receiving end does not exist"));
      await SwitcherCommands.checkFrontTab(7);
      await SwitcherCommands.checkFrontTab(7);
      assert.equal([20_000], intervals);
      // A website: it wakes the background itself as the shortcut's modifier goes down.
      answer = () => Promise.resolve(true);
      await SwitcherCommands.checkFrontTab(7);
      assert.equal([1], cleared);
      // An answer from a tab that has left the front changes nothing.
      answer = () => Promise.resolve(false);
      stub(chrome.tabs, "query", () => Promise.resolve([{ id: 8 }]));
      await SwitcherCommands.checkFrontTab(7);
      assert.equal([20_000], intervals);
    },
  );

  should(
    "switch from a busy page before a tap lets go, and let the tab it lands on decide",
    async () => {
      const tabs = [831, 832, 833].map((id, index) => ({
        id,
        index,
        windowId: 893,
        active: index === 0,
        url: "https://busy.example/",
      }));
      stub(
        chrome.tabs,
        "query",
        (query) => Promise.resolve(tabs.filter((t) => !query.active || t.active)),
      );
      // In the background, the time since the service worker started.
      let now = 10_000;
      let lateBy = 0;
      stub(performance, "now", () => now);
      stub(chrome.tabs, "update", (id) => {
        now += lateBy;
        for (const tab of tabs) tab.active = tab.id === id;
        return Promise.resolve(tabs.find((t) => t.id === id));
      });
      const sent = [];
      let verdict;
      stub(chrome.tabs, "sendMessage", (id, message) => {
        sent.push([id, message.handler, message.handoff ?? message.held]);
        // The source is busy: nothing it is asked gets an answer until it catches up.
        if (id === 831 && message.handler === "tabSwitcherPing") return new Promise(() => {});
        if (id === 831 && message.handler === "heldTabSwitcherShortcut") {
          return new Promise((resolve) => verdict = resolve);
        }
        if (message.handler === "rememberTabSwitcherCycle") {
          return Promise.resolve({ watching: true });
        }
        return Promise.resolve();
      });
      await bgUtils.tabRecency.init();
      // - held: whether the busy page saw the shortcut held (or else its release) when it catches up.
      // - late: how long the switch took past the press.
      // - released: whether it saw the modifier go up since the press.
      const press = async (held, late = 0, released = !held) => {
        for (const tab of tabs) tab.active = tab.id === 831;
        for (const id of [833, 832, 831]) bgUtils.tabRecency.register(id);
        sent.length = 0;
        lateBy = late;
        // The page saw the modifier go down, then got busy.
        SwitcherCommands.noteModifierDown(831);
        await Promise.race([
          SwitcherCommands.openTabSwitcher(tabs[0]),
          new Promise((resolve) => setTimeout(resolve, 1000)),
        ]);
        // It switched as soon as the page failed to answer, without asking it for the grid.
        assert.isTrue(tabs[1].active);
        assert.isFalse(sent.some(([, handler]) => handler === "openTabSwitcher"));
        const handoff = sent.find(([, handler]) => handler === "rememberTabSwitcherCycle")[2];
        verdict({ held, released });
        await new Promise((resolve) => setTimeout(resolve, 0));
        SwitcherCommands.endTabSwitcherCycle(893);
        return [handoff, sent.filter(([, handler]) => handler === "tabSwitcherHeld")];
      };
      try {
        // A quick switch: the tab it lands on tells a hold from a tap itself. The busy page only
        // corrects it if it took a tap's release before the switch.
        assert.equal(["unknown", []], await press(true));
        assert.equal(["unknown", [[832, "tabSwitcherHeld", false]]], await press(false));
        // It never saw the keys (a loading page gets none before it is drawn): the grid stays.
        assert.equal(["unknown", []], await press(false, 0, false));
        // A late switch: the release may already be gone, so that tab waits for the busy page.
        assert.equal(["verdict", [[832, "tabSwitcherHeld", true]]], await press(true, 150));
        assert.equal(["verdict", [[832, "tabSwitcherHeld", false]]], await press(false, 150));
      } finally {
        SwitcherCommands.endTabSwitcherCycle(893);
      }
    },
  );
  should("give a page that hasn't said the press began less time to answer", async () => {
    const tabs = [871, 872, 873].map((id, index) => ({
      id,
      index,
      windowId: 896,
      active: index === 0,
      status: "complete",
      url: "https://example.com/",
    }));
    stub(
      chrome.tabs,
      "query",
      (query) => Promise.resolve(tabs.filter((t) => !query.active || t.active)),
    );
    stub(chrome.tabs, "update", (id) => {
      for (const tab of tabs) tab.active = tab.id === id;
      return Promise.resolve(tabs.find((t) => t.id === id));
    });
    // How long the page takes to answer the ping.
    let busyFor = 0;
    const sent = [];
    stub(chrome.tabs, "sendMessage", (id, message) => {
      sent.push([id, message.handler, message.handoff]);
      if (message.handler === "tabSwitcherPing") {
        return new Promise((resolve) => setTimeout(() => resolve(true), busyFor));
      }
      if (message.handler === "openTabSwitcher") return Promise.resolve({ opened: true });
      return Promise.resolve({ watching: true });
    });
    await bgUtils.tabRecency.init();
    // - seen: whether the page said the press began: "before" the shortcut, "after" it, or never.
    const press = async (seen, ms) => {
      for (const tab of tabs) tab.active = tab.id === 871;
      for (const id of [873, 872, 871]) bgUtils.tabRecency.register(id);
      sent.length = 0;
      busyFor = ms;
      SwitcherCommands.noteModifierDown(seen === "before" ? 871 : 999);
      if (seen === "after") setTimeout(() => SwitcherCommands.noteModifierDown(871), 3);
      await SwitcherCommands.openTabSwitcher(tabs[0]);
      SwitcherCommands.endTabSwitcherCycle(896);
      // Leaves out the busy page's later correction: see awaitVerdict.
      return sent.filter(([, handler]) =>
        !["tabSwitcherPing", "heldTabSwitcherShortcut"].includes(handler)
      );
    };
    try {
      // A page that answers at once is asked for the grid.
      assert.equal([[871, "openTabSwitcher", undefined]], await press(false, 0));
      // It missed the press: busy for a moment is too long.
      assert.equal([[872, "rememberTabSwitcherCycle", "unknown"]], await press(false, 25));
      assert.isTrue(tabs[1].active);
      // It saw the press begin, even if its word came just after the shortcut: that moment is fine.
      assert.equal([[871, "openTabSwitcher", undefined]], await press("before", 25));
      assert.isTrue(tabs[0].active);
      assert.equal([[871, "openTabSwitcher", undefined]], await press("after", 25));
      assert.isTrue(tabs[0].active);
    } finally {
      SwitcherCommands.endTabSwitcherCycle(896);
    }
  });

  should("switch from a page still arriving without waiting for Brovim to load there", async () => {
    const tabs = [851, 852, 853].map((id, index) => ({
      id,
      index,
      windowId: 895,
      active: index === 0,
      // A tab woken from sleep: its page is on its way, and nothing in it answers yet.
      status: index === 0 ? "loading" : "complete",
      url: "https://waking.example/",
    }));
    stub(
      chrome.tabs,
      "query",
      (query) => Promise.resolve(tabs.filter((t) => !query.active || t.active)),
    );
    stub(chrome.tabs, "update", (id) => {
      for (const tab of tabs) tab.active = tab.id === id;
      return Promise.resolve(tabs.find((t) => t.id === id));
    });
    const sent = [];
    stub(chrome.tabs, "sendMessage", (id, message) => {
      sent.push([id, message.handler, message.handoff]);
      if (id === 851) return Promise.reject(new Error("Receiving end does not exist."));
      return Promise.resolve({ watching: true });
    });
    let injected = false;
    stub(chrome.scripting, "executeScript", () => {
      injected = true;
      return new Promise(() => {});
    });
    await bgUtils.tabRecency.init();
    for (const id of [853, 852, 851]) bgUtils.tabRecency.register(id);
    try {
      await SwitcherCommands.openTabSwitcher(tabs[0]);
      assert.isTrue(tabs[1].active);
      assert.isFalse(injected);
      assert.equal(
        [852, "rememberTabSwitcherCycle", "unknown"],
        sent.find(([, handler]) => handler === "rememberTabSwitcherCycle"),
      );
    } finally {
      SwitcherCommands.endTabSwitcherCycle(895);
    }
  });
  should(
    "count a press on tabs that can't see the modifier as held only if it comes quickly",
    async () => {
      const tabs = [841, 842, 843, 844].map((id, index) => ({
        id,
        index,
        windowId: 894,
        active: index === 0,
        url: "https://protected.example/",
      }));
      stub(
        chrome.tabs,
        "query",
        (query) => Promise.resolve(tabs.filter((t) => !query.active || t.active)),
      );
      // No page can see the keys: nothing answers.
      stub(chrome.tabs, "sendMessage", () => Promise.reject(new Error("No receiver")));
      const selected = [];
      stub(chrome.tabs, "update", (id) => {
        for (const tab of tabs) tab.active = tab.id === id;
        bgUtils.tabRecency.register(id);
        selected.push(id);
        return Promise.resolve(tabs.find((t) => t.id === id));
      });
      let now = 10_000;
      stub(performance, "now", () => now);
      await bgUtils.tabRecency.init();
      for (const id of [844, 843, 842, 841]) bgUtils.tabRecency.register(id);
      const press = () => SwitcherCommands.openTabSwitcher(tabs.find((tab) => tab.active));
      try {
        await press();
        // Quick: the modifier is still held, so the gesture walks on.
        now += 300;
        await press();
        // Slow: a new tap, back to the tab before this one.
        now += 700;
        await press();
        assert.equal([842, 843, 842], selected);
      } finally {
        SwitcherCommands.endTabSwitcherCycle(894);
      }
    },
  );

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
    const result = await sendRequestHandlers.quickSwitchTab({
      tab: { id: 201, windowId: 7, active: true },
    });
    assert.isTrue(result.switched);
    assert.equal({ id: 204, active: true }, selected);
  });

  should("give a tab still waiting for its first page the address it is loading", async () => {
    stub(chrome.tabs, "query", () =>
      Promise.resolve([
        { id: 1, index: 0, title: "Loaded", url: "https://example.com/", active: true },
        { id: 2, index: 1, title: "", url: "", pendingUrl: "https://slow.example/page" },
      ]));
    const tabs = await sendRequestHandlers.getOpenTabsWithScreenshots({ tab: { windowId: 1 } });
    assert.equal(
      ["https://example.com/", "https://slow.example/page"],
      tabs.map((tab) => tab.url),
    );
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

  should("take no previews of sites excluded from Brovim", async () => {
    const url = "https://excluded-preview.example/inbox";
    const get = Settings.get.bind(Settings);
    stub(
      Settings,
      "get",
      (key) =>
        key === "exclusionRules"
          ? [{ pattern: "https?://excluded-preview.example/*", passKeys: "" }]
          : get(key),
    );
    stub(chrome.tabs, "get", () => Promise.resolve({ active: true, status: "complete", url }));
    stub(chrome.tabs, "sendMessage", () => Promise.resolve({ allowed: true }));
    stub(chrome.tabs, "captureVisibleTab", () => {
      throw new Error("An excluded site must not be captured");
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
          tab: { id: activeId, windowId: 7, active: true },
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

  should("retain fifteen visited previews after the worker reloads", async () => {
    await Settings.onLoaded();
    await Settings.set(
      "tabSwitcherMaxThumbnails",
      Settings.defaultOptions.tabSwitcherMaxThumbnails,
    );
    const urls = Array.from({ length: 15 }, (_, i) => `https://retained-preview.example/${i}`);
    for (const [i, url] of urls.entries()) {
      await storeThumbnail(url, false, `normal-${i}`);
      await storeThumbnail(url, true, `private-${i}`);
    }
    const reloaded = await import("../../background_scripts/thumbnails.js?retention-reload");
    await reloaded.warmThumbnailCaches();
    assert.equal(urls.map((_, i) => `normal-${i}`), await reloaded.findThumbnails(urls, false));
    assert.equal(urls.map((_, i) => `private-${i}`), await reloaded.findThumbnails(urls, true));
  });

  should("keep the byte cap when retaining more previews", async () => {
    stub(chrome.storage.local, "get", () => Promise.resolve({}));
    let stored;
    stub(chrome.storage.local, "set", (items) => {
      stored = items.tabThumbnails;
      return Promise.resolve();
    });
    const bounded = await import("../../background_scripts/thumbnails.js?byte-cap");
    const preview = "x".repeat(2 * 1024 * 1024);
    for (let i = 0; i < 4; i++) {
      await bounded.storeThumbnail(`https://large-preview.example/${i}`, false, preview);
    }
    assert.equal(3, Object.keys(stored).length);
    assert.equal(undefined, stored["https://large-preview.example/0"]);
    assert.equal(
      6 * 1024 * 1024,
      Object.values(stored).reduce((sum, value) => sum + value.length, 0),
    );
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
    "cap imported preview limits at fifty and trim immediately when lowered to fifteen",
    async () => {
      await Settings.onLoaded();
      await Settings.set("tabSwitcherMaxThumbnails", 240);
      const urls = Array.from({ length: 55 }, (_, i) => `https://preview-cap.example/${i}`);
      try {
        for (const url of urls) await storeThumbnail(url, false, url);
        assert.equal(50, (await findThumbnails(urls, false)).filter(Boolean).length);
        await Settings.set("tabSwitcherMaxThumbnails", 15);
        await trimThumbnailCaches();
        assert.equal(urls.slice(-15), (await findThumbnails(urls, false)).filter(Boolean));
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
