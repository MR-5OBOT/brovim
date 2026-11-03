# Brovim: Project Roadmap & Todos

This file tracks the active roadmap, features to build, and final cleanups for Brovim.

---

## 1. Vomnibar Visual Overhaul

- [x] **Floating Palette Design:** Redesign the floating search bar with modern dark borders,
      rounded corners, subtle shadows, and clean margins.
- [x] **Input & Typography:** Refined font hierarchy, a search icon, and smooth focus states.
- [x] **Smooth Transitions:** The bar fades in each time it opens. Closing is instant, so the
      selected action never waits on an animation.
- [x] **In-Place URL Editing (`ge`):** Ensure editing current URLs opens seamlessly with cursor
      placed at the end without flicker.

---

## 2. Whole-UI Theme Engine

- [x] **Unified Color System:** Build a global CSS variable palette rooted in dark mode with purple
      accents (`#68039B` to match the default link hints). The in-page UI uses it in both light and
      dark OS themes; the options, popup and command-listing pages stay light in a light theme.
- [x] **Vomnibar Styling:** Apply the unified dark theme to the Vomnibar background, input field,
      and completion results.
- [x] **HUD & Notifications:** Style bottom-right HUD alerts (e.g., "Yanked URL", "No query to
      find") with dark translucent glass and purple highlights.
- [x] **Help Cheat-Sheet (`?`):** Modernize the help modal with clean tables and matching dark
      styling.

---

## 3. Visual Tab Switcher (TabGlance-style)

- [x] **Snapshot Caching Service:** Capture active tab screenshots using
      `chrome.tabs.captureVisibleTab` on navigation and tab activation, downscale them to 480px
      thumbnails, and cache them in `chrome.storage.session` (survives the service worker being
      suspended).
- [x] **Grid Overlay UI:** Responsive centered modal overlay showing preview cards for all open tabs
      in the current window.
- [x] **Card Components:** Display thumbnail screenshot, website favicon, and clean truncated page
      title.
- [x] **Fallback Cards:** Clean placeholder with domain and favicon for tabs not yet viewed/cached.
- [x] **Keyboard Navigation:**
  - Move selection across the grid using `h`, `j`, `k`, `l` (and arrow keys).
  - Press `Enter` to switch to the selected tab.
  - Press `x` to close the selected tab directly from the grid.
  - Press `/` to search; `Esc` dismisses the switcher.
- [x] **Keybinding:** Map trigger to a dedicated key (`T`).
- [x] **Alt+Q:** Browser-wide shortcut that works like Alt+Tab: hold Alt, tap Q to cycle, release to
      switch.

---

## 4. Curated Search Engine Defaults

- [x] Pre-populate `searchEngines` setting with curated keywords:
  - `yt`: YouTube search (`https://www.youtube.com/results?search_query=%s`)
  - `gh`: GitHub search (`https://github.com/search?q=%s`)
  - `w`: Wikipedia search (`https://www.wikipedia.org/w/index.php?title=Special:Search&search=%s`)
  - `r`: Reddit search (`https://www.reddit.com/search/?q=%s`)
  - `g`: Google search (`https://www.google.com/search?q=%s`)
  - `ddg`: DuckDuckGo search (`https://duckduckgo.com/?q=%s`)

---

## 5. Minor Utilities Review & Cleanup

- [x] Browser zoom shortcuts (`zi` / `zo` / `z0`): Kept and working.
- [x] View source (`gs`): Kept and working.
- [x] Clipboard paste-and-open (`p` / `P`): Kept and working.
- [x] Clipboard URL yank (`yy`): Kept and working.

---

## Verification Checklist

- [x] Code passes `./make.js check` (zero format or lint errors).
- [x] Tests pass `./make.js test-unit` (100% green).
- [x] Tests pass `./make.js test-dom` (100% green; tests for removed features deleted).
