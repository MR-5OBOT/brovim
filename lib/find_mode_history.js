// Find-mode query history as a list of raw queries, most recent first.
// This is under lib/ since it is used by both content scripts and iframes from pages/.
const FindModeHistory = {
  storage: chrome.storage.session,
  key: "findModeRawQueryList",
  max: 50,
  rawQueryList: null,
  loading: null,
  listening: false,

  async init() {
    this.isIncognitoMode = chrome.extension.inIncognitoContext;
    this.key = this.isIncognitoMode ? "findModeRawQueryListIncognito" : "findModeRawQueryList";

    if (!this.listening) {
      this.listening = true;
      this.storage.onChanged.addListener((changes) => {
        if (changes[this.key]) this.rawQueryList = changes[this.key].newValue ?? [];
      });
    }
    if (this.loading) return await this.loading;
    if (this.rawQueryList != null) return;
    this.loading = (async () => {
      const result = await this.storage.get(
        this.isIncognitoMode ? [this.key, "findModeRawQueryList"] : this.key,
      );
      // A newer storage change can arrive while the initial snapshot is still loading.
      if (this.rawQueryList != null) return;
      if (this.isIncognitoMode && result[this.key] == null) {
        // Seed the first private context only; later tabs must keep its existing searches.
        this.rawQueryList = result.findModeRawQueryList || [];
        await this.storage.set({ findModeRawQueryListIncognito: this.rawQueryList });
      } else {
        this.rawQueryList = result[this.key] || [];
      }
    })();
    try {
      await this.loading;
    } finally {
      this.loading = null;
    }
  },

  getQuery(index) {
    if (index == null) index = 0;
    return this.rawQueryList?.[index] || "";
  },

  async saveQuery(query) {
    if (query.length == 0) return;
    await this.init();
    this.rawQueryList = this.refreshRawQueryList(query, this.rawQueryList);
    const newSetting = {};
    newSetting[this.key] = this.rawQueryList;
    await this.storage.set(newSetting);
    // If there are any active incognito-mode tabs, then propagate this query to those tabs too.
    if (!this.isIncognitoMode) {
      const result = await this.storage.get("findModeRawQueryListIncognito");
      if (result.findModeRawQueryListIncognito) {
        await this.storage.set({
          findModeRawQueryListIncognito: this.refreshRawQueryList(
            query,
            result.findModeRawQueryListIncognito,
          ),
        });
      }
    }
  },

  refreshRawQueryList(query, rawQueryList) {
    return ([query].concat((rawQueryList ?? []).filter((q) => q !== query))).slice(0, this.max + 1);
  },
};

globalThis.FindModeHistory = FindModeHistory;
