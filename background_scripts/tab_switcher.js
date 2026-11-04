import { ensureContentScripts } from "./content_script_bootstrap.js";
import { getRecentTabs, switchToPreviousRecentTab } from "./recent_tabs.js";

let pendingOpen = Promise.resolve();

export function openTabSwitcher(tab) {
  const opening = pendingOpen.then(() => showTabSwitcher(tab));
  pendingOpen = opening.catch(() => {});
  return opening;
}

async function showTabSwitcher(tab) {
  tab ??= (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  if (!tab) return;
  // With two tabs there is nothing to choose: swap directly, like TabGlance's two-tab switch.
  if (!/^(https?|file):/i.test(tab.url || "") || (await getRecentTabs(tab.windowId)).length === 2) {
    await switchToPreviousRecentTab(tab);
    return;
  }

  const requestId = crypto.randomUUID();
  let missingReceiver = false;
  try {
    if (await askPageToOpen(tab.id, requestId)) return;
  } catch {
    missingReceiver = true;
  }
  if (missingReceiver) {
    const repaired = await Promise.race([
      ensureContentScripts(tab.id),
      new Promise((resolve) => setTimeout(() => resolve(false), 250)),
    ]);
    if (repaired) {
      try {
        if (await askPageToOpen(tab.id, requestId)) return;
      } catch {
        // A navigation may have replaced the page during recovery.
      }
    }
  }
  chrome.tabs.sendMessage(tab.id, { handler: "cancelTabSwitcher", requestId }, { frameId: 0 })
    .catch(() => {});
  await switchToPreviousRecentTab(tab);
}

async function askPageToOpen(tabId, requestId) {
  let timeout;
  try {
    const response = await Promise.race([
      chrome.tabs.sendMessage(tabId, { handler: "openTabSwitcher", requestId }, { frameId: 0 }),
      new Promise((resolve) => timeout = setTimeout(() => resolve(null), 350)),
    ]);
    return response?.opened === true;
  } finally {
    clearTimeout(timeout);
  }
}
