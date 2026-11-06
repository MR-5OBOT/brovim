// The grid lists every eligible tab. Grow the configured columns × rows, a column or a row at a
// time (keeping the grid about twice as wide as tall), until every card has a cell or the screen's
// limit is reached. Only past that limit does the keyboard page through the cards.
export function tabSwitcherGrid(count, { columns, rows, maxColumns, maxRows }) {
  maxColumns = Math.max(columns, maxColumns);
  maxRows = Math.max(rows, maxRows);
  while (columns * rows < count && (columns < maxColumns || rows < maxRows)) {
    if (columns < maxColumns && (columns <= rows * 2 || rows === maxRows)) columns++;
    else rows++;
  }
  return { columns, rows };
}

// Pins occupy the leading cells in tab-bar order, independently of the recent-tab shortcut order.
// Visiting or sleeping a pin never moves it behind regular cards or rearranges the other pins.
export function orderTabSwitcherCards(tabs) {
  return [
    ...tabs.filter((tab) => tab.pinned).sort((a, b) => a.index - b.index),
    ...tabs.filter((tab) => !tab.pinned),
  ];
}
