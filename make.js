#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env --allow-net --allow-run --allow-sys
// Usage: ./make.js command. Use -l to list commands.
// This is a set of tasks for building and testing Brovim in development.
import * as fs from "@std/fs";
import * as path from "@std/path";
import { abort, desc, run, task } from "drake";
import puppeteer from "puppeteer";
// We use a vendored version of shoulda, rather than jsr:@philc/shoulda, because shoulda.js is used
// in dom_tests.js which is loaded by Puppeteer, which doesn't have access to Deno's module system.
import * as shoulda from "./tests/vendor/shoulda.js";
import JSON5 from "json5";
import { DOMParser } from "@b-fuze/deno-dom";
import * as fileServer from "@std/http/file-server";

const projectPath = new URL(".", import.meta.url).pathname;

async function shell(procName, argsArray = []) {
  // NOTE(philc): Does drake's `sh` function work on Windows? If so, that can replace this function.
  if (Deno.build.os == "windows") {
    // if win32, prefix arguments with "/c {original command}"
    // e.g. "mkdir c:\git\vimium" becomes "cmd.exe /c mkdir c:\git\vimium"
    argsArray.unshift("/c", procName);
    procName = "cmd.exe";
  }
  const command = new Deno.Command(procName, {
    args: argsArray,
    stdout: "inherit",
    stderr: "inherit",
  });
  const status = await command.output();
  if (!status.success) {
    throw new Error(`${procName} ${argsArray} exited with status ${status.code}`);
  }
}

// Clones and augments the manifest.json that we use for Chrome with the keys needed for Firefox.
function createFirefoxManifest(manifest) {
  manifest = JSON.parse(JSON.stringify(manifest)); // Deep clone.
  manifest.host_permissions = manifest.host_permissions.filter((origin) =>
    !origin.startsWith("chrome:")
  );

  manifest.permissions = manifest.permissions
    // The favicon permission is not yet supported by Firefox.
    .filter((p) => p != "favicon")
    // Firefox needs clipboardRead and clipboardWrite for commands like "copyCurrentUrl", but Chrome
    // does not. See #4186.
    .concat(["clipboardRead", "clipboardWrite"]);

  // As of 2023-07-08 Firefox doesn't yet support background.service_worker.
  delete manifest.background["service_worker"];
  Object.assign(manifest.background, {
    "scripts": ["background_scripts/main.js"],
  });

  // This key is only supported by Firefox.
  Object.assign(manifest.action, {
    "default_area": "navbar",
  });

  Object.assign(manifest, {
    "browser_specific_settings": {
      "gecko": {
        // Firefox needs a stable ID in development mode, or many extension APIs don't work. This is
        // Brovim's own ID; the upstream one belongs to Vimium on addons.mozilla.org.
        "id": "brovim@mr-5obot.github.io",
        "strict_min_version": "112.0",
        "data_collection_permissions": {
          "required": ["none"],
        },
      },
    },
  });

  // Keep the same PNG artwork and toolbar states in both browsers.

  return manifest;
}

async function parseManifestFile() {
  // Chrome's manifest.json supports JavaScript comment syntax. However, the Chrome Store rejects
  // manifests with JavaScript comments in them! So here we use the JSON5 library, rather than JSON
  // library, to parse our manifest.json and remove its comments.
  return JSON5.parse(await Deno.readTextFile("./manifest.json"));
}

async function checkForCommonBuildIssues() {
  // Ensure the version number is properly formed.
  const chromeManifest = await parseManifestFile();
  const version = chromeManifest["version"];
  const versionRegexp = /^\d\.\d+\.\d+$/;
  if (!versionRegexp.test(version)) {
    throw new Error(`The version string "${version}" is malformed.`);
  }

  // Ensure debug logging is turned off.
  const text = await Deno.readTextFile("./lib/utils.js");
  if (!text.includes("debug: false")) {
    throw new Error(
      "It looks like debug logging is turned on in lib/utils.js. " +
        "It should be off in builds for the store.",
    );
  }
}

// Verify all files referenced in the manifest are present in dist.
async function checkFilesFromManifestArePresent(manifest) {
  const missing = [];

  for (const file of getPathsFromManifest(manifest)) {
    const exists = await fs.exists(path.join("dist/brovim", file));
    if (!exists) {
      missing.push(file);
    }
  }

  if (missing.length > 0) {
    const msg = "These files are referenced in manifest.json but missing from the build:\n" +
      missing.map((f) => `  ${f}`).join("\n");
    throw new Error(msg);
  }
}

// Returns all file paths referenced in a parsed manifest object, excluding glob patterns.
function getPathsFromManifest(manifest) {
  let files = [];

  files = files.concat(Object.values(manifest.icons));

  if (manifest.background.service_worker) {
    files.push(manifest.background.service_worker);
  }

  if (manifest.background.scripts) {
    files = files.concat(manifest.background.scripts);
  }

  files.push(manifest.options_ui.page);
  files.push(manifest.action.default_popup);

  // The shape of the default_icon structure is different in Chrome vs. Firefox.
  const icon = manifest.action.default_icon;
  if (typeof icon === "string") {
    files.push(icon);
  } else {
    files = files.concat(Object.values(icon));
  }

  for (const script of manifest.content_scripts) {
    if (script.js) {
      files = files.concat(script.js);
    }
    if (script.css) {
      files = files.concat(script.css);
    }
  }

  for (const obj of manifest.web_accessible_resources) {
    for (const resource of (obj.resources)) {
      // Skip files with glob patterns.
      if (resource.includes("*")) {
        continue;
      }
      files.push(resource);
    }
  }

  if (files.some((f) => f == null)) {
    throw new Error("manifest.json is missing a path that was expected by getPathsFromManifest");
  }
  // Remove duplicates.
  return Array.from(new Set(files)).sort();
}

// Builds a zip file for submission to the Chrome and Firefox stores. The output is in dist/.
async function buildStorePackage() {
  await checkForCommonBuildIssues();

  const excludeList = [
    "*.md",
    ".*",
    "build_scripts",
    "dist",
    "docs",
    "make.js",
    "deno.json",
    "deno.lock",
    "tests",
    "new-icon.png", // Full-resolution source; the browser uses the derived icon sizes.
  ];

  const chromeManifest = await parseManifestFile();
  // Store builds target browsers that do not support the local Chromium developer override.
  chromeManifest.host_permissions = chromeManifest.host_permissions.filter((origin) =>
    !origin.startsWith("chrome:")
  );
  const excludedNames = excludeList.map((pattern) => path.globToRegExp(pattern));
  const copyFiles = async (source, destination) => {
    await fs.ensureDir(destination);
    for await (const entry of Deno.readDir(source)) {
      if (excludedNames.some((pattern) => pattern.test(entry.name))) continue;
      const from = path.join(source, entry.name);
      const to = path.join(destination, entry.name);
      if (entry.isDirectory) await copyFiles(from, to);
      else await Deno.copyFile(from, to);
    }
  };
  const version = chromeManifest["version"];
  const writeDistManifest = async (manifest) => {
    await Deno.writeTextFile("dist/brovim/manifest.json", JSON.stringify(manifest, null, 2));
  };
  // cd into "dist/brovim" before building the zip, so that the files in the zip don't each have the
  // path prefix "dist/brovim".
  // --filesync ensures that files in the archive which are no longer on disk are deleted. It's
  // equivalent to removing the zip file before the build.
  const zipCommand = "cd dist/brovim && zip -r --filesync ";

  await shell("rm", ["-rf", "dist/brovim"]);
  await shell("mkdir", [
    "-p",
    "dist/brovim",
    "dist/chrome-canary",
    "dist/chrome-store",
    "dist/firefox",
  ]);
  await copyFiles(".", "dist/brovim");

  await checkFilesFromManifestArePresent(chromeManifest);

  // Build the Firefox / Mozilla Addons store package.
  const firefoxManifest = createFirefoxManifest(chromeManifest);
  await writeDistManifest(firefoxManifest);
  // Keep the shared PNG assets used by the settings logo, notifications and browser icons.
  await shell("bash", [
    "-c",
    `${zipCommand} ../firefox/brovim-firefox-${version}.zip .`,
  ]);

  await checkFilesFromManifestArePresent(firefoxManifest);

  // Build the Chrome Store package.
  await writeDistManifest(chromeManifest);
  await shell("bash", [
    "-c",
    `${zipCommand} ../chrome-store/brovim-chrome-store-${version}.zip .`,
  ]);

  // Build the Chrome Store dev package.
  await writeDistManifest(Object.assign({}, chromeManifest, {
    name: "Brovim Canary",
    description: "This is the development branch of Brovim (it is beta software).",
  }));
  await shell("bash", [
    "-c",
    `${zipCommand} ../chrome-canary/brovim-canary-${version}.zip .`,
  ]);
}

async function runUnitTests() {
  // Import every test file.
  const dir = path.join(projectPath, "tests/unit_tests");
  const files = [];
  for await (const entry of fs.walk(dir, { includeDirs: false, exts: [".js"] })) {
    if (entry.name.endsWith("_test.js")) files.push(entry.path);
  }
  for (const file of files.sort()) await import(path.toFileUrl(file).href);

  return await shoulda.run();
}

function setupPuppeteerPageForTests(page) {
  // The "console" event emitted has arguments which are promises. To obtain the values to be
  // printed, we must resolve those promises. However, if many console messages are emitted at once,
  // resolving the promises often causes the console.log messages to be printed out of order. Here,
  // we use a queue to strictly enforce that the messages appear in the order in which they were
  // logged.
  const messageQueue = [];
  let processing = false;
  const processMessageQueue = async () => {
    while (messageQueue.length > 0) {
      const values = await Promise.all(messageQueue.shift());
      console.log(...values);
    }
    processing = false;
  };
  page.on("console", (msg) => {
    const values = msg.args().map((a) => a.jsonValue());
    messageQueue.push(values);
    if (!processing) {
      processing = true;
      processMessageQueue();
    }
  });

  page.on("error", (err) => {
    // NOTE(philc): As far as I can tell, this handler never gets executed.
    console.error(err);
  });
  // pageerror catches the same events that window.onerror would, like JavaScript parsing errors.
  page.on("pageerror", (error) => {
    // This is an arbitrary field we're writing to the page object.
    page.receivedErrorOutput = true;
    // Whatever type error is, it requires toString() to print the message.
    console.log(error.toString());
  });
  page.on("requestfailed", (request) => {
    console.log(`${request.failure().errorText} ${request.url()}`);
  });
}

// Navigates the Puppeteer `page` to `url` and invokes shoulda.run().
async function runPuppeteerTest(page, url) {
  page.goto(url);
  await page.waitForNavigation({ waitUntil: "load" });
  const success = await page.evaluate(async () => {
    return await shoulda.run();
  });
  return success;
}

desc("Download and parse list of top-level domains (TLDs)");
task("fetch-tlds", [], async () => {
  const suffixListUrl = "https://www.iana.org/domains/root/db";
  const response = await fetch(suffixListUrl);
  const text = await response.text();
  const doc = new DOMParser().parseFromString(text, "text/html");
  const els = doc.querySelectorAll("span.domain.tld");
  // Each span contains a TLD, e.g. ".com". Trim off the leading period.
  const domains = Array.from(els).map((el) => el.textContent.slice(1));
  const str = domains.join("\n");
  await Deno.writeTextFile("./resources/tlds.txt", str);
});

desc("Run unit tests");
task("test-unit", [], async () => {
  const success = await runUnitTests();
  if (!success) {
    abort("test-unit failed");
  }
});

function isPortAvailable(number) {
  try {
    const listener = Deno.listen({ port: number });
    listener.close();
    return true;
  } catch (_error) {
    return false;
  }
}

function getAvailablePort() {
  const min = 7000;
  const max = 65535;
  let count = 0;
  const getRandomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
  let port = getRandomInt(min, max);
  while (!isPortAvailable(port) && count < max - min) {
    port++;
    if (port > max) {
      port = min;
    }
    if (isPortAvailable(port)) {
      return port;
    }
    count++;
    if (count >= max - min) {
      throw new Error(`No port is available in the range ${min} - ${max}`);
    }
  }
  return port;
}

async function testDom() {
  const port = getAvailablePort();
  let served404 = false;
  const httpServer = Deno.serve({ port }, async (req) => {
    const url = new URL(req.url);
    let path = decodeURIComponent(url.pathname);
    if (path.startsWith("/")) {
      path = "." + path;
    }
    if (!(await fs.exists(path))) {
      console.error("dom-tests: requested missing file (not found):", path);
      served404 = true;
      return new Response(null, { status: 404 });
    } else {
      return fileServer.serveFile(req, path);
    }
  });

  const files = ["dom_tests.html"];
  const browser = await puppeteer.launch();
  let success = true;
  for (const file of files) {
    const page = await browser.newPage();
    console.log("Running", file);
    setupPuppeteerPageForTests(page);
    const url = `http://localhost:${port}/tests/dom_tests/${file}?dom_tests=true`;
    const result = await runPuppeteerTest(page, url);
    success = success && result;
    if (served404) {
      console.log(`${file} failed: a background or content script requested a missing file.`);
    }
    if (page.receivedErrorOutput) {
      console.log(`${file} failed: there was a page level error.`);
      success = false;
    }
    // If we close the puppeteer page (tab) via page.close(), we can get innocuous but noisy output
    // like this:
    // net::ERR_ABORTED http://localhost:43524/pages/hud_page.html?dom_tests=true
    // There's probably a way to prevent that, but as a work around, we avoid closing the page.
    // browser.close() will close all of its owned pages.
  }
  // NOTE(philc): At one point in development, I noticed that the output from Deno would suddenly
  // pause, prior to the tests fully finishing, so closing the browser here may be racy. If it
  // occurs again, we may need to add "await delay(200)".
  await browser.close();
  await httpServer.shutdown();
  if (served404 || !success) {
    abort("test-dom failed.");
  }
}

desc("Run DOM tests");
task("test-dom", [], testDom);

desc("Test the installed extension in Chromium");
task("test-browser", [], async () => {
  await shell("deno", ["run", "-A", "tests/browser_tests/extension_test.js"]);
});

desc("Run unit and DOM tests");
task("test", ["test-unit", "test-dom"]);

desc("Test real Alt+Q delivery on a dedicated BROVIM_NATIVE_DISPLAY (Xvfb)");
task("test-native", [], async () => {
  await shell("deno", ["run", "-A", "tests/browser_tests/native_shortcut_test.js"]);
});

desc("Test incognito/worker recovery, or Firefox when BROVIM_TEST_BROWSER=firefox");
task("test-lifecycle", [], async () => {
  await shell("deno", ["run", "-A", "tests/browser_tests/lifecycle_test.js"]);
});

desc("Test internal pages from the source extension, with and without the Chromium developer flag");
task("test-internal-pages", [], async () => {
  await shell("deno", ["run", "-A", "tests/browser_tests/internal_pages_test.js"]);
});

desc("Check code formatting and lint issues");
task("check", [], async () => {
  await shell("deno", ["fmt", "--check"]);
  await shell("deno", ["lint"]);
});

desc("Builds a zip file for submission to the Chrome and Firefox stores. The output is in dist/");
task("package", ["write-command-listing"], async () => {
  await buildStorePackage();
});

desc("Write a static command reference page to dist/command_listing_page");
task("write-command-listing", [], async () => {
  // Run this script in a separate shell so it doesn't pollute our JS environment.
  await shell("./build_scripts/write_command_listing_page.js", []);
});

desc("Replaces manifest.json with a Firefox-compatible version, for development");
task("write-firefox-manifest", [], async () => {
  const firefoxManifest = createFirefoxManifest(await parseManifestFile());
  await Deno.writeTextFile("./manifest.json", JSON.stringify(firefoxManifest, null, 2));
});

run();
