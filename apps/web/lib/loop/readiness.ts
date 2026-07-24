/**
 * Loop decision semantics (#359) — the pure functions that separate three
 * previously-conflated questions:
 *
 *   1. classification confidence  → `decision.confidence` (diagnostic only)
 *   2. decision readiness         → `deriveReadiness` (gates execution)
 *   3. relationship context       → `deriveRelationship` (optional colour)
 *
 * and a `derivePriority` that is computed from urgency × impact — NEVER from
 * `confidence`. Everything here is a pure function of a decision object so it
 * can run on the server (card assembly) and the client (card rendering)
 * without duplicating the rules.
 *
 * Scope guard (from the issue): this is deliberately NOT a scoring engine.
 * No weighted composites, no relationship ranking, no percentage soup — just
 * semantic separation and safe action gating.
 */

import type {
  DecisionReadiness,
  DecisionRelationship,
  LoopAction,
  ReadinessStatus,
  RelationshipLevel,
} from "./types";

export type LoopPriority = "P0" | "P1" | "P2";

/**
 * Plain-language decision state shown on the primary card surface. This is a
 * light overlay on top of `ReadinessStatus`: a `ready` decision that involves
 * an external action to an `unknown` counterparty becomes `confirm` so the
 * card can nudge the user to double-check before executing.
 */
export type DecisionState =
  | "ready"
  | "needs_context"
  | "not_actionable"
  | "confirm";

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function params(decision: {
  action?: { params?: Record<string, unknown> } | null;
}): Record<string, unknown> {
  const p = decision.action?.params;
  return p && typeof p === "object" ? p : {};
}

function nonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

/** Parse an ISO-8601 string or epoch-ms number into a Date, else null. */
function parseTimestamp(raw: unknown): Date | null {
  if (raw == null) return null;
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : raw;
  if (typeof raw === "number") {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof raw === "string") {
    const ms = Date.parse(raw.trim());
    return Number.isNaN(ms) ? null : new Date(ms);
  }
  return null;
}

// A decision that reaches outside OpenLoomi on the user's behalf. Used only
// to sharpen the plain-language state for unknown counterparties — it does
// NOT gate execution on its own.
const EXTERNAL_ACTION_KINDS = new Set([
  "calendar_rsvp",
  "email_reply",
  "im_reply",
  "github_review",
]);

// ---------------------------------------------------------------------------
// Readiness
// ---------------------------------------------------------------------------

// `type` is widened to `string` so the UI can hand us card payloads that
// allow user-defined custom types. Unknown strings fall through to `default`
// and resolve to `ready` — the helper is intentionally permissive at the
// boundary and strict (via the switch) only where it has rules.
type ReadableDecision = {
  type: string;
  action?: Pick<LoopAction, "params"> | null;
  readiness?: DecisionReadiness;
};

/**
 * Resolve the decision's readiness. Prefers an explicit `decision.readiness`
 * (set by the classifier or the agent) and otherwise infers it from the
 * action params. The inference is intentionally conservative: it only marks
 * `needs_context` / `not_actionable` when there is positive evidence, so a
 * decision with a well-formed action stays `ready`.
 */
export function deriveReadiness(decision: ReadableDecision): DecisionReadiness {
  if (decision.readiness) return decision.readiness;
  const p = params(decision);

  switch (decision.type) {
    case "rsvp": {
      // An event you own with no other guests is not an RSVP you owe anyone.
      if (p.organizerIsSelf === true && Number(p.attendeesCount ?? 0) === 0) {
        return { status: "not_actionable" };
      }
      const missing: string[] = [];
      if (!parseTimestamp(p.start)) missing.push("event time");
      if (!nonEmptyString(p.organizer)) missing.push("organizer");
      if (missing.length > 0) return { status: "needs_context", missing };
      return { status: "ready" };
    }
    case "deadline_reminder": {
      const missing: string[] = [];
      if (!parseTimestamp(p.deadlineAt)) missing.push("deadline");
      if (!nonEmptyString(p.message)) missing.push("what's due");
      if (missing.length > 0) return { status: "needs_context", missing };
      return { status: "ready" };
    }
    case "email_reply": {
      if (!nonEmptyString(p.to)) {
        return { status: "needs_context", missing: ["recipient"] };
      }
      return { status: "ready" };
    }
    case "im_reply": {
      if (!nonEmptyString(p.to)) {
        return { status: "needs_context", missing: ["recipient"] };
      }
      return { status: "ready" };
    }
    case "quiet_digest":
      return { status: "not_actionable" };
    default:
      return { status: "ready" };
  }
}

/** True when the decision is safe to execute. Blocks only `not_actionable`. */
export function canExecute(readiness: DecisionReadiness): boolean {
  return readiness.status !== "not_actionable";
}

// ---------------------------------------------------------------------------
// Relationship
// ---------------------------------------------------------------------------

// Same widening logic — custom types carry arbitrary `action`/`context` shapes
// and the relationship helper doesn't need strict typing to be honest.
// `kind` is optional because the `organizerIsSelf` and `context.person`
// short-circuits don't need it.
type RelatableDecision = {
  type?: string;
  action?:
    | (Partial<Pick<LoopAction, "kind" | "params">> & {
        kind?: string;
        params?: Record<string, unknown>;
      })
    | null;
  context?: { person?: unknown } & Record<string, unknown>;
  relationship?: DecisionRelationship;
};

/**
 * Resolve the relationship level, or `null` when there is no evidence. The
 * caller decides whether to surface it — the level is optional colour, never
 * a gate.
 */
export function deriveRelationship(
  decision: RelatableDecision,
): DecisionRelationship | null {
  if (decision.relationship) return decision.relationship;
  const p = params(decision);
  if (p.organizerIsSelf === true) return { level: "self" };
  const person = decision.context?.person;
  if (nonEmptyString(person)) return { level: "known" };
  // For decisions with an external-facing action we can say "unknown" so the
  // card can prompt for a careful confirm; for internal chores staying silent
  // (null) is the honest answer.
  const kind = decision.action?.kind;
  if (typeof kind === "string" && EXTERNAL_ACTION_KINDS.has(kind)) {
    return { level: "unknown" };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Priority — urgency × impact, NEVER classification confidence
// ---------------------------------------------------------------------------

export type Urgency = "high" | "medium" | "low";

/**
 * Derive urgency from time-to-act signals only. When the decision carries a
 * concrete deadline / event start we bucket by how soon it is; otherwise we
 * return "low" rather than inventing urgency from nothing.
 */
export function deriveUrgency(
  decision: { action?: Pick<LoopAction, "params"> | null },
  now: Date = new Date(),
): Urgency {
  const p = params(decision);
  const when = parseTimestamp(p.deadlineAt) ?? parseTimestamp(p.start);
  if (!when) return "low";
  const hours = (when.getTime() - now.getTime()) / 3_600_000;
  if (hours < 0) return "low"; // already past — nothing left to rush
  if (hours <= 24) return "high";
  if (hours <= 72) return "medium";
  return "low";
}

/**
 * Card priority. Derived from urgency (and gated by readiness), explicitly
 * independent of `decision.confidence`:
 *   - `not_actionable`             → always P2 (there is nothing to rush).
 *   - `needs_context`              → capped at P1; it can be urgent but it is
 *                                    blocked from safe execution, so it must
 *                                    not masquerade as a top-priority action.
 *   - `ready`                      → straight urgency mapping.
 */
export function derivePriority(
  decision: ReadableDecision,
  now: Date = new Date(),
): LoopPriority {
  const readiness = deriveReadiness(decision);
  if (readiness.status === "not_actionable") return "P2";
  const urgency = deriveUrgency(decision, now);
  let priority: LoopPriority =
    urgency === "high" ? "P0" : urgency === "medium" ? "P1" : "P2";
  if (readiness.status === "needs_context" && priority === "P0") {
    priority = "P1";
  }
  return priority;
}

// ---------------------------------------------------------------------------
// Plain-language state for the card surface
// ---------------------------------------------------------------------------

/**
 * Collapse readiness + relationship into the single plain-language state the
 * primary card surface renders. `ready` + external action + `unknown`
 * counterparty upgrades to `confirm` so the card asks the user to look twice
 * before an outbound write.
 */
export function readinessState(
  decision: RelatableDecision & {
    type: string;
    readiness?: DecisionReadiness;
  },
): DecisionState {
  // `deriveReadiness` only reads `type`/`action.params`, but its parameter
  // type is strict; cast through the structural subset the helper actually uses.
  const readiness = deriveReadiness(decision as unknown as ReadableDecision);
  if (readiness.status !== "ready") return readiness.status;
  const relationship = deriveRelationship(decision);
  const kind = decision.action?.kind;
  const external = typeof kind === "string" && EXTERNAL_ACTION_KINDS.has(kind);
  if (external && relationship?.level === "unknown") return "confirm";
  return "ready";
}

/** Stable i18n key + English fallback for a decision state. */
export function stateLabel(state: DecisionState): {
  key: string;
  fallback: string;
} {
  switch (state) {
    case "ready":
      return { key: "loop.readiness.ready", fallback: "Ready to decide" };
    case "needs_context":
      return {
        key: "loop.readiness.needsContext",
        fallback: "Needs more context",
      };
    case "not_actionable":
      return {
        key: "loop.readiness.notActionable",
        fallback: "No action needed",
      };
    case "confirm":
      return { key: "loop.readiness.confirm", fallback: "Confirm carefully" };
  }
}

export type {
  DecisionReadiness,
  DecisionRelationship,
  ReadinessStatus,
  RelationshipLevel,
};
