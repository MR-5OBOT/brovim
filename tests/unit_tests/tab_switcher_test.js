import "./test_helper.js";
import "../../tests/unit_tests/test_chrome_stubs.js";
import "../../content_scripts/mode.js";
import "../../content_scripts/ui_component.js";
import "../../content_scripts/tab_switcher.js";
import "../../background_scripts/main.js";
import * as bgUtils from "../../background_scripts/bg_utils.js";

context("TabSwitcher", () => {
  should("initialize and open tab switcher UI", () => {
    let shown = false;
    TabSwitcher.tabSwitcherUI = {
      show: () => {
        shown = true;
        return Promise.resolve();
      },
    };
    TabSwitcher.open(0);
    assert.isTrue(shown);
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

  should("list visited tabs most recently used first and include unvisited tabs", async () => {
    stub(chrome.tabs, "query", () =>
      Promise.resolve([
        { id: 11, index: 0, title: "a" },
        { id: 12, index: 1, title: "b" },
        { id: 13, index: 2, title: "c" },
        { id: 14, index: 3, title: "d" },
      ]));
    await bgUtils.tabRecency.init();
    bgUtils.tabRecency.register(11);
    bgUtils.tabRecency.register(13);
    bgUtils.tabRecency.register(12);
    const tabs = await sendRequestHandlers["getOpenTabsWithScreenshots"]({ tab: { windowId: 1 } });
    assert.equal([12, 13, 11, 14], tabs.map((t) => t.id));
  });

  should(
    "keep the active tab first and exclude sleeping tabs without limiting the list",
    async () => {
      const windowTabs = Array.from({ length: 15 }, (_, i) => ({ id: 100 + i, index: i }));
      windowTabs[0].active = true;
      windowTabs[1].discarded = true;
      windowTabs[2].frozen = true;
      stub(chrome.tabs, "query", () => Promise.resolve(windowTabs));
      await bgUtils.tabRecency.init();
      // Deliberately omit the active tab from recency; it must still appear first.
      for (const tab of windowTabs.slice(1)) bgUtils.tabRecency.register(tab.id);
      const tabs = await sendRequestHandlers.getOpenTabsWithScreenshots({ tab: { windowId: 1 } });
      assert.equal([100, ...windowTabs.slice(3).reverse().map((t) => t.id)], tabs.map((t) => t.id));
    },
  );
});
