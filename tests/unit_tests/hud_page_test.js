import * as testHelper from "./test_helper.js";
import "../../tests/unit_tests/test_chrome_stubs.js";
import * as hudPage from "../../pages/hud_page.js";
import * as UIComponentMessenger from "../../pages/ui_component_messenger.js";

function newKeyEvent(properties) {
  return Object.assign(
    {
      type: "keydown",
      key: "a",
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      metaKey: false,
      stopImmediatePropagation: function () {},
      preventDefault: function () {},
    },
    properties,
  );
}

context("hud page", () => {
  setup(async () => {
    stub(Utils, "isFirefox", () => false);
    await testHelper.jsdomStub("pages/hud_page.html");
    // Make Utils.setTimeout synchronous so that the tests easier to deal with.
    stub(Utils, "setTimeout", (_timeout, fn) => {
      fn();
    });
  });

  teardown(() => {
    UIComponentMessenger.unregister();
  });

  should("sets a data-message-name attribute", () => {
    const el = document.querySelector("#hud");
    hudPage.handlers.show({
      text: "example",
      messageName: "example-name",
    });
    assert.equal("example-name", el.dataset.messageName);
  });

  context("on a page that keeps the clipboard to itself", () => {
    let messages, used;
    setup(async () => {
      messages = [];
      used = [];
      await UIComponentMessenger.registerPortWithOwnerPage({
        data: (await chrome.storage.session.get("vimiumSecret")).vimiumSecret,
        ports: [{ postMessage: (message) => messages.push(message) }],
      });
      messages.length = 0; // The frame's word that it's ready.
      stub(navigator, "clipboard", {
        writeText: () => used.push("writeText") && Promise.resolve(),
        readText: () => used.push("readText") && Promise.resolve(""),
      });
      // Permissions-Policy: clipboard-write=(self), clipboard-read=(self)
      stub(document, "featurePolicy", { allowsFeature: () => false });
    });

    // Calling the clipboard here would fail, and Chrome would log Brovim's error.
    should("leave copying to the page, without calling the clipboard from this frame", () => {
      hudPage.handlers.copyToClipboard({ data: "a\xa0b" });
      assert.equal([{ name: "copyInPage", data: "a b" }], messages);
      assert.equal([], used);
    });

    should("say the page blocks pasting, without calling the clipboard from this frame", () => {
      hudPage.handlers.pasteFromClipboard();
      assert.equal(
        [{ name: "showClipboardError", action: "paste", blockedByPage: true }],
        messages,
      );
      assert.equal([], used);
    });
  });

  should("find mode hides when escape is pressed", async () => {
    let message;
    const stubPort = {
      postMessage: (event) => {
        message = event;
      },
    };
    await UIComponentMessenger.registerPortWithOwnerPage({
      data: (await chrome.storage.session.get("vimiumSecret")).vimiumSecret,
      ports: [stubPort],
    });
    hudPage.handlers.showFindMode();
    await hudPage.onKeyEvent(newKeyEvent({ key: "Escape" }));
    assert.equal("hideFindMode", message.name);
  });
});
