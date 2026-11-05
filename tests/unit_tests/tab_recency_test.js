import "./test_helper.js";
import { TabRecency } from "../../background_scripts/tab_recency.js";

context("TabRecency", () => {
  let tabRecency;

  setup(async () => {
    await chrome.storage.session.remove("tabRecency");
    await chrome.storage.local.remove("brovimSessionTabRecency");
    tabRecency = new TabRecency();
  });

  should("keep a newer activation ahead of a delayed window-focus result", async () => {
    let focusChanged, activated, resolveFocus;
    stub(chrome.windows.onFocusChanged, "addListener", (fn) => focusChanged = fn);
    stub(chrome.tabs.onActivated, "addListener", (fn) => activated = fn);
    stub(
      chrome.tabs,
      "query",
      (query) =>
        query.active
          ? new Promise((resolve) => resolveFocus = resolve)
          : Promise.resolve([{ id: 1 }, { id: 2 }, { id: 3 }]),
    );
    await tabRecency.init();
    tabRecency.register(1);
    const focusing = focusChanged(7);
    activated({ tabId: 2, windowId: 7 });
    resolveFocus([{ id: 1, windowId: 7, active: true }]);
    await focusing;
    activated({ tabId: 3, windowId: 7 });
    assert.equal([3, 2, 1], tabRecency.getTabsByRecency());
  });

  should("preserve the quick-swap pair when a sleeping tab's ID is replaced", async () => {
    let replaced;
    stub(chrome.tabs.onReplaced, "addListener", (fn) => replaced = fn);
    stub(chrome.tabs, "query", () => Promise.resolve([]));
    await tabRecency.init();
    for (const id of [1, 2, 3]) tabRecency.register(id);
    replaced(4, 1);
    assert.equal([3, 2, 4], tabRecency.getTabsByRecency());
    // Replacing an unvisited restored tab must not fabricate a visit.
    replaced(6, 5);
    assert.equal([3, 2, 4], tabRecency.getTabsByRecency());
    // An activation that arrives before onReplaced is newer than the transferred rank.
    tabRecency.register(7);
    replaced(7, 4);
    assert.equal([7, 3, 2], tabRecency.getTabsByRecency());
  });

  should("preserve a replacement's stored rank while the worker is loading", async () => {
    let replaced, resolveStorage;
    stub(chrome.tabs.onReplaced, "addListener", (fn) => replaced = fn);
    stub(chrome.tabs, "query", () => Promise.resolve([{ id: 2 }, { id: 3 }, { id: 4 }]));
    stub(chrome.storage.session, "get", () => new Promise((resolve) => resolveStorage = resolve));
    const loading = tabRecency.init();
    replaced(4, 1);
    resolveStorage({ tabRecency: { 1: 10, 2: 20, 3: 30 } });
    await loading;
    assert.equal([3, 2, 4], tabRecency.getTabsByRecency());
  });

  should("preserve activations received after startup while storage is loading", async () => {
    let activated, startup, resolveStorage;
    stub(chrome.tabs.onActivated, "addListener", (fn) => activated = fn);
    stub(chrome.runtime.onStartup, "addListener", (fn) => startup = fn);
    stub(chrome.tabs, "query", () => Promise.resolve([{ id: 1 }, { id: 2 }]));
    stub(chrome.storage.session, "get", () => new Promise((resolve) => resolveStorage = resolve));
    const loading = tabRecency.init();
    const resetting = startup();
    activated({ tabId: 1, windowId: 7 });
    activated({ tabId: 2, windowId: 7 });
    resolveStorage({ tabRecency: { 1: 30, 2: 10 } });
    await Promise.all([loading, resetting]);
    assert.equal([2, 1], tabRecency.getTabsByRecency());
  });

  should(
    "rank a new background tab without an opener immediately after the current tab",
    async () => {
      let created;
      stub(chrome.tabs.onCreated, "addListener", (fn) => created = fn);
      stub(chrome.tabs, "query", () => Promise.resolve([]));
      await tabRecency.init();
      tabRecency.register(1);
      tabRecency.register(2);
      created({ id: 3, active: false, windowId: 7 });
      assert.equal([2, 3, 1], tabRecency.getTabsByRecency());
    },
  );

  should("keep session visits across an extension reload and prune closed tabs", async () => {
    stub(chrome.tabs, "query", () => Promise.resolve([{ id: 1 }, { id: 2 }, { id: 3 }]));
    await tabRecency.init();
    tabRecency.register(1);
    tabRecency.register(2);
    tabRecency.register(99);
    await tabRecency.saveToStorage();
    await chrome.storage.session.remove("tabRecency");
    const reloaded = new TabRecency();
    await reloaded.init();
    assert.equal([2, 1], reloaded.getTabsByRecency());
  });

  should("clear visits when the browser starts a new session", async () => {
    stub(chrome.tabs, "query", () => Promise.resolve([{ id: 1 }]));
    await tabRecency.init();
    tabRecency.register(1);
    await tabRecency.resetForBrowserStartup();
    assert.equal([], tabRecency.getTabsByRecency());
    assert.equal(
      {},
      (await chrome.storage.local.get("brovimSessionTabRecency")).brovimSessionTabRecency,
    );
  });

  should("rank tabs opened in the background right after the current tab", async () => {
    stub(chrome.tabs, "query", () => Promise.resolve([]));
    await tabRecency.init();
    tabRecency.register(1);
    tabRecency.register(2);
    tabRecency.registerBackground(3);
    tabRecency.registerBackground(4);
    assert.equal([2, 4, 3, 1], tabRecency.getTabsByRecency());
    assert.equal(0, tabRecency.recencyScore(2));
  });

  context("order", () => {
    setup(async () => {
      stub(chrome.tabs, "query", () => Promise.resolve([]));
      await tabRecency.init();
      tabRecency.queueAction("register", 1);
      tabRecency.queueAction("register", 2);
      tabRecency.queueAction("register", 3);
      tabRecency.queueAction("register", 4);
      tabRecency.queueAction("deregister", 4);
      tabRecency.queueAction("register", 2);
    });

    should("have the correct entries in the correct order", () => {
      const expected = [2, 3, 1];
      assert.equal(expected, tabRecency.getTabsByRecency());
    });

    should("score tabs by recency; current tab should be last", () => {
      const score = (id) => tabRecency.recencyScore(id);
      assert.equal(0, score(2));
      assert.isTrue(score(2) < score(1));
      assert.isTrue(score(1) < score(3));
    });
  });

  should("navigate actions are queued until state from storage is loaded", async () => {
    let onActivated;
    stub(chrome.tabs.onActivated, "addListener", (fn) => {
      onActivated = fn;
    });
    let resolveStorage;
    const storagePromise = new Promise((resolve, _) => resolveStorage = resolve);
    stub(chrome.storage.session, "get", () => storagePromise);
    tabRecency.init();
    // Here, chrome.tabs.onActivated listeners have been added by tabrecency, but the
    // chrome.storage.session data hasn't yet loaded.
    onActivated({ tabId: 5 });
    resolveStorage({});
    await tabRecency.init();
    assert.equal([5], tabRecency.getTabsByRecency());
  });

  should("loadFromStorage handles empty values", async () => {
    stub(chrome.tabs, "query", () => Promise.resolve([{ id: 1 }]));

    stub(chrome.storage.session, "get", () => Promise.resolve({}));
    await tabRecency.init();
    assert.equal([], tabRecency.getTabsByRecency());

    stub(chrome.storage.session, "get", () => Promise.resolve({ tabRecency: {} }));
    await tabRecency.loadFromStorage();
    assert.equal([], tabRecency.getTabsByRecency());
  });

  should("loadFromStorage works", async () => {
    const tabs = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];
    stub(chrome.tabs, "query", () => Promise.resolve(tabs));

    const storage = { tabRecency: { 1: 5, 2: 6 } };
    stub(chrome.storage.session, "get", () => Promise.resolve(storage));

    // Even though the in-storage tab counters are higher than the in-memory tabs, during
    // loading, the in-memory tab counters are adjusted to be the most recent.
    await tabRecency.init();

    assert.equal([2, 1], tabRecency.getTabsByRecency());

    tabRecency.queueAction("register", 3);
    tabRecency.queueAction("register", 1);

    assert.equal([1, 3, 2], tabRecency.getTabsByRecency());
  });

  should("loadFromStorage prunes out tabs which are no longer active", async () => {
    const tabs = [{ id: 1 }];
    stub(chrome.tabs, "query", () => Promise.resolve(tabs));

    const storage = { tabRecency: { 1: 5, 2: 6 } };
    stub(chrome.storage.session, "get", () => Promise.resolve(storage));
    await tabRecency.init();
    assert.equal([1], tabRecency.getTabsByRecency());
  });
});
