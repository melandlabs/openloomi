/**
 * Loop tick — one pass through the signal → enrich → classify → enqueue
 * pipeline.
 *
 * Reads the recent signals buffer, runs each through:
 *   1. hard-skip filters (configurable via preferences)
 *   2. classifier → typed decision candidate
 *   3. memory enrichment (best-effort, see note below)
 *   4. enqueue via decisions.add()
 *
 * Memory enrichment: full openloomi-memory lookups (sender / project) are
 * performed by the AGENT when it later "runs" a decision. The tick itself
 * only attaches a minimal `context.why` blob referencing the source signal.
 * This keeps the tick fast and avoids a hard dependency on the memory
 * subsystem during the loop's hot path.
 *
 * Idempotency: every signal already in `signals.jsonl` is processed once.
 * Use `signals.list({ since })` to re-classify on demand (the dedupe is
 * driven by `signal.id` on the stored decision — duplicates collapse).
 */

import { classify, isHardSkipped } from "./classify";
import { LOOP_PATHS, ensureDirs, migrate } from "./paths";
import { decisions, log, signals, writeStatus } from "./store";
import type {
  LoopDecision,
  LoopPreferences,
  LoopSignal,
  LoopTickResult,
} from "./types";
import { DEFAULT_LOOP_PREFERENCES } from "./types";

const TICK_LOOKBACK_MS = 2 * 60 * 60 * 1000; // 2h
const TICK_BATCH = 200;

function nowMs(): number {
  return Date.now();
}

function sinceIso(ms: number): string {
  return new Date(nowMs() - ms).toISOString();
}

function dedupeKey(sig: LoopSignal): string {
  const p = sig.payload as Record<string, unknown>;
  return String(
    p.messageId ??
      p.eventId ??
      p.ts ??
      p.id ??
      p.path ??
      `${sig.source}:${sig.type}`,
  );
}

function alreadyProcessed(key: string): boolean {
  // O(N) scan — fine for the few-hundred pending decisions scale.
  for (const bucket of ["pending", "done", "dismissed"] as const) {
    for (const dec of decisions.list(bucket)) {
      if (dec.signal_id === key) return true;
      if ((dec.source_signal as { id?: string } | undefined)?.id === key)
        return true;
    }
  }
  return false;
}

export interface TickOptions {
  /** Override preferences for this tick only. Defaults to DEFAULT_LOOP_PREFERENCES. */
  preferences?: Partial<LoopPreferences>;
  /** Only process signals newer than this. Defaults to 2h back. */
  sinceMs?: number;
  /** Force re-classify of all recent signals (skips dedupe). */
  force?: boolean;
  /** Optional: callers can pre-supply a list of signals (for tests). */
  inputSignals?: LoopSignal[];
}

/**
 * Run one tick. Returns a structured result with counts and any decisions
 * that were newly enqueued. Errors per-signal are collected, not thrown.
 */
export function run(opts: TickOptions = {}): LoopTickResult {
  ensureDirs();
  // Lazy migrate on first tick so legacy data shows up before any decision
  // is enqueued. Safe to call repeatedly — no-op after the first run.
  migrate();

  const prefs: LoopPreferences = {
    ...DEFAULT_LOOP_PREFERENCES,
    ...(opts.preferences ?? {}),
  };

  let recent: LoopSignal[];
  if (opts.inputSignals) {
    recent = opts.inputSignals;
  } else {
    recent = signals.list({
      since: sinceIso(opts.sinceMs ?? TICK_LOOKBACK_MS),
      limit: TICK_BATCH,
    });
  }

  const result: LoopTickResult = {
    scanned: 0,
    surfaced: 0,
    muted: 0,
    newDecisions: [],
    errors: [],
  };

  for (const sig of recent) {
    result.scanned += 1;
    try {
      const skip = isHardSkipped(sig, prefs);
      if (skip) {
        result.muted += 1;
        continue;
      }
      const key = dedupeKey(sig);
      if (!opts.force && alreadyProcessed(key)) {
        // Already surfaced — count as muted so the stats are honest.
        result.muted += 1;
        continue;
      }
      const candidate = classify(sig);
      if (!candidate) {
        result.muted += 1;
        continue;
      }
      const dec: LoopDecision = decisions.add({
        signal_id: sig.id,
        type: candidate.type,
        title: candidate.title,
        action: candidate.action,
        context: {
          why: [`Source: ${sig.source}:${sig.type}`],
          memory_refs: [],
        },
        confidence: 0.6,
        source_signal: sig,
        dialogue: candidateDialogue(sig, candidate.type),
        nextStep: candidateNextStep(candidate.type),
      });
      result.newDecisions.push(dec);
      result.surfaced += 1;
      log(`tick: ${sig.source}:${sig.type} → ${dec.id} (${dec.type})`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      result.errors.push(`${sig.id}: ${msg}`);
      log(`tick error: ${sig.id}: ${msg}`);
    }
  }

  writeStatus({
    lastTickAt: new Date().toISOString(),
    lastSignalCount: result.scanned,
    lastDecisionCount: result.surfaced,
    ...(result.errors[0] ? { lastError: result.errors[0] } : {}),
  });
  log(
    `tick done: scanned=${result.scanned} surfaced=${result.surfaced} muted=${result.muted} errors=${result.errors.length}`,
  );
  return result;
}

function candidateDialogue(sig: LoopSignal, type: string): string {
  switch (type) {
    case "rsvp":
      return "This calendar invite needs a call — want me to reply 'accepted' directly?";
    case "draft_reply":
      return "This email looks like it's waiting on you — should I draft a reply?";
    case "review_pr":
      return "A PR tagged you as reviewer — take a look?";
    case "slack_reply":
      return "Someone @-mentioned you on Slack — want me to grab context first?";
    case "todo":
      return "Drop this into your todo list?";
    case "linear_review":
      return "Linear has an issue waiting for your scope check.";
    case "requirement_synthesis":
      return "This signal could become a new product-requirements draft.";
    default:
      return `New signal (${sig.source}): ${sig.type}`;
  }
}

function candidateNextStep(type: string): string {
  switch (type) {
    case "rsvp":
      return "Tap Dry Run to see the plan, or Run to accept the invite directly.";
    case "draft_reply":
      return "Tap Dry Run to draft a reply, then confirm to send.";
    case "review_pr":
      return "Tap Run to have the agent produce a review checklist.";
    case "slack_reply":
      return "Tap Dry Run to draft a reply, then confirm to send.";
    case "todo":
      return "Tap Run to add it to today's todo.";
    case "linear_review":
      return "Tap Run to have the agent do a scope check.";
    case "requirement_synthesis":
      return "Tap Run to draft a PR / FAQ.";
    default:
      return "Tap Run to let the agent handle it.";
  }
}

export { LOOP_PATHS };
