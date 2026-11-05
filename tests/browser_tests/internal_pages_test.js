import puppeteer from "puppeteer";
import { fileURLToPath } from "node:url";

const root = Deno.env.get("BROVIM_EXTENSION_PATH") ||
  fileURLToPath(new URL("../../", import.meta.url));
const server = Deno.serve(
  { hostname: "127.0.0.1", port: 0, onListen() {} },
  () =>
    new Response(
      '<!doctype html><title>Brovim internal-page destination</title><a href="/">Link</a>',
      {
        headers: { "content-type": "text/html" },
      },
    ),
);
const origin = `http://127.0.0.1:${server.addr.port}`;
let passed = 0;
const pass = (name) => {
  passed++;
  console.log(`PASS ${name}`);
};
function assert(value, message) {
  if (!value) throw new Error(message);
}

try {
  for (const enabled of [false, true]) {
    const browser = await puppeteer.launch({
      executablePath: Deno.env.get("PUPPETEER_EXECUTABLE_PATH") || undefined,
      headless: true,
      enableExtensions: [root],
      args: enabled ? ["--extensions-on-chrome-urls"] : [],
      defaultViewport: { width: 1280, height: 900 },
    });
    try {
      const worker = await (await browser.waitForTarget((target) =>
        target.type() === "service_worker" && target.url().endsWith("/background_scripts/main.js")
      )).worker();
      await worker.evaluate(async () => {
        for (let i = 0; i < 100; i++) {
          const state = await chrome.storage.session.get([
            "normalModeKeyStateMapping",
            "vimiumSecret",
          ]);
          if (state.normalModeKeyStateMapping && state.vimiumSecret) {
            return;
          }
          await new Promise((resolve) =>
            setTimeout(resolve, 50)
          );
        }
        throw new Error("Background initialization did not finish");
      });
      const page = await browser.newPage();
      page.setDefaultTimeout(5000);
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error") console.log(`Page console: ${message.text()}`);
      });
      const visibleUi = async (className) => {
        // Mutation observers can miss a freshly attached shadow root; poll its actual DOM.
        await page.waitForFunction(
          (name) =>
            [...document.documentElement.children].some((element) =>
              element.shadowRoot?.querySelector(`iframe.${name}.vimium-ui-component-visible`)
            ),
          { polling: 20 },
          className,
        );
        return await page.$(`:root >>> iframe.${className}.vimium-ui-component-visible`);
      };
      const ready = async (urlPrefix) => {
        for (let i = 0; i < 100; i++) {
          if (
            await worker.evaluate(async (prefix) => {
              const tab = (await chrome.tabs.query({})).find((tab) => tab.url?.startsWith(prefix));
              try {
                const [state] = await chrome.scripting.executeScript({
                  target: { tabId: tab.id },
                  func: () => typeof normalMode !== "undefined" && !!normalMode?.isMappedKey("o"),
                });
                return state?.result;
              } catch {
                return false;
              }
            }, urlPrefix)
          ) return;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        throw new Error(`Brovim did not initialize on ${urlPrefix}`);
      };
      const enabledState = async (urlPrefix, expected) => {
        for (let i = 0; i < 100; i++) {
          const state = await worker.evaluate(async (prefix) => {
            const tab = (await chrome.tabs.query({})).find((tab) => tab.url?.startsWith(prefix));
            const [result] = await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              func: () => typeof isEnabledForUrl !== "undefined" ? isEnabledForUrl : null,
            });
            return result?.result;
          }, urlPrefix);
          if (state === expected) return;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        throw new Error(`Expected enabled=${expected} for ${urlPrefix}`);
      };
      try {
        await page.goto(`${origin}/`);
      } catch (error) {
        // Initial extension installation can supersede the first page navigation.
        if (!error.message.includes("net::ERR_ABORTED")) throw error;
        await page.goto(`${origin}/`);
      }
      await ready(origin);
      await page.bringToFront();
      await page.waitForFunction(() => document.hasFocus());
      await page.keyboard.press("o");
      await visibleUi("vomnibar-frame");
      pass(`Website controls work with internal-page override ${enabled ? "on" : "off"}`);
      await page.goto("chrome://settings/system/shortcuts");
      await page.bringToFront();
      if (!enabled) {
        const restricted = await worker.evaluate(async () => {
          const tab = (await chrome.tabs.query({})).find((tab) =>
            tab.url?.startsWith("chrome://settings/")
          );
          try {
            await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => true });
            return false;
          } catch {
            return true;
          }
        });
        assert(restricted, "Internal pages became accessible without the developer flag");
        pass("Internal pages remain protected without the developer flag");
        continue;
      }

      await ready("chrome://settings/");
      await page.keyboard.press("Escape");
      await page.keyboard.press("f");
      await page.waitForSelector(".vimiumHintMarker");
      pass("Link hints reach Settings controls, including shadow DOM");
      await page.keyboard.press("Escape");

      await page.keyboard.press("o");
      await visibleUi("vomnibar-frame");
      const options = await browser.newPage();
      const extensionId = await worker.evaluate(() => chrome.runtime.id);
      await options.goto(`chrome-extension://${extensionId}/pages/options.html`);
      await options.waitForFunction(() =>
        document.querySelector('[name="enableInternalPages"]')?.checked === true &&
        document.querySelector("#internal-pages-status").textContent.includes("available")
      );
      await options.click('[name="enableInternalPages"]');
      await options.click("#save");
      await enabledState("chrome://settings/", false);
      assert(
        await page.evaluate(() =>
          [...document.documentElement.children].every((element) =>
            !element.shadowRoot?.querySelector("iframe.vimium-ui-component-visible")
          )
        ),
        "Turning internal pages off left an active UI visible",
      );
      await page.bringToFront();
      await page.keyboard.press("f");
      assert(
        await page.$(".vimiumHintMarker") === null,
        "Disabled Settings still handles hint keys",
      );
      pass("Options switch disables open internal pages and closes active UI immediately");

      const history = await browser.newPage();
      await history.goto("chrome://history/");
      await new Promise((resolve) => setTimeout(resolve, 150));
      const injected = await worker.evaluate(async () => {
        const tab = (await chrome.tabs.query({})).find((tab) => tab.url === "chrome://history/");
        const [state] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => !!globalThis.brovimContentScriptsLoaded,
        });
        return state.result;
      });
      assert(!injected, "A new internal page received content scripts while disabled");
      await options.bringToFront();
      await options.waitForFunction(() => document.querySelector("#save").disabled);
      await options.click('[name="enableInternalPages"]');
      await options.click("#save");
      await enabledState("chrome://settings/", true);
      await ready("chrome://history/");
      pass(
        "Re-enabling recovers existing and previously uninjected internal pages without reloads",
      );

      await worker.evaluate(() =>
        Settings.set("exclusionRules", [{ pattern: "chrome://settings/*", passKeys: "" }])
      );
      await enabledState("chrome://settings/", false);
      await enabledState("chrome://history/", true);
      await worker.evaluate(() => Settings.set("exclusionRules", []));
      await enabledState("chrome://settings/", true);
      pass("Excluded-site rules can turn individual browser pages off");
      await history.close();
      await options.close();
      await page.bringToFront();
      await page.reload();
      await ready("chrome://settings/");
      await page.keyboard.press("Escape");
      await page.keyboard.press("o");
      const iframe = await visibleUi("vomnibar-frame");
      const frame = await iframe.contentFrame();
      await frame.waitForSelector("input", { visible: true, timeout: 5000 });
      await frame.type("input", `${origin}/from-settings`);
      await frame.waitForFunction(
        (url) => document.querySelector("input").value === url,
        {},
        `${origin}/from-settings`,
      );
      await page.keyboard.press("Enter");
      try {
        await page.waitForFunction((url) => location.href === url, {}, `${origin}/from-settings`);
      } catch {
        throw new Error(`URL bar did not navigate to the fixture; current URL: ${page.url()}`);
      }
      pass("Reloaded Settings can navigate using Brovim's URL bar");
      await page.goto("chrome://settings/");
      await ready("chrome://settings/");
      await page.keyboard.press("Escape");
      const closed = new Promise((resolve) => page.once("close", resolve));
      await page.keyboard.press("x");
      await Promise.race([
        closed,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("x did not close Settings")), 5000)
        ),
      ]);
      pass("Brovim can close Settings with x");
      assert(errors.length === 0, errors.join("\n"));
      pass("No uncaught errors on internal pages");
    } finally {
      await browser.close();
    }
  }
} finally {
  await server.shutdown();
}
console.log(`Internal-page checks: ${passed} passed`);
