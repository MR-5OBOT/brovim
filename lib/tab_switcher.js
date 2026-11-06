// Reserve space for every pin before filling the grid with recent tabs. Keep the current/previous
// pair so opening the grid and a quick tap always agree. Pins keep their recency position, awake or
// not. Only pins exceeding the available capacity can force overflow pages.
export function selectTabSwitcherCards(tabs, limit, {
  sourceId = tabs.find((tab) => tab.active)?.id ?? tabs[0]?.id,
  previousId = tabs[1]?.id,
} = {}) {
  const required = new Set(tabs.filter((tab) => tab.pinned).map((tab) => tab.id));
  for (const tab of tabs) {
    if (tab.id === sourceId || tab.id === previousId) required.add(tab.id);
  }
  let remaining = Math.max(0, limit - required.size);
  return tabs.filter((tab) => required.has(tab.id) || remaining-- > 0);
}

// Pins occupy the leading cells in tab-bar order, independently of the recent-tab shortcut order.
// Visiting or sleeping a pin never moves it behind regular cards or rearranges the other pins.
export function orderTabSwitcherCards(tabs) {
  return [
    ...tabs.filter((tab) => tab.pinned).sort((a, b) => a.index - b.index),
    ...tabs.filter((tab) => !tab.pinned),
  ];
}
