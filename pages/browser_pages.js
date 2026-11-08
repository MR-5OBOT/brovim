import { browserProfiles, detectBrowserProfile, filterBrowserPages } from "../lib/browser_pages.js";
import * as UIComponentMessenger from "./ui_component_messenger.js";
import "../lib/utils.js";

const params = new URLSearchParams(location.search);
const standalone = params.has("standalone");
let targetTabId = /^\d+$/.test(params.get("tab") || "") ? Number(params.get("tab")) : undefined;
const embedded = globalThis.parent !== globalThis;
let visible = !embedded;
let resolveReady;
const ready = new Promise((resolve) => resolveReady = resolve);
if (embedded) {
  UIComponentMessenger.init();
  UIComponentMessenger.registerHandler(async ({ data }) => {
    await ready;
    if (data.name === "activate") {
      targetTabId = data.targetTabId;
      visible = true;
      input.value = "";
      render();
      input.focus();
    } else if (data.name === "hide") {
      close();
    } else if (data.name === "hidden") {
      visible = false;
    }
  });
}
const input = document.querySelector("#search");
const list = document.querySelector("#results");
const status = document.querySelector("#status");
const profileSelect = document.querySelector("#profile");
const detected = await detectBrowserProfile();
let results = [];
let selection = 0;
let opening = false;
document.body.classList.toggle("standalone", standalone);
document.body.classList.toggle("embedded", embedded);

const saved = (await chrome.storage.local.get("browserPagesProfile")).browserPagesProfile;
profileSelect.value = browserProfiles.includes(saved) ? saved : "auto";
const profile = () => profileSelect.value === "auto" ? detected : profileSelect.value;

function render() {
  results = filterBrowserPages(profile(), input.value);
  selection = 0;
  list.replaceChildren();
  status.textContent = results.length ? "" : "No browser pages match.";
  status.hidden = !!results.length;
  for (const [index, page] of results.entries()) {
    const row = document.createElement("li");
    row.id = `browser-page-${page.id}`;
    row.dataset.id = page.id;
    row.setAttribute("role", "option");
    const top = document.createElement("div");
    top.className = "top-half";
    const title = document.createElement("span");
    title.className = "title";
    title.textContent = page.title;
    top.append(title);
    const bottom = document.createElement("div");
    bottom.className = "bottom-half";
    const url = document.createElement("span");
    url.className = "url";
    url.textContent = page.url;
    bottom.append(url);
    row.append(top, bottom);
    row.addEventListener("click", () => open(index));
    list.append(row);
  }
  highlight();
}

function highlight() {
  for (const [index, row] of [...list.children].entries()) {
    row.classList.toggle("selected", index === selection);
    row.setAttribute("aria-selected", String(index === selection));
  }
  const current = list.children[selection];
  if (current) {
    input.setAttribute("aria-activedescendant", current.id);
    current.scrollIntoView({ block: "nearest" });
  } else {
    input.removeAttribute("aria-activedescendant");
  }
}

async function close(refocus = true) {
  if (embedded) {
    if (!visible) return;
    visible = false;
    input.blur();
    UIComponentMessenger.postMessage({ name: "hide", refocus });
  } else if (standalone) {
    const tab = await chrome.tabs.getCurrent();
    if (tab) await chrome.tabs.remove(tab.id);
  } else {
    globalThis.close();
  }
}

async function open(index) {
  if (!visible || opening || !results[index]) return;
  opening = true;
  try {
    const response = await chrome.runtime.sendMessage({
      handler: "openBrowserPage",
      id: results[index].id,
      profile: profile(),
      targetTabId,
    });
    if (!response?.ok) throw new Error(response?.error || "Could not open this browser page.");
    await close(false);
  } catch (error) {
    status.textContent = error.message;
    status.hidden = false;
  } finally {
    opening = false;
  }
}

input.addEventListener("input", render);
profileSelect.addEventListener("change", async () => {
  await chrome.storage.local.set({ browserPagesProfile: profileSelect.value });
  render();
  input.focus();
});
document.addEventListener("keydown", (event) => {
  const key = event.key.toLowerCase();
  if (key === "escape" || (event.altKey && key === "e")) {
    event.preventDefault();
    close();
    return;
  }
  if (event.target !== input) return;
  const down = key === "arrowdown" || (event.ctrlKey && ["j", "n"].includes(key)) ||
    (key === "tab" && !event.shiftKey);
  const up = key === "arrowup" || (event.ctrlKey && ["k", "p"].includes(key)) ||
    (key === "tab" && event.shiftKey);
  if (down || up) {
    event.preventDefault();
    if (results.length) selection = (selection + (down ? 1 : -1) + results.length) % results.length;
    highlight();
  } else if (key === "enter") {
    event.preventDefault();
    open(selection);
  }
});
chrome.runtime.onMessage.addListener((request) => {
  if (request?.handler === "closeBrowserPages") close();
});
render();
resolveReady();
globalThis.addEventListener("focus", () => {
  if (visible) input.focus({ preventScroll: true });
});
document.addEventListener("click", (event) => {
  if (!document.querySelector("#vomnibar").contains(event.target)) close();
});
if (!embedded) input.focus();
