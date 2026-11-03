# Brovim: Feature Streamlining & Pruning Report

**Repository:** `MR-5OBOT/brovim` (previously the `MR-5OBOT/vim-browser` fork)\
**Base:** Based on `philc/vimium` (full history kept; no longer a GitHub fork)\
**Date:** November 3, 2026\
**Status:** Completed, verified, and pushed to `master`

---

## 1. Executive Summary

Brovim (formerly `vim-browser`) was streamlined by stripping out 19 deprecated, bloated, or niche
features, removing **1,959 lines of dead code** across 26 files. The first pass left a few live
references to removed code and a red DOM test suite; section 7 lists what the follow-up audit fixed.
Lint, unit tests and DOM tests now all pass.

The default link hint badge style was updated to custom purple theme (`#68039B` with white bold
text).

---

## 2. Complete List of 19 Dropped Features & Code Changes

| #  | Dropped Feature              | Default Key(s)    | Files & Mechanisms Removed                                                                                                                                                                                                                                              |
| -- | ---------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1  | **Marks**                    | `m`, `'`, `` ` `` | Deleted `background_scripts/marks.js`, `content_scripts/marks.js`, `tests/unit_tests/marks_test.js`. Removed `Marks.activateCreateMode`, `Marks.activateGotoMode`, and `Marks.setPreviousPosition()`. Pruned `tabLoadedHandlers` from background.                       |
| 2  | **Visual / Caret Mode**      | `v`, `V`          | Deleted `content_scripts/mode_visual.js` (615 lines). Removed `enterVisualMode` and `enterVisualLineMode` from command registries, `mode_normal.js`, and `manifest.json`.                                                                                               |
| 3  | **Pagination Guessing**      | `]]`, `[[`        | Removed `goPrevious` and `goNext` commands. Removed DOM heuristic scanners (`followLink`, `findLink`, `findElementWithRelValue`). Removed `previousPatterns` and `nextPatterns` from settings, options page HTML, and JS.                                               |
| 4  | **Frame Navigation**         | `gf`, `gF`        | Removed `nextFrame` and `mainFrame` from `all_commands.js`, `commands.js`, `mode_normal.js`, and `main.js`. Removed frame cycling tests in `main_test.js`.                                                                                                              |
| 5  | **Count Prefixes**           | Digits (`0-9`)    | Removed `isCountKey` and `countPrefix` from `content_scripts/mode_key_handler.js`. Digits are no longer intercepted or buffered as repeat counters on keydown. Removed repeat limit confirmation prompts in `mode_normal.js`. `count=N` in a key mapping still repeats. |
| 6  | **Download Mode in Hints**   | Option / Unmapped | Removed `DOWNLOAD_LINK_URL` and `LinkHints.activateModeToDownloadLink` from `link_hints.js`, `all_commands.js`, and `mode_normal.js`.                                                                                                                                   |
| 7  | **Hover Mode in Hints**      | Option / Unmapped | Removed `HOVER_LINK`, `action: "hover"`, and the entire `HoverMode` class from `link_hints.js`.                                                                                                                                                                         |
| 8  | **Focus Mode in Hints**      | Option / Unmapped | Removed `FOCUS_LINK` and `action: "focus"` from `link_hints.js`.                                                                                                                                                                                                        |
| 9  | **Foreground Mode in Hints** | `<c-f>`, Ctrl     | Removed `OPEN_IN_NEW_FG_TAB` and `LinkHints.activateModeToOpenInNewForegroundTab` from `link_hints.js`, `all_commands.js`, and `mode_normal.js`, plus the hold-Ctrl toggle into that mode.                                                                              |
| 10 | **Edit URL in New Tab**      | `gE`              | Removed `Vomnibar.activateEditUrlInNewTab` from `all_commands.js`, `commands.js`, `vomnibar.js`, and `mode_normal.js` (retaining in-place `ge`).                                                                                                                        |
| 11 | **Search Highlighted Text**  | `*`, `#`          | Removed `findSelected`, `findSelectedBackwards`, and `findSelectedHelper` from `all_commands.js`, `commands.js`, and `mode_normal.js`.                                                                                                                                  |
| 12 | **Regex in Find Mode**       | `/` (Regex mode)  | Removed `regexFindMode` setting from `lib/settings.js`, `options.html`, and `options.js`. Removed `\r` and `\R` escape parsers in `content_scripts/mode_find.js`. Searches now run strictly as literal text matches with smartcase.                                     |
| 13 | **Command Palette Mode**     | `:`               | Removed `Vomnibar.activateCommandSelection` from command registries, `vomnibar.js`, and `mode_normal.js`. Removed `CommandCompleter` from `completers.js`, `main.js`, and `vomnibar_page.js`.                                                                           |
| 14 | **First / Last Tab**         | `g0`, `g$`        | Removed `firstTab` and `lastTab` from `all_commands.js`, `commands.js`, and `main.js`. Removed `"first"` and `"last"` cases from `selectTab` in `main.js`.                                                                                                              |
| 15 | **Duplicate Tab**            | `yt`              | Removed `duplicateTab` from `all_commands.js`, `commands.js`, and `main.js`.                                                                                                                                                                                            |
| 16 | **Move Tab to New Window**   | `W`               | Removed `moveTabToNewWindow` from `all_commands.js`, `commands.js`, and `main.js`.                                                                                                                                                                                      |
| 17 | **Bulk Tab Closes**          | Unmapped          | Removed `closeTabsOnLeft`, `closeTabsOnRight`, `closeOtherTabs`, and the `removeTabsRelative` helper from `all_commands.js` and `main.js`.                                                                                                                              |
| 18 | **URL Path Slicing**         | `gu`, `gU`        | Removed `goUp` and `goToRoot` from `all_commands.js`, `commands.js`, and `mode_normal.js`.                                                                                                                                                                              |
| 19 | **Pass Next Key**            | Option / Unmapped | Removed `passNextKey` command from `all_commands.js`, `commands.js`, and `mode_normal.js`. Removed `PassNextKeyMode` class and `passNextKeyKeys` storage listeners from `mode_insert.js`.                                                                               |

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
- **Vomnibar:** `o`, `O` (URL/history/bookmarks search), `b`, `B` (bookmarks only), `ge` (in-place
  URL edit). `T` now opens the visual tab switcher; the Vomnibar tab search is still available as
  the unmapped `Vomnibar.activateTabSelection` command.
- **Tab Controls:** `t` (create tab), `x` (close tab), `X` (restore closed tab), `J` / `K` (next /
  previous tab), `^` (jump to last active tab), `<a-p>` (pin/unpin), `<a-m>` (mute/unmute), `<<` /
  `>>` (reorder tab).
- **Clipboard & Navigation:** `yy` (copy URL), `p` / `P` (paste and open URL), `H` / `L` (history
  back / forward), `r` / `R` (reload / hard reload), `i` (insert mode), `gi` (focus input).

---

## 5. Built Enhancements & New Features

1. **Vomnibar Visual Overhaul:** Modern dark floating search palette with glass shadows, purple
   focus states, refined typography, smooth transitions, and in-place URL editing (`ge`).
2. **Whole-UI Dark/Custom Theming:** Global dark theme engine (`#161224`) with vibrant purple
   accents (`#68039B` / `#8819c9`) shared across the Vomnibar, HUD notices, Help Dialog, and key
   badges.
3. **Visual Tab Switcher (TabGlance-style):** Thumbnail grid preview modal (`TabSwitcher.activate`,
   mapped to `T`), displaying all open tabs with cached screenshots
   (`chrome.tabs.captureVisibleTab`, stored as small thumbnails in `chrome.storage.session`),
   favicons, a search filter (`/`), `h/j/k/l` navigation, and inline `x` tab closing. `Alt+Q` is a
   browser-wide shortcut that works like Alt+Tab.
4. **Curated Search Engine Defaults:** Pre-configured ready-to-use search keywords in
   `lib/settings.js` (`yt` for YouTube, `gh` for GitHub, `w` for Wikipedia, `r` for Reddit, `g` for
   Google, and `ddg` for DuckDuckGo).

---

## 6. Verification Commands

```bash
# Verify formatting and linting
./make.js check

# Run unit tests
./make.js test-unit

# Run DOM tests (Puppeteer). To use an installed Chromium-based browser instead of Puppeteer's:
PUPPETEER_EXECUTABLE_PATH=/opt/helium-browser-bin/chrome ./make.js test-dom
```

---

## 7. Audit Fixes (November 3, 2026)

An audit of this report and `TODOS.md` against the code found these problems, all fixed:

1. **Link hints crashed on Shift/Ctrl.** `link_hints.js` still referenced the removed
   `OPEN_IN_NEW_FG_TAB`, throwing a `ReferenceError` whenever Shift or Ctrl was pressed in hint
   mode. Shift (current tab ⇄ new tab) works again; the Ctrl toggle into foreground-tab mode is gone
   with that mode.
2. **DOM tests were failing (28 of 109).** Tests for removed features (count prefixes, next/previous
   links, Ctrl hint toggle) were deleted, and one test now checks that digits no longer build a
   count. 83/83 pass.
3. **`count=N` mappings were silently ignored.** The key-mapping parser still accepted `count=`, but
   normal mode dropped it. `map J scrollDown count=5` works again.
4. **Leftovers from removed features.** The page still sent a `domReady` message nobody handled
   (marks), and dead code remained for the command palette (`runNormalModeCommand`, `prefixCount`,
   `Suggestion.command`), frame cycling (`getFocusStatus`), hover mode
   (`simulateHover`/`simulateUnhover`), pagination (options CSS), and commented-out visual mode
   tests.
5. **Tab switcher keys didn't match the spec.** `T` opened in Alt+Tab mode (a `?? true` default), so
   `h/j/k/l` did nothing and pressing then releasing Alt switched tabs. `T` now opens a normal grid
   (h/j/k/l, x, Enter, `/` to search, Esc), and only `Alt+Q` uses hold-and-release.
6. **Tab switcher Up/Down moved the wrong number of columns.** The column count was off by one; it
   is now read from the grid's computed columns.
7. **A quick Alt+Q tap did nothing.** Releasing Alt before the tab list loaded closed the switcher.
   The switch now waits for the list.
8. **`x` repeatedly could close the current tab.** After a close, the selection jumped back to the
   active tab. It now stays in place.
9. **Thumbnails vanished after ~30s idle.** They were kept in service-worker memory, which Chrome
   wipes when it suspends the worker. They are now downscaled to 480px thumbnails (a few KB each
   instead of full-size screenshots) and kept in `chrome.storage.session`. Captures also check that
   the tab is still active, so a fast tab switch can't save one tab's pixels under another.
10. **Theme only half applied.** In dark OS mode, `vimium.css` swapped the palette back to Vimium's
    greys. In light mode, the popup footer and command-listing headings turned dark purple with
    black text. The help dialog (`?`) had never been restyled. Now the in-page UI is always dark
    purple, the help dialog matches it, and extension pages stay readable in light mode.
11. **Boxes around the UI.** Large shadows on the Vomnibar, HUD and tab switcher were clipped by
    their iframes into visible rectangles. In light mode, the tab switcher's page declared a
    different color scheme than its iframe, so Chrome painted an opaque black backdrop.
12. **Missing Vomnibar polish.** The search icon and opening transition that `TODOS.md` listed were
    not there; both are added (opening fades in; closing stays instant).
13. **Test stub bug.** The `chrome.storage` stub threw when `get` was passed an array of keys.

The extension was also renamed to **Brovim** (manifest, user-visible strings, help/options pages,
build zips, and a new Firefox add-on ID, since the old one belongs to Vimium on AMO).
