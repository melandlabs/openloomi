import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import https from "node:https";
import http from "node:http";
import { execSync } from "node:child_process";
import * as tar from "tar";

const TARGET_DIR = process.argv[2] || "./cli-bundle";
const CACHE_DIR =
  process.env.openloomi_BUNDLE_CACHE ||
  path.join(os.homedir(), ".cache/openloomi-bundle");
const CACHE_EXPIRE_DAYS = 0;
const CLAUDE_VERSION = "2.1.71";

const arch = os.arch();
const rawPlatform = os.platform();
const isAarch64 = arch === "arm64";
const isDarwin = rawPlatform === "darwin";
const isLinux = rawPlatform === "linux";
const isWindows = rawPlatform === "win32";

const platform = isDarwin
  ? "darwin"
  : isLinux
    ? "linux"
    : isWindows
      ? "windows"
      : "unknown";

const ARCH_SUFFIX = isAarch64 ? "aarch64" : "x86_64";

console.log("========================================");
console.log("  Bundling Claude Code + Node.js");
console.log("  for Tauri Distribution (with Cache)");
console.log("========================================");
console.log("");
console.log("Platform:", platform);
console.log("Architecture:", ARCH_SUFFIX);
console.log("Cache directory:", CACHE_DIR);
console.log("");

fs.mkdirSync(TARGET_DIR, { recursive: true });
fs.mkdirSync(`${CACHE_DIR}/claude-code`, { recursive: true });

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "openloomi-bundle-"));

function cleanup() {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
}
process.on("exit", cleanup);

const CLAUDE_CACHE_FILE = `${CACHE_DIR}/claude-code/claude-code-${CLAUDE_VERSION}.tgz`;

function checkCacheValid(file) {
  if (!fs.existsSync(file)) return false;
  if (CACHE_EXPIRE_DAYS === 0) return true;
  const mtime = fs.statSync(file).mtime;
  const age = (Date.now() - mtime.getTime()) / 1000;
  return age < CACHE_EXPIRE_DAYS * 86400;
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const protocol = url.startsWith("https") ? https : http;
    protocol
      .get(url, (response) => {
        if (response.statusCode === 301 || response.statusCode === 302) {
          file.close();
          downloadFile(response.headers.location, dest)
            .then(resolve)
            .catch(reject);
          return;
        }
        response.pipe(file);
        file.on("finish", () => {
          file.close();
          resolve();
        });
      })
      .on("error", (err) => {
        fs.unlink(dest, () => {});
        reject(err);
      });
  });
}

console.log("[1/3] Processing Claude Code...");
console.log("  Version:", CLAUDE_VERSION);

if (checkCacheValid(CLAUDE_CACHE_FILE)) {
  console.log("  Using cached Claude Code:", CLAUDE_CACHE_FILE);
  fs.copyFileSync(CLAUDE_CACHE_FILE, `${tmpDir}/claude-code.tgz`);
} else {
  console.log("  Downloading Claude Code (no valid cache)...");
  const url = `https://registry.npmjs.org/@anthropic-ai/claude-code/-/claude-code-${CLAUDE_VERSION}.tgz`;
  try {
    execSync(`curl -sL "${url}" -o "${tmpDir}/claude-code.tgz"`, {
      stdio: "pipe",
    });
  } catch {
    console.log("  Downloading via Node.js fallback...");
    await downloadFile(url, `${tmpDir}/claude-code.tgz`);
  }
  console.log("  Saving to cache:", CLAUDE_CACHE_FILE);
  fs.copyFileSync(`${tmpDir}/claude-code.tgz`, CLAUDE_CACHE_FILE);
}

console.log("  Extracting...");
await tar.extract({ file: `${tmpDir}/claude-code.tgz`, cwd: tmpDir });

const rm = (p) => {
  try {
    fs.rmSync(p, { recursive: true, force: true });
  } catch {}
};
rm(`${TARGET_DIR}/cli.js`);
rm(`${TARGET_DIR}/package.json`);
rm(`${TARGET_DIR}/vendor`);

for (const f of fs.readdirSync(TARGET_DIR)) {
  if (/\.wasm$|\.d\.ts$|bun\.lock$/.test(f)) {
    try {
      fs.unlinkSync(`${TARGET_DIR}/${f}`);
    } catch {}
  }
}

fs.copyFileSync(`${tmpDir}/package/cli.js`, `${TARGET_DIR}/cli.js`);
fs.copyFileSync(`${tmpDir}/package/package.json`, `${TARGET_DIR}/package.json`);

const copyDirRec = (src, dest) => {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const item of fs.readdirSync(src)) {
    const s = path.join(src, item);
    const d = path.join(dest, item);
    fs.statSync(s).isDirectory() ? copyDirRec(s, d) : fs.copyFileSync(s, d);
  }
};
copyDirRec(`${tmpDir}/package/vendor`, `${TARGET_DIR}/vendor`);

for (const item of fs.readdirSync(`${tmpDir}/package`)) {
  if (/\.wasm$|\.d\.ts$|bun\.lock$/.test(item)) {
    try {
      fs.copyFileSync(`${tmpDir}/package/${item}`, `${TARGET_DIR}/${item}`);
    } catch {}
  }
}

console.log("  Done");

console.log("");
console.log("[Cleanup] Removing unnecessary platform files from vendor...");
if (fs.existsSync(`${TARGET_DIR}/vendor/ripgrep`)) {
  const ripgrepDir = `${TARGET_DIR}/vendor/ripgrep`;
  let keepDir = "";
  if (platform === "darwin")
    keepDir = isAarch64 ? "arm64-darwin" : "x64-darwin";
  else if (platform === "linux")
    keepDir = isAarch64 ? "arm64-linux" : "x64-linux";
  else if (platform === "windows") keepDir = "x64-win32";

  if (keepDir) {
    console.log("  Keeping platform:", keepDir);
    for (const item of fs.readdirSync(ripgrepDir)) {
      if (item !== keepDir && item !== "COPYING") {
        console.log("  Removing:", item);
        rm(`${ripgrepDir}/${item}`);
      }
    }
    console.log("  Vendor cleanup complete");
  }
}

console.log("");
console.log("[2/3] Using system Node.js (not bundled)...");
console.log("  Skipping Node.js bundle - will use system Node.js at runtime");

console.log("");
console.log("[3/3] Verifying bundle...");

if (fs.existsSync(`${TARGET_DIR}/cli.js`)) {
  const stat = fs.statSync(`${TARGET_DIR}/cli.js`);
  const size =
    stat.size < 1024
      ? `${stat.size} B`
      : stat.size < 1024 * 1024
        ? `${(stat.size / 1024).toFixed(1)} KB`
        : `${(stat.size / (1024 * 1024)).toFixed(1)} MB`;
  console.log("  Claude Code CLI:", size);
} else {
  console.error("Error: cli.js not found!");
  process.exit(1);
}

console.log("  Node.js: (using system Node.js)");

if (fs.existsSync(`${TARGET_DIR}/vendor`)) {
  let count = 0;
  const countFiles = (dir) => {
    for (const item of fs.readdirSync(dir)) {
      const p = path.join(dir, item);
      fs.statSync(p).isDirectory() ? countFiles(p) : count++;
    }
  };
  countFiles(`${TARGET_DIR}/vendor`);
  console.log("  Vendor files:", count);
} else {
  console.error("Error: vendor directory not found!");
  process.exit(1);
}

console.log("");
console.log("========================================");
console.log("  Bundle complete! (with Cache)");
console.log("========================================");
console.log("");
console.log("Location:", TARGET_DIR);
console.log("Cache dir:", CACHE_DIR);
