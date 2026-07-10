/**
 * Loop domain types — the Loop is OpenLoomi's proactive execution brain.
 *
 * Decisions are typed cards that flow through a pipeline:
 *   watch (pull signals) → enrich (memory lookup) → classify (rule + classifier)
 *   → execute (POST /api/native/agent) → user approval (dry/run/dismiss/promote)
 *
 * The schema is intentionally permissive: callers (agents, CLI, web UI, pet)
 * may omit optional fields. The store layer hoists top-level `memory_refs` /
 * `insight_refs` into `context` on every read so every consumer sees one
 * consistent shape.
 */

export type DecisionType =
  | "rsvp"
  | "draft_reply"
  | "review_pr"
  | "todo"
  | "slack_reply"
  | "deadline_reminder"
  | "release_plan"
  | "requirement_synthesis"
  | "linear_review"
  | "contact_update"
  | "doc_update"
  | "brief"
  | "wrap"
  | "noop" // NEW — non-actionable; filtered at decisions.add()
  | "tick_summary" // NEW — explicit per-tick summary; filtered at decisions.add()
  | "unknown";

export type DecisionStatus = "pending" | "done" | "dismissed";

export type ActionKind =
  | "calendar_rsvp"
  | "email_reply"
  | "slack_reply"
  | "github_review"
  | "deadline_notify"
  | "todo"
  | "linear_review"
  | "requirement_synthesis"
  | "release_plan"
  | "contact_update"
  | "doc_update"
  | "brief"
  | "wrap"
  | string; // open form for agent-emitted kinds

export interface LoopAction {
  kind: ActionKind;
  params: Record<string, unknown>;
}

export interface LoopDecisionContext {
  why?: string[];
  memory_refs?: string[];
  insight_refs?: string[];
  person?: string | null;
  [extra: string]: unknown;
}

export interface LoopDecision {
  id: string;
  ts: string;
  status: DecisionStatus;
  signal_id?: string;
  type: DecisionType;
  title: string;
  action: LoopAction;
  context?: LoopDecisionContext;
  confidence?: number;
  source_signal?: LoopSignal;
  result?: unknown;
  completed_at?: string;
  /** Card-flavored dialogue/next step for the pet and web UI. */
  dialogue?: string;
  nextStep?: string;
}

export interface LoopDecisionBuckets {
  pending: LoopDecision[];
  done: LoopDecision[];
  dismissed: LoopDecision[];
}

export type SignalType =
  | "email"
  | "calendar_event"
  | "github_pr"
  | "github_issue"
  | "slack_message"
  | "linear_issue"
  | "obsidian_note_changed"
  | string;

export interface LoopSignal {
  id: string;
  ts: string;
  source: string;
  type: SignalType;
  payload: Record<string, unknown>;
  /** Optional dedupe key. Signals with the same `dedupeKey` after append
   *  are kept once. */
  _origin?: "composio" | "insights" | "obsidian" | "manual";
  _insightId?: string;
}

export interface LoopPreferences {
  enabled: boolean;
  /** 24h HH:MM local time. */
  briefTime: string;
  /** 24h HH:MM local time. */
  wrapTime: string;
  /** Tick interval seconds. */
  intervalSec: number;
  /** Hard-skip patterns. */
  noReplySkip: boolean;
  promotionSkip: boolean;
  /**
   * IANA timezone the brief/wrap cron rows should be anchored to. Empty
   * (or omitted) means "derive from the host's `Intl.DateTimeFormat`". The
   * settings panel populates this from `Intl.DateTimeFormat().resolvedOptions().timeZone`
   * on PUT so a containerised server (whose Intl is usually UTC) still
   * honours the user's wall-clock 09:00 / 21:00.
   */
  timezone?: string;
  /**
   * Generate agentic narrative summary for brief/wrap. When `false`, brief
   * and wrap fall back to the deterministic templated dialogue. Default
   * `true` — opt-out via `PUT /api/loop/preferences { narrative: false }`.
   */
  narrative?: boolean;
  /**
   * Send native macOS / OS desktop notifications for high-priority Loop
   * events. Default `false` because the Loomi Pet bubble/card is the
   * primary desktop surface and is always on. Opt-in via
   * `PUT /api/loop/preferences { desktopNotifications: true }`.
   */
  desktopNotifications?: boolean;
}

/** Mute rule scope — discriminated union keyed by signal type. */
export type MuteScope =
  | { kind: "email"; from: string }
  | { kind: "calendar_event"; organizer: string; fallback?: "eventId" }
  | { kind: "slack_message"; user?: string; channel?: string }
  | { kind: "obsidian_note_changed"; path: string }
  | { kind: "github_pr"; repo: string }
  | { kind: "github_issue"; repo: string }
  | { kind: "linear_issue"; team?: string; project?: string };

export interface MuteRule {
  /** Normalised lowercase key — the atom of O(1) lookups. */
  key: string;
  /** Discriminated scope, kept for diagnostics and a future mute UI. */
  scope: MuteScope;
  /** ISO timestamp when the rule was created. */
  createdAt: string;
  /** Provenance — which dismiss produced this rule. */
  source?: { decisionId?: string; signalType?: SignalType };
}

export interface LoopMutes {
  version: 1;
  rules: MuteRule[];
  /** Flattened keys — recomputed from `rules` on every write. */
  keys: string[];
}

export const DEFAULT_LOOP_PREFERENCES: LoopPreferences = {
  enabled: true,
  briefTime: "09:00",
  wrapTime: "21:00",
  intervalSec: 600,
  noReplySkip: true,
  promotionSkip: true,
  narrative: true,
  desktopNotifications: false, // NEW
};

export interface ConnectorEntry {
  id: string;
  label: string;
  /** True when at least one account is connected and the toolkit reports healthy. */
  connected: boolean;
  accountCount: number;
  lastError?: string;
  /**
   * Provenance flag. `true` means an agent probe actually emitted this
   * row; `false` (or absent for compat) means it's a "haven't asked yet"
   * sentinel from the FALLBACK list. UIs use this to distinguish "we know
   * this is offline" from "we don't know yet" — the two render with
   * different pills (red `Offline` vs. neutral `Pending first probe`).
   */
  probed?: boolean;
  fetchedAt: string;
}

export interface LoopState {
  enabled: boolean;
  preferences: LoopPreferences;
  counts: {
    pending: number;
    done: number;
    dismissed: number;
    signals: number;
  };
  lastTickAt?: string;
  connectors: ConnectorEntry[];
}

export interface LoopTickResult {
  scanned: number;
  surfaced: number;
  muted: number;
  newDecisions: LoopDecision[];
  errors: string[];
}

// ---------------------------------------------------------------------------
// Agentic narrative for brief / wrap
// ---------------------------------------------------------------------------
//
// The brief / wrap snapshots are otherwise plain data (items, stats). The
// `narrative` field is the agentic overlay — a short headline + body the agent
// writes, plus generation lifecycle state. Three terminal shapes:
//
//   - undefined  → user opted out (prefs.narrative === false); UI uses the
//                  templated dialogue.
//   - null       → tried but failed; UI silently falls back to template.
//   - { status: "generating", ... } → an agent call is in flight; UI shows
//                  a spinner placeholder, never hangs.
//   - { status: "ready", ... }     → headline + body available.
//
// `input_hash` is sha1(items) (or sha1(highlights) for wrap) — used to detect
// staleness so we can skip a redundant agent call when the underlying queue
// hasn't changed since the last successful generation.

export interface BriefNarrativeReady {
  status: "ready";
  /** ≤ 200 chars after slice; do not start with "Morning:". */
  headline: string;
  /** ≤ 800 chars after slice; plain prose, no markdown. */
  body: string;
  /** ISO timestamp the narrative finished generating. */
  generatedAt: string;
  /** Optional model id for debugging / admin panels. */
  model?: string;
  /** sha1(items) at the time of generation. Detects staleness. */
  input_hash?: string;
}

export interface BriefNarrativeGenerating {
  status: "generating";
  /** ISO timestamp the agent call started. */
  startedAt: string;
  /** sha1(items) the agent was invoked on. */
  input_hash: string;
}

export type BriefNarrative =
  | BriefNarrativeReady
  | BriefNarrativeGenerating
  | null;

export interface WrapNarrativeReady {
  status: "ready";
  headline: string;
  body: string;
  generatedAt: string;
  model?: string;
  input_hash?: string;
}

export interface WrapNarrativeGenerating {
  status: "generating";
  startedAt: string;
  input_hash: string;
}

export type WrapNarrative = WrapNarrativeReady | WrapNarrativeGenerating | null;

// ---------------------------------------------------------------------------
// Brief snapshot — muted bucket shape
// ---------------------------------------------------------------------------
//
// `id` is the originating `LoopDecision.id`. Two muted rows can have the same
// `kind`+`title` (e.g. two `wrap` decisions on the same date, or multiple
// `draft_reply` rows for the same thread), so we need a stable identity beyond
// position for React keys and any future "un-mute from the UI" flow.

export interface BriefMuted {
  id: string;
  kind: string;
  title: string;
  reason: string;
}
