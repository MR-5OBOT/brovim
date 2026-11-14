// NOTE: Ultimately, all of the FindMode-related code should be moved here.

// This prevents unmapped printable characters from being passed through to underlying page; see
// #1415. Only used by PostFindMode, below.
class SuppressPrintable extends Mode {
  constructor(options) {
    super();
    super.init(options);
    const handler = (event) =>
      KeyboardUtils.isPrintable(event) ? this.suppressEvent : this.continueBubbling;
    const initialType = globalThis.getSelection().type;

    // We use unshift here, so we see events after normal mode, so we only see unmapped keys.
    this.unshift({
      _name: `mode-${this.id}/suppress-printable`,
      keydown: handler,
      keypress: handler,
      keyup: () => {
        // If the selection type has changed (usually, no longer "Range"), then the user is
        // interacting with the input element, so we get out of the way. See discussion of option 5c
        // from #1415.
        if (globalThis.getSelection().type !== initialType) {
          return this.exit();
        }
      },
    });
  }
}

// When we use find, the selection/focus can land in a focusable/editable element. In this
// situation, special considerations apply. We implement three special cases:
//   1. Disable insert mode, because the user hasn't asked to enter insert mode. We do this by using
//      InsertMode.suppressEvent.
//   2. Prevent unmapped printable keyboard events from propagating to the page; see #1415. We do
//      this by inheriting from SuppressPrintable.
//   3. If the very-next keystroke is Escape, then drop immediately into insert mode.
//
const newPostFindMode = function () {
  if (!document.activeElement || !DomUtils.isEditable(document.activeElement)) {
    return;
  }
  return new PostFindMode();
};

class PostFindMode extends SuppressPrintable {
  constructor() {
    const element = document.activeElement;
    super({
      name: "post-find",
      // PostFindMode shares a singleton with focusInput; each displaces the other.
      singleton: "post-find-mode/focus-input",
      exitOnBlur: element,
      exitOnClick: true,
      // Always truthy, so always continues bubbling.
      keydown(event) {
        return InsertMode.suppressEvent(event);
      },
      keypress(event) {
        return InsertMode.suppressEvent(event);
      },
      keyup(event) {
        return InsertMode.suppressEvent(event);
      },
    });

    // If the very-next keydown is Escape, then exit immediately, thereby passing subsequent keys to
    // the underlying insert-mode instance.
    this.push({
      _name: `mode-${this.id}/handle-escape`,
      keydown: (event) => {
        if (KeyboardUtils.isEscape(event)) {
          this.exit();
          return this.suppressEvent;
        } else {
          handlerStack.remove();
          return this.continueBubbling;
        }
      },
    });
  }
}

class FindMode extends Mode {
  // Programmatically injected files have separate script scopes. Cross-file callers use the
  // exported class instead of reaching for local helpers.
  static enterPostFindMode() {
    return newPostFindMode();
  }

  static scrollRangeIntoView(range) {
    return scrollRangeIntoView(range);
  }

  constructor(options) {
    super();

    if (options == null) {
      options = {};
    }

    // TODO: I don't think this.query is ever used/accessed, because it's only accessed from
    // static methods. Consider splitting the static portions of this class into a separate class
    // called FindModeSingleton. Blending the two together is confusing.
    this.query = {
      rawQuery: "",
      parsedQuery: "",
      matchCount: 0,
      hasResults: false,
    };

    // Save the selection, so findInPlace can restore it.
    this.initialRange = getCurrentRange();
    FindMode.query = { rawQuery: "" };

    if (options.returnToViewport) {
      this.scrollX = globalThis.scrollX;
      this.scrollY = globalThis.scrollY;
    }

    super.init(Object.assign(options, {
      name: "find",
      indicator: false,
      exitOnClick: true,
      exitOnEscape: true,
      // This prevents further Brovim commands launching before the find-mode HUD receives the
      // focus. E.g. "/" followed quickly by "i" should not leave us in insert mode.
      suppressAllKeyboardEvents: true,
    }));

    HUD.showFindMode(this);
  }

  exit(event) {
    HUD.unfocusIfFocused();
    super.exit();
    if (event) {
      FindMode.handleEscape();
    }
  }

  restoreSelection() {
    if (!this.initialRange) {
      return;
    }
    const range = this.initialRange;
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }

  findInPlace(query, options) {
    // If requested, restore the scroll position (so that failed searches leave the scroll position
    // unchanged).
    this.checkReturnToViewPort();
    // Restore the selection. That way, we're always searching forward from the same place, so we
    // find the right match as the user adds matching characters, or removes previously-matched
    // characters. See #1434.
    this.restoreSelection();
    FindMode.updateQuery(query);
    query = FindMode.getQueryFromRegexMatches() || FindMode.query.parsedQuery;
    FindMode.query.hasResults = FindMode.execute(query, options);
  }

  static updateQuery(query) {
    if (!this.query) {
      this.query = {};
    }
    this.query.rawQuery = query;
    this.query.parsedQuery = query;

    // Implement smartcase.
    this.query.ignoreCase = !Utils.hasUpperCase(this.query.parsedQuery);

    const pattern = new RegExp(
      Utils.escapeRegexSpecialCharacters(query),
      `g${this.query.ignoreCase ? "i" : ""}`,
    );
    this.query.matches = query ? collectFindMatches(pattern) : [];
    this.updateActiveMatchIndex();
    return this.query.matchCount = this.query.matches.length;
  }

  // Start at the current selection, including selections inside an open shadow root.
  static updateActiveMatchIndex() {
    const selection = globalThis.getSelection();
    const index = selection.anchorNode?.isConnected
      ? this.query.matches.findIndex(({ range }) => isMatchAtOrAfterSelection(range, selection))
      : 0;
    this.query.activeMatchIndex = Math.max(index, 0);
  }

  static getQueryFromRegexMatches() {
    return this.query.matches?.[this.query.activeMatchIndex]?.text || "";
  }

  static getNextQueryFromRegexMatches(backwards) {
    // find()ing an empty query always returns false
    if (!this.query.matches?.length) {
      return "";
    }
    const count = this.query.matches.length;
    this.query.activeMatchIndex = (this.query.activeMatchIndex + (backwards ? -1 : 1) + count) %
      count;
    return this.getQueryFromRegexMatches();
  }

  // Refresh on every repeat: live pages can replace, hide or append matching content without
  // changing the saved query. Start from the selection, including on a newly navigated page.
  static getQuery(backwards) {
    const mostRecentQuery = FindModeHistory.getQuery();
    this.updateQuery(mostRecentQuery);
    const selection = globalThis.getSelection();
    const selected = selection.rangeCount ? selection.getRangeAt(0) : null;
    // A selected match is where the last n or N landed: step on from it. Matches run in the order
    // the page shows them, which comparing DOM positions can't follow: text a web component shows
    // through a <slot> sits among its shadow content, and n would bounce between two matches.
    const current = selected
      ? this.query.matches.findIndex(({ range }) =>
        selected.startContainer === range.startContainer &&
        selected.startOffset === range.startOffset &&
        selected.endContainer === range.endContainer && selected.endOffset === range.endOffset
      )
      : -1;
    if (current >= 0) this.query.activeMatchIndex = current;
    // Forward search includes the first match at/after the cursor unless it is already selected.
    // Backward search takes the preceding match, wrapping to the last when no selection exists.
    return backwards || current >= 0
      ? this.getNextQueryFromRegexMatches(backwards)
      : this.getQueryFromRegexMatches();
  }

  static saveQuery() {
    FindModeHistory.saveQuery(this.query.rawQuery);
  }

  // :options is an optional dict. valid parameters are 'caseSensitive' and 'backwards'.
  static execute(query, options) {
    let result = null;
    options = Object.assign({
      backwards: false,
      caseSensitive: !this.query?.ignoreCase,
    }, options);
    if (query == null) {
      query = FindMode.getQuery(options.backwards);
    }

    const match = this.query?.matches?.[this.query.activeMatchIndex];
    if (query && match?.range.startContainer.isConnected) {
      result = highlight(match.range);
    }

    // window.find focuses the |window| that it is called on. This gives us an opportunity to
    // (re-)focus another element/window, if that isn't the behaviour we want.
    if (options.postFindFocus != null) {
      options.postFindFocus.focus();
    }

    // We are either in normal mode ("n"), or find mode ("/"). We are not in insert mode.
    // Nevertheless, if a previous find landed in an editable element, then that element may still
    // be activated. In this case, we don't want to leave it behind (see #1412).
    if (document.activeElement && DomUtils.isEditable(document.activeElement)) {
      if (!DomUtils.isSelected(document.activeElement)) {
        document.activeElement.blur();
      }
    }

    return result;
  }

  // The user has found what they're looking for and is finished searching. We enter insert mode, if
  // possible.
  static handleEscape() {
    return focusFoundLink() || selectFoundInputElement();
  }

  // Save the query so the user can do further searches with it.
  static handleEnter() {
    focusFoundLink();
    return FindMode.saveQuery();
  }

  static findNext(backwards) {
    // Bail out if we don't have any query text.
    const nextQuery = FindMode.getQuery(backwards);
    if (!FindMode.query.rawQuery) {
      HUD.show("No query to find.", 1000);
      return;
    }

    FindMode.query.hasResults = FindMode.execute(nextQuery, { backwards });

    if (FindMode.query.hasResults) {
      focusFoundLink();
      return newPostFindMode();
    } else {
      return HUD.show(`No matches for '${FindMode.query.rawQuery}'`, 1000);
    }
  }

  checkReturnToViewPort() {
    if (this.options.returnToViewport) {
      globalThis.scrollTo(this.scrollX, this.scrollY);
    }
  }
}

const getCurrentRange = function () {
  const selection = getSelection();
  if (selection.type === "None") {
    const range = document.createRange();
    range.setStart(document.body, 0);
    range.setEnd(document.body, 0);
    return range;
  }

  if (selection.type === "Range") {
    selection.collapseToStart();
  }

  return selection.getRangeAt(0);
};

const getLinkFromSelection = function () {
  let node = globalThis.getSelection().anchorNode;
  while (node && (node !== document.body)) {
    if (node.nodeName.toLowerCase() === "a") {
      return node;
    }
    node = node.parentNode;
  }
  return null;
};

const focusFoundLink = function () {
  if (FindMode.query.hasResults) {
    const link = getLinkFromSelection();
    if (link) {
      link.focus();
    }
  }
};

const selectFoundInputElement = function () {
  // Since the last focused element might not be the one currently pointed to by find (e.g. the
  // current one might be disabled and therefore unable to receive focus), we use the approximate
  // heuristic of checking that the last anchor node is an ancestor of our element.
  const findModeAnchorNode = document.getSelection().anchorNode;
  if (
    FindMode.query.hasResults && document.activeElement &&
    DomUtils.isSelectable(document.activeElement) &&
    DomUtils.isDOMDescendant(findModeAnchorNode, document.activeElement)
  ) {
    return DomUtils.simulateSelect(document.activeElement);
  }
};

const highlight = (matchRange) => {
  const selection = globalThis.getSelection();
  const range = matchRange.cloneRange();
  selection.removeAllRanges();
  selection.addRange(range);

  scrollRangeIntoView(range);
  return true;
};

const scrollRangeIntoView = (range) => {
  // Reveal the actual text range, rather than its potentially much larger parent element.
  // Walk from the innermost scrollport out through slots/shadow hosts, then the viewport.
  const delta = (start, end, min, max) =>
    start < min || end > max ? (start + end - min - max) / 2 : 0;
  let element = range.startContainer.nodeType === Node.ELEMENT_NODE
    ? range.startContainer
    : range.startContainer.assignedSlot || range.startContainer.parentElement ||
      range.startContainer.getRootNode().host;
  while (element && element !== document.scrollingElement) {
    const rect = range.getBoundingClientRect();
    const bounds = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const left = bounds.left + element.clientLeft;
    const top = bounds.top + element.clientTop;
    element.scrollBy({
      left: /^(auto|scroll|hidden)$/.test(style.overflowX)
        ? delta(rect.left, rect.right, left, left + element.clientWidth)
        : 0,
      top: /^(auto|scroll|hidden)$/.test(style.overflowY)
        ? delta(rect.top, rect.bottom, top, top + element.clientHeight)
        : 0,
      behavior: "instant",
    });
    element = element.assignedSlot || element.parentElement || element.getRootNode().host;
  }
  const rect = range.getBoundingClientRect();
  globalThis.scrollBy({
    left: delta(rect.left, rect.right, 0, globalThis.innerWidth),
    top: delta(rect.top, rect.bottom, 0, globalThis.innerHeight),
    behavior: "instant",
  });
};

// Compare in a common tree when either the match or the selection is inside a shadow root.
const isMatchAtOrAfterSelection = (range, selection) => {
  let node = range.startContainer;
  let anchor = selection.anchorNode;
  while (node.getRootNode() !== anchor.getRootNode()) {
    if (node.getRootNode().host) node = node.getRootNode().host;
    else if (anchor.getRootNode().host) anchor = anchor.getRootNode().host;
    else return false;
  }
  if (node === range.startContainer && anchor === selection.anchorNode) {
    return range.comparePoint(anchor, selection.anchorOffset) <= 0;
  }
  const position = document.createRange();
  position.selectNode(node);
  return position.comparePoint(
    anchor,
    anchor === selection.anchorNode ? selection.anchorOffset : 0,
  ) <=
    0;
};

// Join adjacent inline text for searching, then map each match back to its DOM endpoints. Block
// boundaries and different DOM roots end a run, so highlighting never crosses unrelated content.
const collectFindMatches = (pattern) => {
  const matches = [];
  let parts = [], text = [], length = 0;
  const flush = () => {
    const value = text.join("");
    // Collapsible whitespace at a block's edges is not rendered.
    const leading = parts[0]?.collapsed ? 1 : 0;
    const trailing = parts.at(-1)?.collapsed ? 1 : 0;
    const rendered = value.slice(leading, value.length - trailing);
    pattern.lastIndex = 0;
    let match, startPart = 0, endPart = 0;
    while ((match = pattern.exec(rendered)) !== null) {
      match.index += leading;
      const end = match.index + match[0].length;
      while (parts[startPart].end <= match.index) startPart++;
      endPart = Math.max(startPart, endPart);
      while (parts[endPart].end < end) endPart++;
      const range = document.createRange();
      const first = parts[startPart], last = parts[endPart];
      range.setStart(first.node, first.offset + (first.collapsed ? 0 : match.index - first.start));
      range.setEnd(
        last.endNode,
        last.collapsed ? last.endOffset : last.offset + end - last.start,
      );
      matches.push({ text: match[0], range });
    }
    parts = [];
    text = [];
    length = 0;
  };
  const visit = (node, visible = true, whiteSpace = "normal") => {
    if (node.nodeType === Node.TEXT_NODE) {
      if (!visible || !node.data.length) return;
      if (parts.length && parts[0].node.getRootNode() !== node.getRootNode()) flush();
      // Retain source offsets while collapsing only whitespace CSS actually collapses. A run
      // may span inline elements, so consecutive collapsed parts share one rendered space.
      const collapse = /^(normal|nowrap|pre-line)$/.test(whiteSpace);
      const tokens = !collapse ? [{ 0: node.data, index: 0 }] : node.data.matchAll(
        whiteSpace === "pre-line" ? /[ \t\r\f]+|[^ \t\r\f]+/g : /[ \t\r\n\f]+|[^ \t\r\n\f]+/g,
      );
      for (const token of tokens) {
        const collapsed = collapse && /^[ \t\r\n\f]+$/.test(token[0]) &&
          !(whiteSpace === "pre-line" && token[0].includes("\n"));
        const previous = parts.at(-1);
        const endOffset = token.index + token[0].length;
        if (collapsed && previous?.collapsed) {
          previous.endNode = node;
          previous.endOffset = endOffset;
          continue;
        }
        const value = collapsed ? " " : token[0];
        parts.push({
          node,
          offset: token.index,
          endNode: node,
          endOffset,
          start: length,
          end: length + value.length,
          collapsed,
        });
        text.push(value);
        length += value.length;
      }
      return;
    }
    if (
      node.nodeType !== Node.ELEMENT_NODE || /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(node.tagName)
    ) {
      return;
    }
    // This runs for every element on each keystroke, so read each computed style property once.
    // ponytail: re-walks the page per keystroke (~40 ms at 18k elements); cache the text runs per
    // find session, invalidated by a MutationObserver, if large pages lag while typing.
    const style = getComputedStyle(node);
    const display = style.display;
    if (display === "none" || style.contentVisibility === "hidden") return;
    const boundary = node.tagName === "BR" ||
      (display !== "contents" && !display.startsWith("inline") && !display.startsWith("ruby"));
    if (boundary) flush();
    const children = node.shadowRoot?.childNodes ??
      (node.tagName === "SLOT" && node.assignedNodes().length
        ? node.assignedNodes({ flatten: true })
        : node.childNodes);
    const childrenVisible = style.visibility !== "hidden" && style.visibility !== "collapse";
    for (const child of children) visit(child, childrenVisible, style.whiteSpace);
    if (boundary) flush();
  };
  if (document.body) visit(document.body);
  flush();
  return matches;
};

globalThis.PostFindMode = PostFindMode;
globalThis.FindMode = FindMode;
