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
    this.activityRevision = 0;
    this.resetOnLoad = false;
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
      this.activityRevision++;
      this.queueAction("register", activeInfo.tabId);
    });
    // All newly created background tabs are recent, including tabs opened by another extension or
    // restored without an opener. Foreground tabs use onActivated.
    chrome.tabs.onCreated.addListener((tab) => {
      if (!tab.active) this.queueAction("registerBackground", tab.id);
    });
    chrome.runtime.onStartup.addListener(() => this.resetForBrowserStartup());
    chrome.tabs.onRemoved.addListener((tabId) => {
      this.queueAction("deregister", tabId);
    });

    chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
      this.queueAction("replace", { addedTabId, removedTabId });
    });

    chrome.windows.onFocusChanged.addListener(async (windowId) => {
      const revision = ++this.activityRevision;
      if (windowId == chrome.windows.WINDOW_ID_NONE) return;
      const tabs = await chrome.tabs.query({ windowId, active: true }).catch(() => []);
      // A new activation/focus can arrive while this query still describes the previous tab.
      if (revision === this.activityRevision && tabs[0]) {
        this.queueAction("register", tabs[0].id);
      }
    });

    await this.loadFromStorage();
    if (this.resetOnLoad) {
      this.counter = 1;
      this.tabIdToCounter = {};
      this.resetOnLoad = false;
      await this.saveToStorage();
    }
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
    // The query may already contain a replacement ID while storage still uses its old ID.
    // Retain that old rank until the queued replacement can transfer it below.
    for (const [action, replacement] of this.queuedActions) {
      if (action === "replace") tabIds.add(replacement.removedTabId);
    }
    for (const id in this.tabIdToCounter) {
      if (!tabIds.has(parseInt(id))) {
        delete this.tabIdToCounter[id];
      }
    }
  }

  async saveToStorage() {
    try {
      const recency = structuredClone(this.tabIdToCounter);
      await Promise.all([
        chrome.storage.session.set({ tabRecency: recency }),
        chrome.storage.local.set({ brovimSessionTabRecency: recency }),
      ]);
    } catch {
      // Storage operations can fail if the browser or extension is shutting down.
    }
  }

  async resetForBrowserStartup() {
    this.activityRevision++;
    if (!this.loaded) {
      this.resetOnLoad = true;
      this.queuedActions = [];
      await this.init();
      return;
    }
    this.counter = 1;
    this.tabIdToCounter = {};
    await this.saveToStorage();
  }

  // - tabId: a numeric ID, or { addedTabId, removedTabId } for a replacement.
  queueAction(action, tabId) {
    if (!this.loaded) {
      this.queuedActions.push([action, tabId]);
    } else {
      this.handleAction(action, tabId);
    }
  }

  // Apply a visit, background creation, removal or ID replacement.
  handleAction(action, tabId) {
    if (action == "register") {
      this.register(tabId);
    } else if (action == "registerBackground") {
      this.registerBackground(tabId);
    } else if (action == "deregister") {
      this.deregister(tabId);
    } else if (action == "replace") {
      this.replace(tabId.addedTabId, tabId.removedTabId);
    } else {
      throw new Error(`Unexpected action type: ${action}`);
    }
  }

  register(tabId) {
    this.counter++;
    this.tabIdToCounter[tabId] = this.counter;
    this.saveToStorage();
  }

  // A tab opened in the background ranks right after the current tab, which stays the most recent.
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

  // Discarding or prerendering can replace a tab's ID without a visit. Transfer its rank instead
  // of promoting it ahead of the user's previous tab. Preserve any newer activation of the new ID.
  replace(addedTabId, removedTabId) {
    const oldRank = this.tabIdToCounter[removedTabId];
    const newRank = this.tabIdToCounter[addedTabId];
    delete this.tabIdToCounter[removedTabId];
    if (oldRank != null) this.tabIdToCounter[addedTabId] = Math.max(oldRank, newRank ?? 0);
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
