import * as bgUtils from "./bg_utils.js";

// Every open tab in the window, like TabGlance: the active tab first, then tabs used this session
// (most recent first), then the rest (restored, opened in the background, discarded) by the
// browser's lastAccessed time.
export async function getRecentTabs(windowId) {
  const [tabs] = await Promise.all([
    chrome.tabs.query({ windowId }),
    bgUtils.tabRecency.init(),
  ]);
  const rank = new Map(bgUtils.tabRecency.getTabsByRecency().map((id, index) => [id, index]));
  // Firefox tab-group extensions hide tabs; those aren't part of the visible window.
  return tabs.filter((tab) => !tab.hidden).sort((a, b) =>
    Number(!!b.active) - Number(!!a.active) ||
    (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity) ||
    (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0) || a.index - b.index
  );
}

// Switching within the current window needs no window focus change or preview loading.
export async function switchToPreviousRecentTab(tab) {
  const tabs = await getRecentTabs(tab.windowId);
  const previous = tabs.find((candidate) => candidate.id !== tab.id);
  if (!previous) return null;
  await chrome.tabs.update(previous.id, { active: true });
  return previous.id;
}
