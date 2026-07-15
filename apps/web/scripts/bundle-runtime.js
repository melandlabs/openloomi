import { createHash } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import * as tar from "tar";

const require = createRequire(import.meta.url);
const TARGET_DIR = process.argv[2] || "./cli-bundle";
const CACHE_DIR =
  process.env.OPENLOOMI_BUNDLE_CACHE ||
  path.join(os.homedir(), ".cache/openloomi-bundle");
const CACHE_EXPIRE_DAYS = 0;

const sdkEntryPath = require.resolve("@anthropic-ai/claude-agent-sdk");
const sdkPackagePath = path.join(path.dirname(sdkEntryPath), "package.json");
const sdkManifestPath = path.join(path.dirname(sdkEntryPath), "manifest.json");
const sdkPackage = JSON.parse(fs.readFileSync(sdkPackagePath, "utf8"));
const sdkManifest = JSON.parse(fs.readFileSync(sdkManifestPath, "utf8"));
const SDK_VERSION = sdkPackage.version;
const CLAUDE_VERSION = sdkManifest.version;

const rawPlatform = os.platform();
const rawArch = os.arch();
const isMusl =
  rawPlatform === "linux" &&
  typeof process.report?.getReport === "function" &&
  process.report.getReport().header.glibcVersionRuntime === undefined;
const platformKey = `${rawPlatform}-${rawArch}${isMusl ? "-musl" : ""}`;
const platformManifest = sdkManifest.platforms?.[platformKey];

if (!platformManifest) {
  console.error(
    `Unsupported Claude Code runtime platform: ${platformKey}. Supported: ${Object.keys(sdkManifest.platforms ?? {}).join(", ")}`,
  );
  process.exit(1);
}

const packageName = `claude-agent-sdk-${platformKey}`;
const binaryName = platformManifest.binary;
const cacheFile = path.join(
  CACHE_DIR,
  "claude-code",
  `${packageName}-${SDK_VERSION}.tgz`,
);
const archiveFile = path.join(
  os.tmpdir(),
  `${packageName}-${SDK_VERSION}-${process.pid}.tgz`,
);
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "openloomi-bundle-"));

function cleanup() {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(archiveFile, { force: true });
  } catch {}
}
process.on("exit", cleanup);

function checkCacheValid(file) {
  if (!fs.existsSync(file)) return false;
  if (CACHE_EXPIRE_DAYS === 0) return true;
  const ageSeconds = (Date.now() - fs.statSync(file).mtimeMs) / 1000;
  return ageSeconds < CACHE_EXPIRE_DAYS * 86_400;
}

function writeCacheAtomically(source, destination) {
  const temporaryCacheFile = `${destination}.${process.pid}.tmp`;
  try {
    fs.copyFileSync(source, temporaryCacheFile);
    try {
      fs.renameSync(temporaryCacheFile, destination);
    } catch (error) {
      // A concurrent build may have populated the same immutable version.
      if (!fs.existsSync(destination)) throw error;
    }
  } finally {
    fs.rmSync(temporaryCacheFile, { force: true });
  }
}

function downloadFile(url, destination, redirectsRemaining = 5) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith("https") ? https : http;
    const request = protocol.get(url, (response) => {
      const statusCode = response.statusCode ?? 0;
      if (
        statusCode >= 300 &&
        statusCode < 400 &&
        response.headers.location &&
        redirectsRemaining > 0
      ) {
        response.resume();
        downloadFile(
          new URL(response.headers.location, url).toString(),
          destination,
          redirectsRemaining - 1,
        )
          .then(resolve)
          .catch(reject);
        return;
      }
      if (statusCode !== 200) {
        response.resume();
        reject(new Error(`Download failed with HTTP ${statusCode}: ${url}`));
        return;
      }

      const file = fs.createWriteStream(destination, { mode: 0o600 });
      response.pipe(file);
      file.on("finish", () => file.close(resolve));
      file.on("error", reject);
    });
    request.on("error", reject);
  });
}

function hashFile(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = fs.createReadStream(file);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

console.log("========================================");
console.log("  Bundling native Claude Code runtime");
console.log("  for Tauri Distribution (with Cache)");
console.log("========================================");
console.log("");
console.log("SDK version:", SDK_VERSION);
console.log("Claude Code version:", CLAUDE_VERSION);
console.log("Platform:", platformKey);
console.log("Cache directory:", CACHE_DIR);
console.log("");

fs.mkdirSync(TARGET_DIR, { recursive: true });
fs.mkdirSync(path.dirname(cacheFile), { recursive: true });

const archiveFromCache = checkCacheValid(cacheFile);
if (archiveFromCache) {
  console.log("Using cached Claude Code:", cacheFile);
  fs.copyFileSync(cacheFile, archiveFile);
} else {
  const url = `https://registry.npmjs.org/@anthropic-ai/${packageName}/-/${packageName}-${SDK_VERSION}.tgz`;
  console.log("Downloading Claude Code:", url);
  await downloadFile(url, archiveFile);
}

console.log("Extracting native runtime...");
try {
  await tar.extract({ file: archiveFile, cwd: tmpDir });
} catch (error) {
  if (archiveFromCache) fs.rmSync(cacheFile, { force: true });
  throw error;
}

const sourceBinary = path.join(tmpDir, "package", binaryName);
if (!fs.existsSync(sourceBinary)) {
  if (archiveFromCache) fs.rmSync(cacheFile, { force: true });
  console.error(`Claude Code package did not contain ${binaryName}`);
  process.exit(1);
}

for (const legacyName of [
  "cli.js",
  "claude",
  "claude.exe",
  "claude.cmd",
  "claude.sh",
  "node",
  "node.exe",
  "package.json",
  "vendor",
]) {
  fs.rmSync(path.join(TARGET_DIR, legacyName), {
    recursive: true,
    force: true,
  });
}
for (const file of fs.readdirSync(TARGET_DIR)) {
  if (/\.wasm$|\.d\.ts$|bun\.lock$/.test(file)) {
    fs.rmSync(path.join(TARGET_DIR, file), { force: true });
  }
}

const targetBinary = path.join(TARGET_DIR, binaryName);
fs.copyFileSync(sourceBinary, targetBinary);
if (rawPlatform !== "win32") fs.chmodSync(targetBinary, 0o755);

for (const metadataFile of ["package.json", "LICENSE.md", "README.md"]) {
  const source = path.join(tmpDir, "package", metadataFile);
  if (fs.existsSync(source)) {
    fs.copyFileSync(source, path.join(TARGET_DIR, metadataFile));
  }
}

const actualChecksum = await hashFile(targetBinary);
if (actualChecksum !== platformManifest.checksum) {
  if (archiveFromCache) fs.rmSync(cacheFile, { force: true });
  console.error(
    `Claude Code checksum mismatch: expected ${platformManifest.checksum}, received ${actualChecksum}`,
  );
  process.exit(1);
}

if (!archiveFromCache) {
  writeCacheAtomically(archiveFile, cacheFile);
  console.log("Cached verified Claude Code:", cacheFile);
}

const binarySize = fs.statSync(targetBinary).size;
console.log("Claude Code CLI:", targetBinary);
console.log("Size:", formatSize(binarySize));
console.log("SHA-256: verified");
console.log("");
console.log("========================================");
console.log("  Bundle complete! (with Cache)");
console.log("========================================");
console.log("");
console.log("Location:", TARGET_DIR);
console.log("Cache dir:", CACHE_DIR);
