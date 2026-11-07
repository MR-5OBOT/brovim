// The grid lists every eligible tab: the configured number of cards per row, with a new row for
// each further row of cards. Only when the screen has no room for another row does it add columns,
// and only past the screen's limit does the keyboard page through the cards.
export function tabSwitcherGrid(count, { columns, maxColumns, maxRows }) {
  const rows = Math.max(1, Math.min(Math.ceil(count / columns), maxRows));
  return { columns: Math.max(columns, Math.min(maxColumns, Math.ceil(count / rows))), rows };
}

// Pins occupy the leading cells in tab-bar order, independently of the recent-tab shortcut order.
// Visiting or sleeping a pin never moves it behind regular cards or rearranges the other pins.
export function orderTabSwitcherCards(tabs) {
  return [
    ...tabs.filter((tab) => tab.pinned).sort((a, b) => a.index - b.index),
    ...tabs.filter((tab) => !tab.pinned),
  ];
}
