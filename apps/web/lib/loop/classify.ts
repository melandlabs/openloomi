/**
 * Loop signal → decision classification.
 *
 * Port of loop-lib.cjs → rules (hardSkipped + classify) into TypeScript with
 * identical behavior. Adds `LoopPreferences` so the hard-skip toggles can be
 * driven by the user's saved preferences (defaults preserve legacy behavior).
 *
 * The classifier is intentionally lightweight: pattern matching on subject /
 * snippet, labels, and signal type. Richer semantic decisions happen later
 * when the user "runs" a decision and the agent picks it up with full
 * openloomi-memory context.
 */

import type {
  ActionKind,
  DecisionType,
  LoopAction,
  LoopDecision,
  LoopPreferences,
  LoopSignal,
} from "./types";

const NORELY_RE =
  /^(no-?reply|noreply|donotreply|notifications?@|mailer-daemon@|postmaster@)/i;
const PROMO_LABELS = ["promotions", "social", "forums", "updates", "spam"];

export interface SkipReason {
  reason: string;
}

/**
 * Returns a SkipReason if the signal should be dropped before classification,
 * or null if it should proceed.
 */
export function isHardSkipped(
  signal: LoopSignal,
  prefs: Pick<LoopPreferences, "noReplySkip" | "promotionSkip">,
): SkipReason | null {
  const p = signal.payload as Record<string, unknown>;
  if (prefs.noReplySkip) {
    const from = String(p.from ?? p.sender ?? p.organizer ?? "");
    if (NORELY_RE.test(from)) return { reason: `no-reply sender: ${from}` };
  }
  if (prefs.promotionSkip) {
    const labels = Array.isArray(p.labels)
      ? (p.labels as unknown[]).map((l) => String(l).toLowerCase())
      : [];
    if (labels.some((l) => PROMO_LABELS.includes(l))) {
      return { reason: `promo label: ${labels.join(",")}` };
    }
  }
  if (signal.type === "calendar_event") {
    const r = String(p.my_response ?? "").toLowerCase();
    if (["accepted", "declined", "tentative"].includes(r)) {
      return { reason: `already ${r}` };
    }
  }
  if (signal.type === "email" && p.replied) {
    return { reason: "already replied" };
  }
  return null;
}

interface DecisionCandidate {
  type: DecisionType;
  title: string;
  action: LoopAction;
  confidence?: number;
}

/**
 * Lightweight classifier: produces a decision candidate from a signal.
 * Returns null when no typed action is warranted — the signal is then
 * silently dropped from the queue but stays in signals.jsonl for debugging.
 */
export function classify(signal: LoopSignal): DecisionCandidate | null {
  const p = signal.payload as Record<string, unknown>;
  const text =
    `${String(p.subject ?? "")} ${String(p.snippet ?? p.body ?? "")}`.toLowerCase();

  if (signal.type === "calendar_event") {
    const r = String(p.my_response ?? "needsAction");
    if (r === "needsAction" || !p.my_response) {
      return {
        type: "rsvp",
        title: `RSVP — ${String(p.title ?? p.summary ?? "Meeting")}`,
        action: {
          kind: "calendar_rsvp",
          params: { eventId: p.eventId ?? p.id, response: "accepted" },
        },
      };
    }
  }

  if (signal.type === "github_pr" && p.state === "open") {
    const requested = Array.isArray(p.requested_reviewers)
      ? p.requested_reviewers.length
      : 0;
    if (p.user_is_reviewer || requested === 0) {
      return {
        type: "review_pr",
        title: `Review PR #${String(p.number)} — ${String(p.title)}`,
        action: {
          kind: "github_review",
          params: { repo: p.repo, number: p.number },
        },
      };
    }
  }

  if (
    signal.type === "github_issue" &&
    p.assignee_login &&
    p.state === "open"
  ) {
    return {
      type: "todo",
      title: `Pick up issue #${String(p.number)} — ${String(p.title)}`,
      action: {
        kind: "todo",
        params: { title: p.title, repo: p.repo, number: p.number },
      },
    };
  }

  if (signal.type === "email") {
    if (/(rsvp|invit|meeting|join.*call|calendar)/.test(text)) {
      return {
        type: "draft_reply",
        title: `Reply: ${String(p.subject ?? "(no subject)")}`,
        action: {
          kind: "email_reply",
          params: {
            to: p.from,
            subject: p.subject ? `Re: ${p.subject}` : "",
            threadId: p.threadId,
          },
        },
      };
    }
    if (
      p.from &&
      !String(p.from).includes("noreply") &&
      /(please|could you|can you|need|asap|urgent|deadline|review)/.test(text)
    ) {
      return {
        type: "draft_reply",
        title: `Reply: ${String(p.subject ?? "(no subject)")}`,
        action: {
          kind: "email_reply",
          params: {
            to: p.from,
            subject: p.subject ? `Re: ${p.subject}` : "",
            threadId: p.threadId,
          },
        },
      };
    }
  }

  if (signal.type === "slack_message" && p.mentions_me) {
    return {
      type: "slack_reply",
      title: `Reply in #${String(p.channel ?? "channel")}`,
      action: {
        kind: "slack_reply",
        params: { channel: p.channel, ts: p.ts },
      },
    };
  }

  if (signal.type === "linear_issue" && p.identifier) {
    const labelNames = Array.isArray(p.labels)
      ? (p.labels as unknown[]).join(" ").toLowerCase()
      : "";
    const lText =
      `${String(p.title ?? "")} ${String(p.description ?? "")}`.toLowerCase();
    if (
      /(upload|upload-large|churn|onboard|invit)/.test(labelNames) ||
      /(upload|churn|onboard|invite).*(fail|broken|loss|drop)/.test(lText)
    ) {
      return {
        type: "requirement_synthesis",
        title: `Synthesize requirement: ${String(p.title ?? p.identifier)}`,
        action: {
          kind: "requirement_synthesis",
          params: {
            draft_target: "linear:new",
            title: `[REQ] ${String(p.title ?? p.identifier)}`,
            body_template: "PR/FAQ",
            evidence_count: 1,
            source_issue_id: p.identifier,
          },
        },
      };
    }
    return {
      type: "linear_review",
      title: `Review ${String(p.identifier)}: ${String(p.title ?? "")}`.trim(),
      action: {
        kind: "linear_review",
        params: { issue_id: p.identifier, scope_check: true },
      },
    };
  }

  if (signal.type === "obsidian_note_changed" && p.path) {
    const path = String(p.path);
    const folder = path.split("/").slice(0, -1).pop()?.toLowerCase() ?? "";

    if (folder === "projects" || folder === "plans") {
      return {
        type: "release_plan",
        title: `Update release plan: ${path}`,
        action: {
          kind: "release_plan",
          params: { source_path: path, mtime_ms: p.mtime_ms },
        },
      };
    }
    if (folder === "people") {
      return {
        type: "todo",
        title: `Update contact: ${path}`,
        action: {
          kind: "contact_update",
          params: { source_path: path, mtime_ms: p.mtime_ms },
        },
      };
    }
    if (folder === "customers") {
      return {
        type: "requirement_synthesis",
        title: `Customer note changed — re-review requirements: ${path}`,
        action: {
          kind: "requirement_synthesis",
          params: {
            draft_target: "linear:new",
            source_path: path,
            evidence_count: 1,
          },
        },
      };
    }
    return {
      type: "doc_update",
      title: `Regenerate document: ${path}`,
      action: {
        kind: "doc_update",
        params: { target_path: path, source_path: path, mtime_ms: p.mtime_ms },
      },
    };
  }

  return null;
}

/**
 * Helper for the brief/wrap generators: returns a card-shaped decision (with
 * `dialogue` + `nextStep`) instead of the leaner signal-derived shape. Both
 * forms live in the same `decisions.json` bucket — `type` discriminates.
 */
export function buildCardDecision(input: {
  type: DecisionType;
  title: string;
  action: LoopAction;
  dialogue: string;
  nextStep: string;
  context?: LoopDecision["context"];
}): LoopDecision {
  return {
    id: "", // assigned by store.add
    ts: "",
    status: "pending",
    type: input.type,
    title: input.title,
    action: input.action,
    dialogue: input.dialogue,
    nextStep: input.nextStep,
    ...(input.context ? { context: input.context } : {}),
  };
}

export const rules = { isHardSkipped, classify, NORELY_RE, PROMO_LABELS };
export type { ActionKind };
