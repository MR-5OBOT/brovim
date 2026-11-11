import puppeteer from "puppeteer";
import { fileURLToPath } from "node:url";

// Run only on an explicitly supplied, isolated X server. Never inject keys into the user's desktop.
const display = Deno.env.get("BROVIM_NATIVE_DISPLAY");
const nativeNumber = /^:(\d+)$/.exec(display || "")?.[1];
const desktopNumber = /:(\d+)(?:\.\d+)?$/.exec(Deno.env.get("DISPLAY") || "")?.[1];
if (nativeNumber == null || Number(nativeNumber) === Number(desktopNumber)) {
  throw new Error(
    "Set BROVIM_NATIVE_DISPLAY to a dedicated :N Xvfb display, distinct from DISPLAY.",
  );
}
const root = Deno.env.get("BROVIM_EXTENSION_PATH") ||
  fileURLToPath(new URL("../../", import.meta.url));
const python = `
import ctypes as c, sys, time
x = c.CDLL('libX11.so.6')
t = c.CDLL('libXtst.so.6')
x.XOpenDisplay.argtypes = [c.c_char_p]
x.XOpenDisplay.restype = c.c_void_p
x.XDefaultRootWindow.argtypes = [c.c_void_p]
x.XDefaultRootWindow.restype = c.c_ulong
x.XQueryTree.argtypes = [c.c_void_p,c.c_ulong,c.POINTER(c.c_ulong),c.POINTER(c.c_ulong),c.POINTER(c.POINTER(c.c_ulong)),c.POINTER(c.c_uint)]
x.XFetchName.argtypes = [c.c_void_p,c.c_ulong,c.POINTER(c.c_char_p)]
x.XGetGeometry.argtypes = [c.c_void_p,c.c_ulong,c.POINTER(c.c_ulong),c.POINTER(c.c_int),c.POINTER(c.c_int),c.POINTER(c.c_uint),c.POINTER(c.c_uint),c.POINTER(c.c_uint),c.POINTER(c.c_uint)]
x.XSetInputFocus.argtypes = [c.c_void_p,c.c_ulong,c.c_int,c.c_ulong]
x.XStringToKeysym.argtypes = [c.c_char_p]
x.XStringToKeysym.restype = c.c_ulong
x.XKeysymToKeycode.argtypes = [c.c_void_p,c.c_ulong]
x.XKeysymToKeycode.restype = c.c_ubyte
x.XFlush.argtypes = [c.c_void_p]
x.XCloseDisplay.argtypes = [c.c_void_p]
x.XFree.argtypes = [c.c_void_p]
t.XTestFakeKeyEvent.argtypes = [c.c_void_p,c.c_uint,c.c_int,c.c_ulong]
d = x.XOpenDisplay(sys.argv[1].encode())
if not d: raise RuntimeError('Cannot open isolated X display')
for action in sys.argv[2:]:
    kind, key = action.split(':',1)
    if kind == 'sleep':
        x.XFlush(d)
        time.sleep(int(key)/1000)
    elif kind == 'focus':
        a,b,n = c.c_ulong(),c.c_ulong(),c.c_uint()
        children = c.POINTER(c.c_ulong)()
        x.XQueryTree(d,x.XDefaultRootWindow(d),c.byref(a),c.byref(b),c.byref(children),c.byref(n))
        found = False
        names = []
        for i in range(n.value):
            name = c.c_char_p()
            x.XFetchName(d,children[i],c.byref(name))
            title = name.value.decode(errors='replace') if name.value else ''
            root,px,py,w,h,border,depth = c.c_ulong(),c.c_int(),c.c_int(),c.c_uint(),c.c_uint(),c.c_uint(),c.c_uint()
            x.XGetGeometry(d,children[i],c.byref(root),c.byref(px),c.byref(py),c.byref(w),c.byref(h),c.byref(border),c.byref(depth))
            names.append((title,w.value,h.value))
            if w.value >= 640 and h.value >= 480:
                x.XSetInputFocus(d,children[i],1,0)
                found = True
            if name.value: x.XFree(name)
        x.XFree(children)
        if not found: raise RuntimeError('Native browser window not found: '+key+'; windows='+repr(names))
    else:
        code = x.XKeysymToKeycode(d,x.XStringToKeysym(key.encode()))
        if not code: raise RuntimeError('Unknown native key: '+key)
        if kind in ('down','tap'): t.XTestFakeKeyEvent(d,code,1,0)
        if kind in ('up','tap'): t.XTestFakeKeyEvent(d,code,0,0)
x.XFlush(d)
x.XCloseDisplay(d)
`;
async function keys(...actions) {
  const result = await new Deno.Command("python3", {
    args: ["-c", python, display, ...actions],
    stderr: "piped",
  }).output();
  if (!result.success) throw new Error(new TextDecoder().decode(result.stderr));
}
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
async function switcher(page) {
  // A selector observer can miss changes inside a newly attached shadow root. Inspect the actual
  // page DOM, then use its Puppeteer frame, as in the private/Firefox lifecycle tests.
  await page.waitForFunction(
    () =>
      [...document.documentElement.children].some((element) =>
        element.shadowRoot?.querySelector("iframe.tab-switcher-frame.vimium-ui-component-visible")
      ),
    { polling: 20, timeout: 5000 },
  );
  const frame = page.frames().find((frame) =>
    frame.url().includes("/pages/tab_switcher_page.html")
  );
  assert(frame, "Visible native switcher frame is missing");
  await frame.waitForSelector("#panel.ready .selected");
  return frame;
}
const pdf = `%PDF-1.1
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 144]>>endobj
trailer<</Root 1 0 R>>
%%EOF`;
const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen() {} }, (request) => {
  const { pathname, searchParams, port } = new URL(request.url);
  const title = searchParams.get("title") || "Native peer";
  if (pathname === "/document.pdf") {
    return new Response(pdf, { headers: { "content-type": "application/pdf" } });
  }
  // A slow network. Each response arrives after `late` ms, or never within the checks.
  const late = (response) => new Promise((resolve) => setTimeout(() => resolve(response()), 8000));
  const html = { headers: { "content-type": "text/html; charset=utf-8" } };
  if (pathname === "/unanswered") {
    // The server hasn't answered: the tab has no page yet.
    return late(() => new Response(`<!doctype html><title>${title}</title>`, html));
  }
  if (pathname === "/arriving") {
    // The first part of the page has arrived, and is drawn; the rest is on its way.
    const encoder = new TextEncoder();
    return new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(
            `<!doctype html><title>${title}</title><h1>${title}</h1>${
              "<p>Arrived</p>".repeat(200)
            }`,
          ));
          setTimeout(() => {
            try {
              controller.enqueue(encoder.encode("<p>The rest</p>"));
              controller.close();
            } catch { /* The tab was closed. */ }
          }, 8000);
        },
      }),
      html,
    );
  }
  if (pathname === "/blocked") {
    // The page waits for a script in its head, and the browser draws nothing until it comes.
    return new Response(
      `<!doctype html><title>${title}</title><script src="/late.js"></script><h1>${title}</h1>`,
      html,
    );
  }
  if (pathname === "/late.js") {
    return late(() => new Response("", { headers: { "content-type": "text/javascript" } }));
  }
  if (pathname === "/stalling") {
    // Like YouTube: the page's main thread stalls just as the shortcut arrives.
    return new Response(
      `<!doctype html><title>${title}</title><h1>${title}</h1><script>addEventListener("keydown", (event) => {
        if (event.key !== "Alt" || event.repeat) return;
        setTimeout(() => { const end = performance.now() + 700; while (performance.now() < end); }, 60);
      }, true)</script>`,
      { headers: { "content-type": "text/html" } },
    );
  }
  if (pathname === "/embedding") {
    // The frame is cross-origin (localhost in 127.0.0.1), like an embedded editor or video.
    return new Response(
      `<!doctype html><title>${title}</title><h1>${title}</h1><iframe src="http://localhost:${port}/embedded?title=Embedded" style="width:600px;height:300px"></iframe>`,
      { headers: { "content-type": "text/html" } },
    );
  }
  return new Response(
    `<!doctype html><title>${title}</title><h1>${title}</h1><input id="editor"><main style="height:5000px">Scrollable page</main>`,
    {
      headers: { "content-type": "text/html" },
    },
  );
});
const origin = `http://127.0.0.1:${server.addr.port}`;
const errors = [];
let browser;
const testProfile = await Deno.makeTempDir({ prefix: "brovim-native-" });
await Deno.mkdir(`${testProfile}/Default`);
// Free Alt+E using the checked-in Helium menu entry. Keep Ctrl+L for the address-bar fixture.
await Deno.writeTextFile(
  `${testProfile}/Default/Preferences`,
  JSON.stringify({
    helium: {
      browser: {
        custom_accelerators: {
          "40021": JSON.parse(await Deno.readTextFile(`${root}/helium/shortcuts.json`))["40021"],
        },
      },
    },
  }),
);
let passed = 0;
const pass = (name) => {
  passed++;
  console.log(`PASS ${name}`);
};
try {
  browser = await puppeteer.launch({
    executablePath: Deno.env.get("PUPPETEER_EXECUTABLE_PATH") || undefined,
    headless: false,
    enableExtensions: [root],
    userDataDir: testProfile,
    env: { ...Deno.env.toObject(), DISPLAY: display, WAYLAND_DISPLAY: "" },
    args: ["--ozone-platform=x11"],
    defaultViewport: { width: 1280, height: 900 },
  });
  browser.on("targetcreated", async (target) => {
    if (target.type() === "page") {
      (await target.page())?.on("pageerror", (error) => errors.push(error.message));
    }
  });
  const worker = await (await browser.waitForTarget((target) => target.type() === "service_worker"))
    .worker();
  await worker.evaluate(() => {
    globalThis.nativeCommands = 0;
    globalThis.nativeFocusCommands = 0;
    globalThis.nativeBrowserPageCommands = 0;
    chrome.commands.onCommand.addListener((command) => {
      if (command === "open_tab_switcher") nativeCommands++;
      if (command === "focus_page") nativeFocusCommands++;
      if (command === "open_browser_pages") nativeBrowserPageCommands++;
    });
  });
  // Exercise the browser's supported manual conflict resolution in this disposable profile.
  const shortcuts = await browser.newPage();
  await shortcuts.goto("chrome://extensions/shortcuts");
  await shortcuts.evaluate(async (extensionId) => {
    await chrome.developerPrivate.updateExtensionCommand({
      extensionId,
      commandName: "open_browser_pages",
      keybinding: "Alt+E",
    });
  }, await worker.evaluate(() => chrome.runtime.id));
  await until(
    () =>
      worker.evaluate(async () =>
        (await chrome.commands.getAll()).find((command) => command.name === "open_browser_pages")
          ?.shortcut === "Alt+E"
      ),
    "Manual Alt+E assignment did not take effect",
  );
  await shortcuts.close();
  const source = await browser.newPage();
  source.setDefaultTimeout(10000);
  await source.goto(`${origin}/source?title=Brovim%20Native%20Source`);
  await source.bringToFront();
  await keys("focus:Brovim Native Source");
  await keys("down:Alt_L", "tap:e", "up:Alt_L");
  await source.waitForFunction(
    () =>
      [...document.documentElement.children].some((element) =>
        element.shadowRoot?.querySelector("iframe.browser-pages-frame.vimium-ui-component-visible")
      ),
    { polling: 20 },
  );
  const browserPalette = source.frames().find((frame) =>
    frame.url().includes("/pages/browser_pages.html")
  );
  await browserPalette.waitForFunction(() =>
    document.hasFocus() && document.activeElement?.id === "search"
  );
  assert(
    await worker.evaluate(() => nativeBrowserPageCommands) >= 1,
    "Alt+E missed the native browser command",
  );
  await keys("tap:Escape");
  pass("Native Alt+E opens a focused palette on its first use");
  await keys("down:Control_L", "tap:l", "up:Control_L", "down:Alt_L", "tap:e", "up:Alt_L");
  const paletteTarget = await browser.waitForTarget((target) =>
    target.url().includes("/pages/browser_pages.html?tab=")
  );
  const standalonePalette = await paletteTarget.page();
  await standalonePalette.waitForFunction(() =>
    document.hasFocus() && document.activeElement?.id === "search"
  );
  await keys("tap:Escape");
  await until(
    () => Promise.resolve(standalonePalette.isClosed()),
    "Address-bar palette did not close",
  );
  pass("Native Alt+E from the address bar uses the focused temporary palette tab");
  for (let i = 0; i < 20; i++) {
    const peer = await browser.newPage();
    await peer.goto(`${origin}/peer-${i}?title=Native${i}`);
  }
  await source.bringToFront();
  await keys("focus:Brovim Native Source");
  await until(() => source.evaluate(() => document.hasFocus()), "Native source did not gain focus");
  await source.evaluate(() => document.querySelector("#editor").focus());
  await keys("tap:Escape");
  await until(
    () =>
      source.evaluate(() =>
        !document.activeElement.matches("input,textarea,[contenteditable=true]")
      ),
    "Escape did not leave the text editor",
  );
  await keys("tap:j");
  await until(
    () => source.evaluate(() => scrollY > 0),
    "Scrolling did not resume after Escape",
  );
  pass("Native Escape leaves the editor and resumes scrolling without a click");
  await source.evaluate(() => document.querySelector("#editor").focus());
  await keys("down:Alt_L", "tap:z", "up:Alt_L");
  await until(
    () => source.evaluate(() => document.activeElement === document.documentElement),
    "Alt+Z did not leave the text editor",
  );
  assert(
    await worker.evaluate(() => nativeFocusCommands) >= 1,
    "Recovery did not use the actual browser command",
  );
  pass("Native Alt+Z leaves text inputs without a custom page mapping");
  // Browsers refuse Alt+D as an extension shortcut (it focuses the address bar), so it is a page
  // mapping. The page must get the key first.
  await keys("down:Alt_L", "tap:d", "up:Alt_L");
  await source.waitForFunction(() => document.getElementById("brovim-dark-mode"));
  assert(await source.evaluate(() => document.hasFocus()), "Alt+D moved focus off the page");
  await keys("down:Alt_L", "tap:d", "up:Alt_L");
  await source.waitForFunction(() => !document.getElementById("brovim-dark-mode"));
  pass("Native Alt+D turns dark mode on and off");
  await keys("down:Alt_L", "tap:q");
  const frame = await switcher(source);

  assert(
    await worker.evaluate(() => nativeCommands) >= 1,
    "No actual browser command was delivered",
  );
  const ids = await frame.$$eval(".tab-card", (cards) => cards.map((card) => card.dataset.id));
  // Every awake tab is listed, so the count depends on which background tabs the browser has
  // frozen by now. The newest tabs are awake, and these few cards fit without paging.
  const titles = await frame.$$eval(".card-title", (els) => els.map((el) => el.textContent));
  assert(
    titles.includes("Native19") && titles.includes("Native18"),
    `The grid left out recent tabs: ${titles}`,
  );
  assert(
    await frame.$$eval(".tab-card[hidden]", (cards) => cards.length === 0),
    "Native opening paged instead of growing the grid",
  );
  pass("Native Alt+Q opens the grid through the browser accelerator");
  const started = performance.now();
  await keys(...Array(ids.length * 4 - 1).fill("tap:q"));
  await frame.waitForFunction(() =>
    document.querySelector(".selected").dataset.id ===
      document.querySelector(".tab-card").dataset.id
  );
  assert(
    JSON.stringify(
      await frame.$$eval(".tab-card", (cards) => cards.map((card) => card.dataset.id)),
    ) === JSON.stringify(ids),
    "Native cycling changed the grid",
  );
  console.log(
    `${ids.length * 4 - 1} native repeats: ${Math.round(performance.now() - started)} ms`,
  );
  pass("Rapid native repeats wrap in one fixed grid");
  await keys("tap:q", "down:Shift_L", "tap:q", "up:Shift_L");
  await frame.waitForFunction(() =>
    document.querySelector(".selected").dataset.id ===
      document.querySelector(".tab-card").dataset.id
  );
  assert(await frame.$("#panel.ready"), "Shift release committed the selection");
  await keys("tap:q");
  await frame.waitForFunction(
    (id) => document.querySelector(".selected").dataset.id === id,
    {},
    ids[1],
  );
  await keys("up:Alt_L");
  await until(
    () => worker.evaluate(async (id) => (await chrome.tabs.get(Number(id))).active, ids[1]),
    "Alt release did not commit",
  );
  pass("Shift reverses and Alt release commits the final selected tab");

  const activeTabId = () =>
    worker.evaluate(async () =>
      (await chrome.tabs.query({ active: true, currentWindow: true }))[0].id
    );
  // A tap of a human length: the modifier is released a moment after the letter.
  const tap = () => keys("down:Alt_L", "sleep:20", "tap:q", "sleep:50", "up:Alt_L");
  const gridVisible = (page) =>
    page.evaluate(() =>
      [...document.documentElement.children].some((element) =>
        element.shadowRoot?.querySelector("iframe.tab-switcher-frame.vimium-ui-component-visible")
      )
    );

  const typing = await browser.newPage();
  typing.setDefaultTimeout(5000);
  await typing.goto(`${origin}/typing?title=Typing`);
  await typing.bringToFront();
  await keys("focus:Typing");
  await until(() => typing.evaluate(() => document.hasFocus()), "Typing page did not gain focus");
  const typingId = await activeTabId();
  // A real click: Brovim takes the focus back from fields that focus themselves on a new page.
  await (await typing.$("#editor")).click();
  await typing.evaluate(() => {
    globalThis.gridSeen = false;
    const watch = () => {
      globalThis.gridSeen ||= [...document.documentElement.children].some((element) =>
        element.shadowRoot?.querySelector("iframe.tab-switcher-frame.vimium-ui-component-visible")
      );
      requestAnimationFrame(watch);
    };
    watch();
  });
  const typed = (text) =>
    until(
      () => typing.evaluate((text) => document.querySelector("#editor").value === text, text),
      `The text field did not receive "${text}"`,
    );
  await keys("tap:a");
  await typed("a");
  await tap();
  await until(async () => await activeTabId() !== typingId, "A quick tap did not switch tabs");
  assert(!await typing.evaluate(() => gridSeen), "A quick tap flashed the grid");
  await tap();
  await until(async () => await activeTabId() === typingId, "A second tap did not switch back");
  await keys("tap:b");
  await typed("ab");
  pass("Native quick taps never show the grid, and typing continues after switching back");
  await keys("down:Alt_L", "tap:q");
  await switcher(typing);
  await keys("tap:Escape", "up:Alt_L");
  await until(async () => !await gridVisible(typing), "Escape did not close the grid");
  await keys("tap:c");
  await typed("abc");
  await keys("down:Alt_L", "tap:q");
  await switcher(typing);
  await keys("up:Alt_L");
  await until(async () => await activeTabId() !== typingId, "Releasing Alt did not switch tabs");
  await tap();
  await until(async () => await activeTabId() === typingId, "A tap did not return to the page");
  await keys("tap:d");
  await typed("abcd");
  pass("Native held grid returns the focus to the text field, cancelled or committed");

  const embedding = await browser.newPage();
  embedding.setDefaultTimeout(5000);
  await embedding.goto(`${origin}/embedding?title=Embedding`);
  await embedding.bringToFront();
  await keys("focus:Embedding");
  const embeddingId = await activeTabId();
  const embedded = embedding.frames().find((frame) => frame.url().includes("/embedded"));
  const typingInFrame = () =>
    embedded.evaluate(() => document.hasFocus() && document.activeElement?.id === "editor");
  await (await embedded.$("#editor")).click();
  await until(typingInFrame, "The embedded text field did not gain focus");
  await keys("down:Alt_L", "tap:q");
  const embeddingGrid = await switcher(embedding);
  const embeddingTarget = Number(
    await embeddingGrid.$eval(".selected", (card) => card.dataset.id),
  );
  assert(embeddingTarget === typingId, "The grid over an embedded page chose the wrong tab");
  await keys("up:Alt_L");
  await until(
    async () => await activeTabId() === typingId,
    "Releasing Alt over an embedded page did not switch tabs",
  );
  await tap();
  await until(async () => await activeTabId() === embeddingId, "A tap did not return");
  await until(typingInFrame, "The embedded text field lost the focus to the grid");
  pass("Native held Alt+Q while typing in an embedded page shows the grid and gives focus back");
  await tap();
  await until(
    async () => await activeTabId() === typingId,
    "A quick tap inside an embedded page did not switch tabs",
  );
  assert(!await gridVisible(embedding), "A quick tap inside an embedded page left a grid open");
  pass("Native quick Alt+Q while typing in an embedded page switches tabs");

  const stalling = await browser.newPage();
  stalling.setDefaultTimeout(5000);
  await stalling.goto(`${origin}/stalling?title=Stalling`);
  await stalling.bringToFront();
  await keys("focus:Stalling");
  await until(() => stalling.evaluate(() => document.hasFocus()), "Stalling page has no focus");
  const stallingId = await activeTabId();
  // Twice: one slow answer must not cost the page its grid for good.
  for (let round = 0; round < 2; round++) {
    await keys("down:Alt_L", "sleep:50", "tap:q");
    await switcher(stalling);
    assert(
      await activeTabId() === stallingId,
      "A held shortcut on a stalling page switched tabs instead of showing the grid",
    );
    await keys("tap:Escape", "up:Alt_L");
    await until(async () => !await gridVisible(stalling), "Escape did not close the grid");
  }
  pass("Native held Alt+Q on a page that stalls waits for it and shows the grid, every time");
  await tap();
  await until(
    async () => await activeTabId() !== stallingId,
    "A quick tap on a stalling page did not switch tabs",
  );
  assert(!await gridVisible(stalling), "A quick tap on a stalling page left a grid open");
  pass("Native quick Alt+Q on a page that stalls switches once the page answers");

  const document = await browser.newPage();
  await document.goto(`${origin}/document.pdf`);
  await document.bringToFront();
  await keys("focus:document.pdf");
  const documentId = await activeTabId();
  // The PDF viewer keeps its keys: Brovim can't see the release, so every press switches.
  await new Promise((resolve) => setTimeout(resolve, 500));
  await keys("down:Alt_L", "tap:q");
  await until(
    async () => await activeTabId() !== documentId,
    "Alt+Q on a PDF did not switch tabs",
  );
  await keys("up:Alt_L");
  pass("Native Alt+Q on a PDF switches tabs directly");
  await document.close();

  // A slow network. Whether or not a loading tab can show the grid, holding the shortcut shows it.
  const loading = (path) =>
    worker.evaluate(async (url) => (await chrome.tabs.create({ url })).id, `${origin}${path}`);
  const loadingGrid = (tabId) =>
    worker.evaluate(async (tabId) => {
      const visible = chrome.scripting.executeScript({
        target: { tabId },
        injectImmediately: true,
        func: () => {
          const ui = globalThis.TabSwitcher?.tabSwitcherUI;
          return !!ui?.showing &&
            ui.iframeElement.classList.contains("vimium-ui-component-visible");
        },
      }).then(([frame]) => frame.result, () => false);
      return await Promise.race([visible, new Promise((r) => setTimeout(() => r(false), 300))]);
    }, tabId);
  const removeTab = (tabId) => worker.evaluate((tabId) => chrome.tabs.remove(tabId), tabId);
  await typing.bringToFront();
  await keys("focus:Typing");
  const unanswered = await loading("/unanswered?title=Unanswered");
  await new Promise((resolve) => setTimeout(resolve, 500));
  assert(
    await worker.evaluate(async (id) => (await chrome.tabs.get(id)).url === "", unanswered),
    "The unanswered tab already has a page",
  );
  // No page can show the grid here: it shows on the previous tab, and Escape comes back.
  await keys("down:Alt_L", "tap:q");
  await until(
    async () => await activeTabId() === typingId,
    "Holding Alt+Q on an unanswered tab did not move to the previous tab",
  );
  const handedOff = await switcher(typing);
  assert(
    Number(await handedOff.$eval(".selected", (card) => card.dataset.id)) === typingId,
    "The handed-off grid did not select the previous tab",
  );
  await keys("tap:Escape", "up:Alt_L");
  await until(
    async () => await activeTabId() === unanswered,
    "Escape did not return to the unanswered tab",
  );
  pass(
    "Native held Alt+Q on a tab whose server hasn't answered shows the grid on the previous tab",
  );
  await typing.evaluate(() => globalThis.gridSeen = false);
  await tap();
  await until(
    async () => await activeTabId() === typingId,
    "A quick tap on an unanswered tab did not switch to the previous tab",
  );
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert(
    !await typing.evaluate(() => gridSeen),
    "A quick tap on an unanswered tab showed the grid",
  );
  pass("Native quick Alt+Q on a tab whose server hasn't answered switches without a grid");
  await removeTab(unanswered);

  const arriving = await loading("/arriving?title=Arriving");
  await until(
    () =>
      worker.evaluate(async (id) => {
        const tab = await chrome.tabs.get(id);
        return tab.url !== "" && tab.status === "loading";
      }, arriving),
    "The arriving page did not start",
  );
  await new Promise((resolve) => setTimeout(resolve, 500));
  await keys("down:Alt_L", "tap:q");
  await until(() => loadingGrid(arriving), "Holding Alt+Q on a page still arriving showed no grid");
  assert(await activeTabId() === arriving, "Holding Alt+Q on a page still arriving left it");
  await keys("tap:Escape", "up:Alt_L");
  pass("Native held Alt+Q on a page still arriving shows the grid on it");
  await removeTab(arriving);

  await typing.bringToFront();
  const blocked = await loading("/blocked?title=Blocked");
  await new Promise((resolve) => setTimeout(resolve, 800));
  await keys("down:Alt_L", "tap:q");
  await until(
    async () => await activeTabId() === typingId,
    "Holding Alt+Q on a page drawing nothing did not move to the previous tab",
  );
  await switcher(typing);
  await keys("up:Alt_L");
  await until(async () => !await gridVisible(typing), "Releasing Alt left the grid open");
  assert(await activeTabId() === typingId, "Releasing Alt did not keep the selected tab");
  pass("Native held Alt+Q on a page waiting for a script shows the grid on the previous tab");
  await removeTab(blocked);

  const protectedPage = await browser.newPage();
  await protectedPage.goto("chrome://version/");
  await protectedPage.bringToFront();
  const snapshot = await worker.evaluate(async () => {
    const tab = (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
    return await sendRequestHandlers.getOpenTabsWithScreenshots({ tab, includeScreenshots: false });
  });
  await keys("focus:Version", "down:Alt_L", "tap:q");
  await until(
    () => worker.evaluate(async (id) => (await chrome.tabs.get(id)).active, snapshot[1].id),
    "Protected-page accelerator did not switch",
  );
  const destination = (await browser.pages()).find((page) => page.url() === snapshot[1].url);
  destination.setDefaultTimeout(5000);
  await keys("tap:q");
  const carried = await switcher(destination);
  await carried.waitForFunction(
    (id) => document.querySelector("#panel.ready .selected")?.dataset.id === String(id),
    {},
    snapshot[2].id,
  );
  await keys("tap:q");
  await carried.waitForFunction(
    (id) => document.querySelector(".selected")?.dataset.id === String(id),
    {},
    snapshot[3].id,
  );
  await keys("up:Alt_L");
  await until(
    () => worker.evaluate(async (id) => (await chrome.tabs.get(id)).active, snapshot[3].id),
    "Protected handoff lost the final selection",
  );
  pass("Native protected-page handoff continues beyond two tabs and commits correctly");
  await browser.close();
  browser = await puppeteer.launch({
    executablePath: Deno.env.get("PUPPETEER_EXECUTABLE_PATH") || undefined,
    headless: false,
    enableExtensions: [root],
    userDataDir: testProfile,
    env: { ...Deno.env.toObject(), DISPLAY: display, WAYLAND_DISPLAY: "" },
    args: ["--ozone-platform=x11", "--extensions-on-chrome-urls"],
    defaultViewport: { width: 1280, height: 900 },
  });
  browser.on("targetcreated", async (target) => {
    if (target.type() === "page") {
      (await target.page())?.on("pageerror", (error) => errors.push(error.message));
    }
  });
  const internalWorker = await (await browser.waitForTarget((target) =>
    target.type() === "service_worker"
  )).worker();
  await internalWorker.evaluate(() => Settings.onLoaded());
  const internalPage = await browser.newPage();
  internalPage.setDefaultTimeout(5000);
  await internalPage.goto("chrome://extensions/");
  const internalId = await internalWorker.evaluate(async () =>
    (await chrome.tabs.query({ active: true, currentWindow: true }))[0].id
  );
  for (let i = 0; i < 2; i++) {
    await internalWorker.evaluate(
      (url) => chrome.tabs.create({ url, pinned: true }),
      `${origin}/internal-peer-${i}`,
    );
  }
  const readyInternal = (id) =>
    until(() =>
      internalWorker.evaluate(async (tabId) => {
        try {
          const [state] = await chrome.scripting.executeScript({
            target: { tabId },
            func: () =>
              !!globalThis.brovimContentScriptsLoaded && typeof normalMode !== "undefined",
          });
          return state?.result;
        } catch {
          return false;
        }
      }, id), "Internal-page content scripts did not initialize");
  await readyInternal(internalId);
  const previousInternal = () =>
    internalWorker.evaluate(async (id) => {
      const tab = await chrome.tabs.get(id);
      return (await sendRequestHandlers.getOpenTabsWithScreenshots({
        tab,
        includeScreenshots: false,
      })).find((candidate) => candidate.id !== id).id;
    }, internalId);
  await internalPage.bringToFront();
  const heldTarget = await previousInternal();
  await keys("focus:Extensions", "down:Alt_L", "tap:q");
  const internalGrid = await switcher(internalPage);
  assert(
    await internalWorker.evaluate(async (id) => (await chrome.tabs.get(id)).active, internalId),
    "Holding Alt switched before release",
  );
  assert(
    Number(await internalGrid.$eval(".selected", (card) => card.dataset.id)) === heldTarget,
    "Extensions grid selected the wrong tab",
  );
  await keys("up:Alt_L");
  await until(
    () => internalWorker.evaluate(async (id) => (await chrome.tabs.get(id)).active, heldTarget),
    "Extensions grid did not switch on Alt release",
  );
  pass("Native held Alt+Q on Extensions shows the grid and release selects without another press");
  for (const cold of [false, true]) {
    await internalPage.bringToFront();
    if (cold) {
      await internalPage.reload();
      await readyInternal(internalId);
    }
    const targetId = await previousInternal();
    // Keys sent before the reloaded page has the focus would reach the browser but not the page.
    // With no window manager on the test display, the focus can take a few tries.
    await internalPage.bringToFront();
    for (let attempt = 0;; attempt++) {
      await keys("focus:Extensions");
      await new Promise((resolve) => setTimeout(resolve, 100));
      if (await internalPage.evaluate(() => document.hasFocus())) break;
      assert(attempt < 30, "Extensions did not gain focus");
    }
    await keys("down:Alt_L", "tap:q", "up:Alt_L");
    await until(
      () => internalWorker.evaluate(async (id) => (await chrome.tabs.get(id)).active, targetId),
      "Quick Extensions Alt+Q did not switch automatically",
    );
    pass(
      `Native quick Alt+Q on ${
        cold ? "freshly reloaded" : "warm"
      } Extensions switches automatically`,
    );
  }
  // Ctrl+T leaves the focus in the address bar, where no page sees the keys.
  await internalPage.bringToFront();
  await keys("focus:Extensions");
  const activeInternalId = () =>
    internalWorker.evaluate(async () =>
      (await chrome.tabs.query({ active: true, currentWindow: true }))[0].id
    );
  await keys("down:Control_L", "tap:t", "up:Control_L");
  await until(async () => await activeInternalId() !== internalId, "Ctrl+T opened no tab");
  const newTabId = await activeInternalId();
  const newTab = (await browser.pages()).find((page) => page.url().startsWith("chrome://new"));
  assert(newTab, "The new tab page is missing");
  // Its scripts load after the tab opens.
  await new Promise((resolve) => setTimeout(resolve, 800));
  await keys("down:Alt_L", "sleep:20", "tap:q", "sleep:50", "up:Alt_L");
  await until(
    async () => await activeInternalId() === internalId,
    "Quick Alt+Q from a new tab's address bar did not switch back",
  );
  assert(
    !await newTab.evaluate(() =>
      [...document.documentElement.children].some((element) =>
        element.shadowRoot?.querySelector("iframe.tab-switcher-frame.vimium-ui-component-visible")
      )
    ),
    "A grid was left open on the new tab",
  );
  await internalWorker.evaluate((id) => chrome.tabs.remove(id), newTabId);
  pass("Native quick Alt+Q from a new tab's address bar switches back and leaves no grid");
  await internalWorker.evaluate(() => Settings.set("enableInternalPages", false));
  await internalPage.bringToFront();
  const disabledTarget = await previousInternal();
  await keys("focus:Extensions", "down:Alt_L", "tap:q");
  await switcher(internalPage);
  await keys("up:Alt_L");
  await until(
    () => internalWorker.evaluate(async (id) => (await chrome.tabs.get(id)).active, disabledTarget),
    "Browser-page option disabled the universal switcher",
  );
  assert(
    await internalWorker.evaluate(() => Settings.get("enableInternalPages")) === false,
    "Switcher changed the normal browser-page setting",
  );
  pass(
    "Native Extensions switcher works with browser-page mappings off and keeps their setting unchanged",
  );
  assert(errors.length === 0, errors.join("\n"));
  pass("No uncaught errors in native shortcut fixture pages");
} finally {
  await keys("up:q", "up:Shift_L", "up:Alt_L").catch(() => {});
  await browser?.close();
  await Deno.remove(testProfile, { recursive: true });
  await server.shutdown();
}
console.log(`Native shortcut checks: ${passed} passed`);
