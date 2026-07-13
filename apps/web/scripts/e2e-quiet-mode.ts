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
import { decisions, mutes, MUTABLE_DECISION_TYPES } from "../lib/loop/store";
import { recordMuteOnDismiss } from "../lib/loop/runner";
import {
  runQuietDayModule,
  QUIET_DAY_MODULES,
} from "../lib/loop/quiet-modules";
import type { QuietDayFillerId } from "../lib/loop/types";

const LOOP_HOME = join(homedir(), ".openloomi", "loop");
const DECISIONS = join(LOOP_HOME, "decisions.json");
const BRIEF = join(LOOP_HOME, "brief.json");
const WRAP = join(LOOP_HOME, "wrap.json");
const LOG = join(LOOP_HOME, "loop.log");
const CONFIG = join(LOOP_HOME, "config.json");
const MUTES = join(LOOP_HOME, "mutes.json");

// ---- Snapshot state for restore on exit ----
const backups: Record<string, string | null> = {};
for (const p of [DECISIONS, BRIEF, WRAP, LOG, CONFIG, MUTES]) {
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
  writeFileSync(
    DECISIONS,
    JSON.stringify({ pending: [], done: [], dismissed: [] }, null, 2),
  );
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
    !!(r.snapshot.date && r.snapshot.date.length === 10),
    `snapshot.date looks like YYYY-MM-DD (${r.snapshot.date})`,
  );
  expect(existsSync(BRIEF), "brief.json persisted to disk");
  expect(
    after.pending === before.pending,
    "decisions.json pending count unchanged",
  );
  expect(
    logTail(50).includes(
      "[loop.brief] empty brief — quietWhenEmpty=true, skipping card",
    ),
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
  expect(
    after.pending === before.pending + 1,
    "pending count incremented by 1",
  );
  expect(
    !!(
      r.card?.dialogue?.includes("queue is clear") ||
      r.card?.dialogue?.includes("Nothing")
    ),
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
  const moduleRan = logText.includes(
    `[loop.brief] empty brief — running module ${module}`,
  );
  const moduleReturnedNull = logText.includes(
    `[loop.brief] empty brief — module ${module} returned no decision, skipping card`,
  );
  const moduleCardEnqueued = logText.includes(
    "[loop.brief] digest card enqueued",
  );
  console.log(
    `  log: ran=${moduleRan} null=${moduleReturnedNull} card=${moduleCardEnqueued}`,
  );

  if (r.card) {
    expect(r.card.type === "quiet_digest", "card.type === 'quiet_digest'");
    expect(
      Array.isArray(r.card.context?.items) &&
        (r.card.context?.items as unknown[]).length > 0,
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
  expect(
    after.pending === before.pending,
    "decisions.json pending count unchanged",
  );
  expect(
    logTail(50).includes(
      "[loop.wrap] empty wrap — quietWhenEmpty=true, skipping card",
    ),
    "log line '[loop.wrap] empty wrap — quietWhenEmpty=true, skipping card' present",
  );
}

async function caseG() {
  console.log("\n=== Case G: runQuietDayModule total-function contract ===");
  // G1: 'none' short-circuits to null without invoking the agent.
  const noneResult = await runQuietDayModule("none", {
    kind: "brief",
    date: "2026-07-13",
    prefs: readPreferences(),
  });
  expect(
    noneResult === null,
    "runQuietDayModule('none') returns null (short-circuit)",
  );

  // G2: unknown id returns null + logs "unknown module id".
  const unknownResult = await runQuietDayModule(
    "does-not-exist" as QuietDayFillerId,
    {
      kind: "brief",
      date: "2026-07-13",
      prefs: readPreferences(),
    },
  );
  expect(unknownResult === null, "runQuietDayModule(unknown) returns null");
  expect(
    logTail(40).includes("[loop.quiet] unknown module id: does-not-exist"),
    "log line '[loop.quiet] unknown module id: does-not-exist' present",
  );

  // G3: every filler id declared in the preferences API is registered.
  for (const id of [
    "ai-news-digest",
    "weather-calendar",
    "memory-resurface",
  ] as const) {
    expect(
      Object.prototype.hasOwnProperty.call(QUIET_DAY_MODULES, id),
      `QUIET_DAY_MODULES has '${id}' registered`,
    );
  }
}

async function caseH() {
  console.log(
    "\n=== Case H: MUTABLE_DECISION_TYPES contains 'quiet_digest' ===",
  );
  // A digest the user dismisses must not auto-resurface on the next
  // tick (#316). The store enforces this via MUTABLE_DECISION_TYPES.
  expect(
    MUTABLE_DECISION_TYPES.has("quiet_digest"),
    "MUTABLE_DECISION_TYPES.has('quiet_digest') === true",
  );
  // And for sanity: brief/wrap must stay excluded (they are scheduled).
  expect(
    !MUTABLE_DECISION_TYPES.has("brief"),
    "MUTABLE_DECISION_TYPES excludes 'brief' (scheduled)",
  );
  expect(
    !MUTABLE_DECISION_TYPES.has("wrap"),
    "MUTABLE_DECISION_TYPES excludes 'wrap' (scheduled)",
  );
}

async function caseI() {
  console.log("\n=== Case I: dismiss(quiet_digest) records a mute ===");
  // Manually enqueue a quiet_digest with a synthetic email-style
  // source_signal (muteKeyFor returns a stable `from` key for emails,
  // which makes the round-trip easy to verify). The address includes
  // a per-run nonce so leftover state from prior runs cannot pollute
  // this case.
  const runNonce = Date.now().toString(36);
  const muteKey = `e2e-quiet-mode-${runNonce}@example.com`;
  clearDecisions();
  const dec = decisions.add({
    type: "quiet_digest",
    title: "Test digest",
    action: { kind: "quiet_digest", params: { module: "ai-news-digest" } },
    dialogue: "headline",
    nextStep: "Tap.",
    context: { why: ["synthetic"], memory_refs: [], items: [] },
    source_signal: {
      id: `sig_${runNonce}`,
      ts: new Date().toISOString(),
      source: "e2e-quiet-mode",
      type: "email",
      payload: { from: muteKey },
    },
  });
  expect(dec !== null, "decisions.add accepted the quiet_digest");
  if (!dec) return;

  // Mute must not exist yet (nothing has been dismissed).
  expect(!mutes.has(muteKey), `no mute for '${muteKey}' before dismiss`);

  // Move to dismissed + persist the mute via the shared helper.
  decisions.moveTo(dec.id, "dismissed", "user-dismissed");
  recordMuteOnDismiss(dec.id);
  expect(
    mutes.has(muteKey),
    `mute recorded for '${muteKey}' after dismiss + recordMuteOnDismiss`,
  );

  // Idempotency: re-dismissing the same id should NOT duplicate the mute
  // (the existing rule is returned unchanged by mutes.add).
  recordMuteOnDismiss(dec.id);
  expect(mutes.has(muteKey), "mute still present (re-dismiss is a no-op)");
}

async function caseJ() {
  console.log("\n=== Case J: preferences defaults + persistence ===");
  // J1: writePreferences must accept every filler id listed in the API
  // validation table (round-trip through the JSON file).
  for (const id of [
    "none",
    "ai-news-digest",
    "weather-calendar",
    "memory-resurface",
  ] as const) {
    writePreferences({
      quietDayFiller: id,
      narrative: false,
    } as Partial<ReturnType<typeof readPreferences>>);
    const back = readPreferences().quietDayFiller;
    expect(back === id, `quietDayFiller='${id}' round-trips (got: ${back})`);
  }

  // J2: writePreferences must accept both boolean shapes for quietWhenEmpty.
  for (const v of [true, false]) {
    writePreferences({
      quietWhenEmpty: v,
      quietDayFiller: "none",
    } as Partial<ReturnType<typeof readPreferences>>);
    expect(
      readPreferences().quietWhenEmpty === v,
      `quietWhenEmpty=${String(v)} round-trips`,
    );
  }
}

async function caseK() {
  console.log(
    "\n=== Case K: brief.ts enriches the snapshot with quiet_digest ===",
  );
  // We can't exercise the real module path (no agent endpoint), but we
  // CAN verify the *enrichment contract* directly: feed a stub decision
  // through runQuietDayModule with a custom in-place module registered
  // in the registry. We use a temporary registry swap so we don't have
  // to modify any production code.
  //
  // (runQuietDayModule reads QUIET_DAY_MODULES at call time, so a
  //  write to the registry is enough — the registry object is shared.)
  const original = QUIET_DAY_MODULES["ai-news-digest"];
  const stubDecision = {
    id: "quiet_brief_test-stub",
    ts: "2026-07-13T00:00:00.000Z",
    status: "pending" as const,
    type: "quiet_digest" as const,
    title: "Morning digest · 2026-07-13",
    action: {
      kind: "quiet_digest" as const,
      params: { module: "ai-news-digest" },
    },
    dialogue: "Stub headline",
    nextStep: "Tap to read the 2 stories.",
    context: {
      why: [
        "Quiet brief on 2026-07-13",
        "Filler: 2 last-24h AI / tech headlines",
      ],
      memory_refs: [],
      items: [
        {
          title: "Story A",
          summary: "First summary.",
          url: "https://example.com/a",
        },
        { title: "Story B", summary: "Second summary." },
      ],
    },
    confidence: 0.75,
  };
  QUIET_DAY_MODULES["ai-news-digest"] = {
    id: "ai-news-digest",
    label: "Stub",
    isAvailable: async () => true,
    buildDecision: async () => stubDecision,
  };

  try {
    writePreferences({
      quietWhenEmpty: true,
      quietDayFiller: "ai-news-digest",
      narrative: false,
    } as Partial<ReturnType<typeof readPreferences>>);
    clearDecisions();
    const before = readCount();
    const r = await enqueueBrief({ force: true });
    const after = readCount();

    console.log(`  pending before=${before.pending} after=${after.pending}`);
    console.log(`  card: ${r.card ? `${r.card.type}#${r.card.id}` : "null"}`);

    expect(r.card !== null, "stub module produced a non-null card");
    expect(r.card?.type === "quiet_digest", "card.type === 'quiet_digest'");
    expect(
      Array.isArray(r.card?.context?.items) &&
        (r.card?.context?.items as unknown[]).length === 2,
      "context.items[] has 2 bullets",
    );
    expect(after.pending === before.pending + 1, "pending incremented by 1");

    // Snapshot enrichment: brief.json on disk should carry the digest.
    const onDisk = existsSync(BRIEF)
      ? (JSON.parse(readFileSync(BRIEF, "utf8")) as Record<string, unknown>)
      : null;
    const stashed =
      onDisk && (onDisk as { quiet_digest?: unknown }).quiet_digest;
    expect(
      stashed !== undefined &&
        (stashed as { id?: string }).id === stubDecision.id,
      `brief.json.quiet_digest stashed (id=${(stashed as { id?: string } | undefined)?.id})`,
    );

    // And the run-time log line.
    expect(
      logTail(60).includes(
        `[loop.brief] digest card enqueued ${stubDecision.id} (module=ai-news-digest)`,
      ),
      "log line '[loop.brief] digest card enqueued ...' present",
    );
  } finally {
    // Always restore the real module — even on assertion failure.
    QUIET_DAY_MODULES["ai-news-digest"] = original;
  }
}

async function main() {
  console.log("Issue #316 e2e: quiet mode + content modules");
  console.log("Loop home:", LOOP_HOME);

  // Ensure loop home exists so the writes don't fail.
  if (!existsSync(LOOP_HOME)) {
    throw new Error(
      `loop home not found at ${LOOP_HOME} — has the loop ever run?`,
    );
  }

  await caseA();
  await caseB();
  await runModuleCase("C", "ai-news-digest");
  await runModuleCase("D", "weather-calendar");
  await runModuleCase("E", "memory-resurface");
  await caseF();
  await caseG();
  await caseH();
  await caseI();
  await caseJ();
  await caseK();

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
