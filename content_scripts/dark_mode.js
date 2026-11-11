// Dark mode for light websites. Like the filter mode of dark-theme extensions: one CSS filter on
// the root inverts the page's lightness and keeps its hues, then photos and videos are inverted
// back. Pages that already look dark are left alone. Only the top frame applies the filter; child
// frames are drawn inside it and are inverted with it.
// ponytail: CSS background images from stylesheets stay inverted; a per-image pass (as dynamic
// dark themes do) would fix them, at many times the code.
const DarkMode = {
  styleEl: null,
  colorCtx: null,

  init() {
    if (!DomUtils.isTopFrame()) return;
    Settings.onLoaded().then(() => this.update());
    Settings.addEventListener("change", () => this.update());
    // Look again once the page's own styles are in, then after it loads.
    DomUtils.documentReady().then(() => this.update());
    globalThis.addEventListener("load", () => this.update(), { once: true });
  },

  update() {
    if (!Settings.isLoaded() || !document.documentElement) return;
    // After an extension update, take over the style the previous content script left behind.
    this.styleEl ??= document.getElementById("brovim-dark-mode") ??
      Object.assign(DomUtils.createElement("style"), { id: "brovim-dark-mode" });
    // Measure the page without this filter.
    this.styleEl.remove();
    if (!Settings.get("darkModeEnabled") || this.isExcluded(location.hostname)) return;
    const canvas = this.canvasColor();
    if (Settings.get("darkModeSkipDarkPages") && this.pageIsDark(canvas)) return;
    this.styleEl.textContent = this.css(canvas);
    document.documentElement.appendChild(this.styleEl);
  },

  css([r, g, b]) {
    const reverse = "invert(1) hue-rotate(180deg)";
    const percent = (name) => Settings.get(`darkMode${name}`);
    const filter = `${reverse} brightness(${percent("Brightness")}%) ` +
      `contrast(${percent("Contrast")}%) sepia(${percent("Sepia")}%) ` +
      `grayscale(${percent("Grayscale")}%)`;
    // The browser's default white behind a page with no background isn't filtered; the root's own
    // background is. Top-layer dialogs and popovers are drawn outside the root, so they get their
    // own filter. Brovim's UI uses --brovim-reverse-filter to keep its colors (see vimium.css).
    return `html {
  filter: ${filter} !important;
  background: rgb(${r} ${g} ${b}) !important;
  --brovim-reverse-filter: ${reverse};
}
:is(dialog:modal, [popover]:popover-open) { filter: ${filter} !important; }
img:not([src*=".svg"]):not([src*="image/svg+xml"]), video, svg image, embed, object, iframe[src*="youtube"],
iframe[src*="vimeo"], [style*="url("]:not(html, body) {
  filter: ${reverse} !important;
}
:fullscreen, :fullscreen * { filter: none !important; }`;
  },

  // The setting holds hosts like "example.com", one per line; subdomains are included.
  isExcluded(hostname) {
    return Settings.get("darkModeExcludedSites").split(/\s+/).some((site) => {
      site = site.toLowerCase().replace(/^[a-z]+:\/\//, "").replace(/^\*?\./, "").split(/[/:]/)[0];
      return site && (hostname === site || hostname.endsWith(`.${site}`));
    });
  },

  // The window's background: the root's, else the body's, else the browser's default.
  canvasColor() {
    const root = document.documentElement;
    const color = [root, document.body].filter(Boolean).map((el) => this.backgroundOf(el))
      .find(([, , , a]) => a > 127);
    if (color) return color;
    const schemes = `${getComputedStyle(root).colorScheme} ` +
      (document.querySelector("meta[name=color-scheme]")?.content ?? "");
    const dark = /dark/.test(schemes) &&
      (!/light/.test(schemes) || globalThis.matchMedia("(prefers-color-scheme: dark)").matches);
    return dark ? [18, 18, 18, 255] : [255, 255, 255, 255];
  },

  // A page already looks dark when most points sampled across the window sit on a dark background.
  pageIsDark(canvas) {
    if (!document.body) return false;
    let dark = 0;
    for (const x of [0.2, 0.5, 0.8]) {
      for (const y of [0.2, 0.5, 0.8]) {
        const color = document.elementsFromPoint(innerWidth * x, innerHeight * y)
          .map((el) => this.backgroundOf(el)).find(([, , , a]) => a > 127);
        if (this.isDark(color ?? canvas)) dark++;
      }
    }
    return dark > 4;
  },

  isDark([r, g, b]) {
    return 0.299 * r + 0.587 * g + 0.114 * b < 128;
  },

  backgroundOf(el) {
    return this.rgba(getComputedStyle(el).backgroundColor);
  },

  // [r, g, b, a] in 0-255. A canvas reads any CSS color format, including oklch() and color().
  rgba(color) {
    this.colorCtx ??= new OffscreenCanvas(1, 1).getContext("2d", { willReadFrequently: true });
    const ctx = this.colorCtx;
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = "transparent";
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 1, 1);
    return ctx.getImageData(0, 0, 1, 1).data;
  },
};

if (globalThis.window != null) DarkMode.init();

globalThis.DarkMode = DarkMode;
