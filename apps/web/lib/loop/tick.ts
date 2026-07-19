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
import { recordEvent as recordActivationEvent } from "./activation";
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

/**
 * Active user's email — fed into the reference classifier (via
 * `ClassifyOptions.activeUserEmail`) so the self-owned-event gate in
 * `classify.ts` can drop personal all-day entries the user owns but
 * isn't sharing. Today the runtime tick is fully agentic and `classify()`
 * is not invoked from this path, so this setter is GREENFIELD — a
 * follow-up can plumb it from `server.ts::triggerTick` when the runtime
 * starts calling `classify()` directly.
 */
let activeUserEmail: string | null = null;

/** Set the user the next `run()` invocation will enrich against. */
export function setActiveUser(userId: string | null): void {
  activeUserId = userId;
}

/** Read the currently-active user. Useful for diagnostics / logging. */
export function getActiveUser(): string | null {
  return activeUserId;
}

/**
 * Set the active user's email so `classify()` (when invoked) can apply
 * the self-owned-event gate. See `activeUserEmail` note above — this is
 * unconsumed today, plumbed in advance of the runtime wiring the
 * reference classifier.
 */
export function setActiveUserEmail(email: string | null): void {
  activeUserEmail = email;
}

/** Read the currently-active user's email. */
export function getActiveUserEmail(): string | null {
  return activeUserEmail;
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

  // #378 — snapshot pending BEFORE dispatching the agent so
  // `pendingAddedSince(before)` reflects everything the agent (and the
  // post-processors below) actually persisted this tick. Reading the store
  // here also triggers the store's stale-`unknown` migration so a burst of
  // pre-aggregator cards is cleaned up before we count.
  const before = snapshotCounts();

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
  // decision store (decisions.json diff vs. the before-tick snapshot taken
  // at the top of this function) so the caller still gets honest numbers
  // even if the agent's result event was missing or malformed.
  const payload = (res.result ?? {}) as AgentTickResultPayload;
  const scanned = payload.scanned ?? 0;
  const agentSurfaced = payload.surfaced;
  const muted = payload.muted ?? 0;
  const errors = payload.errors ?? 0;
  const surfaces = payload.surfaces_used ?? [];

  // Freshly-added decisions the agent persisted this tick (rejected
  // `unknown`/noop records never landed, so they aren't counted here).
  let newDecisions: LoopDecision[] = pendingAddedSince(before);

  // Deterministic classifier-rules post-processor (see
  // `classifier-rules.ts`). For each freshly-added decision, check whether
  // any registered rule matches its `source_signal`. If a rule matches,
  // the rule's `then` overrides the agent's choice for `type`,
  // `action.kind`, and `confidence` (as a floor). This is the
  // belt-and-suspenders layer that backs the prompt-level hint — even if
  // the LLM drifts on a rule, the server enforces the deterministic
  // routing. A `type: "noop"` rule suppresses the decision entirely
  // (drops it from `pending`), which is `#288`-equivalent behaviour.
  applyClassifierRules(newDecisions);

  // #378 — aggregate passive GitHub notifications into ONE read-only
  // digest. Runs over the recent signal window the tick pulled and the
  // current decision buckets so it can dedupe cross-source, skip keys
  // already covered by a typed decision or a prior digest, and merge new
  // items into an existing pending digest instead of spawning a second
  // summary card. Best-effort: a failure here must not poison the tick.
  try {
    const { signals } = await import("./store");
    const { aggregateGithubNotifications } =
      await import("./github-notifications");
    const sinceIso = new Date(
      Date.now() - (opts.sinceMs ?? TICK_LOOKBACK_MS),
    ).toISOString();
    const recentSignals = signals.list({ since: sinceIso, limit: 500 });
    const allDecisions = decisions.list();
    const agg = aggregateGithubNotifications({
      signals: recentSignals,
      decisions: allDecisions,
    });
    if (agg.kind === "create" && agg.decision) {
      const added = decisions.add(agg.decision);
      if (added) {
        log(
          `tick (agentic): created GitHub notification digest ${added.id} (${agg.newKeys.length} item(s))`,
        );
      }
    } else if (agg.kind === "merge" && agg.decision) {
      decisions.update(agg.decision.id, {
        title: agg.decision.title,
        dialogue: agg.decision.dialogue,
        nextStep: agg.decision.nextStep,
        context: agg.decision.context,
        ts: agg.decision.ts,
      });
      log(
        `tick (agentic): merged ${agg.newKeys.length} item(s) into GitHub notification digest ${agg.decision.id}`,
      );
    }
  } catch (e) {
    log(
      `tick (agentic): GitHub notification aggregation failed: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
  }

  // Derive the surfaced count + returned decisions from ACTUAL persisted
  // pending state (post-aggregation) so rejected `unknown` records are not
  // reported as surfaced and the freshly-created digest is included.
  newDecisions = pendingAddedSince(before);
  const surfaced =
    typeof agentSurfaced === "number"
      ? Math.max(agentSurfaced, newDecisions.length)
      : newDecisions.length;

  // #361 — derive `unsupportedSignals` (#361) so the readiness surface can
  // tell the user "N signals arrived but no decisions were produced
  // because their source/type had no canonical mapping". Prefer the
  // agent's report when present, otherwise infer from the scanned/surfaced
  // delta.
  const agentUnsupported = (payload as Record<string, unknown>)
    .unsupportedSignals;
  const unsupportedSignals =
    typeof agentUnsupported === "number" && agentUnsupported >= 0
      ? Math.floor(agentUnsupported)
      : Math.max(0, scanned - surfaced - muted);

  const result: LoopTickResult = {
    scanned,
    surfaced,
    muted,
    newDecisions,
    errors: errors > 0 ? [`agent reported ${errors} per-signal errors`] : [],
    unsupportedSignals,
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
  // #391 — when the agent's `result` payload carried no `surfaces_used`
  // (the failure mode that made the tick log print the literal `?`),
  // fall back to the connected toolkit IDs from the snapshot the agent
  // just reported. `surfaces_used` is still preferred when present — it
  // carries richer entries (e.g. `insights`, `cli`) than the snapshot.
  const snapshotSurfaces = Array.isArray(payload.connectors)
    ? payload.connectors
        .filter((c) => Boolean(c.connected))
        .map((c) => String(c.id ?? "").trim())
        .filter((id) => id.length > 0)
    : [];
  const loggedSurfaces = surfaces.length > 0 ? surfaces : snapshotSurfaces;
  log(
    `tick (agentic) done: scanned=${result.scanned} surfaced=${result.surfaced} muted=${result.muted} errors=${result.errors.length} surfaces=${loggedSurfaces.join(",") || "?"} dur=${dur}ms`,
  );
  writeStatus({
    lastTickAt: new Date().toISOString(),
    lastSignalCount: result.scanned,
    lastDecisionCount: result.surfaced,
    // #361 — persist the unsupported-signal count so the readiness API
    // can surface it without re-deriving from raw signals.jsonl on every
    // poll.
    unsupportedSignals: result.unsupportedSignals ?? 0,
    ...(result.errors[0] ? { lastError: result.errors[0] } : {}),
  });

  // #351 — flip `firstTickCompleted` so the activation state machine
  // can move from `runtime_ready` / `source_pending` into
  // `check_pending` / `decision_pending`. Best-effort: a failure
  // here must NOT poison the tick result. `coreReady` is forced true
  // because the tick itself only runs when the agent runtime is up;
  // the route layer is the authoritative source for that signal.
  try {
    recordActivationEvent("tick", { coreReady: true });
  } catch (activationErr) {
    log(
      `tick (agentic): failed to record activation event: ${
        activationErr instanceof Error
          ? activationErr.message
          : String(activationErr)
      }`,
    );
  }

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
