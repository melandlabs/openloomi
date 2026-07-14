/**
 * Loop tick — one pass through the signal → classify → enqueue pipeline.
 *
 * The Loop is fully agentic: builds the prompt in `tick-prompt.ts` and POSTs
 * it to `/api/native/agent`. The agent does the full pipeline — signal pull
 * (composio skill / composio CLI / openloomi-memory insights as parallel
 * surfaces), Obsidian vault scan, memory enrichment, classification, and
 * decision persistence. The loop is the prompt; the agent does the work.
 *
 * Returns a `LoopTickResult` so the caller (cron, CLI, HTTP route) doesn't
 * care which surface the agent ended up using.
 */

import { LOOP_PATHS, ensureDirs, migrate } from "./paths";
import { decisions, log, writeStatus } from "./store";
import { buildTickPrompt } from "./tick-prompt";
import { classifierRules, findMatchingRule } from "./classifier-rules";
import type { LoopDecision, LoopTickResult } from "./types";

const TICK_LOOKBACK_MS = 2 * 60 * 60 * 1000; // 2h
const TICK_BATCH = 200;

/**
 * The Loop runs as a single-user-per-process pipeline. We mirror the
 * scheduler's `setActiveUser` pattern so callers (cron handlers, the web
 * `/api/loop/tick` route, the CLI) can tell the tick which user it should
 * enrich against without threading a `userId` through every layer.
 */
let activeUserId: string | null = null;

/** Set the user the next `run()` invocation will enrich against. */
export function setActiveUser(userId: string | null): void {
  activeUserId = userId;
}

/** Read the currently-active user. Useful for diagnostics / logging. */
export function getActiveUser(): string | null {
  return activeUserId;
}

export interface TickOptions {
  /** Override preferences for this tick only. Defaults to DEFAULT_LOOP_PREFERENCES. */
  preferences?: Partial<LoopPreferencesForPrompt>;
  /** Only process signals newer than this. Defaults to 2h back. */
  sinceMs?: number;
  /** Force re-classify of all recent signals (skips dedupe). */
  force?: boolean;
  /** Optional: callers can pre-supply a list of signals (for tests). */
  inputSignals?: LoopSignalForPrompt[];
  /**
   * Explicit userId for enrichment (contact / project / history lookups).
   * Falls back to the module-level `activeUserId` set via `setActiveUser`
   * (mirrored from scheduler.ts). When neither is set, the agent runs
   * with a no-op user context and decisions land with the base confidence.
   */
  userId?: string;
}

/**
 * Run one tick. Returns a structured result with counts and any decisions
 * that were newly enqueued. Errors per-signal are collected, not thrown.
 */
export async function run(opts: TickOptions = {}): Promise<LoopTickResult> {
  return runAgentic(opts);
}

/* -------------------------------------------------------------------------- */
/* Agentic mode — full-pipeline prompt → /api/native/agent                   */
/* -------------------------------------------------------------------------- */

interface AgentTickResultPayload {
  scanned?: number;
  surfaced?: number;
  muted?: number;
  errors?: number;
  duration_ms?: number;
  surfaces_used?: string[];
  /**
   * Agent-reported snapshot of Composio connection state, captured at
   * tick time via the agent's probe of the active composio surfaces.
   * When present, we persist it to `~/.openloomi/loop/connectors.json`
   * so the UI pill row stays honest between ticks (see
   * `connectors.ts::writeConnectorSnapshot`).
   */
  connectors?: Array<{
    id: string;
    label?: string;
    connected?: boolean;
    accountCount?: number;
    lastError?: string;
  }>;
}

function emptyResult(): LoopTickResult {
  return {
    scanned: 0,
    surfaced: 0,
    muted: 0,
    newDecisions: [],
    errors: [],
  };
}

async function runAgentic(opts: TickOptions): Promise<LoopTickResult> {
  ensureDirs();
  migrate();

  const t0 = Date.now();

  const prompt = buildTickPrompt({
    sinceDays: Math.max(
      1,
      Math.ceil((opts.sinceMs ?? TICK_LOOKBACK_MS) / 86_400_000),
    ),
    // Obsidian vault scan lives in the Chronicle subsystem, not the loop —
    // the watcher already consumes its `obsidian_note_changed` signals from
    // signals.jsonl. The original skill's `obsidian-scan.cjs` reference is
    // therefore omitted from the agentic prompt by default.
    includeObsidian: false,
  });

  // Lazy import — runner transitively pulls node:http + auth-token logic
  // that the CLI doesn't need.
  const { invokeAgentPrompt } = await import("./runner");

  log(
    `tick (agentic): dispatching prompt (${prompt.length} chars) to /api/native/agent`,
  );
  let res: Awaited<ReturnType<typeof invokeAgentPrompt>>;
  try {
    res = await invokeAgentPrompt(prompt, {
      timeoutMs: 15 * 60 * 1000,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log(`tick (agentic) failed: ${msg}`);
    writeStatus({
      lastTickAt: new Date().toISOString(),
      lastError: `agentic tick failed: ${msg}`,
    });
    return {
      ...emptyResult(),
      errors: [msg],
    };
  }

  if (!res.ok) {
    const msg = res.error ?? `HTTP ${res.status ?? "?"}`;
    log(`tick (agentic) native-agent error: ${msg}`);
    writeStatus({
      lastTickAt: new Date().toISOString(),
      lastError: `agentic tick: ${msg}`,
    });
    return {
      ...emptyResult(),
      errors: [msg],
    };
  }

  // The agent emits a structured `result` event at the end of the prompt;
  // pull counts from there when present. Fall back to re-reading the
  // decision store (decisions.json diff vs. before-tick snapshot) so the
  // caller still gets honest numbers even if the agent's result event
  // was missing or malformed.
  const before = snapshotCounts();
  const payload = (res.result ?? {}) as AgentTickResultPayload;
  const scanned = payload.scanned ?? 0;
  const agentSurfaced = payload.surfaced;
  const muted = payload.muted ?? 0;
  const errors = payload.errors ?? 0;
  const surfaces = payload.surfaces_used ?? [];

  let surfaced: number;
  let newDecisions: LoopDecision[] = [];
  if (typeof agentSurfaced !== "number") {
    // Re-derive from disk.
    const after = snapshotCounts();
    surfaced = Math.max(0, after.pending - before.pending);
    newDecisions = pendingAddedSince(before);
  } else {
    surfaced = agentSurfaced;
    // Even when the agent reports the count, surface the freshly-added
    // decisions so the caller can return them.
    newDecisions = pendingAddedSince(before);
  }

  // Deterministic classifier-rules post-processor (see
  // `classifier-rules.ts`). For each freshly-added decision, check whether
  // any registered rule matches its `source_signal`. If a rule matches,
  // the rule's `then` overrides the agent's choice for `type`,
  // `action.kind`, and `confidence` (as a floor). This is the
  // belt-and-suspenders layer that backs the prompt-level hint — even if
  // the LLM drifts on a rule, the server enforces the deterministic
  // routing. A `type: "noop"` rule suppresses the decision entirely
  // (drops it from `pending`), which is `#288`-equivalent behaviour.
  const overridesApplied = applyClassifierRules(newDecisions);

  const result: LoopTickResult = {
    scanned,
    surfaced,
    muted,
    newDecisions,
    errors: errors > 0 ? [`agent reported ${errors} per-signal errors`] : [],
  };

  // If the agent's result event carried a `connectors` snapshot, persist it
  // so the UI pill row (`/api/loop/connectors`) reflects the agent's
  // probed reality. Best-effort — failure here must not poison the
  // tick result.
  if (Array.isArray(payload.connectors) && payload.connectors.length > 0) {
    try {
      const { writeConnectorSnapshot } = await import("./connectors");
      const stamp = new Date().toISOString();
      writeConnectorSnapshot(
        payload.connectors.map((c) => ({
          id: String(c.id ?? "unknown"),
          label:
            typeof c.label === "string" ? c.label : String(c.id ?? "unknown"),
          connected: Boolean(c.connected),
          accountCount: Number(c.accountCount ?? 0),
          ...(c.lastError ? { lastError: String(c.lastError) } : {}),
          // `probed: true` — the agent probe at tick time produced
          // these, even for toolkits it reported as disconnected. The
          // UI distinguishes "probe says offline" (render: red
          // `Offline`) from "haven't asked yet" (render: neutral
          // `Pending first probe`). Without this, every tick-written
          // cache would land as "unknown" in the UI.
          probed: true,
          fetchedAt: stamp,
        })),
      );
      log(
        `tick (agentic): persisted ${payload.connectors.length} connector snapshot entries`,
      );
    } catch (e) {
      log(
        `tick (agentic): failed to persist connector snapshot: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
  }

  const dur = Date.now() - t0;
  log(
    `tick (agentic) done: scanned=${result.scanned} surfaced=${result.surfaced} muted=${result.muted} errors=${result.errors.length} surfaces=${surfaces.join(",") || "?"} dur=${dur}ms`,
  );
  writeStatus({
    lastTickAt: new Date().toISOString(),
    lastSignalCount: result.scanned,
    lastDecisionCount: result.surfaced,
    ...(result.errors[0] ? { lastError: result.errors[0] } : {}),
  });
  return result;
}

interface CountsSnapshot {
  pending: number;
  done: number;
  dismissed: number;
  pendingIds: Set<string>;
}

function snapshotCounts(): CountsSnapshot {
  const pending = decisions.list("pending");
  return {
    pending: pending.length,
    done: decisions.list("done").length,
    dismissed: decisions.list("dismissed").length,
    pendingIds: new Set(pending.map((d) => d.id)),
  };
}

function pendingAddedSince(before: CountsSnapshot): LoopDecision[] {
  const after = decisions.list("pending");
  return after.filter((d) => !before.pendingIds.has(d.id));
}

/**
 * Apply user-defined classifier rules to a batch of newly-persisted
 * decisions. Mutates `decisions.json` via `decisions.update()` /
 * `decisions.moveTo()` (for `noop` suppression). Returns a small
 * summary that the caller may log.
 *
 * Rules are evaluated in registration order; the first match wins.
 * `type: "noop"` moves the decision from `pending` → `dismissed` so it
 * never reaches the pet bubble or any external watch loop's
 * notification fan-out. Other `type` overrides keep the decision in
 * `pending` with the new routing.
 */
function applyClassifierRules(decs: LoopDecision[]): {
  overridden: number;
  suppressed: number;
} {
  const rules = classifierRules.list();
  if (rules.length === 0 || decs.length === 0) {
    return { overridden: 0, suppressed: 0 };
  }
  let overridden = 0;
  let suppressed = 0;
  for (const dec of decs) {
    const src = dec.source_signal;
    if (!src || typeof src !== "object") continue;
    const match = findMatchingRule(src, rules);
    if (!match) continue;
    if (match.then.type === "noop") {
      // Suppress entirely. We treat it like a dismiss with provenance
      // pointing at the rule so an admin can audit later.
      decisions.moveTo(dec.id, "dismissed", { suppressedByRule: match.id });
      suppressed++;
      log(
        `[tick.classifierRules] suppressed decision=${dec.id} by rule=${match.id}`,
      );
      continue;
    }
    // Build the patch. Confidence is a FLOOR — the agent's value wins
    // if it's higher. action.kind is overwritten when the rule sets it.
    const floorConf =
      typeof match.then.confidence === "number" ? match.then.confidence : null;
    const nextConfidence =
      floorConf === null
        ? dec.confidence
        : typeof dec.confidence === "number"
          ? Math.max(dec.confidence, floorConf)
          : floorConf;
    const nextAction =
      match.then.actionKind !== undefined
        ? { ...dec.action, kind: match.then.actionKind }
        : dec.action;
    const patch: Partial<LoopDecision> = {
      type: match.then.type as LoopDecision["type"],
      action: nextAction,
      ...(nextConfidence !== undefined ? { confidence: nextConfidence } : {}),
    };
    decisions.update(dec.id, patch);
    overridden++;
    log(
      `[tick.classifierRules] overrode decision=${dec.id} type=${dec.type}→${match.then.type} rule=${match.id} conf=${nextConfidence}`,
    );
  }
  return { overridden, suppressed };
}

export { LOOP_PATHS };

// Local type aliases — kept narrow so this file's imports don't drag in
// the full preferences / signal types when only a subset is referenced.
type LoopPreferencesForPrompt = import("./types").LoopPreferences;
type LoopSignalForPrompt = import("./types").LoopSignal;
