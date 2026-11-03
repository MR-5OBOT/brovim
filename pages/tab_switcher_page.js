import * as UIComponentMessenger from "./ui_component_messenger.js";

// Shows awake tabs visited this session as previews, most recently used first, starting on the previous
// tab. Keys: h/j/k/l or arrows move, Enter switches, x closes, Esc (or a click outside) dismisses.
// Opened with the Alt+Q browser shortcut: hold Alt and tap Q to move; releasing Alt switches.

const panel = document.getElementById("tab-switcher");
const cardGap = 6; // The #tab-switcher grid gap in tab_switcher_page.css.
const windowParam = new URL(location.href).searchParams.get("windowId");
const standalone = globalThis.top === globalThis && windowParam !== null;
const sourceWindowId = standalone ? Number(windowParam) : undefined;

let tabs = [];
let selectedIndex = 0;
let columns = 1;
let isAltCycling = false;
// Resolves once the tab list for the current activation has loaded. A quick Alt+Q tap can release
// Alt before that, so commits and cycling wait on it.
let tabsLoaded = Promise.resolve();

async function fetchTabs() {
  try {
    tabs = await chrome.runtime.sendMessage({
      handler: "getOpenTabsWithScreenshots",
      windowId: sourceWindowId,
    }) || [];
  } catch (err) {
    console.error("Failed to load tabs:", err);
    tabs = [];
  }
  selectedIndex = tabs.length > 1 ? 1 : 0; // The previously used tab.
  render();
  panel.style.visibility = "visible";
}

function render() {
  // As many columns as fit on screen; more tabs wrap onto further rows.
  const cardWidth = parseFloat(getComputedStyle(panel).getPropertyValue("--card-width"));
  const maxColumns = Math.floor((globalThis.innerWidth - 80 + cardGap) / (cardWidth + cardGap));
  columns = Math.max(1, Math.min(tabs.length, maxColumns));
  panel.style.setProperty("--columns", columns);
  panel.replaceChildren(...tabs.map(createCard));
  updateSelection();
}

function createCard(tab) {
  const card = document.createElement("div");
  card.className = "tab-card";
  card.addEventListener("click", () => switchToTab(tab.id));

  const thumb = document.createElement("div");
  thumb.className = "card-thumb";
  if (tab.screenshot) {
    thumb.append(createImage(tab.screenshot));
  } else if (tab.favIconUrl) {
    thumb.append(createImage(tab.favIconUrl, "big-favicon"));
  } else {
    thumb.textContent = hostname(tab.url);
  }

  const label = document.createElement("div");
  label.className = "card-label";
  if (tab.favIconUrl) label.append(createImage(tab.favIconUrl));
  const title = document.createElement("span");
  title.textContent = tab.title;
  label.append(title);

  card.append(thumb, label);
  return card;
}

function createImage(src, className) {
  const img = document.createElement("img");
  img.src = src;
  if (className) img.className = className;
  img.onerror = () => img.remove();
  return img;
}

function hostname(url) {
  try {
    return new URL(url).hostname || url;
  } catch {
    return url;
  }
}

function updateSelection() {
  Array.from(panel.children).forEach((card, i) => {
    card.classList.toggle("selected", i === selectedIndex);
  });
  panel.children[selectedIndex]?.scrollIntoView({ block: "nearest", inline: "nearest" });
}

function move(step) {
  const next = selectedIndex + step;
  if (next >= 0 && next < tabs.length) {
    selectedIndex = next;
    updateSelection();
  }
}

function cycle(backwards = false) {
  if (tabs.length < 2) return;
  selectedIndex = (selectedIndex + (backwards ? -1 : 1) + tabs.length) % tabs.length;
  updateSelection();
}

function commit() {
  tabsLoaded.then(() => {
    if (tabs[selectedIndex]) {
      switchToTab(tabs[selectedIndex].id);
    } else {
      hide();
    }
  });
}

async function switchToTab(tabId) {
  // Closing a standalone window destroys this context, so finish switching before dismissing it.
  if (!standalone) hide();
  await chrome.runtime.sendMessage({ handler: "selectSpecificTab", id: tabId });
  if (standalone) hide();
}

async function closeTab(tabId) {
  await chrome.runtime.sendMessage({ handler: "closeSpecificTab", id: tabId });
  tabs = tabs.filter((t) => t.id !== tabId);
  if (tabs.length === 0) {
    hide();
    return;
  }
  // Keep the selection where it was, so pressing x repeatedly doesn't jump back to (and close) the
  // current tab.
  selectedIndex = Math.min(selectedIndex, tabs.length - 1);
  render();
}

function hide() {
  isAltCycling = false;
  if (standalone) globalThis.close();
  else UIComponentMessenger.postMessage({ name: "hide" });
}

const vimDirections = { h: "ArrowLeft", j: "ArrowDown", k: "ArrowUp", l: "ArrowRight" };

function handleKeydown(event) {
  const key = event.key;
  if (key === "Escape") {
    event.preventDefault();
    hide();
    return;
  }
  // Alt+Q cycling, or Q / Tab while Alt is still held.
  if ((key.toLowerCase() === "q" || key === "Tab") && (event.altKey || isAltCycling)) {
    event.preventDefault();
    isAltCycling = true;
    tabsLoaded.then(() => cycle(event.shiftKey));
    return;
  }
  if (key === "Enter") {
    event.preventDefault();
    commit();
    return;
  }
  if (key === "x") {
    event.preventDefault();
    if (tabs[selectedIndex]) closeTab(tabs[selectedIndex].id);
    return;
  }
  const direction = vimDirections[key] ?? key;
  const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns, ArrowDown: columns }[direction];
  if (step == null) return;
  event.preventDefault();
  move(step);
}

function handleKeyup(event) {
  if (event.key === "Alt" && isAltCycling) {
    event.preventDefault();
    commit();
  }
}

if (standalone) {
  document.body.classList.add("standalone");
  isAltCycling = true;
  panel.style.visibility = "hidden";
  tabsLoaded = fetchTabs();
  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message.handler === "cycleTabSwitcher" && message.windowId === sourceWindowId) {
      tabsLoaded.then(() => {
        cycle();
        respond(true);
      });
      return true;
    }
  });
} else {
  UIComponentMessenger.init();
}
UIComponentMessenger.registerHandler((event) => {
  switch (event.data.name) {
    case "activate":
      isAltCycling = event.data.isAltCycle ?? false;
      // Hide the previous list until the fresh one (in the new recency order) is rendered.
      panel.style.visibility = "hidden";
      tabsLoaded = fetchTabs();
      break;
    case "cycleNext":
      isAltCycling = true;
      tabsLoaded.then(() => cycle());
      break;
    case "commitSelection":
      commit();
      break;
    case "hide":
      hide();
      break;
  }
});

globalThis.addEventListener("keydown", handleKeydown, true);
globalThis.addEventListener("keyup", handleKeyup, true);
globalThis.addEventListener("resize", render);
// A click outside the panel dismisses the switcher.
document.body.addEventListener("click", (event) => {
  if (event.target === document.body) hide();
});
