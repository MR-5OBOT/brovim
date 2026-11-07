class InsertMode extends Mode {
  constructor(options) {
    super();
    if (options == null) {
      options = {};
    }

    // There is one permanently-installed instance of InsertMode. It tracks focus changes and
    // activates/deactivates itself (by setting @insertModeLock) accordingly.
    this.permanent = options.permanent;

    // If truthy, then we were activated by the user (with "i").
    this.global = options.global;

    const handleKeyEvent = (event) => {
      if (!this.isActive(event)) {
        return this.continueBubbling;
      }

      // An editable body (say, in an about:blank iframe the page made editable) stays the active
      // element even after blur(). Leave its keys, including Escape, to the page.
      const activeElement = this.getActiveElement();
      if ((activeElement === document.body) && activeElement.isContentEditable) {
        return this.passEventToPage;
      }

      if ((event.type === "keydown") && KeyboardUtils.isEscape(event)) {
        globalThis.Scroller?.reset();
        if (DomUtils.isFocusable(activeElement)) {
          DomUtils.focusPage();
        }

        if (!this.permanent) {
          this.exit();
        }
      } else {
        return this.passEventToPage;
      }

      return this.suppressEvent;
    };

    const defaults = {
      name: "insert",
      indicator: !this.permanent && !Settings.get("hideHud") ? "Insert mode" : null,
      keypress: handleKeyEvent,
      keydown: handleKeyEvent,
    };

    super.init(Object.assign(defaults, options));

    // Only for tests. This gives us a hook to test the status of the permanently-installed
    // instance.
    if (this.permanent) {
      InsertMode.permanentInstance = this;
    }
  }

  isActive(event) {
    if (event === InsertMode.suppressedEvent) {
      return false;
    }
    if (this.global) {
      return true;
    }
    return DomUtils.isFocusable(this.getActiveElement());
  }

  getActiveElement() {
    let activeElement = document.activeElement;
    while (activeElement && activeElement.shadowRoot && activeElement.shadowRoot.activeElement) {
      activeElement = activeElement.shadowRoot.activeElement;
    }
    return activeElement;
  }

  static suppressEvent(event) {
    return this.suppressedEvent = event;
  }
}

// This allows PostFindMode to suppress the permanently-installed InsertMode instance.
InsertMode.suppressedEvent = null;

globalThis.InsertMode = InsertMode;
