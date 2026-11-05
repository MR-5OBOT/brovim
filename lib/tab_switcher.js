// Reserve space for every pin before filling the grid with recent tabs. Keep the current/previous
// pair so opening the grid and a quick tap always agree. Pins always fill the first cells, awake or
// not; everything else keeps its existing order. Only pins exceeding the available capacity can
// force overflow pages.
export function selectTabSwitcherCards(tabs, limit) {
  const required = new Set(tabs.filter((tab) => tab.pinned).map((tab) => tab.id));
  for (const tab of tabs.slice(0, 2)) required.add(tab.id);
  let remaining = Math.max(0, limit - required.size);
  const cards = tabs.filter((tab) => required.has(tab.id) || remaining-- > 0);
  return [...cards.filter((tab) => tab.pinned), ...cards.filter((tab) => !tab.pinned)];
}
