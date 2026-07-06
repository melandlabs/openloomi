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
  | "release_plan"
  | "requirement_synthesis"
  | "linear_review"
  | "contact_update"
  | "doc_update"
  | "brief"
  | "wrap"
  | "unknown";

export type DecisionStatus = "pending" | "done" | "dismissed";

export type ActionKind =
  | "calendar_rsvp"
  | "email_reply"
  | "slack_reply"
  | "github_review"
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
}

export const DEFAULT_LOOP_PREFERENCES: LoopPreferences = {
  enabled: true,
  briefTime: "09:00",
  wrapTime: "21:00",
  intervalSec: 600,
  noReplySkip: true,
  promotionSkip: true,
};

export interface ConnectorEntry {
  id: string;
  label: string;
  /** True when at least one account is connected and the toolkit reports healthy. */
  connected: boolean;
  accountCount: number;
  lastError?: string;
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
