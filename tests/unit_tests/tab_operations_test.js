import "./test_helper.js";
import "../../lib/settings.js";
import * as to from "../../background_scripts/tab_operations.js";

context("TabOperations openurlInCurrentTab", () => {
  should("keep a search in the requesting tab when another tab becomes active", async () => {
    let query;
    stub(chrome.search, "query", (info) => query = info);
    await to.openUrlInCurrentTab({ url: "source tab search", tabId: 42 });
    assert.equal({ text: "source tab search", tabId: 42 }, query);
  });
  should("open a regular URL", async () => {
    let url = null;
    stub(chrome.tabs, "update", (_id, args) => {
      url = args.url;
    });
    const expected = "http://example.com";
    await to.openUrlInCurrentTab({ url: expected });
    assert.equal(expected, url);
  });

  should("open a non-URL in the default search engine", async () => {
    let searchQuery = null;
    stub(chrome.search, "query", (queryInfo) => {
      searchQuery = queryInfo.text;
    });
    const expected = "example query";
    await to.openUrlInCurrentTab({ url: expected });
    assert.equal(expected, searchQuery);
  });

  should("open a javascript URL", async () => {
    let details = null;
    // NOTE: This is a shallow test.
    stub(chrome.scripting, "executeScript", (_details) => {
      details = _details;
    });
    const expected = "javascript:console.log('hello')";
    await to.openUrlInCurrentTab({ url: expected }, { frameId: 0 });
    assert.equal(expected, details.args[0]);
  });

  should("allow opening a javascript URL requested from the vomnibar's iframe", async () => {
    let details = null;
    stub(chrome.scripting, "executeScript", (_details) => {
      details = _details;
    });
    const expected = "javascript:console.log('hello')";
    // The vomnibar's iframe is a distinct frame with its own (non-zero) frameId, so it's
    // identified as trusted via its chrome-extension:// URL rather than via frameId.
    const sender = { frameId: 7, url: "chrome-extension://abc/pages/vomnibar_page.html" };
    await to.openUrlInCurrentTab({ url: expected }, sender);
    assert.equal(expected, details.args[0]);
  });

  should("disallow opening a javascript URL requested from an untrusted subframe", async () => {
    let called = false;
    stub(console, "warn", () => {}); // Silence the warning during this test.
    stub(chrome.scripting, "executeScript", () => {
      called = true;
    });
    const url = "javascript:console.log('hello')";
    // Simulates a cross-origin subframe (not the top frame, not one of Brovim's own pages).
    const sender = { frameId: 5, url: "https://attacker.example.com/iframe.html" };
    await to.openUrlInCurrentTab({ url }, sender);
    assert.isFalse(called);
  });
});

context("TabOperations openUrlInNewWindow", () => {
  let config, query;
  setup(() => {
    stub(chrome.windows, "create", (details) => {
      config = details;
      return Promise.resolve({ id: 7, tabs: [{ id: 42 }] });
    });
    stub(chrome.search, "query", (details) => {
      query = details;
      return Promise.resolve();
    });
  });

  should("open URLs with the window's focused option", async () => {
    await to.openUrlInNewWindow({ url: "https://example.com", active: false });
    assert.equal({ focused: false, url: "https://example.com" }, config);
  });

  should("omit the special new-tab URL and focus by default", async () => {
    await to.openUrlInNewWindow({ url: UrlUtils.chromeNewTabUrl });
    assert.equal({ focused: true }, config);
  });

  should("send searches to the new window's tab", async () => {
    await to.openUrlInNewWindow({ url: "new window search" });
    assert.equal({ focused: true }, config);
    assert.equal({ text: "new window search", tabId: 42 }, query);
  });
});

context("TabOperations openUrlInNewTab", () => {
  should("open a regular URL", async () => {
    let config = null;
    stub(chrome.tabs, "create", (_config) => {
      config = _config;
      const newTab = { url: config.url };
      return newTab;
    });
    const expected = "http://example.com";
    const tab = await to.openUrlInNewTab({
      tab: { index: 1 },
      position: "after",
      url: expected,
    });
    assert.equal(2, config.index);
    assert.equal(expected, tab.url);
  });

  should("open a non-URL in the default search engine", async () => {
    let createConfig, queryInfo;
    stub(chrome.tabs, "create", (config) => {
      createConfig = config;
      const newTab = { id: config.index };
      return newTab;
    });
    stub(chrome.search, "query", (info) => {
      queryInfo = info;
    });
    await to.openUrlInNewTab({
      tab: { index: 1 },
      position: "after",
      url: "example query",
    });
    assert.equal("data:text/html,<html></html>", createConfig.url);
    assert.equal(2, createConfig.index);
    assert.equal("example query", queryInfo.text);
    assert.equal(2, queryInfo.tabId);
  });
});
