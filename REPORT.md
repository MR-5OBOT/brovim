# Brovim: Project Report and Verification

**Repository:** `MR-5OBOT/brovim`\
**Date:** November 6, 2026\
**Status:** The switcher lists every awake tab in a grid that grows to fit, and the reported
extension errors are fixed; verified. See section 17.

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
| 2  | **Visual / Caret Mode**      | `v`, `V`          | Initially deleted, then **restored** in `5e0362d9`: `content_scripts/mode_visual.js` restored with full Vim visual selection (`v`, `V`, `c`, `y`, `w`, `b`, `e`, `gg`, `G`, `0`, `$`, etc.) and multi-range shadow DOM support.                                         |
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

The Options page has a **Theme** section with three color pickers and individual Reset links:

| Setting              | Default   | Purpose                    |
| -------------------- | --------- | -------------------------- |
| `linkHintColor`      | `#68039b` | Hint background and border |
| `linkHintTextColor`  | `#ffffff` | Hint letters               |
| `linkHintMatchColor` | `#d4ac3a` | Letters already typed      |

Save changes, return to an already-open page, and press `f`. Hint containers read the current
settings when they open, so a page reload is unnecessary. Colors persist in synced settings. The
**CSS for Brovim UI** field in Advanced Options still takes precedence over the pickers. Existing
explicit custom CSS is preserved, including any colors it overrides.

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
- **Vomnibar:** `o`, `O` (URL/history/web search; active tab switching excluded), `b`, `B`
  (bookmarks only), `ge` (in-place URL edit). The tab search is still available as the unmapped
  `Vomnibar.activateTabSelection` command.
- **Tab Controls:** `x` (close tab), `X` (restore closed tab), `<a-p>` (pin/unpin), `<a-m>`
  (mute/unmute), `<<` / `>>` (reorder tab). (Note: `t`, `J`, `K`, `^` were intentionally dropped so
  browser native tabs and shortcuts handle tab cycling).
- **Clipboard & Navigation:** `yy` (copy URL), `H` / `L` (history back / forward), `r` / `R` (reload
  / hard reload), `i` (insert mode), `gi` (focus input), `v` / `V` (visual / caret mode). Clipboard
  paste commands (`openCopiedUrlInCurrentTab`, `openCopiedUrlInNewTab`) remain available for custom
  key mapping.

---

## 5. Built Enhancements & New Features

1. **Vomnibar Visual Overhaul:** Modern dark floating search palette with glass shadows, purple
   focus states, refined typography, smooth transitions, and in-place URL editing (`ge`).
2. **Whole-UI Dark/Custom Theming:** Global dark theme engine (neutral dark grey, `#141414`) with
   purple accents (`#68039B` / `#8819c9`) shared across the Vomnibar, HUD notices, Help Dialog, and
   key badges.
3. **Visual Tab Switcher:** A black (or liquid glass) panel of tab cards over a lightly blurred
   page; the cards follow the system's light or dark theme. `Alt+Q` shows the 10 most recently used
   tabs (cards per row and rows are settings) with the previous tab selected; releasing Alt
   switches. Cards have a preview or a letter tile, the title and the site, and a `×` to close.
   Previews are captured when a page has settled and kept by URL in local storage (session storage
   for incognito).
4. **Curated Search Engine Defaults:** Pre-configured ready-to-use search keywords in
   `lib/settings.js` (`yt` for YouTube, `gh` for GitHub, `w` for Wikipedia, `r` for Reddit, and
   `ddg` for DuckDuckGo). No Google keyword.

---

## 6. Verification Commands

```bash
# Verify formatting and linting
./make.js check

# Run unit tests
./make.js test-unit

# Run DOM tests (Puppeteer). To use an installed Chromium-based browser instead of Puppeteer's:
PUPPETEER_EXECUTABLE_PATH=/opt/helium-browser-bin/chrome ./make.js test-dom

# Run full browser end-to-end test suite:
PUPPETEER_EXECUTABLE_PATH=/opt/helium-browser-bin/chrome ./make.js test-browser

# Build store package
./make.js package
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
   `h/j/k/l` did nothing and pressing then releasing Alt switched tabs. The grid supports h/j/k/l,
   x, Enter and Esc; the final default binding is `Alt+Q`, with `T` later unmapped (item 19).
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
10. **Theme only half applied.** In dark OS mode, `vimium.css` swapped the palette back to the old
    greys. In light mode, the popup footer and command-listing headings turned dark purple with
    black text. The help dialog (`?`) had never been restyled. Now the in-page UI is always dark
    (neutral grey surfaces, purple accents), the help dialog matches it, and extension pages stay
    readable in light mode.
11. **Boxes around the UI.** Large shadows on the Vomnibar, HUD and tab switcher were clipped by
    their iframes into visible rectangles. In light mode, the tab switcher's page declared a
    different color scheme than its iframe, so Chrome painted an opaque black backdrop.
12. **Missing Vomnibar polish.** The search icon and opening transition that `TODOS.md` listed were
    not there; both are added (opening fades in; closing stays instant).
13. **Test stub bug.** The `chrome.storage` stub threw when `get` was passed an array of keys.
14. **"Extension context invalidated" after reloading the extension.** Content scripts left running
    in already-open tabs threw on their next focus/URL check. They now shut themselves down.
15. **Missing icon on the command listing.** The page requested a `github.svg` that didn't exist;
    it's a plain text link now.
16. **Rapid `f` keypress buffering for alphabet hints.** `CacheAllKeydownEvents` had pushed captured
    events to a local closure array while `this.keydownEvents` remained an empty instance field, and
    replay had an improper condition check. Events arriving while hints are being collected across
    frames are now properly buffered and replayed, so rapid keypresses (such as typing `f` again to
    follow an `F` hint marker) are retained. `Esc` cancels hints rather than treating `f` as a
    toggle.
17. **Key handler crash on uninitialized session state.** If session storage was queried before
    `Commands.init()` completed, `NormalMode` could pass `undefined` to `setKeyMapping`, resulting
    in `keyState: [undefined]` and crashing with
    `Cannot use 'in' operator to search for 'f' in
    undefined`. `KeyHandlerMode.setKeyMapping`
    now defaults safely to `{}`, `isMappedKey` and related lookups guard against non-object entries,
    `mode_normal.js` guards undefined storage, and `initializeFrame` in `main.js` awaits background
    initialization.
18. **Centered Vomnibar with darker purple theme and reduced radius.** Vomnibar is now centered
    horizontally and vertically within the viewport (`top: 0; left: 0; width: 100%; height: 100%`
    overlay with flexbox centering). The input focus ring was darkened (`#4a026e`), and corner radii
    were tightened to 4px for a sharper aesthetic.
19. **Dropped `T` key to open tab switcher.** `T` has been unmapped from `defaultKeyMappings` in
    `commands.js`.
20. **Tab switcher membership & auto-switch.** Following the user's final confirmation, the list
    includes every open tab in the window, ordered by recency; unvisited tabs follow by
    lastAccessed. No numeric cap. Releasing `Alt` switches to the selected tab; Enter also confirms
    a selection.
21. **Vomnibar `omni` excludes active tabs; limited to history and web search.**
    `completionSources.tabs` was removed from the `omni` completer. Typing in `o`/`O` now focuses
    strictly on URLs, browsing history, domain completions, and web search queries (typing words
    like "hola" searches via the search engine), without switching to open tabs. Tab switching is
    dedicated to `Alt+Q`.

The extension was also renamed to **Brovim** (manifest, user-visible strings, help/options pages,
build zips, and its own Firefox add-on ID).

## 8. Consolidated Roadmap

Previously maintained in `TODOS.md`; this report is now the canonical project record.

### 1. Vomnibar Visual Overhaul

- [x] **Floating Palette Design:** Redesign the floating search bar with modern dark borders,
      rounded corners, subtle shadows, and clean margins.
- [x] **Input & Typography:** Refined font hierarchy, a search icon, and smooth focus states.
- [x] **Smooth Transitions:** The bar fades in each time it opens. Closing is instant, so the
      selected action never waits on an animation.
- [x] **In-Place URL Editing (`ge`):** Ensure editing current URLs opens seamlessly with cursor
      placed at the end without flicker.

---

### 2. Whole-UI Theme Engine

- [x] **Unified Color System:** Build a global CSS variable palette: neutral dark grey surfaces with
      purple accents (`#68039B` to match the default link hints). The in-page UI uses it in both
      light and dark OS themes; the options, popup and command-listing pages stay light in a light
      theme.
- [x] **Vomnibar Styling:** Apply the unified dark theme to the Vomnibar background, input field,
      and completion results.
- [x] **HUD & Notifications:** Style bottom-right HUD alerts (e.g., "Yanked URL", "No query to
      find") with dark translucent glass and purple highlights.
- [x] **Help Cheat-Sheet (`?`):** Modernize the help modal with clean tables and matching dark
      styling.

---

### 3. Visual Tab Switcher

- [x] **Snapshot Caching Service:** The page's content script waits until it has settled (no visible
      DOM change, layout shift or new largest paint for 800ms, at most 4.8s) after loading, coming
      into view, a URL change or a long scroll, and just before the switcher opens. The background
      captures it, downscales it to 480px and keeps the newest 60 by URL in `chrome.storage.local`
      (incognito: `chrome.storage.session`). Never captured while Brovim's UI is showing.
- [x] **Preview Grid UI:** A panel of 5 cards per row, 2 rows, a scroll hint when cards overflow; a
      click outside closes it.
- [x] **Card Components:** Preview (4:3), two-line title, site name, and a `×` close button.
- [x] **Fallback Cards:** The site's first letter on a color derived from the site.
- [x] **Keyboard Navigation:**
  - Move selection across the grid using `h`, `j`, `k`, `l` (and arrow keys).
  - Press `Enter` to switch to the selected tab.
  - Press `x` to close the selected tab directly from the grid.
  - Press `Esc` (or click outside) to dismiss the switcher.
- [x] **Keybinding:** Dedicated browser shortcut (`Alt+Q`). Unmapped from `T` per user direction.
- [x] **Alt+Q:** Browser-wide shortcut that works like Alt+Tab: hold Alt, tap Q to cycle, release to
      switch.

---

### 4. Curated Search Engine Defaults

- [x] Pre-populate `searchEngines` setting with curated keywords:
  - `yt`: YouTube search (`https://www.youtube.com/results?search_query=%s`)
  - `gh`: GitHub search (`https://github.com/search?q=%s`)
  - `w`: Wikipedia search (`https://www.wikipedia.org/w/index.php?title=Special:Search&search=%s`)
  - `r`: Reddit search (`https://www.reddit.com/search/?q=%s`)
  - `ddg`: DuckDuckGo search (`https://duckduckgo.com/?q=%s`)

---

### 5. Minor Utilities Review & Cleanup

- [x] Browser zoom shortcuts (`zi` / `zo` / `z0`): Kept and working.
- [x] View source (`gs`): Kept and working.
- [x] Clipboard paste-and-open (`p` / `P`): Kept and working.
- [x] Clipboard URL yank (`yy`): Kept and working.

---

### Verification Checklist

- [x] Code passes `./make.js check` (zero format or lint errors).
- [x] Tests pass `./make.js test-unit` (100% green).
- [x] Tests pass `./make.js test-dom` (100% green; tests for removed features deleted).

## 9. Archived Feature Removal Plan

The original plan is retained below for traceability. Its implementation is complete; current
behavior and verification results take precedence over historical intentions.

**Goal:** Remove 19 deprecated/unwanted features from vim-browser to make the codebase lean, fast,
and focused on core navigation.

**Architecture:** Prune command definitions from `all_commands.js` and `commands.js`, remove dropped
content scripts (`mode_visual.js`, `marks.js`) and background modules (`marks.js`), remove unused
handlers in `mode_normal.js`, `link_hints.js`, `mode_insert.js`, `mode_find.js`, `vomnibar.js`, and
`main.js`, update `manifest.json`, and prune associated unit tests.

**Tech Stack:** JavaScript (ES modules), WebExtensions Manifest V3, Deno (task runner / test
runner).

**Spec:** Prune the 19 features specified by the user:

1. Marks (`m`, `'`)
2. Visual Mode (`v`, `V`)
3. Pagination Guessing (`]]`, `[[`)
4. Frame Navigation (`gf`, `gF`)
5. Count Prefixes (`5j`, `3t`, etc.)
6. Download Mode in Link Hints
7. Hover Mode in Link Hints
8. Focus Mode in Link Hints
9. Foreground Mode in Link Hints (`<c-f>`)
10. Edit URL in New Tab (`gE`)
11. Search Highlighted Text (`*`, `#`)
12. Regex in Find Mode
13. Command Palette (`:`)
14. First/Last Tab (`g0`, `g$`)
15. Duplicate Tab (`yt`)
16. Move Tab to New Window (`W`)
17. Bulk Tab Closes (`closeTabsOnLeft`, `closeTabsOnRight`, `closeOtherTabs`)
18. URL Path Slicing (`gu`, `gU`)
19. Pass Next Key (`passNextKey`)

### Global Constraints

- Must pass `./make.js test-unit` with 0 failures.
- Must pass `./make.js check` (linter and code formatting) cleanly.
- Do not break core kept features: scrolling, core link hints (`f`, `F`, `<a-f>`), literal find
  (`/`, `n`, `N`), Vomnibar (`o`, `O`, `b`, `B`, `ge`) and visual tab switcher (`Alt+Q`), tab
  switching (`J`, `K`), reload, copy URL (`yy`).

### Review Focus

- Unbound or removed commands should not throw unhandled exceptions if configured in custom
  mappings.
- Number keys (0-9) must no longer buffer as count prefixes or block normal web page typing.
- Link hints must only activate supported modes (current tab, new background tab, queue, copy url,
  incognito).
- Removing marks must not break `scrollToTop`, `scrollToBottom`, or find mode.
- In-page find must function cleanly as literal search without regex syntax errors.

---

#### Task 1: Clean Command Registries & Key Mappings

**Files:**

- Modify: `background_scripts/all_commands.js`
- Modify: `background_scripts/commands.js`
- Modify: `tests/unit_tests/commands_test.js`

#### Task 2: Remove Marks and Visual Mode

**Files:**

- Delete: `content_scripts/marks.js`
- Delete: `background_scripts/marks.js`
- Delete: `content_scripts/mode_visual.js`
- Delete: `tests/unit_tests/marks_test.js`
- Modify: `manifest.json`
- Modify: `pages/all_content_scripts.js`
- Modify: `content_scripts/mode_normal.js`
- Modify: `content_scripts/vimium_frontend.js`
- Modify: `background_scripts/main.js`

#### Task 3: Remove Frame Navigation and URL Hierarchy Slicing

**Files:**

- Modify: `background_scripts/all_commands.js`
- Modify: `background_scripts/commands.js`
- Modify: `background_scripts/main.js`
- Modify: `content_scripts/mode_normal.js`
- Modify: `content_scripts/vimium_frontend.js`

#### Task 4: Remove Unwanted Tab Controls

**Files:**

- Modify: `background_scripts/all_commands.js`
- Modify: `background_scripts/commands.js`
- Modify: `background_scripts/main.js`
- Modify: `tests/unit_tests/tab_operations_test.js`
- Modify: `tests/unit_tests/main_test.js`

#### Task 5: Remove Count Prefixes and PassNextKey

**Files:**

- Modify: `content_scripts/mode_key_handler.js`
- Modify: `content_scripts/mode_normal.js`
- Modify: `content_scripts/mode_insert.js`
- Modify: `background_scripts/commands.js`

#### Task 6: Prune Link Hints Modes (Download, Hover, Focus, Foreground)

**Files:**

- Modify: `content_scripts/link_hints.js`
- Modify: `content_scripts/mode_normal.js`
- Modify: `tests/unit_tests/link_hints_test.js`

#### Task 7: Remove Pagination Guessing and Search Highlighted Text

**Files:**

- Modify: `content_scripts/mode_normal.js`
- Modify: `lib/settings.js`

#### Task 8: Simplify Find Mode to Literal Search

**Files:**

- Modify: `content_scripts/mode_find.js`
- Modify: `lib/settings.js`

#### Task 9: Remove Command Mode (:) and Edit URL in New Tab (gE) from Vomnibar

**Files:**

- Modify: `content_scripts/vomnibar.js`
- Modify: `background_scripts/completion/completers.js`
- Modify: `background_scripts/main.js`
- Modify: `pages/vomnibar_page.js`
- Modify: `tests/unit_tests/completion/completers_test.js`

#### Task 10: Run Verification and Linting

- Run: `./make.js test-unit`
- Run: `./make.js check`
- Ensure all tests pass cleanly with zero lint errors.

## 10. Earlier Browser Audit (November 4, 2026)

Historical snapshot; section 11 records the current behavior and verification.

The pre-streamlining code and history (commit `5aa29614`) were used as the reference for core
keyboard behavior. The 19 intentional feature removals remain in place.

### Fixes and requested changes

- **Default exclusions:** none. Brovim runs on every site, Gmail and WhatsApp Web included.
- **Saved hint colors:** open pages now use the latest box, text and typed-letter colors on the next
  `f`; Reset and CSS overrides are verified in the browser. Each hint container appends the current
  theme and custom stylesheet after the base styles. A regression check deliberately inserts the
  base stylesheet last, reproducing the navigation race that previously overrode saved colors.
- **Smooth scrolling:** absolute jumps (`gg`, `G`, `zH`, `zL`) cancel conflicting animations on the
  same element and axis. Previously, a rapid `G` then `gg` could finish partway down the page.
- **Hint startup and cancellation:** alphabet and filtered hints replay typing buffered during
  collection, including a fast second `f` selecting an `F` label. `Esc` cancels pending collection
  across frames, preventing late replies from reopening hints. Unit and installed-browser checks
  delay collection to exercise both selections and cancellation.
- **Backup restore:** settings omitted from a backup now revert to defaults rather than retaining
  current customizations. Legacy backups migrate before defaults are applied. The import handler
  receives its event explicitly, and downloads use `brovim-options.json`.
- **Clipboard denial:** failed reads and writes are caught, focus is restored, and a useful HUD
  message appears. A failed paste never navigates or keeps a stale callback. Browser permission
  denial is respected; users must allow clipboard access in their site permissions to use `p`/`P`.
- **Invalidated extension contexts:** URL/focus checks handle invalidation both before and during
  their background request. Existing tabs shut down old handlers after the extension is replaced.
- **Recent-tab switcher:** the 10 most recently used tabs in the current window (its default 5x2
  grid), the active tab first, with links opened in the background right after the current tab.
  Closing a card refills the grid from the older tabs. Tab bar order, liquid glass, layout and
  preview settings live in Options › Tab switcher. Two-tab windows swap directly by default.
- **Fast browser-wide switching:** quick Alt+Q taps activate the previous eligible tab without
  creating a preview frame. Holding Alt on ordinary websites opens the in-page grid; thumbnails load
  separately so navigation does not wait for them. Protected pages switch directly. The separate
  switcher window has been removed. Local quick-swap samples were 11–13 ms; this measures the
  extension request through tab activation, not the monitor's displayed frame.
- **Unresponsive pages:** a missing ready reply is bounded to 350 ms before direct switching.
  Missing content scripts get a bounded recovery attempt. Cancelled requests cannot open a late
  grid. Browser checks cover a paused page, excluded sites and focused inputs.
- **Extension updates:** existing website tabs receive fresh content scripts automatically. A local
  mirror preserves visited-tab history across extension reloads; browser startup clears the mirror
  so filtering remains scoped to the current session.
- **Actual Helium shortcut:** Alt+Q is assigned to Brovim in the running browser profile. The
  conflicting assignment from another extension was removed through the browser shortcut settings.
  Applied this update to the live browser while preserving nine visit records. Native Alt+Q switched
  without creating a window, and the destination website had the new content scripts without a
  refresh.
- **Settings redesign:** grouped sections, sidebar navigation, responsive cards, clearer new-tab
  choices, actual shortcut assignment, a shortcut-management button, live hint-color previews, and
  explicit unsaved/saved feedback. Desktop and narrow mobile layouts are verified.
- **Help cleanup:** removed the visible attribution/version footer banner and Wiki link.
- **Packaging:** replaced the missing `rsync` dependency with Deno file copying, preserving build
  exclusions and excluding documentation directories. All three ZIPs build successfully.

### Verification

| Check                                                                        | Result                                                    |
| ---------------------------------------------------------------------------- | --------------------------------------------------------- |
| Formatting and lint (`./make.js check`)                                      | Pass                                                      |
| Unit tests (`./make.js test-unit`)                                           | 178/178 pass                                              |
| DOM tests (`./make.js test-dom`)                                             | 87/87 pass                                                |
| Installed-extension browser checks                                           | 43/43 pass from source and the extracted Chrome Store ZIP |
| Chrome Store, Chrome Canary, Firefox builds                                  | Pass                                                      |
| Archive CRC, manifest paths, HTML assets, source freshness, build exclusions | Pass for all three ZIPs                                   |

The first packaged run hit a timeout opening the Vomnibar after navigation; the complete rerun
passed all 43 checks without code changes. This timing-sensitive test remains worth monitoring.

The browser suite is `./make.js test-browser`. Set `PUPPETEER_EXECUTABLE_PATH` to an installed
Chromium browser. Set `BROVIM_EXTENSION_PATH` to an extracted package directory to test the ZIP's
actual contents. Tests use a temporary browser profile and local fixtures without touching personal
browser tabs or settings.

Browser coverage includes color saving/reset/overrides; scrolling; input and insert modes; literal
find and n/N; alphabet, queue and filtered hints; Shift/Ctrl; embedded-frame links; clipboard copy,
paste and denial; URL/bookmark/search navigation; tab creation, closing, restoration, reordering,
pin/mute/zoom; view source; help; popup exclusions; settings backup/restore; custom mapping
validation; recent-tab filtering and selection; thumbnails; quick Alt release; light/dark appearance
and resize. Actual X11 keyboard input in an isolated Helium profile also exercised Alt+Q and Alt
release on a web page, `chrome://extensions/`, `chrome://newtab/` and `about:blank`, using the built
Chrome Store package. An additional strict `style-src 'none'` fixture confirmed that hint styling
still works with the navigation load-order fix. Three public YouTube tabs were also tested with
actual keyboard input: Alt+Q switched between tabs, `f` displayed link hints, and no page errors
occurred.

### Practical limits and using the changes

Firefox's package and manifest are validated, but Firefox runtime behavior was not tested. Browser
pages such as `chrome://extensions` forbid page scripts, so Alt+Q switches directly without a grid.
Incognito mode and every possible website were not exercised. These checks cover the tested flows;
they are not a guarantee of zero bugs on every site/browser.

Extension reloads now restore controls on existing website tabs automatically. Historical entries in
the browser's extension error list are not evidence of a fresh error.

### Consolidated reports

`REPORT.md` is the canonical report. `TODOS.md` and the old standalone plan were incorporated into
sections 8 and 9, then removed. The duplicate `~/reports/vim-browser-streamlining-report.md` is now
a symlink to this file, so both locations show one maintained report.

## 11. Current Brovim Audit and Cleanup (November 4, 2026)

This audit reviewed the existing work against the screenshots and the user's follow-up requests. The
user clarified that only sleeping tabs should be hidden; awake background tabs remain listed.

### Current behavior

- The switcher lists awake tabs in the current window, with the active tab first and MRU order by
  default. Discarded, frozen and hidden tabs are excluded from both the grid and direct switching.
- Grid opening no longer waits for a screenshot capture (formerly up to 150 ms), thumbnail loading
  (formerly up to 100 ms), or a fade animation. Cycling updates the selected cards without
  rebuilding the grid. Passive preview capture remains available.
- Navigating a tab invalidates its old preview. Failed capture attempts no longer consume the
  successful-capture cooldown, so a loading page can be captured once it finishes.
- The redundant New tabs settings card, custom blank-page startup and automatic Vomnibar behavior
  are removed. Legacy backups ignore the retired preferences.
- The commands `createTab`, `previousTab`, `nextTab` and `visitPreviousTab`, their handlers, and the
  bindings `t`, `J`, `K`, `gt`, `gT` and `^` are removed. `o`/`O` provide URL entry and search;
  `Alt+Q` provides tab switching. Close/restore, tab reordering, pinning and muting remain
  available.
- Help always shows every bound command and the actual assigned browser switcher shortcut. The
  advanced-command toggle, hidden-row CSS, command classification and stored preference are removed.
- The Vomnibar has a softer layered shadow, a clearer purple focus ring, and fits narrow screens.
  The existing settings layout is retained and works after malformed tab-order imports.

### Repository cleanup

Removed the unused development reload pair (`pages/reload.html`, `background_scripts/reload.js`),
the broken old Vomnibar demo pair (`test_harnesses/vomnibar_harness.html` and `.js`), empty plan
folders, obsolete settings CSS, and dead parser support used only by the removed create-tab command.
Removed broken README links to files already absent before this audit. Automated tests, build tools,
remaining manual fixtures and the consolidated report are retained. Generated packages are rebuilt
from the current source; development/test files remain excluded.

### Verification

| Check                                                            | Result                      |
| ---------------------------------------------------------------- | --------------------------- |
| Formatting and lint (`./make.js check`)                          | Pass                        |
| Unit tests (`./make.js test-unit`)                               | 178/178 pass                |
| DOM tests in Helium/Chromium                                     | 87/87 pass                  |
| Installed source browser suite                                   | 51/51 pass                  |
| Extracted Chrome Store ZIP browser suite                         | 51/51 pass                  |
| Chrome Store, Canary and Firefox package builds                  | Pass                        |
| ZIP CRC, source freshness, local JS imports and build exclusions | Pass for all three packages |
| Source imports and HTML asset paths                              | All resolved                |
| Final diff whitespace check                                      | Pass                        |

The final source run measured a quick-swap request at 12 ms and 19 queued cycles at 32 ms. The
packaged run measured 21 ms for each. These are measurements in an isolated test browser, not a
latency guarantee for every machine or website. The rapid-cycle check confirms that selection
changes preserve the preview cards and commit the final highlighted tab on Alt release.

Rendered Help, settings and Vomnibar screenshots were inspected. The browser suite verifies all
remaining default binding groups, removed-key pass-through, current-window awake-tab eligibility,
slow-thumbnail navigation, early Alt release, protected/excluded pages, preview invalidation and
extension replacement. Runtime checks use Helium/Chromium; Firefox packaging is validated without
claiming Firefox runtime coverage.

Reload Brovim on the browser's extensions page to activate the source changes in an existing
installation. The current packages are under `dist/chrome-store`, `dist/chrome-canary` and
`dist/firefox`. Changes remain uncommitted.

## 12. First-Opening Thumbnails and Performance (November 4, 2026)

The user requested thumbnails on first load, refreshed each time, with switching speed checked.
Existing locally saved previews now accompany the first tab-list response from a preloaded memory
cache. A slow storage read or screenshot never holds up the grid or keys. Only the displayed cards'
images are included (at most 18), so a large window does not send every saved image on each opening.
Missing images still load asynchronously.

Visible pages get a preview after their first paint, even while slower resources are loading,
followed by a settled refresh. Returning to a tab refreshes it even when its previous capture is
recent. Navigation, SPA route changes and long scrolls also schedule updates. Tracking-parameter
variants share the most recent capture rather than allowing an older exact URL to win.

Early rate-limited captures retry independently of the settling wait. Leaving a tab cancels its
settling observer/timer; returning starts a fresh capture. A route change during settling, including
one during an older pending capture, retains its own early capture. Capture requests check both
before and after the screenshot that Brovim UI is absent.

The repeated-opening benchmark found a separate race: the previous close's delayed focus-restore
message could dismiss a newly opened grid. Focus restoration now leaves a newly focused Brovim UI
alone. The same rapid open/close loop passes after the fix.

The general audit also fixed group mute mappings: the unmute branch was unreachable, and querying
only audible tabs omitted muted tabs whose playback had stopped. Mute notifications now target the
requesting frame rather than every iframe. Regression tests reproduced the failures before the
fixes; independent review checked the changes and identified the route-during-settling edge case.

### Verification and measurements

| Check                                                                                | Result             |
| ------------------------------------------------------------------------------------ | ------------------ |
| Formatting/lint                                                                      | Pass               |
| Unit tests                                                                           | 198/198 pass       |
| DOM tests in Helium/Chromium                                                         | 87/87 pass         |
| Installed source browser suite                                                       | 54/54 pass         |
| Extracted Chrome Store ZIP browser suite                                             | 54/54 pass         |
| Chrome Store, Canary and Firefox builds                                              | Pass               |
| ZIP CRC, manifest paths, local imports, HTML assets, source freshness and exclusions | Pass for all three |

The source browser suite measured:

| Interaction                                                  | Time                        |
| ------------------------------------------------------------ | --------------------------- |
| First opening with cached, decoded thumbnails                | 90 ms                       |
| Cached grid opening, 10 immediate reopenings                 | 13 ms median; 30 ms maximum |
| Quick swap without a preview frame                           | 30 ms                       |
| 19 queued selection cycles                                   | 22 ms total                 |
| First-paint thumbnail saved while an image was still loading | 760 ms                      |
| Changed thumbnail saved on a repeat visit                    | 830 ms                      |

The packaged extension measured 98 ms for the first cached opening; 15 ms median and 28 ms maximum
for 10 reopenings; 25 ms for a quick swap; and 23 ms for 19 queued cycles. Its first-paint capture
was saved in 749 ms, with a changed repeat-visit preview saved in 832 ms.

These are isolated-browser measurements, including automation overhead, rather than timing
guarantees. The first-opening check blocks the separate image-loading response to prove the first
draw already has cached thumbnails; its rapid reopenings also cover the focus race. A delayed-image
fixture proves early capture happens before full page load and is refined afterward.

Previews stay on the device. Chrome's
[captureVisibleTab API](https://developer.chrome.com/docs/extensions/reference/api/tabs#method-captureVisibleTab)
captures only the active tab in a window. A tab with no saved preview therefore gets its first
screenshot when viewed; background tabs are never activated just to collect images. Incognito
preview separation is covered by unit tests. Firefox's package is validated; Firefox runtime and
incognito browser behavior were not exercised in this follow-up. The checks do not establish that
every website/browser combination has zero bugs.

Reload the extension to activate the changes. Updated packages are under `dist/chrome-store`,
`dist/chrome-canary` and `dist/firefox`.

## 13. Reported Startup Errors, Tab Ordering and Runtime Coverage (November 4, 2026)

The user supplied an extension-error screenshot showing an undefined `initializeFrame` response
being dereferenced as `response.isEnabledForUrl`, plus missing-receiver promise rejections. Browser
regressions reproduced both classes before the fixes.

- Frame initialization now starts with page keys available, validates replies, and retries empty or
  malformed replies and temporary receiver/channel failures. Invalidated extension contexts shut
  down their orphaned scripts. A frame with no valid reply does not install modes from missing
  state; later focus/navigation checks can reconnect it.
- Concurrent checks preserve a newer focus/navigation invalidation. A delayed response for an older
  URL cannot override the current route's exclusions or pass keys. Both full exclusion and partial
  pass-key cases are exercised with delayed responses.
- Late focus/hint broadcasts and mute notifications tolerate their destination frame disappearing
  after navigation. The previous code produced the screenshot's missing-receiver rejection in the
  service worker; the same browser regression now produces none.

### Tab ordering

Brovim's cycling mode puts the active tab at the first card and preselects the next card. The
user-reported late WhatsApp position led to three independently reproduced ordering fixes:

1. Newly created background tabs without an `openerTabId` were never added to recency. They fell
   behind every recorded visit even when newly opened. All new background tabs now rank just after
   the current tab. A real-browser regression includes a WhatsApp-style excluded URL and confirms
   the card is second, ahead of an older visited tab.
2. A delayed window-focus query could register the former active tab after a newer activation,
   reversing their order. A revision guard discards the stale result.
3. Browser startup could load storage, replay new activations, then erase those activations during
   reset. Startup now clears old state before replaying visits received after the startup event.

Exclusion rules do not filter the browser's recency events. Sleeping, frozen and hidden tabs remain
excluded as requested. The new ordering regressions failed before the changes and pass afterward.

### Firefox and background lifecycle

Firefox lacks the session-storage access-level API, so the existing compatibility layer aliases
session storage to local storage. That also sent private thumbnails to disk and could overwrite the
normal thumbnail cache. Private previews now stay in a separate in-memory cache when this fallback
is active. The alias case is covered by a failing-then-passing unit regression and a Firefox runtime
check that verifies the private URL never reaches local storage.

The new `test-lifecycle` task uses temporary profiles. Chromium checks open a real incognito window,
exercise hints and the Vomnibar, verify actual normal/private capture storage, explicitly stop the
extension worker, confirm destruction of its target, then verify a replacement worker can open the
first Vomnibar while retaining MRU state and private previews. Firefox checks use the built Firefox
package and cover its core controls, settings, thumbnail storage and switcher selection.

### Current verification

| Check                                                                | Result             |
| -------------------------------------------------------------------- | ------------------ |
| Formatting/lint and diff whitespace                                  | Pass               |
| Unit tests                                                           | 202/202 pass       |
| DOM tests in Helium/Chromium                                         | 87/87 pass         |
| Installed source browser suite                                       | 59/59 pass         |
| Extracted Chrome Store ZIP browser suite                             | 59/59 pass         |
| Packaged Chromium incognito/worker lifecycle                         | 5/5 pass           |
| Packaged Firefox 159.0.1 lifecycle                                   | 8/8 pass           |
| Chrome Store, Canary and Firefox package builds                      | Pass               |
| ZIP CRC, manifest/import/HTML paths, source freshness and exclusions | Pass for all three |

The original Firefox limitations in earlier sections describe those earlier audits. This follow-up
adds actual Firefox runtime coverage. It does not claim exhaustive coverage of every Firefox version
or website. Updated ZIPs are in `dist/`. Reload the installed extension, clear the previous error
entries and reload affected tabs to verify the new build rather than historical error logs.

## 14. Configured Shortcuts, Stable Cycling and Keyboard-only Input (November 5, 2026)

The reported Ctrl+Q two-tab loop had two causes: the content controller and grid assumed Alt+Q, and
protected-page fallback rebuilt MRU after every activation. New unit and browser regressions
reproduced those failures before the changes.

- The switcher reads the actual assigned command, recognizes Control/Alt/Command and macOS glyphs,
  and confirms on the matching modifier release. Shift reverses direction unless it is part of the
  assigned shortcut. Quick release, release during startup, rapid queued commands and focus loss
  retain their existing handling.
- Protected-page fallback carries one window's fixed list through subsequent commands. Activations
  caused by the switcher cannot rewrite that gesture's order. Removed, sleeping and hidden tabs are
  skipped; a bounded scan handles an entirely vanished snapshot. Release, a fresh modifier press,
  external tab/window movement or three seconds of fallback inactivity ends the carried gesture. The
  idle limit is a recovery heuristic: protected pages cannot report key releases.
- The initial grid keeps its existing size and appearance. Continuing past its edge reaches all
  remaining awake tabs in successive grids. Reverse opening and a one-card final grid are tested.
  Closing cards retains keyboard selection and refills the current grid. Commits revalidate the
  target so a tab discarded, frozen, hidden, moved or closed during selection is not awakened.
- As explicitly requested, the switcher is now keyboard-only. Removed × buttons, hover selection,
  click-to-switch, middle-click close and outside-click dismissal. Pointer, touch and wheel defaults
  are blocked within its covering frame. Keyboard navigation, Enter, Escape and x/Delete/Backspace
  remain available. Colors, card styling, layout, thumbnails and glass appearance are preserved.
- The new error screenshot exposed listener registration continuing after the extension context was
  invalidated. Initialization now stops after the awaited check if unloaded; registration also
  catches Chromium's invalidated `onMessage` property getter. Unrelated errors still propagate.
- Grid requests use the existing authenticated parent port. The owning content script sends the
  runtime request, retaining the actual tab, window and privacy context even when Firefox would omit
  `sender.tab` for an extension iframe. A real incognito grid check verifies both private tab
  membership and the exact private preview bytes.

Independent review identified the late carried-release, required-Shift, final-page, exhausted-list,
commit eligibility and iframe-context edge cases. Each was addressed; the final proxy review found
no further actionable issue.

### Verification and timing

| Check                                                              | Result       |
| ------------------------------------------------------------------ | ------------ |
| Formatting/lint and diff whitespace                                | Pass         |
| Unit regressions                                                   | 220/220 pass |
| DOM suite                                                          | 87/87 pass   |
| Installed source browser suite                                     | 63/63 pass   |
| Extracted Chrome Store ZIP browser suite                           | 63/63 pass   |
| Real Chromium incognito/worker lifecycle                           | 6/6 pass     |
| Firefox 159.0.1 lifecycle                                          | 8/8 pass     |
| Chrome Store, Canary and Firefox builds/integrity/source freshness | Pass         |

The source run measured 103 ms for the first opening with cached images, 12 ms median and 24 ms
maximum over ten immediate reopenings, 29 ms for a quick swap, and 31 ms total for nineteen queued
moves. A loading fixture obtained its early thumbnail in 134 ms; a repeat-visit refresh took 837 ms.
These measurements include automation overhead and are not guarantees for arbitrary pages/devices.

The final packaged run measured 77 ms for the first cached opening, 15 ms median and 34 ms maximum
for ten reopenings, 24 ms for a quick swap, and 25 ms total for nineteen queued moves. Its loading
fixture saved an early thumbnail in 141 ms, with a repeat-visit refresh in 822 ms.

The shortcut regressions dispatch the command callback through the loaded extension and deliver real
page/frame keyboard events. They do not establish that an OS or another extension will grant Brovim
a conflicting accelerator. Assign Ctrl+Q to Brovim in the browser's extension shortcut page. Chrome
reserves browser shortcuts and does not support Tab as an extension command key. Brovim therefore
cannot conditionally suppress Ctrl+Tab across all pages. Helium's browser shortcut settings can
remove Next tab / Previous tab bindings browser-wide; README includes the verified route and
primary-source links. No personal browser profile or global shortcut settings were modified.

## 15. Follow-up: Keep Cycling Inside the Recent Grid

The user clarified that “dead tabs” meant old tabs beyond the first grid. The previous iteration's
pagination was an incorrect interpretation of the requested behavior: repeated presses traversed all
awake tabs even though the initial grid showed only ten.

Cycling now wraps within the displayed recent cards, using the configured columns × rows limit (ten
by default). Reverse opening selects the last card in that same grid. Protected-page fallback
snapshots use the identical limit, so internal pages cannot cycle into the older overflow either.
Older eligible metadata is retained only to refill a free card after a close. No visual styling,
keyboard-only behavior, shortcut binding or thumbnail behavior changes in this follow-up.

The regressions verify repeated Ctrl+Q presses with more than ten tabs, reverse opening with a
three-card limit, and protected-page fallback with limits of three, eight and ten. They failed
before the correction. A carried-grid close/refill regression covers preserving the overflow
candidates without making them reachable through ordinary cycling.

Final verification: formatting/lint and diff whitespace passed; 223/223 unit tests passed; 64/64
browser checks passed against both source and the extracted Chrome Store ZIP; and all eight Firefox
lifecycle checks passed. All three packages were rebuilt and checked for ZIP integrity,
manifest/import paths and exact source freshness.

## 16. Release Verification and Cleanup

The final pass verifies the requested keyboard-only switcher without changing its appearance: Alt+Q
hold/repeat/release, reverse selection, first-grid wrapping, protected-page handoff, MRU order,
sleeping-tab exclusion, immediate cached previews and refreshes, and recovery from the reported
initialization/reload errors. Ctrl+Q and bindings containing Shift remain covered as well.

### Cleanup

Repository-wide reference checks confirmed that `Utils.extractQuery`, `Utils.zip`, `Utils.pick` and
`Array.copy` had no production callers. Removed them and the five obsolete utility-specific tests;
retained matching-range and hint-routing coverage using direct assertions/destructuring. Also
removed the unused mouse card index, obsolete direct-iframe message exceptions and window lookup,
duplicate Alt-state tracking, and the test-only `browserShortcut` option. Its regression now invokes
the actual browser-command path. Removed two temporary implementation-note files whose useful
results are already consolidated here. Runtime assets, manual fixtures and test helpers with live
references were retained.

### Native shortcut coverage

Added the optional `test-native` task. On a dedicated Xvfb display it sends XTest keyboard events
through Chromium's actual accelerator registry rather than invoking Brovim's command callback. It
verifies native opening, 39 rapid repeats in the same grid, Shift reversal, modifier release and
protected-page handoff through several recent tabs. It requires an explicit local `:N` display and
rejects the desktop's server number, including screen aliases. Four rejection cases are checked.
README documents the dependencies and isolated-display setup.

An intermittent selector timeout was traced to the test observer: the page DOM showed the visible
1280×900 iframe while the shadow selector waited unsuccessfully. The native test now polls actual
page DOM and resolves the corresponding browser frame, as the private/Firefox lifecycle tests do. No
production delay or shortcut workaround was added. The clean source run completed 39 native repeats
in 110 ms; the packaged run took 109 ms, including test-driver overhead.

### Package asset correction

The stronger archive audit found Firefox excluded all PNG icons despite HTML and notification
references to `icon48.png` and `icon128.png`. A new Firefox runtime regression reproduced the
missing settings logo. The package now retains shared PNG assets while keeping SVG manifest icons.
The runtime regression and manifest/import/HTML asset checks pass after the correction.

### Final checks

| Check                                                                                | Result        |
| ------------------------------------------------------------------------------------ | ------------- |
| Formatting/lint and diff whitespace                                                  | Pass          |
| Unit tests after cleanup                                                             | 218/218 pass  |
| DOM tests                                                                            | 87/87 pass    |
| Installed source browser suite                                                       | 64/64 pass    |
| Extracted Chrome Store ZIP browser suite                                             | 64/64 pass    |
| Native Alt+Q on source and packaged extension                                        | 5/5 pass each |
| Desktop-display alias rejection                                                      | 4/4 pass      |
| Real Chromium incognito/worker lifecycle                                             | 6/6 pass      |
| Firefox 159.0.1 runtime, including packaged settings logo                            | 9/9 pass      |
| All three package builds, CRC, paths, imports, HTML assets, freshness and exclusions | Pass          |

The source run measured 48 ms for first cached opening, 11 ms median and 25 ms maximum over ten
reopenings, 36 ms for a quick swap, and 32 ms total for nineteen queued command-callback cycles.
Timing includes automation overhead and depends on the browser/device. Platform constraints remain
as documented in README: Chrome captures only the active tab; protected pages cannot report key
release; browser-reserved Ctrl+Tab needs browser-level shortcut configuration.

## 17. Every Awake Tab, Reported Errors and a Code Review (November 6, 2026)

The user asked whether the switcher lists all active tabs and supplied an extension-error
screenshot. Both problems reproduced in Helium before the fixes. This section supersedes the card
cap in sections 14–16.

### Every awake tab

- Sleeping unpinned tabs stay hidden, as section 11 set out, and "sleeping" now also covers tabs
  restored after a browser restart that were never opened again: Chromium reports them as `unloaded`
  without marking them discarded, so they had been listed as awake. An intermediate change listed
  frozen tabs, because headless Helium freezes background tabs within seconds (27 of 33 in one
  check). In normal use Helium shows frozen tabs as sleeping, and the user saw over 20 cards with
  about 9 awake tabs, so that was reverted. Browser tests must therefore open the grid soon after
  creating background fixtures.
- The configured columns × rows is where the grid starts, not a cap. It adds columns and rows,
  keeping about twice as wide as tall and widening the panel up to 90vw, until every tab has a cell,
  while cards stay at least about 140 × 120 px (at most 10 × 6). Only past that does keyboard paging
  begin. 33 tabs show as 9 × 4 at 1920 × 1080. Protected-page cycling uses the same list.

### Reported errors

- `Unchecked runtime.lastError: No tab with id` came from `chrome.action.setIcon` in
  `initializeFrame`, for a tab that closed or was replaced before the call ran. setIcon reports this
  only through `lastError`, which `.catch()` doesn't consume, so a callback now reads it.
- `Blocked script execution … sandboxed` came from loading UI frames on pages served with a CSP
  sandbox, such as raw.githubusercontent.com. The frames inherit the sandbox and never start. Brovim
  no longer loads them on opaque-origin pages, and the shortcut switches tabs directly there. A
  sandbox that keeps `allow-same-origin` without `allow-scripts` can't be detected from a content
  script.

### Speed

The switcher frame now loads, and a stopped background worker wakes, when the shortcut's modifier
goes down, before its letter. Pages learn the assigned shortcut when they initialize, so a
reassigned Ctrl+Q warms up as well. With Alt pressed 80 ms before Q, the first grid on a page paints
in 27–43 ms instead of 63–98 ms (timestamps inside the page and frame). Later openings (12–32 ms),
steps (about 5 ms), commits (about 7 ms) and quick taps (7–22 ms) are unchanged. On a page busy with
long tasks, a step can wait for the page's main thread: up to 85 ms with 80 ms tasks.

### Review and cleanup

- Synthetic key events no longer reach the switcher's modifier tracking, so a page can't fake an Alt
  release to commit the grid. Escape while holding Alt still cancels and stays on the tab.
- Opening the switcher from a key mapping keeps the page's assigned shortcut instead of resetting
  release detection to Alt.
- Find mode now matches across inline formatting and open shadow roots. Reading each computed style
  once per element made it 16–17% faster per keystroke: about 38 ms on an 18,000-element page,
  against about 23 ms for the earlier per-text-node search.
- Removed the Vomnibar's undocumented Shift+Delete action, which only logged the selection and
  blocked the input's normal Shift+Delete, and the test-only `getSwitcherTabs` wrapper.
- Backups are validated before anything is written, the popup rejects invalid exclusion patterns,
  private find history survives new tabs, the history cache's binary search handles an empty list,
  and unit tests in subdirectories run again.

### Test fixes

- Lifecycle and frame lookups wait for the frame by URL: Puppeteer can list a just-shown extension
  frame before it knows the URL.
- The popup checks wait for its script: the static button is visible before its handler exists.
- After the internal-pages suite's earlier steps, Helium reloads a freshly loaded Settings page once
  more by itself: within about 300 ms on Helium 0.20, after 2.7–3 s on 0.21. Neither Brovim nor
  Puppeteer requests it, and an untouched Settings page doesn't do it. Keys typed or a navigation
  started before it are lost, so the test waits for four seconds without navigation first.
- The main suite's `fresh()` waits until Brovim has started on the page before a test messages it;
  the page's own load can finish first.
- New checks cover Escape while holding Alt, grown grids at three screen sizes, sandboxed pages,
  setIcon on a vanished tab (the suite now records logged worker lastErrors), the modifier warm-up,
  a reassigned shortcut's warm-up, a key-mapped opening keeping that shortcut, and unloaded tabs.
  The Escape, setIcon, sandbox, shortcut and sleeping-tab checks were each shown to fail on a copy
  without the fix.

### Verification

Helium was upgraded from 0.20.3.1 to 0.21.1.1 (Chrome 157) during this work; the final runs used
0.21.

| Check                                                 | Result     |
| ----------------------------------------------------- | ---------- |
| Formatting, lint and diff whitespace                  | Pass       |
| Unit tests                                            | 322/322    |
| DOM tests                                             | 95/95      |
| Installed source browser suite                        | 86/86      |
| Extracted Chrome Web Store ZIP browser suite          | 86/86      |
| Incognito and worker-restart lifecycle                | 7/7        |
| Internal pages, 9 runs on 0.21 with the 4-second wait | 10/10 each |
| Firefox 159.0.1 with the Firefox package              | 9/9        |
| Native Alt+Q on Xvfb, source and Web Store ZIP        | 7/7 each   |
| Chrome, Chrome Web Store and Firefox package builds   | Pass       |

## 18. Find and Hint Audit Fixes (November 6, 2026)

Five bugs reproduced beyond the existing test suite: stale find results on live pages, matches
remaining outside nested scrolling panes, phrases missed when HTML whitespace collapses on screen,
case-equivalent hint letters producing duplicate labels, and repeat search failing after navigation.

- `n` and `N` rebuild matches from current content and resume the saved query on newly loaded pages.
  They keep the current selection as the starting point, wrap in either direction, and distinguish
  an absent query from a query with no remaining matches.
- Find scrolls each containing pane and then the viewport, horizontally and vertically, including
  across open shadow roots. It uses the matched text's rectangle rather than its parent's size.
- Search text collapses ordinary HTML whitespace across inline nodes while keeping source offsets
  for selection. Preformatted whitespace remains literal.
- Settings and backup validation check hint alphabets after case normalization. Previously saved
  duplicate alphabets are deduplicated without changing character order; unusable alphabets fall
  back to defaults so link hints remain available.

The new DOM and settings regressions failed before the fixes. Additional installed-browser checks
exercise actual search keys, reloads, dynamic content, scrolling panes and saved hint settings.

Verification: formatting/lint and diff whitespace passed; 324 unit tests, 101 DOM tests, 89
installed Chromium browser tests and 10 internal-page tests passed. All three packages built
successfully; archive CRCs and the changed runtime files were verified against the source. Firefox
runtime and native X11 shortcut tests were not rerun for this change.

## 19. Switcher Startup Resize Race (November 6, 2026)

The reported `Getting the setting tabSwitcherColumns before settings have been loaded` error
reproduced when the switcher iframe resized during its first activation while settings were still
loading. Activation marks the switcher visible before awaiting settings; the resize handler had
treated visibility as readiness and read the layout too early.

Resize now waits until the panel is ready. The first render already reads the current viewport, so
an early resize is applied once the saved settings and tab list arrive. A browser regression delays
the frame's settings load, observes errors inside the iframe, resizes during startup, then verifies
the saved three-column layout and keyboard controls after loading. It reproduced the exact reported
error before the fix and passes with the fix.

Verification: formatting/lint and diff whitespace passed; 324 unit tests and all 90
installed-browser checks passed. All three packages built successfully, and their CRCs and updated
switcher script were verified against the source.

## 20. Eight Cards per Row and Preload Warning (November 7, 2026)

- **Cards per row:** the default is now 8 (options 3–8). The grid keeps that width and starts a new
  row for each further 8 tabs. It adds columns only when the screen has no room for another row
  (cards at least about 140 × 120 px, at most 10 × 6), and pages only past that. The Rows setting no
  longer did anything and was removed; stored values are deleted on load. 21 tabs show as 8 + 8 + 5
  at 1280 × 900.
- **YouTube "cross-world-for-csp resource mismatch":** the extension's error page reported this
  warning from `content_scripts/tab_switcher.js` on YouTube watch pages. Preview capture measured
  each DOM change as it happened. That forced a style and layout pass from Brovim's isolated world,
  and a background image that this pass started loading was attributed to that world. The page's
  preload was therefore not reused, and a cross-origin image downloaded twice. Changed nodes are now
  collected and measured after the page's next frame, once the browser has rendered them. A browser
  regression check (a busy page that shows a preloaded cross-origin thumbnail) failed with the exact
  warning before the fix, and passes with one image request after it.
- **Upgrade notification clicks:** the click listener was added only after the notification was
  shown. The MV3 service worker usually stops before the user clicks, so the click did nothing, and
  with no focused window it threw. The listener is now registered at startup and opens the project
  page in a new tab.
- **License:** no license file. The earlier MIT notice, which that license requires in every copy,
  is kept at the top of `lib/utils.js`, so the store packages include it.
- **Version 1.0.0:** Brovim's first release. Settings migration keys on whether `settingsVersion`
  exists, not on its value, so moving from 2.4.2 to 1.0.0 keeps existing settings; that downgrade
  shows no upgrade notification.

Production recheck: the manifest's permissions are all in use, and every file the manifest
references exists. Store packages contain no tests or build files, omit the `chrome://` host
permission, and match the source. Old backups that contain the removed Rows setting still restore.
No eval or untrusted HTML sinks were found in the code that renders tab titles and completions.
Default Vomnibar searches use the browser's engine (DuckDuckGo in Helium). The `yt` keyword's
suggestions still come from YouTube's suggestion service on `suggestqueries.google.com`.

Verification: formatting/lint passed; 324 unit tests, 101 DOM tests, 91 installed-browser checks
(from source and from the extracted Chrome Store ZIP), 7 lifecycle checks, 10 internal-page checks
and 7 native shortcut checks passed. Firefox was not rerun for this change.

## 21. Visual and Caret Text Selection Restored (November 7, 2026)

`/phrase`, Enter, `v`, Vim movements and `y` now select and copy page text. Copying clears the
highlight immediately and removes every selection range; `y`, `Y` and Enter share this behavior. `V`
selects whole lines, `c` positions the caret, `v` switches caret/visual mode, and Escape exits and
clears the highlight, including after copying, existing search selections and pending movement
prefixes. Arrow keys, Home/End and Enter-to-copy are also supported. Without an existing selection,
`v` starts a caret at visible text. Inputs keep normal typing.

Implementation:

- Restored the selection machinery from the fork's history and connected it to the current manifest,
  command registry, default mappings, normal mode and help.
- Replaced the old character table with Unicode properties and preserved actual selection endpoints,
  including composed ranges inside open shadow roots.
- Guarded word stepping against repeated endpoints so a browser boundary cannot trap a page in a
  movement loop. Caret fallback also handles short visible text.
- Shared the find-mode range scrolling helper so moving the selection reveals its active end inside
  nested scroll panels. Copy uses Brovim's existing clipboard HUD.
- Added nine installed-browser regression checks for find-to-select/copy, caret switching, whole
  lines, editors, replaced content, Unicode/inline markup, shadow roots, nested scrolling, empty
  pages, boundaries, focus recovery and immediate Escape cleanup, including after copying.

Validation: formatting/lint, 325 unit tests, 101 DOM tests and 101 installed-browser checks passed
in Helium/Chromium. All three distribution packages built with the new script in their manifests.
Twelve internal-page checks also passed, including clipboard contents, immediate copy cleanup and
Escape cleanup on the actual Extensions page's shadow DOM with Helium's existing internal-page
override. Firefox runtime tests were not run for this change.

## 22. Browser-page Navigation and Selection Corrections (November 8, 2026)

- Alt+E searches a local catalog of browser-owned pages, including settings, extensions,
  performance, downloads, history and extension shortcuts. Helium, Brave and Edge have
  profile-specific entries or destinations; Automatic uses exposed browser identity, with a manual
  profile override.
- The palette shares the existing centered Vomnibar layout, focuses its input on opening, and always
  opens selected results in a new tab. Its footer reflects that behavior. Protected pages and
  browser chrome focus use a temporary extension tab, closed after selection or Escape.
- Removed Alt+E from Helium's native-menu shortcut backup. Other browsers retain the agreed manual
  extension-shortcut assignment when a conflict exists; Helium's preference backup is not imported
  into Brave.
- Alt+Q uses the same controller on websites and browser pages: a quick tap switches to the previous
  tab; holding shows the grid, and releasing selects. Escape cancels. Quick releases during startup
  also switch automatically. The existing two-tab swap option applies everywhere; no new setting or
  special first-tap behavior is added. Real keyboard tests cover warm and freshly reloaded
  Extensions pages.
- The browser-page grid is independent of ordinary browser-page mappings. When Chromium allows
  injection, the shortcut can bootstrap its controls without changing that preference. Pages which
  forbid scripts retain the normal direct-switch fallback. The tab switcher opens no extra tab or
  window; Alt+E's protected-page search palette still uses its temporary extension tab.
- Removed visual-selection `o`; kept `c`, `v`, `V`, movements, copying and immediate highlight
  cleanup.
- Keep focus on the page defaults to true. Explicit existing preferences remain respected.
  Refocusing editors are guarded during automatic focus recovery to avoid synchronous blur/focus
  recursion.
- Fixed the real Extensions-page `newPostFindMode` ReferenceError and a related selection scrolling
  helper reference: cross-file calls now go through exported FindMode methods, which work when
  Chromium injects each file in a separate script scope.
- The DotRobot keyd mapping now uses Caps+Shift+4 (`$`) for End. Caps+4 is no longer End; both
  cheatsheet rows were corrected. The Caps+gg/G additions remain purged.

Live browser verification uses Helium. Catalog tests cover other Chromium profiles; Brave, Edge and
Firefox runtime behavior is not claimed as tested. Brave's performance destination follows its
[System settings documentation](https://support.brave.app/hc/en-us/articles/13383683902733-How-do-I-use-the-Memory-and-Energy-Saver-features-in-Brave);
Edge's follows
[Microsoft's documented route](https://learn.microsoft.com/en-us/troubleshoot/microsoft-edge/performance/edge-high-cpu-memory).

Validation: formatting/lint, 333 unit tests, 102 DOM tests, 101 installed-browser checks, 13
internal-page checks, 10 browser-navigation checks, 14 real-shortcut checks and 7 lifecycle checks
passed in isolated Helium profiles. Chrome Store, Chromium developer and Firefox packages were
rebuilt. The installed keyd config matches the repository, `keyd check` passes, and the service is
active. The installed tools listed in the earlier workflow report remain present, the optional tools
remain uninstalled, Hyprland reports no configuration errors, the kbptr self-check passes, and the
removed Caps+gg/G bindings remain absent from keyd, Kitty and active tmux bindings.

Every bundled file in all three ZIPs was compared byte-for-byte with its source (apart from each
platform's generated manifest). Six additional browser-navigation checks passed against the
extracted Chrome Store package, which intentionally omits the internal-page override permission.
DotRobot's concurrent removal of its docs directory was preserved; its stale README report link was
removed.

## 23. Tab Switcher on Every Tab: Taps, Holds, Focus and Busy Pages (November 10, 2026)

The user asked for the grid to work on any tab and for a quick Alt+Q to switch at once, then
reported that holding the shortcut on YouTube switched to the previous tab instead of showing the
grid. Real Alt+Q presses on an isolated X server, across some twenty kinds of tab and fourteen real
sites, reproduced six faults.

| Fault                                                                        | Cause                                                                                                                                                         | Now                                                                                                   |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Holding on YouTube switched tabs                                             | The background gave a page 350 ms to answer, then switched directly. YouTube's main thread stalls for longer, and only the page knows whether the key is held | A page gets two seconds; a busy one answers late with the right action                                |
| A slow answer could cost a tab its grid until reload                         | The page's own 800 ms timer expired during a stall and marked the switcher unavailable for good                                                               | The timer counts time the page's event loop actually ran; a slow frame is retried once it has started |
| Alt+Q did nothing while typing in an embedded page                           | Taking the focus from another frame focuses the top window for an instant, which the grid read as the user leaving and closed itself                          | That moment is ignored; embedded pages report the modifier's presses and releases to the top frame    |
| A tap on a new tab left the grid stuck open                                  | The address bar had the focus, so the page never saw the release                                                                                              | Without the focus the page declines and the background switches directly                              |
| Holding on a PDF did nothing                                                 | The PDF viewer keeps its keys                                                                                                                                 | Every press switches directly                                                                         |
| The grid took the focus from a text field for good (then `x` closed the tab) | Closing the grid focused the frame, not the element                                                                                                           | The element gets the focus back, on the page or inside an embedded page                               |

A held grid now shows 90 ms after the shortcut (`showDelayMs`), as KWin (90 ms) and GNOME Shell (150
ms) do, so a tap no longer flashes the grid or touches the focus. A grid can no longer open or stay
open in a tab that was left, and a press that waited behind a slow one is dropped once that one has
switched tabs.

### Measurements

Timestamps from the pages themselves, real keys, isolated Helium with `--extensions-on-chrome-urls`:

| Interaction                                   | Time                                         |
| --------------------------------------------- | -------------------------------------------- |
| Tap: Alt released to tab switched             | 3–7 ms                                       |
| Tap from a stopped background worker          | 5 ms after release (the modifier wakes it)   |
| Tap on a page Brovim can't run on             | 10 ms from the letter; 45–70 ms cold         |
| Hold: letter to grid drawn with previews      | 110–120 ms, of which 90 ms is the tap window |
| Hold or tap on a page stalled for 700–1600 ms | When the stall ends                          |

### Limits

- No grid where the page can't see the keys: address bar focused, PDF viewer, fullscreen video,
  embedded pages without Brovim, and the pages browsers protect. Every press switches directly
  there, and the grid resumes on the next tab.
- Two such tabs in a row can't tell a second tap from a held second press for three seconds, so
  tapping back and forth between two PDFs walks on through the list.
- A tap on a stalled page waits for the page, where it used to switch after 350 ms.

### Verification

Formatting and lint, 373 unit tests, 102 DOM tests, the installed-extension browser suite, 22
real-shortcut checks (eight new: typing, embedded pages, a stalling page, a PDF, a new tab), 7
lifecycle, 13 internal-page and 10 browser-navigation checks pass in isolated Helium profiles. The
stalling-page check fails against the 350/450 ms answer limit and passes with the fix. Packages were
not rebuilt.

## 24. Loading Tabs, and a Grid on Every Tab (November 11, 2026)

The user reported that on a tab still loading over a slow network, holding Alt+Q showed no grid and
switched to the previous tab. Real Alt+Q presses against slow-network fixtures (a server that hasn't
answered, a page arriving in parts, a script or stylesheet that hasn't arrived) reproduced it in
three forms. This section supersedes section 23's first limit.

| Tab                                                   | Cause                                                                                                                                         | Now                                                                                                             |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| A page arriving in parts, its first part drawn        | The grid's frame joined a page only once all of it had been parsed. The page's wait for the frame ran out, and the background switched tabs   | The frame joins a page as it arrives: the grid shows on the page                                                |
| A tab whose server hasn't answered                    | There is no page to show the grid in                                                                                                          | The press switches to the previous tab, which shows the grid for the same gesture if the shortcut is still held |
| A page waiting for a script or stylesheet in its head | The browser draws nothing, and gives the page no keys, until its first paint. The page could neither show the grid nor tell a hold from a tap | The page declines at once (it hasn't been drawn), and the gesture moves on as above                             |

The hand-off applies to every tab that can't show the grid: pages that block extension scripts,
sandboxed and SVG documents, the PDF viewer, fullscreen video, embedded pages without Brovim and the
address bar. Before, those switched directly and showed the grid only on the next press. The tab
switched to waits the usual tap window: a tap's release reaches it, and nothing shows. Held past
that, it shows the grid with the gesture's own list and selection; release selects, and Escape
returns to the tab where the gesture began.

A release while no page has the focus is lost, and the grid would wait for it. So the background
hands off only when it was already running and switched within 60 ms of the press, or when the page
that declined saw the shortcut held past the tap window (its grid frame failed to start in time). A
press that has to start the stopped background switches without a grid, as before; the next press
shows it.

Also:

- A card for a tab whose page hasn't arrived shows the address it is loading (site letter, host and
  saved preview) instead of "Untitled".
- A page that throws away its whole document no longer loses the grid's frame until reload: the next
  press builds a new one.
- While a tab that can't show the grid is in front of a focused window, the background stays running
  (one extension call every 20 s restarts the browser's 30 s countdown to stopping it), so the first
  press there hands its gesture on too. Browsers driven by automation never stop an idle background,
  so this was checked in Helium launched without automation (the extension loaded from a folder,
  real keys, screenshots): after 50 s on a PDF, the first held press showed no grid without the
  change, and the grid with it.

### Measurements

Real keys, isolated headful Helium; the tap releases Alt 60 ms after pressing Q:

| Tab                                                                         | Hold: grid shown            | Tap: switched |
| --------------------------------------------------------------------------- | --------------------------- | ------------- |
| Website, browser and Brovim pages, text, XML, file                          | 107–129 ms, on the tab      | 84–92 ms      |
| Address bar, PDF, SVG, view-source, data:, error page, sandboxed, Web Store | 122–178 ms, on previous tab | 70–78 ms      |
| Server hasn't answered                                                      | 132–155 ms, on previous tab | 70–83 ms      |
| Waiting for a script or stylesheet                                          | 152–163 ms, on previous tab | 72–75 ms      |
| Arriving in parts, or waiting for an image                                  | 113–164 ms, on the tab      | 79–91 ms      |
| Main thread 90% busy                                                        | 239 ms, on the tab          | 221 ms        |

No tap showed a grid on any tab, and Escape returned to the starting tab in every case. Warm and
cold timings from section 23 are unchanged (a tap switches 5–8 ms after the release; a held grid
shows about 100 ms after the press).

### Trade-offs the user kept

Two behaviours are kept by the user's choice (November 11). A quick tap during a page freeze waits
for the freeze to end, because only the page can tell a tap from a hold; switching at once would
make a hold on a frozen page jump to the previous tab, the bug reported on YouTube. Between two tabs
that can't show the grid, quick taps walk down the list, because neither can see Alt being released;
the 3 s gesture window stays, so a held walk never starts over.

### Test reliability

- The browser suite's first navigation in a fresh browser hung in about a third of launches, on the
  last commit as well: Chromium holds or supersedes it while installing the extension. The suite's
  `navigate` now retries up to four times.
- Headless Chromium freezes background tabs within 3–5 s, which a window doesn't, and a frozen tab
  is asleep, so the grid leaves it out. The fixture tabs of the two every-tab checks hold a Web
  Lock, which keeps them awake; both pass reliably again.
- "initialization recovers from empty responses" pressed `f` as soon as the background received the
  page's third initialization request, before the reply reached the page and before normal mode had
  loaded its key mappings; `f` then did nothing (2 of 6 runs). It now waits until `f` is mapped in
  the page, as the internal-page and browser-navigation suites already did: 12 of 12.
- "x/X close and restore a tab" waited for its page to regain the focus after `x`, but the browser
  chooses which tab comes forward after a close. It now brings its page forward first.
- The grid-navigation check's seven fixture tabs hold a Web Lock too: two frozen tabs left a single
  row, where `j` has nowhere to go.
- The quick-tap check on a freshly reloaded Extensions page sometimes found the page without the
  focus: the test display has no window manager. It now reactivates the tab and refocuses the window
  until the page has the focus.
- Three checks in the November 10 run were removed from the working tree before this round: "find
  and hint collection remain responsive on a large document", "first opening on Brovim settings
  validates numeric options and supports held grids and quick taps" and "new-window navigation
  accepts real browser window options and the new-tab URL". They were not restored.

### Verification

Formatting and lint, 382 unit tests (nine new: the hand-off decision, a tap ending a handed-off
gesture, the held-modifier evidence, a page not yet drawn, Escape back to the first tab, the frame
joining a page that is still arriving, its rebuild, the loading address, and keeping the background
running), 102 DOM tests, 26 real-shortcut checks (four new: an unanswered tab held and tapped, a
page arriving in parts, a page waiting for a script) in four consecutive runs, 7 lifecycle, 13
internal-page and 10 browser-navigation checks pass in isolated Helium profiles. Undoing each fix in
turn fails its new unit test. Packages were rebuilt, and the Firefox package passes the 9 lifecycle
checks in Firefox 159. Real Alt+Q presses in Firefox 159 (a visible window on the test display) show
the grid on hold, select on release, switch on a tap, and hand a gesture on from `about:robots` to
the previous tab, which shows the grid.

The browser suite's failures in this round were test races, fixed as listed above. With the fixes,
it passed 101 of 101 checks in two consecutive full runs.

## 25. Frozen Pages, Two Tabs Without the Grid, and a Smoother Grid (November 11, 2026)

The user asked to fix the two behaviours kept in section 24 and to make switching, the grid and
cycling smoother. This section supersedes section 24's "Trade-offs the user kept".

- **Frozen pages.** A press first asks the page for an answer, which takes a few milliseconds on a
  responsive page. With no answer within 0.2 s the page is frozen, and the background switches to
  the previous tab at once: a tap takes about 0.2 s instead of waiting out the freeze. The tab it
  moved to then waits. If it sees the release, the gesture ends. If the frozen page catches up and
  reports the shortcut still held, or another press arrives, it shows the grid. Escape returns to
  the frozen tab. A hold during a freeze longer than 0.2 s now moves to the previous tab first, and
  the grid follows there. A page busy only for a moment still answers in time and shows the grid
  itself.
- **Two tabs that can't see the keys.** When the tab a gesture moved to can't see the shortcut's
  modifier, a press continues the held gesture only within 0.4 s of the last one; a slower press is
  a new tap. Taps between two PDFs now flip back and forth, and quick presses while holding still
  walk the list. Tabs that see the modifier end the gesture themselves, as before.
- **PDFs showing the grid themselves** (approved alongside) was built and withdrawn. The PDF viewer
  is not reachable from the page at all (no element, no frame), so once the page took the keyboard
  for a gesture, only a click could give it back: the PDF's arrow keys, Space and Page Down would
  stop working after every Alt+Q. A hold on a PDF still shows the grid on the previous tab.
- **Smoother grid.** The grid, its cards and the dimmed page behind it fade in over 0.1 s instead of
  appearing at once. The selection still moves without animation, so fast cycling keeps up. A
  reduced-motion preference turns the fade off.

### Verification

Real keys in isolated Helium: a hold on a page frozen for 1.2 s switches at once and the previous
tab shows the grid; a tap there switches before the freeze ends, with no grid anywhere; a page busy
for 0.1 s shows the grid itself. Taps 0.7 s apart flip between two PDFs (PDF2 → PDF1 → PDF2 → PDF1)
and between two protected pages, and quick presses while holding walk on. The grid's opacity goes
from 0 to 1 over about 0.1 s. Loading tabs behave as in section 24: grids in 127–178 ms, taps in
75–93 ms, no flashes.

Formatting and lint, 384 unit tests (two new: the frozen-page switch and the 0.4 s rule, each
failing without its fix), 102 DOM tests, 101 browser checks, 29 real-shortcut checks in three
consecutive runs (three new: a page busy for a moment, and taps and quick presses between two
protected pages; the frozen-page and PDF checks rewritten for the new behaviour), 7 lifecycle, 13
internal-page and 10 browser-navigation checks pass. Packages were rebuilt. In Firefox 159 the
package passes the 9 lifecycle checks, and real Alt+Q presses hold, select, tap and hand on from
`about:robots` as before.

Test fixes: the native test retries its first navigation like the browser suite. Its PDF check now
waits for the grid it hands on to close, which otherwise raced with the next check.

## 26. The Grid Moves While Its Page Is Busy (November 11, 2026)

The user reported that on a tab woken from sleep and still loading, the grid opened but neither
Alt+Q nor hjkl moved it until they came back and tried again.

- **Cause.** The grid's frame got its tab list, and every Alt+Q step, through the page's own content
  script. A loading page's scripts are often busy for seconds, and the content script shares their
  thread: the grid waited, hjkl waited on its tab list, and the background, which learns of a grid
  only once its list has loaded, took the next Alt+Q for a press on a frozen page and switched to
  the previous tab.
- **Fix.** In Chromium, which tells the background which tab an extension frame is in, the grid's
  frame sends its requests to the background itself. An Alt+Q press while a grid shows goes from the
  background straight to that grid's frame (`stepTabSwitcher`), and only the frame showing that grid
  answers. Firefox doesn't name the frame's tab, so there requests still go through the content
  script; the direct Alt+Q step works in both.
- Section 14's note that grid requests use the parent port now applies to Firefox only.

### Verification

Real keys in isolated Helium, on a tab woken from sleep whose scripts stall for 4 s once the grid
shows: before the fix, the grid never filled in and the next Alt+Q jumped to the previous tab, then
another; after it, two Alt+Q steps and `l` moved the selection and the release switched tabs, all
during the stall. A new real-shortcut check does the same with a 5 s stall and fails without the
fix.

Formatting and lint, 384 unit tests, 102 DOM tests, 101 browser checks (the incognito grid check
included), 30 real-shortcut checks (one new), 7 lifecycle, 13 internal-page and 10
browser-navigation checks pass. Packages were rebuilt; in Firefox 159 the package passes the 9
lifecycle checks, its switcher check included.

## 27. Alt+X Closes Any Tab; Ctrl+X Cuts Again (November 12, 2026)

The user often closed tabs by accident with `x`, and a Helium shortcut made `Ctrl+X` close the tab
even while cutting text in a field. The user chose:

- **`Alt+X` closes the tab, on every tab.** It is a Brovim browser shortcut (`close_tab`, the fourth
  and last suggested key a browser allows), so it works where pages keep their keys: PDFs, error
  pages, view-source, the Web Store, and New Tab with the focus in the address bar. It closes the
  tab as the `removeTab` command does. It works in any browser with Brovim installed; Helium itself
  binds nothing to it, since a browser binding on the same key would make Helium refuse Brovim's.
  The help dialog and the Options page show the assigned key.
- **`x` no longer closes tabs**; it reaches the page. `X` still reopens the last closed tab, and the
  grid's `x` still closes the selected card's tab.
- **`Ctrl+X` is Cut again.** `helium/shortcuts.json` bound it to Helium's Close Tab, which the
  browser handles before any page or extension sees the key, so no field could cut. That binding is
  gone; Close Tab has no browser shortcut (`Ctrl+W` stays removed).
- **Browser pages keep their keys for Brovim.** Settings, Extensions, History, Downloads, Bookmarks
  and Flags put the cursor in a search field inside a shadow root on load, so page keys typed into
  it. "Keep focus on the page" (on by default) only looked at the page's top level; it now looks
  inside shadow roots, as insert mode does.

### Verification

Real keys in isolated Helium: `Alt+X` closed a web page, a PDF, an error page, a page's source and
New Tab from its address bar; a plain `x` left the tab open. Upgrading an installed Brovim assigned
`Alt+X` too, as a restart of the user's Helium will. In Firefox 159 a real `Alt+X` closed the tab
and `x` didn't. With the old Helium binding, `Ctrl+X` in a field closed the tab and the page never
got the key; without it, the field cut. New checks, each failing without its change: the help dialog
lists `Alt+X` (unit), a field focused inside a shadow root loses the focus on load (DOM), and a page
key works on Settings without Escape (internal pages). 385 unit tests, 103 DOM tests, 101 browser
checks, 31 real-shortcut checks, 7 lifecycle, 13 internal-page and 10 browser-navigation checks
pass; in Firefox 159 the package passes the 9 lifecycle checks.

## 28. A Hold Shows the Grid on Any Tab, and a Clean Switch (November 12, 2026)

The user reported that holding Alt+Q on a tab still loading (often one just woken from sleep)
switched to the previous tab without a grid. The goal: a tap switches fast and a hold shows the
grid, whatever the tab is doing. Also, as TabGlance does, the grid must leave the page before the
switch.

- **Cause.** Where the tab in front can't answer, Brovim switches to the previous tab, which tells a
  tap from a hold by whether the modifier's release reaches it. That only works if the switch comes
  before a tap's release. A tab whose page wasn't back yet first got 250 ms to load Brovim, and a
  page that didn't answer got 200 ms: the release came first, so a hold showed no grid, or showed
  one only when the busy page caught up (within two seconds, or never).
- **Decide within 20–30 ms.** Pages tell the background the moment the shortcut's modifier goes down
  (they already did, to wake it; now also before settings load, and embedded pages tell it
  directly). A page that did gets 30 ms to answer; one that didn't gets 20 ms, or 30 once its word
  arrives, which can come just after the shortcut. A loading page without Brovim yet isn't waited
  for: Brovim comes with its page.
- **The tab it lands on decides.** After such a quick switch it shows the grid unless it sees the
  release, waiting briefly for the keyboard focus the switch gives it. The busy page, once it
  catches up, can still say a very quick tap's release reached it before the switch; the grid that
  opened for it then closes, unless a press has used it. A busy page reporting a tap after the
  switch no longer switches a second time.
- **Clean switch.** On release (or Esc back to the first tab), the grid clears itself and hides, the
  page confirms it drew a frame without it, and only then the tab switches. A page too busy to
  confirm within 50 ms doesn't hold the switch up. A selection of the tab already in front switches
  nothing, and a switch made elsewhere in the meantime stands.
- **Trade-offs.** A page busy for more than about 30 ms when the shortcut comes shows a held grid on
  the previous tab rather than on itself: the same selections, the same result, and Esc returns. A
  page that freezes the instant it sees the modifier, with a tap released within 30 ms of the
  letter, shows a grid on the previous tab until it catches up.

### Measurements

Real keys in isolated Helium, times from the shortcut reaching the background:

| Tab in front                    | Before: hold                      | Before: tap | After: hold        | After: tap |
| ------------------------------- | --------------------------------- | ----------- | ------------------ | ---------- |
| Healthy page                    | grid on it                        | 53 ms       | grid on it         | 54 ms      |
| Woken from sleep, page not back | switch at 256 ms, no grid         | 257 ms      | grid at 125–129 ms | 3–5 ms     |
| Heavy page loading (long tasks) | grid when the page frees, or none | 200–400 ms  | grid at 111–142 ms | 12–31 ms   |
| Page waiting for a script       | grid at 133 ms                    | 9 ms        | grid at 113–126 ms | 3–8 ms     |
| Page freezing as Alt goes down  | grid when it catches up           | 200 ms      | grid at 137–155 ms | 31–35 ms   |

Taps released 25 ms after the letter switch without a grid on all of these but the last. On a
healthy page the grid now leaves the page 22–68 ms before the switch; a 60 fps recording of coming
back to a tab, after a switch from a page too busy to hide the grid, shows no grid in any frame.

### Verification

Formatting and lint, 391 unit tests (new: the two answer times, the quick handoff and its
correction, a tab still loading, the late tap, waiting for the focus, and the clean switch's order
and its two exceptions), 103 DOM tests, 101 browser checks (four now wait the frame a switch takes
after the grid hides), 34 real-shortcut checks in five consecutive runs (new: a tab waking from
sleep, a heavy page loading, and the grid hiding before the switch; a page busy for a moment now
hands off), 7 lifecycle, 13 internal-page and 10 browser-navigation checks pass. In Firefox 160 the
package passes the 9 lifecycle checks, and real Alt+Q presses hold, step, release and tap.

### In the user's Helium

Temporary logging in the user's own Helium (three one-minute sessions, removed after) found two more
causes of a hold without a grid, both on loading tabs:

- **A late "not held" closed the grid.** A loading tab gets no keys before it is drawn, so a busy
  one that never saw the shortcut answered, once it caught up, that it hadn't seen it held. That
  answer closed a grid the user was holding (1.8 s). The busy page now closes the grid only if it
  saw the modifier go up after the press, judged by the key event's own time.
- **Switches came too late to count as quick.** A browser busy loading a page took 69–77 ms to
  switch, past the 60 ms within which the next tab may decide. The page is now asked the moment the
  shortcut arrives, the tab list and shortcut are looked up together, and a switch within 100 ms
  counts as quick.

In the last session every hold showed the grid (on a loading tab that could answer, on the tab
itself; otherwise on the previous tab within 132–193 ms) and every tap switched without one. 392
unit tests, 103 DOM tests, 101 browser checks, 34 real-shortcut checks in three consecutive runs, 7
lifecycle, 13 internal-page and 10 browser-navigation checks pass.

Listing tabs Helium restored at startup but hadn't loaded was tried and dropped: Helium shows them
greyed out, as sleeping. The grid keeps to awake tabs and pinned tabs.
