import * as UIComponentMessenger from "./ui_component_messenger.js";

let allTabs = [];
let filteredTabs = [];
let selectedIndex = 0;
let isAltCycling = false;

const filterInput = document.getElementById("tab-filter-input");
const tabGrid = document.getElementById("tab-grid");
const tabCountBadge = document.getElementById("tab-count-badge");

async function fetchTabs() {
  try {
    const tabs = await chrome.runtime.sendMessage({ handler: "getOpenTabsWithScreenshots" });
    allTabs = tabs || [];
    filterTabs();
  } catch (err) {
    console.error("Failed to load tabs:", err);
  }
}

function filterTabs() {
  const query = (filterInput?.value || "").toLowerCase().trim();
  if (!query) {
    filteredTabs = [...allTabs];
  } else {
    filteredTabs = allTabs.filter(
      (t) =>
        (t.title && t.title.toLowerCase().includes(query)) ||
        (t.url && t.url.toLowerCase().includes(query)),
    );
  }

  if (!query) {
    const activeIdx = filteredTabs.findIndex((t) => t.active);
    if (activeIdx >= 0) {
      if (isAltCycling && filteredTabs.length > 1) {
        selectedIndex = (activeIdx + 1) % filteredTabs.length;
      } else {
        selectedIndex = activeIdx;
      }
    } else {
      selectedIndex = 0;
    }
  } else {
    selectedIndex = 0;
  }

  render();
}

function render() {
  tabCountBadge.textContent = `${filteredTabs.length} tab${filteredTabs.length === 1 ? "" : "s"}`;
  tabGrid.innerHTML = "";

  if (filteredTabs.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No tabs found matching your search.";
    tabGrid.appendChild(empty);
    return;
  }

  filteredTabs.forEach((tab, index) => {
    const card = document.createElement("div");
    card.className = "tab-card" +
      (index === selectedIndex ? " selected" : "") +
      (tab.active ? " active-tab" : "");
    card.dataset.index = index;
    card.dataset.tabId = tab.id;

    // Header
    const header = document.createElement("div");
    header.className = "card-header";

    if (tab.favIconUrl) {
      const img = document.createElement("img");
      img.className = "card-favicon";
      img.src = tab.favIconUrl;
      img.onerror = () => {
        img.style.display = "none";
      };
      header.appendChild(img);
    }

    const title = document.createElement("span");
    title.className = "card-title";
    title.textContent = tab.title || "Untitled";
    header.appendChild(title);

    const closeBtn = document.createElement("button");
    closeBtn.className = "card-close-btn";
    closeBtn.innerHTML = "&times;";
    closeBtn.title = "Close tab (x)";
    closeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      closeTab(tab.id);
    });
    header.appendChild(closeBtn);

    card.appendChild(header);

    // Body (Thumbnail or placeholder)
    const body = document.createElement("div");
    body.className = "card-body";

    if (tab.screenshot) {
      const thumb = document.createElement("img");
      thumb.className = "card-thumbnail";
      thumb.src = tab.screenshot;
      body.appendChild(thumb);
    } else {
      const placeholder = document.createElement("div");
      placeholder.className = "card-placeholder";
      placeholder.innerHTML = `
        <div class="card-placeholder-icon">🌐</div>
        <div>${tab.url ? new URL(tab.url).hostname : "No preview"}</div>
      `;
      body.appendChild(placeholder);
    }

    card.appendChild(body);

    card.addEventListener("click", () => {
      switchToTab(tab.id);
    });

    tabGrid.appendChild(card);
  });

  scrollSelectedIntoView();
}

function updateSelectedCard() {
  const cards = tabGrid.querySelectorAll(".tab-card");
  cards.forEach((c, idx) => {
    if (idx === selectedIndex) {
      c.classList.add("selected");
    } else {
      c.classList.remove("selected");
    }
  });
  scrollSelectedIntoView();
}

function scrollSelectedIntoView() {
  const selectedCard = tabGrid.querySelector(`.tab-card[data-index="${selectedIndex}"]`);
  if (selectedCard) {
    selectedCard.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
}

function cycleNext(backwards = false) {
  if (filteredTabs.length <= 1) return;
  if (backwards) {
    selectedIndex = (selectedIndex - 1 + filteredTabs.length) % filteredTabs.length;
  } else {
    selectedIndex = (selectedIndex + 1) % filteredTabs.length;
  }
  updateSelectedCard();
}

function commitSelection() {
  if (filteredTabs[selectedIndex]) {
    switchToTab(filteredTabs[selectedIndex].id);
  } else {
    hide();
  }
}

async function switchToTab(tabId) {
  hide();
  await chrome.runtime.sendMessage({ handler: "selectSpecificTab", id: tabId });
}

async function closeTab(tabId) {
  await chrome.runtime.sendMessage({ handler: "closeSpecificTab", id: tabId });
  allTabs = allTabs.filter((t) => t.id !== tabId);
  filterTabs();
  if (filteredTabs.length === 0) {
    hide();
  }
}

function hide() {
  isAltCycling = false;
  UIComponentMessenger.postMessage({ name: "hide" });
}

// Compute column count dynamically based on grid width
function getGridColumnCount() {
  const firstCard = tabGrid.querySelector(".tab-card");
  if (!firstCard) return 1;
  const cardWidth = firstCard.offsetWidth + 16;
  const gridWidth = tabGrid.clientWidth - 40;
  return Math.max(1, Math.floor(gridWidth / cardWidth));
}

function handleKeydown(event) {
  const key = event.key;

  // Escape to dismiss
  if (key === "Escape") {
    event.preventDefault();
    hide();
    return;
  }

  // Alt+Q cycling or Q when Alt is held
  if ((key.toLowerCase() === "q" || key === "Tab") && (event.altKey || isAltCycling)) {
    event.preventDefault();
    isAltCycling = true;
    cycleNext(event.shiftKey);
    return;
  }

  // Enter to switch
  if (key === "Enter") {
    event.preventDefault();
    commitSelection();
    return;
  }

  // Close tab with Ctrl+x or Alt+x or if search input is unfocused
  if ((key === "x" && event.ctrlKey) || (key === "x" && document.activeElement !== filterInput)) {
    event.preventDefault();
    if (filteredTabs[selectedIndex]) {
      closeTab(filteredTabs[selectedIndex].id);
    }
    return;
  }

  const cols = getGridColumnCount();

  // Navigation
  if (key === "ArrowRight" || (key === "l" && event.altKey)) {
    event.preventDefault();
    if (selectedIndex < filteredTabs.length - 1) {
      selectedIndex++;
      updateSelectedCard();
    }
  } else if (key === "ArrowLeft" || (key === "h" && event.altKey)) {
    event.preventDefault();
    if (selectedIndex > 0) {
      selectedIndex--;
      updateSelectedCard();
    }
  } else if (key === "ArrowDown" || (key === "j" && event.altKey)) {
    event.preventDefault();
    if (selectedIndex + cols < filteredTabs.length) {
      selectedIndex += cols;
      updateSelectedCard();
    }
  } else if (key === "ArrowUp" || (key === "k" && event.altKey)) {
    event.preventDefault();
    if (selectedIndex - cols >= 0) {
      selectedIndex -= cols;
      updateSelectedCard();
    }
  }
}

function handleKeyup(event) {
  if (event.key === "Alt" && isAltCycling) {
    event.preventDefault();
    commitSelection();
  }
}

function init() {
  UIComponentMessenger.init();
  UIComponentMessenger.registerHandler((event) => {
    switch (event.data.name) {
      case "activate":
        isAltCycling = event.data.isAltCycle ?? false;
        if (filterInput) {
          filterInput.value = "";
        }
        fetchTabs().then(() => {
          if (!isAltCycling) {
            filterInput?.focus();
          }
        });
        break;
      case "cycleNext":
        isAltCycling = true;
        cycleNext(event.data.backwards ?? false);
        break;
      case "commitSelection":
        commitSelection();
        break;
      case "hide":
        hide();
        break;
    }
  });

  filterInput?.addEventListener("input", () => {
    isAltCycling = false;
    filterTabs();
  });

  globalThis.addEventListener("keydown", handleKeydown, true);
  globalThis.addEventListener("keyup", handleKeyup, true);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
