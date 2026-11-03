# vim-browser: Project Roadmap & Todos

This file tracks the active roadmap, features to build, and final cleanups for `vim-browser`.

---

## 1. Vomnibar Visual Overhaul

- [ ] **Floating Palette Design:** Redesign the floating search bar with modern dark borders,
      rounded corners, subtle shadows, and clean margins.
- [ ] **Input & Typography:** Refined font hierarchy, modern search icons, and smooth focus states.
- [ ] **Smooth Transitions:** Add lightweight CSS transitions for opening and closing the bar.
- [ ] **In-Place URL Editing (`ge`):** Ensure editing current URLs opens seamlessly with cursor
      placed at the end without flicker.

---

## 2. Whole-UI Theme Engine

- [ ] **Unified Color System:** Build a global CSS variable palette rooted in dark mode with purple
      accents (`#68039B` to match the default link hints).
- [ ] **Vomnibar Styling:** Apply the unified dark theme to the Vomnibar background, input field,
      and completion results.
- [ ] **HUD & Notifications:** Style bottom-right HUD alerts (e.g., "Yanked URL", "No query to
      find") with dark translucent glass and purple highlights.
- [ ] **Help Cheat-Sheet (`?`):** Modernize the help modal with clean tables and matching dark
      styling.

---

## 3. Visual Tab Switcher (TabGlance-style)

- [ ] **Snapshot Caching Service:** Capture active tab screenshots using
      `chrome.tabs.captureVisibleTab` on navigation and tab activation; cache in background storage.
- [ ] **Grid Overlay UI:** Responsive centered modal overlay showing preview cards for all open tabs
      in the current window.
- [ ] **Card Components:** Display thumbnail screenshot, website favicon, and clean truncated page
      title.
- [ ] **Fallback Cards:** Clean placeholder with domain and favicon for tabs not yet viewed/cached.
- [ ] **Keyboard Navigation:**
  - Move selection across the grid using `h`, `j`, `k`, `l` (and arrow keys).
  - Press `Enter` to switch to the selected tab.
  - Press `x` to close the selected tab directly from the grid.
  - Press `Esc` to dismiss the switcher.
- [ ] **Keybinding:** Map trigger to a dedicated key (e.g., `T` or custom shortcut).

---

## 4. Curated Search Engine Defaults

- [ ] Pre-populate `searchEngines` setting with curated keywords:
  - `yt`: YouTube search (`https://www.youtube.com/results?search_query=%s`)
  - `gh`: GitHub search (`https://github.com/search?q=%s`)
  - `w`: Wikipedia search (`https://en.wikipedia.org/w/index.php?title=Special:Search&search=%s`)
  - `r`: Reddit search (`https://www.reddit.com/search/?q=%s`)
  - `g`: Google search (`https://www.google.com/search?q=%s`)
  - `ddg`: DuckDuckGo search (`https://duckduckgo.com/?q=%s`)

---

## 5. Minor Utilities Review & Cleanup

- [ ] Decide on browser zoom shortcuts (`zi` / `zo` / `z0`): Keep or rely on browser `Ctrl +/-`.
- [ ] Decide on view source (`gs`): Keep or drop.
- [ ] Decide on clipboard paste-and-open (`p` / `P`): Keep or drop.
- [ ] Confirm clipboard URL yank (`yy`): Keep.

---

## Verification Checklist

- [ ] Code passes `./make.js check` (zero format or lint errors).
- [ ] Tests pass `./make.js test-unit` (100% green).
