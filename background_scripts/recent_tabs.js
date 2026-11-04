import * as bgUtils from "./bg_utils.js";

// Awake tabs in this window: the active tab first, then tabs used this session (most recent
// first), then other awake tabs by lastAccessed. Sleeping and hidden tabs never enter the grid
// or the quick-switch path.
export async function getRecentTabs(windowId) {
  const [tabs] = await Promise.all([
    chrome.tabs.query({ windowId }),
    bgUtils.tabRecency.init(),
  ]);
  const rank = new Map(bgUtils.tabRecency.getTabsByRecency().map((id, index) => [id, index]));
  // Firefox tab-group extensions hide tabs; those aren't part of the visible window.
  return tabs.filter((tab) => !tab.hidden && !tab.discarded && !tab.frozen).sort((a, b) =>
    Number(!!b.active) - Number(!!a.active) ||
    (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity) ||
    (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0) || a.index - b.index
  );
}

// The switcher's order: most recently used (TabGlance's default), or the tab bar's order from the
// current tab, wrapping around.
export async function getSwitcherTabs(windowId) {
  const [tabs] = await Promise.all([getRecentTabs(windowId), Settings.onLoaded()]);
  if (Settings.get("tabSwitcherOrder") !== "tabstrip") return tabs;
  tabs.sort((a, b) => a.index - b.index);
  const current = Math.max(0, tabs.findIndex((tab) => tab.active));
  return [...tabs.slice(current), ...tabs.slice(0, current)];
}

// Switch to the grid's initial selection in the configured order, without loading previews.
export async function switchToPreviousRecentTab(tab) {
  const tabs = await getSwitcherTabs(tab.windowId);
  const previous = tabs.find((candidate) => candidate.id !== tab.id);
  if (!previous) return null;
  await chrome.tabs.update(previous.id, { active: true });
  return previous.id;
}
