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
      // After this suite's settings changes, Helium reloads a freshly loaded Settings page once more
      // by itself (a "reload" navigation that neither Brovim nor Puppeteer requests; an untouched
      // Settings page doesn't do it). Helium 0.20 did it within ~300ms, 0.21 after ~2.7-3s. Keys or
      // a navigation started before it are lost, so wait for four seconds without navigation.
      const settle = async (load) => {
        let lastNavigation = Date.now();
        const onNavigation = (frame) => {
          if (frame === page.mainFrame()) lastNavigation = Date.now();
        };
        page.on("framenavigated", onNavigation);
        try {
          await load();
          while (Date.now() - lastNavigation < 4000) {
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
        } finally {
          page.off("framenavigated", onNavigation);
        }
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
      await settle(() => page.reload());
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

      const selectionPage = await browser.newPage();
      try {
        selectionPage.on("pageerror", (error) => errors.push(error.message));
        await browser.defaultBrowserContext().overridePermissions(origin, [
          "clipboard-read",
          "clipboard-write",
        ]);
        await selectionPage.goto("chrome://extensions/");
        await ready("chrome://extensions/");
        await selectionPage.bringToFront();
        await selectionPage.waitForFunction(() => document.hasFocus());
        await selectionPage.evaluate(() => {
          // Extensions initially focuses its search field. Select page text outside that editor.
          let active = document.activeElement;
          while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
          active?.blur();
        });
        await selectionPage.waitForFunction(() => {
          const containsName = (root) =>
            [...root.querySelectorAll("*")].some((element) =>
              element.shadowRoot
                ? containsName(element.shadowRoot)
                : element.textContent.trim() === "Brovim" &&
                  element.getBoundingClientRect().width > 0
            );
          return containsName(document);
        });
        await selectionPage.keyboard.press("/");
        const findElement = await selectionPage.waitForSelector(
          ":root >>> iframe.vimium-hud-frame",
        );
        const findFrame = await findElement.contentFrame();
        await findFrame.waitForFunction(() => document.activeElement.id === "hud-find-input");
        await selectionPage.keyboard.type("brovim");
        await findFrame.waitForFunction(() =>
          /[1-9]/.test(document.querySelector("#hud-match-count").textContent)
        );
        await selectionPage.keyboard.press("Enter");
        await selectionPage.keyboard.press("v");
        await selectionPage.keyboard.press("ArrowRight");
        await selectionPage.keyboard.press("Escape");
        assert(errors.length === 0, errors.join("\n"));
        pass("Find Enter and visual movement share helpers across injected script scopes");
        const selectExtensionName = () =>
          selectionPage.waitForFunction(() => {
            const visit = (node) => {
              if (node.nodeType === Node.TEXT_NODE && node.textContent.includes("Brovim")) {
                const range = document.createRange();
                range.selectNodeContents(node);
                if (range.getBoundingClientRect().width > 0) {
                  const selection = getSelection();
                  selection.removeAllRanges();
                  selection.addRange(range);
                  return true;
                }
              }
              return [...(node.shadowRoot?.childNodes || []), ...node.childNodes].some(visit);
            };
            return visit(document.documentElement);
          });
        await selectExtensionName();
        await selectionPage.keyboard.press("v");
        assert(
          await worker.evaluate(async () => {
            const tab = (await chrome.tabs.query({})).find((tab) =>
              tab.url === "chrome://extensions/"
            );
            const [state] = await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              func: () => !!Mode.singletons?.["visual-mode-group"],
            });
            return state.result;
          }),
          "Extensions text did not enter visual mode",
        );
        const copiedText = await selectionPage.evaluate(() => getSelection().toString());
        await selectionPage.keyboard.press("y");
        await selectionPage.waitForFunction(() => getSelection().rangeCount === 0);
        await page.bringToFront();
        await page.waitForFunction(
          async (expected) => await navigator.clipboard.readText() === expected,
          {},
          copiedText,
        );
        pass("Yank copies Extensions-page text and immediately clears the highlight");
        await selectionPage.bringToFront();
        await selectExtensionName();
        await selectionPage.keyboard.press("v");
        await selectionPage.keyboard.press("Escape");
        assert(
          await selectionPage.evaluate(() => getSelection().rangeCount === 0),
          "Escape retained a selected extension card on chrome://extensions",
        );
        pass("Escape clears visual selection inside Extensions-page shadow DOM");
      } finally {
        await selectionPage.close();
      }

      await page.bringToFront();
      await settle(() => page.goto("chrome://settings/"));
      await ready("chrome://settings/");
      // Settings focuses its search field (inside a shadow root) on load. Brovim takes the focus
      // back, so a page key works at once, without Escape.
      const pinned = () =>
        worker.evaluate(async () =>
          (await chrome.tabs.query({})).find((tab) => tab.url?.startsWith("chrome://settings"))
            ?.pinned
        );
      await page.keyboard.down("Alt");
      await page.keyboard.press("p");
      await page.keyboard.up("Alt");
      for (let i = 0; i < 50 && !await pinned(); i++) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      assert(await pinned(), "Alt+P on Settings did not reach Brovim");
      pass("Brovim keys work on Settings without leaving its search field first");
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
