// deno test -A helium/
import assert from "node:assert/strict";
import { apply, save } from "./setup.js";

Deno.test("apply sets the shortcuts and the flag once, keeps other prefs, and waits for Helium to close", async () => {
  const dir = await Deno.makeTempDir();
  const profile = `${dir}/Default`;
  const flags = `${dir}/helium-browser-flags.conf`;
  await Deno.mkdir(profile);
  await Deno.writeTextFile(
    `${profile}/Preferences`,
    JSON.stringify({ other: 1, helium: { browser: { zen_mode: true, custom_accelerators: {} } } }),
  );
  await Deno.writeTextFile(flags, "--some-flag");

  await apply(profile, flags);
  await apply(profile, flags);
  const prefs = JSON.parse(await Deno.readTextFile(`${profile}/Preferences`));
  const shortcuts = JSON.parse(
    await Deno.readTextFile(new URL("./shortcuts.json", import.meta.url)),
  );
  assert.deepEqual(prefs.helium.browser.custom_accelerators, shortcuts);
  assert.equal(prefs.other, 1);
  assert.equal(prefs.helium.browser.zen_mode, true);
  assert.equal(
    await Deno.readTextFile(flags),
    "--some-flag\n# Lets Brovim run on Helium's own pages.\n--extensions-on-chrome-urls\n",
  );

  await save(profile, `${dir}/saved.json`);
  assert.deepEqual(JSON.parse(await Deno.readTextFile(`${dir}/saved.json`)), shortcuts);

  await Deno.symlink(`host-${Deno.pid}`, `${dir}/SingletonLock`);
  await assert.rejects(() => apply(profile, flags), /Close Helium first/);
  await Deno.remove(dir, { recursive: true });
});
