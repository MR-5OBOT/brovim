import { ensureContentScripts } from "./content_script_bootstrap.js";
import {
  getRecentTabs,
  getSwitcherTabs,
  getTabSwitcherLimit,
  switchToPreviousRecentTab,
} from "./recent_tabs.js";

let pendingOpen = Promise.resolve();
const cycles = new Map();
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
  const cycle = cycles.get(windowId);
  if (cycle && cycle.currentId !== tabId) endTabSwitcherCycle(windowId);
});
chrome.windows.onFocusChanged.addListener((windowId) => {
  for (const id of cycles.keys()) if (id !== windowId) endTabSwitcherCycle(id);
});

export function openTabSwitcher(tab) {
  const opening = pendingOpen.then(() => showTabSwitcher(tab));
  pendingOpen = opening.catch(() => {});
  return opening;
}

async function showTabSwitcher(tab) {
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
  if (tabs.length < 2) return;
  if (Settings.get("tabSwitcherTwoTabSwap") && tabs.length === 2) {
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
    const awake = new Set(tabs.map((t) => t.id));
    const next = [...cycle.tabIds.slice(cycle.index + 1), ...cycle.tabIds.slice(0, cycle.index + 1)]
      .find((id) => awake.has(id));
    if (next == null) {
      endTabSwitcherCycle(tab.windowId);
      cycle = null;
    } else {
      cycle.index = cycle.tabIds.indexOf(next);
      selection = snapshot(cycle);
    }
  }
  const requestId = crypto.randomUUID();
  const options = { shortcut, cycle: selection };
  let missingReceiver = false;
  if (/^(https?|file):/i.test(tab.url || "")) {
    try {
      if (await askPageToOpen(tab.id, requestId, options)) {
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
          if (await askPageToOpen(tab.id, requestId, options)) {
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
  if (!cycle) {
    cycle = {
      id: crypto.randomUUID(),
      tabIds: tabs.slice(0, getTabSwitcherLimit()).map((t) => t.id),
      index: 1,
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

async function askPageToOpen(tabId, requestId, options) {
  let timeout;
  try {
    const response = await Promise.race([
      chrome.tabs.sendMessage(tabId, { handler: "openTabSwitcher", requestId, ...options }, {
        frameId: 0,
      }),
      new Promise((resolve) => timeout = setTimeout(() => resolve(null), 350)),
    ]);
    return response?.opened === true;
  } finally {
    clearTimeout(timeout);
  }
}
