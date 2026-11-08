// Retired preferences. Ignore them in old installs and backups.
const removedOptions = [
  "newTabUrl",
  "newTabDestination",
  "newTabCustomUrl",
  "openVomnibarOnNewTabPage",
  "helpDialog_showAdvancedCommands",
  "searchUrl",
  "tabSwitcherRows",
];

const defaultOptions = {
  scrollStepSize: 60,
  smoothScroll: true,
  keyMappings: "# Insert your preferred key mappings here.",
  linkHintCharacters: "sadfjklewcmpgh",
  linkHintNumbers: "0123456789",
  filterLinkHints: false,
  hideHud: false,
  hideUpdateNotifications: false,
  // Link hint colors, set in the Theme section of the options page.
  linkHintColor: "#68039b", // Lowercase, as <input type="color"> reports it.
  linkHintTextColor: "#ffffff",
  linkHintMatchColor: "#d4ac3a",
  userDefinedLinkHintCss: `\
div > .vimiumHintMarker {
/* linkhint boxes */
}

div > .vimiumHintMarker span {
/* linkhint text */
}

div > .vimiumHintMarker > .matchingCharacter {
}\
`,
  // Default exclusion rules: none, so Brovim runs on every site.
  exclusionRules: [],

  // default search engines
  searchEngines: `\
w: https://www.wikipedia.org/w/index.php?title=Special:Search&search=%s Wikipedia
yt: https://www.youtube.com/results?search_query=%s YouTube
gh: https://github.com/search?q=%s GitHub
r: https://www.reddit.com/search/?q=%s Reddit
ddg: https://duckduckgo.com/?q=%s DuckDuckGo\
`,
  grabBackFocus: true,
  enableInternalPages: true,
  waitForEnterForFilteredHints: true,
  ignoreKeyboardLayout: false,
  // The visual tab switcher.
  tabSwitcherOrder: "mru", // "mru" or "tabstrip".
  tabSwitcherTwoTabSwap: true,
  tabSwitcherGlass: false,
  tabSwitcherColumns: 8,
  tabSwitcherAutoCapture: true,
  tabSwitcherMaxThumbnails: 15,
  // Dark mode for light websites, switched on and off with Alt+D. Percentages for the filter.
  darkModeEnabled: false,
  darkModeSkipDarkPages: true,
  darkModeBrightness: 100,
  darkModeContrast: 90,
  darkModeSepia: 10,
  darkModeGrayscale: 0,
  darkModeExcludedSites: "",
};

/*
 * This class fetches and exposes the view over Brovim's settings data, which is stored in
 * chrome.storage. It merges the user's customizations into the default setting values.
 * It dispatches the "change" event when the settings have been changed.
 */
const Settings = {
  _settings: null,
  _chromeStorageListenerInstalled: false,

  defaultOptions,

  async onLoaded() {
    if (!this.isLoaded()) {
      await this.load();
    }
  },

  async chromeStorageOnChanged(_changes, area) {
    // We store data with keys [settings-v1, ...] into the local storage. Only broadcast an event if
    // the object stored with the settings key has changed.
    // We only store settings in the sync area, so storage.sync changes must be settings changes.
    if (area == "sync") {
      await this.load();
      this.dispatchEvent("change");
    }
  },

  async load() {
    // NOTE: If we change the schema of the settings object in a backwards-incompatible way,
    // then we can fetch the whole storage object here and migrate any old settings the user has to
    // the new schema.
    if (!this._chromeStorageListenerInstalled) {
      this._chromeStorageListenerInstalled = true;
      chrome.storage.onChanged.addListener((changes, area) =>
        this.chromeStorageOnChanged(changes, area)
      );
    }

    let result = await chrome.storage.sync.get(null); // Get every key.
    result = this.migrateSettingsIfNecessary(result);
    result["settingsVersion"] = Utils.getCurrentVersion();
    this._settings = Object.assign(globalThis.structuredClone(defaultOptions), result);
  },

  isLoaded() {
    return this._settings != null;
  },

  // The CSS injected into pages and Brovim's UI: the theme's link hint colors, then the user's own
  // CSS, which comes later and so takes precedence.
  userCss() {
    const [box, text, typed] = ["linkHintColor", "linkHintTextColor", "linkHintMatchColor"]
      .map((key) => this.get(key));
    return `div > .vimiumHintMarker {
  background: var(--brovim-hint-color, ${box});
  border-color: var(--brovim-hint-color, ${box});
}
div > .vimiumHintMarker span { color: var(--brovim-hint-text-color, ${text}); }
div > .vimiumHintMarker > .matchingCharacter { color: var(--brovim-hint-match-color, ${typed}); }
${this.get("userDefinedLinkHintCss")}`;
  },

  get(key) {
    if (!this.isLoaded()) {
      throw new Error(`Getting the setting ${key} before settings have been loaded.`);
    }
    return globalThis.structuredClone(this._settings[key]);
  },

  async set(key, value) {
    if (!this.isLoaded()) {
      throw new Error(`Writing the setting ${key} before settings have been loaded.`);
    }
    this._settings[key] = value;
    await this.setSettings(this._settings);
  },

  getSettings() {
    return globalThis.structuredClone(this._settings);
  },

  // Recover old/synced alphabets which contain case-equivalent letters. Never produce duplicate
  // labels, even if an earlier version saved an alphabet with fewer than two distinct letters.
  getHintCharacters(key) {
    const normalize = (value) =>
      key === "linkHintCharacters" ? value.toLowerCase() : value.toUpperCase();
    const characters = [...new Set(normalize(this.get(key)))];
    return characters.length > 1 ? characters.join("") : normalize(defaultOptions[key]);
  },

  migratePre2_0(settings) {
    // Prior to Brovim version 2.0.0:
    // - In chrome.storages.sync, the value of each setting was encoded as a JSON string using
    //   JSON.stringify. This was probably an artifact of originally using localStorage, but is no
    //   longer necessary now that chrome.storage exists and can store objects. Note that when
    //   exporting a backup of settings on the options page, the values were not encoded as JSON
    //   strings.
    // - We only stored the settingsVersion key in the JSON payload when a user exported a backup of
    //   their settings. It wasn't set when writing the settings to chrome.storage.sync.

    // NOTE: We want to migrate settings which have JSON-encoded values. Based on the notes
    // above, that should mean we only need to migrate if the settings object is missing a
    // "settingsVersion" key.
    const shouldMigrate = settings["settingsVersion"] == null;
    if (!shouldMigrate) return settings;

    // Migration for v2.0.0: decode all values so that they're not JSON string encoded.
    const newSettings = {};
    for (const [k, v] of Object.entries(settings)) {
      // Most pre-2.0 settings were strings, but the global marks were stored as native values. See
      // #4323. So check the setting value's type before migrating.
      if (typeof v === "string") {
        newSettings[k] = JSON.parse(v);
      } else {
        newSettings[k] = v;
      }
    }
    // This key is no longer stored in our settings, but rather chrome.storage.session.
    delete newSettings.passNextKeyKeys;
    return newSettings;
  },

  migrateSettingsIfNecessary(settings) {
    settings = this.migratePre2_0(settings);
    for (const key of removedOptions) delete settings[key];
    // The old five/ten-preview cache evicted screenshots during an ordinary round of tab visits.
    // Upgrade existing installs and backups as well as changing the default for new installs.
    if ([5, 10].includes(settings.tabSwitcherMaxThumbnails)) {
      settings.tabSwitcherMaxThumbnails = defaultOptions.tabSwitcherMaxThumbnails;
    }
    return settings;
  },

  // Check the entire backup before writing anything. Unknown/retired preferences are ignored.
  validateBackup(backup) {
    if (!backup || typeof backup !== "object" || Array.isArray(backup)) {
      throw new Error("The backup must contain a settings object.");
    }
    if (backup.settingsVersion != null && typeof backup.settingsVersion !== "string") {
      throw new Error("Invalid setting: settingsVersion must be text.");
    }
    const migrated = this.migrateSettingsIfNecessary(globalThis.structuredClone(backup));
    const result = { settingsVersion: Utils.getCurrentVersion() };
    const invalid = (key) => {
      throw new Error(`Invalid setting in backup: ${key}.`);
    };
    for (const [key, defaultValue] of Object.entries(defaultOptions)) {
      if (!Object.hasOwn(migrated, key)) continue;
      let value = migrated[key];
      if (key === "exclusionRules") {
        if (!Array.isArray(value)) invalid(key);
        value = value.map((rule) => {
          if (!rule || typeof rule.pattern !== "string" || typeof rule.passKeys !== "string") {
            invalid(key);
          }
          try {
            Utils.compileExclusionPattern(rule.pattern);
          } catch {
            invalid(`${key} URL pattern`);
          }
          return { passKeys: rule.passKeys, pattern: rule.pattern };
        });
      } else if (typeof value !== typeof defaultValue) {
        invalid(key);
      } else if (typeof defaultValue === "number") {
        const bounds = {
          tabSwitcherColumns: [3, 8],
          darkModeBrightness: [50, 150],
          darkModeContrast: [50, 150],
          darkModeSepia: [0, 100],
          darkModeGrayscale: [0, 100],
        }[key];
        if (!Number.isFinite(value) || (!bounds && value <= 0)) invalid(key);
        if (bounds && (!Number.isInteger(value) || value < bounds[0] || value > bounds[1])) {
          invalid(key);
        }
        if (key === "tabSwitcherMaxThumbnails") {
          // Older versions accepted any integer from ten upward. Round legacy limits up to a
          // supported choice so otherwise valid backups remain importable, within the byte cap.
          if (!Number.isInteger(value) || value < 10) invalid(key);
          value = [15, 30, 50].find((limit) => value <= limit) ?? 50;
        }
      }
      if (key === "tabSwitcherOrder" && !["mru", "tabstrip"].includes(value)) invalid(key);
      if (/^linkHint(?:Text|Match)?Color$/.test(key) && !/^#[\da-f]{6}$/i.test(value)) {
        invalid(key);
      }
      if (["linkHintCharacters", "linkHintNumbers"].includes(key)) {
        value = key === "linkHintCharacters" ? value.toLowerCase() : value.toUpperCase();
        const characters = [...value];
        if (characters.length < 2 || new Set(characters).size !== characters.length) invalid(key);
      }
      result[key] = value;
    }
    return result;
  },

  async setSettings(settings) {
    settings = this.migrateSettingsIfNecessary(settings);
    settings["settingsVersion"] = Utils.getCurrentVersion();
    const result = this.pruneOutDefaultValues(settings);
    // If, after pruning, some keys were removed because their values are now equal to the default
    // values, then explicitly clear those from storage. Otherwise they will remain.
    // NOTE: This kind of sharp edge is a reason to switch to storing the settings object as
    // one big object, rather than as top-level keys in chrome.storage. The tradeoff is that each
    // value in chrome-storage has a maximum size.
    const resultKeys = Object.keys(result);
    const removedKeys = Object.keys(settings).filter((key) => !resultKeys.includes(key));
    await chrome.storage.sync.remove([...removedKeys, ...removedOptions]);
    await chrome.storage.sync.set(result);
    await this.load();
  },

  // Returns a new object, removing the keys from `settings` which are equal to the default values
  // for those keys.
  pruneOutDefaultValues(settings) {
    const clonedSettings = globalThis.structuredClone(settings);
    for (const [k, v] of Object.entries(settings)) {
      if (JSON.stringify(v) == JSON.stringify(defaultOptions[k])) {
        delete clonedSettings[k];
      }
    }
    return clonedSettings;
  },

  // Used only by tests.
  async clear() {
    this._settings = null;
    await chrome.storage.sync.clear();
  },
};

Object.assign(Settings, EventDispatcher);

globalThis.Settings = Settings;
