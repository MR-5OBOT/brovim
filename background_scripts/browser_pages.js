import { browserProfiles, getBrowserPages } from "../lib/browser_pages.js";
import { ensureContentScripts } from "./content_script_bootstrap.js";

const pagePath = "pages/browser_pages.html";
let opening = null;

export function openBrowserPages(tab) {
  if (opening) return opening;
  opening = open(tab).finally(() => opening = null);
  return opening;
}

async function open(tab) {
  tab ??= (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];
  if (!tab) return;
  const pageUrl = chrome.runtime.getURL(pagePath);
  if (tab.url?.startsWith(pageUrl)) {
    await chrome.tabs.remove(tab.id);
    return;
  }
  if (await ensureContentScripts(tab.id)) {
    const opened = await chrome.tabs.sendMessage(tab.id, {
      handler: "openBrowserPages",
      targetTabId: tab.id,
    }, { frameId: 0 }).catch(() => false);
    if (opened) return;
  }
  // Protected pages cannot host an overlay. A temporary extension tab keeps the same centered UI.
  await chrome.tabs.create({
    url: `${pageUrl}?tab=${tab.id}&standalone=1`,
    windowId: tab.windowId,
    openerTabId: tab.id,
    index: tab.index + 1,
  });
}

export function initializeBrowserPages() {
  chrome.runtime.onMessage.addListener((request, sender, respond) => {
    if (request?.handler !== "openBrowserPage") return;
    const base = chrome.runtime.getURL(pagePath);
    if (sender.id !== chrome.runtime.id || sender.url?.split("?")[0] !== base) return;
    (async () => {
      if (
        sender.tab && !sender.url.includes("standalone=1") && sender.tab.id !== request.targetTabId
      ) {
        throw new Error("This palette belongs to a different tab.");
      }
      if (!browserProfiles.includes(request.profile) || request.profile === "auto") {
        throw new Error("Choose a browser first.");
      }
      const destination = getBrowserPages(request.profile).find((page) => page.id === request.id);
      if (!destination) throw new Error("This browser page is unavailable.");
      const target = Number.isInteger(request.targetTabId)
        ? await chrome.tabs.get(request.targetTabId).catch(() => null)
        : null;
      await chrome.tabs.create({
        url: destination.url,
        ...(target ? { windowId: target.windowId, index: target.index + 1 } : {}),
      });
      return { ok: true };
    })().then(respond, (error) => respond({ error: error.message }));
    return true;
  });
}
