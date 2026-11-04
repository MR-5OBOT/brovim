// Tab switcher previews, kept the way TabGlance keeps them: one screenshot per page URL, so
// previews survive browser restarts and changing tab IDs, and tabs showing the same page share one.
// Only the most recent tabSwitcherMaxThumbnails are kept. Incognito previews stay in session
// storage, which is never written to disk.

const storageKey = "tabThumbnails";
// Well under the 10 MB storage quota, whatever the preview limit.
const maxBytes = 6 * 1024 * 1024;
const caches = {};

const areaFor = (incognito) => incognito ? "session" : "local";

// URL -> JPEG data URL, oldest capture first. Storage keeps the insertion order of these keys.
function cacheFor(area) {
  caches[area] ??= chrome.storage[area].get(storageKey).then(
    (items) => new Map(Object.entries(items[storageKey] ?? {})),
    () => new Map(),
  );
  return caches[area];
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
export async function findThumbnails(urls, incognito) {
  const cache = await cacheFor(areaFor(incognito));
  const newestByPage = new Map();
  for (const url of cache.keys()) newestByPage.set(pageKey(url), url);
  return urls.map((url) => cache.get(url) ?? cache.get(newestByPage.get(pageKey(url))) ?? null);
}

export async function storeThumbnail(url, incognito, dataUrl) {
  const area = areaFor(incognito);
  const cache = await cacheFor(area);
  cache.delete(url);
  cache.set(url, dataUrl);
  const limit = Math.max(1, Math.round(Settings.get("tabSwitcherMaxThumbnails")) || 60);
  let bytes = 0;
  for (const preview of cache.values()) bytes += preview.length;
  for (const [oldUrl, preview] of cache) {
    if (cache.size <= limit && bytes <= maxBytes) break;
    cache.delete(oldUrl);
    bytes -= preview.length;
  }
  // ponytail: rewrites every preview (at most 6 MB) on each capture, as TabGlance does. Store one key
  // per URL plus an order list if these writes ever show up in profiles.
  await chrome.storage[area].set({ [storageKey]: Object.fromEntries(cache) });
}

// Captures the tab's visible area, if the tab is still active, loaded, and showing `url`.
// Returns { retry: true } when the browser's limit of two captures a second was reached.
export async function captureThumbnail(tabId, url) {
  await Settings.onLoaded();
  if (!Settings.get("tabSwitcherAutoCapture") || !/^(https?|file):/.test(url || "")) return {};
  const showing = async () => {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    return tab?.active && tab.status === "complete" && tab.url === url ? tab : null;
  };
  const tab = await showing();
  if (!tab) return {};
  let dataUrl;
  try {
    dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "jpeg" });
  } catch (error) {
    // Some pages, like the web store, can't be captured.
    return { retry: /MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND/.test(error?.message) };
  }
  // Don't file another page's pixels under this URL if the user switched tabs or navigated.
  if (!(await showing())) return {};
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
