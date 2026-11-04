# Brovim: Project Report and Verification

**Repository:** `MR-5OBOT/brovim` (previously the `MR-5OBOT/vim-browser` fork)\
**Base:** Based on `philc/vimium` (full history kept; no longer a GitHub fork)\
**Date:** November 4, 2026\
**Status:** Final audit fixes verified locally; latest fixes remain uncommitted. See section 11.

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
- **Tab Controls:** `t` (create tab), `x` (close tab), `X` (restore closed tab), `J` / `K` (previous
  / next tab), `^` (jump to last active tab), `<a-p>` (pin/unpin), `<a-m>` (mute/unmute), `<<` /
  `>>` (reorder tab).
- **Clipboard & Navigation:** `yy` (copy URL), `p` / `P` (paste and open URL), `H` / `L` (history
  back / forward), `r` / `R` (reload / hard reload), `i` (insert mode), `gi` (focus input).

---

## 5. Built Enhancements & New Features

1. **Vomnibar Visual Overhaul:** Modern dark floating search palette with glass shadows, purple
   focus states, refined typography, smooth transitions, and in-place URL editing (`ge`).
2. **Whole-UI Dark/Custom Theming:** Global dark theme engine (neutral dark grey, `#141414`) with
   purple accents (`#68039B` / `#8819c9`) shared across the Vomnibar, HUD notices, Help Dialog, and
   key badges.
3. **Visual Tab Switcher (rebuilt after TabGlance):** A black (or liquid glass) panel of tab cards
   over a lightly blurred page; the cards follow the system's light or dark theme. `Alt+Q` shows the
   10 most recently used tabs (cards per row and rows are settings) with the previous tab selected;
   releasing Alt switches. Cards have a preview or a letter tile, the title and the site, and a `×`
   to close. Previews are captured when a page has settled and kept by URL in local storage (session
   storage for incognito). TabGlance has no license, so this is Brovim's own code, not a copy.
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
10. **Theme only half applied.** In dark OS mode, `vimium.css` swapped the palette back to Vimium's
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
15. **Missing icon on the command listing.** The page requested a `github.svg` that only exists on
    Vimium's hosted site; it's a plain text link now.
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
    includes every open tab in the window, ordered by recency (TabGlance-style); unvisited tabs
    follow by lastAccessed. No numeric cap. Releasing `Alt` switches to the selected tab; Enter also
    confirms a selection.
21. **Vomnibar `omni` excludes active tabs; limited to history and web search.**
    `completionSources.tabs` was removed from the `omni` completer. Typing in `o`/`O` now focuses
    strictly on URLs, browsing history, domain completions, and web search queries (typing words
    like "hola" searches via the search engine), without switching to open tabs. Tab switching is
    dedicated to `Alt+Q`.

The extension was also renamed to **Brovim** (manifest, user-visible strings, help/options pages,
build zips, and a new Firefox add-on ID, since the old one belongs to Vimium on AMO).

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

### 3. Visual Tab Switcher (TabGlance-style)

- [x] **Snapshot Caching Service:** The page's content script waits until it has settled (no visible
      DOM change, layout shift or new largest paint for 800ms, at most 4.8s) after loading, coming
      into view, a URL change or a long scroll, and just before the switcher opens. The background
      captures it, downscales it to 480px and keeps the newest 60 by URL in `chrome.storage.local`
      (incognito: `chrome.storage.session`). Never captured while Brovim's UI is showing.
- [x] **Preview Grid UI:** TabGlance-style panel: 5 cards per row, 2 rows, a scroll hint when cards
      overflow; a click outside closes it.
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
  - `g`: Google search (`https://www.google.com/search?q=%s`)
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

The retained Vimium code and history (pre-streamlining commit `5aa29614`) were used as the reference
for core keyboard behavior. The 19 intentional feature removals remain in place.

### Fixes and requested changes

- **Default exclusions:** Gmail and WhatsApp Web disable Brovim by default. WhatsApp Web uses the
  pattern `https?://web.whatsapp.com/*` with no pass keys.
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
- **Recent-tab switcher:** rebuilt after TabGlance's UI and behavior: the 10 most recently used tabs
  in the current window (its default 5x2 grid), the active tab first, with links opened in the
  background right after the current tab. Closing a card refills the grid from the older tabs. Tab
  bar order, liquid glass, layout and preview settings live in Options › Tab switcher. Two-tab
  windows swap directly by default.
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
  previous TabGlance assignment was removed through the browser shortcut settings. Applied this
  update to the live browser while preserving nine visit records. Native Alt+Q switched without
  creating a window, and the destination website had the new content scripts without a refresh.
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
