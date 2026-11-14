// Browser-owned destinations only. No history, bookmarks, network search or arbitrary URLs.
const common = [
  ["settings", "Settings", "settings/", "preferences options configuration"],
  ["extensions", "Extensions", "extensions/", "addons add-ons plugins manage"],
  ["performance", "Performance", "settings/performance", "memory ram saver speed energy battery"],
  [
    "extension-shortcuts",
    "Extension keyboard shortcuts",
    "extensions/shortcuts",
    "hotkeys bindings",
  ],
  ["downloads", "Downloads", "downloads/", "download files"],
  ["history", "History", "history/", "visited browsing"],
  ["bookmarks", "Bookmarks", "bookmarks/", "favorites saved"],
  ["privacy", "Privacy and security", "settings/privacy", "tracking cookies security"],
  ["site-settings", "Site permissions", "settings/content", "permissions sites camera microphone"],
  [
    "notifications",
    "Notification permissions",
    "settings/content/notifications",
    "notifications alerts",
  ],
  ["appearance", "Appearance", "settings/appearance", "theme toolbar font zoom"],
  ["search", "Search engine", "settings/search", "default search"],
  ["languages", "Languages", "settings/languages", "language translation spellcheck"],
  ["accessibility", "Accessibility", "settings/accessibility", "accessibility captions"],
  ["startup", "On startup", "settings/onStartup", "startup homepage launch"],
  ["system", "System", "settings/system", "hardware graphics acceleration background"],
  [
    "clear-data",
    "Clear browsing data",
    "settings/clearBrowserData",
    "cache cookies delete history",
  ],
  ["discards", "Tab memory and discards", "discards/", "sleeping tabs memory ram diagnostics"],
  ["gpu", "Graphics diagnostics", "gpu/", "gpu video graphics hardware acceleration"],
  ["version", "Browser version", "version/", "about version command line profile information"],
  ["flags", "Experimental flags", "flags/", "experiments features flags"],
  ["pages", "All browser pages", "chrome-urls/", "internal urls pages"],
];

export const browserProfiles = ["auto", "helium", "brave", "chrome", "edge", "chromium"];

export function getBrowserPages(profile = "chromium") {
  if (!browserProfiles.includes(profile) || profile === "auto") profile = "chromium";
  const scheme = profile === "brave" ? "brave" : profile === "edge" ? "edge" : "chrome";
  const overrides = profile === "edge"
    ? { bookmarks: "favorites/", performance: "settings/system/managePerformance" }
    : profile === "brave"
    ? { performance: "settings/system" }
    : {};
  const pages = common.map(([id, title, path, aliases]) => ({
    id,
    title,
    url: `${scheme}://${overrides[id] || path}`,
    aliases,
  }));
  if (profile === "helium") {
    pages.push({
      id: "browser-shortcuts",
      title: "Browser keyboard shortcuts",
      url: "chrome://settings/system/shortcuts",
      aliases: "helium keyboard hotkeys bindings",
    });
  }
  if (profile === "brave") {
    pages.push({
      id: "shields",
      title: "Brave Shields",
      url: "brave://settings/shields",
      aliases: "privacy blocking trackers ads shields",
    });
    pages.push({
      id: "filters",
      title: "Brave content filters",
      url: "brave://settings/shields/filters",
      aliases: "adblock blocking filter lists",
    });
  }
  return pages;
}

export function filterBrowserPages(profile, query = "") {
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return getBrowserPages(profile).map((page, order) => {
    const title = page.title.toLowerCase();
    const words = title.split(/\W+/);
    const text = `${title} ${page.aliases} ${page.url}`.toLowerCase();
    const matches = terms.every((term) => text.includes(term));
    const score = terms.reduce(
      (sum, term) =>
        sum +
        (words.includes(term)
          ? 10
          : words.some((word) => word.startsWith(term))
          ? 6
          : title.includes(term)
          ? 3
          : 1),
      0,
    );
    return { page, order, matches, score };
  }).filter((entry) => entry.matches)
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .map((entry) => entry.page);
}
