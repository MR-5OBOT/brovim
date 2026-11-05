import { ensureContentScripts } from "./content_script_bootstrap.js";
import { selectTabSwitcherCards } from "../lib/tab_switcher.js";
import {
  getRecentTabs,
  getSwitcherTabs,
  getTabSwitcherLimit,
  switchToPreviousRecentTab,
} from "./recent_tabs.js";

let pendingOpen = Promise.resolve();
const cycles = new Map();
const overlays = new Map();

export function setTabSwitcherOverlay(tab, id, showing) {
  if (!id) return;
  if (showing && tab.active) overlays.set(tab.windowId, { tabId: tab.id, id });
  else if (overlays.get(tab.windowId)?.id === id) overlays.delete(tab.windowId);
}
// Protected browser pages cannot report modifier releases. Expire abandoned fallback gestures;
// web pages end them explicitly on release. Visible overlays own their own focus/release handling.
const fallbackIdleMs = 3000;

export function endTabSwitcherCycle(windowId, id) {
  const cycle = cycles.get(windowId);
  if (!cycle || (id && cycle.id !== id)) return;
  clearTimeout(cycle.timer);
  cycles.delete(windowId);
}

export async function commitTabSwitcherCycle(tab, selection) {
  const cycle = cycles.get(tab.windowId);
  if (cycle?.id !== selection.id) return false;
  const target = (await getRecentTabs(tab.windowId)).find((t) => t.id === selection.selectedId);
  endTabSwitcherCycle(tab.windowId, selection.id);
  if (!target) return false;
  await chrome.tabs.update(target.id, { active: true });
  return true;
}

chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
  if (overlays.get(windowId)?.tabId !== tabId) overlays.delete(windowId);
  const cycle = cycles.get(windowId);
  if (cycle && cycle.currentId !== tabId) endTabSwitcherCycle(windowId);
});
chrome.windows.onFocusChanged.addListener((windowId) => {
  for (const id of overlays.keys()) if (id !== windowId) overlays.delete(id);
  for (const id of cycles.keys()) if (id !== windowId) endTabSwitcherCycle(id);
});
chrome.tabs.onRemoved.addListener((tabId) => {
  for (const [windowId, overlay] of overlays) {
    if (overlay.tabId === tabId) overlays.delete(windowId);
  }
});
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status !== "loading") return;
  for (const [windowId, overlay] of overlays) {
    if (overlay.tabId === tabId) overlays.delete(windowId);
  }
});

export function openTabSwitcher(tab) {
  const overlay = tab && overlays.get(tab.windowId);
  const opening = pendingOpen.then(() => {
    // Commands already queued for a grid belong to that gesture. A release or Escape must not
    // let them open a new grid (or quick-swap again) on the newly active tab.
    if (overlay && overlays.get(tab.windowId)?.id !== overlay.id) return;
    return showTabSwitcher(tab, overlay?.id);
  });
  pendingOpen = opening.catch(() => {});
  return opening;
}

async function showTabSwitcher(tab, expectedOverlayId) {
  // Commands queued during a protected-page hop can carry an obsolete tab snapshot.
  tab = (await chrome.tabs.query(
    tab ? { active: true, windowId: tab.windowId } : {
      active: true,
      currentWindow: true,
    },
  ))[0];
  if (!tab) return;
  await Settings.onLoaded();
  const tabs = await getSwitcherTabs(tab.windowId);
  if (expectedOverlayId && overlays.get(tab.windowId)?.id !== expectedOverlayId) return;
  if (tabs.length < 2) return;
  if (
    Settings.get("tabSwitcherTwoTabSwap") && tabs.length === 2 &&
    overlays.get(tab.windowId)?.tabId !== tab.id
  ) {
    endTabSwitcherCycle(tab.windowId);
    await switchToPreviousRecentTab(tab);
    return;
  }
  const commands = await chrome.commands?.getAll() ?? [];
  const shortcut = Utils.parseBrowserShortcut(
    commands.find((command) => command.name === "open_tab_switcher")?.shortcut || "Alt+Q",
  );
  let cycle = cycles.get(tab.windowId);
  if (
    cycle && (cycle.currentId !== tab.id ||
      (!cycle.overlay && Date.now() - cycle.lastCommand > fallbackIdleMs))
  ) {
    endTabSwitcherCycle(tab.windowId);
    cycle = null;
  }
  // Keep the original order across fallback activations. Never let the MRU changes caused by
  // those activations turn this held gesture into a swap between its first two tabs.
  let selection;
  if (cycle && !cycle.overlay) {
    const eligible = new Set(tabs.map((t) => t.id));
    const next = [...cycle.tabIds.slice(cycle.index + 1), ...cycle.tabIds.slice(0, cycle.index + 1)]
      .find((id) => eligible.has(id));
    if (next == null) {
      endTabSwitcherCycle(tab.windowId);
      cycle = null;
    } else {
      cycle.index = cycle.tabIds.indexOf(next);
      selection = snapshot(cycle);
    }
  }
  const requestId = crypto.randomUUID();
  const options = { shortcut, cycle: selection, expectedOverlayId };
  let missingReceiver = false;
  if (/^(https?|file):/i.test(tab.url || "")) {
    try {
      if (await askPageToOpen(tab, requestId, options)) {
        if (cycle) {
          cycle.overlay = true;
          clearTimeout(cycle.timer);
        }
        return;
      }
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
          if (await askPageToOpen(tab, requestId, options)) {
            if (cycle) {
              cycle.overlay = true;
              clearTimeout(cycle.timer);
            }
            return;
          }
        } catch { /* The page may have navigated during recovery. */ }
      }
    }
    chrome.tabs.sendMessage(tab.id, { handler: "cancelTabSwitcher", requestId }, { frameId: 0 })
      .catch(() => {});
  }
  // A quick release or a manual tab change may have switched while the response was pending.
  // Never apply the fallback from that old request to the newly active tab.
  const current = (await chrome.tabs.query({ active: true, windowId: tab.windowId }))[0];
  if (current?.id !== tab.id) return;
  if (!cycle) {
    const tabIds = selectTabSwitcherCards(tabs, getTabSwitcherLimit()).map((t) => t.id);
    cycle = {
      id: crypto.randomUUID(),
      tabIds,
      // Pins come first, so the previous tab isn't necessarily the second card.
      index: tabIds.indexOf(tabs[1].id),
      startedAt: Date.now(),
      overlay: false,
    };
    cycles.set(tab.windowId, cycle);
  }
  cycle.overlay = false;
  cycle.lastCommand = Date.now();
  cycle.currentId = cycle.tabIds[cycle.index];
  clearTimeout(cycle.timer);
  cycle.timer = setTimeout(() => endTabSwitcherCycle(tab.windowId, cycle.id), fallbackIdleMs);
  try {
    await chrome.tabs.update(cycle.currentId, { active: true });
    // Do not open a grid on arrival: a quick tap may already have released on the protected page.
    // Just observe release here, and resume the same list if the next command is still held.
    await chrome.tabs.sendMessage(cycle.currentId, {
      handler: "rememberTabSwitcherCycle",
      cycle: snapshot(cycle),
      shortcut,
    }, { frameId: 0 }).catch(() => {});
  } catch {
    endTabSwitcherCycle(tab.windowId, cycle.id);
  }
}

function snapshot(cycle) {
  return {
    id: cycle.id,
    tabIds: cycle.tabIds,
    selectedId: cycle.tabIds[cycle.index],
    startedAt: cycle.startedAt,
  };
}

async function askPageToOpen(tab, requestId, options) {
  const wasVisible = !!options.expectedOverlayId || overlays.get(tab.windowId)?.tabId === tab.id;
  let timeout;
  try {
    const response = await Promise.race([
      chrome.tabs.sendMessage(tab.id, { handler: "openTabSwitcher", requestId, ...options }, {
        frameId: 0,
      }),
      new Promise((resolve) => timeout = setTimeout(() => resolve(null), 350)),
    ]);
    // A slow acknowledgement of a repeat must not cancel a live grid and activate its MRU
    // fallback. The page owns selection until release/Escape, even while its replies are late.
    return wasVisible || response?.opened === true ||
      (response == null && overlays.get(tab.windowId)?.tabId === tab.id);
  } finally {
    clearTimeout(timeout);
  }
}
