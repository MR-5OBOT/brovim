import { ensureContentScripts } from "./content_script_bootstrap.js";
import { orderTabSwitcherCards } from "../lib/tab_switcher.js";
import { getRecentTabs, getTabSwitcherData, switchToPreviousRecentTab } from "./recent_tabs.js";

let pendingOpen = Promise.resolve();
const cycles = new Map();
const overlays = new Map();

export function setTabSwitcherOverlay(tab, id, showing) {
  if (!id) return;
  if (showing && tab.active) {
    overlays.set(tab.windowId, { tabId: tab.id, id });
    // The tab a gesture switched to showed its grid itself: the grid owns the gesture now.
    const cycle = cycles.get(tab.windowId);
    if (cycle?.currentId === tab.id) {
      cycle.overlay = true;
      clearTimeout(cycle.timer);
    }
  } else if (overlays.get(tab.windowId)?.id === id) overlays.delete(tab.windowId);
}
// Protected browser pages cannot report modifier releases. Expire abandoned fallback gestures;
// web pages end them explicitly on release. Visible overlays own their own focus/release handling.
const fallbackIdleMs = 3000;
// How long a page may take to answer the shortcut before it counts as hung.
const unresponsiveMs = 2000;
// When no page could see the keys, the tab a press switches to shows the grid only if the switch
// came this soon after the press. A release while no page had the focus would be lost, and the
// grid would wait for it; people let go of the modifier later than this after pressing the letter.
// A browser busy loading a page can take most of this to switch tabs.
const handoffMs = 100;
// A press that had to start the stopped background arrives late, by about that much.
const workerStartMs = 250;
// A page that doesn't answer within this long is busy: a loading page's scripts can keep it busy
// for seconds. A press there switches tabs at once, before a tap lets go of the modifier (see
// handoffMs), so the tab it lands on sees the release of a tap, or shows the grid for a hold.
const frozenMs = 30;
// A page that hasn't said the shortcut's modifier went down (see TabSwitcher.warmUp) likely missed
// it: it was busy, or its keys went elsewhere. It gets less time, so the switch beats even a quick
// tap. A page that is fine but whose word is still on its way answers in time.
const unseenMs = 20;
// When the tab a gesture moved to can't see the shortcut's modifier, a press counts as part of the
// same held gesture only if it comes this soon after the last one. A slower one is a new tap.
const holdGapMs = 400;

// The tab whose page last saw the shortcut's modifier go down, and when. Pages report it at once
// (see TabSwitcher.warmUp); recorded here as it arrives, before anything else can delay it.
let modifierDown = { tabId: null, at: -Infinity };
// Pages being asked whether they can answer, by tab: see pagePulse.
const pulseWaiters = new Map();
export function noteModifierDown(tabId) {
  modifierDown = { tabId, at: performance.now() };
  pulseWaiters.get(tabId)?.();
}
chrome.runtime.onMessage.addListener((request, sender) => {
  if (request?.handler === "warmTabSwitcher" && sender.tab) noteModifierDown(sender.tab.id);
  return false;
});

export function endTabSwitcherCycle(windowId, id) {
  const cycle = cycles.get(windowId);
  if (!cycle || (id && cycle.id !== id)) return;
  clearTimeout(cycle.timer);
  cycles.delete(windowId);
}

export async function commitTabSwitcherCycle(tab, selection) {
  const cycle = cycles.get(tab.windowId);
  if (cycle?.id !== selection.id) return false;
  const target = (await getRecentTabs(tab.windowId)).find((t) => t.id === selection.selectedId);
  endTabSwitcherCycle(tab.windowId, selection.id);
  if (!target) return false;
  await chrome.tabs.update(target.id, { active: true });
  return true;
}

// A press on a tab that can't show the grid hands its gesture on only from a running background
// (see handoffMs). Pages that show the grid wake the background as the shortcut's modifier goes
// down. While a tab that can't is in front, keep the background running instead: any extension
// call restarts the browser's 30 s countdown to stopping it.
let keepRunning = null;

// - tabId: the tab now in front.
export async function checkFrontTab(tabId) {
  const shows = await chrome.tabs.sendMessage(tabId, { handler: "showsTabSwitcher" }, {
    frameId: 0,
  }).then((answer) => answer === true, () => false);
  // Another tab may have come to the front while this one answered.
  const front = (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];
  if (front?.id !== tabId) return;
  if (shows) stopRunning();
  else keepRunning ??= setInterval(() => chrome.runtime.getPlatformInfo(), 20_000);
}

function stopRunning() {
  clearInterval(keepRunning);
  keepRunning = null;
}

chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
  if (overlays.get(windowId)?.tabId !== tabId) overlays.delete(windowId);
  const cycle = cycles.get(windowId);
  if (cycle && cycle.currentId !== tabId) endTabSwitcherCycle(windowId);
  checkFrontTab(tabId).catch(() => {});
});
chrome.windows.onFocusChanged.addListener((windowId) => {
  for (const id of overlays.keys()) if (id !== windowId) overlays.delete(id);
  for (const id of cycles.keys()) if (id !== windowId) endTabSwitcherCycle(id);
  // No shortcut reaches a browser without the focus.
  if (windowId === chrome.windows.WINDOW_ID_NONE) return stopRunning();
  chrome.tabs.query({ active: true, windowId })
    .then(([tab]) => tab && checkFrontTab(tab.id)).catch(() => {});
});
chrome.tabs.onRemoved.addListener((tabId) => {
  for (const [windowId, overlay] of overlays) {
    if (overlay.tabId === tabId) overlays.delete(windowId);
  }
});
chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  // A page that finished loading, or replaced the one in front, may show the grid itself now.
  if (tab?.active && (change.status === "complete" || change.url)) {
    checkFrontTab(tabId).catch(() => {});
  }
  if (change.status !== "loading") return;
  for (const [windowId, overlay] of overlays) {
    if (overlay.tabId === tabId) overlays.delete(windowId);
  }
});
if (!globalThis.isUnitTests) {
  // The background can start while such a tab is in front: for a preview capture, say.
  chrome.tabs.query({ active: true, lastFocusedWindow: true })
    .then(([tab]) => tab && checkFrontTab(tab.id)).catch(() => {});
}

export function openTabSwitcher(tab) {
  const overlay = tab && overlays.get(tab.windowId);
  // In a service worker, the time since it started.
  const pressedAt = performance.now();
  const opening = pendingOpen.then(() => {
    // Commands already queued for a grid belong to that gesture. A release or Escape must not
    // let them open a new grid (or quick-swap again) on the newly active tab.
    if (overlay && overlays.get(tab.windowId)?.id !== overlay.id) return;
    return showTabSwitcher(tab, overlay?.id, pressedAt);
  });
  pendingOpen = opening.catch(() => {});
  return opening;
}

async function showTabSwitcher(tab, expectedOverlayId, pressedAt = performance.now()) {
  const pressedOn = tab?.id;
  // Ask the page at once whether it can answer, while the rest is gathered: the switch away from
  // one that can't has to come before a tap's release (see handoffMs). A grid on screen owns the
  // gesture.
  const askPage = (tab) =>
    !isScriptable(tab)
      ? null
      : expectedOverlayId
      ? "alive"
      : pagePulse(tab.id, sawPressBegin(tab, pressedAt));
  const early = tab ? askPage(tab) : undefined;
  // Commands queued during a protected-page hop can carry an obsolete tab snapshot.
  tab = (await chrome.tabs.query(
    tab ? { active: true, windowId: tab.windowId } : {
      active: true,
      currentWindow: true,
    },
  ))[0];
  if (!tab) return;
  // A press waits its turn behind the one before it, which a busy page can take a second to
  // answer. If that earlier press has since switched tabs, this one was meant for the tab that was
  // left; acting on the new tab would switch a second time. A held gesture walking through pages
  // that can't show the grid is the exception: each of its presses moves on from the last.
  if (pressedOn != null && pressedOn !== tab.id && cycles.get(tab.windowId)?.currentId !== tab.id) {
    return;
  }
  // The early question went to this tab, unless the press's snapshot was obsolete.
  const pulse = early !== undefined && tab.id === pressedOn ? early : askPage(tab);
  await Settings.onLoaded();
  const [{ tabs, previousId }, shortcut] = await Promise.all([
    getTabSwitcherData(tab.windowId),
    getTabSwitcherShortcut(),
  ]);
  if (expectedOverlayId && overlays.get(tab.windowId)?.id !== expectedOverlayId) return;
  if (tabs.length < 2) return;
  if (
    Settings.get("tabSwitcherTwoTabSwap") && tabs.length === 2 &&
    overlays.get(tab.windowId)?.tabId !== tab.id
  ) {
    endTabSwitcherCycle(tab.windowId);
    await switchToPreviousRecentTab(tab);
    return;
  }
  let cycle = cycles.get(tab.windowId);
  // A tab that sees the modifier ends the gesture itself when it's released. Elsewhere, only a
  // quick press can still belong to it.
  const holdGap = cycle?.watched ? fallbackIdleMs : holdGapMs;
  if (
    cycle && (cycle.currentId !== tab.id ||
      (!cycle.overlay && pressedAt - cycle.lastPressAt > holdGap))
  ) {
    endTabSwitcherCycle(tab.windowId);
    cycle = null;
  }
  // Keep the original order across fallback activations. Never let the MRU changes caused by
  // those activations turn this held gesture into a swap between its first two tabs.
  let selection;
  if (cycle && !cycle.overlay) {
    const eligible = new Set(tabs.map((t) => t.id));
    const next = [...cycle.tabIds.slice(cycle.index + 1), ...cycle.tabIds.slice(0, cycle.index + 1)]
      .find((id) => eligible.has(id));
    if (next == null) {
      endTabSwitcherCycle(tab.windowId);
      cycle = null;
    } else {
      cycle.index = cycle.tabIds.indexOf(next);
      selection = snapshot(cycle);
    }
  }
  const requestId = crypto.randomUUID();
  const options = { shortcut, cycle: selection, expectedOverlayId };
  let missingReceiver = false;
  // The page's answer, if it gave one.
  let answer;
  let frozen = false;
  if (pulse) {
    const state = await pulse;
    frozen = state === "frozen";
    missingReceiver = state === "absent";
    if (state === "alive") {
      try {
        answer = await askPageToOpen(tab, requestId, options);
      } catch {
        missingReceiver = true;
      }
    }
    if (missingReceiver) {
      // A page still loading brings Brovim with it. Waiting for that would make a tap slow, and
      // a hold late to tell from a tap; only a loaded page left without Brovim gets it now.
      const repaired = tab.status === "complete" && await Promise.race([
        ensureContentScripts(tab.id, { forBrowserShortcut: true }),
        new Promise((resolve) => setTimeout(() => resolve(false), 250)),
      ]);
      if (repaired) {
        try {
          answer = await askPageToOpen(tab, requestId, options);
        } catch { /* The page may have navigated during recovery. */ }
      }
    }
    if (answer?.opened) {
      if (cycle) {
        cycle.overlay = true;
        // A press on a grid on screen means the shortcut is held: see awaitVerdict.
        cycle.stepped ||= !!expectedOverlayId;
        clearTimeout(cycle.timer);
      }
      return;
    }
    if (!frozen) {
      chrome.tabs.sendMessage(tab.id, { handler: "cancelTabSwitcher", requestId }, { frameId: 0 })
        .catch(() => {});
    }
  }
  // A quick release or a manual tab change may have switched while the response was pending.
  // Never apply the fallback from that old request to the newly active tab.
  const current = (await chrome.tabs.query({ active: true, windowId: tab.windowId }))[0];
  if (current?.id !== tab.id) return;
  if (!cycle) {
    // The same cards, in the same order, as the grid shows.
    const tabIds = orderTabSwitcherCards(tabs, previousId).map((tab) => tab.id);
    cycle = {
      id: crypto.randomUUID(),
      tabIds,
      sourceId: tab.id,
      previousId,
      index: Math.max(0, tabIds.indexOf(previousId)),
      startedAt: Date.now(),
      overlay: false,
    };
    cycles.set(tab.windowId, cycle);
  }
  cycle.overlay = false;
  cycle.lastPressAt = pressedAt;
  cycle.currentId = cycle.tabIds[cycle.index];
  clearTimeout(cycle.timer);
  cycle.timer = setTimeout(() => endTabSwitcherCycle(tab.windowId, cycle.id), fallbackIdleMs);
  try {
    await chrome.tabs.update(cycle.currentId, { active: true });
    // The tab switched to shows the grid while the shortcut is held, and sees the release that
    // ends a tap. See rememberTabSwitcherCycle in the content scripts.
    const quick = pressedAt >= workerStartMs && performance.now() - pressedAt <= handoffMs;
    const reply = await chrome.tabs.sendMessage(cycle.currentId, {
      handler: "rememberTabSwitcherCycle",
      cycle: snapshot(cycle),
      shortcut,
      handoff: answer?.held ? "held" : quick ? "unknown" : frozen ? "verdict" : undefined,
    }, { frameId: 0 }).catch(() => null);
    // Whether the tab now in front sees the shortcut's modifier, and so ends the gesture itself.
    cycle.watched = reply?.watching === true;
    // The letter went down a moment before the shortcut reached the background.
    const since = Date.now() - (performance.now() - pressedAt) - 50;
    if (frozen) awaitVerdict(tab, cycle, quick, since);
  } catch {
    endTabSwitcherCycle(tab.windowId, cycle.id);
  }
}

// Whether Brovim runs on this tab's page: websites, files, browser pages (with the browser's flag),
// and Brovim's own pages (Options, Commands), which show the same grid. Other extensions' pages
// remain protected by the browser.
function isScriptable(tab) {
  const url = tab.url || "";
  const ownPage = /^(chrome|moz)-extension:/i.test(url) &&
    url.startsWith(chrome.runtime.getURL(""));
  return ownPage || /^(https?|file|chrome|brave|edge|about):/i.test(url);
}

// Whether this tab's page said the press began (see noteModifierDown), or a held gesture moved to it.
function sawPressBegin(tab, pressedAt) {
  return (modifierDown.tabId === tab.id && pressedAt - modifierDown.at < 10_000) ||
    cycles.get(tab.windowId)?.currentId === tab.id;
}

// "alive" if the page answers in time, "frozen" if it doesn't, or "absent" if no Brovim runs there
// to answer. A page that hasn't said the press began gets unseenMs, and frozenMs once it does: its
// word can arrive just after the shortcut.
async function pagePulse(tabId, seen) {
  const asked = performance.now();
  let timer;
  try {
    return await Promise.race([
      chrome.tabs.sendMessage(tabId, { handler: "tabSwitcherPing" }, { frameId: 0 })
        .then(() => "alive", () => "absent"),
      new Promise((resolve) => {
        const wait = (ms) => {
          clearTimeout(timer);
          timer = setTimeout(() => resolve("frozen"), ms);
        };
        wait(seen ? frozenMs : unseenMs);
        if (!seen) pulseWaiters.set(tabId, () => wait(frozenMs - (performance.now() - asked)));
      }),
    ]);
  } finally {
    clearTimeout(timer);
    pulseWaiters.delete(tabId);
  }
}

// A frozen page saw the keys up to the switch, or some of them. Once it catches up, it says what it
// saw. A release after the switch reaches the tab the gesture moved to.
// - quick: the switch came before a tap's release, so that tab decided itself: a grid for a hold,
//   none for a tap. The answer only corrects it: a release this page saw since the press means the
//   grid there is for a tap. A page that saw no release (a loading page gets no keys before it is
//   drawn) leaves that tab's decision be. Otherwise that tab waits for this page to say it saw the
//   shortcut held.
// - since: when the shortcut was pressed.
async function awaitVerdict(source, cycle, quick, since) {
  let timer;
  const answer = await Promise.race([
    chrome.tabs.sendMessage(source.id, { handler: "heldTabSwitcherShortcut", since }, {
      frameId: 0,
    }).catch(() => null),
    new Promise((resolve) => timer = setTimeout(() => resolve(null), unresponsiveMs)),
  ]);
  clearTimeout(timer);
  const held = quick ? (answer?.released ? false : null) : answer?.held === true;
  // The gesture may have moved on: the tab saw the release, or a press stepped its grid.
  if (cycles.get(source.windowId) !== cycle || cycle.stepped || held === null) return;
  if (quick ? held : cycle.overlay) return;
  if (!held) endTabSwitcherCycle(source.windowId, cycle.id);
  await chrome.tabs.sendMessage(cycle.currentId, {
    handler: "tabSwitcherHeld",
    cycleId: cycle.id,
    held,
  }, { frameId: 0 }).catch(() => {});
}

// Whether the grid with this id is showing, and did as asked: "stepTabSwitcher" moves its selection,
// "closeTabSwitcherSelection" closes the selected card's tab.
async function askGrid(handler, overlayId) {
  try {
    return await chrome.runtime.sendMessage({ handler, overlayId }) === true;
  } catch {
    return false; // No grid answered.
  }
}

// Alt+X while the grid shows on this tab: the held Alt turns the grid's x into the browser's
// close-tab shortcut. Returns whether the grid closed its selected card's tab instead.
export async function closeGridSelection(tab) {
  const overlay = overlays.get(tab.windowId);
  return overlay?.tabId === tab.id && await askGrid("closeTabSwitcherSelection", overlay.id);
}

// The shortcut assigned in the browser's extension-shortcut settings.
export async function getTabSwitcherShortcut() {
  const commands = await chrome.commands?.getAll() ?? [];
  return Utils.parseBrowserShortcut(
    commands.find((command) => command.name === "open_tab_switcher")?.shortcut || "Alt+Q",
  );
}

function snapshot(cycle) {
  return {
    id: cycle.id,
    tabIds: cycle.tabIds,
    selectedId: cycle.tabIds[cycle.index],
    startedAt: cycle.startedAt,
    sourceId: cycle.sourceId,
    previousId: cycle.previousId,
  };
}

// The page's answer: { opened, held }. held: the page couldn't show the grid, but saw the
// shortcut's modifier held past the tap window.
async function askPageToOpen(tab, requestId, options) {
  // The grid on screen takes the press itself, while the page's scripts may be busy loading.
  if (options.expectedOverlayId && await askGrid("stepTabSwitcher", options.expectedOverlayId)) {
    return { opened: true };
  }
  const wasVisible = !!options.expectedOverlayId || overlays.get(tab.windowId)?.tabId === tab.id;
  let timeout;
  try {
    const response = await Promise.race([
      chrome.tabs.sendMessage(tab.id, { handler: "openTabSwitcher", requestId, ...options }, {
        frameId: 0,
      }),
      // Only a page that is hung gives no answer. A busy one (YouTube stalls for hundreds of
      // milliseconds at a time) answers late, and only it knows whether the modifier is still
      // held: switching away on a guess would take a held grid for a tap.
      new Promise((resolve) => timeout = setTimeout(() => resolve(null), unresponsiveMs)),
    ]);
    // A slow acknowledgement of a repeat must not cancel a live grid and activate its MRU
    // fallback. The page owns selection until release/Escape, even while its replies are late.
    const opened = wasVisible || response?.opened === true ||
      (response == null && overlays.get(tab.windowId)?.tabId === tab.id);
    return { opened, held: response?.held === true };
  } finally {
    clearTimeout(timeout);
  }
}
