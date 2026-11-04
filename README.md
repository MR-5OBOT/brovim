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

Type `?` on any page to see the bindings that are currently active.

| Keys                | Action                                                          |
| ------------------- | --------------------------------------------------------------- |
| `j` `k` `h` `l`     | Scroll down / up / left / right                                 |
| `gg` `G`            | Scroll to top / bottom                                          |
| `d` `u`             | Scroll half a page down / up                                    |
| `zH` `zL`           | Scroll all the way left / right                                 |
| `f` `F`             | Open a link in this tab / a new tab (hold Shift to flip)        |
| `<a-f>`             | Open several links in new tabs                                  |
| `yf`                | Copy a link's URL                                               |
| `/` `n` `N`         | Find (plain text, smartcase), next match, previous match        |
| `o` `O`             | Vomnibar: open URL, history, or web search (this tab / new tab) |
| `b` `B`             | Vomnibar: bookmarks (this tab / new tab)                        |
| `ge`                | Edit the current URL                                            |
| `Alt+Q`             | Visual tab switcher, Alt+Tab style (browser shortcut)           |
| `J` `K` (`gT` `gt`) | Previous / next tab                                             |
| `^`                 | Go to the previously visited tab                                |
| `t` `x` `X`         | New tab, close tab, restore closed tab                          |
| `<<` `>>`           | Move the tab left / right                                       |
| `<a-p>` `<a-m>`     | Pin / mute the tab                                              |
| `H` `L`             | History back / forward                                          |
| `r` `R`             | Reload / hard reload                                            |
| `yy` `p` `P`        | Copy the URL, open the clipboard URL here / in a new tab        |
| `i` `gi`            | Insert mode, focus the first text input                         |
| `zi` `zo` `z0`      | Zoom in / out / reset                                           |
| `gs`                | View source                                                     |

Brovim has no count prefixes: digits go to the page. A mapping can still repeat a command, for
example `map J scrollDown count=5`.

Gmail and WhatsApp Web are disabled by default. Change excluded sites in Options or the toolbar
popup.

### Tab switcher

Tap `Alt+Q` to switch straight to the previous tab. Hold Alt to see the preview grid on websites,
tap Q to cycle, and release Alt to switch. Thumbnails load independently of navigation. You can
customize this shortcut at `chrome://extensions/shortcuts`. If another tab-switcher extension
already uses `Alt+Q`, assign it to Brovim on that page.

The switcher shows every open tab in the current window, including discarded and frozen ones. There
is no numeric limit. The current tab comes first, then tabs used this session (most recent first,
with links you open in the background placed right after the current tab), then the rest by when
they were last used, with the previous tab selected so a quick tap switches back. With only two tabs
in the window, `Alt+Q` always swaps directly. While the switcher is open, you can also move with `h`
`j` `k` `l` or the arrow keys, press `Enter` to switch, `x` to close the selected tab, and `Esc` (or
click outside) to dismiss.

On browser settings, new-tab pages and pages that block extension scripts, `Alt+Q` switches directly
to the previous tab. It never opens a separate switcher window. The shortcut also works on excluded
sites and while an input is focused. Unresponsive pages fall back to direct switching.

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
./make.js package     # store zips in dist/
```

`test-dom` uses Puppeteer's Chrome. Set `PUPPETEER_EXECUTABLE_PATH` to use a browser that's already
installed.

See [REPORT.md](REPORT.md) for the consolidated roadmap, implementation history, and verification
results.

## License

MIT, like Vimium. See [MIT-LICENSE.txt](MIT-LICENSE.txt) and [CREDITS](CREDITS).
