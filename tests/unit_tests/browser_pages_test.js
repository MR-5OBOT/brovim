import "./test_helper.js";
import { filterBrowserPages, getBrowserPages } from "../../lib/browser_pages.js";

context("browser pages", () => {
  should("show browser destinations before any query", () => {
    const pages = filterBrowserPages("helium");
    assert.equal("settings", pages[0].id);
    assert.isTrue(pages.some((page) => page.id === "extensions"));
    assert.isTrue(pages.some((page) => page.id === "performance"));
  });
  should("rank extension and performance prefixes and match aliases", () => {
    assert.equal("extensions", filterBrowserPages("helium", "ext")[0].id);
    assert.equal("performance", filterBrowserPages("helium", "perf")[0].id);
    assert.equal("performance", filterBrowserPages("helium", "ram saver")[0].id);
    assert.equal("extension-shortcuts", filterBrowserPages("helium", "extension hotkeys")[0].id);
  });
  should("never turn an unmatched query into a web search or arbitrary URL", () => {
    assert.equal([], filterBrowserPages("helium", "https://example.com"));
    assert.equal([], filterBrowserPages("helium", "javascript:alert(1)"));
    assert.equal([], filterBrowserPages("helium", "does-not-exist-123456"));
    for (const profile of ["helium", "brave", "chrome", "edge", "chromium"]) {
      const pages = getBrowserPages(profile);
      assert.isTrue(pages.every((page) => /^(chrome|brave|edge):\/\//.test(page.url)));
      assert.equal(pages.length, new Set(pages.map((page) => page.id)).size);
    }
  });
  should("keep browser-only pages and differing destinations in their own profile", () => {
    assert.equal([], filterBrowserPages("helium", "shields"));
    assert.equal("brave://settings/shields", filterBrowserPages("brave", "shields")[0].url);
    assert.equal("brave://settings/system", filterBrowserPages("brave", "performance")[0].url);
    assert.equal("edge://favorites/", filterBrowserPages("edge", "bookmarks")[0].url);
    assert.equal(
      "edge://settings/system/managePerformance",
      filterBrowserPages("edge", "performance")[0].url,
    );
    assert.equal(
      "chrome://settings/system/shortcuts",
      filterBrowserPages("helium", "browser keyboard")[0].url,
    );
    assert.equal([], filterBrowserPages("chrome", "helium"));
  });
});
