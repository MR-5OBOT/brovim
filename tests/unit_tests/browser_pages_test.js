import "./test_helper.js";
import { browserPages, filterBrowserPages } from "../../lib/browser_pages.js";

context("browser pages", () => {
  should("show browser destinations before any query", () => {
    const pages = filterBrowserPages();
    assert.equal("settings", pages[0].id);
    assert.isTrue(pages.some((page) => page.id === "extensions"));
    assert.isTrue(pages.some((page) => page.id === "performance"));
    assert.equal(3, pages.length);
  });
  should("rank extension and performance prefixes and match aliases", () => {
    assert.equal("extensions", filterBrowserPages("ext")[0].id);
    assert.equal("performance", filterBrowserPages("perf")[0].id);
    assert.equal("performance", filterBrowserPages("ram saver")[0].id);
    assert.equal("extension-shortcuts", filterBrowserPages("extension hotkeys")[0].id);
  });
  should("never turn an unmatched query into a web search or arbitrary URL", () => {
    assert.equal([], filterBrowserPages("https://example.com"));
    assert.equal([], filterBrowserPages("javascript:alert(1)"));
    assert.equal([], filterBrowserPages("does-not-exist-123456"));
    assert.isTrue(browserPages.every((page) => page.url.startsWith("chrome://")));
    assert.equal(browserPages.length, new Set(browserPages.map((page) => page.id)).size);
  });
  should("include Helium's keyboard-shortcuts page", () => {
    assert.equal(
      "chrome://settings/system/shortcuts",
      filterBrowserPages("browser keyboard")[0].url,
    );
  });
});
