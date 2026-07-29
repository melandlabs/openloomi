import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const testDir = dirname(fileURLToPath(import.meta.url));
const skillDir = resolve(testDir, "../openloomi");
const docsDir = resolve(testDir, "..");

function listFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = resolve(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      files.push(...listFiles(fullPath));
    } else if (stat.isFile()) {
      files.push(relative(skillDir, fullPath).split(sep).join("/"));
    }
  }
  return files.sort();
}

function readSkillFile(path) {
  return readFileSync(resolve(skillDir, path), "utf8");
}

function readDocsFile(path) {
  return readFileSync(resolve(docsDir, path), "utf8");
}

test("WorkBuddy upload bundle has the required root skill files", () => {
  const files = listFiles(skillDir);

  assert.deepEqual(files, [
    "SKILL.md",
    "agents/openai.yaml",
    "references/examples.md",
    "references/tool-surface.md",
    "scripts/openloomi.cjs",
  ]);
});

test("WorkBuddy packaging docs keep development files outside the upload root", () => {
  const readme = readDocsFile("README.md");
  const files = listFiles(skillDir);

  assert.match(
    readme,
    /node apps\\openloomi-skill\\scripts\\package-openloomi-skill\.cjs/,
  );
  assert.match(readme, /apps\/openloomi-skill\/dist\/openloomi-skill\.zip/);
  assert.match(
    readme,
    /Upload the `apps\/openloomi-skill\/openloomi\/` folder/,
  );
  assert.match(
    readme,
    /Compress-Archive -Path apps\\openloomi-skill\\openloomi\\\*/,
  );
  assert.match(readme, /Do not include `apps\/openloomi-skill\/tests\/`/);
  assert.equal(
    files.some((file) => file === "README.md" || file.startsWith("tests/")),
    false,
  );
});

test("SKILL.md exposes a valid OpenLoomi skill trigger", () => {
  const skillMd = readSkillFile("SKILL.md");

  assert.match(skillMd, /^---\n/m);
  assert.match(skillMd, /^name: openloomi$/m);
  assert.match(skillMd, /^description: .+OpenLoomi.+WorkBuddy.+$/m);
  assert.doesNotMatch(skillMd, /TODO|NOT_IMPLEMENTED|pending/i);
});

test("agents/openai.yaml contains UI metadata and explicit skill invocation", () => {
  const openaiYaml = readSkillFile("agents/openai.yaml");

  assert.match(openaiYaml, /^interface:\r?\n/m);
  assert.match(openaiYaml, /display_name: "OpenLoomi"/);
  assert.match(
    openaiYaml,
    /short_description: "Use local OpenLoomi from WorkBuddy"/,
  );
  assert.match(openaiYaml, /default_prompt: "Use \$openloomi /);
});
