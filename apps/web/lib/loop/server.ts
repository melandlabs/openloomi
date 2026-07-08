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
import { listConnectors, refreshConnectors } from "./connectors";
import { decisions, log, readStatus, signals } from "./store";
import { readPreferences, writePreferences } from "./preferences";
import { dismissDecision, promoteDecision, runDecision } from "./runner";
import { run as runTick, setActiveUser as setTickActiveUser } from "./tick";
import { buildAndEnqueue as buildWrap, build as buildWrapOnly } from "./wrap";
import type {
  DecisionStatus,
  LoopDecision,
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
  return {
    enabled: prefs.enabled,
    preferences: prefs,
    counts: {
      pending: counts.pending,
      done: counts.done,
      dismissed: counts.dismissed,
      signals: signals.count(),
    },
    connectors,
    ...(status.lastTickAt ? { lastTickAt: status.lastTickAt } : {}),
  };
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
}

export function getCard(id: string): LoopCardPayload | null {
  const dec = decisions.get(id);
  if (!dec) return null;
  const why = (dec.context?.why as string[] | undefined) ?? [];
  const sourceChain = dec.source_signal
    ? [dec.source_signal.source, dec.source_signal.type, dec.source_signal.ts]
    : [];
  return {
    ...dec,
    why,
    source_chain: sourceChain,
    dialogue: dec.dialogue ?? defaultDialogue(dec),
    nextStep: dec.nextStep ?? defaultNextStep(dec),
  };
}

function defaultDialogue(dec: LoopDecision): string {
  switch (dec.type) {
    case "rsvp":
      return "This calendar invite needs a call — want me to reply 'accepted' directly?";
    case "draft_reply":
      return "This email looks like it's waiting on you — should I draft a reply?";
    case "review_pr":
      return "A PR tagged you as reviewer — take a look?";
    case "slack_reply":
      return "Someone @-mentioned you on Slack — want me to grab context first?";
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

function defaultNextStep(dec: LoopDecision): string {
  return `Tap Run to let the agent handle this ${dec.type}.`;
}

/** POST /api/loop/decision/[id] with { action: 'run' | 'dry' | 'dismiss' | 'promote' } */
export interface DecisionActionInput {
  action: "run" | "dry" | "dismiss" | "promote";
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
}> {
  switch (input.action) {
    case "run": {
      const out = await runDecision(id);
      return {
        ok: out.ok,
        status: out.status,
        decision: out.decision,
        ...(out.result !== undefined ? { result: out.result } : {}),
        ...(out.error ? { error: out.error } : {}),
      };
    }
    case "dry": {
      const out = await runDecision(id, { dry: true });
      return {
        ok: out.ok,
        status: out.status,
        decision: out.decision,
        ...(out.result !== undefined ? { result: out.result } : {}),
        ...(out.error ? { error: out.error } : {}),
      };
    }
    case "dismiss": {
      const out = await dismissDecision(id, input.reason);
      return {
        ok: out.ok,
        status: out.status,
        decision: out.decision,
        ...(out.error ? { error: out.error } : {}),
      };
    }
    case "promote": {
      const out = await promoteDecision(id);
      return {
        ok: out.ok,
        status: out.status,
        decision: out.decision,
        ...(out.error ? { error: out.error } : {}),
      };
    }
    default:
      return {
        ok: false,
        status: "pending",
        decision: null,
        error: `unknown action ${String(input.action)}`,
      };
  }
}

/** GET /api/loop/connectors */
export async function connectors(
  opts: { refresh?: boolean } = {},
): Promise<LoopState["connectors"]> {
  if (opts.refresh) return refreshConnectors();
  return listConnectors();
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
    const { card, snapshot } = buildBrief({ force: opts.force ?? true });
    return {
      ok: true,
      stats: snapshot.stats,
      items: snapshot.items,
      card,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log(`brief action failed: ${msg}`);
    const snapshot = buildBriefOnly({ force: opts.force ?? true });
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
    const { card, snapshot } = buildWrap({ force: opts.force ?? true });
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
    const snapshot = buildWrapOnly({ force: opts.force ?? true });
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
