import * as bgUtils from "./bg_utils.js";

// Sleeping as the browser shows it: discarded, frozen, or not loaded since the browser started
// (restored tabs that were never opened again are "unloaded" without being marked discarded).
export function isSleeping(tab) {
  return tab.discarded || tab.frozen || tab.status === "unloaded";
}

// Eligible tabs in this window: the active tab first, then tabs used this session (most recent
// first), then other tabs by lastAccessed. Sleeping unpinned tabs and hidden tabs stay out of both
// the grid and the quick-switch path; pinned sleepers remain. (Headless Chromium freezes background
// tabs within seconds, so tests must open the grid soon after creating background fixtures.)
export async function getRecentTabs(windowId) {
  const [tabs] = await Promise.all([
    chrome.tabs.query({ windowId }),
    bgUtils.tabRecency.init(),
  ]);
  const rank = new Map(bgUtils.tabRecency.getTabsByRecency().map((id, index) => [id, index]));
  // Firefox tab-group extensions hide tabs; those aren't part of the visible window.
  return tabs.filter((tab) => !tab.hidden && (tab.pinned || !isSleeping(tab))).sort((
    a,
    b,
  ) =>
    Number(!!b.active) - Number(!!a.active) ||
    (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity) ||
    (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0) || a.index - b.index
  );
}

// The switcher's order: most recently used (TabGlance's default), or the tab bar's order from the
// current tab, wrapping around.
export async function getTabSwitcherData(windowId) {
  const [tabs] = await Promise.all([getRecentTabs(windowId), Settings.onLoaded()]);
  const previousId = tabs[1]?.id;
  if (Settings.get("tabSwitcherOrder") !== "tabstrip") return { tabs, previousId };
  tabs.sort((a, b) => a.index - b.index);
  const current = Math.max(0, tabs.findIndex((tab) => tab.active));
  return { tabs: [...tabs.slice(current), ...tabs.slice(0, current)], previousId };
}

// Quick taps always use visit history, independently of the grid's display order.
export async function switchToPreviousRecentTab(tab) {
  const tabs = await getRecentTabs(tab.windowId);
  const previous = tabs.find((candidate) => candidate.id !== tab.id);
  if (!previous) return null;
  await chrome.tabs.update(previous.id, { active: true });
  return previous.id;
}
