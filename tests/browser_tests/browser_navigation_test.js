import puppeteer from "puppeteer";
import JSON5 from "json5";
import { fileURLToPath } from "node:url";

const root = Deno.env.get("BROVIM_EXTENSION_PATH") ||
  fileURLToPath(new URL("../../", import.meta.url));
const hasInternalPermission = JSON5.parse(await Deno.readTextFile(`${root}/manifest.json`))
  .host_permissions?.some((permission) => permission.startsWith("chrome:"));
const server = Deno.serve(
  { hostname: "127.0.0.1", port: 0, onListen() {} },
  () =>
    new Response("<!doctype html><title>Navigation source</title><input autofocus><p>Source</p>", {
      headers: { "content-type": "text/html" },
    }),
);
const origin = `http://127.0.0.1:${server.addr.port}`;
function assert(value, message) {
  if (!value) throw new Error(message);
}
async function until(check, message) {
  for (let i = 0; i < 100; i++) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(message);
}
let passed = 0;
const pass = (name) => console.log(`PASS ${++passed}: ${name}`);
const errors = [];
try {
  for (const allowInternal of hasInternalPermission ? [false, true] : [false]) {
    const browser = await puppeteer.launch({
      executablePath: Deno.env.get("PUPPETEER_EXECUTABLE_PATH") || undefined,
      headless: true,
      enableExtensions: [root],
      args: allowInternal ? ["--extensions-on-chrome-urls"] : [],
      defaultViewport: { width: 1280, height: 900 },
    });
    try {
      browser.on("targetcreated", async (target) => {
        (await target.page())?.on("pageerror", (error) => errors.push(error.message));
      });
      const worker = await (await browser.waitForTarget((target) =>
        target.type() === "service_worker" && target.url().endsWith("/background_scripts/main.js")
      )).worker();
      await worker.evaluate(() =>
        Settings.onLoaded()
      );
      const source = await browser.newPage();
      source.setDefaultTimeout(5000);
      await source.goto(`${origin}/source`);
      await source.bringToFront();
      const sourceId = await worker.evaluate(
        async (url) => (await chrome.tabs.query({})).find((tab) => tab.url === url).id,
        source.url(),
      );
      await until(() =>
        worker.evaluate(async (tabId) => {
          const [state] = await chrome.scripting.executeScript({
            target: { tabId },
            func: () => typeof normalMode !== "undefined" && !!normalMode?.isMappedKey("o"),
          });
          return state?.result;
        }, sourceId), "Source content scripts did not initialize");
      const invoke = (module, method, tabId) =>
        worker.evaluate(
          async (path, name, id) => {
            const tab = await chrome.tabs.get(id);
            if (path === "tab_switcher") await openTabSwitcher(tab);
            else await BackgroundCommands[name]({ tab });
          },
          module,
          method,
          tabId,
        );
      const activeId = () =>
        worker.evaluate(async () =>
          (await chrome.tabs.query({ active: true, currentWindow: true }))[0].id
        );
      const focusTab = async (page, id) => {
        await page.bringToFront();
        await until(async () => await activeId() === id, "Browser tab activation did not finish");
        await page.waitForFunction(() => document.hasFocus());
      };
      const overlay = async (page, className, path) => {
        await page.waitForFunction(
          (name) =>
            [...document.documentElement.children].some((element) =>
              element.shadowRoot?.querySelector(`iframe.${name}.vimium-ui-component-visible`)
            ),
          { polling: 20 },
          className,
        );
        return page.frames().find((frame) => frame.url().includes(`/pages/${path}.html`));
      };
      if (!allowInternal) {
        assert(
          await worker.evaluate(() => Settings.get("grabBackFocus")),
          "Default page focus off",
        );
        // No key has been pressed: exercise the first-open race with the default focus mode active.
        await invoke("browser_pages", "openBrowserPages", sourceId);
        const palette = await overlay(source, "browser-pages-frame", "browser_pages");
        await palette.waitForFunction(() => document.activeElement?.id === "search");
        const box = await palette.$eval("#vomnibar", (element) => {
          const rect = element.getBoundingClientRect();
          return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
        });
        assert(Math.abs(box.x - 640) < 2 && Math.abs(box.y - 450) < 2, "Palette is not centered");
        await source.setViewport({ width: 390, height: 300 });
        await palette.waitForFunction(() => {
          const box = document.querySelector("#vomnibar").getBoundingClientRect();
          const input = document.querySelector("#search").getBoundingClientRect();
          return box.top >= 0 && box.bottom <= innerHeight && box.left >= 0 &&
            box.right <= innerWidth &&
            input.top >= 0 && input.bottom <= innerHeight;
        });
        await source.setViewport({ width: 1280, height: 900 });
        pass("Browser-page palette keeps its input and controls visible in a small tiled window");
        await palette.type("#search", "unmatched-query-xyz");
        assert(
          await palette.$$eval("#results li", (rows) => rows.length) === 0,
          "Unknown search leaked results",
        );
        const before = (await browser.pages()).length;
        await source.keyboard.press("Enter");
        assert((await browser.pages()).length === before, "No-match search opened a web search");
        await palette.select("#profile", "brave");
        await palette.$eval("#search", (input) => {
          input.value = "shields";
          input.dispatchEvent(new Event("input"));
        });
        assert(
          await palette.$$eval(".url", (rows) =>
            rows.length > 0 && rows.every((row) =>
              row.textContent.startsWith("brave://")
            )),
          "Brave profile missing",
        );
        await palette.select("#profile", "auto");
        await palette.$eval("#search", (input) => {
          input.value = "extensions";
          input.dispatchEvent(new Event("input"));
        });
        await source.keyboard.press("Enter");
        await until(async () => await activeId() !== sourceId, "Result did not activate a new tab");
        assert(source.url() === `${origin}/source`, "Palette navigated the source tab");
        const destination = (await browser.pages()).find((page) =>
          page.url() === "chrome://extensions/"
        );
        assert(destination, "Extensions result missing");
        await until(
          () =>
            source.evaluate(() =>
              [...document.documentElement.children].every((element) =>
                !element.shadowRoot?.querySelector(
                  "iframe.browser-pages-frame.vimium-ui-component-visible",
                )
              )
            ),
          "Palette did not close",
        );
        await destination.close();
        await source.bringToFront();
        await invoke("browser_pages", "openBrowserPages", sourceId);
        await palette.waitForFunction(() => document.activeElement?.id === "search");
        await source.keyboard.press("Escape");
        pass(
          "Fresh palette is focused and centered; results are browser-only and always open a new tab",
        );
      }

      const protectedPage = await browser.newPage();
      protectedPage.setDefaultTimeout(5000);
      const protectedUrl = allowInternal ? "chrome://extensions/" : "chrome://settings/";
      await protectedPage.goto(protectedUrl);
      await protectedPage.bringToFront();
      const protectedId = await worker.evaluate(
        async (url) => (await chrome.tabs.query({})).find((tab) => tab.url === url).id,
        protectedUrl,
      );
      if (allowInternal) {
        await until(() =>
          worker.evaluate(async (tabId) => {
            const [state] = await chrome.scripting.executeScript({
              target: { tabId },
              func: () =>
                !!globalThis.brovimContentScriptsLoaded && typeof normalMode !== "undefined",
            });
            return state?.result;
          }, protectedId), "Browser-page controls did not initialize before key events");
      }
      if (!allowInternal) {
        await invoke("browser_pages", "openBrowserPages", protectedId);
        const target = await browser.waitForTarget((target) =>
          target.url().includes("/pages/browser_pages.html?tab=")
        );
        const palette = await target.page();
        await palette.waitForFunction(() => document.activeElement?.id === "search");
        await palette.type("#search", "downloads");
        await palette.keyboard.press("Enter");
        await until(
          () => Promise.resolve(target.isClosed?.() ?? !browser.targets().includes(target)),
          "Temporary palette tab did not close",
        );
        assert(protectedPage.url() === "chrome://settings/", "Fallback changed the source");
        const destination = (await browser.pages()).find((page) =>
          page.url() === "chrome://downloads/"
        );
        assert(destination, "Fallback did not open downloads");
        await destination.close();
        pass(
          "Protected-page palette focuses the input and opens a new tab without changing its source",
        );
      }
      // Alt+Q uses the same settings and release behavior on browser pages as on websites.
      await worker.evaluate(() => Settings.set("enableInternalPages", false));
      await worker.evaluate((id) => chrome.tabs.update(id, { pinned: true }), sourceId);
      const tabsToClose = await worker.evaluate(
        async (keep) =>
          (await chrome.tabs.query({})).filter((tab) => !keep.includes(tab.id)).map((tab) =>
            tab.id
          ),
        [sourceId, protectedId],
      );
      await worker.evaluate((ids) => chrome.tabs.remove(ids), tabsToClose);
      await worker.evaluate(() => Settings.set("tabSwitcherTwoTabSwap", true));
      await focusTab(protectedPage, protectedId);
      await invoke("tab_switcher", "openTabSwitcher", protectedId);
      assert(await activeId() === sourceId, "Browser pages ignored the normal two-tab quick swap");
      pass(
        `Two-tab quick swap matches ordinary tabs (developer flag ${allowInternal ? "on" : "off"})`,
      );
      await worker.evaluate(() => Settings.set("tabSwitcherTwoTabSwap", false));
      await focusTab(protectedPage, protectedId);
      if (!allowInternal) {
        await invoke("tab_switcher", "openTabSwitcher", protectedId);
        assert(
          await activeId() === sourceId,
          "Protected page did not use the normal direct-switch fallback",
        );
        assert((await browser.pages()).length === 2, "Direct fallback created an extra UI tab");
        pass("Browser pages that forbid scripts use the normal direct-switch fallback");
      } else {
        await protectedPage.keyboard.down("Alt");
        await invoke("tab_switcher", "openTabSwitcher", protectedId);
        const grid = await overlay(protectedPage, "tab-switcher-frame", "tab_switcher_page").catch(
          async (error) => {
            console.log(
              "Browser grid state:",
              await worker.evaluate(async (tabId) => ({
                active: (await chrome.tabs.query({ active: true, currentWindow: true }))[0].id,
                content: await chrome.scripting.executeScript({
                  target: { tabId },
                  func: () => ({
                    modifiers: TabSwitcher.modifierState,
                    opening: TabSwitcher.isOpening,
                    unavailable: TabSwitcher.isUnavailable,
                    showing: TabSwitcher.tabSwitcherUI?.showing,
                    focused: document.hasFocus(),
                  }),
                }),
              }), protectedId),
            );
            throw error;
          },
        );
        await grid.waitForSelector("#panel.ready .selected");
        assert(await activeId() === protectedId, "Held shortcut switched before release");
        await protectedPage.keyboard.up("Alt");
        await until(
          async () => await activeId() === sourceId,
          "Browser-page grid did not commit on release",
        );
        assert(
          await worker.evaluate(() => Settings.get("enableInternalPages")) === false,
          "Tab switching changed the normal browser-page option",
        );
        pass("Browser-page grid opens with ordinary mappings off and commits on Alt release");
        await focusTab(protectedPage, protectedId);
        await protectedPage.keyboard.down("Alt");
        await protectedPage.keyboard.up("Alt");
        await invoke("tab_switcher", "openTabSwitcher", protectedId);
        await until(
          async () => await activeId() === sourceId,
          "Release before background activation left the grid stuck",
        );
        pass("A quick release before browser-page activation still switches automatically");
        await focusTab(protectedPage, protectedId);
        await protectedPage.keyboard.down("Alt");
        await invoke("tab_switcher", "openTabSwitcher", protectedId);
        await grid.waitForSelector("#panel.ready .selected");
        await protectedPage.keyboard.press("Escape");
        await protectedPage.keyboard.up("Alt");
        assert(await activeId() === protectedId, "Escape committed the browser-page grid");
        pass("Escape cancels the browser-page grid without changing tabs");
      }
      assert(
        await worker.evaluate(async () => (await chrome.windows.getAll()).length) === 1,
        "Tab switching opened another window",
      );
    } finally {
      await browser.close();
    }
  }
  assert(errors.length === 0, `Uncaught errors: ${errors.join("; ")}`);
  pass("No uncaught errors in browser navigation");
  console.log(`Browser navigation checks: ${passed} passed`);
} finally {
  await server.shutdown();
}
