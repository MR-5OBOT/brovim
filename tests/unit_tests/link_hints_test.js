import "./test_helper.js";
import "../../lib/keyboard_utils.js";
import "../../lib/settings.js";
import "../../content_scripts/mode.js";
import "../../content_scripts/link_hints.js";

context("hint hit testing", () => {
  should("request only the top element when the root supports it", () => {
    const top = {};
    const root = {
      elementFromPoint: () => top,
      elementsFromPoint: () => {
        throw new Error("An entire hit stack should not be requested");
      },
    };
    assert.isTrue(LocalHints.getElementFromPoint(10, 20, root) === top);
  });

  should("fall back to roots that only expose elementsFromPoint", () => {
    const top = {};
    assert.isTrue(
      LocalHints.getElementFromPoint(10, 20, {
        elementsFromPoint: () => [top, {}],
      }) === top,
    );
  });

  should("descend into shadow roots without looping through the host", () => {
    const host = {};
    host.shadowRoot = { elementFromPoint: () => host };
    assert.isTrue(
      LocalHints.getElementFromPoint(10, 20, {
        elementFromPoint: () => host,
      }) === host,
    );
  });
});

context("With invalid saved link characters", () => {
  setup(async () => {
    await Settings.onLoaded();
  });

  teardown(async () => {
    await Settings.clear();
  });

  should("recover unique alphabet labels from old or synced settings", async () => {
    for (const value of ["ab", "a", "aA", "AaBb"]) {
      await Settings.set("linkHintCharacters", value);
      const hints = new AlphabetHints().hintStrings(20);
      assert.equal(20, new Set(hints).size);
      assert.isFalse(hints.some((a) => hints.some((b) => a !== b && b.startsWith(a))));
    }
    await Settings.set("linkHintCharacters", "sSaAdDfF");
    assert.equal("sadf", new AlphabetHints().linkHintCharacters);
  });

  should("recover unique filtered labels from old or synced settings", async () => {
    for (const value of ["12", "1", "aA", "AaBb"]) {
      await Settings.set("linkHintNumbers", value);
      const matcher = new FilterHints();
      const hints = Array.from({ length: 20 }, (_, i) => matcher.generateHintString(i + 1));
      assert.equal(20, new Set(hints).size);
    }
  });
});
