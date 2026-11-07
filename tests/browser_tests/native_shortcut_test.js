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
import ctypes as c, sys
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
    if kind == 'focus':
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
const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen() {} }, (request) => {
  const title = new URL(request.url).searchParams.get("title") || "Native peer";
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
    chrome.commands.onCommand.addListener((command) => {
      if (command === "open_tab_switcher") nativeCommands++;
      if (command === "focus_page") nativeFocusCommands++;
    });
  });
  const source = await browser.newPage();
  source.setDefaultTimeout(5000);
  await source.goto(`${origin}/source?title=Brovim%20Native%20Source`);
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
  assert(errors.length === 0, errors.join("\n"));
  pass("No uncaught errors in native shortcut fixture pages");
} finally {
  await keys("up:q", "up:Shift_L", "up:Alt_L").catch(() => {});
  await browser?.close();
  await server.shutdown();
}
console.log(`Native shortcut checks: ${passed} passed`);
