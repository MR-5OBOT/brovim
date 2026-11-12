// The grid's cards (see orderTabSwitcherCards): the configured number per row, with a new row for
// each further row of cards. Only when the screen has no room for another row does it add columns,
// and only past the screen's limit does the keyboard page through the cards.
export function tabSwitcherGrid(count, { columns, maxColumns, maxRows }) {
  const rows = Math.max(1, Math.min(Math.ceil(count / columns), maxRows));
  return { columns: Math.max(columns, Math.min(maxColumns, Math.ceil(count / rows))), rows };
}

// At most 12 cards (two rows of six): pins first, in tab-bar order, independently of the recent-tab
// shortcut order, then the most recent tabs. Visiting or sleeping a pin never moves it behind regular
// cards or rearranges the other pins.
export function orderTabSwitcherCards(tabs) {
  return [
    ...tabs.filter((tab) => tab.pinned).sort((a, b) => a.index - b.index),
    ...tabs.filter((tab) => !tab.pinned),
  ].slice(0, 12);
}
