import puppeteer from "puppeteer";
import { fileURLToPath } from "node:url";

const root = Deno.env.get("BROVIM_EXTENSION_PATH") ||
  fileURLToPath(new URL("../../", import.meta.url));
const failures = [];
const errors = [];
let passed = 0;

function assert(value, message) {
  if (!value) throw new Error(message);
}

async function check(name, fn) {
  console.log(`RUN ${name}`);
  try {
    await fn();
    passed++;
    console.log(`PASS ${name}`);
  } catch (error) {
    failures.push(name);
    console.error(`FAIL ${name}: ${error.stack}`);
  }
}

const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen() {} }, (request) => {
  const url = new URL(request.url);
  if (url.pathname === "/favicon.ico") return new Response(null, { status: 204 });
  const title = url.searchParams.get("title") || "Brovim browser fixture";
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
    <style>body{margin:20px;font:16px sans-serif}a{display:inline-block;margin:8px}
    main{width:2400px;height:5000px}p{margin:40px 0}</style></head><body>
    <input id="first" aria-label="First input"><input id="second" aria-label="Second input">
    <div>${
      Array.from({ length: 32 }, (_, i) =>
        `<a href="/target?link=${i}">${i === 31 ? "Unique destination" : `Link ${i}`}</a>`).join("")
    }</div>
    <p>Literal needle.*[x] first</p><p>Literal needle.*[x] second</p>
    <main>Scrollable area</main></body></html>`,
    {
      headers: { "content-type": "text/html; charset=utf-8" },
    },
  );
});
const origin = `http://127.0.0.1:${server.addr.port}`;
let browser;

try {
  browser = await puppeteer.launch({
    executablePath: Deno.env.get("PUPPETEER_EXECUTABLE_PATH") || undefined,
    headless: true,
    enableExtensions: [root],
    defaultViewport: { width: 1280, height: 900 },
  });
  browser.on("targetcreated", async (target) => {
    if (target.type() !== "page") return;
    const page = await target.page();
    page?.on("pageerror", (error) => errors.push(`${page.url()}: ${error.message}`));
    page?.on("dialog", (dialog) => dialog.accept());
  });
  const workerTarget = await browser.waitForTarget((target) =>
    target.type() === "service_worker" && target.url().endsWith("/background_scripts/main.js")
  );
  const worker = await workerTarget.worker();
  const workerSession = await workerTarget.createCDPSession();
  await workerSession.send("Runtime.enable");
  workerSession.on("Runtime.exceptionThrown", ({ exceptionDetails }) => {
    errors.push(
      `Service worker: ${exceptionDetails.exception?.description || exceptionDetails.text}`,
    );
  });
  const extensionOrigin = new URL(workerTarget.url()).origin;
  // URL.origin is "null" for chrome-extension URLs in Node's URL implementation.
  const extensionUrl = extensionOrigin === "null"
    ? workerTarget.url().replace("/background_scripts/main.js", "")
    : extensionOrigin;
  const options = await browser.newPage();
  options.setDefaultTimeout(5000);
  await options.goto(`${extensionUrl}/pages/options.html`);
  await options.waitForFunction(() =>
    document.querySelector("[name=linkHintColor]")?.value === "#68039b"
  );
  const page = await browser.newPage();
  page.setDefaultTimeout(5000);
  const tabId = async (p = page) => {
    const { targetInfo } = await p.createCDPSession().then((s) => s.send("Target.getTargetInfo"));
    return await worker.evaluate(async (url) => {
      const tabs = await chrome.tabs.query({});
      return tabs.find((tab) => tab.url === url)?.id;
    }, targetInfo.url);
  };
  const pause = (ms = 100) => new Promise((resolve) => setTimeout(resolve, ms));
  const key = async (keys, p = page) => {
    for (const k of keys) {
      const parts = k.split("+");
      const last = parts.pop();
      for (const modifier of parts) await p.keyboard.down(modifier);
      await p.keyboard.press(last);
      for (const modifier of parts.reverse()) await p.keyboard.up(modifier);
    }
    await pause();
  };
  const fresh = async () => {
    await page.bringToFront();
    try {
      await page.goto(`${origin}/`);
    } catch (error) {
      // Chromium can supersede the first navigation while finishing extension installation.
      if (!error.message.includes("net::ERR_ABORTED")) throw error;
      await page.goto(`${origin}/`);
    }
    await page.waitForFunction(() => document.readyState === "complete");
    await pause(150);
  };
  // Puppeteer pierces open shadow roots with its >>> selector.
  const ui = async (name) => {
    await page.waitForSelector(`:root >>> iframe.${name}.vimium-ui-component-visible`);
    return await (await page.$(`:root >>> iframe.${name}`)).contentFrame();
  };
  const noUi = async (name) => {
    await page.waitForSelector(`:root >>> iframe.${name}.vimium-ui-component-visible`, {
      hidden: true,
    });
  };
  const hints = () =>
    page.$$eval(".vimiumHintMarker", (els) =>
      els.map((el) => ({
        text: el.textContent,
        box: getComputedStyle(el).backgroundColor,
        textColor: getComputedStyle(el.querySelector("span")).color,
      })));
  const setOption = async (name, value) => {
    await options.bringToFront();
    await options.$eval(`[name="${name}"]`, (el, val) => {
      if (el.type === "checkbox") el.checked = val;
      else el.value = val;
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }, value);
  };
  const save = async () => {
    await options.click("#save");
    await options.waitForFunction(() => document.querySelector("#save").textContent === "Saved");
    await page.bringToFront();
    await pause();
  };
  const openSwitcher = async (targetPage = page) => {
    const id = await tabId(targetPage);
    await worker.evaluate(
      (id) =>
        chrome.tabs.sendMessage(id, {
          handler: "runInTopFrame",
          sourceFrameId: 0,
          registryEntry: { command: "TabSwitcher.activate", options: { altCycle: true } },
        }),
      id,
    );
  };

  await fresh();
  await check("save hint colors and use them in an already open tab", async () => {
    await setOption("linkHintColor", "#146e32");
    await setOption("linkHintTextColor", "#ffeedd");
    await setOption("linkHintMatchColor", "#12abcd");
    await save();
    await key(["f"]);
    await page.waitForSelector(".vimiumHintMarker");
    const colors = await hints();
    assert(colors[0].box === "rgb(20, 110, 50)", JSON.stringify(colors[0]));
    assert(colors[0].textColor === "rgb(255, 238, 221)", JSON.stringify(colors[0]));
    const multi = colors.find((hint) => hint.text.length > 1);
    assert(multi, "Expected multi-character hints");
    await key([multi.text[0].toLowerCase()]);
    const color = await page.$eval(".matchingCharacter", (el) => getComputedStyle(el).color);
    assert(color === "rgb(18, 171, 205)", color);
  });
  await key(["Escape"]);

  await check("saved hint colors survive a page reload", async () => {
    await page.reload();
    await pause(200);
    await key(["f"]);
    await page.waitForSelector(".vimiumHintMarker");
    assert((await hints())[0].box === "rgb(20, 110, 50)", JSON.stringify(await hints()));
    await key(["Escape"]);
  });

  await check("custom CSS overrides the hint color pickers", async () => {
    await setOption("userDefinedLinkHintCss", "div > .vimiumHintMarker { background: #123456; }");
    await save();
    await fresh();
    await key(["f"]);
    await page.waitForSelector(".vimiumHintMarker");
    assert((await hints())[0].box === "rgb(18, 52, 86)", JSON.stringify(await hints()));
    await key(["Escape"]);
    await setOption("userDefinedLinkHintCss", "");
    await save();
  });

  await check("each hint color Reset restores and saves its default", async () => {
    await options.bringToFront();
    for (const name of ["linkHintColor", "linkHintTextColor", "linkHintMatchColor"]) {
      await options.$eval(`[name=${name}]`, (el) => el.closest("div").querySelector("a").click());
    }
    await save();
    await options.reload();
    await options.waitForFunction(() =>
      document.querySelector("[name=linkHintColor]")?.value === "#68039b"
    );
    const colors = await options.$$eval("input[type=color]", (els) => els.map((el) => el.value));
    assert(
      JSON.stringify(colors) === JSON.stringify(["#68039b", "#ffffff", "#d4ac3a"]),
      JSON.stringify(colors),
    );
  });

  await check("scroll bindings j/k, h/l, d/u, gg/G, zH/zL and Space", async () => {
    await fresh();
    await key(["j"]);
    await page.waitForFunction(() => scrollY > 0);
    const down = await page.evaluate(() => scrollY);
    await key(["k"]);
    await page.waitForFunction((y) => scrollY < y, {}, down);
    await key(["l"]);
    await page.waitForFunction(() => scrollX > 0);
    await key(["h"]);
    await key(["d"]);
    await page.waitForFunction(() => scrollY > 100);
    await key(["u"]);
    await key(["G"]);
    await page.waitForFunction(() => scrollY > 3500);
    await key(["g", "g"]);
    await page.waitForFunction(() => scrollY === 0);
    await key(["z", "L"]);
    await page.waitForFunction(() => scrollX > 1000);
    await key(["z", "H"]);
    await page.waitForFunction(() => scrollX === 0);
    await key(["Space"]);
    await page.waitForFunction(() => scrollY > 300);
    await key(["Shift+Space"]);
    await page.waitForFunction(() => scrollY < 100);
  });

  await check("insert mode, gi, and digits pass through to the page", async () => {
    await fresh();
    await key(["g", "i"]);
    await page.waitForFunction(() => document.activeElement.id === "first");
    await page.keyboard.type("j123");
    assert(await page.$eval("#first", (el) => el.value === "j123"), "Typing was intercepted");
    await key(["Escape"]);
    await page.evaluate(() => {
      globalThis.seenDigits = [];
      document.addEventListener("keydown", (event) => {
        if (/^[0-9]$/.test(event.key)) globalThis.seenDigits.push(event.key);
      });
    });
    await key(["1", "2", "3"]);
    assert(await page.evaluate(() => seenDigits.join("") === "123"), "Digits were intercepted");
    await key(["i", "j"]);
    assert(await page.evaluate(() => scrollY === 0), "Insert mode scrolled the page");
    await key(["Escape"]);
  });

  await check("f follows a link and H/L navigate history", async () => {
    await fresh();
    await key(["f"]);
    await page.waitForSelector(".vimiumHintMarker");
    // The first two hints belong to the fixture's text inputs.
    const label = (await hints())[2].text;
    await key([...label.toLowerCase()]);
    await page.waitForFunction(() => location.pathname === "/target");
    await key(["H"]);
    await page.waitForFunction(() => location.pathname === "/");
    await key(["L"]);
    await page.waitForFunction(() => location.pathname === "/target");
  });

  await check("f then f follows the F hint and removes the labels", async () => {
    await fresh();
    await key(["f"]);
    await page.waitForSelector(".vimiumHintMarker");
    assert((await hints()).some((hint) => hint.text === "F"), "Fixture needs an F hint");
    await key(["f"]);
    await page.waitForFunction(() => location.pathname === "/target");
    assert((await hints()).length === 0, "Hints remained after selecting F");
  });

  await check("a fast second f is retained while hints are being collected", async () => {
    await fresh();
    // Deliberately delay the background reply; the second key arrives during hint collection.
    await workerSession.send("Debugger.enable");
    await workerSession.send("Debugger.pause");
    try {
      await key(["f", "f"]);
    } finally {
      await workerSession.send("Debugger.resume");
      await workerSession.send("Debugger.disable");
    }
    await page.waitForFunction(() => location.pathname === "/target");
    assert((await hints()).length === 0, "Fast ff left hints visible");
  });

  await check("o/O/b/B/ge open and dismiss the Vomnibar", async () => {
    await fresh();
    for (const binding of [["o"], ["O"], ["b"], ["B"], ["g", "e"]]) {
      await key(binding);
      const vomnibar = await ui("vomnibar-frame");
      await vomnibar.waitForSelector("input", { visible: true });
      if (binding.join("") === "ge") {
        const value = await vomnibar.$eval("input", (el) => el.value);
        assert(value === page.url(), value);
      }
      await key(["Escape"]);
      await noUi("vomnibar-frame");
    }
  });

  await check("? opens the help dialog with current bindings", async () => {
    await fresh();
    await key(["?"]);
    const help = await ui("vimium-help-dialog-frame");
    assert(
      (await help.evaluate(() => document.body.textContent)).includes("Brovim"),
      "Missing help title",
    );
    await key(["Escape"]);
    await noUi("vimium-help-dialog-frame");
  });

  await check(
    "T does not open switcher, TabSwitcher opens, arrows/h/l move, Esc and outside click dismiss",
    async () => {
      await fresh();
      await key(["T"]);
      await noUi("tab-switcher-frame");
      await openSwitcher();
      const switcher = await ui("tab-switcher-frame");
      await switcher.waitForSelector(".tab-card.selected");
      const selected = () =>
        switcher.$$eval(
          ".tab-card",
          (els) => els.findIndex((el) => el.classList.contains("selected")),
        );
      assert(await selected() === 1, "Previous tab was not selected");
      await key(["h"]);
      assert(await selected() === 0, "h did not move left");
      await key(["l"]);
      assert(await selected() === 1, "l did not move right");
      await key(["Escape"]);
      await noUi("tab-switcher-frame");
      await openSwitcher();
      await ui("tab-switcher-frame");
      await switcher.click("body", { offset: { x: 1, y: 1 } });
      await noUi("tab-switcher-frame");
    },
  );

  await check("r/R reload the current tab", async () => {
    await fresh();
    for (const binding of ["r", "R"]) {
      await page.evaluate(() => document.body.dataset.reloaded = "no");
      await key([binding]);
      await page.waitForFunction(() => !document.body.dataset.reloaded);
    }
  });

  await check("zi/zo/z0 zoom and reset", async () => {
    await fresh();
    const id = await tabId();
    await key(["z", "i"]);
    await pause();
    assert(await worker.evaluate((id) => chrome.tabs.getZoom(id), id) > 1, "Zoom in failed");
    await key(["z", "o"]);
    await key(["z", "0"]);
    assert(await worker.evaluate((id) => chrome.tabs.getZoom(id), id) === 1, "Zoom reset failed");
  });

  await check("literal find accepts regex characters; n/N move between matches", async () => {
    await fresh();
    await key(["/"]);
    const hud = await ui("vimium-hud-frame");
    await hud.waitForFunction(() => document.activeElement.id === "hud-find-input");
    await page.keyboard.type("needle.*[x]");
    await hud.waitForFunction(() =>
      document.querySelector("#hud-match-count")?.textContent.includes("2")
    );
    await key(["Enter"]);
    await page.waitForFunction(() => getSelection().toString() === "needle.*[x]");
    const first = await page.evaluate(() => getSelection().anchorNode.parentElement.textContent);
    await key(["n"]);
    const next = await page.evaluate(() => getSelection().anchorNode.parentElement.textContent);
    assert(first !== next, `n stayed at ${first}`);
    await key(["N"]);
    assert(
      await page.evaluate(() => getSelection().anchorNode.parentElement.textContent) === first,
      "N did not return",
    );
    await key(["Escape"]);
  });

  await check("F opens a background link and Alt+f queues multiple links", async () => {
    await fresh();
    const count = (await browser.pages()).length;
    await key(["F"]);
    await page.waitForSelector(".vimiumHintMarker");
    await key([...(await hints())[2].text.toLowerCase()]);
    await browser.waitForTarget((target) => target.url().includes("/target?link="), {
      timeout: 5000,
    });
    assert((await browser.pages()).length === count + 1, "F did not open a tab");
    assert(await page.evaluate(() => document.hasFocus()), "F stole focus from the current tab");
    for (const other of await browser.pages()) {
      if (other.url().includes("/target?link=")) await other.close();
    }
    await fresh();
    await key(["Alt+f"]);
    await page.waitForSelector(".vimiumHintMarker");
    for (let i = 0; i < 2; i++) {
      await key([...(await hints())[2 + i].text.toLowerCase()]);
      await page.waitForSelector(".vimiumHintMarker");
    }
    assert((await browser.pages()).length === count + 2, "Queue mode did not open two tabs");
    await key(["Escape"]);
    for (const other of await browser.pages()) {
      if (other.url().includes("/target?link=")) await other.close();
    }
  });

  await check("yy/yf copy URLs; p/P open the clipboard URL", async () => {
    await fresh();
    await browser.defaultBrowserContext().overridePermissions(origin, [
      "clipboard-read",
      "clipboard-write",
    ]);
    await key(["y", "y"]);
    assert(
      await page.evaluate(() => navigator.clipboard.readText()) === page.url(),
      "yy copied the wrong URL",
    );
    await key(["y", "f"]);
    await page.waitForSelector(".vimiumHintMarker");
    await key([...(await hints())[2].text.toLowerCase()]);
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    assert(copied.includes("/target?link="), `yf copied ${copied}`);
    await key(["p"]);
    await page.waitForFunction((url) => location.href === url, {}, copied);
    await key(["P"]);
    const copiedTarget = await browser.waitForTarget(
      (target) =>
        target.type() === "page" && target.url() === copied &&
        target !== page.target(),
      { timeout: 5000 },
    );
    await (await copiedTarget.page()).close();
  });

  await check("Vomnibar submits a URL, finds bookmarks, and resolves search keywords", async () => {
    await fresh();
    await key(["o"]);
    const omni = await ui("vomnibar-frame");
    await omni.waitForSelector("input", { visible: true });
    await page.keyboard.type(`${origin}/omnibar`);
    await key(["Enter"]);
    await page.waitForFunction(() => location.pathname === "/omnibar");
    const bookmark = await worker.evaluate(
      (url) => chrome.bookmarks.create({ title: "Brovim audit bookmark", url }),
      `${origin}/bookmark`,
    );
    await key(["b"]);
    const bookmarks = await ui("vomnibar-frame");
    await page.keyboard.type("Brovim audit bookmark");
    await bookmarks.waitForFunction(() =>
      document.body.textContent.includes("Brovim audit bookmark")
    );
    await key(["Enter"]);
    await page.waitForFunction(() => location.pathname === "/bookmark");
    await worker.evaluate((id) => chrome.bookmarks.remove(id), bookmark.id);
    await key(["o"]);
    const search = await ui("vomnibar-frame");
    await page.keyboard.type("gh brovim");
    await search.waitForFunction(() => document.querySelector("input").value === "brovim");
    await page.setRequestInterception(true);
    const interceptSearch = (request) => {
      if (request.url().startsWith("https://github.com/search")) {
        request.respond({
          status: 200,
          contentType: "text/html",
          body: "<title>Search fixture</title>Search fixture",
        }).catch(() => {});
      } else {
        request.continue().catch(() => {});
      }
    };
    page.on("request", interceptSearch);
    try {
      await key(["Enter"]);
      await page.waitForFunction(() => location.href === "https://github.com/search?q=brovim");
    } finally {
      page.off("request", interceptSearch);
      await page.setRequestInterception(false).catch(() => {});
    }
  });

  await check("t/x/X create, close and restore a tab", async () => {
    await fresh();
    await setOption("newTabCustomUrl", `${origin}/new-tab`);
    await options.$eval("[name=newTabDestination][value=customUrl]", (el) => {
      el.click();
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await save();
    await key(["t"]);
    const target = await browser.waitForTarget((target) => target.url() === `${origin}/new-tab`, {
      timeout: 5000,
    });
    const created = await target.page();
    await created.waitForFunction(() => document.readyState === "complete");
    await pause(200);
    // Closing on keydown can destroy the target before Puppeteer dispatches keyup.
    await created.keyboard.press("x").catch((error) => {
      if (!/Target closed|Session closed/.test(error.message)) throw error;
    });
    await page.waitForFunction(() => document.hasFocus());
    assert(created.isClosed(), "x did not close the tab");
    await key(["X"]);
    const restored = await browser.waitForTarget((target) => target.url() === `${origin}/new-tab`, {
      timeout: 5000,
    });
    await (await restored.page()).close();
  });

  await check("J/K, gt/gT, ^, << / >>, pin and mute", async () => {
    await fresh();
    const other = await browser.newPage();
    await other.goto(`${origin}/other`);
    const id = await tabId();
    await page.bringToFront();
    await pause(200);
    const activeId = () =>
      worker.evaluate(async () =>
        (await chrome.tabs.query({ active: true, currentWindow: true }))[0].id
      );
    for (const binding of [["K"], ["g", "t"]]) {
      await key(binding);
      assert(await activeId() !== id, `${binding} did not switch tabs`);
      await page.bringToFront();
      await pause(200);
    }
    for (const binding of [["J"], ["g", "T"], ["^"]]) {
      await key(binding);
      assert(await activeId() !== id, `${binding} did not switch tabs`);
      await page.bringToFront();
      await pause(200);
    }
    const before = await worker.evaluate((id) => chrome.tabs.get(id), id);
    await key([">", ">"]);
    assert(
      (await worker.evaluate((id) => chrome.tabs.get(id), id)).index === before.index + 1,
      ">> did not move right",
    );
    await key(["<", "<"]);
    assert(
      (await worker.evaluate((id) => chrome.tabs.get(id), id)).index === before.index,
      "<< did not move left",
    );
    await key(["Alt+p"]);
    assert((await worker.evaluate((id) => chrome.tabs.get(id), id)).pinned, "Pin failed");
    await key(["Alt+p", "Alt+m"]);
    assert((await worker.evaluate((id) => chrome.tabs.get(id), id)).mutedInfo.muted, "Mute failed");
    await key(["Alt+m"]);
    await other.close();
  });

  await check("switcher Enter selects a tab, x closes it, and j/k move by rows", async () => {
    await fresh();
    const extras = [];
    for (let i = 0; i < 7; i++) {
      const extra = await browser.newPage();
      await extra.goto(`${origin}/extra?title=Preview${i}`);
      extras.push(extra);
    }
    await page.bringToFront();
    await pause(200);
    await openSwitcher();
    const switcher = await ui("tab-switcher-frame");
    await switcher.waitForSelector(".tab-card.selected");
    const selected = () =>
      switcher.$$eval(
        ".tab-card",
        (els) => els.findIndex((el) => el.classList.contains("selected")),
      );
    const columns = await switcher.$eval(
      "#tab-switcher",
      (el) => getComputedStyle(el).gridTemplateColumns.split(" ").length,
    );
    await key(["h", "j"]);
    assert(await selected() === columns, "j moved the wrong number of columns");
    await key(["k"]);
    assert(await selected() === 0, "k did not return to the first row");
    await key(["l"]);
    const before = await switcher.$$eval(".tab-card", (cards) => cards.length);
    await key(["x"]);
    await switcher.waitForFunction(
      (count) => document.querySelectorAll(".tab-card").length === count - 1,
      {},
      before,
    );
    assert(await selected() === 1, "Closing a tab moved the selection");
    const title = await switcher.$eval(".selected .card-label span", (el) => el.textContent);
    await key(["Enter"]);
    await pause(200);
    const active = await worker.evaluate(async () =>
      (await chrome.tabs.query({ active: true, currentWindow: true }))[0]
    );
    assert(active.title === title, `Selected ${active.title}, expected ${title}`);
    for (const extra of extras) if (!extra.isClosed()) await extra.close();
    await page.bringToFront();
  });

  await check("Alt cycling commits on Alt release, including the first quick open", async () => {
    await fresh();
    const other = await browser.newPage();
    await other.goto(`${origin}/alt-cycle`);
    await page.bringToFront();
    await pause(200);
    const id = await tabId();
    // Exercise the shortcut's content-script message. OS shortcut delivery requires a manual check.
    await page.keyboard.down("Alt");
    await worker.evaluate(
      (id) =>
        chrome.tabs.sendMessage(id, {
          handler: "runInTopFrame",
          sourceFrameId: 0,
          registryEntry: { command: "TabSwitcher.activate", options: { altCycle: true } },
        }),
      id,
    );
    await page.keyboard.up("Alt");
    await pause(400);
    const active = await worker.evaluate(async () =>
      (await chrome.tabs.query({ active: true, currentWindow: true }))[0]
    );
    assert(active.url === `${origin}/alt-cycle`, `Quick Alt release selected ${active.url}`);
    await other.close();
    await page.bringToFront();
  });

  await check("tab previews are downscaled and persisted in session storage", async () => {
    await fresh();
    await pause(750);
    const id = await tabId();
    const thumbnail = await worker.evaluate(
      async (id) =>
        (await chrome.storage.session.get(`tabScreenshot-${id}`))[`tabScreenshot-${id}`],
      id,
    );
    assert(thumbnail?.startsWith("data:image/jpeg;base64,"), "No stored screenshot");
    const width = await page.evaluate(
      async (url) => (await createImageBitmap(await (await fetch(url)).blob())).width,
      thumbnail,
    );
    assert(width <= 480, `Thumbnail is ${width}px wide`);
  });

  await check(
    "browser shortcut opens a switcher on restricted pages and uses their window",
    async () => {
      for (const url of ["chrome://extensions/", "chrome://newtab/", "about:blank"]) {
        // A separate source window catches accidental queries of the popup's or last-focused window.
        const source = await worker.evaluate(async (url) => {
          const window = await chrome.windows.create({ url, focused: true });
          return { windowId: window.id, tabId: window.tabs[0].id };
        }, url);
        let popup;
        try {
          const previous = await worker.evaluate(async ({ windowId, tabId, origin }) => {
            const tab = await chrome.tabs.create({
              windowId,
              url: `${origin}/previous?title=Previous%20in%20source%20window`,
              active: true,
            });
            await chrome.tabs.update(tabId, { active: true });
            return tab.id;
          }, { ...source, origin });
          await options.evaluate(async (id) => {
            const { openTabSwitcher } = await import("../background_scripts/tab_switcher.js");
            await openTabSwitcher(await chrome.tabs.get(id));
          }, source.tabId);
          const target = await browser.waitForTarget((target) =>
            target.url() ===
              `${extensionUrl}/pages/tab_switcher_page.html?windowId=${source.windowId}`
          );
          popup = await target.page();
          popup.setDefaultTimeout(5000);
          await popup.waitForSelector(".tab-card.selected");
          const titles = await popup.$$eval(
            ".card-label span",
            (els) => els.map((el) => el.textContent),
          );
          assert(titles.length === 2, `${url}: wrong window or missing visited tab: ${titles}`);
          assert(
            await popup.$eval(".selected .card-label span", (el) => el.textContent) ===
              "Previous in source window",
            `${url}: previous tab was not selected`,
          );
          // Invoke the same handler used by chrome.commands while the popup has focus.
          await options.evaluate(async (url) => {
            const { openTabSwitcher } = await import("../background_scripts/tab_switcher.js");
            const tabs = await chrome.tabs.query({});
            await openTabSwitcher(tabs.find((tab) => tab.url === url));
          }, popup.url());
          await popup.waitForFunction(() =>
            document.querySelector(".tab-card").classList.contains("selected")
          );
          await key(["ArrowRight", "Enter"], popup);
          await pause(150);
          const active = await worker.evaluate(
            async (windowId) => (await chrome.tabs.query({ windowId, active: true }))[0].id,
            source.windowId,
          );
          assert(active === previous, `${url}: Enter selected the wrong tab`);
          assert(popup.isClosed(), `${url}: popup stayed open after switching`);
        } finally {
          if (popup && !popup.isClosed()) await popup.close();
          await worker.evaluate((id) => chrome.windows.remove(id), source.windowId);
        }
      }
      await page.bringToFront();
    },
  );

  await check("popup opens and saves an exclusion for the active page", async () => {
    await fresh();
    await worker.evaluate(() => chrome.action.openPopup());
    const popupTarget = await browser.waitForTarget(
      (target) => target.url() === `${extensionUrl}/pages/action.html`,
      { timeout: 5000 },
    );
    const popup = await popupTarget.asPage();
    await popup.waitForSelector("#add-first-rule", { visible: true });
    assert(
      await popup.$eval("#how-many-enabled", (el) => el.textContent) === "All",
      "Popup has wrong enabled state",
    );
    await popup.click("#add-first-rule");
    await popup.click("#save");
    await popup.waitForFunction(() => document.querySelector("#save").textContent === "Saved");
    await page.bringToFront();
    await pause(200);
    await key(["j"]);
    assert(await page.evaluate(() => scrollY === 0), "Excluded page still handles j");
    await worker.evaluate(() => Settings.set("exclusionRules", []));
    await fresh();
  });

  await check(
    "light and dark themes render the switcher and options without overflow",
    async () => {
      for (const scheme of ["light", "dark"]) {
        await fresh();
        await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: scheme }]);
        await openSwitcher();
        const switcher = await ui("tab-switcher-frame");
        await switcher.waitForSelector(".tab-card.selected");
        const size = await switcher.$eval(
          "#tab-switcher",
          (el) => ({
            left: el.getBoundingClientRect().left,
            right: el.getBoundingClientRect().right,
            width: innerWidth,
          }),
        );
        assert(size.left >= 0 && size.right <= size.width, JSON.stringify(size));
        await page.screenshot({ path: `/tmp/brovim-switcher-${scheme}.png` });
        await key(["Escape"]);
        await options.emulateMediaFeatures([{ name: "prefers-color-scheme", value: scheme }]);
        await options.bringToFront();
        await options.screenshot({ path: `/tmp/brovim-options-${scheme}.png`, fullPage: true });
      }
    },
  );

  await check(
    "custom count mappings work and removed commands show validation errors",
    async () => {
      await fresh();
      await setOption("keyMappings", "map q scrollDown count=5");
      await save();
      await key(["q"]);
      await page.waitForFunction(() => scrollY >= 300);
      await setOption("keyMappings", "map q enterVisualMode");
      await options.click("#save");
      await options.waitForSelector(".validation-message");
      assert(
        await options.$eval(
          "[name=keyMappings]",
          (el) => el.classList.contains("validation-error"),
        ),
        "Removed command was accepted",
      );
      await setOption("keyMappings", "# Insert your preferred key mappings here.");
      await save();
    },
  );

  await check("Shift/Ctrl in hints and filtered hints remain usable", async () => {
    await fresh();
    await key(["f", "Control"]);
    assert((await hints()).length > 2, "Ctrl broke hint mode");
    await page.keyboard.down("Shift");
    await key([...(await hints())[2].text.toLowerCase()]);
    await page.keyboard.up("Shift");
    const target = await browser.waitForTarget((target) => target.url().includes("/target?link="), {
      timeout: 5000,
    });
    await (await target.page()).close();
    await setOption("filterLinkHints", true);
    await save();
    try {
      await fresh();
      await key(["f"]);
      await page.waitForSelector(".vimiumHintMarker");
      await page.keyboard.type("Unique destination");
      await key(["Enter"]);
      await page.waitForFunction(() => location.search === "?link=31");
    } finally {
      await setOption("filterLinkHints", false);
      await save();
    }
  });

  await check("gs opens source in a separate tab", async () => {
    await fresh();
    await key(["g", "s"]);
    const target = await browser.waitForTarget(
      (target) => target.url().startsWith("view-source:"),
      { timeout: 5000 },
    );
    await (await target.page()).close();
  });

  await check("hints reach links inside an embedded frame", async () => {
    await fresh();
    await page.evaluate((url) => {
      const iframe = document.createElement("iframe");
      iframe.src = url;
      iframe.style.cssText = "position:fixed;bottom:10px;right:10px;width:500px;height:250px";
      document.body.append(iframe);
    }, `${origin}/embedded`);
    await page.waitForFunction(() =>
      document.querySelector("iframe").contentDocument?.readyState === "complete"
    );
    await pause(200);
    await key(["f"]);
    const embedded = page.frames().find((frame) => frame.url() === `${origin}/embedded`);
    await embedded.waitForSelector(".vimiumHintMarker");
    const label = await embedded.evaluate(() => {
      const link = document.querySelector("a").getBoundingClientRect();
      return [...document.querySelectorAll(".vimiumHintMarker")].find((el) => {
        const marker = el.getBoundingClientRect();
        return Math.abs(marker.left - link.left) < 2 && Math.abs(marker.top - link.top) < 2;
      })?.textContent;
    });
    assert(label, "No hint was positioned over the embedded link");
    await key([...label.toLowerCase()]);
    try {
      await embedded.waitForFunction(() => location.pathname === "/target");
    } catch {
      throw new Error(JSON.stringify({
        label,
        url: embedded.url(),
        topUrl: page.url(),
        state: await embedded.evaluate(() => ({
          active: document.activeElement.outerHTML,
          hints: [...document.querySelectorAll(".vimiumHintMarker")].map((el) => el.textContent),
        })),
      }));
    }
  });

  await check(
    "backup export/restore resets settings omitted because they were defaults",
    async () => {
      await options.bringToFront();
      const backup = await options.$eval("#download-backup", async (el) => {
        el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
        return await (await fetch(el.href)).text();
      });
      assert(
        !Object.hasOwn(JSON.parse(backup), "linkHintColor"),
        "Expected a default color in the backup",
      );
      await setOption("linkHintColor", "#336699");
      await save();
      const backupPath = await Deno.makeTempFile({ prefix: "brovim-backup-", suffix: ".json" });
      try {
        await Deno.writeTextFile(backupPath, backup);
        await options.bringToFront();
        await (await options.$("#upload-backup")).uploadFile(backupPath);
        await options.waitForFunction(() =>
          document.querySelector("[name=linkHintColor]").value === "#68039b"
        );
      } finally {
        await Deno.remove(backupPath);
      }
    },
  );

  await check(
    "denied clipboard access shows a message and leaves page navigation usable",
    async () => {
      await fresh();
      await browser.defaultBrowserContext().overridePermissions(origin, []);
      const originalUrl = page.url();
      await key(["p"]);
      const hud = page.frames().find((frame) => frame.url().includes("/pages/hud_page.html"));
      await hud.waitForFunction(() =>
        document.querySelector("#hud")?.textContent.includes("clipboard access was blocked")
      );
      assert(page.url() === originalUrl, "Denied paste navigated the page");
      await key(["j"]);
      await page.waitForFunction(() => scrollY > 0);
      // Exercise write rejection as well; user activation can otherwise allow writes despite a deny.
      await hud.evaluate(() => {
        Object.defineProperty(navigator, "clipboard", {
          configurable: true,
          value: {
            writeText: () =>
              Promise.reject(new DOMException("Write permission denied", "NotAllowedError")),
          },
        });
      });
      await key(["y", "y"]);
      await hud.waitForFunction(() =>
        document.querySelector("#hud")?.textContent.includes("Couldn't copy")
      );
    },
  );

  await check(
    "switcher includes awake tabs and excludes discarded sleeping tabs",
    async () => {
      await fresh();
      const unvisited = await worker.evaluate(
        (url) => chrome.tabs.create({ url, active: false }),
        `${origin}/unvisited?title=Unvisited`,
      );
      const sleeping = await browser.newPage();
      await sleeping.goto(`${origin}/sleeping?title=Sleeping`);
      const sleepingId = await tabId(sleeping);
      const awake = await browser.newPage();
      await awake.goto(`${origin}/awake?title=Awake`);
      await page.bringToFront();
      await pause(200);
      try {
        await worker.evaluate((id) => chrome.tabs.discard(id), sleepingId);
        await openSwitcher();
        const switcher = await ui("tab-switcher-frame");
        await switcher.waitForSelector(".tab-card.selected");
        const titles = await switcher.$$eval(
          ".card-label span",
          (els) => els.map((el) => el.textContent),
        );
        assert(titles[0] === "Brovim browser fixture", JSON.stringify(titles));
        assert(titles.includes("Awake"), "Visited awake tab was omitted");
        assert(titles.includes("Unvisited"), "Awake tab was omitted");
        assert(!titles.includes("Sleeping"), "Discarded sleeping tab was included");
        await page.setViewport({ width: 640, height: 700 });
        await switcher.waitForFunction(() => {
          const rect = document.querySelector("#tab-switcher").getBoundingClientRect();
          return rect.left >= 0 && rect.right <= innerWidth;
        });
        await key(["Escape"]);
      } finally {
        await page.setViewport({ width: 1280, height: 900 });
        // Discarding can replace a Chromium tab's ID and destroy its original CDP target.
        await worker.evaluate(async (urls) => {
          const tabs = await chrome.tabs.query({});
          const ids = tabs.filter((tab) => urls.includes(tab.url)).map((tab) => tab.id);
          if (ids.length) await chrome.tabs.remove(ids);
        }, [unvisited.url, `${origin}/sleeping?title=Sleeping`]);
        await awake.close();
      }
    },
  );

  await check(
    "extension replacement leaves invalidated tabs quiet and refreshed tabs work",
    async () => {
      await fresh();
      await key(["f"]);
      await page.waitForSelector(".vimiumHintMarker");
      // Removing/reinstalling the test extension reliably invalidates old contexts in automation.
      // runtime.reload() is not reliable for extensions loaded through CDP.
      await browser.uninstallExtension(new URL(workerTarget.url()).hostname);
      await pause(250);
      assert(!browser.targets().includes(workerTarget), "The old extension worker was not removed");
      await page.bringToFront();
      await key(["Escape", "j"]);
      await page.evaluate(() => location.hash = "after-extension-reload");
      await pause(200);
      await browser.installExtension(root);
      await browser.waitForTarget((target) =>
        target.type() === "service_worker" && target.url().endsWith("/background_scripts/main.js")
      );
      await page.reload();
      await pause(200);
      await key(["f"]);
      await page.waitForSelector(".vimiumHintMarker");
      await key(["Escape"]);
    },
  );

  await check("no uncaught errors in extension pages and web pages", () => {
    assert(errors.length === 0, errors.join("\n"));
  });
} finally {
  await browser?.close();
  await server.shutdown();
}

console.log(`Browser checks: ${passed} passed, ${failures.length} failed`);
if (failures.length) Deno.exit(1);
