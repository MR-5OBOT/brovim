// Sets up Helium for Brovim on a new machine or profile:
// - Helium's keyboard shortcuts from shortcuts.json (the defaults you removed and the keys you added,
//   as set in chrome://settings/system/shortcuts), over the profile's own: its other changes stay;
// - --extensions-on-chrome-urls in helium-browser-flags.conf, so Brovim runs on Helium's own pages.
//
//   deno run -A helium/setup.js                  apply both; close Helium first
//   deno run -A helium/setup.js save             copy the profile's current shortcuts here
//   ... --profile ~/.config/net.imput.helium/Default   another profile (this is the default)

const configDir = Deno.env.get("XDG_CONFIG_HOME") || `${Deno.env.get("HOME")}/.config`;
const defaultProfile = `${configDir}/net.imput.helium/Default`;
// Read by the Linux helium-browser launcher, as is /etc/helium-browser-flags.conf.
const defaultFlagsFile = `${configDir}/helium-browser-flags.conf`;
const defaultShortcutsFile = new URL("./shortcuts.json", import.meta.url);
const flag = "--extensions-on-chrome-urls";

// While Helium runs, its data folder holds a SingletonLock link to "host-pid". Helium keeps its
// preferences in memory and writes them back when it exits, so changes made now would be lost.
function isRunning(profile) {
  try {
    const pid = Deno.readLinkSync(`${profile}/../SingletonLock`).split("-").pop();
    Deno.statSync(`/proc/${pid}`);
    return true;
  } catch {
    return false;
  }
}

export async function apply(
  profile = defaultProfile,
  flagsFile = defaultFlagsFile,
  shortcutsFile = defaultShortcutsFile,
) {
  if (isRunning(profile)) {
    throw new Error("Close Helium first: it overwrites its preferences when it exits.");
  }
  const prefsFile = `${profile}/Preferences`;
  let prefs;
  try {
    prefs = JSON.parse(await Deno.readTextFile(prefsFile));
  } catch {
    throw new Error(`No Helium profile at ${profile}. Start Helium once, close it, and run again.`);
  }
  const browser = (prefs.helium ??= {}).browser ??= {};
  browser.custom_accelerators = {
    ...browser.custom_accelerators,
    ...JSON.parse(await Deno.readTextFile(shortcutsFile)),
  };
  // Only the first run's backup holds the profile as it was before this script changed it.
  const backup = `${prefsFile}.before-brovim-setup`;
  await Deno.stat(backup).catch(() => Deno.copyFile(prefsFile, backup));
  await Deno.writeTextFile(`${prefsFile}.tmp`, JSON.stringify(prefs), { mode: 0o600 });
  await Deno.rename(`${prefsFile}.tmp`, prefsFile);

  const flags = await Deno.readTextFile(flagsFile).catch(() => "");
  if (!flags.split("\n").some((line) => line.trim() === flag)) {
    const separator = flags && !flags.endsWith("\n") ? "\n" : "";
    await Deno.writeTextFile(
      flagsFile,
      `${flags}${separator}# Lets Brovim run on Helium's own pages.\n${flag}\n`,
    );
  }
}

export async function save(profile = defaultProfile, shortcutsFile = defaultShortcutsFile) {
  const prefs = JSON.parse(await Deno.readTextFile(`${profile}/Preferences`));
  const shortcuts = prefs.helium?.browser?.custom_accelerators ?? {};
  await Deno.writeTextFile(shortcutsFile, JSON.stringify(shortcuts, null, 2) + "\n");
}

if (import.meta.main) {
  const args = [...Deno.args];
  const at = args.indexOf("--profile");
  try {
    if (at >= 0 && (!args[at + 1] || args[at + 1].startsWith("--"))) {
      throw new Error("--profile requires a profile directory.");
    }
    const profile = at >= 0 ? args.splice(at, 2)[1] : defaultProfile;
    if (args[0] === "save") {
      await save(profile);
      console.log(`Saved the shortcuts of ${profile} to helium/shortcuts.json.`);
    } else if (args[0] == null || args[0] === "apply") {
      await apply(profile);
      console.log(`Applied helium/shortcuts.json to ${profile} and checked ${defaultFlagsFile}.`);
      console.log("Start Helium with helium-browser so the flag takes effect.");
    } else {
      throw new Error("Usage: deno run -A helium/setup.js [apply|save] [--profile <dir>]");
    }
  } catch (error) {
    console.error(error.message);
    Deno.exit(1);
  }
}
