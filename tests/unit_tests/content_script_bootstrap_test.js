import "./test_helper.js";
import "../../lib/settings.js";
import { ensureContentScripts } from "../../background_scripts/content_script_bootstrap.js";

context("browser shortcut recovery", () => {
  setup(async () => {
    await Settings.onLoaded();
    stub(Settings._settings, "enableInternalPages", false);
  });

  should("recover the switcher without enabling ordinary browser-page mappings", async () => {
    let injections = 0;
    stub(chrome.scripting, "insertCSS", () => Promise.resolve());
    stub(chrome.scripting, "executeScript", (details) => {
      if (details.files) {
        injections++;
        return Promise.resolve([]);
      }
      return Promise.resolve([{
        result: { url: "chrome://extensions/", ready: false, started: false },
      }]);
    });
    assert.isFalse(await ensureContentScripts(8801));
    assert.equal(0, injections);
    assert.isTrue(await ensureContentScripts(8801, { forBrowserShortcut: true }));
    assert.equal(1, injections);
    assert.isFalse(Settings.get("enableInternalPages"));
  });

  should(
    "recover when an overlapping ordinary refresh declines browser-page injection",
    async () => {
      let finishProbe;
      const firstProbe = new Promise((resolve) => finishProbe = resolve);
      let probes = 0, injections = 0;
      const result = [{ result: { url: "chrome://extensions/", ready: false, started: false } }];
      stub(chrome.scripting, "insertCSS", () => Promise.resolve());
      stub(chrome.scripting, "executeScript", (details) => {
        if (details.files) {
          injections++;
          return Promise.resolve([]);
        }
        return ++probes === 1 ? firstProbe : Promise.resolve(result);
      });
      const ordinary = ensureContentScripts(8802);
      const shortcut = ensureContentScripts(8802, { forBrowserShortcut: true });
      finishProbe(result);
      assert.equal([false, true], await Promise.all([ordinary, shortcut]));
      assert.equal(1, injections);
      assert.isFalse(Settings.get("enableInternalPages"));
    },
  );

  should("respect browser restrictions when even the shortcut cannot inject", async () => {
    stub(chrome.scripting, "executeScript", () => Promise.reject(new Error("Protected page")));
    assert.isFalse(await ensureContentScripts(8803, { forBrowserShortcut: true }));
    assert.isFalse(Settings.get("enableInternalPages"));
  });
});
