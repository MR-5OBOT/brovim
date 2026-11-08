import { jsdomStub } from "./test_helper.js";
import "../../lib/settings.js";
import * as messenger from "../../pages/ui_component_messenger.js";

let instance = 0;

context("tab switcher page", () => {
  let port, list, messages, replies, decode, grid, panel, domWindow;
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  const receive = (data) => port.onmessage({ data });
  const reply = (request, result) => receive({ name: "response", id: request.id, result });
  const open = async () => {
    await receive({ name: "activate", overlayId: `overlay-${instance}`, isAltCycle: false });
    await flush();
    assert.isTrue(panel.classList.contains("ready"));
  };
  const press = async (key) => {
    document.dispatchEvent(new domWindow.KeyboardEvent("keydown", { key, bubbles: true }));
    await flush();
  };
  const cards = () => [...grid.children];
  const previewRequests = () =>
    messages.filter((request) => request.message?.handler === "getTabScreenshots");

  setup(async () => {
    await jsdomStub("pages/tab_switcher_page.html");
    domWindow = document.defaultView;
    stub(globalThis, "innerWidth", 1280);
    stub(globalThis, "innerHeight", 900);
    stub(globalThis, "addEventListener", domWindow.addEventListener.bind(domWindow));
    stub(globalThis, "removeEventListener", domWindow.removeEventListener.bind(domWindow));
    stub(globalThis, "getComputedStyle", domWindow.getComputedStyle.bind(domWindow));
    stub(globalThis, "parent", {});
    stub(Settings, "onLoaded", () => Promise.resolve());
    stub(Settings, "get", (key) => Settings.defaultOptions[key]);
    stub(chrome.storage.session, "get", () => Promise.resolve({ vimiumSecret: "test-secret" }));
    decode = () => Promise.resolve();
    stub(domWindow.HTMLImageElement.prototype, "decode", () => decode());
    list = Array.from({ length: 4 }, (_, i) => ({
      id: i + 1,
      index: i,
      title: `Tab ${i + 1}`,
      url: `https://example.com/${i + 1}`,
      screenshot: `data:image/png;base64,preview${i + 1}`,
      active: i === 0,
      lastUsed: i === 1,
    }));
    messages = [];
    replies = {
      getOpenTabsWithScreenshots: () => list.map((tab) => ({ ...tab })),
      getTabScreenshots: () => [],
      closeSpecificTab: ({ id }) => {
        list = list.filter((tab) => tab.id !== id);
        return { closed: true };
      },
    };
    port = {
      postMessage(request) {
        messages.push(request);
        if (request.name !== "request") return;
        const result = replies[request.message.handler]?.(request.message);
        // Tests can withhold a reply without leaving an unresolved test-side promise.
        if (result === "pending") return;
        queueMicrotask(() => reply(request, result));
      },
    };
    messenger.unregister();
    await import(`../../pages/tab_switcher_page.js?test=${++instance}`);
    await messenger.registerPortWithOwnerPage({
      source: globalThis.parent,
      data: "test-secret",
      ports: [port],
    });
    grid = document.getElementById("tab-switcher");
    panel = document.getElementById("panel");
  });

  teardown(async () => {
    await receive({ name: "hidden" });
    await flush();
    messenger.unregister();
    domWindow.close();
  });

  should(
    "retain decoded previews across reopening, recency changes and title updates",
    async () => {
      await open();
      const before = new Map(cards().map((card) => [Number(card.dataset.id), card]));
      const images = cards().map((card) => card.querySelector("img"));
      await press("Escape");
      list.reverse();
      list[0].title = "New title";
      await open();
      assert.equal([4, 3, 2, 1], cards().map((card) => Number(card.dataset.id)));
      for (const card of cards()) {
        assert.isTrue(card === before.get(Number(card.dataset.id)));
        assert.isTrue(images.includes(card.querySelector("img")));
      }
      assert.equal("New title", grid.firstElementChild.querySelector(".card-title").textContent);
      assert.equal("New title — example.com", grid.firstElementChild.getAttribute("aria-label"));
      assert.equal(1, grid.querySelectorAll(".selected").length);
      assert.equal(grid.querySelector(".selected").id, grid.getAttribute("aria-activedescendant"));
      assert.equal([], previewRequests());
    },
  );

  should("fetch only missing previews and retain existing images after closing a tab", async () => {
    list[0].screenshot = null;
    await open();
    assert.equal([list[0].url], previewRequests()[0].message.urls);
    const remaining = cards().filter((card) => card.dataset.id !== "2");
    await press("x");
    assert.equal(3, cards().length);
    assert.isTrue(cards().every((card, i) => card === remaining[i]));
    assert.equal("3", grid.querySelector(".selected").dataset.id);
  });

  should("keep navigation responsive during decoding and reuse cards on resize", async () => {
    list = Array.from({ length: 12 }, (_, i) => ({
      ...list[i % 4],
      id: i + 1,
      index: i,
      lastUsed: i === 1,
    }));
    list[0].screenshot = null;
    let finishDecode;
    decode = () => new Promise((resolve) => finishDecode = resolve);
    replies.getTabScreenshots = () => ["data:image/png;base64,loaded"];
    await open();
    const before = cards();
    assert.isTrue(!!before[0].querySelector(".letter-tile"));
    await press("ArrowRight");
    assert.equal("3", grid.querySelector(".selected").dataset.id);
    // Forces a different row count while the image is decoding.
    stub(globalThis, "innerHeight", 200);
    domWindow.dispatchEvent(new domWindow.Event("resize"));
    assert.isTrue(cards().every((card, i) => card === before[i]));
    assert.isTrue(!!before[0].querySelector(".letter-tile"));
    finishDecode();
    await flush();
    assert.equal("data:image/png;base64,loaded", grid.firstElementChild.querySelector("img").src);
    assert.isTrue(cards().every((card, i) => card === before[i]));
  });

  should("keep the fallback when a thumbnail fails to decode", async () => {
    list[0].screenshot = null;
    decode = () => Promise.reject(new Error("Invalid image"));
    replies.getTabScreenshots = () => ["data:image/png;base64,broken"];
    await open();
    assert.isTrue(!!grid.firstElementChild.querySelector(".letter-tile"));
    assert.equal(null, grid.firstElementChild.querySelector("img"));
    await press("ArrowRight");
    assert.equal("3", grid.querySelector(".selected").dataset.id);
  });

  should("discard a previous URL's preview when a tab navigates", async () => {
    await open();
    await press("Escape");
    list[0].url = "https://other.example/new";
    list[0].screenshot = null;
    await open();
    assert.equal(null, grid.firstElementChild.querySelector("img"));
    assert.equal("other.example", grid.firstElementChild.querySelector(".card-host").textContent);
    assert.equal([list[0].url], previewRequests()[0].message.urls);
  });

  should("ignore delayed preview replies after cancelling and reopening", async () => {
    list[0].screenshot = null;
    replies.getTabScreenshots = () => "pending";
    await open();
    const old = previewRequests()[0];
    await press("Escape");
    list[0].url = "https://other.example/new";
    await open();
    await reply(old, ["data:image/png;base64,obsolete"]);
    await flush();
    assert.equal(null, grid.firstElementChild.querySelector("img"));
    assert.isTrue(panel.classList.contains("ready"));
  });

  should("ignore a delayed tab list and queued commit from a cancelled opening", async () => {
    replies.getOpenTabsWithScreenshots = () => "pending";
    await receive({ name: "activate", commitOnOpen: true });
    await flush();
    const old = messages.find((request) =>
      request.message?.handler === "getOpenTabsWithScreenshots"
    );
    await press("Escape");
    replies.getOpenTabsWithScreenshots = () => list.map((tab) => ({ ...tab }));
    await open();
    await reply(old, []);
    await flush();
    assert.equal(4, cards().length);
    assert.isTrue(panel.classList.contains("ready"));
    assert.equal(0, messages.filter((r) => r.message?.handler === "selectSpecificTab").length);
  });

  should("cycle a large grid without rebuilding cards or losing the selected page", async () => {
    list = Array.from({ length: 200 }, (_, i) => ({
      ...list[0],
      id: i + 1,
      index: i,
      active: i === 0,
      lastUsed: i === 1,
    }));
    await open();
    const before = cards();
    let replacements = 0;
    const observer = new domWindow.MutationObserver((records) => replacements += records.length);
    observer.observe(grid, { childList: true, subtree: true });
    for (let i = 0; i < 205; i++) {
      document.dispatchEvent(
        new domWindow.KeyboardEvent("keydown", {
          key: "ArrowRight",
          bubbles: true,
        }),
      );
    }
    await flush();
    observer.disconnect();
    assert.equal(0, replacements);
    assert.equal("7", grid.querySelector(".selected").dataset.id);
    assert.isFalse(grid.querySelector(".selected").hidden);
    assert.equal(1, grid.querySelectorAll('[aria-selected="true"]').length);
    assert.isTrue(cards().every((card, i) => card === before[i]));
  });
});
