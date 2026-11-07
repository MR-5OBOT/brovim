import "../lib/utils.js";
import "../lib/settings.js";
import { orderTabSwitcherCards, tabSwitcherGrid } from "../lib/tab_switcher.js";
import * as UIComponentMessenger from "./ui_component_messenger.js";

// Keyboard-only tab switcher: a fixed MRU list for each gesture, shown as one grid of cards. The
// grid lists every eligible tab, growing to fit them, and cycling wraps through all of them. Hold
// the assigned modifier and repeat the shortcut to move; releasing it switches. Arrows, h/j/k/l
// and Tab also move, Enter switches, x/Delete/Backspace close the selected tab, and Escape cancels.

const panel = document.getElementById("panel");
const grid = document.getElementById("tab-switcher");
const pageIndicator = document.getElementById("page-indicator");
// Letter tile colors.
const hues = [350, 24, 40, 142, 172, 205, 235, 265];

let allTabs = []; // Eligible tabs in this window, in switcher order: the current tab first.
let tabs = []; // The visual order, fixed for this gesture, with pins in the leading cells.
let layout = { columns: 8, rows: 1 }; // The grid's size for these tabs; see gridLayout.
let selectedIndex = 0;
let selectedCard = null;
let visiblePage = -1;
let isAltCycling = false;
let shortcut = Utils.parseBrowserShortcut();
let cycleId = null;
let overlayId = null;
let shiftIsDown = false;
let visible = false;
let activation = 0;
// Resolves once the tab list for the current activation has loaded. A quick Alt+Q tap can release
// Alt before that, so commits and cycling wait on it.
let tabsLoaded = Promise.resolve();
let closing = null; // The pending close request.
let focusGuard = null;

// Route requests through the owning content script so background handlers always receive the
// correct window and privacy context. Extension iframe senders can lack sender.tab in Firefox.
let requestId = 0;
const requests = new Map();
function sendRequest(message) {
  return new Promise((resolve, reject) => {
    const id = ++requestId;
    requests.set(id, { resolve, reject });
    UIComponentMessenger.postMessage({ name: "request", id, message });
  });
}

// A layout setting, or its default if the stored value is out of range.
function layoutSetting(key, min, max) {
  const value = Number(Settings.get(key));
  return Number.isInteger(value) && value >= min && value <= max
    ? value
    : Settings.defaultOptions[key];
}
const columnSetting = () => layoutSetting("tabSwitcherColumns", 3, 8);

async function fetchTabs(options = {}) {
  const currentActivation = ++activation;
  await Settings.onLoaded();
  let list = [];
  try {
    list = await sendRequest({
      handler: "getOpenTabsWithScreenshots",
      includeScreenshots: "cached",
    }) || [];
  } catch (err) {
    console.error("Failed to load tabs:", err);
  }
  if (currentActivation !== activation) return;
  // A carried gesture keeps its original last-used tab across protected-page hops.
  const previousId = options.cycle?.previousId ?? list.find((tab) => tab.lastUsed)?.id ??
    list[1]?.id;
  if (options.cycle) {
    const byId = new Map(list.map((tab) => [tab.id, tab]));
    const cycleIds = new Set(options.cycle.tabIds);
    list = [
      ...options.cycle.tabIds.map((id) => byId.get(id)).filter(Boolean),
      ...list.filter((tab) => !cycleIds.has(tab.id)),
    ];
  }
  // Keep decoded previews while refreshing the list and its order.
  const previousTabs = new Map(allTabs.map((tab) => [tab.id, tab]));
  allTabs = list.map((tab) => ({
    ...tab,
    screenshot: tab.screenshot ??
      (previousTabs.get(tab.id)?.url === tab.url ? previousTabs.get(tab.id).screenshot : null),
  }));
  panel.classList.toggle("glass", Settings.get("tabSwitcherGlass") === true);
  chooseTabs();
  if (tabs.length < 2) {
    hide();
    return;
  }
  const selectedId = options.cycle?.selectedId ??
    (options.reverse ? tabs.at(-1)?.id : previousId);
  selectedIndex = Math.max(0, tabs.findIndex((tab) => tab.id === selectedId));
  render();
  // Show usable cards immediately; cached previews arrive without delaying keys or painting.
  panel.classList.add("ready");
  sendRequest({ handler: "setTabSwitcherOverlay", id: overlayId, showing: true }).catch(() => {});
  postPanel();
  guardFocus();
  loadScreenshots(currentActivation, tabs);
}

const pageSize = () => layout.columns * layout.rows;

function chooseTabs() {
  tabs = orderTabSwitcherCards(allTabs);
  layout = gridLayout(tabs.length);
}

// The configured cards per row, with as many rows as the cards need while cards stay at least
// about 140×120px.
function gridLayout(count) {
  return tabSwitcherGrid(count, {
    columns: columnSetting(),
    maxColumns: Math.min(10, Math.floor(innerWidth * 0.9 / 140)),
    maxRows: Math.min(6, Math.floor(innerHeight * 0.9 / 120)),
  });
}

async function loadScreenshots(currentActivation, tabsToLoad) {
  const screenshots = await sendRequest({
    handler: "getTabScreenshots",
    urls: tabsToLoad.map((tab) => tab.url),
  }).catch(() => null);
  if (currentActivation !== activation || !screenshots) return;
  await Promise.all(tabsToLoad.map(async (tab, i) => {
    const screenshot = screenshots[i];
    if (!screenshot || tab.screenshot === screenshot) return;
    tab.screenshot = screenshot;
    const card = [...grid.children].find((el) => el.dataset.id == tab.id);
    if (!card) return;
    const img = createImage(screenshot);
    // Decode before replacing the visible preview, avoiding a blank frame during image loading.
    await img.decode().catch(() => {});
    if (currentActivation === activation && card.parentElement === grid) {
      card.querySelector(".card-thumb").firstElementChild.replaceWith(img);
    }
  }));
}

function render() {
  grid.classList.toggle("few", tabs.length < layout.columns);
  // On the panel, so that extra columns can widen it as well as the grid.
  panel.style.setProperty("--columns", Math.min(layout.columns, tabs.length));
  grid.replaceChildren(...tabs.map(createCard));
  selectedCard = null;
  visiblePage = -1;
  updateSelection();
  postPanel();
}

// Fit every row into the viewport. Measure only on render, resize or a change of page, never
// on an ordinary step. Decoded card images are retained when moving between overflow pages.
function sizePanel() {
  const card = grid.querySelector(".tab-card:not([hidden])");
  if (!card) return;
  const style = getComputedStyle(panel);
  const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) +
    parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
  const gap = parseFloat(getComputedStyle(grid).rowGap);
  const columns = Math.min(layout.columns, tabs.length);
  const count = Math.min(pageSize(), tabs.length - visiblePage * pageSize());
  const rows = Math.ceil(count / columns);
  const title = card.querySelector(".card-title");
  const titleStyle = getComputedStyle(title);
  const captionHeight = title.offsetHeight + parseFloat(titleStyle.marginTop) +
    parseFloat(titleStyle.marginBottom) + card.querySelector(".card-host").offsetHeight + 4;
  const available = innerHeight * 0.9 - padding - (pageIndicator.hidden ? 0 : 24);
  const height = Math.min(
    card.clientWidth * 0.75 + captionHeight,
    (available - gap * (rows - 1)) / rows,
  );
  grid.style.setProperty("--card-height", `${Math.max(1, Math.floor(height))}px`);
}

function createCard(tab, index) {
  const host = hostname(tab.url);
  const card = document.createElement("div");
  card.className = "tab-card";
  card.id = `tab-card-${index}`;
  card.dataset.id = tab.id;
  card.setAttribute("role", "gridcell");
  card.setAttribute("aria-selected", "false");
  card.setAttribute("aria-label", host ? `${tab.title} — ${host}` : tab.title);
  const thumb = document.createElement("div");
  thumb.className = "card-thumb";
  thumb.append(tab.screenshot ? createImage(tab.screenshot) : letterTile(tab, host));

  const title = document.createElement("div");
  title.className = "card-title";
  title.textContent = tab.title;
  const site = document.createElement("div");
  site.className = "card-host";
  site.textContent = host || tab.url;
  card.append(thumb, title, site);
  return card;
}

function createImage(src) {
  const img = document.createElement("img");
  img.src = src;
  img.alt = "";
  img.draggable = false;
  return img;
}

function letterTile(tab, host) {
  const tile = document.createElement("div");
  tile.className = "letter-tile";
  let hash = 0;
  for (const char of host || tab.url || tab.title) hash = (hash * 31 + char.codePointAt(0)) | 0;
  tile.style.setProperty("--hue", hues[Math.abs(hash) % hues.length]);
  tile.textContent = firstLetter(host.replace(/^www\./, "")) || firstLetter(tab.title.trim()) ||
    "?";
  return tile;
}

// The first character as the reader sees it, such as a whole emoji.
function firstLetter(text) {
  const first = Intl.Segmenter
    ? new Intl.Segmenter().segment(text)[Symbol.iterator]().next().value?.segment
    : Array.from(text)[0];
  return first?.toUpperCase() ?? "";
}

function hostname(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

function select(index) {
  if (index === selectedIndex) return;
  selectedIndex = index;
  updateSelection();
}

function updateSelection() {
  const nextPage = Math.floor(selectedIndex / pageSize());
  if (visiblePage !== nextPage) {
    visiblePage = nextPage;
    const start = visiblePage * pageSize();
    for (let i = 0; i < grid.children.length; i++) {
      grid.children[i].hidden = i < start || i >= start + pageSize();
    }
    const pages = Math.ceil(tabs.length / pageSize());
    pageIndicator.hidden = pages <= 1;
    pageIndicator.textContent = `${visiblePage + 1} / ${pages}`;
    sizePanel();
    postPanel();
  }
  const nextCard = grid.children[selectedIndex];
  if (selectedCard !== nextCard) {
    selectedCard?.classList.remove("selected");
    selectedCard?.setAttribute("aria-selected", "false");
    nextCard?.classList.add("selected");
    nextCard?.setAttribute("aria-selected", "true");
    selectedCard = nextCard;
  }
  // Names the selected card for screen readers.
  if (nextCard) grid.setAttribute("aria-activedescendant", nextCard.id);
}

// Liquid glass blurs the page under the panel, which this frame can't do, so the content script
// does, and needs to know where the panel is.
function postPanel() {
  if (!visible || !panel.classList.contains("ready") || !panel.classList.contains("glass")) return;
  const { left, top, width, height } = panel.getBoundingClientRect();
  UIComponentMessenger.postMessage({ name: "panel", rect: { left, top, width, height } });
}

// Moves through the cards in order, wrapping around.
function step(delta) {
  if (tabs.length === 0) return;
  select((selectedIndex + delta + tabs.length) % tabs.length);
}

// Moves a row up or down, wrapping within the column and skipping the gaps of a short last row.
function moveRow(delta) {
  if (tabs.length === 0) return;
  const columns = Math.min(layout.columns, tabs.length);
  const rows = Math.ceil(tabs.length / columns);
  const column = selectedIndex % columns;
  let row = Math.floor(selectedIndex / columns);
  do {
    row = (row + delta + rows) % rows;
  } while (row * columns + column >= tabs.length);
  select(row * columns + column);
}

function whenTabsLoaded(action) {
  const currentActivation = activation;
  tabsLoaded.then(() => {
    if (visible && currentActivation === activation) action();
  });
}

function commit() {
  whenTabsLoaded(async () => {
    const currentActivation = activation;
    // Never switch to a tab that is being closed.
    await closing;
    if (!visible || currentActivation !== activation) return;
    const tab = tabs[selectedIndex];
    hide();
    if (tab) {
      await sendRequest({
        handler: "selectSpecificTab",
        id: tab.id,
        awakeOnly: true,
      }).catch(() => {});
    }
  });
}

async function closeTab(index) {
  const tab = tabs[index];
  if (!tab || closing) return;
  select(index);
  const currentActivation = activation;
  const pending = sendRequest({ handler: "closeSpecificTab", id: tab.id }).then(
    (result) => result?.closed === true,
    () => false,
  );
  closing = pending;
  const closed = await pending;
  if (closing === pending) closing = null;
  // A failed close leaves the tab available. A late reply must not redraw a newer gesture.
  if (!closed || !visible || currentActivation !== activation) return;
  const selectedId = tabs[selectedIndex]?.id;
  allTabs = allTabs.filter((t) => t.id !== tab.id);
  // The following cards move up; the grid shrinks back toward its configured size.
  chooseTabs();
  if (allTabs.length < 2) {
    hide();
    return;
  }
  // Keep any selection made while closing. Otherwise keep the vacated position, so repeated x
  // presses don't jump back to the current tab.
  const preferredIndex = tabs.findIndex((t) => t.id === selectedId);
  selectedIndex = preferredIndex >= 0
    ? preferredIndex
    : Math.max(0, Math.min(index, tabs.length - 1));
  render();
  loadScreenshots(activation, tabs.filter((t) => !t.screenshot));
}

function hide() {
  activation++;
  visible = false;
  isAltCycling = false;
  clearInterval(focusGuard);
  panel.classList.remove("ready");
  UIComponentMessenger.postMessage({ name: "hide" });
  endCycle();
}

function endCycle() {
  if (overlayId) {
    sendRequest({ handler: "setTabSwitcherOverlay", id: overlayId, showing: false }).catch(
      () => {},
    );
  }
  overlayId = null;
  if (cycleId) {
    sendRequest({ handler: "endTabSwitcherCycle", id: cycleId }).catch(() => {});
  }
  cycleId = null;
}

// If the browser or another app takes the focus, possibly without delivering the Alt release,
// what the user wanted is unknown, so cancel.
function guardFocus() {
  clearInterval(focusGuard);
  let focused = false;
  focusGuard = setInterval(() => {
    if (document.hasFocus()) focused = true;
    else if (focused) hide();
  }, 100);
}

const vimDirections = { h: "ArrowLeft", j: "ArrowDown", k: "ArrowUp", l: "ArrowRight" };

// The action for a key, or null if the switcher doesn't use it.
function keyAction(event) {
  const key = event.key;
  if (
    Utils.isBrowserShortcutKey(event, shortcut) &&
    (isAltCycling || shortcut.modifiers.every((modifier) => event[modifier]))
  ) {
    isAltCycling = true;
    return () => step(event.shiftKey && !shortcut.requiresShift ? -1 : 1);
  }
  if (key === "Enter") return commit;
  if (key === "Tab") return () => step(event.shiftKey ? -1 : 1);
  switch (vimDirections[key] ?? key) {
    case "ArrowLeft":
      return () => step(-1);
    case "ArrowRight":
      return () => step(1);
    case "ArrowUp":
      return () => moveRow(-1);
    case "ArrowDown":
      return () => moveRow(1);
  }
  if (["x", "Delete", "Backspace"].includes(key)) {
    return () => !event.repeat && closeTab(selectedIndex);
  }
  return null;
}

function handleKeydown(event) {
  shiftIsDown = event.shiftKey;
  if (!visible || ["Alt", "Control", "Shift", "Meta"].includes(event.key)) return;
  if (event.key === "Escape") {
    event.preventDefault();
    hide();
    return;
  }
  const action = keyAction(event);
  if (!action) return;
  event.preventDefault();
  event.stopPropagation();
  whenTabsLoaded(action);
}

function handleKeyup(event) {
  shiftIsDown = event.shiftKey;
  if (Utils.isBrowserShortcutRelease(event, shortcut) && isAltCycling) {
    event.preventDefault();
    commit();
  }
}

UIComponentMessenger.init();
UIComponentMessenger.registerHandler((event) => {
  switch (event.data.name) {
    case "response": {
      const pending = requests.get(event.data.id);
      requests.delete(event.data.id);
      if (event.data.error) pending?.reject(new Error(event.data.error));
      else pending?.resolve(event.data.result);
      break;
    }
    case "activate":
      visible = true;
      closing = null;
      isAltCycling = event.data.isAltCycle ?? false;
      shortcut = event.data.shortcut ?? Utils.parseBrowserShortcut();
      cycleId = event.data.cycle?.id ?? null;
      overlayId = event.data.overlayId ?? null;
      shiftIsDown = event.data.reverse === true;
      // Hide the previous list until the fresh one (in the new recency order) is rendered.
      panel.classList.remove("ready");
      tabsLoaded = fetchTabs(event.data);
      if (event.data.commitOnOpen) commit();
      break;
    case "cycleNext": {
      isAltCycling = true;
      const direction = shiftIsDown && !shortcut.requiresShift ? -1 : 1;
      whenTabsLoaded(() => step(direction));
      break;
    }
    case "commitSelection":
      commit();
      break;
    case "hide":
      hide();
      break;
    case "hidden":
      visible = false;
      isAltCycling = false;
      clearInterval(focusGuard);
      activation++;
      endCycle();
      break;
  }
});

globalThis.addEventListener("keydown", handleKeydown, true);
globalThis.addEventListener("keyup", handleKeyup, true);
globalThis.addEventListener("resize", () => {
  // Showing the iframe can resize it while activation is still loading settings and tabs.
  // The first render will use the current viewport once that load finishes.
  if (!visible || !panel.classList.contains("ready")) return;
  // The screen's size limits how far the grid grows.
  const next = gridLayout(tabs.length);
  if (next.columns !== layout.columns || next.rows !== layout.rows) {
    layout = next;
    render();
    return;
  }
  sizePanel();
  postPanel();
});
// Keep focus and scrolling under keyboard control, including middle-click autoscroll, touch
// panning and the context menu. The covering frame still consumes clicks above the web page.
for (
  const type of [
    "pointerdown",
    "mousedown",
    "click",
    "auxclick",
    "contextmenu",
    "wheel",
    "touchstart",
  ]
) {
  document.addEventListener(type, (event) => {
    if (!visible) return;
    event.preventDefault();
    event.stopPropagation();
  }, { capture: true, passive: false });
}
