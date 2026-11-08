import * as testHelper from "./test_helper.js";
import "../../tests/unit_tests/test_chrome_stubs.js";
import * as optionsPage from "../../pages/options.js";

context("options page", () => {
  setup(async () => {
    await testHelper.jsdomStub("pages/options.html");
    await optionsPage.init();
  });

  teardown(async () => {
    await Settings.clear();
  });

  should("populate the form fields with the settings", () => {
    const settings = Settings.getSettings();
    const field = optionsPage.getOptionEl("keyMappings");
    assert.isTrue(Settings.defaultOptions.keyMappings.length > 0);
    assert.equal(Settings.defaultOptions.keyMappings, settings.keyMappings);
    assert.equal(settings.keyMappings, field.value);
    assert.equal(
      settings.darkModeExcludedSites,
      optionsPage.getOptionEl("darkModeExcludedSites").value,
    );
  });

  should("preserve edits and a cleared native-theme exclusion list after saving", async () => {
    const field = optionsPage.getOptionEl("darkModeExcludedSites");
    assert.isTrue(field.value.split("\n").includes("mail.google.com"));
    assert.isTrue(field.value.split("\n").includes("web.whatsapp.com"));
    assert.isTrue(field.value.split("\n").includes("youtube.com"));
    field.value = "example.com\nmail.google.com";
    await optionsPage.saveOptions();
    await Settings.load();
    await optionsPage.init();
    assert.equal("example.com\nmail.google.com", field.value);
    field.value = "";
    await optionsPage.saveOptions();
    await Settings.load();
    await optionsPage.init();
    assert.equal("", field.value);
    assert.equal("", Settings.get("darkModeExcludedSites"));
  });

  should("default glass off and offer fifteen, thirty or fifty saved screenshots", async () => {
    assert.isFalse(optionsPage.getOptionEl("tabSwitcherGlass").checked);
    assert.equal("15", optionsPage.getOptionEl("tabSwitcherMaxThumbnails").value);
    assert.equal(
      ["15", "30", "50"],
      [...optionsPage.getOptionEl("tabSwitcherMaxThumbnails").options].map((option) =>
        option.value
      ),
    );
    await Settings.set("tabSwitcherMaxThumbnails", 240);
    await optionsPage.init();
    assert.equal("50", optionsPage.getOptionEl("tabSwitcherMaxThumbnails").value);
  });

  should("save the browser-page switch and include it in a settings backup", async () => {
    const field = optionsPage.getOptionEl("enableInternalPages");
    assert.isTrue(field.checked);
    field.checked = false;
    await optionsPage.saveOptions();
    assert.isFalse(Settings.get("enableInternalPages"));
    assert.isFalse(JSON.parse(optionsPage.prepareBackupSettings()).enableInternalPages);
  });

  should("recover an invalid imported tab order so settings remain editable", async () => {
    await Settings.set("tabSwitcherOrder", 'unknown"]');
    await optionsPage.init();
    assert.equal("mru", document.querySelector('[name="tabSwitcherOrder"]:checked').value);
    optionsPage.getOptionEl("scrollStepSize").value = "90";
    await optionsPage.saveOptions();
    assert.equal(90, Settings.get("scrollStepSize"));
    assert.equal("mru", Settings.get("tabSwitcherOrder"));
  });

  should("show validation errors for invalid fields on save", async () => {
    const el = optionsPage.getOptionEl("keyMappings");
    assert.isFalse(el.classList.contains("validation-error"));
    assert.equal(0, document.querySelectorAll(".validation-message").length);

    el.value = "invalid-mapping-statement";
    await optionsPage.saveOptions();
    assert.isTrue(el.classList.contains("validation-error"));

    const messageEls = document.querySelectorAll(".validation-message");
    assert.equal(1, messageEls.length);
    assert.isTrue(messageEls[0].innerHTML.includes(el.value));
  });

  should("show exclusion rule editor for exclusion rules", async () => {
    const rule = {
      passKeys: "",
      pattern: "example.com",
    };
    await Settings.set("exclusionRules", [rule]);
    await optionsPage.init();
    const el = document.querySelector("#exclusion-rules input[name=pattern]");
    assert.equal("example.com", el.value);
  });

  should("reject hint characters that collide after case normalization", async () => {
    for (const name of ["linkHintCharacters", "linkHintNumbers"]) {
      const field = optionsPage.getOptionEl(name);
      field.value = "aA";
      await optionsPage.saveOptions();
      assert.isTrue(field.classList.contains("validation-error"));
      assert.equal(Settings.defaultOptions[name], Settings.get(name));
      field.value = "Ab";
      await optionsPage.saveOptions();
      assert.isFalse(field.classList.contains("validation-error"));
    }
  });

  context("backup", () => {
    should(
      "reject invalid backup shapes and types before changing settings or storage",
      async () => {
        await Settings.set("scrollStepSize", 90);
        const before = Settings.getSettings();
        const stored = await chrome.storage.sync.get(null);
        for (
          const backup of [
            null,
            [],
            "settings",
            { exclusionRules: null },
            { exclusionRules: [{ pattern: "*", passKeys: null }] },
            { exclusionRules: [{ pattern: "[", passKeys: "" }] },
            { keyMappings: [] },
            { smoothScroll: "yes" },
            { tabSwitcherColumns: 9 },
            { darkModeContrast: 151 },
            { darkModeSepia: -1 },
            { scrollStepSize: -1 },
            { linkHintCharacters: "a" },
            { linkHintCharacters: "aA" },
            { linkHintNumbers: "aA" },
          ]
        ) {
          let error;
          try {
            await optionsPage.restoreBackup(JSON.stringify(
              backup && typeof backup === "object" && !Array.isArray(backup)
                ? { settingsVersion: "2.4.2", ...backup }
                : backup,
            ));
          } catch (caught) {
            error = caught;
          }
          assert.isTrue(error instanceof Error);
          assert.equal(before, Settings.getSettings());
          assert.equal(stored, await chrome.storage.sync.get(null));
        }
      },
    );

    should("restore a valid backup and reset omitted values to defaults", async () => {
      await Settings.set("smoothScroll", false);
      await optionsPage.restoreBackup(JSON.stringify({
        settingsVersion: "2.4.2",
        scrollStepSize: 90,
        exclusionRules: [{ pattern: "https?://example.com/*", passKeys: "j" }],
      }));
      assert.equal(90, Settings.get("scrollStepSize"));
      assert.isTrue(Settings.get("smoothScroll"));
      assert.equal("90", optionsPage.getOptionEl("scrollStepSize").value);
      assert.equal("Backup restored", document.querySelector("#save-status").textContent);
    });

    should("restore dark mode settings, including zero percentages", async () => {
      await optionsPage.restoreBackup(JSON.stringify({
        settingsVersion: "1.0.0",
        darkModeEnabled: true,
        darkModeSepia: 0,
        darkModeBrightness: 120,
        darkModeExcludedSites: "example.com",
      }));
      assert.isTrue(Settings.get("darkModeEnabled"));
      assert.equal(0, Settings.get("darkModeSepia"));
      assert.equal("120", optionsPage.getOptionEl("darkModeBrightness").value);
      assert.equal("example.com", optionsPage.getOptionEl("darkModeExcludedSites").value);
    });

    should("migrate legacy backups and ignore unknown preferences", async () => {
      await optionsPage.restoreBackup(JSON.stringify({
        scrollStepSize: "90",
        smoothScroll: "false",
        tabSwitcherMaxThumbnails: "240",
        unknownOption: JSON.stringify({ unsafe: true }),
      }));
      assert.equal(90, Settings.get("scrollStepSize"));
      assert.isFalse(Settings.get("smoothScroll"));
      assert.equal(50, Settings.get("tabSwitcherMaxThumbnails"));
      assert.equal(undefined, Settings.get("unknownOption"));
    });

    should("exclude settings which are default values", () => {
      const settings = JSON.parse(optionsPage.prepareBackupSettings());
      // This should exclude all values which are defaults.
      assert.equal(["settingsVersion"], Object.keys(settings));
    });

    should("include settings which have changed from the default", () => {
      optionsPage.getOptionEl("keyMappings").value = "map a scrollUp";
      const settings = JSON.parse(optionsPage.prepareBackupSettings());
      assert.equal(["keyMappings", "settingsVersion"], Object.keys(settings));
      assert.equal("map a scrollUp", settings.keyMappings);
    });

    should("export settings with sorted keys", () => {
      optionsPage.getOptionEl("linkHintCharacters").value = "abcd";
      optionsPage.getOptionEl("keyMappings").value = "map a scrollUp";
      const settings = JSON.parse(optionsPage.prepareBackupSettings());
      assert.equal(["keyMappings", "linkHintCharacters", "settingsVersion"], Object.keys(settings));
    });

    should("include exclusion rules", async () => {
      const rule = {
        passKeys: "",
        pattern: "example.com",
      };
      await Settings.set("exclusionRules", [rule]);
      await optionsPage.init();
      const settings = JSON.parse(optionsPage.prepareBackupSettings());
      assert.equal([rule], settings["exclusionRules"]);
    });
  });
});
