# Brovim

Brovim is a browser extension for keyboard-driven browsing in the spirit of Vim. It is a streamlined
fork of [Vimium](https://github.com/philc/vimium): niche modes were removed, and it adds a dark
purple theme, a visual tab switcher with thumbnails, and ready-made search engine keywords.

## Install from source

**Chrome, Chromium, Brave, Helium, Edge:**

1. Open `chrome://extensions` and turn on Developer Mode.
1. Click "Load unpacked" and select this directory.

**Firefox:** run `./make.js write-firefox-manifest`, open `about:debugging` → "This Firefox" → "Load
Temporary Add-on", and pick any file in this directory.

The Options page opens from the help dialog (type `?`) or from the extension's details page.

## Key bindings

Type `?` on any page to see the bindings that are currently active.

| Keys                | Action                                                   |
| ------------------- | -------------------------------------------------------- |
| `j` `k` `h` `l`     | Scroll down / up / left / right                          |
| `gg` `G`            | Scroll to top / bottom                                   |
| `d` `u`             | Scroll half a page down / up                             |
| `zH` `zL`           | Scroll all the way left / right                          |
| `f` `F`             | Open a link in this tab / a new tab (hold Shift to flip) |
| `<a-f>`             | Open several links in new tabs                           |
| `yf`                | Copy a link's URL                                        |
| `/` `n` `N`         | Find (plain text, smartcase), next match, previous match |
| `o` `O`             | Vomnibar: URL, bookmark or history (this tab / new tab)  |
| `b` `B`             | Vomnibar: bookmarks (this tab / new tab)                 |
| `ge`                | Edit the current URL                                     |
| `T`                 | Visual tab switcher                                      |
| `Alt+Q`             | Tab switcher, Alt+Tab style (browser-wide shortcut)      |
| `J` `K` (`gT` `gt`) | Previous / next tab                                      |
| `^`                 | Go to the previously visited tab                         |
| `t` `x` `X`         | New tab, close tab, restore closed tab                   |
| `<<` `>>`           | Move the tab left / right                                |
| `<a-p>` `<a-m>`     | Pin / mute the tab                                       |
| `H` `L`             | History back / forward                                   |
| `r` `R`             | Reload / hard reload                                     |
| `yy` `p` `P`        | Copy the URL, open the clipboard URL here / in a new tab |
| `i` `gi`            | Insert mode, focus the first text input                  |
| `zi` `zo` `z0`      | Zoom in / out / reset                                    |
| `gs`                | View source                                              |

Brovim has no count prefixes: digits go to the page. A mapping can still repeat a command, for
example `map J scrollDown count=5`.

### Tab switcher

`T` opens a grid of the current window's tabs. Move with `h` `j` `k` `l` or the arrow keys, press
`Enter` to switch, `x` to close the selected tab, `/` to search, and `Esc` to dismiss.

`Alt+Q` works like Alt+Tab: hold Alt, tap Q to move through the tabs, and release Alt to switch. You
can change this shortcut at `chrome://extensions/shortcuts`.

### Search engines

In the Vomnibar, type a keyword and a query: `g` Google, `ddg` DuckDuckGo, `w` Wikipedia, `yt`
YouTube, `gh` GitHub, `r` Reddit. Edit them under "Custom search engines" in the options.

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
./make.js package     # store zips in dist/
```

`test-dom` uses Puppeteer's Chrome. Set `PUPPETEER_EXECUTABLE_PATH` to use a browser that's already
installed.

## License

MIT, like Vimium. See [MIT-LICENSE.txt](MIT-LICENSE.txt) and [CREDITS](CREDITS).
