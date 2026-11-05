# Brovim

Brovim is a browser extension for keyboard-driven browsing in the spirit of Vim. It is a streamlined
fork of [Vimium](https://github.com/philc/vimium): niche modes were removed, and it adds a dark
theme with purple accents, a visual tab switcher with thumbnails, and ready-made search engine
keywords.

## Install from source

**Chrome, Chromium, Brave, Helium, Edge:**

1. Open `chrome://extensions` and turn on Developer Mode.
1. Click "Load unpacked" and select this directory.

**Firefox:** run `./make.js write-firefox-manifest`, open `about:debugging` → "This Firefox" → "Load
Temporary Add-on", and pick any file in this directory.

The Options page opens from the help dialog (type `?`) or from the extension's details page.

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
| `<a-f>`         | Open several links in new tabs                                  |
| `yf`            | Copy a link's URL                                               |
| `/` `n` `N`     | Find (plain text, smartcase), next match, previous match        |
| `o` `O`         | Vomnibar: open URL, history, or web search (this tab / new tab) |
| `b` `B`         | Vomnibar: bookmarks (this tab / new tab)                        |
| `ge`            | Edit the current URL                                            |
| `Alt+Q`         | Visual tab switcher, Alt+Tab style (browser shortcut)           |
| `x` `X`         | Close tab / restore closed tab                                  |
| `<<` `>>`       | Move the tab left / right                                       |
| `<a-p>` `<a-m>` | Pin / mute the tab                                              |
| `H` `L`         | History back / forward                                          |
| `r` `R`         | Reload / hard reload                                            |
| `yy` `p` `P`    | Copy the URL, open the clipboard URL here / in a new tab        |
| `i` `gi`        | Insert mode, focus the first text input                         |
| `zi` `zo` `z0`  | Zoom in / out / reset                                           |
| `gs`            | View source                                                     |

Brovim has no count prefixes: digits go to the page. A mapping can still repeat a command, for
example `map J scrollDown count=5`.

Gmail and WhatsApp Web are disabled by default. Change excluded sites in Options or the toolbar
popup.

### Tab switcher

The switcher works like TabGlance's: a grid of tab previews, most recently used first. Sleeping
(discarded or frozen) tabs and hidden tabs are excluded; awake background tabs remain available.

The switcher is keyboard-only. Tap your assigned shortcut (`Alt+Q` by default, or `Ctrl+Q` if
reassigned) to switch directly to the previous tab. Hold its modifier to see the grid and repeat its
letter to move through the same list; release the modifier to switch. Adding Shift moves back unless
Shift is already part of your assigned shortcut.

The grid shows up to 10 recent awake tabs (5 per row, 2 rows; both can be changed). Repeated
shortcut presses wrap within those displayed cards; older tabs beyond this grid stay outside the
cycle. Closing a card brings in the next eligible tab. Arrow keys, `h` `j` `k` `l` and Tab also
move, `Enter` switches, `x`, Delete or Backspace close the selected tab, and `Esc` cancels. Mouse
movement, clicks, middle clicks, touch and wheel input do not operate the switcher; there are no
close buttons.

The current tab comes first, then tabs used this session (new background tabs come right after the
current tab, including tabs created without an opener), then the rest by when they were last used.
This is also how TabGlance's cycling grid places the current tab. Options › Tab switcher offers tab
bar order instead, the number of cards per row and rows, a liquid glass panel, direct swapping with
two tabs (on by default), and the preview settings below. Change the shortcut at
`chrome://extensions/shortcuts`; if another extension already uses it, assign it to Brovim there.

Previews are taken after the first paint when a page loads or you return to a tab, then refreshed
after it settles. URL changes and long scrolls also refresh them. Saved previews are included in the
grid's first draw; opening and cycling never wait for a new capture or for storage. Captures are
deferred while Brovim's own UI is on screen. Previews are saved by page address on this device (the
60 most recent by default), so they survive browser restarts. Incognito previews are kept only until
the browser closes. A tab without a saved preview shows its site's first letter until you view it:
Chrome can capture only the active tab in a window.

On browser settings, new-tab pages and pages that block extension scripts, the shortcut switches
directly using your chosen order. Further presses while held continue the original list instead of
bouncing between two tabs; the grid resumes on the next page that supports it. Protected pages
cannot report key releases, so abandoned fallback gestures expire after three seconds of inactivity.
The switcher never opens a separate window. The shortcut also works on excluded sites and while an
input is focused. Unresponsive pages fall back to direct switching.

`Ctrl+Tab` is a reserved browser shortcut; Brovim cannot reliably disable it while the extension is
active. In Helium versions with custom keyboard shortcuts, open `chrome://settings/system/shortcuts`
and remove `Ctrl+Tab` from **Next tab** (and `Ctrl+Shift+Tab` from **Previous tab**, if desired).
This is a browser-wide preference, independent of whether Brovim is enabled. See the
[Chrome shortcut restrictions](https://developer.chrome.com/docs/extensions/reference/api/commands#key-combination-requirements)
and
[Helium's shortcut settings](https://github.com/imputnet/helium/blob/main/patches/helium/settings/custom-keyboard-shortcuts-page.patch).

Recency order survives extension reloads and resets when the browser starts a new session. Existing
website tabs recover their Brovim controls automatically after an extension update.

### Search engines

In the Vomnibar, type a keyword and a query: `g` Google, `ddg` DuckDuckGo, `w` Wikipedia, `yt`
YouTube, `gh` GitHub, `r` Reddit. Edit them under "Custom search engines" in the options.

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
./make.js package     # store zips in dist/
```

`test-dom` uses Puppeteer's Chrome. Set `PUPPETEER_EXECUTABLE_PATH` to use a browser that's already
installed.

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

This checks accelerator delivery, rapid cycling inside the recent grid, reverse cycling, modifier
release and protected-page handoff. It refuses the desktop display, including equivalent screen
aliases, so its keyboard events stay off your normal browser session.

See [REPORT.md](REPORT.md) for the consolidated roadmap, implementation history, and verification
results.

## License

MIT, like Vimium.
