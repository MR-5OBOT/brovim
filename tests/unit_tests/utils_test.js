import "./test_helper.js";
import "../../lib/settings.js";
import "../../lib/url_utils.js";

context("browser shortcuts", () => {
  for (
    const [input, expected] of [
      ["Ctrl+Q", { key: "q", modifiers: ["ctrlKey"] }],
      ["Ctrl+Shift+E", { key: "e", modifiers: ["ctrlKey"], requiresShift: true }],
      ["Command+P", { key: "p", modifiers: ["metaKey"] }],
      ["⌘⇧P", { key: "p", modifiers: ["metaKey"], requiresShift: true }],
      ["Alt+Q", { key: "q", modifiers: ["altKey"] }],
    ]
  ) {
    should(`recognize ${input} and exclude Shift from release-to-switch`, () => {
      assert.equal(expected, Utils.parseBrowserShortcut(input));
    });
  }
  should("match a shortcut's physical letter when Alt changes its character", () => {
    assert.isTrue(
      Utils.isBrowserShortcutKey({ key: "œ", code: "KeyQ" }, Utils.parseBrowserShortcut("Alt+Q")),
    );
  });
  should("stop registration quietly if the extension reload invalidated the context", () => {
    stub(chrome.runtime, "onMessage", {
      addListener() {
        throw new Error("Extension context invalidated.");
      },
    });
    assert.isFalse(Utils.addChromeRuntimeOnMessageListener([], () => {}));
  });
  should("also handle the invalidated onMessage property getter from Chromium", () => {
    const runtime = {
      get onMessage() {
        throw new Error(
          "Failed to read the 'onMessage' property from 'Object': Extension context invalidated.",
        );
      },
    };
    stub(chrome, "runtime", runtime);
    assert.isFalse(Utils.addChromeRuntimeOnMessageListener([], () => {}));
  });
  should("keep unrelated registration errors visible", () => {
    stub(chrome.runtime, "onMessage", {
      addListener() {
        throw new Error("Unexpected registration failure");
      },
    });
    assert.throwsError(() => Utils.addChromeRuntimeOnMessageListener([], () => {}));
  });
});

context("forTrusted", () => {
  should("invoke an event handler if the event is trusted", () => {
    let called = false;
    const f = forTrusted(() => called = true);
    const event = { isTrusted: true };
    f(event);
    assert.equal(true, called);
  });

  should("not invoke an event handler if the event is untrusted", () => {
    let called = false;
    const f = forTrusted(() => called = true);
    const event = { isTrusted: false };
    f(event);
    assert.equal(false, called);
    f(null);
    assert.equal(false, called);
  });
});

context("SimpleCache", () => {
  let cache, tasks;
  setup(() => {
    tasks = [];
    stub(Utils, "nextTick", (fn) => tasks.push(fn));
    cache = new SimpleCache(1000, 2);
  });

  should("treat prototype names as ordinary keys", () => {
    for (const key of ["constructor", "__proto__", "toString"]) {
      assert.isFalse(cache.has(key));
      cache.set(key, key);
      assert.equal(key, cache.get(key));
    }
  });

  should("coalesce maintenance during a burst of cache reads", () => {
    cache.set("query", "result");
    for (let i = 0; i < 2000; i++) assert.equal("result", cache.get("query"));
    assert.equal(1, tasks.length);
    tasks.shift()();
    cache.get("query");
    assert.equal(1, tasks.length);
  });

  should("retain recent entries across rotations and clear them immediately", () => {
    cache.set("old", 1);
    cache.set("recent", 2);
    cache.rotate(true);
    assert.equal(2, cache.get("recent"));
    cache.rotate(true);
    assert.isFalse(cache.has("old"));
    assert.equal(2, cache.get("recent"));
    cache.clear();
    assert.isFalse(cache.has("recent"));
  });
});

context("decodeURIByParts", () => {
  should("decode javascript: URLs", () => {
    assert.equal("foobar", Utils.decodeURIByParts("foobar"));
    assert.equal(" ", Utils.decodeURIByParts("%20"));
    assert.equal("25 % 20 25 ", Utils.decodeURIByParts("25 % 20 25%20"));
  });
});

context("compare versions", () => {
  should("compare correctly", () => {
    assert.equal(0, Utils.compareVersions("1.40.1", "1.40.1"));
    assert.equal(0, Utils.compareVersions("1.40", "1.40.0"));
    assert.equal(0, Utils.compareVersions("1.40.0", "1.40"));
    assert.equal(-1, Utils.compareVersions("1.40.1", "1.40.2"));
    assert.equal(-1, Utils.compareVersions("1.40.1", "1.41"));
    assert.equal(-1, Utils.compareVersions("1.40", "1.40.1"));
    assert.equal(1, Utils.compareVersions("1.41", "1.40"));
    assert.equal(1, Utils.compareVersions("1.41.0", "1.40"));
    assert.equal(1, Utils.compareVersions("1.41.1", "1.41"));
  });
});

context("makeIdempotent", () => {
  let func;
  let count = 0;

  setup(() => {
    count = 0;
    func = Utils.makeIdempotent((n) => {
      if (n == null) {
        n = 1;
      }
      count += n;
    });
  });

  should("call a function once", () => {
    func();
    assert.equal(1, count);
  });

  should("call a function once with an argument", () => {
    func(2);
    assert.equal(2, count);
  });

  should("not call a function a second time", () => {
    func();
    assert.equal(1, count);
  });

  should("not call a function a second time", () => {
    func();
    assert.equal(1, count);
    func();
    assert.equal(1, count);
  });
});

context("distinctCharacters", () => {
  should(
    "eliminate duplicate characters",
    () => assert.equal("abc", Utils.distinctCharacters("bbabaabbacabbbab")),
  );
});

context("escapeRegexSpecialCharacters", () => {
  should("escape regexp special characters", () => {
    const str = "-[]/{}()*+?.^$|";
    const regexp = new RegExp(Utils.escapeRegexSpecialCharacters(str));
    assert.isTrue(regexp.test(str));
  });
});

context("keyBy", () => {
  const array = [
    { key: "a" },
    { key: "b" },
  ];

  should("group by string key", () => {
    assert.equal(
      { a: array[0], b: array[1] },
      Utils.keyBy(array, "key"),
    );
  });

  should("group by key function", () => {
    assert.equal(
      { a: array[0], b: array[1] },
      Utils.keyBy(array, (el) => el.key),
    );
  });
});

context("assertType", () => {
  should("fail if schema or object is null", () => {
    assert.throwsError(() => Utils.assertType(null, { a: 1 }));
    assert.throwsError(() => Utils.assertType({ a: null }, null));
  });

  should("not allow unknown fields", () => {
    const schema = { a: null };
    Utils.assertType(schema, { a: 1 });
    assert.throwsError(() => Utils.assertType(schema, { b: 1 }));
  });

  should("type check fields with types", () => {
    const schema = {
      bool: "boolean",
      num: "number",
      string: "string",
    };
    Utils.assertType(schema, {
      bool: true,
      num: 1,
      string: "example",
    });
    assert.throwsError(() => Utils.assertType(schema, { bool: 1 }));
    assert.throwsError(() => Utils.assertType(schema, { num: "example" }));
    assert.throwsError(() => Utils.assertType(schema, { string: 1 }));
  });

  should("allow null values for typed fields", () => {
    Utils.assertType({ bool: "boolean" }, { bool: null });
  });
});
