// Symbolic names for some common strings.
const forward = "forward";
const backward = "backward";
const character = "character";
const word = "word";
const line = "line";
const sentence = "sentence";
const vimword = "vimword";
const lineboundary = "lineboundary";

// This implements various selection movements.
class Movement {
  constructor(alterMethod) {
    this.alterMethod = alterMethod;
    this.opposite = { forward: backward, backward: forward };
    this.selection = globalThis.getSelection();
    this.shadowRoots = [];
    const collect = (root) => {
      for (const element of root.querySelectorAll("*")) {
        if (element.shadowRoot) {
          this.shadowRoots.push(element.shadowRoot);
          collect(element.shadowRoot);
        }
      }
    };
    if (this.selection.getComposedRanges) collect(document);
  }

  // Chromium retargets the public selection endpoints to a shadow host. Read the composed
  // endpoints before restoring, collapsing or reversing a selection inside an open shadow root.
  endpoints() {
    const { anchorNode, anchorOffset, focusNode, focusOffset } = this.selection;
    const range = this.shadowRoots.length &&
      this.selection.getComposedRanges?.({ shadowRoots: this.shadowRoots })[0];
    if (!range) return { anchorNode, anchorOffset, focusNode, focusOffset };
    const reversed = this.selection.direction === "backward";
    return {
      anchorNode: reversed ? range.endContainer : range.startContainer,
      anchorOffset: reversed ? range.endOffset : range.startOffset,
      focusNode: reversed ? range.startContainer : range.endContainer,
      focusOffset: reversed ? range.startOffset : range.endOffset,
    };
  }

  // Return the character following (to the right of) the focus, and leave the selection unchanged,
  // or return undefined.
  getNextForwardCharacter() {
    const { anchorNode, anchorOffset, focusNode, focusOffset } = this.endpoints();
    if (!focusNode) return;
    const beforeText = this.selection.toString();
    if (beforeText && this.getDirection() === backward) return Array.from(beforeText)[0];
    this.selection.modify("extend", forward, character);
    const afterText = this.selection.toString();
    this.selection.setBaseAndExtent(anchorNode, anchorOffset, focusNode, focusOffset);
    return afterText.length > beforeText.length ? afterText.slice(beforeText.length) : undefined;
  }

  // Test whether the character following the focus is a word character (and leave the selection unchanged).
  nextCharacterIsWordCharacter() {
    const next = this.getNextForwardCharacter();
    return next != null && /[\p{L}\p{M}\p{N}_]/u.test(next);
  }

  // Run a movement. This is the core movement method, all movements happen here. For convenience,
  // the following three argument forms are supported:
  //   runMovement("forward word")
  //   runMovement(["forward", "word"])
  //   runMovement("forward", "word")
  //
  // The granularities are word, "character", "line", "lineboundary", "sentence" and "paragraph". In
  // addition, we implement the pseudo granularity "vimword", which implements vim-like word
  // movement (e.g. "w").
  //
  runMovement(...args) {
    // Normalize the various argument forms.
    const [direction, granularity] = (typeof (args[0]) === "string") && (args.length === 1)
      ? args[0].trim().split(/\s+/)
      : (args.length === 1 ? args[0] : args.slice(0, 2));

    // A browser may cycle its selection endpoints at a shadow boundary. Stop on a repeated
    // position rather than trapping the page in a character-by-character word movement.
    const visited = new Map();
    const advance = () => {
      const { focusNode, focusOffset } = this.endpoints();
      if (!visited.has(focusNode)) visited.set(focusNode, new Set());
      if (visited.get(focusNode).has(focusOffset)) return false;
      visited.get(focusNode).add(focusOffset);
      return this.extendByOneCharacter(forward) !== 0;
    };

    // Native word movements behave differently on Linux and Windows, see #1441. So we implement
    // some of them character-by-character.
    if ((granularity === vimword) && (direction === forward)) {
      // Extend selection to the end of the 'vimword'.
      while (this.nextCharacterIsWordCharacter()) {
        if (!advance()) {
          return;
        }
      }
      // Extend selection after the 'vimword' to position before next word.
      while (this.getNextForwardCharacter() && !this.nextCharacterIsWordCharacter()) {
        if (!advance()) {
          return;
        }
      }
      // In Caret Mode collapse selection to the end.
      if (this.alterMethod === "move") {
        this.selection.collapseToEnd();
      }
      return;
    }

    // As above, we implement this character-by-character to get consistent behavior on Windows and
    // Linux.
    if ((granularity === word) && (direction === forward)) {
      // Extend selection to the start of the next 'word' (non-word characters, e.g. whitespace).
      while (this.getNextForwardCharacter() && !this.nextCharacterIsWordCharacter()) {
        if (!advance()) {
          return;
        }
      }
      // Extend selection to the end of the 'word'.
      while (this.nextCharacterIsWordCharacter()) {
        if (!advance()) {
          return;
        }
      }
      // In Caret Mode collapse selection to the end.
      if (this.alterMethod === "move") {
        this.selection.collapseToEnd();
      }
      return;
    } else {
      this.selection.modify(this.alterMethod, direction, granularity);
      return;
    }
  }

  // Swap the anchor and focus for internal line-selection movements.
  reverseSelection() {
    const { anchorNode, anchorOffset, focusNode, focusOffset } = this.endpoints();
    if (anchorNode && focusNode) {
      this.selection.setBaseAndExtent(focusNode, focusOffset, anchorNode, anchorOffset);
    }
  }

  // Try to extend the selection by one character in direction. Return positive, negative or 0,
  // indicating whether the selection got bigger, or smaller, or is unchanged.
  extendByOneCharacter(direction) {
    const length = this.selection.toString().length;
    this.selection.modify("extend", direction, character);
    return this.selection.toString().length - length;
  }

  // Get the direction of the selection. The selection is "forward" if the focus is at or after the
  // anchor, and "backward" otherwise.
  getDirection() {
    const { anchorNode, anchorOffset, focusNode, focusOffset } = this.endpoints();
    if (!anchorNode || !focusNode) return forward;
    if (anchorNode === focusNode) return anchorOffset <= focusOffset ? forward : backward;
    const range = document.createRange();
    range.setStart(anchorNode, anchorOffset);
    range.setEnd(focusNode, focusOffset);
    return range.collapsed ? backward : forward;
  }

  collapseSelectionToAnchor() {
    const { anchorNode, anchorOffset } = this.endpoints();
    if (anchorNode) this.selection.collapse(anchorNode, anchorOffset);
  }

  collapseSelectionToFocus() {
    const { focusNode, focusOffset } = this.endpoints();
    if (focusNode) this.selection.collapse(focusNode, focusOffset);
  }

  setSelectionRange(range) {
    this.selection.removeAllRanges();
    // TODO(philc): Is this return needed?
    return this.selection.addRange(range);
  }

  // For "aw", "as". We don't do "ap" (for paragraphs), because Chrome paragraph movements are
  // weird.
  selectLexicalEntity(entity, count) {
    if (count == null) {
      count = 1;
    }
    this.collapseSelectionToFocus();
    // This makes word movements a bit more vim-like.
    if (entity === word) {
      this.runMovement([forward, character]);
    }
    this.runMovement([backward, entity]);
    this.collapseSelectionToFocus();
    for (let i = 0, end = count; i < end; i++) {
      this.runMovement([forward, entity]);
    }
  }

  selectLine(count) {
    // Even under caret mode, we still need an extended selection here.
    this.alterMethod = "extend";
    if (this.getDirection() === forward) this.reverseSelection();
    this.runMovement(backward, lineboundary);
    this.reverseSelection();
    for (let i = 1, end = count; i < end; i++) this.runMovement(forward, line);
    this.runMovement(forward, lineboundary);
    // Include the next character if that character is a newline.
    if (this.getNextForwardCharacter() === "\n") return this.runMovement(forward, character);
  }

  // Scroll the focus into view.
  scrollIntoView() {
    const { focusNode, focusOffset } = this.endpoints();
    if (!focusNode?.isConnected) return;
    const range = document.createRange();
    range.setStart(focusNode, focusOffset);
    range.collapse(true);
    if (range.getBoundingClientRect().height) FindMode.scrollRangeIntoView(range);
  }
}

class VisualMode extends KeyHandlerMode {
  init(options) {
    let movement;
    if (options == null) {
      options = {};
    }
    this.movement = new Movement(options.alterMethod != null ? options.alterMethod : "extend");
    this.selection = this.movement.selection;

    // Build the key mapping structure required by KeyHandlerMode. This only handles one- and
    // two-key mappings.
    const keyMapping = {};
    for (const keys of Object.keys(this.movements || {})) {
      movement = this.movements[keys];
      if ("function" === typeof movement) {
        movement = movement.bind(this);
      }
      if (keys.length === 1) {
        keyMapping[keys] = { command: movement };
      } else { // keys.length == 2
        if (keyMapping[keys[0]] == null) {
          keyMapping[keys[0]] = {};
        }
        Object.assign(keyMapping[keys[0]], { [keys[1]]: { command: movement } });
      }
    }

    // Aliases and complex bindings.
    Object.assign(keyMapping, {
      "<left>": keyMapping.h,
      "<down>": keyMapping.j,
      "<up>": keyMapping.k,
      "<right>": keyMapping.l,
      "<home>": keyMapping["0"],
      "<end>": keyMapping["$"],
      "<enter>": { command: () => this.yank() },
      "B": keyMapping.b,
      "W": keyMapping.w,
      "<c-e>": {
        command(count) {
          return Scroller.scrollBy("y", count * Settings.get("scrollStepSize"), 1, false);
        },
      },
      "<c-y>": {
        command(count) {
          return Scroller.scrollBy("y", -count * Settings.get("scrollStepSize"), 1, false);
        },
      },
    });

    super.init(Object.assign(options, {
      name: options.name != null ? options.name : "visual",
      indicator: options.indicator != null ? options.indicator : "Visual mode",
      // Visual mode, visual-line mode and caret mode each displace each other.
      singleton: "visual-mode-group",
      exitOnEscape: true,
      suppressAllKeyboardEvents: true,
      keyMapping,
      commandHandler: this.commandHandler.bind(this),
    }));

    // If there was a range selection when the user launched visual mode, then we retain the
    // selection on exit.
    this.shouldRetainSelectionOnExit = this.options.userLaunchedMode &&
      (this.selection.type === "Range");

    this.onExit((event = null) => {
      // Escape cancels the selection, including a range created before visual mode started.
      // This also removes the highlighted character used to display the caret.
      if (event?.type === "keydown" && KeyboardUtils.isEscape(event)) {
        this.selection.removeAllRanges();
      } else if (!this.shouldRetainSelectionOnExit) {
        this.movement.collapseSelectionToAnchor();
      }

      // Don't leave the user in insert mode just because they happen to have selected an input.
      if (document.activeElement && DomUtils.isEditable(document.activeElement)) {
        if ((event != null ? event.type : undefined) !== "click") {
          return document.activeElement.blur();
        }
      }
    });

    this.push({
      _name: `${this.id}/cancel/click`,
      keydown: (event) => {
        // Cancel immediately even when a movement prefix such as the first "g" is pending.
        if (!KeyboardUtils.isEscape(event)) return this.continueBubbling;
        this.exit(event);
        return this.suppressEvent;
      },
      // Click in a focusable element exits.
      click: (event) =>
        this.alwaysContinueBubbling(() => {
          if (DomUtils.isFocusable(event.target)) {
            return this.exit(event);
          }
        }),
    });

    // Establish or use the initial selection. If that's not possible, then enter caret mode.
    if (this.name !== "caret") {
      if (["Caret", "Range"].includes(this.selection.type)) {
        let selectionRect = this.selection.getRangeAt(0).getBoundingClientRect();
        if (globalThis.vimiumDomTestsAreRunning) {
          // We're running the DOM tests, where getBoundingClientRect() isn't available.
          if (!selectionRect) {
            selectionRect = { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 };
          }
        }
        selectionRect = Rect.intersect(
          selectionRect,
          Rect.create(0, 0, globalThis.innerWidth, globalThis.innerHeight),
        );
        if ((selectionRect.height >= 0) && (selectionRect.width >= 0)) {
          // The selection is visible in the current viewport.
          if (this.selection.type === "Caret") {
            // The caret is in the viewport. Make it visible.
            this.movement.extendByOneCharacter(forward) ||
              this.movement.extendByOneCharacter(backward);
          }
        } else {
          // The selection is outside of the viewport: clear it. We guess that the user has moved
          // on, and is more likely to be interested in visible content.
          this.selection.removeAllRanges();
        }
      }

      if ((this.selection.type !== "Range") && (this.name !== "caret")) {
        if (this.name === "visual/line" && this.establishInitialSelectionAnchor()) {
          this.movement.extendByOneCharacter(forward);
          return;
        }
        new CaretMode().init();
        return HUD.show("No usable selection, entering caret mode...", 2500);
      }
    }
  }

  establishInitialSelectionAnchor() {
    // Search open shadow roots as well as the document, without entering editors or Brovim UI.
    const visit = function* (root) {
      const walker = document.createTreeWalker(
        root,
        NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
      );
      let node;
      while ((node = walker.nextNode())) {
        if (node.nodeType === Node.TEXT_NODE) yield node;
        else if (node.shadowRoot && !node.classList.contains("vimium-reset")) {
          yield* visit(node.shadowRoot);
        }
      }
    };
    for (const node of visit(document.body)) {
      const element = node.parentElement;
      if (
        !element || !node.data.trim() || DomUtils.isEditable(element) ||
        element.closest("script, style, noscript, template, [inert], .vimium-reset")
      ) continue;
      if (!DomUtils.getVisibleClientRect(element)) continue;
      const offset = node.data.search(/\S/u);
      const range = document.createRange();
      range.setStart(node, offset);
      range.collapse(true);
      this.movement.setSelectionRange(range);
      return true;
    }
    return false;
  }

  commandHandler({ command: { command }, count }) {
    if (count == null) count = 1;
    switch (typeof command) {
      case "string":
        for (let i = 0, end = count; i < end; i++) {
          this.movement.runMovement(command);
        }
        break;
      case "function":
        command(count);
        break;
    }
    if (this.modeIsActive) return this.movement.scrollIntoView();
  }

  // Copy text and clear its highlight immediately, including a pre-existing search selection.
  yank() {
    this.yankedText = this.selection.toString();
    this.exit();
    this.selection.removeAllRanges();
    if (!this.yankedText) {
      HUD.show("No text selected.", 1500);
      return "";
    }
    HUD.copyToClipboard(this.yankedText);

    let message = this.yankedText.replace(/\s+/g, " ");
    if (15 < this.yankedText.length) {
      message = message.slice(0, 12) + "...";
    }
    const plural = this.yankedText.length === 1 ? "" : "s";
    HUD.show(`Yanked ${this.yankedText.length} character${plural}: \"${message}\".`, 2500);

    return this.yankedText;
  }
}

// A movement can be either a string or a function.
VisualMode.prototype.movements = {
  "l": "forward character",
  "h": "backward character",
  "j": "forward line",
  "k": "backward line",
  "e": "forward word",
  "b": "backward word",
  "w": "forward vimword",
  ")": "forward sentence",
  "(": "backward sentence",
  "}": "forward paragraph",
  "{": "backward paragraph",
  "0": "backward lineboundary",
  "$": "forward lineboundary",
  "G": "forward documentboundary",
  "gg": "backward documentboundary",

  "aw"(count) {
    return this.movement.selectLexicalEntity(word, count);
  },
  "as"(count) {
    return this.movement.selectLexicalEntity(sentence, count);
  },

  "/"() {
    this.exit();
    return new FindMode();
  },

  "y"() {
    return this.yank();
  },
  "Y"(count) {
    this.movement.selectLine(count);
    return this.yank();
  },
  "v"() {
    if (this.name === "caret") return new VisualMode().init();
    return this.movements.c.call(this);
  },
  "V"() {
    return new VisualLineMode().init();
  },
  "c"() {
    // If we're already in caret mode, or if the selection looks the same as it would in caret mode,
    // then collapse to anchor (so that the caret-mode selection will seem unchanged). Otherwise,
    // we're in visual mode and the user has moved the focus, so collapse to that.
    if ((this.name === "caret") || (this.selection.toString().length <= 1)) {
      this.movement.collapseSelectionToAnchor();
    } else {
      this.movement.collapseSelectionToFocus();
    }
    return new CaretMode().init();
  },
};

class VisualLineMode extends VisualMode {
  init(options) {
    if (options == null) {
      options = {};
    }
    super.init(Object.assign(options, { name: "visual/line", indicator: "Visual mode (line)" }));
    if (this.modeIsActive) return this.extendSelection();
  }

  commandHandler({ command: { command }, count }) {
    if (count == null) count = 1;
    switch (typeof command) {
      case "string":
        for (let i = 0, end = count; i < end; i++) {
          this.movement.runMovement(command);
          // If the current selection
          //  * has only 1 line (the line that is selected when we # enter the visual line mode), and
          //  * its direction is different from the command,
          // then the command will in effect unselect that line. In this case, we restore that line
          // and reverse its direction, keeping that line selected.
          if (this.selection.isCollapsed) {
            this.extendSelection();
            const [direction, granularity] = command.split(" ");
            if ((this.movement.getDirection() !== direction) && (granularity === "line")) {
              this.movement.reverseSelection();
            }
            this.movement.runMovement(command);
          }
        }
        break;
      case "function":
        command(count);
        break;
    }
    this.movement.scrollIntoView();
    if (this.modeIsActive) {
      return this.extendSelection();
    }
  }

  extendSelection() {
    const initialDirection = this.movement.getDirection();
    // TODO(philc): Reformat this to be a plain loop rather than a closure.
    return (() => {
      const result = [];
      for (const direction of [initialDirection, this.movement.opposite[initialDirection]]) {
        this.movement.runMovement(direction, lineboundary);
        result.push(this.movement.reverseSelection());
      }
      return result;
    })();
  }
}

class CaretMode extends VisualMode {
  init(options) {
    if (options == null) {
      options = {};
    }
    super.init(
      Object.assign(options, { name: "caret", indicator: "Caret mode", alterMethod: "move" }),
    );

    // Establish the initial caret.
    switch (this.selection.type) {
      case "None":
        this.establishInitialSelectionAnchor();
        if (this.selection.type === "None") {
          this.exit();
          HUD.show("Create a selection before entering visual mode.", 2500);
          return;
        }
        break;
      case "Range":
        this.movement.collapseSelectionToAnchor();
        break;
    }

    this.movement.extendByOneCharacter(forward);
    return this.movement.scrollIntoView();
  }

  commandHandler(...args) {
    this.movement.collapseSelectionToAnchor();
    super.commandHandler(...(args || []));
    if (this.modeIsActive) {
      return this.movement.extendByOneCharacter(forward);
    }
  }
}

globalThis.VisualMode = VisualMode;
globalThis.VisualLineMode = VisualLineMode;
