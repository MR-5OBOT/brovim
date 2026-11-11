import "./all_content_scripts.js";
import { ExclusionRulesEditor } from "./exclusion_rules_editor.js";
import { Commands, KeyMappingsParser } from "../background_scripts/commands.js";
import * as userSearchEngines from "../background_scripts/user_search_engines.js";

const options = {
  darkModeBrightness: "number",
  darkModeContrast: "number",
  darkModeEnabled: "boolean",
  darkModeExcludedSites: "string",
  darkModeGrayscale: "number",
  darkModeSepia: "number",
  darkModeSkipDarkPages: "boolean",
  enableInternalPages: "boolean",
  filterLinkHints: "boolean",
  grabBackFocus: "boolean",
  hideHud: "boolean",
  hideUpdateNotifications: "boolean",
  ignoreKeyboardLayout: "boolean",
  keyMappings: "string",
  linkHintColor: "string",
  linkHintMatchColor: "string",
  linkHintTextColor: "string",
  linkHintCharacters: "string",
  linkHintNumbers: "string",
  scrollStepSize: "number",
  searchEngines: "string",
  settingsVersion: "string", // This is a hidden field.
  smoothScroll: "boolean",
  tabSwitcherAutoCapture: "boolean",
  tabSwitcherColumns: "select",
  tabSwitcherGlass: "boolean",
  tabSwitcherMaxThumbnails: "select",
  tabSwitcherOrder: "option",
  tabSwitcherTwoTabSwap: "boolean",
  userDefinedLinkHintCss: "string",
  waitForEnterForFilteredHints: "boolean",
};

export async function init() {
  await Settings.onLoaded();

  const shortcutLabel = document.querySelector("#shortcut-to-save-all");
  shortcutLabel.textContent = KeyboardUtils.platform == "Mac" ? "Cmd-Enter" : "Ctrl-Enter";

  const saveButton = document.querySelector("#save");

  const onUpdated = () => {
    maintainLinkHintsView();
    updateHintPreview();
    updateRangeLabels();
    saveButton.disabled = false;
    saveButton.textContent = "Save changes";
    document.querySelector("#save-status").textContent = "Unsaved changes";
  };

  for (const el of document.querySelectorAll("input, textarea, select")) {
    // We want to immediately enable the save button when a setting is changed, so we want to use
    // the HTML element's "input" event here rather than the "change" event.
    el.addEventListener("input", () => onUpdated());
    el.addEventListener("blur", () => {
      showValidationErrors();
    });
  }

  saveButton.addEventListener("click", () => saveOptions());

  getOptionEl("filterLinkHints").addEventListener(
    "click",
    () => maintainLinkHintsView(),
  );

  document.querySelector("#download-backup").addEventListener(
    "mousedown",
    () => onDownloadBackupClicked(),
    true,
  );
  // Keyboard activation dispatches a click without a mousedown.
  document.querySelector("#download-backup").addEventListener("click", (event) => {
    if (event.detail === 0) onDownloadBackupClicked();
  });
  document.querySelector("#upload-backup").addEventListener(
    "change",
    (event) => onUploadBackupClicked(event),
  );

  for (const el of document.querySelectorAll(".reset-link a")) {
    el.addEventListener("click", (event) => {
      resetInputValue(event);
      showValidationErrors();
      onUpdated();
    });
  }

  globalThis.onbeforeunload = () => {
    if (!saveButton.disabled) {
      return "You have unsaved changes to options.";
    }
  };

  document.addEventListener("keydown", (event) => {
    // Firefox on Mac doesn't pass ctrl-enter to our page because MacOS Sequoia treats it as a
    // shortcut for right click; typing it shows a context menu. So, we also allow cmd-enter to save
    // all options. Note that ctrl-enter still works on Chrome for some reason.
    const isCtrlEnter = event.ctrlKey && event.keyCode === 13;
    const isCmdEnter = event.metaKey && event.keyCode === 13;
    if (isCtrlEnter || isCmdEnter) {
      saveOptions();
    }
  });

  ExclusionRulesEditor.init();
  ExclusionRulesEditor.addEventListener("input", onUpdated);

  const settings = Settings.getSettings();
  setFormFromSettings(settings);
  initSettingsNavigation();
  await initBrowserShortcut();
  await initInternalPagesStatus();
}

async function initInternalPagesStatus() {
  let available = false;
  try {
    available = await chrome.permissions?.contains({ origins: ["chrome://*/*"] });
  } catch {
    // Firefox and browsers without the internal-page override cannot grant this origin.
  }
  document.querySelector("#internal-pages-status").textContent = available
    ? "Browser permission is available. Changes apply to open browser pages when saved."
    : "Helium/Chromium: restart with --extensions-on-chrome-urls to use this. Other browsers may block access.";
}

function initSettingsNavigation() {
  const view = document.defaultView;
  const links = [...document.querySelectorAll(".settings-nav a")];
  const sections = [...document.querySelectorAll(".settings-section")];
  const setActive = (id) => {
    for (const link of links) {
      if (link.hash === `#${id}`) link.setAttribute("aria-current", "location");
      else link.removeAttribute("aria-current");
    }
  };
  setActive(view.location.hash.slice(1) || "general");
  for (const link of links) link.addEventListener("click", () => setActive(link.hash.slice(1)));
  let scheduled = false;
  view.addEventListener("scroll", () => {
    if (scheduled) return;
    scheduled = true;
    view.requestAnimationFrame(() => {
      scheduled = false;
      const offset = view.innerWidth <= 760 ? 150 : 80;
      const active = sections.filter((section) => section.getBoundingClientRect().top <= offset).at(
        -1,
      );
      setActive((active || sections[0]).id);
    });
  }, { passive: true });
}

async function initBrowserShortcut() {
  document.querySelector("#manage-shortcuts").addEventListener("click", async () => {
    await Utils.populateBrowserInfo();
    await chrome.tabs.create({
      url: Utils.isFirefox() ? "about:addons" : "chrome://extensions/shortcuts",
    });
  });
  if (!chrome.commands?.getAll) return;
  try {
    const commands = await chrome.commands.getAll();
    const shortcut = commands.find((command) => command.name === "open_tab_switcher")?.shortcut;
    document.querySelector("#focus-page-shortcut").textContent = commands.find((command) =>
      command.name === "focus_page"
    )?.shortcut || "Not assigned";
    document.querySelector("#tab-switcher-shortcut").textContent = shortcut || "Not assigned";
    if (!shortcut) {
      document.querySelector("#tab-switcher-description").textContent =
        "Assign a browser shortcut to open the switcher from any tab.";
    }
  } catch {
    // The preferences form remains usable if the browser can't report its shortcuts.
  }
}

function updateHintPreview() {
  const preview = document.querySelector("#hint-preview");
  for (
    const [setting, property] of [
      ["linkHintColor", "--preview-hint-bg"],
      ["linkHintTextColor", "--preview-hint-text"],
      ["linkHintMatchColor", "--preview-hint-typed"],
    ]
  ) {
    const value = getOptionEl(setting).value;
    preview.style.setProperty(property, value);
    document.querySelector(`[data-color-value="${setting}"]`).textContent = value.toUpperCase();
  }
}

function updateRangeLabels() {
  for (const range of document.querySelectorAll("input[type=range]")) {
    range.nextElementSibling.textContent = `${range.value}%`;
  }
}

export function getOptionEl(optionName) {
  return document.querySelector(`*[name="${optionName}"]`);
}

// Invoked when the user clicks the "reset" button next to an option's text field.
function resetInputValue(event) {
  const option = event.target.dataset.reset;
  const container = event.target.closest(".settings-card, .setting-row, .color-control");
  const input = option ? getOptionEl(option) : container.querySelector("input, textarea");
  const optionName = input.name;
  const defaultValue = Settings.defaultOptions[optionName];
  input.value = defaultValue;
  event.preventDefault();
}

function setFormFromSettings(settings) {
  for (const [optionName, optionType] of Object.entries(options)) {
    const el = getOptionEl(optionName);
    const value = settings[optionName];
    switch (optionType) {
      case "boolean":
        el.checked = value;
        break;
      case "number":
        el.value = value;
        break;
      case "string":
        el.value = value;
        break;
      case "select":
        el.value = optionName === "tabSwitcherMaxThumbnails" && Number(value) > 50
          ? "50"
          : String(value);
        if (el.selectedIndex < 0) el.value = String(Settings.defaultOptions[optionName]);
        break;
      case "option": {
        const choices = [...document.querySelectorAll(`input[name="${optionName}"]`)];
        const optionEl = choices.find((el) => el.value === value) ??
          choices.find((el) => el.value === Settings.defaultOptions[optionName]);
        optionEl.checked = true;
        break;
      }
      default:
        throw new Error(`Unrecognized option type ${optionType}`);
    }
  }

  ExclusionRulesEditor.setForm(settings["exclusionRules"]);

  document.querySelector("#upload-backup").value = "";
  maintainLinkHintsView();
  updateHintPreview();
  updateRangeLabels();
}

function getSettingsFromForm() {
  const settings = {};
  for (const [optionName, optionType] of Object.entries(options)) {
    const el = getOptionEl(optionName);
    let value;
    switch (optionType) {
      case "boolean":
        value = el.checked;
        break;
      case "number":
        value = parseFloat(el.value);
        break;
      case "string":
        value = el.value.trim();
        break;
      case "select":
        value = Number(el.value);
        break;
      case "option": {
        const optionEl = document.querySelector(`input[name="${optionName}"]:checked`);
        value = optionEl.value;
        break;
      }
      default:
        throw new Error(`Unrecognized option type ${optionType}`);
    }
    if (value !== null) {
      settings[optionName] = value;
    }
  }
  if (settings["linkHintCharacters"] != null) {
    settings["linkHintCharacters"] = settings["linkHintCharacters"].toLowerCase();
  }
  settings["exclusionRules"] = ExclusionRulesEditor.getRules();
  return settings;
}

function getValidationErrors() {
  const results = {};
  let text, parsed;

  for (const [name, type] of Object.entries(options)) {
    if (type !== "number") continue;
    const el = getOptionEl(name);
    const value = parseFloat(el.value);
    if (
      !Number.isFinite(value) || el.validity.rangeUnderflow || el.validity.rangeOverflow ||
      (name === "scrollStepSize" && value <= 0)
    ) {
      results[name] = name === "scrollStepSize"
        ? "Enter a scroll size greater than zero."
        : "Enter a number within the field's limits.";
    }
  }

  // keyMappings field.
  text = getOptionEl("keyMappings").value.trim();
  parsed = KeyMappingsParser.parse(text);
  if (parsed.validationErrors.length > 0) {
    results["keyMappings"] = parsed.validationErrors.join("\n");
  }

  // searchEngines field.
  text = getOptionEl("searchEngines").value.trim();
  parsed = userSearchEngines.parseConfig(text);
  if (parsed.validationErrors.length > 0) {
    results["searchEngines"] = parsed.validationErrors.join("\n");
  }

  // linkHintCharacters field.
  text = getOptionEl("linkHintCharacters").value.trim().toLowerCase();
  if (text != removeDuplicateChars(text)) {
    results["linkHintCharacters"] = "This cannot contain duplicate characters.";
  } else if (text.length <= 1) {
    results["linkHintCharacters"] = "This must be at least two characters long.";
  }

  // linkHintNumbers field.
  text = getOptionEl("linkHintNumbers").value.trim().toUpperCase();
  if (text != removeDuplicateChars(text)) {
    results["linkHintNumbers"] = "This cannot contain duplicate characters.";
  } else if (text.length <= 1) {
    results["linkHintNumbers"] = "This must be at least two characters long.";
  }

  return results;
}

function addValidationMessage(el, message) {
  el.classList.add("validation-error");
  const exampleEl = el.nextElementSibling;
  const messageEl = document.createElement("div");
  messageEl.classList.add("validation-message");
  messageEl.textContent = message;
  (exampleEl ?? el).after(messageEl);
}

// Returns true if there are errors, false otherwise.
function showValidationErrors() {
  // Remove all previous validation errors.
  let els = document.querySelectorAll(".validation-error");
  for (const el of els) {
    el.classList.remove("validation-error");
  }
  els = document.querySelectorAll(".validation-message");
  for (const el of els) {
    el.remove();
  }

  const errors = getValidationErrors();
  for (const [optionName, message] of Object.entries(errors)) {
    const el = getOptionEl(optionName);
    addValidationMessage(el, message);
  }
  // Some options can be hidden in the UI. If they have validation errors, force them to be shown.
  if (errors["linkHintCharacters"]) {
    showElement(document.querySelector("#link-hint-characters-container"), true);
  }
  if (errors["linkHintNumbers"]) {
    showElement(document.querySelector("#link-hint-numbers-container"), true);
  }
  const hasErrors = Object.keys(errors).length > 0;
  return hasErrors;
}

function removeDuplicateChars(str) {
  const seen = new Set();
  let result = "";
  for (const char of str) {
    if (!seen.has(char)) {
      result += char;
      seen.add(char);
    }
  }
  return result;
}

export async function saveOptions() {
  const hasErrors = showValidationErrors();
  if (hasErrors) {
    document.querySelector("#save-status").textContent = "Review the highlighted settings";
    document.querySelector(".validation-error")?.scrollIntoView?.({ block: "center" });
    return;
  }

  await Settings.setSettings(getSettingsFromForm());
  const el = document.querySelector("#save");
  el.disabled = true;
  el.textContent = "Saved";
  document.querySelector("#save-status").textContent = "All changes saved";
}

function showElement(el, visible) {
  el.style.display = visible ? null : "none";
}

// Display the UI for link hint numbers vs. characters, depending upon the value of
// "filterLinkHints".
function maintainLinkHintsView() {
  const errors = getValidationErrors();
  const isFilteredLinkhints = getOptionEl("filterLinkHints").checked;
  showElement(
    document.querySelector("#link-hint-characters-container"),
    !isFilteredLinkhints || errors["linkHintCharacters"],
  );
  showElement(
    document.querySelector("#link-hint-numbers-container"),
    isFilteredLinkhints || errors["linkHintNumbers"],
  );
  showElement(
    document.querySelector("#wait-for-enter"),
    isFilteredLinkhints,
  );
}

export function prepareBackupSettings() {
  const settings = Settings.pruneOutDefaultValues(getSettingsFromForm());
  // Serialize the JSON keys in order, so that they're stable across backups. See #4764.
  const keys = Object.keys(settings).sort();
  const sortedSettings = Object.fromEntries(keys.map((k) => [k, settings[k]]));
  // Don't use an array replacer in JSON.stringify; it filters nested object keys too, which would
  // drop nested fields inside exclusionRules (e.g. `pattern`, `passKeys`). See #4853.
  return JSON.stringify(sortedSettings, null, 2) + "\n";
}

function onDownloadBackupClicked() {
  const settings = prepareBackupSettings();
  const blob = new Blob([settings]);
  document.querySelector("#download-backup").href = URL.createObjectURL(blob);
}

export async function restoreBackup(contents) {
  const backup = Settings.validateBackup(JSON.parse(contents));
  // Backups omit default values. Restore defaults as well as the validated customizations.
  await Settings.setSettings({
    ...globalThis.structuredClone(Settings.defaultOptions),
    ...backup,
  });
  setFormFromSettings(Settings.getSettings());
  const saveButton = document.querySelector("#save");
  saveButton.disabled = true;
  saveButton.textContent = "Saved";
  document.querySelector("#save-status").textContent = "Backup restored";
}

function onUploadBackupClicked(event) {
  if (document.activeElement) {
    document.activeElement.blur();
  }

  const files = event.target.files;
  if (files.length === 1) {
    const file = files[0];
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        await restoreBackup(reader.result);
      } catch (error) {
        alert("Failed to restore Brovim backup: " + error.message);
        return;
      } finally {
        event.target.value = "";
      }
      alert("Settings have been restored from the backup.");
    };
    reader.onerror = () => {
      event.target.value = "";
      alert("Failed to read Brovim backup.");
    };
    reader.readAsText(file);
  }
}

const testEnv = globalThis.window == null ||
  globalThis.window.location.search.includes("dom_tests=true");
if (!testEnv) {
  document.addEventListener("DOMContentLoaded", async () => {
    await Settings.onLoaded();
    DomUtils.injectUserCss();
    await Commands.init();
    await init();
    // Alt+D changes dark mode while this page is open. Show it, so saving doesn't undo it.
    Settings.addEventListener("change", () => {
      getOptionEl("darkModeEnabled").checked = Settings.get("darkModeEnabled");
    });
  });
}
