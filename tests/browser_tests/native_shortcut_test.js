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
const wakingPages = new Set();
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
  if (pathname === "/waking") {
    // A tab woken from sleep loads its page again; this time the server takes its time.
    const key = searchParams.get("id");
    const fresh = { headers: { ...html.headers, "cache-control": "no-store" } };
    if (wakingPages.has(key)) {
      return late(() => new Response(`<!doctype html><title>${title}</title>`, fresh));
    }
    wakingPages.add(key);
    return new Response(`<!doctype html><title>${title}</title><h1>${title}</h1>`, fresh);
  }
  if (pathname === "/heavy") {
    // A heavy page loading: its scripts stay busy in long tasks for seconds.
    return new Response(
      `<!doctype html><title>${title}</title><h1>${title}</h1><script>const start = performance.now();
      (function work() {
        const end = performance.now() + 300;
        while (performance.now() < end);
        if (performance.now() - start < 9000) setTimeout(work, 2);
      })();</script>`,
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
    // Like YouTube while it loads: the page's main thread stalls for `ms` from the moment the
    // modifier goes down, so it is still stalled when the shortcut arrives.
    const ms = Number(searchParams.get("ms") || 1200);
    return new Response(
      `<!doctype html><title>${title}</title><h1>${title}</h1><script>addEventListener("keydown", (event) => {
        if (event.key !== "Alt" || event.repeat) return;
        setTimeout(() => { const end = performance.now() + ${ms}; while (performance.now() < end); });
      }, true)</script>`,
      { headers: { "content-type": "text/html" } },
    );
  }
  if (pathname === "/busy-under-grid") {
    // Like a page still loading: its scripts get busy for 5 s once the switcher's grid shows.
    return new Response(
      `<!doctype html><title>${title}</title><h1>${title}</h1><script>new MutationObserver(() => {
        for (const host of document.documentElement.children) {
          const frame = host.shadowRoot?.querySelector("iframe.tab-switcher-frame");
          if (!frame || frame.watched) continue;
          frame.watched = true;
          new MutationObserver(() => {
            if (!frame.classList.contains("vimium-ui-component-visible") || frame.stalled) return;
            frame.stalled = true;
            setTimeout(() => { const end = performance.now() + 5000; while (performance.now() < end); });
          }).observe(frame, { attributes: true });
        }
      }).observe(document.documentElement, { childList: true })</script>`,
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
  // Chromium can supersede the first navigations while it installs the extension, or hold them past
  // the timeout; so does the last commit, in about a third of launches.
  for (let attempt = 1;; attempt++) {
    try {
      await source.goto(`${origin}/source?title=Brovim%20Native%20Source`);
      break;
    } catch (error) {
      if (attempt === 4 || !/net::ERR_ABORTED|Navigation timeout/.test(error.message)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
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

  // A page frozen for 1.2 s from the moment Alt goes down: the press switches at once.
  const stalling = await browser.newPage();
  stalling.setDefaultTimeout(5000);
  await stalling.goto(`${origin}/stalling?title=Stalling&ms=1200`);
  await stalling.bringToFront();
  await keys("focus:Stalling");
  await until(() => stalling.evaluate(() => document.hasFocus()), "Stalling page has no focus");
  const stallingId = await activeTabId();
  // Hold: the previous tab shows the grid once the frozen page confirms the hold; Escape returns.
  // Twice: one slow answer must not cost the page anything.
  for (let round = 0; round < 2; round++) {
    const held = performance.now();
    await keys("down:Alt_L", "sleep:50", "tap:q");
    await until(
      async () => await activeTabId() === typingId,
      "Holding Alt+Q on a frozen page did not switch tabs",
    );
    assert(
      performance.now() - held < 1000,
      `Holding Alt+Q on a frozen page waited for it: ${Math.round(performance.now() - held)} ms`,
    );
    await switcher(typing);
    await keys("tap:Escape", "up:Alt_L");
    await until(
      async () => await activeTabId() === stallingId,
      "Escape did not return to the frozen page",
    );
    await until(async () => !await gridVisible(typing), "Escape did not close the grid");
    // Let the page's freeze from this round end.
    await new Promise((resolve) => setTimeout(resolve, 1300));
  }
  pass("Native held Alt+Q on a frozen page switches at once, and the previous tab shows the grid");
  // Tap: it switches before the freeze ends, and no grid shows anywhere.
  await typing.evaluate(() => globalThis.gridSeen = false);
  const tapped = performance.now();
  await tap();
  await until(
    async () => await activeTabId() === typingId,
    "A quick tap on a frozen page did not switch tabs",
  );
  assert(
    performance.now() - tapped < 1000,
    `A quick tap on a frozen page waited for it: ${Math.round(performance.now() - tapped)} ms`,
  );
  await new Promise((resolve) => setTimeout(resolve, 1500));
  assert(!await typing.evaluate(() => gridSeen), "A quick tap on a frozen page showed the grid");
  assert(!await gridVisible(stalling), "A quick tap on a frozen page left a grid open");
  pass("Native quick Alt+Q on a frozen page switches before the freeze ends");
  // A page busy for a moment when the shortcut comes doesn't hold it up either: a hold moves to
  // the previous tab, which shows the grid at once, and Escape comes back.
  await stalling.goto(`${origin}/stalling?title=Stalling&ms=100`);
  await stalling.bringToFront();
  await keys("focus:Stalling");
  await until(() => stalling.evaluate(() => document.hasFocus()), "Stalling page has no focus");
  const momentPress = performance.now();
  await keys("down:Alt_L", "sleep:50", "tap:q");
  await switcher(typing);
  assert(
    performance.now() - momentPress < 1000,
    `The grid waited for a busy page: ${Math.round(performance.now() - momentPress)} ms`,
  );
  await keys("tap:Escape", "up:Alt_L");
  await until(async () => await activeTabId() === stallingId, "Escape did not return");
  await until(async () => !await gridVisible(typing), "Escape did not close the grid");
  pass("Native held Alt+Q on a page busy for a moment shows the grid at once, on the previous tab");
  // A page whose scripts get busy once the grid shows, as a loading page's do: the grid still
  // moves, and the release still switches, without waiting for the page.
  await stalling.goto(`${origin}/busy-under-grid?title=Busy`);
  await stalling.bringToFront();
  await keys("focus:Busy");
  await until(() => stalling.evaluate(() => document.hasFocus()), "Busy page has no focus");
  const busyPress = performance.now();
  await keys("down:Alt_L", "sleep:50", "tap:q");
  const busyGrid = await stalling.waitForFrame((frame) =>
    frame.url().includes("/pages/tab_switcher_page.html")
  );
  await busyGrid.waitForSelector("#panel.ready .selected");
  const busySelection = () =>
    busyGrid.evaluate(() => document.querySelector(".selected").dataset.id);
  for (const key of ["q", "l"]) {
    const before = await busySelection();
    await keys(`tap:${key}`);
    await busyGrid.waitForFunction(
      (id) => document.querySelector(".selected").dataset.id !== id,
      {},
      before,
    );
  }
  const busyTarget = Number(await busySelection());
  await keys("up:Alt_L");
  await until(
    async () => await activeTabId() === busyTarget,
    "Releasing Alt on a busy page did not switch",
  );
  assert(
    performance.now() - busyPress < 4000,
    `The grid on a busy page waited for it: ${Math.round(performance.now() - busyPress)} ms`,
  );
  // The next check's previous tab.
  await stalling.bringToFront();
  await keys("focus:Busy");
  await until(() => stalling.evaluate(() => document.hasFocus()), "Busy page has no focus");
  pass("Native Alt+Q and hjkl move the grid while its page is busy");

  const document = await browser.newPage();
  await document.goto(`${origin}/document.pdf`);
  await document.bringToFront();
  await keys("focus:document.pdf");
  // The PDF viewer keeps its keys: a press switches to the previous tab, which shows the grid
  // while the shortcut is held.
  await new Promise((resolve) => setTimeout(resolve, 500));
  await keys("down:Alt_L", "tap:q");
  await until(
    async () => await activeTabId() === stallingId,
    "Alt+Q on a PDF did not move to the previous tab",
  );
  await switcher(stalling);
  await keys("up:Alt_L");
  // Release selects the tab it moved to; let that settle before the next check.
  await until(async () => !await gridVisible(stalling), "Releasing Alt left the grid open");
  pass("Native held Alt+Q on a PDF shows the grid on the previous tab");
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

  // Tabs that can't answer when the shortcut comes: a hold shows the grid on the previous tab at
  // once and Escape comes back; a tap switches at once, with no grid.
  const holdAndTap = async (name, tabId) => {
    const held = performance.now();
    await keys("down:Alt_L", "tap:q");
    await until(
      async () => await activeTabId() === typingId,
      `Holding Alt+Q on ${name} did not move to the previous tab`,
    );
    await switcher(typing);
    assert(
      performance.now() - held < 1000,
      `The grid for ${name} came late: ${Math.round(performance.now() - held)} ms`,
    );
    await keys("tap:Escape", "up:Alt_L");
    await until(async () => await activeTabId() === tabId, `Escape did not return to ${name}`);
    await until(async () => !await gridVisible(typing), "Escape did not close the grid");
    await typing.evaluate(() => globalThis.gridSeen = false);
    const tapped = performance.now();
    await tap();
    await until(
      async () => await activeTabId() === typingId,
      `A quick tap on ${name} did not switch`,
    );
    assert(
      performance.now() - tapped < 1000,
      `A quick tap on ${name} waited: ${Math.round(performance.now() - tapped)} ms`,
    );
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert(!await typing.evaluate(() => gridSeen), `A quick tap on ${name} showed the grid`);
  };
  // A tab woken from sleep, its page on its way back: nothing in it can see the keys yet.
  await typing.bringToFront();
  await keys("focus:Typing");
  const sleeper = await worker.evaluate(
    async (url) => (await chrome.tabs.create({ url, active: false })).id,
    `${origin}/waking?title=Waking&id=native`,
  );
  await until(
    () => worker.evaluate(async (id) => (await chrome.tabs.get(id)).status === "complete", sleeper),
    "The page to put to sleep did not load",
  );
  const woken = await worker.evaluate(async (id) => (await chrome.tabs.discard(id)).id, sleeper);
  await worker.evaluate((id) => chrome.tabs.update(id, { active: true }), woken);
  await new Promise((resolve) => setTimeout(resolve, 500));
  assert(
    await worker.evaluate(async (id) => (await chrome.tabs.get(id)).status === "loading", woken),
    "The woken tab already has its page",
  );
  await holdAndTap("a tab waking from sleep", woken);
  pass("Native Alt+Q on a tab waking from sleep: a hold shows the grid, a tap switches at once");
  await removeTab(woken);
  // A heavy page still loading, its scripts busy in long tasks.
  await typing.bringToFront();
  await keys("focus:Typing");
  const heavy = await loading("/heavy?title=Heavy");
  await until(
    () => worker.evaluate(async (id) => (await chrome.tabs.get(id)).url !== "", heavy),
    "The heavy page did not start",
  );
  await new Promise((resolve) => setTimeout(resolve, 700));
  await holdAndTap("a heavy page loading", heavy);
  pass("Native Alt+Q on a busy loading page: a hold shows the grid, a tap switches at once");
  await removeTab(heavy);

  // A grid leaves the page before the switch: the browser shows a tab's last frame for a moment
  // when you come back to it.
  await typing.bringToFront();
  await keys("focus:Typing");
  await until(() => typing.evaluate(() => document.hasFocus()), "Typing page did not gain focus");
  await typing.evaluate(() => {
    globalThis.gridHiddenAt = 0;
    for (const host of document.documentElement.children) {
      const frame = host.shadowRoot?.querySelector("iframe.tab-switcher-frame");
      if (!frame) continue;
      new MutationObserver(() => {
        if (!frame.classList.contains("vimium-ui-component-visible")) {
          globalThis.gridHiddenAt ||= Date.now();
        }
      }).observe(frame, { attributes: true });
    }
  });
  await keys("down:Alt_L", "tap:q");
  await switcher(typing);
  await keys("tap:q");
  await worker.evaluate(() => {
    globalThis.switchedAt = 0;
    chrome.tabs.onActivated.addListener(() => globalThis.switchedAt ||= Date.now());
  });
  await keys("up:Alt_L");
  await until(async () => await activeTabId() !== typingId, "Releasing Alt did not switch");
  const [hiddenAt, switchedAt] = [
    await typing.evaluate(() => globalThis.gridHiddenAt),
    await worker.evaluate(() => globalThis.switchedAt),
  ];
  assert(
    hiddenAt && hiddenAt <= switchedAt,
    `The grid left the page ${hiddenAt - switchedAt} ms after the switch`,
  );
  pass("Native release hides the grid before switching tabs");

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
  // Two tabs Brovim can't run on, one after the other: neither sees Alt go up. Taps a moment
  // apart flip between them; quick presses while holding walk on through the list.
  const versionId = await worker.evaluate(async () =>
    (await chrome.tabs.query({ url: "chrome://version/" }))[0].id
  );
  const urlsPage = await browser.newPage();
  await urlsPage.goto("chrome://chrome-urls/");
  await protectedPage.bringToFront();
  await urlsPage.bringToFront();
  await keys("focus:Chrome URLs");
  const urlsId = await activeTabId();
  await tap();
  await until(async () => await activeTabId() === versionId, "A tap did not reach Version");
  await new Promise((resolve) => setTimeout(resolve, 700));
  await tap();
  await until(
    async () => await activeTabId() === urlsId,
    "A second tap a moment later did not flip back between two protected pages",
  );
  pass("Native taps flip between two pages Brovim can't run on");
  await new Promise((resolve) => setTimeout(resolve, 700));
  await keys("down:Alt_L", "sleep:20", "tap:q", "sleep:150", "tap:q", "sleep:50", "up:Alt_L");
  await new Promise((resolve) => setTimeout(resolve, 600));
  const walked = await activeTabId();
  assert(
    walked !== urlsId && walked !== versionId,
    "Quick presses while holding did not walk on through the list",
  );
  pass("Native quick presses while holding walk on from two pages Brovim can't run on");
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
  // As a person does it: a moment after focusing, the modifier a moment before the letter.
  await keys("focus:Extensions", "sleep:100", "down:Alt_L", "sleep:30", "tap:q");
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
  await keys("focus:Extensions", "sleep:100", "down:Alt_L", "sleep:30", "tap:q");
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
  // Alt+X is a browser shortcut, so it closes tabs whose pages keep their keys too: a PDF, an error
  // page, a page's source, and New Tab, which starts with the focus in the address bar.
  for (
    const url of [
      `${origin}/closing?title=Closing`,
      `${origin}/document.pdf`,
      "http://127.0.0.1:9/",
      `view-source:${origin}/source`,
      "chrome://newtab/",
    ]
  ) {
    const id = await internalWorker.evaluate(
      async (url) => (await chrome.tabs.create({ url, active: true })).id,
      url,
    );
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await keys("down:Alt_L", "tap:x", "up:Alt_L");
    await until(
      () => internalWorker.evaluate((id) => chrome.tabs.get(id).then(() => false, () => true), id),
      `Alt+X did not close ${url}`,
    );
  }
  pass("Native Alt+X closes web pages, PDFs, error pages, page sources and New Tab");
  // A held Alt+X repeats, and each tab that comes forward would close in turn: it closes one. The
  // tab that comes forward sees the key go up, so a new press right after closes that one.
  const exists = (id) =>
    internalWorker.evaluate((id) => chrome.tabs.get(id).then(() => true, () => false), id);
  const open = (url) =>
    internalWorker.evaluate(
      async (url) => (await chrome.tabs.create({ url, active: true })).id,
      url,
    );
  const brovimRunning = (id) =>
    internalWorker.evaluate((id) =>
      chrome.scripting.executeScript({
        target: { tabId: id, frameIds: [0] },
        func: () => document.hasFocus() && typeof normalMode !== "undefined" && !!normalMode,
      }).then(([state]) => state?.result, () => false), id);
  const keep = await open(`${origin}/keep?title=Keep`);
  const held = await open(`${origin}/held?title=Held`);
  await until(() => brovimRunning(held), "Brovim did not start on the tab to close");
  // A second after the last Alt+X: no page saw that one's key go up.
  await new Promise((resolve) => setTimeout(resolve, 1000));
  await keys("down:Alt_L", "down:x", "sleep:1500", "up:x", "up:Alt_L");
  await until(async () => !await exists(held), "A held Alt+X did not close its tab");
  assert(await exists(keep), "A held Alt+X closed the next tab too");
  await keys("down:Alt_L", "tap:x", "up:Alt_L");
  await until(async () => !await exists(keep), "Alt+X right after a held one closed nothing");
  pass("Native held Alt+X closes one tab, and the next press closes the next");
  // Alt+X while the grid shows closes the selected card's tab, once however long it is held, and
  // leaves the tab under the grid.
  await open(`${origin}/peer-a?title=PeerA`);
  await open(`${origin}/peer-b?title=PeerB`);
  const hostUrl = `${origin}/host?title=Host`;
  const host = await open(hostUrl);
  const hostPage = await (await browser.waitForTarget((target) => target.url() === hostUrl)).page();
  await until(() => brovimRunning(host), "Brovim did not start under the grid");
  const tabCount = () => internalWorker.evaluate(async () => (await chrome.tabs.query({})).length);
  const before = await tabCount();
  await new Promise((resolve) => setTimeout(resolve, 1000));
  await keys("down:Alt_L", "sleep:30", "tap:q");
  const grid = await switcher(hostPage);
  const selected = Number(await grid.$eval(".selected", (card) => card.dataset.id));
  assert(selected !== host, "The grid selected its own tab");
  await keys("down:x", "sleep:1500", "up:x");
  await until(async () => !await exists(selected), "Alt+X did not close the selected card's tab");
  assert(await tabCount() === before - 1, "A held Alt+X in the grid closed more than one tab");
  assert(await exists(host), "Alt+X closed the tab under the grid");
  await keys("up:Alt_L");
  pass("Native Alt+X in the grid closes the selected card once, however long it is held");
  // A held X reopens one tab: each reopen needs a new press.
  await until(
    async () =>
      brovimRunning(
        await internalWorker.evaluate(async () =>
          (await chrome.tabs.query({ active: true, currentWindow: true }))[0].id
        ),
      ),
    "Brovim did not start on the tab to reopen from",
  );
  const beforeReopen = await tabCount();
  await keys("down:Shift_L", "down:x", "sleep:1500", "up:x", "up:Shift_L");
  await until(async () => await tabCount() === beforeReopen + 1, "A held X reopened nothing");
  await new Promise((resolve) => setTimeout(resolve, 500));
  assert(await tabCount() === beforeReopen + 1, "A held X reopened more than one tab");
  pass("Native held X reopens one tab");
  assert(errors.length === 0, errors.join("\n"));
  pass("No uncaught errors in native shortcut fixture pages");
} finally {
  await keys("up:q", "up:Shift_L", "up:Alt_L").catch(() => {});
  await browser?.close();
  await Deno.remove(testProfile, { recursive: true });
  await server.shutdown();
}
console.log(`Native shortcut checks: ${passed} passed`);
