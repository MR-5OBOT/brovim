# Brovim

Brovim is a browser extension for keyboard-driven browsing with Vim-style keys: link hints, a
Vomnibar, a visual tab switcher with thumbnails, dark mode for light websites, a dark theme with
purple accents, and ready-made search engine keywords.

## Install from source

**Chrome, Chromium, Brave, Helium, Edge:**

1. Open `chrome://extensions` and turn on Developer Mode.
1. Click "Load unpacked" and select this directory.

**Firefox:** run `./make.js write-firefox-manifest`, open `about:debugging` → "This Firefox" → "Load
Temporary Add-on", and pick any file in this directory.

The Options page opens from the help dialog (type `?`) or from the extension's details page.

**Helium setup:** `helium/shortcuts.json` holds your Helium keyboard shortcuts (the defaults
removed, such as `Ctrl+Tab`, `Ctrl+T`, `Ctrl+W` and `Alt+D`, plus `Alt+S` for Settings; Brovim's
`Alt+X` closes tabs, so `Ctrl+X` stays Cut). On a new machine or profile, start Helium once, close
it, then run `deno run -A helium/setup.js`. It applies those shortcuts and adds
`--extensions-on-chrome-urls` to `~/.config/helium-browser-flags.conf` so Brovim also runs on
Helium's own pages. Shortcuts changed only in the profile stay, and the first run backs up the
profile's settings to `Preferences.before-brovim-setup`. After changing shortcuts in
`chrome://settings/system/shortcuts`, run `deno run -A helium/setup.js save` to copy them back into
the file. Use `--profile <dir>` for a profile other than `~/.config/net.imput.helium/Default`.

## Key bindings

Type `?` on any page to see all active bindings, including the assigned browser tab-switcher
shortcut. Help always shows every bound command; there is no advanced-command toggle.

Use `o` to enter a URL or search in this tab, or `O` to open it in a new tab. The redundant new-tab
settings and `t` command have been removed. Use `Alt+Q` for tab switching; `J`, `K`, `gt`, `gT` and
`^` are no longer bound or available as commands.

| Keys            | Action                                                          |
| --------------- | --------------------------------------------------------------- |
| `j` `k` `h` `l` | Scroll down / up / left / right                                 |
| `gg` `G`        | Scroll to top / bottom                                          |
| `d` `u`         | Scroll half a page down / up                                    |
| `zH` `zL`       | Scroll all the way left / right                                 |
| `f` `F`         | Open a link in this tab / a new tab (hold Shift to flip)        |
| `/` `n` `N`     | Find (plain text, smartcase), next match, previous match        |
| `v` `V`         | Select text / whole lines with Vim movements                    |
| `o` `O`         | Vomnibar: open URL, history, or web search (this tab / new tab) |
| `b` `B`         | Vomnibar: bookmarks (this tab / new tab)                        |
| `ge`            | Edit the current URL                                            |
| `Alt+Q`         | Visual tab switcher, Alt+Tab style (browser shortcut)           |
| `Alt+E`         | Search browser settings, extensions and internal pages          |
| `Alt+X` `X`     | Close any tab (browser shortcut) / restore closed tab           |
| `<<` `>>`       | Move the tab left / right                                       |
| `<a-p>` `<a-m>` | Pin / mute the tab                                              |
| `H` `L`         | History back / forward                                          |
| `r` `R`         | Reload / hard reload                                            |
| `yy`            | Copy the current URL                                            |
| `i` `gi`        | Insert mode, focus the first text input                         |
| `Alt+Z`         | Return focus to the page and recover scrolling                  |
| `zi` `zo` `z0`  | Zoom in / out / reset                                           |
| `Alt+D`         | Dark mode for light websites on / off                           |

Brovim has no count prefixes: digits go to the page. A mapping can still repeat a command, for
example `map J scrollDown count=5`.

Replaced scrolling panes are rediscovered automatically, including inside open shadow roots. Escape
also resets a stale scroll target. If a text field or overlay keeps your keys, press **Alt+Z** to
return focus to the page, leave temporary Brovim modes and rediscover the scrolling pane. It is a
browser shortcut with no custom mapping required; change it in the browser's extension-shortcut
settings. Typing keeps its normal focus until you leave the editor.

Brovim runs on every site by default. Add excluded sites in Options or the toolbar popup. **Keep
focus on the page** is on by default for new settings: websites cannot auto-focus a text field
before your first interaction. An existing saved preference remains respected.

### Browser pages

Press **Alt+E**, type `extensions`, `performance`, `downloads`, `settings`, or another browser page,
then press Enter. The palette appears centered like `o`/`O`, focuses its search input immediately,
and **always opens the result in a new tab**. Arrow keys, Tab and Ctrl+J/K move through results;
Escape closes it. Searches only match the built-in browser-page list.

**Browser: Automatic** uses the browser's exposed identity and falls back to common Chromium pages.
If a browser hides its identity, select Helium or Brave to include its specific pages. The choice is
saved on this device. Helium's keyboard-shortcuts page and Brave's Shields/filter pages are
included. The palette targets Chromium browsers; Firefox-specific destinations are not included.

If a browser page blocks overlays, or the address bar owns focus, the same centered palette opens in
a temporary extension tab. Choosing a result or pressing Escape closes that temporary tab. The
source page stays unchanged. No separate browser window opens.

If the browser already uses Alt+E, assign Brovim's **Search browser settings, extensions and
internal pages** command at `chrome://extensions/shortcuts` (or `brave://extensions/shortcuts`).
This is a one-time manual conflict fix. `helium/shortcuts.json` removes Alt+E from Helium's native
menu; that backup is specific to Helium and is applied by `helium/setup.js` while Helium is closed.

### Text selection

Search with `/`, type a phrase and press Enter, then `v` to adjust the matched selection. Use
`h`/`l` for characters, `j`/`k` for lines, `w`/`b` for words, `e` for a word's end, `0`/`$` for line
boundaries, and `gg`/`G` for the start/end of the document. Arrow keys and Home/End also work. Press
`y` or Enter to copy the selected text, clear its highlight and leave the mode. `Y` copies the
current line and clears the highlight too.

Press `c` to position the caret without extending the selection, then `v` to select from there. `v`
also switches between caret and visual mode. `V` selects whole lines. Escape exits and clears the
highlight, including after copying; clicking an editor returns control to the page. When there is no
existing selection, `v` starts caret mode at visible page text; press `v` again to extend it. Text
fields keep their normal typing behavior.

### Tab switcher

The switcher is a grid of tab previews, most recently used first. Sleeping unpinned tabs (discarded,
frozen, or not loaded since the browser restarted) and hidden tabs are excluded. Pinned tabs stay
eligible while sleeping and wake only when selected; awake background tabs remain available.

The switcher is keyboard-only. Tap your assigned shortcut (`Alt+Q` by default, or `Ctrl+Q` if
reassigned) to switch directly to the previous tab. Hold its modifier to see the grid and repeat its
letter to move through the same list; release the modifier to switch. Adding Shift moves back unless
Shift is already part of your assigned shortcut.

A tap never shows the grid: it appears about a tenth of a second after the shortcut, as desktop
Alt+Tab switchers do, and a release before then just switches. The grid fades in quickly, and its
selection moves without delay as you cycle. The grid opens over whatever you were doing and gives
the focus back when it closes, so a text field you were typing in, on the page or inside an embedded
page, is still ready when you cancel or come back to the tab.

The grid shows at most 12 cards, 6 per row by default: pinned tabs first, in tab-bar order and
including while sleeping or inactive, then the most recently used tabs. Older tabs are left out. All
rows fit in the frame without scrolling; a screen too small for them adds columns, and past that,
keyboard navigation pages through them with a page indicator. A quick tap swaps to the last-used
tab. Holding starts at that tab's visible cell; further presses move to the next cell, wrapping from
the last cell back to cell 0. Closing a card moves the following cards up. Arrow keys, `h` `j` `k`
`l` and Tab also move, `Enter` switches, `x`, Delete or Backspace close the selected tab, and `Esc`
cancels. Mouse movement, clicks, middle clicks, touch and wheel input do not operate the switcher;
there are no close buttons.

In shortcut order, the current tab comes first, then tabs used this session (new background tabs
come right after the current tab, including tabs created without an opener), then the rest by when
they were last used. Options › Tab switcher offers tab bar order instead, fewer cards per row, a
liquid glass panel (off by default), direct swapping with two tabs (on by default), and the preview
settings below. Change the shortcut at `chrome://extensions/shortcuts`; if another extension already
uses it, assign it to Brovim there.

Previews are taken after the first paint when a page loads or you return to a tab without one, then
refreshed after it settles. URL changes and long scrolls also refresh them, at most every 5 seconds.
Saved previews are included in the grid's first draw; opening and cycling never wait for a new
capture or for storage. Captures are deferred while Brovim's own UI is on screen. Previews are saved
by page address on this device (the 15 most recent by default, with options for 30 or 50 and a 6 MB
cache limit), so they survive browser restarts. Existing 5- or 10-preview settings upgrade to 15
automatically. This screenshot cache does not limit the tab list or browsing history. Clearing
browsing history deletes the previews of the pages it removes, and excluding a site deletes its
previews. Incognito previews stay in memory and are dropped when Brovim's background stops (after
about 30 idle seconds). A tab without a saved preview shows its site's first letter until you view
it: Chrome can capture only the active tab in a window.

Browser pages use **the same tap, hold and release behavior as websites**. Where Chromium permits
Brovim's scripts (including Helium's Extensions page with the launch flag below), holding shows the
grid and releasing selects the highlighted tab. Quick taps switch automatically, including before
the grid finishes loading. This is hardcoded with no new setting and works even when ordinary
browser-page mappings are off. The existing two-tab quick-swap option applies everywhere.

Where a tab can't show the grid, a press switches to the previous tab at once, which is all a tap
wants. If you're still holding the modifier a moment later, the grid appears there, for the same
gesture: repeat the letter to move, release to switch, or press `Esc` to return to the tab you
started on. That covers pages that block extension scripts (the Web Store, `view-source:` and error
pages), sandboxed pages (raw.githubusercontent.com, for example: their sandbox passes on to Brovim's
frames, so the grid, Vomnibar, HUD and help can't open there), the PDF viewer, fullscreen video,
embedded pages Brovim can't run in, and the address bar when it has the focus.

It covers tabs still loading, too. A loading tab shows the grid itself as soon as any of its page is
drawn, unless its scripts are busy. Before that (its server hasn't answered, a tab woken from sleep
is still getting its page back, or the page waits for a script or stylesheet), the browser shows
nothing and gives the page no keys, so the grid opens on the previous tab. Brovim keeps its
background running while such a tab is in front, so this works on the first press; if the browser
stopped it anyway, a press switches without a grid, which shows on your next press. When the tab a
gesture moved to can't see the keys either (two PDFs, say), a press within 0.4 s of the last one
continues a held gesture, and a slower one is a new tap: taps flip between the two, and quick
presses while holding walk on through the list. The switcher never opens a separate window, and the
shortcut also works on excluded sites and while an input is focused.

A page whose scripts are busy (a heavy page loading, YouTube stalling for hundreds of milliseconds)
can't tell a tap from a hold until it catches up. If it doesn't answer the shortcut within 30 ms,
the press switches to the previous tab at once, before a tap lets go of the modifier: that tab sees
a tap's release and stays, or shows the grid while you hold. Pages tell Brovim the moment the
shortcut's modifier goes down; a page that hasn't (it missed the key, being busy) gets 20 ms. `Esc`
returns to the busy tab. If the busy page later shows that a very quick tap's release reached it
before the switch, the grid that opened for it closes. Only a page that gives no answer for two
seconds counts as hung.

The grid hides before the switch, so a tab you come back to never flashes the old grid; on a busy
page that can't hide it in time, the grid clears itself and the switch waits at most 50 ms.

`Ctrl+Tab` is a reserved browser shortcut; Brovim cannot reliably disable it while the extension is
active. In Helium versions with custom keyboard shortcuts, open `chrome://settings/system/shortcuts`
and remove `Ctrl+Tab` from **Next tab** (and `Ctrl+Shift+Tab` from **Previous tab**, if desired).
This is a browser-wide preference, independent of whether Brovim is enabled. See the
[Chrome shortcut restrictions](https://developer.chrome.com/docs/extensions/reference/api/commands#key-combination-requirements)
and
[Helium's shortcut settings](https://github.com/imputnet/helium/blob/main/patches/helium/settings/custom-keyboard-shortcuts-page.patch).

The unpacked extension loaded from this repository also supports Helium's internal pages. Options →
General → **Use Brovim on browser pages** is on by default and can be turned off; saving applies the
change to open browser pages immediately. The usual excluded-site rules can disable individual pages
such as `chrome://settings/*`. Add `--extensions-on-chrome-urls` to Helium's launch flags and fully
restart it. The flag must be included on every launch. Keep loading this repository root: there is
no separate build, settings import or shortcut reassignment. The flag lets extensions that request
`chrome://` access read and modify browser pages. Without it, Brovim keeps working on ordinary
websites. Browser menus, the address bar, other extensions' pages, and some privileged internal
pages remain restricted. Branded Google Chrome and Firefox do not support this override; store
packages omit the Chromium-only host permission. See
[Chromium's security FAQ](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/extensions/docs/security_faq.md).

Recency order survives extension reloads and resets when the browser starts a new session. Existing
website tabs recover their Brovim controls automatically after an extension update.

### Dark mode

Press `Alt+D` on any page to turn dark mode on or off in every tab. Light websites go dark; photos
and videos are not inverted, and pages that already have a dark theme are left alone. Options › Dark
mode sets brightness, contrast, sepia and grayscale, and lists sites that should never be darkened
(one per line, like `example.com`; subdomains are included). The default list includes Gmail,
WhatsApp Web, YouTube, GitHub, Reddit, Discord, Telegram Web, X, Facebook, Messenger, Instagram,
Twitch, Spotify, Wikipedia, Outlook, ChatGPT, Notion and Slack. Enable each site's own dark theme in
its settings. You can add or remove entries; an existing custom list is preserved.

`Alt+D` is a page key like `<a-p>`: it works when the page has the focus, not while you type in a
text field. Browsers keep `Alt+D` for the address bar, so it can't be a browser-wide extension
shortcut. Use `map <key> toggleDarkMode` to choose another key.

Dark mode inverts the page with a CSS filter. Background images set in a site's stylesheets stay
inverted.

### Search engines

In the Vomnibar, type a keyword and a query: `ddg` DuckDuckGo, `w` Wikipedia, `yt` YouTube, `gh`
GitHub, `r` Reddit. Edit them under "Custom search engines" in the options. A query without a
keyword uses your browser's default search engine.

### Hint colors

Open Options → Theme to change the hint box, hint letters, and typed letters. Save changes and press
`f` on an open page to use the new colors. Each picker has a Reset link. Custom CSS under Advanced
Options can override the colors.

Type the displayed label to select a link, including `f` for an `F` label. Press `Esc` to cancel,
even while hints are still loading. Fast selections typed during loading are retained.

## Custom key mappings

Remap keys under "Custom key mappings" in the options, one statement per line:

- `map key command [options]`, e.g. `map <c-d> scrollPageDown` or `map r reload hard`
- `unmap key`
- `unmapAll`

Lines starting with `"` or `#` are comments. The options page links to a list of every command.

## Development

The build and test tasks need [Deno](https://deno.com):

```sh
./make.js check       # formatting and lint
./make.js test-unit   # unit tests
./make.js test-dom    # DOM tests in headless Chrome (Puppeteer)
./make.js test-browser # installed-extension checks in temporary Chromium
./make.js test-lifecycle # real incognito window and background-worker recovery
./make.js test-native # actual Alt+Q events on an isolated X server (Linux)
./make.js test-internal-pages # browser-page permission and on/off checks
./make.js test-browser-navigation # browser-page palette and protected-page grid
./make.js package     # store zips in dist/
```

`test-dom` uses Puppeteer's Chrome. Set `PUPPETEER_EXECUTABLE_PATH` to use a browser that's already
installed.

The supplied icon master is `icons/new-icon.png`. Run `./build_scripts/update_icons.sh` with
ImageMagick installed to regenerate the transparent PNG sizes and toolbar states.

`test-lifecycle` also supports Firefox. Extract the Firefox ZIP built by `package`, then run:

```sh
BROVIM_TEST_BROWSER=firefox PUPPETEER_EXECUTABLE_PATH=/path/to/firefox \
  BROVIM_EXTENSION_PATH=/path/to/extracted-firefox-package ./make.js test-lifecycle
```

These checks use temporary profiles. Firefox checks cover hints, the Vomnibar, scrolling, settings,
thumbnail capture, private-cache storage and the tab switcher.

On Linux, `test-native` uses Python 3, libX11 and libXtst to send real keyboard events to a
dedicated Xvfb server. Choose a free display number that differs from your desktop:

```sh
Xvfb :91 -screen 0 1280x900x24 -nolisten tcp -ac &
brovim_xvfb_pid=$!
BROVIM_NATIVE_DISPLAY=:91 ./make.js test-native
kill "$brovim_xvfb_pid"
```

This checks accelerator delivery, rapid cycling through the grid, reverse cycling, modifier release,
protected-page handoff, taps and holds while typing (on the page and in an embedded page), a page
that stalls, a PDF, a new tab's address bar, and tabs still loading on a slow network. It refuses
the desktop display, including equivalent screen aliases, so its keyboard events stay off your
normal browser session.

See [REPORT.md](REPORT.md) for the consolidated roadmap, implementation history, and verification
results.
