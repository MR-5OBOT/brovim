import "../lib/utils.js";
import "../lib/settings.js";
import "../lib/url_utils.js";
import "../background_scripts/tab_recency.js";
import * as bgUtils from "../background_scripts/bg_utils.js";
import "../background_scripts/all_commands.js";
import { Commands } from "../background_scripts/commands.js";
import * as exclusions from "../background_scripts/exclusions.js";
import "../background_scripts/completion/search_engines.js";
import "../background_scripts/completion/search_wrapper.js";
import "../background_scripts/completion/completers.js";
import "../background_scripts/tab_operations.js";
import {
  closeGridSelection,
  commitTabSwitcherCycle,
  endTabSwitcherCycle,
  getTabSwitcherShortcut,
  openTabSwitcher,
  setTabSwitcherOverlay,
} from "./tab_switcher.js";
import { ensureContentScripts } from "./content_script_bootstrap.js";
import { initializeInternalPages } from "./internal_pages.js";
import { initializeBrowserPages, openBrowserPages } from "./browser_pages.js";
import { getTabSwitcherData, isSleeping, switchToPreviousRecentTab } from "./recent_tabs.js";
import {
  captureThumbnail,
  findThumbnails,
  forgetThumbnails,
  getCachedThumbnails,
  trimThumbnailCaches,
  warmThumbnailCaches,
} from "./thumbnails.js";

import {
  BookmarkCompleter,
  DomainCompleter,
  HistoryCompleter,
  MultiCompleter,
  SearchEngineCompleter,
  TabCompleter,
} from "./completion/completers.js";

// NOTE: This file has many superfluous return statements in its functions, as a result of
// converting from coffeescript to es6. Many can be removed, but I didn't take the time to
// diligently track down precisely which return statements could be removed when I was doing the
// conversion.

import * as TabOperations from "./tab_operations.js";

// Allow Brovim's content scripts to access chrome.storage.session. Otherwise,
// chrome.storage.session will be null in content scripts.
chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_AND_UNTRUSTED_CONTEXTS" });

// A Brovim secret, available only within the current browser session. The secret is a generated
// strong random string. A restarted worker keeps it: a UI frame may be checking it mid-handshake.
// shortcut: Firefox's local-storage fallback also keeps it across browser restarts; rotate it in
// runtime.onStartup if that matters.
chrome.storage.session.get("vimiumSecret").then(({ vimiumSecret }) => {
  if (vimiumSecret) return;
  const randomArray = globalThis.crypto.getRandomValues(new Uint8Array(32)); // 32-byte random token.
  const secretToken = randomArray.reduce((a, b) => a.toString(16) + b.toString(16));
  return chrome.storage.session.set({ vimiumSecret: secretToken });
});

const completionSources = {
  bookmarks: new BookmarkCompleter(),
  history: new HistoryCompleter(),
  domains: new DomainCompleter(),
  tabs: new TabCompleter(),
  searchEngines: new SearchEngineCompleter(),
};

const completers = {
  omni: new MultiCompleter([
    completionSources.history,
    completionSources.domains,
    completionSources.searchEngines,
  ]),
  bookmarks: new MultiCompleter([completionSources.bookmarks]),
  tabs: new MultiCompleter([completionSources.tabs]),
};

// A query dictionary for `chrome.tabs.query` that will return only the visible tabs.
const visibleTabsQueryArgs = { currentWindow: true };
if (bgUtils.isFirefox()) {
  // Only Firefox supports hidden tabs.
  visibleTabsQueryArgs.hidden = false;
}

function onURLChange(details) {
  // sendMessage will throw "Error: Could not establish connection. Receiving end does not exist."
  // if there is no Brovim content script loaded in the given tab. This can occur if the user
  // navigated to a page where Brovim doesn't have permissions, like chrome:// URLs. This error is
  // noisy and mysterious (it usually doesn't have a valid line number), so we silence it.
  const message = {
    handler: "checkEnabledAfterURLChange",
    silenceLogging: true,
  };
  chrome.tabs.sendMessage(details.tabId, message, { frameId: details.frameId })
    .catch(() => {});
}

// Re-check whether Brovim is enabled for a frame when the URL changes without a reload.
// There's no reliable way to detect when the URL has changed in the content script, so we
// have to use the webNavigation API in our background script.
chrome.webNavigation.onHistoryStateUpdated.addListener(onURLChange); // history.pushState.
chrome.webNavigation.onReferenceFragmentUpdated.addListener(onURLChange); // Hash changed.

if (!globalThis.isUnitTests) {
  initializeBrowserPages();
  if (!bgUtils.isFirefox()) initializeInternalPages();
  warmThumbnailCaches();
  Settings.addEventListener("change", () => trimThumbnailCaches().catch(() => {}));
  chrome.history.onVisitRemoved.addListener(({ allHistory, urls }) =>
    forgetThumbnails(allHistory ? null : urls).catch(() => {})
  );
  // Cache "content_scripts/vimium.css" in chrome.storage.session for UI components.
  (function () {
    const url = chrome.runtime.getURL("content_scripts/vimium.css");
    fetch(url).then(async (response) => {
      if (response.ok) {
        chrome.storage.session.set({ vimiumCSSInChromeStorage: await response.text() });
      }
    });
  })();

  chrome.tabs.onActivated?.addListener(({ tabId }) => {
    Utils.setTimeout(400, () => previewTab(tabId));
  });

  // Not tabs.onUpdated: see tab_switcher.js.
  chrome.webNavigation.onCompleted.addListener(({ tabId, frameId }) => {
    if (frameId !== 0) return;
    chrome.tabs.get(tabId).then((tab) => {
      if (tab.active) Utils.setTimeout(400, () => previewTab(tabId));
    }).catch(() => {});
  });

  // The assigned browser shortcut (Alt+Q by default). Repeat it while holding the primary
  // modifier to cycle; release the modifier to switch.
  chrome.commands?.onCommand?.addListener((command, tab) => {
    if (command === "open_tab_switcher") {
      openTabSwitcher(tab).catch((error) => console.warn("Could not open tab switcher:", error));
    } else if (command === "focus_page") {
      focusPage(tab).catch((error) => console.warn("Could not focus page:", error));
    } else if (command === "open_browser_pages") {
      openBrowserPages(tab).catch((error) => console.warn("Could not open browser pages:", error));
    } else if (command === "close_tab") {
      closeTab(tab).catch((error) => console.warn("Could not close the tab:", error));
    }
  });
}

// The browser repeats a held shortcut (after a pause of up to about 0.7 s, then every 40 ms or so),
// and each tab that came forward would close in turn. A press is a repeat until a page sees the key
// go up (shortcutKeyReleased), or after a quiet second where no page can see it (a PDF, say).
let closeKey = { at: -Infinity, released: true };

// Alt+X. Closes the tab as removeTab does, or, while the grid shows there, its selected card's tab.
async function closeTab(tab) {
  const now = performance.now();
  const repeat = !closeKey.released && now - closeKey.at < 1000;
  closeKey = { at: now, released: false };
  if (repeat) return;
  tab ??= (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];
  if (!tab || await closeGridSelection(tab)) return;
  await BackgroundCommands.removeTab({ count: 1, tab });
}

async function focusPage(tab) {
  tab ??= (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];
  if (!tab) return false;
  await chrome.tabs.update(tab.id, { active: true });
  if (!await ensureContentScripts(tab.id)) return false;
  return await chrome.tabs.sendMessage(tab.id, { handler: "recoverPageFocus" }, { frameId: 0 });
}

// Pages with Brovim's content script capture their own previews once they look settled. Others
// (PDFs, or tabs left over from before an extension update) are captured shortly after they appear.
async function previewTab(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { handler: "startTabPreview" }, { frameId: 0 });
  } catch {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (tab?.active) await captureThumbnail(tab.id, tab.url);
  }
}

function muteTab(tab) {
  chrome.tabs.update(tab.id, { muted: !tab.mutedInfo.muted });
}

function toggleMuteTab(request, sender) {
  const currentTab = request.tab;
  const tabId = request.tabId;
  const registryEntry = request.registryEntry;

  if ((registryEntry.options.all != null) || (registryEntry.options.other != null)) {
    // If there are any audible, unmuted tabs, then we mute them; otherwise we unmute any muted tabs.
    chrome.tabs.query({}, function (tabs) {
      let tab;
      if (registryEntry.options.other != null) {
        tabs = tabs.filter((t) => t.id !== currentTab.id);
      }
      const audibleUnmutedTabs = tabs.filter((t) => t.audible && !t.mutedInfo.muted);
      if (audibleUnmutedTabs.length > 0) {
        chrome.tabs.sendMessage(tabId, {
          handler: "showMessage",
          message: `Muting ${audibleUnmutedTabs.length} tab(s).`,
        }, { frameId: sender.frameId }).catch(() => {});
        for (tab of audibleUnmutedTabs) {
          muteTab(tab);
        }
      } else {
        chrome.tabs.sendMessage(tabId, {
          handler: "showMessage",
          message: "Unmuting all muted tabs.",
        }, { frameId: sender.frameId }).catch(() => {});
        for (tab of tabs) {
          if (tab.mutedInfo.muted) {
            muteTab(tab);
          }
        }
      }
    });
  } else {
    if (currentTab.mutedInfo.muted) {
      chrome.tabs.sendMessage(tabId, {
        handler: "showMessage",
        message: "Unmuted tab.",
      }, { frameId: sender.frameId }).catch(() => {});
    } else {
      chrome.tabs.sendMessage(tabId, {
        handler: "showMessage",
        message: "Muted tab.",
      }, { frameId: sender.frameId }).catch(() => {});
    }
    muteTab(currentTab);
  }
}

// Find a tab's actual index in a given tab array returned by chrome.tabs.query. In Firefox, there
// may be hidden tabs, so tab.tabIndex may not be the actual index into the array of visible tabs.
function getTabIndex(tab, tabs) {
  // First check if the tab is where we expect it, to avoid searching the array.
  if (tabs.length > tab.index && tabs[tab.index].index === tab.index) {
    return tab.index;
  } else {
    return tabs.findIndex((t) => t.index === tab.index);
  }
}

//
// Selects the tab with the ID specified in request.id
//
async function selectSpecificTab(request) {
  const tab = await chrome.tabs.get(request.id).catch((error) => {
    if (!request.awakeOnly) throw error;
    return null;
  });
  // A tab can close, move or go to sleep while the fixed grid is open. Pinned sleepers remain
  // eligible and are woken only when selected; other unavailable tabs stay asleep.
  if (
    request.awakeOnly && (!tab || (!tab.pinned && isSleeping(tab)) || tab.hidden ||
      (request.tab && request.tab.windowId !== tab.windowId))
  ) return false;
  // Focus the tab's window. TODO: Why are we null-checking chrome.windows here?
  if (chrome.windows != null) {
    await chrome.windows.update(tab.windowId, { focused: true });
  }
  await chrome.tabs.update(request.id, { active: true });
}

function moveTab({ count, tab, registryEntry }) {
  if (registryEntry.command === "moveTabLeft") {
    count = -count;
  }
  return chrome.tabs.query(visibleTabsQueryArgs, function (tabs) {
    const pinnedCount = (tabs.filter((tab) => tab.pinned)).length;
    const minIndex = tab.pinned ? 0 : pinnedCount;
    const maxIndex = (tab.pinned ? pinnedCount : tabs.length) - 1;
    // The tabs array index of the new position.
    const moveIndex = Math.max(minIndex, Math.min(maxIndex, getTabIndex(tab, tabs) + count));
    return chrome.tabs.move(tab.id, {
      index: tabs[moveIndex].index,
    });
  });
}

function createRepeatCommand(command) {
  return async function (request) {
    let i = request.count - 1;
    const r = Object.assign({}, request);
    delete r.count;
    while (i >= 0) {
      i--;
      await command(r);
    }
  };
}

function nextZoomLevel(currentZoom, steps) {
  // Chrome's default zoom levels.
  const chromeLevels = [0.25, 0.33, 0.5, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];
  // Firefox's default zoom levels.
  const firefoxLevels = [0.3, 0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.2, 1.33, 1.5, 1.7, 2, 2.4, 3, 4, 5];

  let zoomLevels = chromeLevels; // Chrome by default
  if (bgUtils.isFirefox()) {
    zoomLevels = firefoxLevels;
  }

  if (steps === 0) { // Nothing
    return currentZoom;
  } else if (steps > 0) { // In
    // Chrome sometimes returns values with floating point errors.
    // Example: Chrome gives 0.32999999999999996 instead of 0.33.
    currentZoom += 0.0000001; // This is needed to solve floating point bugs in Chrome.
    const nextIndex = zoomLevels.findIndex((level) => level > currentZoom);
    const floorIndex = nextIndex == -1 ? zoomLevels.length : nextIndex - 1;
    return zoomLevels[Math.min(zoomLevels.length - 1, floorIndex + steps)];
  } else if (steps < 0) { // Out
    currentZoom -= 0.0000001; // This is needed to solve floating point bugs in Chrome.
    let ceilIndex = zoomLevels.findIndex((level) => level >= currentZoom);
    ceilIndex = ceilIndex == -1 ? zoomLevels.length : ceilIndex;
    return zoomLevels[Math.max(0, ceilIndex + steps)];
  }
}

// These are commands which are bound to keystrokes which must be handled by the background page.
// They are mapped in commands.js.
const BackgroundCommands = {
  openBrowserPages(request) {
    return openBrowserPages(request.tab);
  },
  async removeTab({ count, tab }) {
    await forCountTabs(count, tab, (tab) => {
      // In Firefox, Ctrl-W will not close a pinned tab, but on Chrome, it will. We try to be
      // consistent with each browser's UX for pinned tabs.
      if (tab.pinned && bgUtils.isFirefox()) return;
      chrome.tabs.remove(tab.id);
    });
  },
  restoreTab: createRepeatCommand(async (_request) => {
    await chrome.sessions.restore(null);
  }),
  async togglePinTab({ count, tab }) {
    await forCountTabs(count, tab, (tab) => {
      chrome.tabs.update(tab.id, { pinned: !tab.pinned });
    });
  },
  toggleMuteTab,
  // Alt+D. Every open tab follows the setting through its settings listener (dark_mode.js).
  async toggleDarkMode({ tabId }, sender) {
    const enabled = !Settings.get("darkModeEnabled");
    await Settings.set("darkModeEnabled", enabled);
    chrome.tabs.sendMessage(tabId, {
      handler: "showMessage",
      message: `Dark mode ${enabled ? "on" : "off"}`,
    }, { frameId: sender.frameId }).catch(() => {});
  },
  moveTabLeft: moveTab,
  moveTabRight: moveTab,

  setZoom({ tabId, registryEntry }) {
    const level = registryEntry.options?.["level"] ?? "1";
    const newZoom = parseFloat(level);
    if (!isNaN(newZoom)) {
      chrome.tabs.setZoom(tabId, newZoom);
    }
  },
  async zoomIn({ count, tabId }) {
    const currentZoom = await chrome.tabs.getZoom(tabId);
    const newZoom = nextZoomLevel(currentZoom, count);
    chrome.tabs.setZoom(tabId, newZoom);
  },
  async zoomOut({ count, tabId }) {
    const currentZoom = await chrome.tabs.getZoom(tabId);
    const newZoom = nextZoomLevel(currentZoom, -count);
    chrome.tabs.setZoom(tabId, newZoom);
  },
  zoomReset({ tabId }) {
    chrome.tabs.setZoom(tabId, 0); // setZoom of 0 sets to the tab default.
  },

  async reload({ count, tab, registryEntry }) {
    const bypassCache = registryEntry.options.hard != null ? registryEntry.options.hard : false;
    await forCountTabs(count, tab, (tab) => {
      chrome.tabs.reload(tab.id, { bypassCache });
    });
  },
};

async function forCountTabs(count, currentTab, callback) {
  // The tab's own window, found by its id: the last-focused window, or the tab's position, can
  // have changed by the time the command arrives. A tab that has gone is left alone.
  const query = { windowId: currentTab.windowId };
  if (bgUtils.isFirefox()) query.hidden = false;
  const tabs = await chrome.tabs.query(query);
  const activeTabIndex = tabs.findIndex((tab) => tab.id === currentTab.id);
  if (activeTabIndex < 0) return;
  const startTabIndex = Math.max(0, Math.min(activeTabIndex, tabs.length - count));
  for (const tab of tabs.slice(startTabIndex, startTabIndex + count)) {
    callback(tab);
  }
}

chrome.webNavigation.onCommitted.addListener(async ({ tabId, frameId }) => {
  // Brovim can't run on all tabs (e.g. chrome:// URLs). insertCSS will throw an error on such tabs,
  // which is expected, and noise. Swallow that error.
  const swallowError = () => {};
  await Settings.onLoaded();
  await chrome.scripting.insertCSS({
    css: Settings.userCss(),
    target: {
      tabId: tabId,
      frameIds: [frameId],
    },
  }).catch(swallowError);
});

// Returns all frame IDs for the given tab. Note that in Chrome, this will omit frame IDs for frames
// or iFrames which contain chrome-extension:// URLs, even if those pages are listed in Brovim's
// web_accessible_resources in manifest.json.
async function getFrameIdsForTab(tabId) {
  // getAllFrames unfortunately excludes frames and iframes from chrome-extension:// URLs.
  // In Firefox, by contrast, pages with moz-extension:// URLs are included.
  const frames = await chrome.webNavigation.getAllFrames({ tabId: tabId });
  return frames.map((f) => f.frameId);
}

const HintCoordinator = {
  pendingActivations: new Map(),

  // Forward the message in "request" to all frames the in sender's tab.
  broadcastLinkHintsMessage(request, sender) {
    if (request.messageType === "exit") this.pendingActivations.delete(sender.tab.id);
    return chrome.tabs.sendMessage(
      sender.tab.id,
      Object.assign(request, { handler: "linkHintsMessage" }),
    ).catch(() => {});
  },

  // This is sent by the content script once the user issues the link hints command.
  async prepareToActivateLinkHintsMode(
    tabId,
    originatingFrameId,
    request,
  ) {
    const activation = Symbol();
    this.pendingActivations.set(tabId, activation);
    try {
      await this.collectAndActivateHints(tabId, originatingFrameId, request, activation);
    } finally {
      if (this.pendingActivations.get(tabId) === activation) this.pendingActivations.delete(tabId);
    }
  },

  async collectAndActivateHints(
    tabId,
    originatingFrameId,
    { modeIndex, requestedByHelpDialog, isExtensionPage },
    activation,
  ) {
    const frameIds = await getFrameIdsForTab(tabId);
    if (this.pendingActivations.get(tabId) !== activation) return;
    // If link hints was triggered on a Brovim extension page (like the vimium help dialog or
    // options page), we cannot directly retrieve the frameIds for those pages using the
    // getFrameIdsForTab. However, as a workaround, if those pages were the pages activating hints,
    // their frameId is equal to originatingFrameId.
    if (isExtensionPage && !frameIds.includes(originatingFrameId)) {
      frameIds.push(originatingFrameId);
    }
    const timeout = 3000;
    // Embedded frames of a page still loading (ads, say) can be busy for seconds. Once the top
    // frame and the one the key was pressed in have answered, the others get 300 ms more.
    const isKeyFrame = (frameId) => frameId === 0 || frameId === originatingFrameId;
    let keyFramesAnswered;
    const lateFrameCutoff = new Promise((resolve) => keyFramesAnswered = resolve)
      .then(() => new Promise((resolve) => setTimeout(resolve, 300)));
    let promises = frameIds.map(async (frameId) => {
      let promise = chrome.tabs.sendMessage(
        tabId,
        {
          handler: "linkHintsMessage",
          messageType: "getHintDescriptors",
          modeIndex,
          requestedByHelpDialog,
        },
        { frameId },
      );

      promise = Utils.promiseWithTimeout(promise, timeout)
        .catch((error) => Utils.debugLog("Swallowed getHintDescriptors error:", error));

      const descriptors =
        await (isKeyFrame(frameId) ? promise : Promise.race([promise, lateFrameCutoff]));

      return {
        frameId,
        descriptors,
      };
    });
    Promise.all(promises.filter((_, i) => isKeyFrame(frameIds[i]))).then(keyFramesAnswered);

    const responses = (await Promise.all(promises))
      .filter((r) => r.descriptors != null);
    // Escape (or a newer hint request) can arrive while another frame is still collecting links.
    if (this.pendingActivations.get(tabId) !== activation) return;

    const frameIdToDescriptors = {};
    for (const { frameId, descriptors } of responses) {
      frameIdToDescriptors[frameId] = descriptors;
    }

    promises = responses.map(({ frameId }) => {
      // Don't send this frame's own link hints back to it -- they're already stored in that frame's
      // content script. At the time that we wrote this, this resulted in a 150% speedup for link
      // busy sites like Reddit.
      const outgoingFrameIdToHintDescriptors = Object.assign({}, frameIdToDescriptors);
      delete outgoingFrameIdToHintDescriptors[frameId];
      return chrome.tabs.sendMessage(
        tabId,
        {
          handler: "linkHintsMessage",
          messageType: "activateMode",
          frameId: frameId,
          originatingFrameId: originatingFrameId,
          frameIdToHintDescriptors: outgoingFrameIdToHintDescriptors,
          modeIndex: modeIndex,
        },
        { frameId },
      ).catch((error) => {
        Utils.debugLog(
          "Swallowed linkHints activateMode error:",
          error,
          "tabId",
          tabId,
          "frameId",
          frameId,
        );
      });
    });
    await Promise.all(promises);
  },
};

const sendRequestHandlers = {
  runBackgroundCommand(request, sender) {
    return BackgroundCommands[request.registryEntry.command](request, sender);
  },
  // getCurrentTabUrl is used by the content scripts to get their full URL, because window.location
  // cannot help with Chrome-specific URLs like "view-source:http:..".
  getCurrentTabUrl({ tab }) {
    return tab.url;
  },
  openUrlInNewTab: createRepeatCommand(async (request, callback) => {
    await TabOperations.openUrlInNewTab(request, callback);
  }),
  async openUrlInNewWindow(request) {
    await TabOperations.openUrlInNewWindow(request);
  },
  async openUrlInIncognito(request) {
    await chrome.windows.create({
      incognito: true,
      url: await UrlUtils.convertToUrl(request.url),
    });
  },
  openUrlInCurrentTab: TabOperations.openUrlInCurrentTab,
  openOptionsPageInNewTab(request) {
    return chrome.tabs.create({
      url: chrome.runtime.getURL("pages/options.html"),
      index: request.tab.index + 1,
    });
  },

  launchSearchQuery({ query, openInNewTab, tab, tabId }) {
    // The user can change tabs/windows while the Vomnibar hides. Keep the search in its source
    // window, or in the specific new tab we create there, rather than whichever tab is active.
    if (openInNewTab) return TabOperations.openUrlInNewTab({ url: query, tab });
    return chrome.search.query({ text: query, tabId });
  },

  selectSpecificTab,
  async quickSwitchTab({ tab, cycle }) {
    // A busy page can report its tap after the background already switched away from it.
    if (!tab.active) return { switched: true };
    return {
      switched: cycle
        ? await commitTabSwitcherCycle(tab, cycle)
        : (await switchToPreviousRecentTab(tab)) != null,
    };
  },
  endTabSwitcherCycle({ tab, id }) {
    endTabSwitcherCycle(tab.windowId, id);
  },
  // Sent when a page sees the switcher's modifier go down. Receiving it is the point: it starts a
  // stopped service worker before the shortcut itself arrives.
  warmTabSwitcher() {},
  // A page saw a key go up whose press it didn't see: a browser shortcut's, such as Alt+X's.
  shortcutKeyReleased() {
    closeKey.released = true;
  },
  setTabSwitcherOverlay({ tab, id, showing }) {
    setTabSwitcherOverlay(tab, id, showing);
  },
  // Eligible tabs in the window, in the switcher's order (the active tab first).
  async getOpenTabsWithScreenshots({ tab, windowId, includeScreenshots = true }) {
    const { tabs, previousId } = await getTabSwitcherData(windowId ?? tab.windowId);
    // A tab whose first page hasn't arrived yet has only the address it is loading.
    const urls = tabs.map((t) => t.url || t.pendingUrl || "");
    const screenshots = includeScreenshots === "cached"
      ? getCachedThumbnails(urls, tab?.incognito)
      : includeScreenshots
      ? await findThumbnails(urls, tab?.incognito)
      : [];
    return tabs.map((t, i) => ({
      id: t.id,
      index: t.index,
      title: t.title || "Untitled",
      url: urls[i],
      favIconUrl: t.favIconUrl || "",
      active: t.active,
      lastUsed: t.id === previousId,
      pinned: t.pinned,
      screenshot: screenshots[i] ?? null,
    }));
  },
  // The stored preview for each URL, or null.
  getTabScreenshots({ urls, tab }) {
    return findThumbnails(urls, tab?.incognito);
  },
  // From a page's content script, once the page looks settled.
  captureTabThumbnail({ tab, url, allowLoading = false }) {
    return captureThumbnail(tab.id, url, allowLoading);
  },
  async closeSpecificTab({ id }) {
    try {
      await chrome.tabs.remove(id);
      return { closed: true };
    } catch {
      // Always reply: a rejected runtime handler leaves the grid waiting indefinitely.
      return { closed: false };
    }
  },
  // Send a message to all frames in the current tab. If request.frameId is provided, then send
  // messages to only the frame with that ID.
  sendMessageToFrames(request, sender) {
    const newRequest = Object.assign({}, request.message);
    const options = request.frameId != null ? { frameId: request.frameId } : {};
    return chrome.tabs.sendMessage(sender.tab.id, newRequest, options).catch(() => {});
  },
  broadcastLinkHintsMessage(request, sender) {
    HintCoordinator.broadcastLinkHintsMessage(request, sender);
  },
  prepareToActivateLinkHintsMode(request, sender) {
    HintCoordinator.prepareToActivateLinkHintsMode(sender.tab.id, sender.frameId, request);
  },

  async initializeFrame(_request, sender) {
    await initializeExtension();
    // Check whether the extension is enabled for the top frame's URL, rather than the URL of the
    // specific frame that sent this request.
    const enabledState = exclusions.isEnabledForUrl(sender.tab.url);

    const isTopFrame = sender.frameId == 0;
    if (isTopFrame) {
      let whichIcon;
      if (!enabledState.isEnabledForUrl) {
        whichIcon = "disabled";
      } else if (enabledState.passKeys.length > 0) {
        whichIcon = "partial";
      } else {
        whichIcon = "enabled";
      }

      const iconSet = {
        "enabled": {
          "16": "../icons/action_enabled_16.png",
          "32": "../icons/action_enabled_32.png",
        },
        "partial": {
          "16": "../icons/action_partial_16.png",
          "32": "../icons/action_partial_32.png",
        },
        "disabled": {
          "16": "../icons/action_disabled_16.png",
          "32": "../icons/action_disabled_32.png",
        },
      };

      // The tab can be gone by now (closed, or replaced by a prerendered or discarded copy).
      // Check that the tab still exists before setting its icon.
      chrome.tabs.get(sender.tab.id).then((tab) => {
        if (!tab) return;
        chrome.action.setIcon(
          { path: iconSet[whichIcon], tabId: sender.tab.id },
          () => chrome.runtime.lastError,
        );
      }).catch(() => {});
    }

    const response = Object.assign({
      isFirefox: bgUtils.isFirefox(),
      firefoxVersion: await bgUtils.getFirefoxVersion(),
      frameId: sender.frameId,
      // Lets the page warm up the switcher when the shortcut's modifier goes down, and embedded
      // pages report that modifier to it.
      tabSwitcherShortcut: await getTabSwitcherShortcut(),
    }, enabledState);

    return response;
  },

  async getBrowserInfo() {
    return {
      isFirefox: bgUtils.isFirefox(),
      firefoxVersion: await bgUtils.getFirefoxVersion(),
    };
  },

  async filterCompletions(request) {
    const completer = completers[request.completerName];
    let response = await completer.filter(request);

    // NOTE: response contains `relevancyFunction` (function) properties which cause
    // postMessage, below, to fail in Firefox. See #2576. We cannot simply delete these methods,
    // as they're needed elsewhere. Converting the response to JSON and back is a quick and easy
    // way to sanitize the object.
    response = JSON.parse(JSON.stringify(response));

    return response;
  },

  refreshCompletions(request) {
    const completer = completers[request.completerName];
    completer.refresh();
  },

  cancelCompletions(request) {
    const completer = completers[request.completerName];
    completer.cancel();
  },
};

Utils.addChromeRuntimeOnMessageListener(
  Object.keys(sendRequestHandlers),
  async function (request, sender) {
    Utils.debugLog(
      "main.js: onMessage:%ourl:%otab:%oframe:%o",
      request.handler,
      sender.url ? sender.url.replace(/https?:\/\//, "") : "",
      sender.tab?.id,
      sender.frameId,
      // request // Often useful for debugging.
    );
    // NOTE: We expect all messages to come from a content script in a tab. I've observed in
    // Firefox when the extension is first installed, domReady and initializeFrame messages come from
    // content scripts in about:blank URLs, which have a null sender.tab. I don't know what this
    // corresponds to. Since we expect a valid sender.tab, ignore those messages.
    if (sender.tab == null) return;
    await Settings.onLoaded();
    request = Object.assign({ count: 1 }, request, {
      tab: sender.tab,
      tabId: sender.tab?.id,
    });
    const handler = sendRequestHandlers[request.handler];
    const result = handler ? await handler(request, sender) : null;
    return result;
  },
);

// Remove chrome.storage.local/findModeRawQueryListIncognito if there are no remaining
// incognito-mode windows. Since the common case is that there are none to begin with, we first
// check whether the key is set at all.
chrome.tabs.onRemoved.addListener(async function () {
  try {
    const items = await chrome.storage.session.get("findModeRawQueryListIncognito");
    if (items?.findModeRawQueryListIncognito) {
      const windows = await chrome.windows?.getAll();
      for (const window of windows ?? []) {
        if (window.incognito) return;
      }
      // There are no remaining incognito-mode tabs, and findModeRawQueryListIncognito is set.
      await chrome.storage.session.remove("findModeRawQueryListIncognito");
    }
  } catch {
    // Windows or storage may be unavailable during browser shutdown.
  }
});

//
// Begin initialization.
//

// True if the major version of Brovim has changed.
// - previousVersion: this will be null for new installs.
function majorVersionHasIncreased(previousVersion) {
  const currentVersion = Utils.getCurrentVersion();
  if (previousVersion == null) return false;
  const currentMajorVersion = currentVersion.split(".").slice(0, 2).join(".");
  const previousMajorVersion = previousVersion.split(".").slice(0, 2).join(".");
  return Utils.compareVersions(currentMajorVersion, previousMajorVersion) == 1;
}

// Show notification on upgrade.
async function showUpgradeMessageIfNecessary(onInstalledDetails) {
  const currentVersion = Utils.getCurrentVersion();
  // We do not show an upgrade message for patch/silent releases. Such releases have the same
  // major and minor version numbers.
  if (
    !majorVersionHasIncreased(onInstalledDetails.previousVersion) ||
    Settings.get("hideUpdateNotifications")
  ) {
    return;
  }

  // NOTE: These notifications use the system notification UI. So, if you don't have
  // notifications enabled from your browser (e.g. in Notification Settings in OSX), then
  // chrome.notification.create will succeed, but you won't see it.
  await chrome.notifications.create(
    upgradeNotificationId,
    {
      type: "basic",
      iconUrl: chrome.runtime.getURL("icons/icon128.png"),
      title: "Brovim Upgrade",
      message:
        `Brovim has been upgraded to version ${currentVersion}. Click here for more information.`,
      isClickable: true,
    },
  );
}

const upgradeNotificationId = "BrovimUpgradeNotification";
// Registered at startup: the service worker has usually stopped by the time the user clicks.
chrome.notifications?.onClicked.addListener((id) => {
  if (id === upgradeNotificationId) {
    chrome.tabs.create({ url: "https://github.com/MR-5OBOT/brovim" });
  }
});

async function injectContentScriptsAndCSSIntoExistingTabs() {
  const tabs = await chrome.tabs.query({ status: "complete" });
  await Promise.allSettled(tabs.map((tab) => ensureContentScripts(tab.id)));
}

let extensionInitializedPromise = null;
function initializeExtension() {
  if (!extensionInitializedPromise) {
    extensionInitializedPromise = (async () => {
      await Settings.onLoaded();
      await Commands.init();
    })();
  }
  return extensionInitializedPromise;
}

// The browser may have tabs already open. We inject the content scripts and Brovim's CSS
// immediately so that the extension is running on the pages immediately after install, rather than
// having to reload those pages.
chrome.runtime.onInstalled.addListener(async (details) => {
  Utils.debugLog("chrome.runtime.onInstalled");

  // NOTE: In my testing, when the onInstalled event occurs, the onStartup event does not
  // also occur, so we need to initialize Brovim here.
  await initializeExtension();

  const shouldInjectContentScripts =
    // NOTE: 2023-06-16: we do not install the content scripts in all tabs on Firefox.
    // I believe this is because Firefox does this already. See https://stackoverflow.com/a/37132144
    // for commentary.
    !bgUtils.isFirefox() &&
    (["install", "update", "chrome_update", "shared_module_update"].includes(details.reason));
  if (shouldInjectContentScripts) await injectContentScriptsAndCSSIntoExistingTabs();

  await showUpgradeMessageIfNecessary(details);
});

// Note that this event is not fired when an incognito profile is started.
chrome.runtime.onStartup.addListener(async () => {
  Utils.debugLog("chrome.runtime.onStartup");
  await initializeExtension();
});

Object.assign(globalThis, {
  TabOperations,
  // Exported for tests:
  openTabSwitcher,
  focusPage,
  closeTab,
  HintCoordinator,
  BackgroundCommands,
  sendRequestHandlers,
  majorVersionHasIncreased,
  nextZoomLevel,
});

// The chrome.runtime.onStartup and onInstalled events are not fired when disabling and then
// re-enabling the extension in developer mode, so we also initialize the extension here.
initializeExtension();
