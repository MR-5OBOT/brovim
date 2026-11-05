import "../lib/settings.js";
import { ensureContentScripts } from "./content_script_bootstrap.js";

async function updateOpenInternalPages() {
  await Settings.onLoaded();
  const tabs = await chrome.tabs.query({});
  await Promise.allSettled(
    tabs.filter((tab) => tab.url?.startsWith("chrome://")).map(async (tab) => {
      if (Settings.get("enableInternalPages")) await ensureContentScripts(tab.id);
      await chrome.tabs.sendMessage(tab.id, { handler: "refreshEnabledState" }).catch(() => {});
    }),
  );
}

export function initializeInternalPages() {
  // Chromium requires programmatic injection into WebUI, even with the startup flag.
  chrome.webNavigation.onDOMContentLoaded.addListener(({ tabId, frameId }) => {
    if (frameId === 0) ensureContentScripts(tabId);
  }, { url: [{ schemes: ["chrome"] }] });

  // Existing tabs respond immediately when the option changes, without a reload.
  Settings.addEventListener("change", () => updateOpenInternalPages().catch(() => {}));
  updateOpenInternalPages().catch(() => {});
}
