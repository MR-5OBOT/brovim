import "./test_helper.js";
import "../../lib/settings.js";

context("settings", () => {
  context("v2.0 migration", () => {
    setup(async () => {
      // Prior to Brovim 2.0.0, the settings values were encoded as JSON strings.
      await chrome.storage.sync.set({ scrollStepSize: JSON.stringify(123) });
    });

    teardown(async () => {
      await Settings.clear();
    });

    should("Run v2.0.0 migration when loading settings", async () => {
      let storage = await chrome.storage.sync.get(null);
      assert.equal("123", storage.scrollStepSize);
      // The JSON value should've been migrated to an int when loading settings.
      await Settings.load();
      const settings = Settings.getSettings();
      assert.equal(123, settings["scrollStepSize"]);
      // When writing settings, the JSON value should be persisted back to storage.
      await Settings.set(settings);
      storage = await chrome.storage.sync.get(null);
      assert.equal(123, storage.scrollStepSize);
    });
  });

  should("drop removed new-tab preferences from imports and later saves", async () => {
    try {
      const legacy = {
        settingsVersion: "2.4.2",
        newTabDestination: "customUrl",
        newTabCustomUrl: "https://example.com",
        newTabUrl: "pages/blank.html",
        openVomnibarOnNewTabPage: true,
        scrollStepSize: 123,
      };
      await chrome.storage.sync.set(legacy);
      await Settings.load();
      assert.equal(123, Settings.get("scrollStepSize"));
      for (
        const key of [
          "newTabDestination",
          "newTabCustomUrl",
          "newTabUrl",
          "openVomnibarOnNewTabPage",
        ]
      ) {
        assert.equal(undefined, Settings.get(key));
      }
      await Settings.setSettings(legacy);
      const stored = await chrome.storage.sync.get(null);
      assert.equal(["scrollStepSize", "settingsVersion"], Object.keys(stored).sort());
    } finally {
      await Settings.clear();
    }
  });
});
