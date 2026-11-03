# Drop Unwanted Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

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

## Global Constraints

- Must pass `./make.js test-unit` with 0 failures.
- Must pass `./make.js check` (linter and code formatting) cleanly.
- Do not break core kept features: scrolling, core link hints (`f`, `F`, `<a-f>`), literal find
  (`/`, `n`, `N`), Vomnibar (`o`, `O`, `b`, `B`, `T`, `ge`), tab switching (`J`, `K`), reload, copy
  URL (`yy`).

## Review Focus

- Unbound or removed commands should not throw unhandled exceptions if configured in custom
  mappings.
- Number keys (0-9) must no longer buffer as count prefixes or block normal web page typing.
- Link hints must only activate supported modes (current tab, new background tab, queue, copy url,
  incognito).
- Removing marks must not break `scrollToTop`, `scrollToBottom`, or find mode.
- In-page find must function cleanly as literal search without regex syntax errors.

---

### Task 1: Clean Command Registries & Key Mappings

**Files:**

- Modify: `background_scripts/all_commands.js`
- Modify: `background_scripts/commands.js`
- Modify: `tests/unit_tests/commands_test.js`

### Task 2: Remove Marks and Visual Mode

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

### Task 3: Remove Frame Navigation and URL Hierarchy Slicing

**Files:**

- Modify: `background_scripts/all_commands.js`
- Modify: `background_scripts/commands.js`
- Modify: `background_scripts/main.js`
- Modify: `content_scripts/mode_normal.js`
- Modify: `content_scripts/vimium_frontend.js`

### Task 4: Remove Unwanted Tab Controls

**Files:**

- Modify: `background_scripts/all_commands.js`
- Modify: `background_scripts/commands.js`
- Modify: `background_scripts/main.js`
- Modify: `tests/unit_tests/tab_operations_test.js`
- Modify: `tests/unit_tests/main_test.js`

### Task 5: Remove Count Prefixes and PassNextKey

**Files:**

- Modify: `content_scripts/mode_key_handler.js`
- Modify: `content_scripts/mode_normal.js`
- Modify: `content_scripts/mode_insert.js`
- Modify: `background_scripts/commands.js`

### Task 6: Prune Link Hints Modes (Download, Hover, Focus, Foreground)

**Files:**

- Modify: `content_scripts/link_hints.js`
- Modify: `content_scripts/mode_normal.js`
- Modify: `tests/unit_tests/link_hints_test.js`

### Task 7: Remove Pagination Guessing and Search Highlighted Text

**Files:**

- Modify: `content_scripts/mode_normal.js`
- Modify: `lib/settings.js`

### Task 8: Simplify Find Mode to Literal Search

**Files:**

- Modify: `content_scripts/mode_find.js`
- Modify: `lib/settings.js`

### Task 9: Remove Command Mode (:) and Edit URL in New Tab (gE) from Vomnibar

**Files:**

- Modify: `content_scripts/vomnibar.js`
- Modify: `background_scripts/completion/completers.js`
- Modify: `background_scripts/main.js`
- Modify: `pages/vomnibar_page.js`
- Modify: `tests/unit_tests/completion/completers_test.js`

### Task 10: Run Verification and Linting

- Run: `./make.js test-unit`
- Run: `./make.js check`
- Ensure all tests pass cleanly with zero lint errors.
