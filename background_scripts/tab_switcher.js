// Browser shortcuts also run on pages which forbid content scripts. Use the in-page switcher
// when available, and an extension window otherwise. Serialize quick repeats during window creation.
let pendingOpen = Promise.resolve();

export function openTabSwitcher(tab) {
  const opening = pendingOpen.then(() => showTabSwitcher(tab));
  pendingOpen = opening.catch(() => {});
  return opening;
}

async function showTabSwitcher(tab) {
  tab ??= (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  if (!tab) return;

  const pageUrl = chrome.runtime.getURL("pages/tab_switcher_page.html");
  const isSwitcher = tab.url?.startsWith(`${pageUrl}?`);
  const windowId = isSwitcher
    ? Number(new URL(tab.url).searchParams.get("windowId"))
    : tab.windowId;
  const popupUrl = `${pageUrl}?windowId=${windowId}`;
  // Querying the browser also finds the existing window after a service-worker restart.
  const popup = (await chrome.tabs.query({ windowType: "popup" }))
    .find((candidate) => candidate.url === popupUrl || candidate.pendingUrl === popupUrl);
  if (popup) {
    await waitForTabLoad(popup.id);
    await chrome.windows.update(popup.windowId, { focused: true });
    await chrome.runtime.sendMessage({ handler: "cycleTabSwitcher", windowId });
    return;
  }

  try {
    await chrome.tabs.sendMessage(tab.id, {
      handler: "runInTopFrame",
      sourceFrameId: 0,
      registryEntry: { command: "TabSwitcher.activate", options: { altCycle: true } },
    }, { frameId: 0 });
    return;
  } catch {
    // Browser pages, the web store, PDFs, and tabs without site access may have no receiver.
  }

  const sourceWindow = await chrome.windows.get(windowId);
  const width = Math.min(1120, sourceWindow.width || 1120);
  const height = Math.min(720, sourceWindow.height || 720);
  const created = await chrome.windows.create({
    url: popupUrl,
    type: "popup",
    focused: true,
    incognito: !!tab.incognito,
    width,
    height,
    left: Math.round((sourceWindow.left || 0) + ((sourceWindow.width || width) - width) / 2),
    top: Math.round((sourceWindow.top || 0) + ((sourceWindow.height || height) - height) / 2),
  });
  await waitForTabLoad(created.tabs[0].id);
}

function waitForTabLoad(tabId) {
  return new Promise((resolve, reject) => {
    const finish = (error) => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
      if (error) reject(error);
      else resolve();
    };
    const onUpdated = (id, changes) => {
      if (id === tabId && changes.status === "complete") finish();
    };
    const onRemoved = (id) => {
      if (id === tabId) finish(new Error("Tab switcher was closed while loading."));
    };
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);
    chrome.tabs.get(tabId).then((tab) => {
      if (tab.status === "complete") finish();
    }, finish);
  });
}
