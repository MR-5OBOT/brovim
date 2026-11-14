import { isEnabledForUrl } from "./exclusions.js";

// Tab switcher previews: one screenshot per page URL, so previews survive browser restarts and
// changing tab IDs, and tabs showing the same page share one. Only the most recent
// tabSwitcherMaxThumbnails are kept. Incognito previews stay in this worker's memory only, and are
// gone when it stops.

// Each preview has its own key, so saving one doesn't rewrite them all. The order key lists their
// URLs, oldest capture first.
const previewKey = (url) => `tabThumbnail:${url}`;
const orderKey = "tabThumbnailOrder";
// Where all previews used to be kept, in one key.
const oldKey = "tabThumbnails";
// Well under the 10 MB storage quota, whatever the preview limit.
const maxBytes = 6 * 1024 * 1024;
const caches = {};
const cacheLoads = {};

const areaFor = (incognito) => incognito ? "session" : "local";

// Content scripts can read session storage (main.js), and every frame listens to its changes: a
// private preview saved there would reach every page of every tab. Firefox's local-storage
// fallback for it (utils.js) would put it on disk.
const previewStorage = (area) => area === "session" ? null : chrome.storage.local;

// URL -> JPEG data URL, oldest capture first.
function cacheFor(area) {
  cacheLoads[area] ??= loadCache(previewStorage(area)).catch(() => new Map())
    .then((cache) => caches[area] = cache);
  return cacheLoads[area];
}

async function loadCache(storage) {
  if (!storage) return new Map();
  const { [orderKey]: order = [], [oldKey]: old } = await storage.get([orderKey, oldKey]);
  if (old) {
    const cache = new Map(Object.entries(old));
    await save(storage, cache, [], [...cache.keys()]);
    await storage.remove(oldKey);
    return cache;
  }
  const items = await storage.get(order.map(previewKey));
  return new Map(
    order.filter((url) => items[previewKey(url)]).map((url) => [url, items[previewKey(url)]]),
  );
}

// Saves the order and the changed previews, and removes those the cache no longer has.
// - before: the cache's URLs before the change.
function save(storage, cache, before, changed = []) {
  if (!storage) return;
  const gone = before.filter((url) => !cache.has(url)).map(previewKey);
  const previews = changed.map((url) => [previewKey(url), cache.get(url)]);
  // Issued together, so storage applies them in the order the cache changed.
  return Promise.all([
    storage.set({ [orderKey]: [...cache.keys()], ...Object.fromEntries(previews) }),
    gone.length && storage.remove(gone),
  ]);
}

export async function warmThumbnailCaches() {
  await Settings.onLoaded();
  await trimThumbnailCaches();
}

function trimCache(cache) {
  const limit = Math.min(
    50,
    Math.max(
      1,
      Math.round(Number(Settings.get("tabSwitcherMaxThumbnails"))) ||
        Settings.defaultOptions.tabSwitcherMaxThumbnails,
    ),
  );
  const previousSize = cache.size;
  // A site excluded since its capture loses its previews too.
  for (const url of cache.keys()) if (!isEnabledForUrl(url).isEnabledForUrl) cache.delete(url);
  let bytes = 0;
  for (const preview of cache.values()) bytes += preview.length;
  for (const [url, preview] of cache) {
    if (cache.size <= limit && bytes <= maxBytes) break;
    cache.delete(url);
    bytes -= preview.length;
  }
  return previousSize !== cache.size;
}

export async function trimThumbnailCaches() {
  await Settings.onLoaded();
  await Promise.all(["local", "session"].map(async (area) => {
    const cache = await cacheFor(area);
    const before = [...cache.keys()];
    if (trimCache(cache)) await save(previewStorage(area), cache, before);
  }));
}

// Removes the previews of these pages, or all previews: clearing browsing history clears them too.
export async function forgetThumbnails(urls) {
  const pages = urls && new Set(urls.map(pageKey));
  await Promise.all(["local", "session"].map(async (area) => {
    const cache = await cacheFor(area);
    const before = [...cache.keys()];
    for (const url of before) if (!pages || pages.has(pageKey(url))) cache.delete(url);
    if (cache.size !== before.length) await save(previewStorage(area), cache, before);
  }));
}

// Tracking parameters change a page's URL without changing what it shows.
const trackingParam =
  /^(utm_\w+|gclid|gbraid|wbraid|dclid|fbclid|msclkid|yclid|mc_cid|mc_eid|_ga|_gl|igshid)$/i;

// Identifies a page, so a tab whose URL has drifted since its capture can still show the preview:
// tracking parameters and plain #fragments are ignored, but single-page-app routes (#/inbox, #!/a)
// and every other parameter still count, so /watch?v=A never borrows /watch?v=B's preview.
export function pageKey(url) {
  try {
    const { origin, pathname, searchParams, hash } = new URL(url);
    const params = [...searchParams].filter(([name]) => !trackingParam.test(name))
      .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
    const query = new URLSearchParams(params).toString();
    return origin + pathname + (query && `?${query}`) + (/^#[/!]/.test(hash) ? hash : "");
  } catch {
    return url;
  }
}

// The stored preview for each URL, or null.
function lookupThumbnails(cache, urls) {
  if (!cache) return urls.map(() => null);
  const newestByPage = new Map();
  for (const url of cache.keys()) newestByPage.set(pageKey(url), url);
  return urls.map((url) => cache.get(newestByPage.get(pageKey(url))) ?? null);
}

export async function findThumbnails(urls, incognito) {
  return lookupThumbnails(await cacheFor(areaFor(incognito)), urls);
}

// The first grid paint can use memory without waiting for storage. A cold cache is filled in
// parallel; the switcher requests any missing images after its cards and keyboard are ready.
export function getCachedThumbnails(urls, incognito) {
  const area = areaFor(incognito);
  cacheFor(area);
  return lookupThumbnails(caches[area], urls);
}

export async function storeThumbnail(url, incognito, dataUrl) {
  const area = areaFor(incognito);
  const cache = await cacheFor(area);
  const before = [...cache.keys()];
  const key = pageKey(url);
  for (const oldUrl of before) {
    if (pageKey(oldUrl) === key) cache.delete(oldUrl);
  }
  cache.set(url, dataUrl);
  trimCache(cache);
  await save(previewStorage(area), cache, before, cache.has(url) ? [url] : []);
}

// Captures the tab's visible area, if the tab is still active, loaded, and showing `url`.
// Returns { retry: true } when the browser's limit of two captures a second was reached.
export async function captureThumbnail(tabId, url, allowLoading = false) {
  await Settings.onLoaded();
  if (!Settings.get("tabSwitcherAutoCapture") || !/^(https?|file):/.test(url || "")) return {};
  // A site excluded from Brovim keeps its pages out of the previews too.
  if (!isEnabledForUrl(url).isEnabledForUrl) return {};
  const showing = async () => {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    return tab?.active &&
        (tab.status === "complete" || (allowLoading && tab.status === "loading")) &&
        tab.url === url
      ? tab
      : null;
  };
  const pageAllowsCapture = async () => {
    try {
      const state = await chrome.tabs.sendMessage(tabId, {
        handler: "canCaptureTabPreview",
        url,
      }, { frameId: 0 });
      return state?.allowed !== false;
    } catch {
      // PDFs and other pages without content scripts still support passive capture.
      return true;
    }
  };
  const tab = await showing();
  if (!tab || !await pageAllowsCapture()) return {};
  let dataUrl;
  try {
    dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "jpeg" });
  } catch (error) {
    // Some pages, like the web store, can't be captured.
    return { retry: /MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND/.test(error?.message) };
  }
  // Don't file another page's pixels under this URL if the user switched tabs or navigated.
  if (!(await showing()) || !await pageAllowsCapture()) return {};
  await storeThumbnail(url, tab.incognito, await shrinkImage(dataUrl));
  return { captured: true };
}

// Downscales a screenshot to preview size: fast for the switcher to decode, small to store.
async function shrinkImage(dataUrl, width = 480) {
  const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
  const scale = Math.min(1, width / bitmap.width);
  const canvas = new OffscreenCanvas(
    Math.round(bitmap.width * scale),
    Math.round(bitmap.height * scale),
  );
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.7 });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return "data:image/jpeg;base64," + btoa(binary);
}
