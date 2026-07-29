#!/usr/bin/env node
"use strict";

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "../../..");
const skillDir = path.resolve(repoRoot, "apps/openloomi-skill/openloomi");
const distDir = path.resolve(repoRoot, "apps/openloomi-skill/dist");
const defaultZipPath = path.resolve(distDir, "openloomi-skill.zip");

const EXPECTED_BUNDLE_FILES = [
  "SKILL.md",
  "agents/openai.yaml",
  "references/examples.md",
  "references/tool-surface.md",
  "scripts/openloomi.cjs",
];

const PRETTIER_FILES = [
  "apps/openloomi-skill/README.md",
  "apps/openloomi-skill/openloomi/SKILL.md",
  "apps/openloomi-skill/openloomi/agents/openai.yaml",
  "apps/openloomi-skill/openloomi/references/tool-surface.md",
  "apps/openloomi-skill/openloomi/references/examples.md",
  "apps/openloomi-skill/openloomi/scripts/openloomi.cjs",
  "apps/openloomi-skill/tests/openloomi-script.test.mjs",
  "apps/openloomi-skill/tests/bundle-structure.test.mjs",
  "apps/openloomi-skill/tests/package-openloomi-skill.test.mjs",
  "apps/openloomi-skill/scripts/package-openloomi-skill.cjs",
];

let crcTable;

function makeCrcTable() {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[i] = value >>> 0;
  }
  return table;
}

function crc32(buffer) {
  crcTable ||= makeCrcTable();
  let value = 0xffffffff;
  for (const byte of buffer) {
    value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  const year = Math.max(date.getFullYear(), 1980);
  const dosTime =
    (date.getHours() << 11) |
    (date.getMinutes() << 5) |
    Math.floor(date.getSeconds() / 2);
  const dosDate =
    ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { dosDate, dosTime };
}

function listFilesRecursive(rootDir, dir = rootDir) {
  const files = [];
  for (const entry of fs.readdirSync(dir)) {
    const fullPath = path.resolve(dir, entry);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      files.push(...listFilesRecursive(rootDir, fullPath));
      continue;
    }
    if (stat.isFile()) {
      files.push(path.relative(rootDir, fullPath).split(path.sep).join("/"));
    }
  }
  return files.sort();
}

function listBundleFiles(rootDir = skillDir) {
  return listFilesRecursive(rootDir);
}

function assertBundleShape(files) {
  const expected = [...EXPECTED_BUNDLE_FILES].sort();
  const actual = [...files].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      [
        "OpenLoomi skill bundle contains unexpected files.",
        `Expected: ${expected.join(", ")}`,
        `Actual: ${actual.join(", ")}`,
      ].join("\n"),
    );
  }
}

function writeUInt16(value) {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value, 0);
  return buffer;
}

function writeUInt32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value >>> 0, 0);
  return buffer;
}

function createZipBuffer(rootDir, files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const file of files) {
    const fullPath = path.resolve(rootDir, file);
    const data = fs.readFileSync(fullPath);
    const name = Buffer.from(file, "utf8");
    const stat = fs.statSync(fullPath);
    const { dosDate, dosTime } = dosDateTime(stat.mtime);
    const checksum = crc32(data);

    const localHeader = Buffer.concat([
      writeUInt32(0x04034b50),
      writeUInt16(20),
      writeUInt16(0),
      writeUInt16(0),
      writeUInt16(dosTime),
      writeUInt16(dosDate),
      writeUInt32(checksum),
      writeUInt32(data.length),
      writeUInt32(data.length),
      writeUInt16(name.length),
      writeUInt16(0),
      name,
    ]);
    localParts.push(localHeader, data);

    const centralHeader = Buffer.concat([
      writeUInt32(0x02014b50),
      writeUInt16(20),
      writeUInt16(20),
      writeUInt16(0),
      writeUInt16(0),
      writeUInt16(dosTime),
      writeUInt16(dosDate),
      writeUInt32(checksum),
      writeUInt32(data.length),
      writeUInt32(data.length),
      writeUInt16(name.length),
      writeUInt16(0),
      writeUInt16(0),
      writeUInt16(0),
      writeUInt16(0),
      writeUInt32(0),
      writeUInt32(offset),
      name,
    ]);
    centralParts.push(centralHeader);
    offset += localHeader.length + data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const endRecord = Buffer.concat([
    writeUInt32(0x06054b50),
    writeUInt16(0),
    writeUInt16(0),
    writeUInt16(files.length),
    writeUInt16(files.length),
    writeUInt32(centralDirectory.length),
    writeUInt32(offset),
    writeUInt16(0),
  ]);

  return Buffer.concat([...localParts, centralDirectory, endRecord]);
}

function createZipArchive(options = {}) {
  const rootDir = path.resolve(options.rootDir || skillDir);
  const outPath = path.resolve(options.outPath || defaultZipPath);
  const files = listBundleFiles(rootDir);
  assertBundleShape(files);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, createZipBuffer(rootDir, files));
  return { outPath, files };
}

function runStep(label, command, args, options = {}) {
  process.stdout.write(`\n> ${label}\n`);
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env: { ...process.env, PYTHONUTF8: "1", ...options.env },
    shell: process.platform === "win32",
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`${label} failed with exit code ${result.status}`);
  }
}

function parseArgs(argv) {
  const options = {
    outPath: defaultZipPath,
    skipChecks: false,
  };
  for (const arg of argv) {
    if (arg === "--skip-checks") {
      options.skipChecks = true;
      continue;
    }
    if (arg.startsWith("--out=")) {
      options.outPath = path.resolve(repoRoot, arg.slice("--out=".length));
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function runChecks() {
  runStep("Validate skill metadata", "python", [
    "skills/skill-creator/scripts/quick_validate.py",
    "apps/openloomi-skill/openloomi",
  ]);
  runStep("Run bundle structure tests", "node", [
    "--test",
    "apps/openloomi-skill/tests/bundle-structure.test.mjs",
  ]);
  runStep("Run wrapper tests", "node", [
    "--test",
    "apps/openloomi-skill/tests/openloomi-script.test.mjs",
  ]);
  runStep("Run package helper tests", "node", [
    "--test",
    "apps/openloomi-skill/tests/package-openloomi-skill.test.mjs",
  ]);
  runStep("Check formatting", "pnpm", [
    "exec",
    "prettier",
    "--check",
    ...PRETTIER_FILES,
  ]);
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (!options.skipChecks) {
    runChecks();
  }
  const { outPath, files } = createZipArchive({ outPath: options.outPath });
  process.stdout.write(
    [
      "",
      "OpenLoomi WorkBuddy skill bundle is ready.",
      `Zip: ${outPath}`,
      "Zip root entries:",
      ...files.map((file) => `- ${file}`),
      "",
      "Upload this zip to WorkBuddy Skills, then run:",
      "Use $openloomi to check my local OpenLoomi status and list connected accounts.",
      "",
    ].join("\n"),
  );
  return { outPath, files };
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`\n${error.message || error}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  EXPECTED_BUNDLE_FILES,
  assertBundleShape,
  createZipArchive,
  createZipBuffer,
  listBundleFiles,
  main,
  parseArgs,
};
