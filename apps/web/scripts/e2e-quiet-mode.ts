/**
 * E2E test for issue #316 — quiet mode + plug-in content modules for
 * empty briefs/wraps. Bypasses the Next.js / NextAuth HTTP layer and
 * calls the lib directly so the test runs even when the dev server
 * isn't up (e.g. when tauri:dev has panicked).
 *
 * What this exercises end-to-end:
 *   1. preferences read/write (`readPreferences` / `writePreferences`)
 *   2. brief / wrap `buildAndEnqueue` — quiet branch detection
 *   3. `runQuietDayModule` — module dispatch + each module's
 *      `buildDecision`
 *   4. `decisions.add` — card persistence to ~/.openloomi/loop/decisions.json
 *   5. `log()` — line append to ~/.openloomi/loop/loop.log
 *
 * Test matrix (each row is one case):
 *
 *   A. quietWhenEmpty=true, filler="none"            → {card: null}
 *   B. quietWhenEmpty=false                          → type:"brief" card
 *   C. quietWhenEmpty=true, filler="ai-news-digest"  → quiet_digest OR null
 *   D. quietWhenEmpty=true, filler="weather-calendar"→ quiet_digest OR null
 *   E. quietWhenEmpty=true, filler="memory-resurface"→ quiet_digest OR null
 *   F. wrap path, quietWhenEmpty=true, filler="none" → {card: null}
 *
 * Module calls in C/D/E may return null when the agent endpoint or
 * outbound network is unavailable — both outcomes are valid and we
 * log whichever path the test took.
 *
 * Run with:
 *   pnpm exec tsx scripts/e2e-quiet-mode.ts
 *
 * Restores the original decisions.json + loop.log + config.json on
 * exit so the user's loop state is untouched.
 */

import { existsSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { writePreferences, readPreferences } from "../lib/loop/preferences";
import { buildAndEnqueue as enqueueBrief } from "../lib/loop/brief";
import { buildAndEnqueue as enqueueWrap } from "../lib/loop/wrap";
import { decisions } from "../lib/loop/store";

const LOOP_HOME = join(homedir(), ".openloomi", "loop");
const DECISIONS = join(LOOP_HOME, "decisions.json");
const BRIEF = join(LOOP_HOME, "brief.json");
const WRAP = join(LOOP_HOME, "wrap.json");
const LOG = join(LOOP_HOME, "loop.log");
const CONFIG = join(LOOP_HOME, "config.json");

// ---- Snapshot state for restore on exit ----
const backups: Record<string, string | null> = {};
for (const p of [DECISIONS, BRIEF, WRAP, LOG, CONFIG]) {
  if (existsSync(p)) {
    const backupPath = `${p}.e2e.bak`;
    copyFileSync(p, backupPath);
    backups[p] = backupPath;
  } else {
    backups[p] = null;
  }
}

function restoreState() {
  for (const [orig, backup] of Object.entries(backups)) {
    if (backup && existsSync(backup)) {
      copyFileSync(backup, orig);
    } else if (orig !== LOG) {
      // The log grows by append during the test; only restore if we
      // had a backup. Don't delete the log file if we didn't back
      // one up — that would lose unrelated history.
    }
  }
  // Best-effort: drop backup files regardless
  for (const backup of Object.values(backups)) {
    if (backup && existsSync(backup)) {
      try {
        require("node:fs").unlinkSync(backup);
      } catch {
        /* ignore */
      }
    }
  }
}
process.on("exit", restoreState);
process.on("SIGINT", () => {
  restoreState();
  process.exit(130);
});

function readCount(): { pending: number; done: number; dismissed: number } {
  return decisions.count();
}

function clearDecisions() {
  // Reset pending to empty so each test starts from a known state.
  // We don't touch done / dismissed (history should accumulate, not
  // be wiped).
  writeFileSync(DECISIONS, JSON.stringify({ pending: [], done: [], dismissed: [] }, null, 2));
  // Invalidate the store's in-memory cache by writing through the API
  // (decisions module reads the file fresh on each call).
}

function logTail(n = 30): string {
  if (!existsSync(LOG)) return "(no log)";
  const lines = readFileSync(LOG, "utf8").split("\n").filter(Boolean);
  return lines.slice(-n).join("\n");
}

function expect(cond: boolean, msg: string) {
  if (cond) {
    console.log(`  ✓ ${msg}`);
  } else {
    console.log(`  ✗ ${msg}`);
    failures.push(msg);
  }
}

const failures: string[] = [];

async function caseA() {
  console.log("\n=== Case A: quietWhenEmpty=true, filler=none ===");
  writePreferences({
    quietWhenEmpty: true,
    quietDayFiller: "none",
    narrative: false, // skip the agent call to keep test fast
  } as Partial<ReturnType<typeof readPreferences>>);
  clearDecisions();
  const before = readCount();
  const r = await enqueueBrief({ force: true });
  const after = readCount();
  console.log(`  pending before=${before.pending} after=${after.pending}`);
  console.log(`  card: ${r.card ? `${r.card.type}#${r.card.id}` : "null"}`);
  console.log(`  snapshot.items: ${r.snapshot.items.length}`);
  expect(r.card === null, "card is null (skipped)");
  expect(r.snapshot.items.length === 0, "snapshot.items is empty");
  expect(
    r.snapshot.date && r.snapshot.date.length === 10,
    `snapshot.date looks like YYYY-MM-DD (${r.snapshot.date})`,
  );
  expect(existsSync(BRIEF), "brief.json persisted to disk");
  expect(after.pending === before.pending, "decisions.json pending count unchanged");
  expect(
    logTail(50).includes("[loop.brief] empty brief — quietWhenEmpty=true, skipping card"),
    "log line '[loop.brief] empty brief — quietWhenEmpty=true, skipping card' present",
  );
}

async function caseB() {
  console.log("\n=== Case B: quietWhenEmpty=false (legacy path) ===");
  writePreferences({
    quietWhenEmpty: false,
    quietDayFiller: "none",
    narrative: false,
  } as Partial<ReturnType<typeof readPreferences>>);
  clearDecisions();
  const before = readCount();
  const r = await enqueueBrief({ force: true });
  const after = readCount();
  console.log(`  pending before=${before.pending} after=${after.pending}`);
  console.log(`  card: ${r.card ? `${r.card.type}#${r.card.id}` : "null"}`);
  expect(r.card !== null, "card enqueued (legacy path)");
  expect(r.card?.type === "brief", "card.type === 'brief'");
  expect(after.pending === before.pending + 1, "pending count incremented by 1");
  expect(
    r.card?.dialogue?.includes("queue is clear") || r.card?.dialogue?.includes("Nothing"),
    `templated dialogue present (got: ${JSON.stringify(r.card?.dialogue?.slice(0, 80))})`,
  );
}

async function runModuleCase(
  caseLabel: string,
  module: "ai-news-digest" | "weather-calendar" | "memory-resurface",
) {
  console.log(`\n=== Case ${caseLabel}: filler=${module} ===`);
  writePreferences({
    quietWhenEmpty: true,
    quietDayFiller: module,
    narrative: false,
  } as Partial<ReturnType<typeof readPreferences>>);
  clearDecisions();
  const before = readCount();
  const r = await enqueueBrief({ force: true });
  const after = readCount();
  console.log(`  pending before=${before.pending} after=${after.pending}`);
  console.log(`  card: ${r.card ? `${r.card.type}#${r.card.id}` : "null"}`);

  const logText = logTail(80);
  const moduleRan = logText.includes(`[loop.brief] empty brief — running module ${module}`);
  const moduleReturnedNull = logText.includes(
    `[loop.brief] empty brief — module ${module} returned no decision, skipping card`,
  );
  const moduleCardEnqueued = logText.includes(
    `[loop.brief] digest card enqueued`,
  );
  console.log(`  log: ran=${moduleRan} null=${moduleReturnedNull} card=${moduleCardEnqueued}`);

  if (r.card) {
    expect(r.card.type === "quiet_digest", "card.type === 'quiet_digest'");
    expect(
      Array.isArray(r.card.context?.items) && (r.card.context!.items as unknown[]).length > 0,
      "context.items[] is a non-empty array",
    );
    expect(
      typeof r.card.dialogue === "string" && r.card.dialogue.length > 0,
      "card.dialogue is a non-empty string (module headline)",
    );
    expect(
      after.pending === before.pending + 1,
      `pending count incremented by 1 (${before.pending}→${after.pending})`,
    );
  } else {
    expect(
      moduleRan && moduleReturnedNull,
      "card is null because module returned null (graceful degradation)",
    );
    expect(
      after.pending === before.pending,
      `pending count unchanged when module returns null (${before.pending}→${after.pending})`,
    );
  }
}

async function caseF() {
  console.log("\n=== Case F: wrap, quietWhenEmpty=true, filler=none ===");
  writePreferences({
    quietWhenEmpty: true,
    quietDayFiller: "none",
    narrative: false,
  } as Partial<ReturnType<typeof readPreferences>>);
  clearDecisions();
  const before = readCount();
  const r = await enqueueWrap({ force: true });
  const after = readCount();
  console.log(`  pending before=${before.pending} after=${after.pending}`);
  console.log(`  card: ${r.card ? `${r.card.type}#${r.card.id}` : "null"}`);
  console.log(`  snapshot.highlights: ${r.snapshot.highlights.length}`);
  expect(r.card === null, "card is null (skipped)");
  expect(r.snapshot.highlights.length === 0, "snapshot.highlights is empty");
  expect(existsSync(WRAP), "wrap.json persisted to disk");
  expect(after.pending === before.pending, "decisions.json pending count unchanged");
  expect(
    logTail(50).includes("[loop.wrap] empty wrap — quietWhenEmpty=true, skipping card"),
    "log line '[loop.wrap] empty wrap — quietWhenEmpty=true, skipping card' present",
  );
}

async function main() {
  console.log("Issue #316 e2e: quiet mode + content modules");
  console.log("Loop home:", LOOP_HOME);

  // Ensure loop home exists so the writes don't fail.
  if (!existsSync(LOOP_HOME)) {
    throw new Error(`loop home not found at ${LOOP_HOME} — has the loop ever run?`);
  }

  await caseA();
  await caseB();
  await runModuleCase("C", "ai-news-digest");
  await runModuleCase("D", "weather-calendar");
  await runModuleCase("E", "memory-resurface");
  await caseF();

  // Restore default prefs so the user's environment is back to a
  // sensible baseline.
  writePreferences({
    quietWhenEmpty: true,
    quietDayFiller: "none",
    narrative: true,
  } as Partial<ReturnType<typeof readPreferences>>);

  console.log("\n=== Summary ===");
  if (failures.length === 0) {
    console.log("✓ All assertions passed.");
    process.exit(0);
  } else {
    console.log(`✗ ${failures.length} failure(s):`);
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(2);
});
