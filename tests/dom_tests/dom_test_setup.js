globalThis.vimiumDomTestsAreRunning = true;

import * as shoulda from "../vendor/shoulda.js";

// Attach shoulda's functions -- like setup, context, should -- to the global namespace.
Object.assign(globalThis, shoulda);
globalThis.shoulda = shoulda;

document.addEventListener("DOMContentLoaded", async () => {
  isEnabledForUrl = true;
  await Settings.onLoaded();
  // Focus tests set focus programmatically. GrabBackFocus has its own explicit-on coverage.
  Settings._settings.grabBackFocus = false;
  await HUD.init();
});
