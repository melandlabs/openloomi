import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

const platform = os.platform();
const isDarwin = platform === "darwin";
const isWindows = platform === "win32";
const isLinux = platform === "linux";

const APP_BUNDLE = process.argv[2] || null;
const SKIP_SIGNING = process.env.SKIP_SIGNING === "true";
const SIGNING_IDENTITY =
  process.env.SIGNING_IDENTITY || (isDarwin ? "-sign -" : null);

const webDir = path.resolve(__dirname, "..");

console.log("Optimizing Tauri bundle size...");
console.log("Platform:", platform);

if (!isDarwin) {
  console.log("This optimization script is designed for macOS builds.");
  console.log("Skipping bundle optimization for", `${platform}...`);
  console.log("Tauri build complete for", `${platform}!`);
  process.exit(0);
}

let appBundle = APP_BUNDLE;
if (!appBundle) {
  appBundle = path.join(
    webDir,
    "src-tauri/target/release/bundle/macos/openloomi.app",
  );
}

if (!path.isAbsolute(appBundle)) {
  appBundle = path.join(webDir, appBundle);
}

console.log("App bundle:", appBundle);

const standaloneDir = path.join(
  appBundle,
  "Contents/Resources/_up_/.next/standalone",
);

if (!fs.existsSync(standaloneDir)) {
  console.error("Error: standalone directory not found at:", standaloneDir);
  process.exit(1);
}

const origCwd = process.cwd();
process.chdir(standaloneDir);

console.log("Size before optimization:");
try {
  console.log(" ", execSync("du -sh .", { encoding: "utf8" }).trim());
} catch {}

const copyFile = (src, dest) => {
  if (fs.existsSync(src)) fs.copyFileSync(src, dest);
};

const copyDir = (src, dest) => {
  if (!fs.existsSync(src)) return;
  const mk = (p) => fs.mkdirSync(p, { recursive: true });
  const rec = (s, d) => {
    mk(d);
    for (const item of fs.readdirSync(s)) {
      const ss = path.join(s, item);
      const dd = path.join(d, item);
      fs.statSync(ss).isDirectory() ? rec(ss, dd) : fs.copyFileSync(ss, dd);
    }
  };
  rec(src, dest);
};

const rm = (p) => {
  try {
    fs.rmSync(p, { recursive: true, force: true });
  } catch {}
};

console.log("Checking .env file...");
const envSrc = path.join(webDir, ".env");
const envDest = path.join(standaloneDir, "apps/web/.env");
if (!fs.existsSync(envDest)) {
  copyFile(envSrc, envDest);
  console.log("  .env file copied");
} else {
  console.log("  .env file exists");
}

console.log("Checking scripts directory...");
const scriptsDest = path.join(standaloneDir, "apps/web/scripts");
if (!fs.existsSync(scriptsDest)) {
  const scriptsSrc = path.join(webDir, "scripts");
  if (fs.existsSync(scriptsSrc)) {
    fs.mkdirSync(scriptsDest, { recursive: true });
    copyFile(
      path.join(scriptsSrc, "init-db.cjs"),
      path.join(scriptsDest, "init-db.cjs"),
    );
    console.log("  scripts directory copied");
  }
} else {
  console.log("  scripts directory exists");
}

console.log("Checking public directory...");
const publicDest = path.join(standaloneDir, "apps/web/public");
if (!fs.existsSync(publicDest)) {
  const publicSrc = path.join(webDir, "public");
  if (fs.existsSync(publicSrc)) {
    copyDir(publicSrc, publicDest);
    console.log("  public directory copied");
  }
} else {
  console.log("  public directory exists");
}

const findDirs = (dir, pattern) => {
  const results = [];
  const rec = (d) => {
    if (!fs.existsSync(d)) return;
    for (const item of fs.readdirSync(d)) {
      const p = path.join(d, item);
      try {
        if (fs.statSync(p).isDirectory()) {
          if (pattern.test(item)) results.push(p);
          rec(p);
        }
      } catch {}
    }
  };
  rec(dir);
  return results;
};

console.log("Removing TypeScript...");
for (const d of findDirs("node_modules/.pnpm", /typescript@/)) rm(d);

console.log("Removing Chromium binary files...");
rm("apps/web/node_modules/@sparticuz/chromium/bin");
for (const d of findDirs("node_modules/.pnpm", /@sparticuz\+chromium/)) rm(d);

console.log("Removing Puppeteer binaries...");
for (const d of findDirs("node_modules/.pnpm", /puppeteer@/)) rm(d);
for (const d of findDirs("node_modules/.pnpm", /puppeteer-core@/)) rm(d);

console.log("Removing unused sharp platform binaries...");
for (const d of findDirs("node_modules/.pnpm", /@img\+sharp-/)) {
  if (!d.includes("darwin-arm64") && !d.includes("libvips-darwin-arm64")) {
    rm(d);
  }
}

console.log("Removing development dependencies...");
for (const pattern of [
  /@types\+/,
  /@vitest\+/,
  /@biomejs\+/,
  /eslint\+/,
  /prettier\+/,
  /tailwindcss\+/,
  /postcss\+/,
  /@playwright\+/,
]) {
  for (const d of findDirs("node_modules/.pnpm", pattern)) rm(d);
}

console.log("Removing ebooks...");
rm("apps/web/public/ebooks");
console.log("Removing mock-data...");
rm("apps/web/public/mock-data");

console.log("Cleaning Next.js cache files...");
try {
  execSync('find apps/web/.next -name "*.map" -delete', {
    stdio: "pipe",
    shell: true,
  });
} catch {}
try {
  execSync(
    "find apps/web/.next -type d -name cache -exec rm -rf {} + 2>/dev/null || true",
    { stdio: "pipe", shell: true },
  );
} catch {}

const resourcesDir = path.join(appBundle, "Contents/Resources/_up_");
const skillsDir = path.join(resourcesDir, "skills");
if (fs.existsSync(skillsDir)) {
  for (const d of findDirs(skillsDir, /^node_modules$/)) rm(d);
}

console.log("Cleaning config files...");
const cleanAtLevel = (dir) => {
  if (!fs.existsSync(dir)) return;
  for (const f of [".npmrc", ".pnpm-lock.yaml", ".bun.lock"]) {
    try {
      fs.unlinkSync(path.join(dir, f));
    } catch {}
  }
};
cleanAtLevel("apps/web");
cleanAtLevel(".");

console.log("Size after optimization:");
try {
  console.log(" ", execSync("du -sh .", { encoding: "utf8" }).trim());
} catch {}

console.log("Final app bundle size:");
try {
  console.log(
    " ",
    execSync(`du -sh "${appBundle}"`, { encoding: "utf8" }).trim(),
  );
} catch {}

console.log("Updating capabilities in bundle...");
const srcCaps = path.join(webDir, "src-tauri/capabilities/default.json");
const bundleCapsDir = path.join(appBundle, "Contents/Resources/capabilities");
const bundleCaps = path.join(bundleCapsDir, "default.json");
if (fs.existsSync(srcCaps)) {
  fs.mkdirSync(bundleCapsDir, { recursive: true });
  fs.copyFileSync(srcCaps, bundleCaps);
  console.log("  Capabilities updated");
}

const infoPlist = path.join(appBundle, "Contents/Info.plist");
if (fs.existsSync(infoPlist)) {
  console.log("Fixing bundle identifier for iMessage permissions...");
  try {
    const currentId = execSync(
      `/usr/libexec/PlistBuddy -c "Print :CFBundleIdentifier" "${infoPlist}" 2>/dev/null`,
      { encoding: "utf8" },
    ).trim();
    if (currentId !== "com.openloomi.app") {
      execSync(
        `/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier com.openloomi.app" "${infoPlist}"`,
        { stdio: "pipe" },
      );
      console.log("  Bundle identifier set to: com.openloomi.app");
    }
  } catch {}

  if (!SKIP_SIGNING) {
    const mainBinary = path.join(appBundle, "Contents/MacOS/openloomi");
    const mainEntitlements = path.join(webDir, "src-tauri/entitlements.plist");
    if (fs.existsSync(mainBinary) && fs.existsSync(mainEntitlements)) {
      console.log("Signing main binary with entitlements...");
      execSync(`xattr -cr "${mainBinary}" 2>/dev/null || true`, {
        shell: true,
      });
      execSync(
        `codesign --deep --force --sign "${SIGNING_IDENTITY}" --options runtime --timestamp --identifier "com.openloomi.app" --entitlements "${mainEntitlements}" "${mainBinary}"`,
        { stdio: "pipe" },
      );
      console.log("  Main binary signed");
    }

    console.log("Signing nested binaries...");
    execSync(
      `find "${appBundle}" -type f -name "*.node" -print0 | xargs -0 xattr -cr 2>/dev/null || true`,
      { shell: true },
    );
    execSync(
      `find "${appBundle}" -type f -name "*.node" -print0 | xargs -0 codesign --force --sign "${SIGNING_IDENTITY}" --options runtime --timestamp 2>/dev/null || true`,
      { shell: true },
    );
    execSync(
      `find "${appBundle}" -type f -name "*.dylib" -print0 | xargs -0 xattr -cr 2>/dev/null || true`,
      { shell: true },
    );
    execSync(
      `find "${appBundle}" -type f -name "*.dylib" -print0 | xargs -0 codesign --force --sign "${SIGNING_IDENTITY}" --options runtime --timestamp 2>/dev/null || true`,
      { shell: true },
    );

    console.log("  Signing executable files...");
    execSync(
      `find "${appBundle}" -type f -perm +111 -print0 | xargs -0 xattr -cr 2>/dev/null || true`,
      { shell: true },
    );
    execSync(
      `find "${appBundle}" -type f -perm +111 -print0 | xargs -0 codesign --force --sign "${SIGNING_IDENTITY}" --options runtime --timestamp 2>/dev/null || true`,
      { shell: true },
    );

    const signFile = (f) => {
      try {
        if (fs.existsSync(f)) {
          execSync(`xattr -cr "${f}" 2>/dev/null || true`, { shell: true });
          execSync(
            `codesign --force --sign "${SIGNING_IDENTITY}" --options runtime --timestamp "${f}"`,
            { stdio: "pipe" },
          );
        }
      } catch {}
    };
    for (const p of [
      `${resourcesDir}/cli-bundle/vendor/ripgrep/arm64-darwin/rg`,
      `${resourcesDir}/cli-bundle/vendor/ripgrep/arm64-darwin/ripgrep.node`,
      `${resourcesDir}/.next/standalone/apps/web/cli-bundle/vendor/ripgrep/arm64-darwin/rg`,
      `${resourcesDir}/.next/standalone/apps/web/cli-bundle/vendor/ripgrep/arm64-darwin/ripgrep.node`,
    ])
      signFile(p);

    console.log("  Nested binaries signed");
  } else {
    console.log("Skipping signing (SKIP_SIGNING=true)");
  }

  console.log("Bundle optimization complete - Tauri structure preserved");
} else {
  console.log("Info.plist not found:", infoPlist);
}

process.chdir(origCwd);
