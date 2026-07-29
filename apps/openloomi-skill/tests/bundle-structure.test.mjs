import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const testDir = dirname(fileURLToPath(import.meta.url));
const skillDir = resolve(testDir, "../openloomi");

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
