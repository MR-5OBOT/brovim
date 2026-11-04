import "../lib/utils.js";
import "../lib/settings.js";
import * as UIComponentMessenger from "./ui_component_messenger.js";

// The tab switcher, modeled on TabGlance: the most recently used tabs, at most "cards per row" ×
// "rows" of them, starting on the previous tab. Hold Alt and tap Q to move; releasing Alt switches.
// The arrow keys, h/j/k/l and Tab also move, Enter switches, x, Delete or Backspace close the
// selected tab, and Esc or a click outside cancels. The mouse selects a card by hovering once it
// really moves, switches with a click and closes a tab with the card's × or a middle click.

const panel = document.getElementById("panel");
const grid = document.getElementById("tab-switcher");
const scrollHint = document.getElementById("scroll-hint");
const reducedMotion = globalThis.matchMedia("(prefers-reduced-motion: reduce)");
// Letter tile colors.
const hues = [350, 24, 40, 142, 172, 205, 235, 265];

let allTabs = []; // Awake tabs in this window, in switcher order: the current tab first.
let tabs = []; // The tabs shown as cards.
let selectedIndex = 0;
let selectedCard = null;
let isAltCycling = false;
let visible = false;
let activation = 0;
// Resolves once the tab list for the current activation has loaded. A quick Alt+Q tap can release
// Alt before that, so commits and cycling wait on it.
let tabsLoaded = Promise.resolve();
let closing = null; // The pending close request.
// The last pointer position. Hovering selects only once the mouse really moves: not when the grid
// appears under it, or scrolls under it after a key press.
let pointer = null;
let focusGuard = null;

// A layout setting, or its default if the stored value is out of range.
function layoutSetting(key, min, max) {
  const value = Number(Settings.get(key));
  return Number.isInteger(value) && value >= min && value <= max
    ? value
    : Settings.defaultOptions[key];
}
const columnSetting = () => layoutSetting("tabSwitcherColumns", 3, 6);

async function fetchTabs() {
  const currentActivation = ++activation;
  await Settings.onLoaded();
  let list = [];
  try {
    list = await chrome.runtime.sendMessage({
      handler: "getOpenTabsWithScreenshots",
      includeScreenshots: false,
    }) || [];
  } catch (err) {
    console.error("Failed to load tabs:", err);
  }
  if (currentActivation !== activation) return;
  // Keep decoded previews while refreshing the list and its order.
  const previousTabs = new Map(allTabs.map((tab) => [tab.id, tab]));
  allTabs = list.map((tab) => ({
    ...tab,
    screenshot: previousTabs.get(tab.id)?.url === tab.url
      ? previousTabs.get(tab.id).screenshot
      : null,
  }));
  panel.classList.toggle("glass", Settings.get("tabSwitcherGlass") === true);
  chooseTabs();
  if (tabs.length < 2) {
    hide();
    return;
  }
  selectedIndex = 1; // The previous tab.
  render();
  // Show usable cards immediately; cached previews arrive without delaying keys or painting.
  panel.classList.add("ready");
  postPanel();
  guardFocus();
  loadScreenshots(currentActivation, tabs);
}

function chooseTabs() {
  tabs = allTabs.slice(0, columnSetting() * layoutSetting("tabSwitcherRows", 1, 3));
}

async function loadScreenshots(currentActivation, tabsToLoad) {
  const screenshots = await chrome.runtime.sendMessage({
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
  const columns = columnSetting();
  grid.classList.toggle("few", tabs.length < columns);
  grid.style.setProperty("--columns", Math.min(columns, tabs.length));
  grid.replaceChildren(...tabs.map(createCard));
  selectedCard = null;
  updateSelection(false);
  postPanel();
}

function createCard(tab, index) {
  const host = hostname(tab.url);
  const card = document.createElement("div");
  card.className = "tab-card";
  card.id = `tab-card-${index}`;
  card.dataset.id = tab.id;
  card.dataset.index = index;
  card.setAttribute("role", "gridcell");
  card.setAttribute("aria-selected", "false");
  card.setAttribute("aria-label", host ? `${tab.title} — ${host}` : tab.title);
  card.addEventListener("click", (event) => {
    if (event.button !== 0) return;
    select(index);
    commit();
  });
  // Close on a middle click, without the autoscroll or paste of pressing the middle button.
  card.addEventListener("mousedown", (event) => event.button === 1 && event.preventDefault());
  card.addEventListener("auxclick", (event) => event.button === 1 && closeTab(index));

  const thumb = document.createElement("div");
  thumb.className = "card-thumb";
  const close = document.createElement("button");
  close.className = "close-tab";
  close.type = "button";
  close.tabIndex = -1;
  close.textContent = "×";
  close.title = "Close tab";
  close.setAttribute("aria-label", `Close ${tab.title}`);
  close.addEventListener("click", (event) => {
    event.stopPropagation();
    closeTab(index);
  });
  thumb.append(tab.screenshot ? createImage(tab.screenshot) : letterTile(tab, host), close);

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

function updateSelection(animate = true) {
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
  nextCard?.scrollIntoView({
    block: "nearest",
    inline: "nearest",
    behavior: animate && !reducedMotion.matches ? "smooth" : "instant",
  });
  updateScrollHint();
}

function updateScrollHint() {
  scrollHint.classList.toggle(
    "show",
    panel.scrollHeight - panel.clientHeight - panel.scrollTop > 12,
  );
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
  const columns = Math.min(columnSetting(), tabs.length);
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
    // Never switch to a tab that is being closed.
    await closing;
    const tab = tabs[selectedIndex];
    hide();
    if (tab) await chrome.runtime.sendMessage({ handler: "selectSpecificTab", id: tab.id });
  });
}

async function closeTab(index) {
  const tab = tabs[index];
  if (!tab || closing) return;
  select(index);
  closing = chrome.runtime.sendMessage({ handler: "closeSpecificTab", id: tab.id }).catch(() => {});
  await closing;
  closing = null;
  allTabs = allTabs.filter((t) => t.id !== tab.id);
  // The next most recent tab takes the free place.
  chooseTabs();
  if (tabs.length < 2) {
    hide();
    return;
  }
  // Keep the selection in place, so pressing x repeatedly doesn't jump back to the current tab.
  selectedIndex = Math.max(0, Math.min(index, tabs.length - 1));
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
}

// If the browser or another app takes the focus, possibly without delivering the Alt release,
// what the user wanted is unknown, so cancel, like TabGlance.
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
  // Alt+Q, or Q while Alt is still held.
  if (key.toLowerCase() === "q" && (event.altKey || isAltCycling)) {
    isAltCycling = true;
    return () => step(event.shiftKey ? -1 : 1);
  }
  if (["x", "Delete", "Backspace"].includes(key)) {
    return () => !event.repeat && closeTab(selectedIndex);
  }
  return null;
}

function handleKeydown(event) {
  if (!visible || ["Alt", "Control", "Shift", "Meta"].includes(event.key)) return;
  pointer = null;
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
  if (event.key === "Alt" && isAltCycling) {
    event.preventDefault();
    commit();
  }
}

UIComponentMessenger.init();
UIComponentMessenger.registerHandler((event) => {
  switch (event.data.name) {
    case "activate":
      visible = true;
      isAltCycling = event.data.isAltCycle ?? false;
      pointer = null;
      // Hide the previous list until the fresh one (in the new recency order) is rendered.
      panel.classList.remove("ready");
      tabsLoaded = fetchTabs();
      if (event.data.commitOnOpen) commit();
      break;
    case "cycleNext":
      isAltCycling = true;
      whenTabsLoaded(() => step(1));
      break;
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
      break;
  }
});

globalThis.addEventListener("keydown", handleKeydown, true);
globalThis.addEventListener("keyup", handleKeyup, true);
globalThis.addEventListener("resize", () => {
  if (!visible) return;
  updateScrollHint();
  postPanel();
});
panel.addEventListener("scroll", updateScrollHint, { passive: true });
document.addEventListener("mousemove", (event) => {
  const moved = pointer && (pointer.x !== event.clientX || pointer.y !== event.clientY);
  pointer = { x: event.clientX, y: event.clientY };
  const card = moved && event.target.closest?.(".tab-card");
  if (visible && card) select(Number(card.dataset.index));
});
// A click outside the panel dismisses the switcher.
document.body.addEventListener("click", (event) => {
  if (event.target === document.body) hide();
});
