import puppeteer from "puppeteer";
import { fileURLToPath } from "node:url";

const root = Deno.env.get("BROVIM_EXTENSION_PATH") ||
  fileURLToPath(new URL("../../", import.meta.url));
const failures = [];
const errors = [];
let passed = 0;
const testFilter = Deno.env.get("BROVIM_TEST_FILTER");

function assert(value, message) {
  if (!value) throw new Error(message);
}

async function check(name, fn) {
  if (testFilter && !name.includes(testFilter)) return;
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
  if (url.pathname === "/delayed-preview-image") {
    return new Promise((resolve) =>
      setTimeout(() =>
        resolve(
          new Response(
            '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="300"><rect width="600" height="300" fill="red"/></svg>',
            { headers: { "content-type": "image/svg+xml" } },
          ),
        ), 4000)
    );
  }
  if (url.pathname === "/slow-preview") {
    return new Response(
      '<!doctype html><title>Loading preview</title><h1>First paint</h1><img src="/delayed-preview-image" width="600" height="300"><a href="/">Home</a>',
      { headers: { "content-type": "text/html" } },
    );
  }
  if (url.pathname === "/scroll-recovery") {
    return new Response(
      `<!doctype html><title>Conversation scrolling fixture</title>
      <style>html,body{margin:0;height:100%;overflow:hidden}#layout{height:100%;display:flex}
      aside{width:160px}#pane{flex:1;overflow:auto;height:100%}.messages{height:5000px}
      #editor{position:fixed;bottom:10px;left:200px;background:white;border:1px solid;width:400px}</style>
      <div id="layout"><aside>Sidebar</aside><main id="pane"><div class="messages">Conversation</div></main></div>
      <div id="editor" contenteditable="true" role="textbox" aria-label="Message">Draft</div>`,
      {
        headers: { "content-type": "text/html" },
      },
    );
  }
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
  const navigate = async (url) => {
    try {
      await page.goto(url);
    } catch (error) {
      // Chromium can supersede the first navigation while finishing extension installation.
      if (!error.message.includes("net::ERR_ABORTED")) throw error;
      await page.goto(url);
    }
  };
  const fresh = async () => {
    await page.bringToFront();
    await navigate(`${origin}/`);
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
  const runCommand = async (command) => {
    await worker.evaluate(
      (id, command) =>
        chrome.scripting.executeScript({
          target: { tabId: id },
          func: (command) => normalMode.commandHandler({ command: { command, options: {} } }),
          args: [command],
        }),
      await tabId(),
      command,
    );
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
  const openBrowserSwitcher = async (targetPage = page) => {
    const id = typeof targetPage === "number" ? targetPage : await tabId(targetPage);
    await worker.evaluate(async (id) => openTabSwitcher(await chrome.tabs.get(id)), id);
  };
  const waitForPreview = (url, previous = null) =>
    worker.evaluate(async ({ url, previous }) => {
      for (let i = 0; i < 70; i++) {
        const preview = (await chrome.storage.local.get("tabThumbnails")).tabThumbnails?.[url];
        if (preview && preview !== previous) return preview;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error("No updated preview was saved");
    }, { url, previous });

  await fresh();
  await check(
    "initialization recovers from empty responses without crashing or losing controls",
    async () => {
      const previousErrors = errors.length;
      await worker.evaluate(() => {
        globalThis.originalInitializationHandler = sendRequestHandlers.initializeFrame;
        globalThis.initializationAttempts = 0;
        sendRequestHandlers.initializeFrame = (...args) => {
          initializationAttempts++;
          if (initializationAttempts === 1) return undefined;
          if (initializationAttempts === 2) return {};
          return originalInitializationHandler(...args);
        };
      });
      try {
        await navigate(`${origin}/initialization-empty-response`);
        await worker.evaluate(async () => {
          for (let i = 0; i < 60; i++) {
            if (initializationAttempts >= 3) return;
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
          throw new Error("Initialization did not retry the empty response");
        });
        await key(["f"]);
        await page.waitForSelector(".vimiumHintMarker");
        await key(["Escape"]);
        assert(errors.length === previousErrors, errors.slice(previousErrors).join("\n"));
      } finally {
        await worker.evaluate(() => {
          sendRequestHandlers.initializeFrame = globalThis.originalInitializationHandler;
          delete globalThis.originalInitializationHandler;
          delete globalThis.initializationAttempts;
        });
        await fresh();
      }
    },
  );

  await check(
    "initialization retries missing receivers and keeps excluded pages disabled",
    async () => {
      await fresh();
      const result = await worker.evaluate((id) =>
        chrome.scripting.executeScript({
          target: { tabId: id },
          func: async () => {
            const original = chrome.runtime.sendMessage.bind(chrome.runtime);
            let attempts = 0;
            chrome.runtime.sendMessage = (message, ...args) => {
              if (message.handler === "initializeFrame" && ++attempts < 3) {
                return Promise.reject(
                  new Error("Could not establish connection. Receiving end does not exist."),
                );
              }
              return original(message, ...args);
            };
            try {
              await checkIfEnabledForUrl();
              return attempts;
            } finally {
              chrome.runtime.sendMessage = original;
            }
          },
        }), await tabId());
      assert(result[0].result === 3, "Missing-receiver initialization did not recover");
      await key(["f"]);
      await page.waitForSelector(".vimiumHintMarker");
      await key(["Escape"]);
      const exclusions = await worker.evaluate(async () => {
        await Settings.onLoaded();
        return Settings.get("exclusionRules");
      });
      await worker.evaluate(async (rules) => await Settings.set("exclusionRules", rules), [
        ...exclusions,
        { pattern: `${origin}/initialization-excluded*`, passKeys: "" },
      ]);
      try {
        await page.goto(`${origin}/initialization-excluded`);
        await pause(200);
        await key(["f"]);
        assert((await hints()).length === 0, "An excluded page activated link hints");
      } finally {
        await worker.evaluate(
          async (rules) => await Settings.set("exclusionRules", rules),
          exclusions,
        );
        await fresh();
      }
    },
  );

  await check(
    "initialization applies the new route's exclusions after a delayed reply",
    async () => {
      const exclusions = await worker.evaluate(() => Settings.get("exclusionRules"));
      try {
        for (const passKeys of ["", "f"]) {
          await fresh();
          await worker.evaluate(async ({ rules, pattern, passKeys }) => {
            await Settings.set("exclusionRules", [...rules, { pattern, passKeys }]);
            globalThis.delayedInitializationHandler = sendRequestHandlers.initializeFrame;
            globalThis.delayedInitializationStarted = false;
            sendRequestHandlers.initializeFrame = async (...args) => {
              const response = await delayedInitializationHandler(...args);
              if (!delayedInitializationStarted) {
                delayedInitializationStarted = true;
                await new Promise((resolve) => globalThis.releaseDelayedInitialization = resolve);
              }
              return response;
            };
          }, { rules: exclusions, pattern: `${origin}/*#initialization-excluded`, passKeys });
          const id = await tabId();
          await worker.evaluate((id) =>
            chrome.scripting.executeScript({
              target: { tabId: id },
              func: () => {
                globalThis.delayedFrameCheck = checkIfEnabledForUrl();
              },
            }), id);
          await worker.evaluate(async () => {
            for (let i = 0; i < 50; i++) {
              if (delayedInitializationStarted) return;
              await new Promise((resolve) => setTimeout(resolve, 20));
            }
            throw new Error("Delayed initialization never started");
          });
          await page.evaluate(() => location.hash = "initialization-excluded");
          await pause(100);
          await worker.evaluate(() => releaseDelayedInitialization());
          await worker.evaluate((id) =>
            chrome.scripting.executeScript({
              target: { tabId: id },
              func: async () => await globalThis.delayedFrameCheck,
            }), id);
          await key(["f"]);
          assert(
            (await hints()).length === 0,
            "The previous URL's response overrode the new exclusions",
          );
          await key(["j"]);
          assert(
            (await page.evaluate(() => scrollY > 0)) === (passKeys === "f"),
            "The new route's pass keys were not applied",
          );
          await worker.evaluate(() => {
            sendRequestHandlers.initializeFrame = globalThis.delayedInitializationHandler;
            delete globalThis.delayedInitializationHandler;
          });
        }
      } finally {
        await worker.evaluate(async (rules) => {
          globalThis.releaseDelayedInitialization?.();
          if (globalThis.delayedInitializationHandler) {
            sendRequestHandlers.initializeFrame = delayedInitializationHandler;
          }
          delete globalThis.delayedInitializationHandler;
          delete globalThis.releaseDelayedInitialization;
          delete globalThis.delayedInitializationStarted;
          await Settings.set("exclusionRules", rules);
        }, exclusions);
        await fresh();
      }
    },
  );

  await check(
    "late frame messages after navigation do not leave missing-receiver rejections",
    async () => {
      const other = await browser.newPage();
      try {
        await other.goto(`${origin}/late-frame-message`);
        const id = await tabId(other);
        await other.goto("chrome://version/");
        const previousErrors = errors.length;
        await worker.evaluate(async (id) => {
          sendRequestHandlers.sendMessageToFrames({
            message: { handler: "focusFrame", forceFocusThisFrame: true },
          }, { tab: { id } });
          HintCoordinator.broadcastLinkHintsMessage({ messageType: "exit" }, { tab: { id } });
          BackgroundCommands.toggleMuteTab({
            tab: await chrome.tabs.get(id),
            tabId: id,
            registryEntry: { options: {} },
          }, { frameId: 0 });
          await new Promise((resolve) => setTimeout(resolve, 150));
        }, id);
        assert(errors.length === previousErrors, errors.slice(previousErrors).join("\n"));
      } finally {
        await other.close();
        await page.bringToFront();
      }
    },
  );

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

  await check(
    "custom CSS overrides hint colors even when the base stylesheet arrives last",
    async () => {
      await setOption("userDefinedLinkHintCss", "div > .vimiumHintMarker { background: #123456; }");
      await save();
      await fresh();
      // Reproduce the navigation race deterministically: inject the base CSS after the user CSS.
      await worker.evaluate(
        (id) =>
          chrome.scripting.insertCSS({
            target: { tabId: id },
            files: ["content_scripts/vimium.css"],
          }),
        await tabId(),
      );
      await key(["f"]);
      await page.waitForSelector(".vimiumHintMarker");
      assert((await hints())[0].box === "rgb(18, 52, 86)", JSON.stringify((await hints())[0]));
      await key(["Escape"]);
      await setOption("userDefinedLinkHintCss", "");
      await save();
    },
  );

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

  for (const change of ["replaced", "no longer scrollable"]) {
    await check(`scrolling recovers when the active conversation pane is ${change}`, async () => {
      await navigate(`${origin}/scroll-recovery`);
      await pause(150);
      await key(["j"]);
      await page.waitForFunction(() => document.querySelector("#pane").scrollTop > 0);
      await page.evaluate((change) => {
        const pane = document.querySelector("#pane");
        const replacement = pane.cloneNode(true);
        if (change === "replaced") pane.replaceWith(replacement);
        else {
          pane.id = "old-pane";
          pane.style.cssText = "position:absolute;width:1px;height:1px;overflow:hidden";
          pane.after(replacement);
        }
      }, change);
      await key(["j"]);
      await page.waitForFunction(() => document.querySelector("#pane").scrollTop > 0);
      await key(["d"]);
      await page.waitForFunction(() => document.querySelector("#pane").scrollTop > 300);
      await key(["u"]);
      await page.waitForFunction(() => document.querySelector("#pane").scrollTop < 150);
      await key(["G"]);
      await page.waitForFunction(() => document.querySelector("#pane").scrollTop > 3500);
      await key(["g", "g"]);
      await page.waitForFunction(() => document.querySelector("#pane").scrollTop === 0);
      await fresh();
    });
  }

  for (const layout of ["display:contents", "zero-height wrapper"]) {
    await check(`scrolling discovers the conversation through a ${layout}`, async () => {
      await navigate(`${origin}/scroll-recovery`);
      await pause(150);
      await page.evaluate((layout) => {
        const pane = document.querySelector("#pane");
        const wrapper = document.createElement("div");
        wrapper.style.cssText = layout === "display:contents"
          ? "display:contents"
          : "height:0;width:0";
        pane.replaceWith(wrapper);
        wrapper.append(pane);
        if (layout !== "display:contents") {
          pane.style.cssText = "position:fixed;left:160px;right:0;top:0;bottom:0";
        }
        const button = document.createElement("button");
        button.id = "conversation-button";
        button.textContent = "Conversation action";
        pane.firstElementChild.prepend(button);
      }, layout);
      await key(["f"]);
      await page.waitForSelector(".vimiumHintMarker");
      await key(["Escape", "j"]);
      const beforeClick = await page.$eval("#pane", (pane) => pane.scrollTop);
      if (!beforeClick) {
        await page.click("#conversation-button");
        await key(["j"]);
        const afterClick = await page.$eval("#pane", (pane) => pane.scrollTop);
        throw new Error(
          `Keyboard labels worked but scrolling needed a click: before=${beforeClick}, after=${afterClick}`,
        );
      }
      await key(["d"]);
      await page.waitForFunction(() => document.querySelector("#pane").scrollTop > 300);
      await key(["u"]);
      await page.waitForFunction(() => document.querySelector("#pane").scrollTop < 150);
      await fresh();
    });
  }

  await check("scrolling discovers an open shadow-root pane without clicking it", async () => {
    await navigate(`${origin}/scroll-recovery`);
    await pause(150);
    await page.evaluate(() => {
      const pane = document.querySelector("#pane");
      const host = document.createElement("div");
      host.id = "pane-host";
      host.style.cssText = "height:100%;flex:1";
      pane.replaceWith(host);
      const root = host.attachShadow({ mode: "open" });
      const style = document.createElement("style");
      style.textContent = "main{height:100%;overflow:auto}.messages{height:5000px}";
      root.append(style, pane);
    });
    await key(["j"]);
    await page.waitForFunction(() =>
      document.querySelector("#pane-host").shadowRoot.querySelector("main").scrollTop > 0
    );
    await key(["d"]);
    await page.waitForFunction(() =>
      document.querySelector("#pane-host").shadowRoot.querySelector("main").scrollTop > 300
    );
    await fresh();
  });

  await check(
    "focus recovery leaves refocusing editors and resumes conversation scrolling",
    async () => {
      await navigate(`${origin}/scroll-recovery`);
      await pause(150);
      await page.evaluate(() => {
        const editor = document.querySelector("#editor");
        editor.addEventListener("blur", () => editor.focus());
        editor.focus();
      });
      await page.keyboard.type("j");
      assert(
        await page.$eval("#editor", (el) => el.textContent.includes("j")),
        "Editor typing was intercepted",
      );
      assert(
        await page.$eval("#pane", (el) => el.scrollTop === 0),
        "Typing scrolled the conversation",
      );
      const command = await worker.evaluate(async () =>
        (await chrome.commands.getAll()).find((command) => command.name === "focus_page")
      );
      assert(command?.shortcut === "Alt+Z", "The default browser recovery shortcut is missing");
      const id = await tabId();
      await worker.evaluate(async (id) => focusPage(await chrome.tabs.get(id)), id);
      await page.waitForFunction(() => document.activeElement === document.documentElement);
      assert(
        await page.evaluate(() => document.documentElement.tabIndex === -1),
        "Recovery entered the page's tab order",
      );
      await key(["d"]);
      await page.waitForFunction(() => document.querySelector("#pane").scrollTop > 300);
      await fresh();
    },
  );

  await check(
    "Escape leaves a refocusing composer and restores scrolling without another shortcut",
    async () => {
      await navigate(`${origin}/scroll-recovery`);
      await pause(150);
      await page.evaluate(() => {
        const editor = document.querySelector("#editor");
        editor.addEventListener("blur", () => editor.focus());
        editor.focus();
      });
      await key(["Escape"]);
      await page.waitForFunction(() => !document.activeElement.isContentEditable);
      await key(["j"]);
      await page.waitForFunction(() => document.querySelector("#pane").scrollTop > 0);
      await key(["d"]);
      await page.waitForFunction(() => document.querySelector("#pane").scrollTop > 300);
      await page.focus("#editor");
      await page.waitForFunction(() => !document.documentElement.hasAttribute("tabindex"));
      await fresh();
    },
  );

  await check("focus recovery exits global insert mode and closes the Vomnibar", async () => {
    await fresh();
    const id = await tabId();
    await key(["i"]);
    await worker.evaluate(async (id) => focusPage(await chrome.tabs.get(id)), id);
    await key(["j"]);
    await page.waitForFunction(() => scrollY > 0);
    await key(["o"]);
    await ui("vomnibar-frame");
    await worker.evaluate(async (id) => focusPage(await chrome.tabs.get(id)), id);
    await noUi("vomnibar-frame");
    await key(["d"]);
    await page.waitForFunction(() => scrollY > 300);
    await fresh();
  });

  await check("settings navigation, live color preview and save status work together", async () => {
    await options.setViewport({ width: 1440, height: 1000 });
    await options.bringToFront();
    await options.click('.settings-nav a[href="#appearance"]');
    await options.waitForSelector('.settings-nav a[href="#appearance"][aria-current="location"]');
    await setOption("linkHintColor", "#146e32");
    const preview = await options.$eval(
      ".preview-badge",
      (el) => getComputedStyle(el).backgroundColor,
    );
    assert(preview === "rgb(20, 110, 50)", `Live preview did not update: ${preview}`);
    assert(
      await options.$eval("#save-status", (el) => el.textContent) === "Unsaved changes",
      "Unsaved state was not announced",
    );
    assert(
      await worker.evaluate(() => Settings.get("linkHintColor")) === "#68039b",
      "Preview saved a setting before Save was pressed",
    );
    await options.click('[data-reset="linkHintColor"]');
    assert(
      await options.$eval(".preview-badge", (el) => getComputedStyle(el).backgroundColor) ===
        "rgb(104, 3, 155)",
      "Reset did not update the preview",
    );
    await save();
    assert(
      await options.$eval("#save-status", (el) => el.textContent) === "All changes saved",
      "Saved state was not announced",
    );
    await options.bringToFront();
    await options.click('.settings-nav a[href="#keyboard"]');
    assert(
      await options.$eval("#tab-switcher-shortcut", (el) => el.textContent) === "Alt+Q",
      "Browser shortcut assignment was not shown",
    );
    await options.click("#manage-shortcuts");
    const target = await browser.waitForTarget((target) =>
      target.url() === "chrome://extensions/shortcuts"
    );
    await (await target.page()).close();
    await page.bringToFront();
  });

  await check("settings stay within the viewport at desktop, tablet and phone widths", async () => {
    try {
      for (const width of [1440, 900, 390]) {
        await options.setViewport({ width, height: 900 });
        await options.bringToFront();
        await options.click('.settings-nav a[href="#backup"]');
        await pause(100);
        const size = await options.evaluate(() => ({
          width: innerWidth,
          page: document.documentElement.scrollWidth,
          footerBottom: document.querySelector("footer").getBoundingClientRect().bottom,
          height: innerHeight,
          cardBottom:
            document.querySelector("#backup .settings-card").getBoundingClientRect().bottom,
          footerTop: document.querySelector("footer").getBoundingClientRect().top,
        }));
        assert(size.page <= size.width, `Settings overflow at ${width}px: ${JSON.stringify(size)}`);
        assert(size.footerBottom <= size.height + 1, "Save action escaped the viewport");
        assert(size.cardBottom <= size.footerTop, "The save bar covers the last settings");
      }
    } finally {
      await options.setViewport({ width: 1280, height: 900 });
      await page.bringToFront();
    }
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

  await check("Escape cancels hints even before collection finishes", async () => {
    await fresh();
    await worker.evaluate(() => {
      globalThis.hintCollectionComplete = false;
      globalThis.originalPrepareHints = HintCoordinator.prepareToActivateLinkHintsMode;
      HintCoordinator.prepareToActivateLinkHintsMode = async function (...args) {
        try {
          return await globalThis.originalPrepareHints.apply(this, args);
        } finally {
          globalThis.hintCollectionComplete = true;
        }
      };
    });
    try {
      await workerSession.send("Debugger.enable");
      await workerSession.send("Debugger.pause");
      try {
        await key(["f", "Escape"]);
      } finally {
        await workerSession.send("Debugger.resume");
        await workerSession.send("Debugger.disable");
      }
      await worker.evaluate(async () => {
        const deadline = Date.now() + 3000;
        while (!globalThis.hintCollectionComplete && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        if (!globalThis.hintCollectionComplete) throw new Error("Hint collection did not finish");
      });
      assert((await hints()).length === 0, "Cancelled hints appeared after collection finished");
      assert(page.url() === `${origin}/`, "Escape activated a link");
      await key(["j"]);
      assert(await page.evaluate(() => scrollY) > 0, "Escape left the keyboard blocked");
    } finally {
      await worker.evaluate(() => {
        HintCoordinator.prepareToActivateLinkHintsMode = globalThis.originalPrepareHints;
        delete globalThis.originalPrepareHints;
        delete globalThis.hintCollectionComplete;
      });
    }
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

  await check("Vomnibar fits narrow screens and O opens the entered URL in a new tab", async () => {
    await fresh();
    await page.evaluate(() => {
      document.body.style.background = "#18181b";
      document.body.style.color = "#dedee4";
    });
    try {
      for (const width of [1280, 375]) {
        await page.setViewport({ width, height: 900 });
        await key(["o"]);
        const frame = await ui("vomnibar-frame");
        const bounds = await frame.$eval("#vomnibar", (el) => {
          const rect = el.getBoundingClientRect();
          return { left: rect.left, right: rect.right, width: innerWidth };
        });
        assert(bounds.left >= 0 && bounds.right <= bounds.width, JSON.stringify(bounds));
        await page.screenshot({ path: `/tmp/brovim-vomnibar-${width}.png` });
        await key(["Escape"]);
      }
      await key(["O"]);
      const frame = await ui("vomnibar-frame");
      await frame.type("input", `${origin}/opened-with-O`);
      await key(["Enter"]);
      const opened = await browser.waitForTarget((t) => t.url() === `${origin}/opened-with-O`);
      assert(page.url() === `${origin}/`, "O replaced the current tab");
      await (await opened.page()).close();
    } finally {
      await page.setViewport({ width: 1280, height: 900 });
      await page.bringToFront();
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
    await help.waitForSelector(".help-description");
    assert(await help.$("#toggle-advanced") === null, "Help still has a show/hide toggle");
    const rows = await help.$$eval(".row", (rows) =>
      rows.map((row) => ({
        text: row.textContent,
        shown: getComputedStyle(row).display !== "none",
      })));
    assert(rows.every((row) => row.shown), "Some commands are hidden by default");
    assert(rows.some((row) => row.text.includes("Zoom in")), "Missing zoom command");
    for (
      const text of [
        "Create new tab",
        "Go one tab left",
        "Go one tab right",
        "Go to previously-visited tab",
        "View page source",
      ]
    ) {
      assert(
        !rows.some((row) => row.text.includes(text)),
        `Purged command is still shown: ${text}`,
      );
    }
    await page.screenshot({ path: "/tmp/brovim-help-all-commands.png" });
    assert(await help.$("footer") === null, "Removed help banner is still present");
    assert(
      !(await help.$$eval(
        "a",
        (links) => links.some((link) => link.textContent.trim() === "Wiki"),
      )),
      "Removed Wiki link is still present",
    );
    await key(["Escape"]);
    await noUi("vimium-help-dialog-frame");
  });

  await check(
    "T does not open switcher, arrows/h/l move, and only Esc dismisses",
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
      assert(await switcher.$("#panel.ready"), "Outside click dismissed keyboard-only switcher");
      await key(["Escape"]);
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

  await check("F opens a background link and the queue command opens multiple links", async () => {
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
    await runCommand("LinkHints.activateModeWithQueue");
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

  await check("yy and the link-copy command copy URLs; clipboard commands open them", async () => {
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
    await runCommand("LinkHints.activateModeToCopyLinkUrl");
    await page.waitForSelector(".vimiumHintMarker");
    await key([...(await hints())[2].text.toLowerCase()]);
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    assert(copied.includes("/target?link="), `Link-copy command copied ${copied}`);
    await runCommand("openCopiedUrlInCurrentTab");
    await page.waitForFunction((url) => location.href === url, {}, copied);
    await runCommand("openCopiedUrlInNewTab");
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

  await check("x/X close and restore a tab", async () => {
    await fresh();
    const created = await browser.newPage();
    await created.goto(`${origin}/new-tab`);
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

  await check("removed keys pass through; tab reordering, pin and mute still work", async () => {
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
    const tabsBefore = await worker.evaluate(async () => (await chrome.tabs.query({})).length);
    await page.evaluate(() => {
      globalThis.passedKeys = [];
      document.addEventListener("keydown", (event) => globalThis.passedKeys.push(event.key));
    });
    for (const binding of [["t"], ["J"], ["K"], ["g", "t"], ["g", "T"], ["^"]]) {
      await key(binding);
      assert(await activeId() === id, `${binding} still switches tabs`);
    }
    assert(
      await worker.evaluate(async () => (await chrome.tabs.query({})).length) === tabsBefore,
      "Removed t command created a tab",
    );
    const passed = await page.evaluate(() => globalThis.passedKeys);
    assert(
      ["t", "J", "K", "^"].every((key) => passed.includes(key)),
      `Removed keys were still captured: ${JSON.stringify(passed)}`,
    );
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
    const title = await switcher.$eval(".selected .card-title", (el) => el.textContent);
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
    // Exercise early release in the content script. test-native covers actual accelerator delivery.
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

  await check("Ctrl+Q uses the assigned modifier and commits on Control release", async () => {
    await fresh();
    const peers = [];
    await worker.evaluate(() => {
      globalThis.originalCommandsGetAll = chrome.commands.getAll;
      chrome.commands.getAll = () =>
        Promise.resolve([{ name: "open_tab_switcher", shortcut: "Ctrl+Q" }]);
    });
    try {
      for (let i = 0; i < 3; i++) {
        const peer = await browser.newPage();
        peers.push(peer);
        await peer.goto(`${origin}/ctrl-${i}?title=Ctrl${i}`);
      }
      await page.bringToFront();
      await page.keyboard.down("Control");
      await openBrowserSwitcher();
      const frame = await ui("tab-switcher-frame");
      await frame.waitForSelector(".selected");
      assert(
        await frame.$eval(".selected .card-title", (el) => el.textContent) === "Ctrl2",
        "Wrong initial recent",
      );
      await page.keyboard.press("q");
      await frame.waitForFunction(() =>
        document.querySelector(".selected .card-title").textContent === "Ctrl1"
      );
      await page.keyboard.down("Shift");
      await page.keyboard.up("Shift");
      assert(await frame.$("#panel.ready"), "Shift release committed Ctrl+Q");
      await page.keyboard.up("Control");
      await noUi("tab-switcher-frame");
      assert(
        await worker.evaluate(async () =>
          (await chrome.tabs.query({ active: true, currentWindow: true }))[0].title
        ) === "Ctrl1",
        "Control release did not commit",
      );
    } finally {
      await page.keyboard.up("Shift");
      await page.keyboard.up("Control");
      await worker.evaluate(() => chrome.commands.getAll = globalThis.originalCommandsGetAll);
      for (const peer of peers) if (!peer.isClosed()) await peer.close();
      await page.bringToFront();
    }
  });

  await check("Ctrl+Shift+E cycles forward and Shift release does not commit", async () => {
    await fresh();
    const peers = [];
    await worker.evaluate(() => {
      globalThis.originalCommandsGetAll = chrome.commands.getAll;
      chrome.commands.getAll = () =>
        Promise.resolve([{ name: "open_tab_switcher", shortcut: "Ctrl+Shift+E" }]);
    });
    try {
      for (let i = 0; i < 3; i++) {
        const peer = await browser.newPage();
        peers.push(peer);
        await peer.goto(`${origin}/ctrl-${i}?title=Ctrl${i}`);
      }
      await page.bringToFront();
      await page.keyboard.down("Control");
      await page.keyboard.down("Shift");
      await openBrowserSwitcher();
      const frame = await ui("tab-switcher-frame");
      await frame.waitForSelector(".selected");
      assert(
        await frame.$eval(".selected .card-title", (el) => el.textContent) === "Ctrl2",
        "Wrong initial recent",
      );
      await page.keyboard.press("e");
      await frame.waitForFunction(() =>
        document.querySelector(".selected .card-title").textContent === "Ctrl1"
      );
      await page.keyboard.down("Shift");
      await page.keyboard.up("Shift");
      assert(await frame.$("#panel.ready"), "Shift release committed Ctrl+Q");
      await page.keyboard.up("Control");
      await noUi("tab-switcher-frame");
      assert(
        await worker.evaluate(async () =>
          (await chrome.tabs.query({ active: true, currentWindow: true }))[0].title
        ) === "Ctrl1",
        "Control release did not commit",
      );
    } finally {
      await page.keyboard.up("Shift");
      await page.keyboard.up("Control");
      await worker.evaluate(() => chrome.commands.getAll = globalThis.originalCommandsGetAll);
      for (const peer of peers) if (!peer.isClosed()) await peer.close();
      await page.bringToFront();
    }
  });

  await check("Ctrl+Q continues the original recents after a protected-page hop", async () => {
    await fresh();
    const peers = [];
    await worker.evaluate(() => {
      globalThis.originalCommandsGetAll = chrome.commands.getAll;
      chrome.commands.getAll = () =>
        Promise.resolve([{ name: "open_tab_switcher", shortcut: "Ctrl+Q" }]);
    });
    try {
      for (let i = 0; i < 3; i++) {
        const peer = await browser.newPage();
        peers.push(peer);
        await peer.goto(`${origin}/hop-${i}?title=Hop${i}`);
      }
      await options.bringToFront();
      await options.keyboard.down("Control");
      await openBrowserSwitcher(options);
      assert(
        await worker.evaluate(async () =>
          (await chrome.tabs.query({ active: true, currentWindow: true }))[0].title
        ) === "Hop2",
        "Protected fallback chose the wrong tab",
      );
      await openBrowserSwitcher(peers[2]);
      const iframe = await peers[2].waitForSelector(
        ":root >>> iframe.tab-switcher-frame.vimium-ui-component-visible",
      );
      const frame = await iframe.contentFrame();
      await frame.waitForSelector(".selected");
      assert(
        await frame.$eval(".selected .card-title", (el) => el.textContent) === "Hop1",
        "Fallback rebuilt MRU and bounced to the source",
      );
      await openBrowserSwitcher(peers[2]);
      await frame.waitForFunction(() =>
        document.querySelector(".selected .card-title").textContent === "Hop0"
      );
      await peers[2].keyboard.up("Control");
      await frame.waitForFunction(() => !document.querySelector("#panel.ready"));
      assert(
        await worker.evaluate(async () =>
          (await chrome.tabs.query({ active: true, currentWindow: true }))[0].title
        ) === "Hop0",
        "Did not commit the final recent",
      );
    } finally {
      await options.keyboard.up("Control");
      await worker.evaluate(() => chrome.commands.getAll = globalThis.originalCommandsGetAll);
      for (const peer of peers) if (!peer.isClosed()) await peer.close();
      await page.bringToFront();
    }
  });

  await check(
    "holding Alt keeps one grid through rapid cycles and commits the final selection",
    async () => {
      await fresh();
      const peers = [];
      try {
        for (let i = 0; i < 5; i++) {
          const peer = await browser.newPage();
          peers.push(peer);
          await peer.goto(`${origin}/rapid-cycle-${i}?title=Cycle%20${i}`);
        }
        await page.bringToFront();
        await page.keyboard.down("Alt");
        await openBrowserSwitcher();
        const frame = await ui("tab-switcher-frame");
        await frame.waitForSelector(".selected");
        const count = await frame.$$eval(".tab-card", (cards) => cards.length);
        await frame.evaluate(() => {
          globalThis.originalCards = [...document.querySelectorAll(".tab-card")];
          globalThis.selectionChanges = 0;
          globalThis.cardRebuilds = 0;
          globalThis.cycleObserver = new MutationObserver((records) => {
            for (const record of records) {
              if (record.type === "attributes") globalThis.selectionChanges++;
              if (record.target.id === "tab-switcher") globalThis.cardRebuilds++;
            }
          });
          globalThis.cycleObserver.observe(document.querySelector("#tab-switcher"), {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ["class"],
          });
        });
        const id = await tabId();
        const cycleStart = performance.now();
        await worker.evaluate(async (id) => {
          const tab = await chrome.tabs.get(id);
          await Promise.all(Array.from({ length: 19 }, () => openTabSwitcher(tab)));
        }, id);
        console.log(`19 queued cycles: ${Math.round(performance.now() - cycleStart)} ms`);
        await frame.waitForFunction(
          (expected) =>
            [...document.querySelectorAll(".tab-card")].findIndex((card) =>
              card.classList.contains("selected")
            ) === expected,
          {},
          20 % count,
        );
        const state = await frame.evaluate(() => ({
          sameCards: [...document.querySelectorAll(".tab-card")].every((card, i) =>
            card === globalThis.originalCards[i]
          ),
          changes: globalThis.selectionChanges,
          rebuilds: globalThis.cardRebuilds,
          selected: document.querySelector(".selected .card-title").textContent,
        }));
        assert(state.sameCards && state.rebuilds === 0, "Cycling rebuilt the preview grid");
        assert(state.changes === 38, `Expected two changed cards per move, got ${state.changes}`);
        assert(
          await worker.evaluate(async (id) => (await chrome.tabs.get(id)).active, id),
          "Switched before Alt was released",
        );
        // Resizing must preserve decoded previews too.
        await page.setViewport({ width: 900, height: 700 });
        await frame.waitForFunction(() => innerWidth === 900);
        assert(
          await frame.evaluate(() =>
            [...document.querySelectorAll(".tab-card")].every((card, i) =>
              card === globalThis.originalCards[i]
            )
          ),
          "Resize recreated previews",
        );
        await page.screenshot({ path: "/tmp/brovim-smooth-cycle.png" });
        await page.keyboard.up("Alt");
        await noUi("tab-switcher-frame");
        await pause(100);
        const active = await worker.evaluate(async () =>
          (await chrome.tabs.query({ active: true, currentWindow: true }))[0]
        );
        assert(
          active.title === state.selected,
          "Alt release did not commit the final highlighted tab",
        );
      } finally {
        await page.keyboard.up("Alt");
        await page.setViewport({ width: 1280, height: 900 });
        for (const peer of peers) if (!peer.isClosed()) await peer.close();
        await page.bringToFront();
      }
    },
  );

  await check("delayed repeat replies cannot switch tabs while the grid is open", async () => {
    await fresh();
    const peers = [];
    try {
      for (let i = 0; i < 5; i++) {
        const peer = await browser.newPage();
        peers.push(peer);
        await peer.goto(`${origin}/delayed-repeat-${i}`);
      }
      await page.bringToFront();
      const sourceId = await tabId();
      await page.keyboard.down("Alt");
      await openBrowserSwitcher();
      const frame = await ui("tab-switcher-frame");
      await frame.waitForSelector("#panel.ready .selected");
      const ids = await frame.$$eval(".tab-card", (cards) => cards.map((card) => card.dataset.id));
      await worker.evaluate(() => {
        globalThis.repeatActivations = [];
        globalThis.repeatActivationListener = (event) => repeatActivations.push(event.tabId);
        chrome.tabs.onActivated.addListener(repeatActivationListener);
        globalThis.repeatOriginalSendMessage = chrome.tabs.sendMessage;
        chrome.tabs.sendMessage = (...args) => {
          const response = repeatOriginalSendMessage(...args);
          return args[1]?.handler === "openTabSwitcher"
            ? response.then((value) =>
              new Promise((resolve) => setTimeout(() => resolve(value), 600))
            )
            : response;
        };
      });
      await worker.evaluate(async (id) => {
        const tab = await chrome.tabs.get(id);
        await Promise.all(Array.from({ length: 4 }, () => openTabSwitcher(tab)));
      }, sourceId);
      assert(
        await worker.evaluate(async (id) => (await chrome.tabs.get(id)).active, sourceId),
        "A delayed repeat activated a tab before Alt release",
      );
      await frame.waitForFunction(
        (id) => document.querySelector(".selected")?.dataset.id === id,
        {},
        ids[5],
      );
      assert(
        await worker.evaluate(() => repeatActivations.length === 0),
        "A delayed repeat briefly switched to another tab",
      );
      assert(await frame.$("#panel.ready"), "A delayed repeat cancelled the grid");
      await worker.evaluate(async (id) => {
        const tab = await chrome.tabs.get(id);
        globalThis.pendingRepeatCommands = Promise.all(
          Array.from({ length: 4 }, () => openTabSwitcher(tab)),
        );
      }, sourceId);
      await key(["Escape"]);
      await worker.evaluate(() => pendingRepeatCommands);
      await noUi("tab-switcher-frame");
      assert(
        await worker.evaluate(() => repeatActivations.length === 0),
        "Queued repeats switched after Escape cancelled the gesture",
      );
    } finally {
      await worker.evaluate(() => {
        if (globalThis.repeatOriginalSendMessage) {
          chrome.tabs.sendMessage = repeatOriginalSendMessage;
        }
        if (globalThis.repeatActivationListener) {
          chrome.tabs.onActivated.removeListener(repeatActivationListener);
        }
      });
      await page.keyboard.up("Alt");
      for (const peer of peers) if (!peer.isClosed()) await peer.close();
      await page.bringToFront();
    }
  });

  await check("a loading page gets an early thumbnail and a settled refresh", async () => {
    await page.bringToFront();
    const url = `${origin}/slow-preview`;
    const started = performance.now();
    await page.goto(url, { waitUntil: "domcontentloaded" });
    const early = await waitForPreview(url);
    assert(
      await page.evaluate(() => document.readyState) !== "complete",
      "The first preview waited for all resources to load",
    );
    console.log(`First-paint thumbnail saved: ${Math.round(performance.now() - started)} ms`);
    await page.waitForFunction(() => document.readyState === "complete");
    await waitForPreview(url, early);
  });

  await check("returning to a recently captured tab refreshes its thumbnail", async () => {
    await page.bringToFront();
    const url = `${origin}/repeat-preview`;
    await page.goto(url);
    const previous = await waitForPreview(url);
    const peer = await browser.newPage();
    try {
      await peer.goto(`${origin}/repeat-preview-peer`);
      await page.evaluate(() => {
        document.body.style.background = "rgb(24, 180, 100)";
        document.querySelector("main").textContent = "Updated since the previous visit";
      });
      const started = performance.now();
      await page.bringToFront();
      await waitForPreview(url, previous);
      console.log(
        `Repeat-visit thumbnail refreshed: ${Math.round(performance.now() - started)} ms`,
      );
    } finally {
      await peer.close();
      await page.bringToFront();
    }
  });

  await check("first opening paints cached thumbnails without a second image request", async () => {
    const url = `${origin}/first-cached-preview`;
    await page.bringToFront();
    await page.goto(url);
    const id = await tabId();
    await worker.evaluate(async ({ id, url }) => {
      for (let i = 0; i < 60; i++) {
        if ((await chrome.storage.local.get("tabThumbnails")).tabThumbnails?.[url]) return;
        await sendRequestHandlers.captureTabThumbnail({ tab: await chrome.tabs.get(id), url });
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
      throw new Error("The fixture preview was not captured");
    }, { id, url });
    await worker.evaluate(() => {
      globalThis.originalFirstDrawScreenshots = sendRequestHandlers.getTabScreenshots;
      sendRequestHandlers.getTabScreenshots = () => new Promise(() => {});
    });
    try {
      const started = performance.now();
      await openSwitcher();
      const frame = await ui("tab-switcher-frame");
      await frame.waitForSelector(`#panel.ready .tab-card[data-id="${id}"] .card-thumb img`);
      await frame.waitForFunction(
        (id) => {
          const img = document.querySelector(`.tab-card[data-id="${id}"] img`);
          return img?.complete && img.naturalWidth > 0;
        },
        {},
        id,
      );
      console.log(
        `First opening with cached images: ${Math.round(performance.now() - started)} ms`,
      );
      await key(["h", "l", "Escape"]);
      const samples = [];
      for (let i = 0; i < 10; i++) {
        const opened = performance.now();
        await openSwitcher();
        await frame.waitForSelector("#panel.ready .tab-card.selected");
        samples.push(performance.now() - opened);
        await page.keyboard.press("Escape");
        await noUi("tab-switcher-frame");
      }
      samples.sort((a, b) => a - b);
      console.log(
        `Cached grid opening (10 runs): median ${Math.round(samples[5])} ms, max ${
          Math.round(samples[9])
        } ms`,
      );
      assert(samples[9] < 1000, "Opening waited for the blocked thumbnail request");
    } finally {
      await worker.evaluate(() => {
        sendRequestHandlers.getTabScreenshots = globalThis.originalFirstDrawScreenshots;
        delete globalThis.originalFirstDrawScreenshots;
      });
      await key(["Escape"]);
    }
  });

  await check(
    "previews are captured once a page settles, keyed by URL, never with the switcher showing",
    async () => {
      const preview = (url) =>
        worker.evaluate(async (url) => {
          for (let i = 0; i < 60; i++) {
            const stored = (await chrome.storage.local.get("tabThumbnails")).tabThumbnails?.[url];
            if (stored) return stored;
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
          return null;
        }, url);
      await page.goto(`${origin}/settles`);
      const settled = await preview(`${origin}/settles`);
      assert(settled?.startsWith("data:image/jpeg;base64,"), "The settled page was not captured");
      const width = await page.evaluate(
        async (url) => (await createImageBitmap(await (await fetch(url)).blob())).width,
        settled,
      );
      assert(width <= 480, `Preview is ${width}px wide`);
      // A single-page app changing its URL is captured, but only once the switcher has closed.
      await openSwitcher();
      const switcher = await ui("tab-switcher-frame");
      await switcher.waitForSelector("#panel.ready");
      await page.evaluate(() => history.pushState({}, "", "/moved-while-open"));
      await pause(1600);
      const moved = `${origin}/moved-while-open`;
      assert(
        await worker.evaluate(
          async (url) => (await chrome.storage.local.get("tabThumbnails")).tabThumbnails?.[url],
          moved,
        ) == null,
        "Captured the page while the switcher was showing",
      );
      await key(["Escape"]);
      assert(await preview(moved), "The new URL was not captured after the switcher closed");
    },
  );

  await check("a navigated tab never keeps the previous page's thumbnail", async () => {
    await fresh();
    const other = await browser.newPage();
    const oldUrl = `${origin}/preview-old?title=Old%20page`;
    const newUrl = `${origin}/preview-new?title=New%20page`;
    await other.goto(oldUrl);
    await page.bringToFront();
    const id = await tabId(other);
    // Simulate a cached preview and then a cache miss at the background storage boundary.
    await worker.evaluate((oldUrl) => {
      globalThis.savedPreviewHandler = sendRequestHandlers.getTabScreenshots;
      sendRequestHandlers.getTabScreenshots = ({ urls }) =>
        urls.map((url) =>
          url === oldUrl
            ? "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"
            : null
        );
    }, oldUrl);
    try {
      await openSwitcher();
      let frame = await ui("tab-switcher-frame");
      await frame.waitForSelector(`.tab-card[data-id="${id}"] .card-thumb img`);
      await key(["Escape"]);
      await other.goto(newUrl);
      await page.bringToFront();
      await openSwitcher();
      frame = await ui("tab-switcher-frame");
      await frame.waitForSelector("#panel.ready .tab-card.selected");
      const card = `.tab-card[data-id="${id}"]`;
      assert(await frame.$eval(`${card} .card-title`, (el) => el.textContent) === "New page");
      assert(
        await frame.$(`${card} .card-thumb img`) === null,
        "New page is paired with the old page's screenshot",
      );
      await key(["Escape"]);
    } finally {
      await worker.evaluate(() => {
        sendRequestHandlers.getTabScreenshots = globalThis.savedPreviewHandler;
        delete globalThis.savedPreviewHandler;
      });
      await key(["Escape"]);
      await other.close();
      await page.bringToFront();
    }
  });

  await check(
    "a browser shortcut still switches after Alt was released before command delivery",
    async () => {
      await fresh();
      const other = await browser.newPage();
      try {
        await other.goto(`${origin}/early-alt-release`);
        await page.bringToFront();
        // The OS delivered both key events before the service worker sent its activation message.
        await key(["Alt"]);
        await openBrowserSwitcher();
        await pause(300);
        const active = await worker.evaluate(async () =>
          (await chrome.tabs.query({ active: true, currentWindow: true }))[0]
        );
        assert(
          active.url === `${origin}/early-alt-release`,
          `Early release selected ${active.url}`,
        );
        await noUi("tab-switcher-frame");
      } finally {
        await other.close();
        await page.bringToFront();
      }
    },
  );

  await check(
    "browser shortcuts switch directly on protected pages without opening windows",
    async () => {
      for (const url of ["chrome://extensions/", "chrome://newtab/", "about:blank"]) {
        const source = await worker.evaluate(async (url) => {
          const window = await chrome.windows.create({ url, focused: true });
          return { windowId: window.id, tabId: window.tabs[0].id };
        }, url);
        try {
          const previous = await worker.evaluate(async ({ windowId, tabId, origin }) => {
            const peer = await chrome.tabs.create({
              windowId,
              url: `${origin}/protected-peer`,
              active: true,
            });
            await chrome.tabs.update(tabId, { active: true });
            return peer.id;
          }, { ...source, origin });
          const windowsBefore = await worker.evaluate(async () =>
            (await chrome.windows.getAll()).length
          );
          await openBrowserSwitcher(source.tabId);
          const active = await worker.evaluate(
            async (windowId) => (await chrome.tabs.query({ windowId, active: true }))[0].id,
            source.windowId,
          );
          assert(active === previous, `${url}: did not switch to the previous visited tab`);
          assert(
            await worker.evaluate(async () => (await chrome.windows.getAll()).length) ===
              windowsBefore,
            `${url}: opened an unwanted switcher window`,
          );
        } finally {
          await worker.evaluate((id) => chrome.windows.remove(id), source.windowId);
        }
      }
      await page.bringToFront();
    },
  );

  await check(
    "browser shortcut works on an excluded site while a text input is focused",
    async () => {
      await fresh();
      const other = await browser.newPage();
      const savedRules = await worker.evaluate(() => Settings.get("exclusionRules"));
      try {
        await worker.evaluate((origin) =>
          Settings.set("exclusionRules", [
            ...Settings.get("exclusionRules"),
            { pattern: `${origin}/*`, passKeys: "" },
          ]), origin);
        await other.goto(`${origin}/excluded-peer`);
        const peerId = await tabId(other);
        await fresh();
        await key(["f"]);
        assert((await hints()).length === 0, "The fixture was not excluded");
        await page.focus("#first");
        await page.keyboard.down("Alt");
        await openBrowserSwitcher();
        const switcher = await ui("tab-switcher-frame");
        await switcher.waitForSelector(".tab-card.selected");
        const pageId = await tabId();
        await page.keyboard.up("Alt");
        await noUi("tab-switcher-frame");
        // The switcher hides before it activates the selected tab, so wait for the switch to land.
        const activeId = await worker.evaluate(async (pageId) => {
          for (let i = 0; i < 50; i++) {
            const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (active.id !== pageId) return active.id;
            await new Promise((resolve) => setTimeout(resolve, 20));
          }
          return pageId;
        }, pageId);
        assert(
          activeId === peerId,
          `Excluded-site shortcut switched to ${activeId}, not the previous tab ${peerId}`,
        );
      } finally {
        await page.keyboard.up("Alt");
        await worker.evaluate((rules) => Settings.set("exclusionRules", rules), savedRules);
        await other.close();
        await page.bringToFront();
      }
    },
  );

  await check("an unresponsive page switches directly and cannot block later tabs", async () => {
    await fresh();
    const other = await browser.newPage();
    await other.goto(`${origin}/responsive-peer`);
    const peerId = await tabId(other);
    await page.bringToFront();
    const id = await tabId();
    const session = await page.createCDPSession();
    let paused = false;
    try {
      const windowsBefore = await worker.evaluate(async () =>
        (await chrome.windows.getAll()).length
      );
      await session.send("Debugger.enable");
      await session.send("Debugger.pause");
      paused = true;
      await Promise.race([
        openBrowserSwitcher(id),
        pause(2000).then(() => {
          throw new Error("An unresponsive page blocked the shortcut");
        }),
      ]);
      const activeId = await worker.evaluate(async () =>
        (await chrome.tabs.query({ active: true, currentWindow: true }))[0].id
      );
      assert(activeId === peerId, "Unresponsive tab did not fall back to a direct swap");
      assert(
        await worker.evaluate(async () => (await chrome.windows.getAll()).length) === windowsBefore,
        "Unresponsive tab opened a switcher window",
      );
      await session.send("Debugger.resume");
      paused = false;
      await session.send("Debugger.disable");
      await pause(200);
      await noUi("tab-switcher-frame");
      await other.keyboard.down("Alt");
      await openBrowserSwitcher(peerId);
      await other.waitForSelector(
        ":root >>> iframe.tab-switcher-frame.vimium-ui-component-visible",
      );
      await key(["Escape"], other);
      await other.keyboard.up("Alt");
    } finally {
      if (paused) await session.send("Debugger.resume");
      await session.detach();
      if (!other.isClosed()) {
        await other.keyboard.up("Alt");
        await other.close();
      }
      await page.bringToFront();
    }
  });

  await check("quick taps switch without creating or loading a preview frame", async () => {
    await fresh();
    const other = await browser.newPage();
    try {
      await other.goto(`${origin}/quick-peer`);
      const peerId = await tabId(other);
      await page.bringToFront();
      await key(["Alt"]);
      const started = performance.now();
      await openBrowserSwitcher();
      const elapsed = performance.now() - started;
      const active = await worker.evaluate(async () =>
        (await chrome.tabs.query({ active: true, currentWindow: true }))[0].id
      );
      assert(active === peerId, "Quick tap did not switch to the previous tab");
      assert(
        await page.$(":root >>> iframe.tab-switcher-frame") === null,
        "Quick tap unnecessarily created a preview frame",
      );
      console.log(`Quick-swap request: ${Math.round(elapsed)} ms`);
    } finally {
      await other.close();
      await page.bringToFront();
    }
  });

  await check("preview navigation does not wait for thumbnails to load", async () => {
    await fresh();
    await worker.evaluate(() => {
      globalThis.originalGetScreenshots = sendRequestHandlers.getTabScreenshots;
      globalThis.thumbnailRequestPending = false;
      sendRequestHandlers.getTabScreenshots = () =>
        new Promise((resolve) => {
          globalThis.thumbnailRequestPending = true;
          globalThis.finishThumbnailRequest = resolve;
        });
    });
    try {
      await openSwitcher();
      const switcher = await ui("tab-switcher-frame");
      await switcher.waitForSelector("#panel.ready .tab-card.selected");
      assert(
        await worker.evaluate(() => globalThis.thumbnailRequestPending),
        "Expected the thumbnail request to remain pending",
      );
      const before = await switcher.$$eval(
        ".tab-card",
        (cards) => cards.findIndex((c) => c.classList.contains("selected")),
      );
      await key(["h"]);
      const after = await switcher.$$eval(
        ".tab-card",
        (cards) => cards.findIndex((c) => c.classList.contains("selected")),
      );
      assert(after === before - 1, "Slow thumbnails blocked keyboard navigation");
      await key(["Escape"]);
    } finally {
      await worker.evaluate(() => {
        globalThis.finishThumbnailRequest?.([]);
        sendRequestHandlers.getTabScreenshots = globalThis.originalGetScreenshots;
        delete globalThis.originalGetScreenshots;
        delete globalThis.finishThumbnailRequest;
        delete globalThis.thumbnailRequestPending;
      });
    }
  });

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
        await switcher.waitForSelector("#panel.ready .tab-card.selected");
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

  await check("the source command opens source in a separate tab", async () => {
    await fresh();
    await runCommand("toggleViewSource");
    const target = await browser.waitForTarget(
      (target) => target.url().startsWith("view-source:"),
      { timeout: 5000 },
    );
    await (await target.page()).close();
  });

  await check("hints reach links inside an embedded frame", async () => {
    await fresh();
    const loadedFrame = page.waitForFrame((frame) => frame.url() === `${origin}/embedded`);
    await page.evaluate((url) => {
      const iframe = document.createElement("iframe");
      iframe.src = url;
      iframe.style.cssText = "position:fixed;bottom:10px;right:10px;width:500px;height:250px";
      document.body.append(iframe);
    }, `${origin}/embedded`);
    const embedded = await loadedFrame;
    await embedded.waitForFunction(() => document.readyState === "complete");
    await pause(200);
    await key(["f"]);
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
      await runCommand("openCopiedUrlInCurrentTab");
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
    "switcher hides sleeping tabs and keeps awake background tabs, current tab first",
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
          ".card-title",
          (els) => els.map((el) => el.textContent),
        );
        assert(titles[0] === "Brovim browser fixture", JSON.stringify(titles));
        assert(titles.includes("Awake"), "Visited awake tab was omitted");
        assert(titles.includes("Unvisited"), "Unvisited tab was omitted");
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
    "sleeping pinned tabs beyond the card limit stay in the grid and wake only when selected",
    async () => {
      await fresh();
      const urls = [
        `${origin}/pinned-sleeper?title=PinnedSleeper`,
        `${origin}/unpinned-sleeper?title=UnpinnedSleeper`,
      ];
      try {
        await worker.evaluate(async (urls) => {
          await chrome.tabs.create({ url: urls[0], active: false, pinned: true });
          await chrome.tabs.create({ url: urls[1], active: false });
          for (let i = 0; i < 100; i++) {
            const tabs = (await chrome.tabs.query({})).filter((tab) => urls.includes(tab.url));
            if (tabs.length === 2 && tabs.every((tab) => tab.status === "complete")) {
              for (const tab of tabs) await chrome.tabs.discard(tab.id);
              return;
            }
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
          throw new Error("Sleeper fixtures did not load");
        }, urls);
        const pinned = await worker.evaluate(
          async (url) => (await chrome.tabs.query({})).find((tab) => tab.url === url),
          urls[0],
        );
        assert(pinned.pinned && pinned.discarded, "Pinned fixture did not enter sleep");
        await worker.evaluate(async (origin) => {
          await Settings.set("tabSwitcherColumns", 3);
          await Settings.set("tabSwitcherRows", 1);
          // Push the pinned sleeper out of the recent-card limit, as happens after a long sleep.
          for (let i = 0; i < 4; i++) {
            await chrome.tabs.create({
              url: `${origin}/pin-limit-inactive-${i}?title=InactivePin${i}`,
              active: false,
              pinned: true,
            });
          }
          for (let i = 0; i < 4; i++) {
            await chrome.tabs.create({ url: `${origin}/pin-limit-${i}`, active: false });
          }
        }, origin);
        await openSwitcher();
        const switcher = await ui("tab-switcher-frame");
        await switcher.waitForSelector("#panel.ready .tab-card.selected");
        const titles = await switcher.$$eval(
          ".card-title",
          (els) => els.map((el) => el.textContent),
        );
        assert(titles.includes("PinnedSleeper"), "Sleeping pinned tab was missing");
        assert(
          titles.slice(0, 5).join(",") ===
            ["PinnedSleeper", "InactivePin0", "InactivePin1", "InactivePin2", "InactivePin3"].join(
              ",",
            ),
          "Sleeping or inactive pins did not occupy the leading cells in tab-bar order",
        );
        assert(!titles.includes("UnpinnedSleeper"), "Sleeping unpinned tab was exposed");
        for (let i = 0; i < 4; i++) {
          assert(titles.includes(`InactivePin${i}`), `Inactive pinned tab ${i} was missing`);
        }
        const cardIds = await switcher.$$eval(".tab-card", (els) => els.map((el) => el.dataset.id));
        assert(cardIds.length === 7, `Expected the quick-swap pair plus 5 pins: ${cardIds}`);
        assert(new Set(cardIds).size === cardIds.length, "Pinned cards were duplicated");
        assert(
          await switcher.$$eval(
            ".tab-card:not([hidden])",
            (cards) => cards.length > 0 && cards.length <= 3,
          ),
          "Pinned overflow exceeded the one-page grid",
        );
        assert(
          (await worker.evaluate((id) => chrome.tabs.get(id), pinned.id)).discarded,
          "Opening the grid woke a pinned tab",
        );
        for (let i = 0; i < 10; i++) {
          if (await switcher.$eval(".selected", (el) => el.dataset.id) === String(pinned.id)) break;
          await key(["ArrowRight"]);
        }
        assert(
          await switcher.$eval(".selected", (el) => el.dataset.id) === String(pinned.id),
          "Could not select the pinned card",
        );
        assert(
          await switcher.$eval(".selected", (el) => !el.hidden),
          "The pinned selection was not visible on its overflow page",
        );
        assert(
          await switcher.$eval("#panel", (el) => el.scrollHeight <= el.clientHeight + 1),
          "Pinned overflow required scrolling",
        );
        await key(["Enter"]);
        await worker.evaluate(async (id) => {
          for (let i = 0; i < 100; i++) {
            const tab = await chrome.tabs.get(id);
            if (tab.active && !tab.discarded) return;
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
          throw new Error("Selecting the pinned tab did not wake it");
        }, pinned.id);
      } finally {
        await worker.evaluate(
          async (urls, origin) => {
            await Settings.set("tabSwitcherColumns", Settings.defaultOptions.tabSwitcherColumns);
            await Settings.set("tabSwitcherRows", Settings.defaultOptions.tabSwitcherRows);
            const ids = (await chrome.tabs.query({})).filter((tab) =>
              urls.includes(tab.url) || tab.url.startsWith(`${origin}/pin-limit-`)
            ).map((
              tab,
            ) => tab.id);
            if (ids.length) await chrome.tabs.remove(ids);
          },
          urls,
          origin,
        );
        await page.bringToFront();
      }
    },
  );

  await check(
    "old sleeping pins on excluded sites stay on the first page and preserve quick swaps",
    async () => {
      await fresh();
      const prefix = `${origin}/reserved-pin-`;
      const sourceId = await tabId();
      const previousRules = await worker.evaluate(() => Settings.get("exclusionRules"));
      try {
        const fixtures = await worker.evaluate(async ({ prefix, previousRules }) => {
          await Settings.set("exclusionRules", [...previousRules, {
            pattern: `${prefix}app*`,
            passKeys: "",
          }]);
          const pins = [];
          for (const name of ["WhatsApp", "Gmail", "OtherPin"]) {
            pins.push(
              await chrome.tabs.create({
                url: `${prefix}app-${name}?title=${name}`,
                active: false,
                pinned: true,
              }),
            );
          }
          const peers = [];
          for (let i = 0; i < 20; i++) {
            peers.push(
              await chrome.tabs.create({
                url: `${prefix}recent-${i}?title=Recent${i}`,
                active: false,
              }),
            );
          }
          for (let attempt = 0; attempt < 100; attempt++) {
            const tabs = (await chrome.tabs.query({})).filter((tab) => tab.url.startsWith(prefix));
            if (tabs.length === 23 && tabs.every((tab) => tab.status === "complete")) {
              for (const pin of pins) await chrome.tabs.discard(pin.id);
              return { peerId: peers.at(-1).id, peerUrl: `${prefix}recent-19?title=Recent19` };
            }
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
          throw new Error("Reserved pinned fixtures did not load");
        }, { prefix, previousRules });
        await page.keyboard.down("Alt");
        await openSwitcher();
        const frame = await ui("tab-switcher-frame");
        await frame.waitForSelector("#panel.ready .selected");
        const visibleTitles = await frame.$$eval(
          ".tab-card:not([hidden]) .card-title",
          (els) => els.map((el) => el.textContent),
        );
        assert(visibleTitles.length === 18, `Unexpected first-page count: ${visibleTitles}`);
        for (const name of ["WhatsApp", "Gmail", "OtherPin"]) {
          assert(visibleTitles.includes(name), `${name} was missing from the visible first page`);
        }
        assert(
          visibleTitles.slice(0, 3).join(",") === "WhatsApp,Gmail,OtherPin",
          `Pinned tabs were not in the first cells: ${visibleTitles}`,
        );
        assert(
          await frame.$eval(".selected", (el) => Number(el.dataset.id)) === fixtures.peerId,
          "Reserving pins changed the previous-tab selection",
        );
        assert(
          await frame.$eval("#page-indicator", (el) => el.hidden),
          "Old pins were pushed to page two",
        );
        assert(
          await frame.$eval("#panel", (el) => el.scrollHeight <= el.clientHeight + 1),
          "Pins caused scrolling",
        );
        const cardIds = await frame.$$eval(
          ".tab-card",
          (cards) => cards.map((card) => card.dataset.id),
        );
        await page.keyboard.press("q");
        await frame.waitForFunction(() =>
          document.querySelector(".selected .card-title").textContent === "Recent18"
        );
        await page.keyboard.down("Shift");
        await page.keyboard.press("q");
        await page.keyboard.up("Shift");
        await frame.waitForFunction(() =>
          document.querySelector(".selected .card-title").textContent === "Recent19"
        );
        assert(
          JSON.stringify(
            await frame.$$eval(".tab-card", (cards) => cards.map((card) => card.dataset.id)),
          ) === JSON.stringify(cardIds),
          "Cycling moved pinned cards or rebuilt their order",
        );
        assert(
          await worker.evaluate(async (id) => (await chrome.tabs.get(id)).active, sourceId),
          "Cycling with pins switched before Alt release",
        );
        await page.screenshot({ path: "/tmp/brovim-pinned-first.png" });
        await key(["Escape", "Alt"]);
        await openBrowserSwitcher();
        assert(
          await worker.evaluate(async (id) => (await chrome.tabs.get(id)).active, fixtures.peerId),
          "Quick swap did not select the previous unpinned tab",
        );
        const peerPage = (await browser.pages()).find((peer) => peer.url() === fixtures.peerUrl);
        assert(peerPage, "Could not find the quick-swap peer page");
        await key(["Alt"], peerPage);
        await openBrowserSwitcher(fixtures.peerId);
        assert(
          await worker.evaluate(async (id) => (await chrome.tabs.get(id)).active, sourceId),
          "Quick swap did not return to the source tab",
        );
        assert(
          await worker.evaluate(
            async (prefix) =>
              (await chrome.tabs.query({ pinned: true })).filter((tab) =>
                tab.url.startsWith(prefix)
              )
                .every((tab) => tab.discarded && !tab.active),
            prefix,
          ),
          "Showing the pins or swapping regular tabs woke a pinned tab",
        );
        const visitedPinId = await worker.evaluate(async ({ prefix, sourceId }) => {
          const pin = (await chrome.tabs.query({ pinned: true })).find((tab) =>
            tab.url.startsWith(`${prefix}app-OtherPin`)
          );
          await chrome.tabs.update(pin.id, { active: true });
          await chrome.tabs.update(sourceId, { active: true });
          return pin.id;
        }, { prefix, sourceId });
        await openSwitcher();
        await frame.waitForSelector("#panel.ready .selected");
        assert(
          (await frame.$$eval(".card-title", (els) => els.slice(0, 3).map((el) => el.textContent)))
            .join(",") === "WhatsApp,Gmail,OtherPin",
          "Visiting a pinned tab changed the leading pinned positions",
        );
        assert(
          await frame.$eval(".selected", (el) => Number(el.dataset.id)) === visitedPinId,
          "Opening after visiting a pin lost the previous-tab selection",
        );
        await key(["Escape"]);
      } finally {
        await page.keyboard.up("Alt");
        await page.keyboard.up("Shift");
        await worker.evaluate(async ({ prefix, previousRules }) => {
          await Settings.set("exclusionRules", previousRules);
          const ids = (await chrome.tabs.query({})).filter((tab) => tab.url.startsWith(prefix)).map(
            (tab) => tab.id,
          );
          if (ids.length) await chrome.tabs.remove(ids);
        }, { prefix, previousRules });
        await page.bringToFront();
      }
    },
  );

  await check(
    "held cycling starts at last-used index 6 then follows 7, 8, 0 while quick taps use history",
    async () => {
      const originalOrder = await worker.evaluate(() => Settings.get("tabSwitcherOrder"));
      const urls = Array.from(
        { length: 9 },
        (_, index) => `${origin}/visual-cycle-${index}?title=Index${index}`,
      );
      let windowId, source;
      try {
        const fixture = await worker.evaluate(async (urls) => {
          await Settings.set("tabSwitcherOrder", "tabstrip");
          const window = await chrome.windows.create({ url: urls });
          const tabs = await chrome.tabs.query({ windowId: window.id });
          tabs.sort((a, b) => a.index - b.index);
          for (const tab of tabs.slice(0, 3)) await chrome.tabs.update(tab.id, { pinned: true });
          await chrome.tabs.update(tabs[6].id, { active: true });
          await chrome.tabs.update(tabs[3].id, { active: true });
          return { windowId: window.id, sourceId: tabs[3].id, lastId: tabs[8].id };
        }, urls);
        windowId = fixture.windowId;
        source = await (await browser.waitForTarget((target) => target.url() === urls[3])).page();
        await source.waitForFunction(() => document.readyState === "complete");
        await source.bringToFront();
        await source.keyboard.down("Alt");
        await openBrowserSwitcher(fixture.sourceId);
        const element = await source.waitForSelector(
          ":root >>> iframe.tab-switcher-frame.vimium-ui-component-visible",
        );
        const frame = await element.contentFrame();
        await frame.waitForSelector("#panel.ready .selected");
        const initial = await frame.$$eval(
          ".tab-card",
          (cards) => cards.map((card) => card.dataset.id),
        );
        const selectedIndex = () =>
          frame.$$eval(
            ".tab-card",
            (cards) => cards.findIndex((card) => card.classList.contains("selected")),
          );
        assert(await selectedIndex() === 6, "Opening did not select last-used cell 6");
        for (let i = 0; i < 11; i++) {
          await source.keyboard.press("q");
          assert(await selectedIndex() === (7 + i) % 9, `Unexpected cell after repeat ${i + 1}`);
        }
        assert(
          JSON.stringify(
            await frame.$$eval(".tab-card", (cards) => cards.map((card) => card.dataset.id)),
          ) === JSON.stringify(initial),
          "Held cycling changed the visible order",
        );
        await source.keyboard.up("Alt");
        await worker.evaluate(async (id) => {
          for (let i = 0; i < 100; i++) {
            if ((await chrome.tabs.get(id)).active) return;
            await new Promise((resolve) => setTimeout(resolve, 20));
          }
          throw new Error("Releasing Alt did not select cell 8");
        }, fixture.lastId);
        const lastPage = await (await browser.waitForTarget((target) => target.url() === urls[8]))
          .page();
        await key(["Alt"], lastPage);
        await openBrowserSwitcher(fixture.lastId);
        assert(
          await worker.evaluate(async (id) => (await chrome.tabs.get(id)).active, fixture.sourceId),
          "Quick Alt+Q followed grid order instead of returning to the last-used tab",
        );
        await key(["Alt"], source);
        await openBrowserSwitcher(fixture.sourceId);
        assert(
          await worker.evaluate(async (id) => (await chrome.tabs.get(id)).active, fixture.lastId),
          "The second quick tap did not swap back",
        );
      } finally {
        await source?.keyboard.up("Alt").catch(() => {});
        if (windowId != null) await worker.evaluate((id) => chrome.windows.remove(id), windowId);
        await worker.evaluate((order) => Settings.set("tabSwitcherOrder", order), originalOrder);
        await page.bringToFront();
      }
    },
  );

  await check("switcher keeps cards when closing a tab fails", async () => {
    await fresh();
    const peer = await browser.newPage();
    await peer.goto(`${origin}/close-failure`);
    await page.bringToFront();
    try {
      await worker.evaluate(() => {
        globalThis.originalRemoveTab = chrome.tabs.remove;
        chrome.tabs.remove = () => Promise.reject(new Error("Close rejected"));
      });
      await openSwitcher();
      const frame = await ui("tab-switcher-frame");
      await frame.waitForSelector("#panel.ready .selected");
      const before = await frame.$$eval(".tab-card", (els) => els.map((el) => el.dataset.id));
      await key(["x"]);
      await pause(200);
      const after = await frame.$$eval(".tab-card", (els) => els.map((el) => el.dataset.id));
      assert(JSON.stringify(before) === JSON.stringify(after), "Failed close removed a card");
      await worker.evaluate(() => chrome.tabs.remove = globalThis.originalRemoveTab);
      const selectedId = await frame.$eval(".selected", (el) => el.dataset.id);
      await key(["x"]);
      await frame.waitForFunction(
        (id) => ![...document.querySelectorAll(".tab-card")].some((card) => card.dataset.id === id),
        {},
        selectedId,
      );
      await key(["Escape"]);
    } finally {
      await worker.evaluate(() => {
        chrome.tabs.remove = globalThis.originalRemoveTab;
      });
      if (!peer.isClosed()) await peer.close();
      await page.bringToFront();
    }
  });

  for (const action of ["cancel", "reopen", "move"]) {
    await check(
      action === "move"
        ? "switcher preserves navigation while closing a tab"
        : `switcher cancels a pending commit after Escape${
          action === "reopen" ? " and reopening" : ""
        }`,
      async () => {
        await fresh();
        const peer = await browser.newPage();
        await peer.goto(`${origin}/delayed-close`);
        await page.bringToFront();
        const sourceId = await tabId();
        try {
          await worker.evaluate(() => {
            globalThis.originalCloseTab = sendRequestHandlers.closeSpecificTab;
            globalThis.finishCloseTab = null;
            sendRequestHandlers.closeSpecificTab = (request) =>
              new Promise((resolve, reject) => {
                globalThis.finishCloseTab = () => originalCloseTab(request).then(resolve, reject);
              });
          });
          await openSwitcher();
          const frame = await ui("tab-switcher-frame");
          await frame.waitForSelector("#panel.ready .selected");
          await key(["x"]);
          assert(await worker.evaluate(() => !!globalThis.finishCloseTab), "Close was not pending");
          if (action === "move") {
            // Move past the vacated position to catch a close reply resetting the selection.
            await key(["ArrowRight", "ArrowRight"]);
            const selectedId = Number(await frame.$eval(".selected", (el) => el.dataset.id));
            await key(["Enter"]);
            await worker.evaluate(() => finishCloseTab());
            await pause(300);
            assert(
              await worker.evaluate(async (id) => (await chrome.tabs.get(id)).active, selectedId),
              "Close completion replaced the user's newer selection",
            );
            return;
          }
          const reopen = action === "reopen";
          await key(["Enter", "Escape"]);
          await noUi("tab-switcher-frame");
          if (reopen) {
            await openSwitcher();
            await frame.waitForSelector("#panel.ready .selected");
          }
          await worker.evaluate(() => finishCloseTab());
          await pause(300);
          assert(
            await worker.evaluate(async (id) => (await chrome.tabs.get(id)).active, sourceId),
            "Cancelled commit switched tabs after the close completed",
          );
          assert(
            !!await frame.$("#panel.ready") === reopen,
            "Late close changed the visibility of the newer gesture",
          );
          if (reopen) await key(["Escape"]);
        } finally {
          await worker.evaluate(() => {
            sendRequestHandlers.closeSpecificTab = globalThis.originalCloseTab;
          });
          if (!peer.isClosed()) await peer.close();
          await page.bringToFront();
        }
      },
    );
  }

  await check(
    "Ctrl+Q wraps inside the displayed recent tabs without reaching older tabs",
    async () => {
      await fresh();
      const urls = Array.from({ length: 19 }, (_, i) => `${origin}/extra${i}?title=Extra${i}`);
      await worker.evaluate(() => {
        globalThis.boundedOriginalCommands = chrome.commands.getAll;
        chrome.commands.getAll = () =>
          Promise.resolve([{ name: "open_tab_switcher", shortcut: "Ctrl+Q" }]);
      });
      try {
        // Visit each so the oldest one (Extra0) falls past the cap.
        for (const url of urls) await worker.evaluate((url) => chrome.tabs.create({ url }), url);
        await worker.evaluate(async (urls) => {
          for (let attempt = 0; attempt < 100; attempt++) {
            const tabs = await chrome.tabs.query({});
            if (
              urls.every((url) =>
                tabs.some((tab) =>
                  tab.url === url && tab.status === "complete" &&
                  tab.title === new URL(url).searchParams.get("title")
                )
              )
            ) return;
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
          throw new Error("Extra-tab fixtures did not finish loading");
        }, urls);
        await page.bringToFront();
        await pause(300);
        await page.keyboard.down("Control");
        await openBrowserSwitcher();
        const switcher = await ui("tab-switcher-frame");
        await switcher.waitForSelector(".tab-card.selected");
        const titles = await switcher.$$eval(
          ".card-title",
          (els) => els.map((el) => el.textContent),
        );
        assert(titles.length === 18, JSON.stringify(titles));
        for (const [width, height] of [[1280, 900], [900, 700], [640, 480]]) {
          await page.setViewport({ width, height });
          await switcher.waitForFunction((width) => innerWidth === width, {}, width);
          await switcher.waitForFunction(() => {
            const panel = document.querySelector("#panel");
            const rect = panel.getBoundingClientRect();
            const cards = [...document.querySelectorAll(".tab-card:not([hidden])")];
            return cards.length === 18 &&
              getComputedStyle(document.querySelector("#tab-switcher")).gridTemplateColumns.split(
                  " ",
                ).length === 6 &&
              panel.scrollHeight <= panel.clientHeight + 1 &&
              rect.top >= 0 && rect.bottom <= innerHeight &&
              cards.every((card) => {
                const box = card.getBoundingClientRect();
                return box.top >= rect.top && box.bottom <= rect.bottom &&
                  box.left >= rect.left && box.right <= rect.right;
              });
          });
          if (width === 1280) await page.screenshot({ path: "/tmp/brovim-6x3.png" });
        }
        await page.setViewport({ width: 1280, height: 900 });
        assert(
          titles[0] === "Brovim browser fixture" && titles[1] === "Extra18",
          JSON.stringify(titles),
        );
        assert(!titles.includes("Extra0"), "Oldest tab was shown past the cap");
        const initialIds = await switcher.$$eval(
          ".tab-card",
          (cards) => cards.map((card) => card.dataset.id),
        );
        // Keep pressing the actual assigned letter while the primary modifier is held.
        for (let i = 0; i < 71; i++) await page.keyboard.press("q");
        await switcher.waitForFunction(() =>
          document.querySelector(".selected .card-title").textContent === "Brovim browser fixture"
        );
        assert(
          JSON.stringify(
            await switcher.$$eval(".tab-card", (cards) => cards.map((card) => card.dataset.id)),
          ) ===
            JSON.stringify(initialIds),
          "Repeated presses left the original recent grid",
        );
        await page.keyboard.press("q");
        await switcher.waitForFunction(() =>
          document.querySelector(".selected .card-title").textContent === "Extra18"
        );
        // Closing the selected card (Extra18) refills the grid with the next hidden tab.
        await key(["x"]);
        await switcher.waitForFunction(() =>
          [...document.querySelectorAll(".card-title")].some((el) => el.textContent === "Extra1")
        );
        await key(["Escape"]);
      } finally {
        await page.keyboard.up("Control");
        await worker.evaluate(() => chrome.commands.getAll = globalThis.boundedOriginalCommands);
        await page.setViewport({ width: 1280, height: 900 });
        await worker.evaluate(async (urls) => {
          const ids = (await chrome.tabs.query({})).filter((t) => urls.includes(t.url)).map((t) =>
            t.id
          );
          if (ids.length) await chrome.tabs.remove(ids);
        }, urls);
      }
    },
  );

  await check("switcher is keyboard-only with no close button or mouse actions", async () => {
    await fresh();
    const peers = [];
    try {
      for (const name of ["Alpha", "Beta", "Gamma"]) {
        const peer = await browser.newPage();
        peers.push(peer);
        await peer.goto(`${origin}/keyboard-${name}?title=Keyboard${name}`);
      }
      await page.bringToFront();
      await openSwitcher();
      const frame = await ui("tab-switcher-frame");
      await frame.waitForSelector("#panel.ready .selected");
      assert(!await frame.$(".close-tab, button"), "Mouse close button remains");
      const before = await frame.$eval(".selected", (el) => el.dataset.id);
      const target = await frame.$(".tab-card:not(.selected)");
      const box = await target.boundingBox();
      await page.mouse.move(box.x + 5, box.y + 5);
      await page.mouse.move(box.x + 20, box.y + 20);
      await target.click();
      await target.click({ button: "middle" });
      await frame.click("body", { offset: { x: 1, y: 1 } });
      await page.mouse.wheel({ deltaY: 900 });
      await pause(150);
      assert(await frame.$("#panel.ready"), "Mouse hid the switcher");
      assert(
        await frame.$eval(".selected", (el) => el.dataset.id) === before,
        "Mouse changed selection",
      );
      assert(
        await worker.evaluate(async () =>
          (await chrome.tabs.query({ title: "Keyboard*" })).length
        ) === 3,
        "Mouse closed a tab",
      );
      await key(["x"]);
      await frame.waitForFunction(
        (id) => ![...document.querySelectorAll(".tab-card")].some((el) => el.dataset.id === id),
        {},
        before,
      );
      assert(
        await worker.evaluate(async () =>
          (await chrome.tabs.query({ title: "Keyboard*" })).length
        ) === 2,
        "Keyboard x failed",
      );
      await key(["Escape"]);
      await noUi("tab-switcher-frame");
    } finally {
      for (const peer of peers) if (!peer.isClosed()) await peer.close();
      await page.bringToFront();
    }
  });

  await check("protected-page grid keeps its recent cards and refills after a close", async () => {
    await fresh();
    const peers = [];
    await worker.evaluate(async () => {
      globalThis.refillOriginalCommands = chrome.commands.getAll;
      chrome.commands.getAll = () =>
        Promise.resolve([{ name: "open_tab_switcher", shortcut: "Ctrl+Q" }]);
      await Settings.set("tabSwitcherColumns", 3);
      await Settings.set("tabSwitcherRows", 1);
    });
    try {
      for (let i = 0; i < 3; i++) {
        const peer = await browser.newPage();
        peer.setDefaultTimeout(5000);
        peers.push(peer);
        await peer.goto(`${origin}/refill-${i}?title=Refill${i}`);
      }
      await options.bringToFront();
      await options.keyboard.down("Control");
      await openBrowserSwitcher(options);
      await openBrowserSwitcher(peers[2]);
      const element = await peers[2].waitForSelector(
        ":root >>> iframe.tab-switcher-frame.vimium-ui-component-visible",
      );
      const frame = await element.contentFrame();
      await frame.waitForSelector("#panel.ready .selected");
      const initial = await frame.$$eval(
        ".tab-card",
        (cards) => cards.map((card) => card.dataset.id),
      );
      assert(initial.length === 3, "Protected handoff exceeded the grid size");
      assert(
        !await frame.$eval("#tab-switcher", (grid) => grid.textContent.includes("Refill0")),
        "Older tab entered the initial grid",
      );
      await peers[2].keyboard.press("x");
      await frame.waitForFunction(() =>
        document.querySelector("#tab-switcher").textContent.includes("Refill0")
      );
      assert(
        await frame.$$eval(".tab-card", (cards) => cards.length) === 3,
        "Close did not refill the carried grid",
      );
      const refilled = await frame.$$eval(
        ".tab-card",
        (cards) => cards.map((card) => card.dataset.id),
      );
      for (let i = 0; i < 12; i++) await peers[2].keyboard.press("q");
      assert(
        JSON.stringify(
          await frame.$$eval(".tab-card", (cards) => cards.map((card) => card.dataset.id)),
        ) === JSON.stringify(refilled),
        "Cycling paged beyond the refilled grid",
      );
      await peers[2].keyboard.press("Escape");
    } finally {
      await options.keyboard.up("Control");
      for (const peer of peers) if (!peer.isClosed()) await peer.close();
      await worker.evaluate(async () => {
        chrome.commands.getAll = globalThis.refillOriginalCommands;
        await Settings.set("tabSwitcherColumns", Settings.defaultOptions.tabSwitcherColumns);
        await Settings.set("tabSwitcherRows", Settings.defaultOptions.tabSwitcherRows);
      });
      await page.bringToFront();
    }
  });

  await check("reverse opening starts at the last displayed recent tab", async () => {
    let windowId;
    try {
      await worker.evaluate(async () => {
        await Settings.set("tabSwitcherColumns", 3);
        await Settings.set("tabSwitcherRows", 1);
      });
      const urls = Array.from({ length: 4 }, (_, i) => `${origin}/reverse-${i}?title=Reverse${i}`);
      const result = await worker.evaluate(async (urls) => {
        const window = await chrome.windows.create({ url: urls });
        return { windowId: window.id, sourceId: window.tabs[0].id };
      }, urls);
      windowId = result.windowId;
      const target = await browser.waitForTarget((target) => target.url() === urls[0]);
      const source = await target.page();
      await source.waitForFunction(() => document.readyState === "complete");
      await pause(200);
      await worker.evaluate((id) =>
        chrome.tabs.sendMessage(id, {
          handler: "runInTopFrame",
          sourceFrameId: 0,
          registryEntry: {
            command: "TabSwitcher.activate",
            options: { altCycle: true, reverse: true },
          },
        }), result.sourceId);
      const element = await source.waitForSelector(
        ":root >>> iframe.tab-switcher-frame.vimium-ui-component-visible",
      );
      const frame = await element.contentFrame();
      await frame.waitForSelector("#panel.ready .selected");
      assert(
        await frame.$$eval(".tab-card", (cards) => cards.length) === 3,
        "Reverse opening left the three-card recent grid",
      );
      await source.keyboard.press("Enter");
      await frame.waitForFunction(() => !document.querySelector("#panel.ready"));
      assert(
        await worker.evaluate(
          async (windowId, sourceId) =>
            (await chrome.tabs.query({ active: true, windowId }))[0].id !== sourceId,
          windowId,
          result.sourceId,
        ),
        "Final-page selection did not switch",
      );
    } finally {
      if (windowId != null) await worker.evaluate((id) => chrome.windows.remove(id), windowId);
      await worker.evaluate(async () => {
        await Settings.set("tabSwitcherColumns", Settings.defaultOptions.tabSwitcherColumns);
        await Settings.set("tabSwitcherRows", Settings.defaultOptions.tabSwitcherRows);
      });
      await page.bringToFront();
    }
  });

  await check("cards per row and rows settings size the grid", async () => {
    await fresh();
    const extras = [];
    for (let i = 0; i < 4; i++) {
      const extra = await browser.newPage();
      await extra.goto(`${origin}/layout-${i}`);
      extras.push(extra);
    }
    await page.bringToFront();
    try {
      await worker.evaluate(async () => {
        await Settings.set("tabSwitcherColumns", 3);
        await Settings.set("tabSwitcherRows", 1);
      });
      await pause(300);
      await openSwitcher();
      const switcher = await ui("tab-switcher-frame");
      await switcher.waitForSelector("#panel.ready .tab-card.selected");
      const layout = await switcher.$eval("#tab-switcher", (el) => ({
        cards: el.children.length,
        columns: getComputedStyle(el).gridTemplateColumns.split(" ").length,
      }));
      assert(layout.cards === 3 && layout.columns === 3, JSON.stringify(layout));
      await key(["Escape"]);
    } finally {
      await worker.evaluate(async () => {
        await Settings.set("tabSwitcherColumns", Settings.defaultOptions.tabSwitcherColumns);
        await Settings.set("tabSwitcherRows", Settings.defaultOptions.tabSwitcherRows);
      });
      for (const extra of extras) await extra.close();
      await page.bringToFront();
    }
  });

  await check("a link opened in the background is listed right after the current tab", async () => {
    await fresh();
    const older = await browser.newPage();
    await older.goto(`${origin}/older?title=Older`);
    const olderId = await tabId(older);
    await page.bringToFront();
    await pause(200);
    const pageId = await tabId();
    const url = `${origin}/target?link=0`;
    try {
      await page.click('a[href="/target?link=0"]', { button: "middle" });
      await browser.waitForTarget((target) => target.url() === url);
      await pause(200);
      const [openedId, ids] = await worker.evaluate(
        async (pageId, url) => {
          const opened = (await chrome.tabs.query({})).find((t) =>
            t.url === url || t.pendingUrl === url
          );
          const tab = await chrome.tabs.get(pageId);
          const list = await sendRequestHandlers.getOpenTabsWithScreenshots({
            tab,
            includeScreenshots: false,
          });
          return [opened?.id, list.map((t) => t.id)];
        },
        pageId,
        url,
      );
      assert(!(await worker.evaluate(async (id) => (await chrome.tabs.get(id)).active, openedId)));
      assert(
        ids[0] === pageId && ids[1] === openedId && ids[2] === olderId,
        `Unexpected order ${JSON.stringify(ids)} for ${pageId}, ${openedId}, ${olderId}`,
      );
    } finally {
      await worker.evaluate(async (url) => {
        const tabs = await chrome.tabs.query({});
        const ids = tabs.filter((t) => t.url === url || t.pendingUrl === url).map((t) => t.id);
        if (ids.length) await chrome.tabs.remove(ids);
      }, url);
      await older.close();
      await page.bringToFront();
    }
  });

  await check(
    "background tabs without openers rank next even when WhatsApp-style exclusions apply",
    async () => {
      await fresh();
      const peer = await browser.newPage();
      let createdId;
      const previous = await worker.evaluate(() => ({
        rules: Settings.get("exclusionRules"),
        order: Settings.get("tabSwitcherOrder"),
      }));
      try {
        await peer.goto(`${origin}/older-visited-tab`);
        const peerId = await tabId(peer);
        await page.bringToFront();
        await worker.evaluate(async ({ rules, pattern }) => {
          await Settings.set("tabSwitcherOrder", "mru");
          await Settings.set("exclusionRules", [...rules, { pattern, passKeys: "" }]);
        }, { rules: previous.rules, pattern: `${origin}/unopened-whatsapp*` });
        createdId = await worker.evaluate(
          async (url) => (await chrome.tabs.create({ url, active: false })).id,
          `${origin}/unopened-whatsapp?title=WhatsApp`,
        );
        await openSwitcher();
        const frame = await ui("tab-switcher-frame");
        await frame.waitForSelector("#panel.ready .tab-card.selected");
        const order = await frame.$$eval(
          ".tab-card",
          (cards) => cards.map((card) => Number(card.dataset.id)),
        );
        assert(order[0] === await tabId(), "The active tab lost the first position");
        assert(
          order[1] === createdId && order[2] === peerId,
          `New WhatsApp tab fell behind older visits: ${order}`,
        );
        await key(["Escape"]);
      } finally {
        await key(["Escape"]);
        if (createdId) {
          await worker.evaluate((id) => chrome.tabs.remove(id), createdId);
        }
        await peer.close();
        await worker.evaluate(async ({ rules, order }) => {
          await Settings.set("exclusionRules", rules);
          await Settings.set("tabSwitcherOrder", order);
        }, previous);
        await page.bringToFront();
      }
    },
  );

  await check("with exactly two tabs the shortcut swaps directly without a grid", async () => {
    const urls = [`${origin}/pair-a?title=Pair%20A`, `${origin}/pair-b?title=Pair%20B`];
    const pair = await worker.evaluate(
      async (urls) =>
        (await chrome.windows.create({ url: urls, focused: true })).tabs.map((t) => t.id),
      urls,
    );
    let pairPage;
    try {
      pairPage = await (await browser.waitForTarget((target) => target.url() === urls[0])).page();
      await pairPage.waitForFunction(() => document.readyState === "complete");
      await pause(200);
      await pairPage.keyboard.down("Alt");
      await openBrowserSwitcher(pair[0]);
      const active = await worker.evaluate(
        async (id) =>
          (await chrome.tabs.query({
            active: true,
            windowId: (await chrome.tabs.get(id)).windowId,
          }))[0].id,
        pair[0],
      );
      assert(active === pair[1], "Two-tab shortcut did not swap to the other tab");
      assert(
        await pairPage.$(":root >>> iframe.tab-switcher-frame") === null,
        "Two-tab shortcut showed the preview grid",
      );
    } finally {
      await pairPage?.keyboard.up("Alt");
      await worker.evaluate((ids) => chrome.tabs.remove(ids), pair);
      await page.bringToFront();
    }
  });

  await check(
    "extension replacement restores existing website tabs without a refresh",
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
      await pause(500);
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
