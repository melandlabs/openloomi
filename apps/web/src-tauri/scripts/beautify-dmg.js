// Builds a "beautiful" macOS DMG installer (the classic drag-to-Applications
// layout) for the Alloomi .app bundle produced by Tauri.
//
// Layout mirrors mainstream macOS DMGs (Manus / Slack / Chrome):
//
//     ┌──────────────────────────────────────┐
//     │ ●●●  Alloomi <version>                │
//     │                                       │
//     │   [App icon]    ⇢ dashed arrow       │
//     │                                       │
//     │   Alloomi              Applications   │
//     └──────────────────────────────────────┘
//
// The arrow is baked into the background PNG (see gen-dmg-background.js);
// this script positions the real .app (left) and the /Applications alias
// (right) so their icons line up with that arrow.
//
// Zero external dependencies — uses only macOS built-ins: hdiutil + Finder
// (via osascript).
//
// NOTE on headless / CI: the icon layout is driven by Finder via AppleScript,
// which requires a running Aqua session. This is the same approach Tauri's
// own bundle_dmg.sh (forked from create-dmg) uses. On a headless macOS runner
// Finder is unavailable, so we PROBE for Finder first and, if absent, fall back
// to a committed .DS_Store TEMPLATE (resources/dmg_DS_Store) so the DMG still
// ships the full drag-to-Applications layout on CI. The template is portable:
// Finder resolves the background image by VOLUME NAME at mount time, so the
// build-machine temp path embedded in the BookMark is harmless.
//
// MAINTENANCE: whenever you change the layout constants in writeLayout()
// (window size, iconSize, icon positions) or the background image, regenerate
// the template on a Mac with a GUI and commit it:
//     node src-tauri/scripts/beautify-dmg.js   # build the DMG locally
//     # mount it, then copy its .DS_Store over the template:
//     cp /Volumes/Alloomi/.DS_Store apps/web/src-tauri/resources/dmg_DS_Store
// (The file is named dmg_DS_Store — no leading dot — so .gitignore's
// .DS_Store rule does not block it.)
//
// Usage:
//   node beautify-dmg.js [appPath] [outDmg] [--app-name <name>] [--bg <png>]
//
// When appPath / outDmg are omitted they are auto-discovered:
//   appPath = <src-tauri>/target/release/bundle/macos/<appName>.app
//   outDmg  = <src-tauri>/target/release/bundle/dmg/<appName>_<version>_<arch>.dmg
//
// The output overwrites the plain DMG Tauri emits during `tauri build`,
// so the existing build pipeline + signing flow is preserved. This script
// should run AFTER optimize-tauri-bundle.js has re-signed the .app.

import { execSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const __dirname = new URL(".", import.meta.url).pathname;
const SRC_TAURI_DIR = path.resolve(__dirname, "..");
const ICONS_DIR = path.resolve(SRC_TAURI_DIR, "icons");
// Pre-built, portable .DS_Store template committed to the repo. On headless
// CI (no Finder) we copy this into the DMG instead of running AppleScript, so
// the resulting DMG matches what a local GUI build produces. See dmg-beautify
// design doc / git history for why this must use RELATIVE background paths.
const DS_STORE_TEMPLATE = path.join(SRC_TAURI_DIR, "resources", "dmg_DS_Store");

function parseArgs(argv) {
  const args = {
    appName: "Alloomi",
    bg: path.join(ICONS_DIR, "dmg-background@2x.png"),
  };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--app-name") args.appName = argv[++i];
    else if (a === "--bg") args.bg = argv[++i];
    else positional.push(a);
  }
  [args.appPath, args.outDmg] = positional;
  return args;
}

// Validate appName against a safe whitelist: it is interpolated into both a
// shell command (hdiutil -volname) and an AppleScript string, so any quote,
// backtick, $(), or ":" would be an injection / syntax-break vector.
const SAFE_APP_NAME = /^[A-Za-z0-9 ._-]+$/;
function assertAppName(name) {
  if (!SAFE_APP_NAME.test(name)) {
    console.error(
      `[beautify-dmg] Refusing unsafe --app-name (must match ${SAFE_APP_NAME}): ${JSON.stringify(name)}`,
    );
    process.exit(1);
  }
}

// Read version from tauri.conf.json so the DMG filename matches what
// Tauri itself would produce.
function readVersion() {
  try {
    const conf = JSON.parse(
      fs.readFileSync(path.join(SRC_TAURI_DIR, "tauri.conf.json"), "utf8"),
    );
    return conf.version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

// Tauri uses "aarch64" for Apple Silicon and "x64" for Intel in DMG names.
function archSuffix() {
  return process.arch === "arm64" ? "aarch64" : "x64";
}

function autoDiscover(appName) {
  const macosDir = path.join(
    SRC_TAURI_DIR,
    "target",
    "release",
    "bundle",
    "macos",
  );
  const dmgDir = path.join(SRC_TAURI_DIR, "target", "release", "bundle", "dmg");
  const appPath = path.join(macosDir, `${appName}.app`);
  const outDmg = path.join(
    dmgDir,
    `${appName}_${readVersion()}_${archSuffix()}.dmg`,
  );
  return { appPath, outDmg };
}

function run(cmd, opts = {}) {
  return execSync(cmd, { stdio: "inherit", ...opts });
}

function runQuiet(cmd) {
  return execSync(cmd, { stdio: "pipe" }).toString();
}

// Deterministic-enough random id without Date.now()/Math.random() (this script
// is sometimes run from contexts where those are unavailable). crypto is stdlib.
function randomId() {
  return randomBytes(4).toString("hex");
}

// C3: detect whether Finder (Aqua) is reachable for AppleScript. Returns true
// in a normal interactive macOS session; false on headless runners.
function isFinderAvailable() {
  const res = spawnSync(
    "osascript",
    ["-e", 'tell application "Finder" to name'],
    { stdio: "pipe" },
  );
  return res.status === 0;
}

// C1: ensure cleanup runs on normal exit, SIGINT (Ctrl+C) and SIGTERM (CI kill).
function registerExitHandlers(cleanup) {
  const handler = (sig) => {
    cleanup();
    // Only exit for signals; for 'exit' let the process continue its teardown.
    if (sig) process.exit(sig === "SIGINT" ? 130 : 143);
  };
  process.once("exit", () => cleanup());
  process.once("SIGINT", () => handler("SIGINT"));
  process.once("SIGTERM", () => handler("SIGTERM"));
}

function main() {
  // Only run on macOS — this whole script is macOS-only.
  if (process.platform !== "darwin") {
    console.warn("[beautify-dmg] Not macOS, skipping DMG beautification.");
    return;
  }

  const {
    appPath: argApp,
    outDmg: argDmg,
    appName,
    bg,
  } = parseArgs(process.argv.slice(2));
  assertAppName(appName);
  const { appPath: autoApp, outDmg: autoDmg } = autoDiscover(appName);
  const appPath = argApp || autoApp;
  const outDmg = argDmg || autoDmg;

  if (!appPath || !fs.existsSync(appPath)) {
    console.error(`[beautify-dmg] App bundle not found: ${appPath}`);
    process.exit(1);
  }
  if (!bg || !fs.existsSync(bg)) {
    console.error(`[beautify-dmg] Background image not found: ${bg}`);
    process.exit(1);
  }

  const finalDmg = outDmg;
  const volumeName = appName; // shown as the DMG window title

  // Unique suffix per run so concurrent builds / crashed leftovers don't collide.
  const uniq = `${process.pid}-${randomId()}`;
  const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), "openloomi-dmg-"));
  const rwDmg = path.join(stagingDir, `${appName}-rw.dmg`);
  // mountPoint is assigned after attach (we mount at the default /Volumes/
  // location so Finder can resolve the disk by name). Declared here so the
  // cleanup handler can reference it.
  const mountPoint = "";

  // C1: track mounted state and register cleanup on any exit path (incl.
  // SIGINT/SIGTERM) so a killed build never leaks an attached volume or the
  // staging dir.
  let mounted = false;
  const cleanup = () => {
    if (mounted) {
      detach(mountPoint);
      mounted = false;
    }
    try {
      fs.rmSync(stagingDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  };
  registerExitHandlers(cleanup);

  // C3: probe Finder once up front. If unavailable (headless CI), we fall back
  // to the committed .DS_Store template so the DMG still gets the full layout.
  // Force the headless path under CI: GitHub Actions' macOS runners report
  // osascript/Finder as "available" (exit 0) even though there is no Aqua user
  // session, so isFinderAvailable() would falsely return true and we'd take the
  // AppleScript branch — which silently produces NO layout. The CI env var (set
  // to "true" by GitHub Actions and most CI systems) reliably signals we must
  // use the committed .DS_Store template instead.
  const finderOk = process.env.CI ? false : isFinderAvailable();
  const hasTemplate = fs.existsSync(DS_STORE_TEMPLATE);

  console.log(`[beautify-dmg] appPath = ${appPath}`);
  console.log(`[beautify-dmg] outDmg  = ${finalDmg}`);
  console.log(`[beautify-dmg] bg      = ${bg}`);
  if (!finderOk) {
    if (hasTemplate) {
      console.log(
        "[beautify-dmg] Finder unavailable (headless / non-GUI). " +
          "Reusing committed .DS_Store template for the icon layout.",
      );
    } else {
      // Fail fast: a headless build with no template would silently ship a DMG
      // with no custom layout. Stop the build instead of emitting a broken
      // installer.
      console.error(
        `[beautify-dmg] ERROR: Finder unavailable AND no .DS_Store template found at ${DS_STORE_TEMPLATE}. The DMG would have NO custom layout. Generate the template on a Mac with a GUI and commit it:\n    node src-tauri/scripts/beautify-dmg.js\n    cp /Volumes/Alloomi/.DS_Store apps/web/src-tauri/resources/dmg_DS_Store`,
      );
      process.exit(1);
    }
  }

  try {
    // --- 1) Size the read-write DMG: app size + headroom + background ---
    // Use app size * 1.1 + 60MB slack so large apps don't run out of space
    // during cp (which would otherwise fail mid-copy).
    const appSize = dirSize(appPath);
    const dmgSizeKb = Math.ceil((appSize * 1.1 + 60 * 1024 * 1024) / 1024);

    // --- 2) Create a read-write DMG (HFS+) ---
    run(
      `hdiutil create -ov -volname "${volumeName}" -fs HFS+ ` +
        `-size ${dmgSizeKb}k -type UDIF "${rwDmg}"`,
    );

    // --- 3) Mount at the DEFAULT location (/Volumes/<volumeName>) so Finder
    // can locate the disk by volume name. We detach any stale same-named
    // volume first (detachStaleVolume) to avoid the "Alloomi 1" suffix that
    // macOS adds on a name collision — that would also break name-based
    // targeting. (Earlier we used a custom -mountpoint under /tmp, but Finder
    // only resolves `disk "<name>"` for volumes mounted under /Volumes.)
    detachStaleVolume(volumeName);
    const attachOut = runQuiet(
      `hdiutil attach -readwrite -noverify -noautoopen -nobrowse "${rwDmg}"`,
    );
    const mountPoint = parseMountPoint(attachOut) || `/Volumes/${volumeName}`;
    if (!fs.existsSync(mountPoint)) {
      throw new Error(`Failed to mount RW DMG (expected at ${mountPoint})`);
    }
    mounted = true;
    console.log(
      `[beautify-dmg] mounted at ${mountPoint} (volume "${volumeName}")`,
    );
    // Tauri's create-dmg sleeps ~2s after attach to dodge the intermittent
    // "Can't get disk (-1728)" race before talking to Finder.
    if (finderOk) execSync("sleep 2");

    // --- 4) Copy the .app and create the /Applications symlink ---
    // `.app` on the LEFT, `Applications` alias on the RIGHT.
    execSync(`cp -R "${appPath}" "${mountPoint}/"`);
    execSync(`ln -s /Applications "${mountPoint}/Applications"`);

    // Drop a hidden background image into the volume.
    const bgDir = path.join(mountPoint, ".background");
    fs.mkdirSync(bgDir, { recursive: true });
    const bgName = "dmg-background@2x.png";
    fs.copyFileSync(bg, path.join(bgDir, bgName));

    // --- 5) Layout ---
    if (finderOk) {
      writeLayout({
        volumeName,
        appName,
        bgName,
        width: 660,
        height: 400,
        iconSize: 96,
        appIconPos: [180, 170], // left icon center; aligns with arrow body
        appsIconPos: [480, 170], // right icon center; aligns with arrow tip
      });
      // Give Finder a moment to flush .DS_Store to disk.
      execSync("sleep 2");

      // Template sync reminder: the committed .DS_Store template drives the
      // headless-CI fallback below, so it must match this layout. The full file
      // bytes are NOT comparable across builds (the background-image BookMark
      // embeds a per-build temp path + UUID), so we don't diff bytes — we just
      // remind the developer to regenerate the template whenever the layout
      // constants above (window size / iconSize / icon positions / background)
      // change. See the maintenance note in the file header.
      // (Intentionally a no-op at runtime; kept as a documentation anchor.)
    }

    // Verify the layout actually landed as a non-empty .DS_Store. AppleScript
    // can silently no-op where osascript runs but no real Aqua session exists
    // (e.g. some CI runners), leaving the DMG with no layout. If Finder failed
    // to write .DS_Store, fall back to the committed template.
    const dsStorePath = path.join(mountPoint, ".DS_Store");
    const layoutOk =
      fs.existsSync(dsStorePath) && fs.statSync(dsStorePath).size > 0;

    if (!layoutOk && hasTemplate) {
      fs.copyFileSync(DS_STORE_TEMPLATE, dsStorePath);
      console.log(
        "[beautify-dmg] Finder produced no .DS_Store; applied committed template as fallback",
      );
    } else if (!layoutOk && !hasTemplate) {
      console.error(
        "[beautify-dmg] ERROR: no .DS_Store was produced and no template is available; " +
          "the DMG will have NO custom layout.",
      );
    }

    // --- 6) Detach so .DS_Store is finalized ---
    detach(mountPoint);
    mounted = false;

    // --- 7) Convert RW DMG → compressed read-only DMG (UDZO).
    // M4: convert to a temp file first, then atomically replace the original
    // DMG — so if convert fails we never end up with NO DMG at all.
    fs.mkdirSync(path.dirname(finalDmg), { recursive: true });
    const tmpDmg = `${finalDmg}.tmp`;
    if (fs.existsSync(tmpDmg)) fs.rmSync(tmpDmg, { force: true });
    run(
      `hdiutil convert "${rwDmg}" -format UDZO -imagekey zlib-level=9 -o "${tmpDmg}"`,
    );
    // hdiutil convert appends .dmg to -o if not present; normalize the name.
    const produced = fs.existsSync(tmpDmg) ? tmpDmg : `${tmpDmg}.dmg`;
    if (!fs.existsSync(produced)) {
      throw new Error(
        `hdiutil convert did not produce expected output: ${produced}`,
      );
    }
    fs.renameSync(produced, finalDmg);

    console.log(`[beautify-dmg] ✓ Created ${finalDmg}`);
  } finally {
    cleanup();
  }
}

// Write the .DS_Store via Finder AppleScript.
// This sets: background picture, window bounds, view (icon), icon size,
// and icon positions for the app + Applications symlink.
//
// PORTABILITY: the background picture MUST be set with a HFS-style RELATIVE
// path ("file \".background:foo.png\"") resolved against the disk context —
// NOT via the mount-point POSIX path. If we referenced the absolute mount
// point, the resulting BookMark alias would embed the build machine's
// /private/tmp/... path and the background would break on other machines
// (incl. end users). This mirrors Tauri's own create-dmg template.
//
// We locate the disk by VOLUME NAME (after ensuring no stale "Alloomi"
// volume is still attached in main()), and pass the name as an osascript
// argument rather than interpolating it, to avoid any quoting issues.
function writeLayout({
  volumeName,
  appName,
  bgName,
  width,
  height,
  iconSize,
  appIconPos,
  appsIconPos,
}) {
  // volumeName is validated by assertAppName() before reaching here, so it is
  // safe to interpolate. Still, we pass it as an argument for clarity.
  const script = `
on run argv
  set volName to item 1 of argv
  tell application "Finder"
    tell disk (volName as string)
      open
      tell container window
        set current view to icon view
        set toolbar visible to false
        set statusbar visible to false
        set pathbar visible to false
        set the bounds to {200, 120, ${200 + width}, ${120 + height}}
      end tell
      set opts to icon view options of container window
      tell opts
        set arrangement to not arranged
        set icon size to ${iconSize}
      end tell
      -- Background: set OUTSIDE the opts block, resolving the file
      -- relative to this disk so the alias stays portable (no build path).
      set background picture of opts to file ".background:${bgName}"
      set position of item "${appName}.app" to {${appIconPos[0]}, ${appIconPos[1]}}
      set position of item "Applications" to {${appsIconPos[0]}, ${appsIconPos[1]}}
      close
      open
      delay 1
      tell container window
        set the bounds to {200, 120, ${200 + width}, ${120 + height}}
      end tell
      close
    end tell
    delay 2
  end tell
end run
`;

  // Write the script to the system temp dir and run via osascript with the
  // volume name as an argument.
  const tmp = path.join(
    os.tmpdir(),
    `_openloomi_dmg_layout_${process.pid}-${randomId()}.scpt`,
  );
  fs.writeFileSync(tmp, script);
  // Tauri's create-dmg sleeps ~2s after attach to dodge the intermittent
  // "Can't get disk (-1728)" race; the caller already sleeps before us, but
  // we keep the osascript invocation identical to the proven template.
  const res = spawnSync("osascript", [tmp, volumeName], { stdio: "inherit" });
  fs.rmSync(tmp, { force: true });
  if (res.status !== 0) {
    throw new Error(
      "Finder AppleScript layout failed (osascript exited non-zero).",
    );
  }
}

// Parse the mount point from `hdiutil attach` output (last column of the
// final tab-separated line). Returns "" if it can't be determined.
function parseMountPoint(attachOutput) {
  const lines = attachOutput.trim().split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const cols = lines[i].split("\t");
    const last = (cols[cols.length - 1] || "").trim();
    if (last.startsWith("/")) return last;
  }
  return "";
}

// Detach any currently-attached volume whose label matches `volumeName`
// (including the "Alloomi 1"/"Alloomi 2" suffixes macOS adds on collision).
// Needed because the layout AppleScript targets the disk by volume name, so a
// leftover same-named volume would be selected instead of the one we just made.
function detachStaleVolume(volumeName) {
  let infos;
  try {
    infos = runQuiet("hdiutil info");
  } catch {
    return;
  }
  // Each attached volume shows a "/Volumes/<name>" mount-point line.
  const re = new RegExp(`(/Volumes/${escapeRegex(volumeName)}(?: \\d+)?)`, "g");
  for (const m of infos.matchAll(re)) {
    const mp = m[1];
    try {
      execSync(`hdiutil detach "${mp}" -force`, { stdio: "ignore" });
      console.log(`[beautify-dmg] detached stale volume ${mp}`);
    } catch {
      /* ignore */
    }
  }
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// M6: detach with bounded retries. hdiutil detach can transiently fail right
// after a Finder layout (volume busy flushing); retry a few times and warn
// rather than throwing — a leaked mount is annoying but not fatal, and we must
// not let it abort the whole build.
function detach(mountPoint) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      execSync(`hdiutil detach "${mountPoint}" -force`, { stdio: "ignore" });
      return;
    } catch {
      execSync("sleep 1", { stdio: "ignore" });
    }
  }
  console.warn(
    `[beautify-dmg] WARNING: could not detach "${mountPoint}" after retries (it may already be gone). Run \`hdiutil detach\` manually if it persists.`,
  );
}

function dirSize(p) {
  // du -k reports size in KB. Guard against a non-numeric parse so we never
  // pass NaN into `hdiutil -size` (which would fail the whole build).
  try {
    const kb = Number.parseInt(
      execSync(`du -sk "${p}"`, { stdio: ["pipe", "pipe", "ignore"] })
        .toString()
        .split(/\s+/)[0],
      10,
    );
    if (Number.isFinite(kb) && kb > 0) return kb * 1024;
  } catch {
    /* fall through */
  }
  return 500 * 1024 * 1024; // fallback: assume 500MB
}

main();
