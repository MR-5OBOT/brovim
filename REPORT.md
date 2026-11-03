# vim-browser: Feature Streamlining & Pruning Report

**Repository:** `MR-5OBOT/vim-browser`\
**Base:** Forked from `philc/vimium`\
**Date:** November 3, 2026\
**Status:** Completed, verified, and pushed to `master`

---

## 1. Executive Summary

`vim-browser` was streamlined by stripping out 19 deprecated, bloated, or niche features, removing
**1,959 lines of dead code** across 26 files while maintaining 100% test pass rates and zero lint
errors.

The default link hint badge style was updated to custom purple theme (`#68039B` with white bold
text).

---

## 2. Complete List of 19 Dropped Features & Code Changes

| #  | Dropped Feature              | Default Key(s)    | Files & Mechanisms Removed                                                                                                                                                                                                                        |
| -- | ---------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1  | **Marks**                    | `m`, `'`, `` ` `` | Deleted `background_scripts/marks.js`, `content_scripts/marks.js`, `tests/unit_tests/marks_test.js`. Removed `Marks.activateCreateMode`, `Marks.activateGotoMode`, and `Marks.setPreviousPosition()`. Pruned `tabLoadedHandlers` from background. |
| 2  | **Visual / Caret Mode**      | `v`, `V`          | Deleted `content_scripts/mode_visual.js` (615 lines). Removed `enterVisualMode` and `enterVisualLineMode` from command registries, `mode_normal.js`, and `manifest.json`.                                                                         |
| 3  | **Pagination Guessing**      | `]]`, `[[`        | Removed `goPrevious` and `goNext` commands. Removed DOM heuristic scanners (`followLink`, `findLink`, `findElementWithRelValue`). Removed `previousPatterns` and `nextPatterns` from settings, options page HTML, and JS.                         |
| 4  | **Frame Navigation**         | `gf`, `gF`        | Removed `nextFrame` and `mainFrame` from `all_commands.js`, `commands.js`, `mode_normal.js`, and `main.js`. Removed frame cycling tests in `main_test.js`.                                                                                        |
| 5  | **Count Prefixes**           | Digits (`0-9`)    | Removed `isCountKey` and `countPrefix` from `content_scripts/mode_key_handler.js`. Digits are no longer intercepted or buffered as repeat counters on keydown. Removed repeat limit confirmation prompts in `mode_normal.js`.                     |
| 6  | **Download Mode in Hints**   | Option / Unmapped | Removed `DOWNLOAD_LINK_URL` and `LinkHints.activateModeToDownloadLink` from `link_hints.js`, `all_commands.js`, and `mode_normal.js`.                                                                                                             |
| 7  | **Hover Mode in Hints**      | Option / Unmapped | Removed `HOVER_LINK`, `action: "hover"`, and the entire `HoverMode` class from `link_hints.js`.                                                                                                                                                   |
| 8  | **Focus Mode in Hints**      | Option / Unmapped | Removed `FOCUS_LINK` and `action: "focus"` from `link_hints.js`.                                                                                                                                                                                  |
| 9  | **Foreground Mode in Hints** | `<c-f>`           | Removed `OPEN_IN_NEW_FG_TAB` and `LinkHints.activateModeToOpenInNewForegroundTab` from `link_hints.js`, `all_commands.js`, and `mode_normal.js`.                                                                                                  |
| 10 | **Edit URL in New Tab**      | `gE`              | Removed `Vomnibar.activateEditUrlInNewTab` from `all_commands.js`, `commands.js`, `vomnibar.js`, and `mode_normal.js` (retaining in-place `ge`).                                                                                                  |
| 11 | **Search Highlighted Text**  | `*`, `#`          | Removed `findSelected`, `findSelectedBackwards`, and `findSelectedHelper` from `all_commands.js`, `commands.js`, and `mode_normal.js`.                                                                                                            |
| 12 | **Regex in Find Mode**       | `/` (Regex mode)  | Removed `regexFindMode` setting from `lib/settings.js`, `options.html`, and `options.js`. Removed `\r` and `\R` escape parsers in `content_scripts/mode_find.js`. Searches now run strictly as literal text matches with smartcase.               |
| 13 | **Command Palette Mode**     | `:`               | Removed `Vomnibar.activateCommandSelection` from command registries, `vomnibar.js`, and `mode_normal.js`. Removed `CommandCompleter` from `completers.js`, `main.js`, and `vomnibar_page.js`.                                                     |
| 14 | **First / Last Tab**         | `g0`, `g$`        | Removed `firstTab` and `lastTab` from `all_commands.js`, `commands.js`, and `main.js`. Removed `"first"` and `"last"` cases from `selectTab` in `main.js`.                                                                                        |
| 15 | **Duplicate Tab**            | `yt`              | Removed `duplicateTab` from `all_commands.js`, `commands.js`, and `main.js`.                                                                                                                                                                      |
| 16 | **Move Tab to New Window**   | `W`               | Removed `moveTabToNewWindow` from `all_commands.js`, `commands.js`, and `main.js`.                                                                                                                                                                |
| 17 | **Bulk Tab Closes**          | Unmapped          | Removed `closeTabsOnLeft`, `closeTabsOnRight`, `closeOtherTabs`, and the `removeTabsRelative` helper from `all_commands.js` and `main.js`.                                                                                                        |
| 18 | **URL Path Slicing**         | `gu`, `gU`        | Removed `goUp` and `goToRoot` from `all_commands.js`, `commands.js`, and `mode_normal.js`.                                                                                                                                                        |
| 19 | **Pass Next Key**            | Option / Unmapped | Removed `passNextKey` command from `all_commands.js`, `commands.js`, and `mode_normal.js`. Removed `PassNextKeyMode` class and `passNextKeyKeys` storage listeners from `mode_insert.js`.                                                         |

---

## 3. Link Hint Styling Configuration

The default link hint badge style was updated in both `lib/settings.js` (`userDefinedLinkHintCss`)
and `content_scripts/vimium.css`:

```css
div > .vimiumHintMarker {
  /* linkhint boxes */
  background: -webkit-gradient(linear, left top, left bottom, color-stop(0%,#68039B),
    color-stop(100%,#68039B));
  border: 1px solid #68039B;
}

div > .vimiumHintMarker span {
  /* linkhint text */
  color: white;
  font-weight: bold;
  font-size: 12px;
}

div > .vimiumHintMarker > .matchingCharacter {}
```

---

## 4. Kept Core Features

- **Page Scrolling & Navigation:** `j`, `k`, `h`, `l`, `d`, `u`, `gg`, `G`, `Space`, `Shift+Space`,
  `zH`, `zL`.
- **Core Link Hints:**
  - `f`: Open link in current tab.
  - `F`: Open link in new background tab.
  - `<a-f>`: Multi-link queue mode (open batches of links into background tabs).
  - `yf`: Copy link target URL to clipboard.
  - Incognito hint mode.
- **Literal Find Mode:** `/` (open find bar), `n` (next match), `N` (previous match).
- **Vomnibar:** `o`, `O` (URL/history/bookmarks search), `b`, `B` (bookmarks only), `T` (tabs
  search), `ge` (in-place URL edit).
- **Tab Controls:** `t` (create tab), `x` (close tab), `X` (restore closed tab), `J` / `K` (next /
  previous tab), `^` (jump to last active tab), `<a-p>` (pin/unpin), `<a-m>` (mute/unmute), `<<` /
  `>>` (reorder tab).
- **Clipboard & Navigation:** `yy` (copy URL), `p` / `P` (paste and open URL), `H` / `L` (history
  back / forward), `r` / `R` (reload / hard reload), `i` (insert mode), `gi` (focus input).

---

## 5. Next Steps / Active Roadmap

1. **Vomnibar Visual Overhaul:** Modern floating search palette, refined typography, and smooth
   animations.
2. **Whole-UI Dark/Custom Theming:** Global dark theme engine shared across the Vomnibar, HUD
   notices, and dialogs.
3. **Visual Tab Switcher (TabGlance-style):** Thumbnail grid preview modal displaying open tabs with
   titles, favicons, `h/j/k/l` navigation, and inline `x` tab closing.
4. **Pre-configured Search Engines:** Curated default keywords (`yt`, `gh`, `w`, etc.).

---

## 6. Verification Commands

```bash
# Verify formatting and linting
cd /home/mr5obot/repos/vim-browser
./make.js check

# Run unit tests
./make.js test-unit
```
