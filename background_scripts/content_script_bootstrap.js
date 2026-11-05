import "../lib/utils.js";
import "../lib/settings.js";

const pending = new Map();

// Recover already-open website tabs after an install or extension reload. A marker prevents
// reinjecting the libraries into a current context and redeclaring their top-level constants.
export function ensureContentScripts(tabId) {
  if (pending.has(tabId)) return pending.get(tabId);
  const loading = injectIfMissing(tabId).finally(() => pending.delete(tabId));
  pending.set(tabId, loading);
  return loading;
}

async function injectIfMissing(tabId) {
  try {
    const [state] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => ({
        url: location.href,
        ready: !!globalThis.brovimContentScriptsLoaded,
        started: !!globalThis.Utils,
      }),
    });
    await Settings.onLoaded();
    if (state?.result.url?.startsWith("chrome://") && !Settings.get("enableInternalPages")) {
      return false;
    }
    if (state?.result.ready || state?.result.started) return true;
    const scripts = chrome.runtime.getManifest().content_scripts[0];
    const target = { tabId, allFrames: true };
    await chrome.scripting.insertCSS({ target, files: scripts.css });
    await chrome.scripting.insertCSS({ target, css: Settings.userCss() });
    await chrome.scripting.executeScript({ target, files: scripts.js });
    return true;
  } catch {
    // Protected pages and sites without permission use the background's direct tab swap.
    return false;
  }
}
