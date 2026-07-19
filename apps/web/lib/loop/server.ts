/**
 * Loop server handlers — pure functions returning JSON payloads. Each handler
 * takes an optional auth context (the pet / CLI may call without one) and
 * returns a typed result. The Next.js route handlers in app/api/loop/*
 * thinly wrap these so we can also unit-test them outside the Next runtime.
 */

import {
  buildAndEnqueue as buildBrief,
  build as buildBriefOnly,
} from "./brief";
import {
  listConnectors,
  refreshConnectors,
  getLastProbeError,
} from "./connectors";
import type { ProbeErrorInfo } from "./connectors";
import { summarizeConnectorCapability } from "./connectors-pure";
import { decisions, log, readStatus, signals } from "./store";
import { readPreferences, writePreferences } from "./preferences";
import {
  dismissDecision,
  promoteDecision,
  resurrectDecision,
  runDecision,
  runDecisionWithRsvpResponse,
} from "./runner";
import { run as runTick, setActiveUser as setTickActiveUser } from "./tick";
import { buildAndEnqueue as buildWrap, build as buildWrapOnly } from "./wrap";
import { recordEvent as recordActivationEvent } from "./activation";
import { deriveReadiness, deriveRelationship } from "./readiness";
import type {
  DecisionReadiness,
  DecisionRelationship,
  DecisionStatus,
  LoopDecision,
  LoopDecisionExecution,
  LoopPreferences,
  LoopState,
  LoopTickResult,
} from "./types";

/** GET /api/loop/state — aggregated dashboard payload. */
export async function state(): Promise<LoopState> {
  const counts = decisions.count();
  const status = readStatus();
  const prefs = readPreferences();
  const connectors = await listConnectors();
  const unsupportedSignals = readUnsupportedSignalCount();
  return {
    enabled: prefs.enabled,
    preferences: prefs,
    counts: {
      pending: counts.pending,
      done: counts.done,
      dismissed: counts.dismissed,
      signals: signals.count(),
      unsupportedSignals,
    },
    connectors,
    connectorCapability: summarizeConnectorCapability(connectors),
    ...(status.lastTickAt ? { lastTickAt: status.lastTickAt } : {}),
  };
}

// ---------------------------------------------------------------------------
// #361 — unsupported-signal counter
// ---------------------------------------------------------------------------
//
// We surface the count of signals whose `source` / `type` had no canonical
// Loop mapping at the last tick. The counter is persisted into the loop
// status file (`status.json`) by the tick handler so a slow or stale UI
// poll doesn't re-derive from raw signals.jsonl every request. Falls back
// to a zero when no tick has run yet — surfacing "0 unsupported" is the
// honest answer for a fresh install.
function readUnsupportedSignalCount(): number {
  try {
    const s = readStatus() as Record<string, unknown>;
    const raw = s.unsupportedSignals;
    return typeof raw === "number" && Number.isFinite(raw) && raw >= 0
      ? Math.floor(raw)
      : 0;
  } catch {
    return 0;
  }
}

/** GET /api/loop/decisions?status=pending|done|dismissed */
export function listDecisions(status?: DecisionStatus): LoopDecision[] {
  return decisions.list(status ?? null);
}

/** GET /api/loop/decision/[id] */
export function getDecision(id: string): LoopDecision | null {
  return decisions.get(id);
}

/** GET /api/loop/card/[id] — flattened card shape for the pet / web UI. */
export interface LoopCardPayload extends LoopDecision {
  source_chain: string[];
  why: string[];
  dialogue: string;
  nextStep: string;
  /**
   * #359 — resolved decision semantics. `readiness` gates execution and is
   * always present (derived from the action when the stored decision omits
   * it). `relationship` is optional colour and is only set when there is
   * evidence for it.
   */
  readiness: DecisionReadiness;
  relationship?: DecisionRelationship;
}

export function getCard(id: string): LoopCardPayload | null {
  const dec = decisions.get(id);
  if (!dec) return null;
  const why = (dec.context?.why as string[] | undefined) ?? [];
  const sourceChain = dec.source_signal
    ? [dec.source_signal.source, dec.source_signal.type, dec.source_signal.ts]
    : [];
  const readiness = deriveReadiness(dec);
  const relationship = deriveRelationship(dec);
  return {
    ...dec,
    why,
    source_chain: sourceChain,
    dialogue: dec.dialogue ?? defaultDialogue(dec),
    nextStep: dec.nextStep ?? defaultNextStep(dec),
    readiness,
    ...(relationship ? { relationship } : {}),
  };
}

function defaultDialogue(dec: LoopDecision): string {
  switch (dec.type) {
    case "rsvp":
      // #363 — server-side English fallback for the i18n key the web UI
      // also renders. Keeping the literal here (rather than reading from
      // the i18n bundle at request time) avoids pulling the i18n init
      // graph into the Next.js server runtime; the web-side `loop.rsvp.*`
      // keys cover every locale the user can pick.
      return serverI18n("loop.dialogue.rsvp");
    case "email_reply":
      return serverI18n("loop.dialogue.draftReply");
    case "review_pr":
      return "A PR tagged you as reviewer — take a look?";
    case "im_reply":
      return "Someone messaged you — want me to draft a reply?";
    case "deadline_reminder": {
      const p = (dec.action?.params ?? {}) as {
        deadlineAt?: string;
        message?: string;
      };
      const when = p.deadlineAt
        ? new Date(p.deadlineAt).toLocaleString("en-US", {
            weekday: "long",
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          })
        : "soon";
      const quote = p.message ? ` ("${p.message.slice(0, 80)}…") ` : " ";
      return `This has a ${when} deadline${quote}— want me to add a calendar reminder?`;
    }
    default:
      return `New decision (${dec.type}): ${dec.title}`;
  }
}

/**
 * Tiny server-side i18n lookup — a flat key → English-string table for the
 * dialogue lines `defaultDialogue` produces. Mirrors the `loop.dialogue.*`
 * keys in `apps/web/i18n/locales/en-US.ts` so the two stay in lock-step.
 * Kept private to this module so accidental divergence surfaces as a
 * missing key here rather than a silent language swap at request time.
 */
function serverI18n(key: string): string {
  switch (key) {
    case "loop.dialogue.rsvp":
      return "This calendar invite needs your call.";
    case "loop.dialogue.draftReply":
      return "This email looks like it's waiting on you — should I draft a reply?";
    default:
      return key;
  }
}

function defaultNextStep(dec: LoopDecision): string {
  return `Tap Run to let the agent handle this ${dec.type}.`;
}

/** POST /api/loop/decision/[id] with { action: 'run' | 'dry' | 'dismiss' | 'promote' | 'resurrect' | 'rsvp_attend' | 'rsvp_decline' } */
export interface DecisionActionInput {
  // #363 — `rsvp_attend` / `rsvp_decline` pre-set `action.params.response`
  // on the underlying decision and route through `runDecision` so the agent
  // emits a structured verdict (#358). Both refuse on non-RSVP / non-pending
  // decisions; rsvp_attend additionally refuses on `not_actionable` so a
  // self-owned event with no guests can never trigger an external write.
  action:
    | "run"
    | "dry"
    | "dismiss"
    | "promote"
    | "resurrect"
    | "rsvp_attend"
    | "rsvp_decline";
  reason?: string;
}

export async function applyDecisionAction(
  id: string,
  input: DecisionActionInput,
): Promise<{
  ok: boolean;
  status: DecisionStatus | "pending";
  decision: LoopDecision | null;
  result?: unknown;
  error?: string;
  /**
   * #358 — structured execution verdict from the runner. Surfaced to the
   * web UI so the card can render the actual outcome without re-reading
   * the decision. Absent for dismiss/promote/resurrect because they don't
   * execute anything.
   */
  execution?: LoopDecisionExecution;
}> {
  let out: {
    ok: boolean;
    status: DecisionStatus | "pending";
    decision: LoopDecision | null;
    result?: unknown;
    error?: string;
    execution?: LoopDecisionExecution;
  };
  switch (input.action) {
    case "run": {
      const r = await runDecision(id);
      out = {
        ok: r.ok,
        status: r.status,
        decision: r.decision,
        ...(r.result !== undefined ? { result: r.result } : {}),
        ...(r.error ? { error: r.error } : {}),
        ...(r.execution ? { execution: r.execution } : {}),
      };
      break;
    }
    case "dry": {
      const r = await runDecision(id, { dry: true });
      out = {
        ok: r.ok,
        status: r.status,
        decision: r.decision,
        ...(r.result !== undefined ? { result: r.result } : {}),
        ...(r.error ? { error: r.error } : {}),
        ...(r.execution ? { execution: r.execution } : {}),
      };
      break;
    }
    case "dismiss": {
      const r = await dismissDecision(id, input.reason);
      out = {
        ok: r.ok,
        status: r.status,
        decision: r.decision,
        ...(r.error ? { error: r.error } : {}),
      };
      break;
    }
    case "promote": {
      const r = await promoteDecision(id);
      out = {
        ok: r.ok,
        status: r.status,
        decision: r.decision,
        ...(r.error ? { error: r.error } : {}),
      };
      break;
    }
    case "resurrect": {
      const r = await resurrectDecision(id);
      out = {
        ok: r.ok,
        status: r.status,
        decision: r.decision,
        ...(r.error ? { error: r.error } : {}),
      };
      break;
    }
    // #363 — RSVP-specific actions. The runner pre-sets
    // `action.params.response` to the user's intent and then delegates to
    // `runDecision`, so the agent still owns the external write and the
    // existing #358 verdict pipeline handles status transitions.
    case "rsvp_attend": {
      const r = await runDecisionWithRsvpResponse(id, "accepted");
      out = {
        ok: r.ok,
        status: r.status,
        decision: r.decision,
        ...(r.result !== undefined ? { result: r.result } : {}),
        ...(r.error ? { error: r.error } : {}),
        ...(r.execution ? { execution: r.execution } : {}),
      };
      break;
    }
    case "rsvp_decline": {
      const r = await runDecisionWithRsvpResponse(id, "declined");
      out = {
        ok: r.ok,
        status: r.status,
        decision: r.decision,
        ...(r.result !== undefined ? { result: r.result } : {}),
        ...(r.error ? { error: r.error } : {}),
        ...(r.execution ? { execution: r.execution } : {}),
      };
      break;
    }
    default:
      return {
        ok: false,
        status: "pending",
        decision: null,
        error: `unknown action ${String(input.action)}`,
      };
  }

  // #351 — flip `firstDecisionSeen` whenever a decision lands in a
  // terminal bucket (`done` or `dismissed`). `dry` keeps it in
  // pending so we don't count a "Dry run" tap as a review; `promote`
  // pushes it back into pending which would otherwise flip the
  // user back into `decision_pending`. Only act on the *forward*
  // edge into a terminal bucket.
  if (out.ok && (out.status === "done" || out.status === "dismissed")) {
    try {
      recordActivationEvent("decision_seen", { coreReady: true });
    } catch (activationErr) {
      log(
        `applyDecisionAction: failed to record activation event: ${
          activationErr instanceof Error
            ? activationErr.message
            : String(activationErr)
        }`,
      );
    }
  }

  return out;
}

/** GET /api/loop/connectors */
export interface ConnectorsResult {
  items: LoopState["connectors"];
  /** #391 — present when the most recent probe failed. */
  lastProbeError: ProbeErrorInfo | null;
}

export async function connectors(
  opts: { refresh?: boolean } = {},
): Promise<ConnectorsResult> {
  const items = opts.refresh
    ? await refreshConnectors()
    : await listConnectors();
  return { items, lastProbeError: getLastProbeError() };
}

/** POST /api/loop/brief */
export interface BriefActionResult {
  ok: boolean;
  stats: { scanned: number; surfaced: number; muted: number };
  items: unknown[];
  card: LoopDecision | null;
  error?: string;
}

export async function triggerBrief(
  opts: { force?: boolean } = {},
): Promise<BriefActionResult> {
  try {
    const { card, snapshot } = await buildBrief({
      force: opts.force ?? true,
    });
    return {
      ok: true,
      stats: snapshot.stats,
      items: snapshot.items,
      card,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log(`brief action failed: ${msg}`);
    // Defensive fallback: `buildBriefOnly` should never throw (its I/O
    // is wrapped in try/catch), but if it does the route handler would
    // surface a 500 with no body. Catch here and return a degraded
    // `{ ok: false }` payload instead so the UI can at least toast the
    // error message.
    let snapshot: ReturnType<typeof buildBriefOnly> | undefined;
    try {
      snapshot = buildBriefOnly({ force: opts.force ?? true });
    } catch (fallbackErr) {
      const fallbackMsg =
        fallbackErr instanceof Error
          ? fallbackErr.message
          : String(fallbackErr);
      log(`brief fallback also failed: ${fallbackMsg}`);
      return {
        ok: false,
        stats: { scanned: 0, surfaced: 0, muted: 0 },
        items: [],
        card: null,
        error: `${msg} (fallback: ${fallbackMsg})`,
      };
    }
    return {
      ok: false,
      stats: snapshot.stats,
      items: snapshot.items,
      card: null,
      error: msg,
    };
  }
}

/** POST /api/loop/wrap */
export async function triggerWrap(
  opts: { force?: boolean } = {},
): Promise<BriefActionResult> {
  try {
    const { card, snapshot } = await buildWrap({
      force: opts.force ?? true,
    });
    return {
      ok: true,
      stats: {
        scanned: snapshot.highlights.length,
        surfaced: snapshot.stats.done,
        muted: snapshot.stats.dismissed,
      },
      items: snapshot.highlights,
      card,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log(`wrap action failed: ${msg}`);
    // Same defensive fallback pattern as `triggerBrief`: wrap
    // `buildWrapOnly` in try/catch so a failure here can't bubble out
    // of the route handler as a 500.
    let snapshot: Awaited<ReturnType<typeof buildWrapOnly>> | undefined;
    try {
      snapshot = await buildWrapOnly({ force: opts.force ?? true });
    } catch (fallbackErr) {
      const fallbackMsg =
        fallbackErr instanceof Error
          ? fallbackErr.message
          : String(fallbackErr);
      log(`wrap fallback also failed: ${fallbackMsg}`);
      return {
        ok: false,
        stats: { scanned: 0, surfaced: 0, muted: 0 },
        items: [],
        card: null,
        error: `${msg} (fallback: ${fallbackMsg})`,
      };
    }
    return {
      ok: false,
      stats: {
        scanned: snapshot.highlights.length,
        surfaced: snapshot.stats.done,
        muted: snapshot.stats.dismissed,
      },
      items: snapshot.highlights,
      card: null,
      error: msg,
    };
  }
}

/** POST /api/loop/tick */
export async function triggerTick(
  opts: { userId?: string } = {},
): Promise<LoopTickResult> {
  // The web /api/loop/tick route always passes the session userId. CLI and
  // tests may not — in that case we just run without enrich (graceful
  // degradation, decisions still land with base confidence).
  if (opts.userId) setTickActiveUser(opts.userId);
  return runTick({ userId: opts.userId });
}

/** GET /api/loop/preferences | PUT same path */
export function getPreferences(): LoopPreferences {
  return readPreferences();
}

/**
 * Persist preferences without touching the cron rows. Use this only when
 * the caller doesn't have an authenticated user (CLI, /api/loop/doctor).
 */
export function setPreferences(
  patch: Partial<LoopPreferences>,
): LoopPreferences {
  // Forward the write through the preferences helper — the in-memory merge
  // in the previous version didn't actually persist to disk, so re-aim here.
  return writePreferences(patch);
}

/**
 * Persist preferences AND sync the three loop ScheduledJob rows for the
 * authenticated user. The route handler should prefer this so the cron
 * schedule on disk tracks the latest prefs without needing a stop/start.
 */
export async function setPreferencesForUser(
  patch: Partial<LoopPreferences>,
  userId: string,
): Promise<LoopPreferences> {
  const { writePreferences } = await import("./preferences");
  const next = writePreferences(patch);
  try {
    const { ensureLoopJobs } = await import("./scheduler");
    await ensureLoopJobs(next, userId);
  } catch (e) {
    // Don't fail the PUT if the cron row sync blows up — the user can
    // still toggle Loop from a fresh boot or settings save.
    console.warn("[loop] ensureLoopJobs after prefs PUT failed:", e);
  }
  return next;
}
