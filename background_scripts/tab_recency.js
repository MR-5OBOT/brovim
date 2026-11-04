// TabRecency associates an integer with each tab id representing how recently it has been accessed.
// The order of tabs as tracked by TabRecency is used to provide a recency-based ordering in the
// tabs vomnibar.
//
// Session storage handles worker suspension; a local mirror survives extension reloads. The
// mirror is reset on browser startup, so visits remain scoped to this browser session.
//
// Callers must await TabRecency.init before calling recencyScore or getTabsByRecency.
//
// In theory, the browser's tab.lastAccessed timestamp field should allow us to sort tabs by
// recency, but in practice it does not work across several edge cases. See the comments on #4368.
class TabRecency {
  constructor() {
    this.counter = 1;
    this.tabIdToCounter = {};
    this.loaded = false;
    this.queuedActions = [];
  }

  // Add listeners to chrome.tabs, and load the index from session storage.
  async init() {
    if (this.initPromise) {
      await this.initPromise;
      return;
    }
    let resolveFn;
    this.initPromise = new Promise((resolve, _reject) => {
      resolveFn = resolve;
    });

    chrome.tabs.onActivated.addListener((activeInfo) => {
      this.queueAction("register", activeInfo.tabId);
    });
    // Links opened in the background. Foreground tabs are registered by onActivated; restored
    // session tabs have no opener and keep their lastAccessed order.
    chrome.tabs.onCreated.addListener((tab) => {
      if (!tab.active && tab.openerTabId != null) this.queueAction("registerBackground", tab.id);
    });
    chrome.runtime.onStartup.addListener(() => this.resetForBrowserStartup());
    chrome.tabs.onRemoved.addListener((tabId) => {
      this.queueAction("deregister", tabId);
    });

    chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
      this.queueAction("deregister", removedTabId);
      this.queueAction("register", addedTabId);
    });

    chrome.windows.onFocusChanged.addListener(async (windowId) => {
      if (windowId == chrome.windows.WINDOW_ID_NONE) return;
      const tabs = await chrome.tabs.query({ windowId, active: true });
      if (tabs[0]) {
        this.queueAction("register", tabs[0].id);
      }
    });

    await this.loadFromStorage();
    while (this.queuedActions.length > 0) {
      const [action, tabId] = this.queuedActions.shift();
      this.handleAction(action, tabId);
    }
    this.loaded = true;
    resolveFn();
  }

  // Loads the index from session storage.
  async loadFromStorage() {
    const tabsPromise = chrome.tabs.query({});
    const [tabs, storage, backup] = await Promise.all([
      tabsPromise,
      chrome.storage.session.get("tabRecency"),
      chrome.storage.local.get("brovimSessionTabRecency"),
    ]);
    const storedRecency = storage.tabRecency ?? backup.brovimSessionTabRecency;
    if (storedRecency == null) return;

    let maxCounter = 0;
    for (const counter of Object.values(storedRecency)) {
      if (maxCounter < counter) maxCounter = counter;
    }
    if (this.counter < maxCounter) {
      this.counter = maxCounter;
    }

    this.tabIdToCounter = Object.assign({}, storedRecency);

    // Remove any tab IDs which aren't currently loaded.
    const tabIds = new Set(tabs.map((t) => t.id));
    for (const id in this.tabIdToCounter) {
      if (!tabIds.has(parseInt(id))) {
        delete this.tabIdToCounter[id];
      }
    }
  }

  async saveToStorage() {
    const recency = structuredClone(this.tabIdToCounter);
    await Promise.all([
      chrome.storage.session.set({ tabRecency: recency }),
      chrome.storage.local.set({ brovimSessionTabRecency: recency }),
    ]);
  }

  async resetForBrowserStartup() {
    await this.init();
    this.counter = 1;
    this.tabIdToCounter = {};
    await this.saveToStorage();
  }

  // - action: "register" or "unregister".
  queueAction(action, tabId) {
    if (!this.loaded) {
      this.queuedActions.push([action, tabId]);
    } else {
      this.handleAction(action, tabId);
    }
  }

  // - action: "register" or "unregister".
  handleAction(action, tabId) {
    if (action == "register") {
      this.register(tabId);
    } else if (action == "registerBackground") {
      this.registerBackground(tabId);
    } else if (action == "deregister") {
      this.deregister(tabId);
    } else {
      throw new Error(`Unexpected action type: ${action}`);
    }
  }

  register(tabId) {
    this.counter++;
    this.tabIdToCounter[tabId] = this.counter;
    this.saveToStorage();
  }

  // Like TabGlance: a tab opened in the background ranks right after the current tab, which stays
  // the most recent.
  registerBackground(tabId) {
    const current = Object.keys(this.tabIdToCounter)
      .find((id) => this.tabIdToCounter[id] == this.counter);
    this.register(tabId);
    if (current != null) this.register(parseInt(current));
  }

  deregister(tabId) {
    delete this.tabIdToCounter[tabId];
    this.saveToStorage();
  }

  // Recently-visited tabs get a higher score (except the current tab, which gets a low score).
  recencyScore(tabId) {
    if (!this.loaded) throw new Error("TabRecency hasn't yet been loaded.");
    const tabCounter = this.tabIdToCounter[tabId];
    const isCurrentTab = tabCounter == this.counter;
    if (isCurrentTab) return 0;
    return (tabCounter ?? 1) / this.counter; // tabCounter may be null.
  }

  // Returns a list of tab Ids sorted by recency, most recent tab first.
  getTabsByRecency() {
    if (!this.loaded) throw new Error("TabRecency hasn't yet been loaded.");
    const ids = Object.keys(this.tabIdToCounter);
    ids.sort((a, b) => this.tabIdToCounter[b] - this.tabIdToCounter[a]);
    return ids.map((id) => parseInt(id));
  }
}

export { TabRecency };
