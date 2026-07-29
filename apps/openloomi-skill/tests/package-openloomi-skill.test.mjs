import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const testDir = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const packageScript = require(
  resolve(testDir, "../scripts/package-openloomi-skill.cjs"),
);

function readZipEntryNames(zipPath) {
  const buffer = readFileSync(zipPath);
  const names = [];
  let offset = 0;
  while (offset < buffer.length - 4) {
    const signature = buffer.readUInt32LE(offset);
    if (signature !== 0x02014b50) {
      offset += 1;
      continue;
    }
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const nameStart = offset + 46;
    names.push(buffer.subarray(nameStart, nameStart + nameLength).toString());
    offset = nameStart + nameLength + extraLength + commentLength;
  }
  return names.sort();
}

test("package helper lists the exact WorkBuddy upload bundle files", () => {
  assert.deepEqual(
    packageScript.listBundleFiles(resolve(testDir, "../openloomi")),
    packageScript.EXPECTED_BUNDLE_FILES,
  );
});

test("package helper rejects extra files in the upload root", () => {
  assert.throws(
    () => packageScript.assertBundleShape(["SKILL.md", "README.md"]),
    /unexpected files/,
  );
});

test("package helper creates a zip whose root is the skill bundle", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "openloomi-skill-package-"));
  const outPath = join(tempDir, "openloomi-skill.zip");

  try {
    packageScript.createZipArchive({
      rootDir: resolve(testDir, "../openloomi"),
      outPath,
    });

    assert.equal(existsSync(outPath), true);
    assert.deepEqual(readZipEntryNames(outPath), [
      "SKILL.md",
      "agents/openai.yaml",
      "references/examples.md",
      "references/tool-surface.md",
      "scripts/openloomi.cjs",
    ]);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("package helper can override the output path", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "openloomi-skill-args-"));

  try {
    assert.equal(
      packageScript.parseArgs([`--out=${join(tempDir, "bundle.zip")}`]).outPath,
      resolve(tempDir, "bundle.zip"),
    );
    assert.equal(packageScript.parseArgs(["--skip-checks"]).skipChecks, true);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
