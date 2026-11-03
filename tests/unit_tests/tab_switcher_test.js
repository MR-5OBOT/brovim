import "./test_helper.js";
import "../../tests/unit_tests/test_chrome_stubs.js";
import "../../content_scripts/mode.js";
import "../../content_scripts/ui_component.js";
import "../../content_scripts/tab_switcher.js";
import "../../background_scripts/main.js";

context("TabSwitcher", () => {
  should("initialize and open tab switcher UI", () => {
    let shown = false;
    TabSwitcher.tabSwitcherUI = {
      show: () => {
        shown = true;
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
    const tabs = await handler();
    assert.equal(1, tabs.length);
    assert.equal("Test Tab", tabs[0].title);
    assert.equal(null, tabs[0].screenshot);
  });
});
