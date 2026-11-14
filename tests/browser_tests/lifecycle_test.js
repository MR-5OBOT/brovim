import puppeteer from "puppeteer";
import { fileURLToPath } from "node:url";

const root = Deno.env.get("BROVIM_EXTENSION_PATH") ||
  fileURLToPath(new URL("../../", import.meta.url));
const firefox = Deno.env.get("BROVIM_TEST_BROWSER") === "firefox";
const executablePath = Deno.env.get("PUPPETEER_EXECUTABLE_PATH") || undefined;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const errors = [];
let passed = 0;
let browser;

function assert(value, message) {
  if (!value) throw new Error(message);
}

function pass(name) {
  passed++;
  console.log(`PASS ${name}`);
}

function track(page) {
  page.on("pageerror", (error) => errors.push(error.message));
  return page;
}

// Firefox and incognito extension shadow trees are not consistently visible to Puppeteer's
// isolated selector realm. Query the page realm and verify the port handshake has shown the frame.
async function visibleUi(page, name) {
  for (let i = 0; i < 50; i++) {
    if (
      await page.evaluate(
        (name) =>
          [...document.documentElement.children].some((element) =>
            element.shadowRoot?.querySelector(`iframe.${name}.vimium-ui-component-visible`)
          ),
        name,
      )
    ) return;
    await pause(100);
  }
  throw new Error(`${name} did not become visible`);
}

const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen() {} }, () =>
  new Response(
    '<!doctype html><html><head><title>Lifecycle fixture</title></head><body><a href="/target">Test link</a><main style="height:5000px">Scroll area</main></body></html>',
    { headers: { "content-type": "text/html" } },
  ));
const origin = `http://127.0.0.1:${server.addr.port}`;

try {
  if (firefox) {
    const manifest = JSON.parse(await Deno.readTextFile(`${root}/manifest.json`));
    const id = manifest.browser_specific_settings?.gecko?.id;
    assert(id, "BROVIM_EXTENSION_PATH must point to an extracted Firefox package");
    const uuid = "a6de5138-2233-4c3d-8f20-5e211b8e7e74";
    browser = await puppeteer.launch({
      browser: "firefox",
      executablePath,
      headless: true,
      env: { ...Deno.env.toObject(), MOZ_REMOTE_ALLOW_SYSTEM_ACCESS: "1" },
      extraPrefsFirefox: {
        "extensions.webextensions.uuids": JSON.stringify({ [id]: uuid }),
      },
    });
    await browser.installExtension(root);
    console.log(`Testing ${await browser.version()}`);
    const page = track(await browser.newPage());
    await page.goto(`${origin}/normal`);
    await pause(200);
    await page.keyboard.press("f");
    await page.waitForSelector(".vimiumHintMarker");
    await page.keyboard.press("Escape");
    await pause(150);
    pass("Firefox link hints");
    await page.keyboard.press("o");
    await visibleUi(page, "vomnibar-frame");
    await page.keyboard.press("Escape");
    await pause(150);
    pass("Firefox Vomnibar");
    await page.keyboard.press("j");
    await page.waitForFunction(() => scrollY > 0);
    pass("Firefox scrolling");

    const options = track(await browser.newPage());
    const optionsUrl = `moz-extension://${uuid}/pages/options.html`;
    try {
      await options.goto(optionsUrl, { timeout: 3000, waitUntil: "domcontentloaded" });
    } catch (error) {
      // Firefox BiDi can omit navigation events for extension pages. Require the actual loaded
      // document and form instead of accepting a timeout as evidence of success.
      const state = await options.evaluate(() => ({
        href: location.href,
        ready: document.readyState,
      }));
      if (
        error.name !== "TimeoutError" || state.href !== optionsUrl || state.ready !== "complete"
      ) {
        throw error;
      }
    }
    await options.waitForSelector("#save");
    await options.waitForFunction(() =>
      document.querySelector("[name=linkHintColor]")?.value === "#68039b"
    );
    pass("Firefox options load saved settings");
    await options.waitForFunction(() => {
      const logo = document.querySelector(".settings-brand img");
      return logo?.complete && logo.naturalWidth > 0;
    }, { timeout: 2000 });
    pass("Firefox settings logo loads from the packaged assets");

    await page.bringToFront();
    const preview = await options.evaluate(async (url) => {
      for (let i = 0; i < 60; i++) {
        const preview = Object.values(await chrome.storage.local.get(`tabThumbnail:${url}`))[0];
        if (preview) return preview;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return null;
    }, `${origin}/normal`);
    assert(preview?.startsWith("data:image/jpeg;base64,"), "Firefox did not save a thumbnail");
    pass("Firefox captures and stores thumbnails");
    await options.evaluate(async ({ url, preview }) => {
      const { storeThumbnail, findThumbnails } = await import(
        chrome.runtime.getURL("background_scripts/thumbnails.js")
      );
      await storeThumbnail(url, true, preview);
      if (Object.values(await chrome.storage.local.get(`tabThumbnail:${url}`))[0]) {
        throw new Error("A private preview reached Firefox's local storage fallback");
      }
      if ((await findThumbnails([url], true))[0] !== preview) {
        throw new Error("The private preview was not kept in memory");
      }
    }, { url: `${origin}/private-memory-check`, preview });
    pass("Firefox session fallback keeps private previews off disk");

    const peer = track(await browser.newPage());
    await peer.goto(`${origin}/peer`);
    await page.bringToFront();
    const sourceId = await options.evaluate(async (url) => {
      const tab = (await chrome.tabs.query({})).find((tab) => tab.url === url);
      if (!tab) throw new Error("The Firefox fixture tab is missing");
      await chrome.tabs.sendMessage(tab.id, {
        handler: "runInTopFrame",
        sourceFrameId: 0,
        registryEntry: { command: "TabSwitcher.activate", options: { altCycle: false } },
      }, { frameId: 0 });
      return tab.id;
    }, `${origin}/normal`);
    await visibleUi(page, "tab-switcher-frame");
    await pause(100);
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Enter");
    for (let i = 0; i < 50; i++) {
      if (!await options.evaluate(async (id) => (await chrome.tabs.get(id)).active, sourceId)) {
        break;
      }
      await pause(100);
    }
    assert(
      !await options.evaluate(async (id) => (await chrome.tabs.get(id)).active, sourceId),
      "Firefox switcher did not select another tab",
    );
    pass("Firefox switcher opens and keyboard selection activates a tab");
  } else {
    // A real profile incognito window is required: CDP's custom off-the-record contexts do not
    // load the profile's extensions. Restart the temporary profile to apply incognito access.
    const launchOptions = {
      executablePath,
      headless: true,
      enableExtensions: true,
      args: [`--load-extension=${root}`, `--disable-extensions-except=${root}`],
      userDataDir: await Deno.makeTempDir({ prefix: "brovim-lifecycle-profile-" }),
    };
    browser = await puppeteer.launch(launchOptions);
    const target = await browser.waitForTarget((target) => target.type() === "service_worker");
    const id = new URL(target.url()).hostname;
    const details = await browser.newPage();
    await details.goto(`chrome://extensions/?id=${id}`);
    await details.waitForFunction(() =>
      document.querySelector("extensions-manager")?.shadowRoot
        .querySelector("extensions-detail-view")?.shadowRoot.querySelector("#allow-incognito")
    );
    await details.evaluate(() => {
      const row = document.querySelector("extensions-manager").shadowRoot
        .querySelector("extensions-detail-view").shadowRoot.querySelector("#allow-incognito");
      if (!row.checked) row.shadowRoot.querySelector("cr-toggle").click();
    });
    await browser.close();
    browser = await puppeteer.launch(launchOptions);
    const options = track(await browser.newPage());
    await options.goto(`chrome-extension://${id}/pages/options.html`);
    assert(
      await options.evaluate(() => chrome.extension.isAllowedIncognitoAccess()),
      "Incognito access was not enabled",
    );
    await options.evaluate(
      (url) => chrome.windows.create({ incognito: true, url }),
      `${origin}/private`,
    );
    const privateTarget = await browser.waitForTarget((target) =>
      target.url() === `${origin}/private`
    );
    const privatePage = track(await privateTarget.page());
    await pause(200);
    await privatePage.keyboard.press("f");
    await privatePage.waitForSelector(".vimiumHintMarker");
    await privatePage.keyboard.press("Escape");
    await pause(150);
    await privatePage.keyboard.press("o");
    await visibleUi(privatePage, "vomnibar-frame");
    await privatePage.keyboard.press("Escape");
    pass("Real incognito window supports hints and Vomnibar");

    await options.evaluate(() =>
      chrome.storage.session.set({
        findModeRawQueryList: ["normal-query"],
        findModeRawQueryListIncognito: ["private-query"],
      })
    );
    const historyPeer = await options.evaluate(async (url) => {
      const source = (await chrome.tabs.query({})).find((tab) => tab.url === url);
      return await chrome.tabs.create({
        windowId: source.windowId,
        url: `${url}-history-peer`,
        active: true,
      });
    }, `${origin}/private`);
    try {
      const peerTarget = await browser.waitForTarget((target) =>
        target.url() === `${origin}/private-history-peer`
      );
      const peerPage = track(await peerTarget.page());
      const state = await options.evaluate(async (tabId) => {
        const [{ result }] = await chrome.scripting.executeScript({
          target: { tabId },
          func: async () => {
            for (let i = 0; i < 50 && !globalThis.FindModeHistory?.rawQueryList; i++) {
              await new Promise((resolve) => setTimeout(resolve, 50));
            }
            return {
              private: chrome.extension.inIncognitoContext,
              query: FindModeHistory.getQuery(),
            };
          },
        });
        return result;
      }, historyPeer.id);
      assert(state.private && state.query === "private-query", JSON.stringify(state));
      await peerPage.bringToFront();
      await peerPage.keyboard.press("/");
      await visibleUi(peerPage, "vimium-hud-frame");
      // Puppeteer can list a just-shown extension frame before it knows the frame's URL.
      const hud = await peerPage.waitForFrame((frame) =>
        frame.url().includes("/pages/hud_page.html")
      );
      await hud.waitForFunction(() => FindModeHistory.rawQueryList?.[0] === "private-query");
      const history = await options.evaluate(() =>
        chrome.storage.session.get([
          "findModeRawQueryList",
          "findModeRawQueryListIncognito",
        ])
      );
      assert(
        history.findModeRawQueryListIncognito[0] === "private-query",
        "Private history was reset",
      );
      assert(
        history.findModeRawQueryList[0] === "normal-query",
        "Private queries reached normal history",
      );
      await peerPage.keyboard.press("Escape");
      pass(
        "New private tabs and HUDs preserve private find history without changing normal history",
      );
    } finally {
      await options.evaluate((id) => chrome.tabs.remove(id), historyPeer.id);
      await privatePage.bringToFront();
    }

    const normalPage = track(await browser.newPage());
    await normalPage.goto(`${origin}/normal`);
    await normalPage.bringToFront();
    await pause(1500);
    await privatePage.bringToFront();
    await pause(1500);
    const storage = await options.evaluate(async () => ({
      local: await chrome.storage.local.get(null),
      session: await chrome.storage.session.get(null),
    }));
    assert(storage.local[`tabThumbnail:${origin}/normal`], "Normal preview is missing");
    // Pages can read session storage: a private preview stays in the worker's memory.
    assert(
      !storage.local[`tabThumbnail:${origin}/private`] &&
        !storage.session[`tabThumbnail:${origin}/private`],
      "Incognito preview reached storage",
    );
    pass("Normal captures are stored, and incognito captures are not");

    const privateTabs = await options.evaluate(async (url) => {
      const source = (await chrome.tabs.query({})).find((tab) => tab.url === url);
      const peer = await chrome.tabs.create({
        windowId: source.windowId,
        url: `${url}-peer`,
        active: false,
      });
      await chrome.tabs.sendMessage(source.id, {
        handler: "runInTopFrame",
        sourceFrameId: 0,
        registryEntry: { command: "TabSwitcher.activate", options: { altCycle: false } },
      }, { frameId: 0 });
      return { source: source.id, peer: peer.id };
    }, `${origin}/private`);
    await visibleUi(privatePage, "tab-switcher-frame");
    const privateGrid = await privatePage.waitForFrame((frame) =>
      frame.url().includes("/pages/tab_switcher_page.html")
    );
    await privateGrid.waitForFunction(() => document.querySelector("#panel.ready .tab-card"));
    const cards = await privateGrid.$$eval(".tab-card", (cards) =>
      cards.map((card) => ({
        id: Number(card.dataset.id),
        image: card.querySelector("img")?.src,
      })));
    assert(
      cards.length === 2 && cards[0].id === privateTabs.source &&
        cards.every((card) => [privateTabs.source, privateTabs.peer].includes(card.id)),
      "Private grid listed tabs from the wrong window",
    );
    assert(
      cards[0].image?.startsWith("data:image/"),
      "Private grid did not use its private preview",
    );
    await privatePage.keyboard.press("Escape");
    await options.evaluate((id) => chrome.tabs.remove(id), privateTabs.peer);
    pass("Real incognito grid retains its source window and private preview context");

    await options.evaluate(() => chrome.storage.sync.set({ tabSwitcherAutoCapture: false }));
    const internals = await browser.newPage();
    await internals.goto("chrome://serviceworker-internals");
    await internals.waitForSelector('cr-button[data-command="stop"]');
    await normalPage.bringToFront();
    await pause(2000);
    const oldWorker = browser.targets().find((target) => target.type() === "service_worker");
    const before = await options.evaluate(() =>
      chrome.storage.session.get(["tabRecency", "vimiumSecret"])
    );
    const destroyed = new Promise((resolve) => {
      const onDestroyed = (target) => {
        if (target !== oldWorker) return;
        browser.off("targetdestroyed", onDestroyed);
        resolve(true);
      };
      browser.on("targetdestroyed", onDestroyed);
    });
    await internals.evaluate(() =>
      document.querySelector('cr-button[data-command="stop"]').click()
    );
    assert(await Promise.race([destroyed, pause(5000).then(() => false)]), "Worker did not stop");
    pass("Background worker stop confirmed by target destruction");
    await normalPage.keyboard.press("o");
    await visibleUi(normalPage, "vomnibar-frame");
    await browser.waitForTarget((target) =>
      target.type() === "service_worker" && target !== oldWorker
    );
    const after = await options.evaluate(() =>
      chrome.storage.session.get(["tabRecency", "vimiumSecret"])
    );
    // The new worker above proves the restart. It keeps the secret: a UI frame may be checking it.
    assert(
      before.vimiumSecret && before.vimiumSecret === after.vimiumSecret,
      "The restarted background replaced the session secret",
    );
    assert(
      JSON.stringify(before.tabRecency) === JSON.stringify(after.tabRecency),
      "Worker stop lost MRU order",
    );
    pass("First post-suspension Vomnibar works and MRU order survives");
  }
  assert(errors.length === 0, errors.join("\n"));
  pass("No uncaught errors in lifecycle fixture pages");
} finally {
  await browser?.close();
  await server.shutdown();
}
console.log(`Lifecycle checks: ${passed} passed`);
