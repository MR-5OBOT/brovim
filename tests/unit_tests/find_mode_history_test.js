import "./test_helper.js";
import "../../lib/find_mode_history.js";

context("private find history", () => {
  let data;
  setup(() => {
    data = {};
    stub(chrome.extension, "inIncognitoContext", true);
    stub(FindModeHistory, "isIncognitoMode", null);
    stub(FindModeHistory, "rawQueryList", null);
    stub(FindModeHistory, "loading", null);
    stub(FindModeHistory, "listening", false);
    stub(FindModeHistory, "key", "findModeRawQueryList");
    stub(FindModeHistory, "storage", {
      get: () => Promise.resolve(globalThis.structuredClone(data)),
      set: (values) => {
        Object.assign(data, values);
        return Promise.resolve();
      },
      onChanged: { addListener() {} },
    });
  });

  should("reuse private queries when another tab or HUD initializes", async () => {
    data = {
      findModeRawQueryList: ["normal search"],
      findModeRawQueryListIncognito: ["private search"],
    };
    await FindModeHistory.init();
    assert.equal("private search", FindModeHistory.getQuery());
    await FindModeHistory.saveQuery("new private search");
    FindModeHistory.rawQueryList = null;
    await FindModeHistory.init();
    assert.equal(["new private search", "private search"], FindModeHistory.rawQueryList);
    assert.equal(["normal search"], data.findModeRawQueryList);
  });

  should("allow a repeat key before history finishes loading", () => {
    assert.equal("", FindModeHistory.getQuery());
  });

  should("keep an early submitted query when the initial history read is delayed", async () => {
    let finishRead;
    stub(FindModeHistory.storage, "get", () => new Promise((resolve) => finishRead = resolve));
    const loading = FindModeHistory.init();
    const saving = FindModeHistory.saveQuery("early search").then(() => true, () => false);
    finishRead({ findModeRawQueryListIncognito: ["stored search"] });
    await loading;
    assert.isTrue(await saving);
    assert.equal(["early search", "stored search"], data.findModeRawQueryListIncognito);
  });

  should("keep an explicitly empty private history empty", async () => {
    data = { findModeRawQueryList: ["normal search"], findModeRawQueryListIncognito: [] };
    await FindModeHistory.init();
    assert.equal([], FindModeHistory.rawQueryList);
    assert.equal([], data.findModeRawQueryListIncognito);
  });

  should("seed private history only when it does not exist", async () => {
    data = { findModeRawQueryList: ["normal search"] };
    await FindModeHistory.init();
    assert.equal(["normal search"], data.findModeRawQueryListIncognito);
    assert.equal("normal search", FindModeHistory.getQuery());
  });
});
