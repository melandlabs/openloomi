"use client";

/**
 * Loop decision card — one typed card the Loop surfaces to the pet / web UI.
 *
 * Restructured per #363 around a 5-layer information architecture so the
 * user sees only the facts needed to decide:
 *
 *   1. Header row          — type icon + RSVP-specific invitation label +
 *                            state pill + priority pill + diagnostic
 *                            `conf 0.NN` chip + a kebab menu for
 *                            card-level dismissal (separated from the
 *                            decision-action row).
 *   2. Decision prompt     — single-line ask ("Will you attend this
 *                            meeting?"). Title shown once below as an
 *                            <h3>.
 *   3. Decision context    — `<DecisionContextBlock>` renders the
 *                            user-facing facts (time, organizer,
 *                            attendance, location, conflict for RSVP).
 *                            Non-RSVP types render nothing here yet.
 *   4. Readiness callout   — plain-language information readiness plus
 *                            missing-field prompt. Subtle text when
 *                            `ready`, banner when `needs_context`.
 *   5. Provenance          — `<details>` (collapsed by default) containing
 *                            the source chain, why bullets, action params
 *                            JSON, and the dry-run preview when present.
 *
 * Action row (#6 below the layers):
 *   - RSVP ready/confirm  → Attend (primary) · Decline (outline) · View original (ghost)
 *   - RSVP needs_context  → same three buttons; the readiness banner tells
 *                            the user to review the original first
 *   - RSVP not_actionable → View original only
 *   - Other types         → existing Dry run / Edit / Run / Dismiss row
 *
 * Card-level dismissal (#7) lives in the header kebab so it never gets
 * confused with the decision-action group.
 *
 * Statuses:
 *   - pending   → 5-layer card + action row visible
 *   - done      → "Ran at <ts>" footer + execution badge
 *   - dismissed → "Dismissed" footer with optional reason
 *
 * Custom decision types: the user can register new `type` strings via
 * `PUT /api/loop/types`. Built-in `TYPE_ICON` / `TYPE_LABEL` are static
 * at module load; the per-user extensions are fetched once on mount and
 * merged at render time via the `customTypeMeta` lookup below.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";

import { Button } from "@openloomi/ui";
import { cn } from "@/lib/utils";
import { RemixIcon } from "@/components/remix-icon";
import { Spinner } from "@/components/spinner";
import { toast } from "@/components/toast";
import {
  canExecute,
  deriveReadiness,
  derivePriority,
  readinessState,
  stateLabel,
  type DecisionState,
  type LoopPriority,
} from "@/lib/loop/readiness";
import { deriveDecisionContext } from "@/lib/loop/decision-context";
import { DecisionContextBlock } from "@/components/loop/decision-context-block";
import { DismissInput } from "@/components/loop/dismiss-input";
import type {
  DecisionPendingAction,
  DecisionReadiness,
  DecisionRelationship,
  DecisionSubActionRecord,
  LoopDecisionExecution,
} from "@/lib/loop/types";

import { LoopSourceChain, type SourceChainNode } from "./source-chain";

export type LoopActionKind =
  | "run"
  | "dry"
  | "dismiss"
  | "promote"
  | "rsvp_attend"
  | "rsvp_decline";

export interface LoopDecisionCardData {
  id: string;
  type: string;
  title: string;
  status: "pending" | "done" | "dismissed";
  confidence?: number;
  /** #359 — decision readiness (gates execution). Derived when absent. */
  readiness?: DecisionReadiness;
  /** #359 — relationship context (optional colour). */
  relationship?: DecisionRelationship;
  ts: string;
  completed_at?: string;
  result?: unknown;
  /** #358 — structured execution verdict from the runner. Drives the
   *  footer / re-run UX so the card doesn't claim "done / Ran at" when
   *  the agent actually refused. */
  execution?: LoopDecisionExecution;
  /** Pre-built card fields (set when the card is built via /api/loop/card/[id]). */
  why?: string[];
  dialogue?: string;
  nextStep?: string;
  /** Optional pre-rendered chain. Falls back to source_signal when missing. */
  source_chain?: Array<SourceChainNode | string>;
  context?: {
    why?: string[];
    memory_refs?: string[];
    person?: string | null;
    project_ref?: string | null;
    last_error?: string;
    dry_run?: string;
    /** #363 — when set, indicates this decision is still in `pending` but
     *  carries a previously-executed verdict (e.g. the user's first RSVP
     *  attempt was recorded as done and they chose again). Currently
     *  surfaced only through the technical details. */
    [key: string]: unknown;
  };
  source_signal?: {
    source: string;
    type: string;
    ts?: string;
    payload?: Record<string, unknown>;
  };
  action?: { kind: string; params: Record<string, unknown> };
  /** #364 — current scheduled-action lock, set by the schedule route. */
  pending_action?: DecisionPendingAction | null;
  /** #364 — immutable attempt history (every schedule, every cancel,
   *  every completion is appended). The card renders this as a small
   *  audit list so the user can see contradictory attempts instead of
   *  only the latest overwrite. */
  sub_actions?: DecisionSubActionRecord[];
}

interface DecisionCardProps {
  decision: LoopDecisionCardData;
  onChange?: () => void;
  className?: string;
  /** When true, render in compact form (no body, no actions). */
  compact?: boolean;
}

const TYPE_ICON: Record<string, string> = {
  rsvp: "ri-calendar-check-line",
  email_reply: "ri-mail-send-line",
  review_pr: "ri-git-pull-request-line",
  todo: "ri-checkbox-circle-line",
  im_reply: "ri-chat-ai-line",
  deadline_reminder: "ri-time-line",
  release_plan: "ri-rocket-line",
  requirement_synthesis: "ri-file-list-3-line",
  linear_review: "ri-list-check-2",
  contact_update: "ri-user-settings-line",
  doc_update: "ri-file-edit-line",
  brief: "ri-sun-line",
  wrap: "ri-moon-line",
  unknown: "ri-question-line",
};

const TYPE_LABEL: Record<string, string> = {
  rsvp: "RSVP",
  email_reply: "Email reply",
  review_pr: "Review PR",
  todo: "Todo",
  im_reply: "IM reply",
  deadline_reminder: "Deadline",
  release_plan: "Release plan",
  requirement_synthesis: "Requirement",
  linear_review: "Linear review",
  contact_update: "Contact update",
  doc_update: "Doc update",
  brief: "Morning brief",
  wrap: "Evening wrap",
};

interface CustomTypeMeta {
  icon: string;
  label: string;
}

/**
 * Per-card hook that fetches the user's custom decision types once on
 * mount and exposes a `lookup(type) → {icon,label}` helper. Returns
 * `null` for types the user has not registered, so callers can fall
 * back to the built-in `TYPE_ICON` / `TYPE_LABEL` constants. Never
 * throws — a failed fetch is treated as "no custom types".
 */
function useCustomTypeMeta(): {
  lookup: (type: string) => CustomTypeMeta | null;
} {
  const [customTypes, setCustomTypes] = useState<
    Record<string, CustomTypeMeta>
  >({});
  useEffect(() => {
    let cancelled = false;
    const apiBase =
      typeof window !== "undefined" &&
      (window as unknown as { __OPENLOOMI_API__?: string }).__OPENLOOMI_API__
        ? (window as unknown as { __OPENLOOMI_API__: string }).__OPENLOOMI_API__
        : "";
    fetch(`${apiBase}/api/loop/types`, {
      credentials: "include",
      cache: "no-store",
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: unknown) => {
        if (cancelled || !data || typeof data !== "object") return;
        const list = (data as { types?: unknown }).types;
        if (!Array.isArray(list)) return;
        const out: Record<string, CustomTypeMeta> = {};
        for (const item of list) {
          if (!item || typeof item !== "object") continue;
          const t = item as {
            id?: unknown;
            label?: unknown;
            icon?: unknown;
          };
          if (typeof t.id !== "string" || !t.id) continue;
          const icon =
            typeof t.icon === "string" && t.icon.length > 0
              ? t.icon
              : "ri-question-line";
          const label =
            typeof t.label === "string" && t.label.length > 0 ? t.label : t.id;
          out[t.id] = { icon, label };
        }
        if (!cancelled) setCustomTypes(out);
      })
      .catch(() => {
        /* best-effort — built-in dispatch tables still apply */
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const lookup = useMemo(
    () => (type: string) => customTypes[type] ?? null,
    [customTypes],
  );
  return { lookup };
}

function priorityTone(priority: LoopPriority): string {
  if (priority === "P0") return "bg-red-100 text-red-700";
  if (priority === "P1") return "bg-amber-100 text-amber-700";
  return "bg-muted text-muted-foreground";
}

/** Tone for the plain-language decision-state pill — the primary surface. */
function stateTone(state: DecisionState): string {
  switch (state) {
    case "ready":
      return "bg-emerald-100 text-emerald-700";
    case "confirm":
      return "bg-amber-100 text-amber-700";
    case "needs_context":
      return "bg-sky-100 text-sky-700";
    case "not_actionable":
      return "bg-muted text-muted-foreground";
  }
}

function ActionButton({
  icon,
  label,
  variant,
  onClick,
  pending,
}: {
  icon: string;
  label: string;
  variant?: "default" | "outline" | "ghost" | "destructive" | "secondary";
  onClick: () => void;
  pending?: boolean;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant={variant ?? "outline"}
      onClick={onClick}
      disabled={pending}
      className="gap-1.5"
    >
      {pending ? (
        <Spinner size={14} label="" className="!size-3.5" />
      ) : (
        <RemixIcon name={icon} className="size-3.5" />
      )}
      {label}
    </Button>
  );
}

/**
 * Header kebab — card-level dismissal, separated from the decision-action
 * row (#363). Opens a DismissInput reason-prompt inline so dismissing a
 * card without an RSVP response never gets confused with declining one.
 */
function CardKebab({ decision }: { decision: LoopDecisionCardData }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  // Close on outside click / Esc so the kebab mirrors normal menu UX.
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={t("loop.card.kebab", "More actions")}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted/60 hover:text-foreground"
      >
        <RemixIcon name="ri-more-2-fill" className="size-4" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-1 w-64 rounded-md border bg-card p-3 shadow-lg"
        >
          <DismissInput
            decisionId={decision.id}
            onDismissed={() => setOpen(false)}
            className="!w-full"
          />
        </div>
      )}
    </div>
  );
}

/**
 * #364 — Cancel a pending scheduled action. Calls DELETE on the
 * action route and surfaces the four response shapes the route
 * can return (`cancelled` / `already_fired` / `not_found` /
 * `pending_action`) as distinct toast messages so the user never
 * sees a generic HTTP 500 again.
 */
function CancelPendingActionButton({
  decision,
  onChange,
}: {
  decision: LoopDecisionCardData;
  onChange?: () => void;
}) {
  const { t } = useTranslation();
  const [pending, setPending] = useState(false);
  const pendingId = decision.pending_action?.action_id;
  if (!pendingId) return null;
  async function cancel() {
    if (!pendingId) return;
    setPending(true);
    try {
      const res = await fetch(`/api/loop/action/${pendingId}`, {
        method: "DELETE",
      });
      const data = (await res.json().catch(() => ({}))) as {
        cancelled?: boolean;
        reason?: string;
        last_status?: string;
        error?: string;
      };
      if (res.ok && data.cancelled) {
        toast({
          type: "success",
          description: t(
            "loop.card.cancelledScheduled",
            "Scheduled action cancelled",
          ),
        });
        onChange?.();
        return;
      }
      // 409 already_fired → tell the user the cancel was too late.
      if (data.reason === "already_fired") {
        toast({
          type: "info",
          description: t(
            "loop.card.alreadyFired",
            "Action already started — cannot cancel. Refresh to see the latest status.",
          ),
        });
        onChange?.();
        return;
      }
      if (data.reason === "not_found") {
        toast({
          type: "info",
          description: t(
            "loop.card.actionGone",
            "Scheduled action is already gone. Refresh to see the latest status.",
          ),
        });
        onChange?.();
        return;
      }
      toast({
        type: "error",
        description: t("loop.actionFailed", "Action failed: {{msg}}", {
          msg: data.error ?? res.statusText,
        }),
      });
    } catch (e) {
      toast({
        type: "error",
        description: t("loop.actionFailed", "Action failed: {{msg}}", {
          msg: e instanceof Error ? e.message : "unknown",
        }),
      });
    } finally {
      setPending(false);
    }
  }
  return (
    <ActionButton
      icon="ri-stop-circle-line"
      label={t("loop.card.cancelScheduled", "Cancel scheduled action")}
      variant="outline"
      onClick={cancel}
      pending={pending}
    />
  );
}

/**
 * #364 — immutable attempt history strip. Renders each
 * `DecisionSubActionRecord` as a single line so contradictory
 * attempts (e.g. an earlier "No" before a later "Yes") remain
 * visible. Sorted newest-first; `pending_action` is rendered as
 * the head item in a separate style to distinguish a still-queued
 * click from a terminal record.
 */
function SubActionsHistory({
  records,
  pendingAction,
}: {
  records: DecisionSubActionRecord[];
  pendingAction: DecisionPendingAction | null;
}) {
  const { t } = useTranslation();
  // Newest first; cap at 6 visible rows to keep the strip short.
  const sorted = [...records].sort((a, b) =>
    (b.scheduled_at ?? "").localeCompare(a.scheduled_at ?? ""),
  );
  const visible = sorted.slice(0, 6);
  return (
    <details className="rounded-md border bg-muted/10 px-3 py-2 text-xs">
      <summary className="cursor-pointer select-none font-medium text-muted-foreground">
        {t("loop.card.attemptHistory", "Attempt history ({{n}})", {
          n: records.length + (pendingAction ? 1 : 0),
        })}
      </summary>
      <ul className="mt-2 space-y-1.5 text-[11px]">
        {pendingAction && (
          <li className="flex items-center gap-1.5 text-amber-700">
            <RemixIcon name="ri-time-line" className="size-3.5 shrink-0" />
            <span className="font-medium">
              {t("loop.card.attemptPending", "Pending · {{verb}}", {
                verb: pendingAction.action,
              })}
            </span>
            {pendingAction.sub_action?.response != null && (
              <span className="text-amber-700/80">
                (
                {t("loop.card.attemptResponse", "response: {{v}}", {
                  v: String(pendingAction.sub_action.response),
                })}
                )
              </span>
            )}
            <span className="ml-auto text-amber-700/70">
              {formatTime(pendingAction.scheduled_at)}
            </span>
          </li>
        )}
        {visible.map((r) => {
          const tone = statusTone(r.status);
          return (
            <li
              key={`${r.action_id}-${r.scheduled_at}`}
              className="flex items-center gap-1.5"
            >
              <RemixIcon
                name={statusIcon(r.status)}
                className={`size-3.5 shrink-0 ${tone}`}
              />
              <span className={`font-medium ${tone}`}>
                {r.action}
                {r.sub_action?.response != null
                  ? ` · ${String(r.sub_action.response)}`
                  : ""}
              </span>
              <span className="text-muted-foreground">· {r.status}</span>
              {r.reason ? (
                <span className="truncate text-muted-foreground">
                  — {r.reason}
                </span>
              ) : null}
              <span className="ml-auto text-muted-foreground">
                {formatTime(r.completed_at ?? r.scheduled_at)}
              </span>
            </li>
          );
        })}
      </ul>
    </details>
  );
}

function statusIcon(s: DecisionSubActionRecord["status"]): string {
  switch (s) {
    case "completed":
      return "ri-check-line";
    case "skipped":
      return "ri-checkbox-circle-line";
    case "blocked":
    case "failed":
      return "ri-error-warning-line";
    case "cancelled":
      return "ri-stop-circle-line";
    case "superseded":
      return "ri-refresh-line";
  }
}

function statusTone(s: DecisionSubActionRecord["status"]): string {
  switch (s) {
    case "completed":
      return "text-emerald-700";
    case "skipped":
      return "text-sky-700";
    case "blocked":
    case "failed":
      return "text-destructive";
    case "cancelled":
    case "superseded":
      return "text-muted-foreground";
  }
}

function formatTime(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    day: "numeric",
  }).format(d);
}

export function DecisionCard({
  decision,
  onChange,
  className,
  compact,
}: DecisionCardProps) {
  const router = useRouter();
  const { t } = useTranslation();
  const [pendingAction, setPendingAction] = useState<LoopActionKind | null>(
    null,
  );
  const { lookup: lookupCustomType } = useCustomTypeMeta();

  // User-defined types win when present; built-ins are the fallback so
  // the card never renders an undefined icon for an unknown id.
  const custom = lookupCustomType(decision.type);
  const typeIcon =
    custom?.icon ?? TYPE_ICON[decision.type] ?? TYPE_ICON.unknown;
  const typeLabel = custom?.label ?? TYPE_LABEL[decision.type] ?? decision.type;
  // #359 — priority is derived from urgency × impact (via readiness), NOT
  // from classification confidence. The plain-language `state` is the
  // primary decision surface; `confidence` is demoted to diagnostics.
  const priority = derivePriority(decision);
  const readiness = deriveReadiness(decision);
  const state = readinessState(decision);
  const stateMeta = stateLabel(state);
  const executable = canExecute(readiness);
  const priorityCls = priorityTone(priority);

  const whyBullets = decision.why ?? decision.context?.why ?? [];
  const isRsvp = decision.type === "rsvp";
  // #378 — quiet_digest decisions (e.g. the GitHub-notification summary) are
  // read-only: they carry no executable action. Suppressing the Run row keeps
  // the pet / web card from offering a "Run" button for a digest that has
  // nothing to run. The decision still supports local dismissal (re-labelled
  // "Mark as read" for the github-notifications module below).
  const isQuietDigest =
    decision.type === "quiet_digest" ||
    decision.action?.kind === "quiet_digest";
  // #363 — RSVP gets a single-line decision prompt + the dedicated context
  // block. Other types keep the legacy dialogue bubble verbatim.
  const decidePrompt = isRsvp
    ? t("loop.rsvp.decidePrompt", "Will you attend this meeting?")
    : null;
  const dialogue =
    decision.dialogue ??
    (decision.type === "email_reply"
      ? t(
          "loop.dialogue.emailReply",
          "This email looks like it's waiting on you — should I draft a reply?",
        )
      : decision.type === "rsvp"
        ? t("loop.dialogue.rsvp", "This calendar invite needs your call.")
        : `New ${typeLabel.toLowerCase()} decision`);
  const nextStep =
    decision.nextStep ??
    t("loop.nextStep.tapRun", "Tap Run to let the agent handle this decision.");
  const quietDigestModule =
    (decision.action?.params as Record<string, unknown> | undefined)?.module ??
    (decision.context as Record<string, unknown> | undefined)?.module;
  const quietDigestItems = Array.isArray(decision.context?.items)
    ? (decision.context.items as Array<Record<string, unknown>>).slice(0, 20)
    : [];
  const isGithubQuietDigest =
    quietDigestModule === "github-notifications" ||
    /github notification|github has/i.test(`${decision.title} ${dialogue}`);

  // #363 — pre-resolve the decision context. RSVP renders the
  // time/organizer/attendance/location/conflict block; other types return
  // `null` and the block renders nothing.
  const decisionContext = useMemo(
    () =>
      deriveDecisionContext({
        type: decision.type,
        action: decision.action ?? null,
      }),
    [decision.type, decision.action],
  );
  const rsvpActionParamsHtmlLink = useMemo(() => {
    if (!isRsvp) return null;
    const p = decision.action?.params;
    if (!p || typeof p !== "object") return null;
    const link = (p as Record<string, unknown>).htmlLink;
    return typeof link === "string" && link.trim().length > 0
      ? link.trim()
      : null;
  }, [isRsvp, decision.action]);

  async function act(action: LoopActionKind) {
    if (decision.status !== "pending") return;
    setPendingAction(action);
    try {
      const res = await fetch(`/api/loop/decision/${decision.id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        toast({
          type: "error",
          description: t("loop.actionFailed", "Action failed: {{msg}}", {
            msg: data?.error ?? res.statusText,
          }),
        });
      } else {
        const labels: Record<LoopActionKind, string> = {
          dry: t("loop.dryRan", "Dry run completed"),
          run: t("loop.ran", "Decision executed"),
          dismiss: t("loop.dismissed", "Dismissed"),
          promote: t("loop.promoted", "Promoted"),
          rsvp_attend: t("loop.rsvp.attended", "Attending"),
          rsvp_decline: t("loop.rsvp.declined", "Declined"),
        };
        toast({ type: "success", description: labels[action] });
        onChange?.();
      }
    } catch (e) {
      toast({
        type: "error",
        description: t("loop.actionFailed", "Action failed: {{msg}}", {
          msg: e instanceof Error ? e.message : "unknown",
        }),
      });
    } finally {
      setPendingAction(null);
    }
  }

  function openOriginal() {
    if (rsvpActionParamsHtmlLink) {
      window.open(rsvpActionParamsHtmlLink, "_blank", "noopener,noreferrer");
      return;
    }
    router.push(`/loop/${decision.id}`);
  }

  if (compact) {
    return (
      <button
        type="button"
        onClick={() => router.push(`/loop/${decision.id}`)}
        className={cn(
          "flex w-full items-start gap-3 rounded-md border bg-card p-3 text-left transition hover:border-primary/40 hover:bg-accent/30",
          className,
        )}
      >
        <RemixIcon name={typeIcon} className="mt-0.5 size-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="line-clamp-1 text-sm font-medium">
            {decision.title}
          </div>
          <div className="line-clamp-1 text-xs text-muted-foreground">
            {decidePrompt ?? dialogue}
          </div>
        </div>
        <span
          className={cn(
            "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold",
            stateTone(state),
          )}
        >
          {t(stateMeta.key, stateMeta.fallback)}
        </span>
      </button>
    );
  }

  const isPending = decision.status === "pending";
  const chain = buildChain(decision);
  // #378 — quiet_digest has no executable action, so the Run / Dry / Edit
  // row never renders for it. The card still gets a single local dismiss
  // button (relabelled "Mark as read" for github-notifications below).
  const showRunControls = isPending && !isRsvp && !isQuietDigest;
  const showRsvpControls = isPending && isRsvp;

  return (
    <article
      className={cn(
        "flex flex-col gap-4 rounded-lg border bg-card p-5 shadow-sm",
        decision.status === "dismissed" && "opacity-60",
        className,
      )}
    >
      {/* ── Layer 1: Header row ─────────────────────────────────────── */}
      <header className="flex items-start gap-3">
        <div
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-md",
            priorityCls,
          )}
        >
          <RemixIcon name={typeIcon} className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {/* RSVP gets a friendlier label than the raw `RSVP` type id. */}
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {isRsvp
                ? t("loop.rsvp.invitationLabel", "Calendar invitation")
                : typeLabel}
            </span>
            {/* Primary decision surface — plain-language readiness state. */}
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                stateTone(state),
              )}
            >
              {t(stateMeta.key, stateMeta.fallback)}
            </span>
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                priorityCls,
              )}
            >
              {priority}
            </span>
            {/* Classification confidence — diagnostic, kept muted + secondary. */}
            {decision.confidence != null && (
              <span
                className="ml-auto text-[10px] font-medium text-muted-foreground"
                title={t(
                  "loop.confidenceDiagnostic",
                  "Classification confidence (diagnostic — not urgency)",
                )}
              >
                {t("loop.confidenceShort", "conf {{n}}", {
                  n: decision.confidence.toFixed(2),
                })}
              </span>
            )}
            {/* #363 — card-level dismissal lives here so it never gets
                confused with the decision-action row below. */}
            {isPending && <CardKebab decision={decision} />}
          </div>
          <h3 className="mt-1 text-base font-semibold leading-snug">
            {decision.title}
          </h3>
        </div>
      </header>

      {/* ── Layer 2: Decision prompt ────────────────────────────────── */}
      {decidePrompt ? (
        <p className="text-sm leading-snug text-foreground/90">
          {decidePrompt}
        </p>
      ) : (
        <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm text-foreground/90">
          {dialogue}
        </div>
      )}

      {/* ── Layer 3: Decision context ───────────────────────────────── */}
      {isPending && decisionContext && (
        <DecisionContextBlock context={decisionContext} />
      )}

      {/* ── Layer 4: Readiness callout ───────────────────────────────── */}
      {isPending && readiness.status === "needs_context" && (
        <div className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900">
          {t(
            "loop.rsvp.readinessIncomplete",
            "Information incomplete: {{fields}}. Review the original event before responding.",
            {
              fields: (readiness.missing ?? []).join(", "),
            },
          )}
        </div>
      )}
      {isPending && readiness.status === "ready" && (
        <p className="text-[11px] text-muted-foreground">
          {t(
            "loop.rsvp.readinessSufficient",
            "Information is sufficient to decide.",
          )}
        </p>
      )}

      {/* ── Layer 5: Provenance (collapsed) ──────────────────────────── */}
      {isPending &&
        (chain.length > 0 || whyBullets.length > 0 || decision.action) && (
          <details className="rounded-md border bg-muted/10 px-3 py-2 text-xs">
            <summary className="cursor-pointer select-none font-medium text-muted-foreground">
              {t("loop.rsvp.technicalDetails", "Technical details")}
            </summary>
            <div className="mt-3 flex flex-col gap-3">
              {chain.length > 0 && (
                <section>
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {t("loop.sourceChain", "Source chain")}
                  </div>
                  <LoopSourceChain nodes={chain} />
                </section>
              )}
              {whyBullets.length > 0 && (
                <section>
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {t("loop.why", "Why this surfaced")}
                  </div>
                  <ul className="space-y-1 text-[11px] text-muted-foreground">
                    {whyBullets.slice(0, 6).map((w) => (
                      <li key={w} className="flex items-start gap-1.5">
                        <span className="mt-1 inline-block size-1.5 shrink-0 rounded-full bg-primary/60" />
                        <span>{w}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {decision.action && (
                <section>
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {t("loop.detail.actionLabel", "Action")}
                  </div>
                  <pre className="max-h-48 overflow-auto rounded-md border bg-background/60 p-2 text-[11px] leading-relaxed">
                    <code>
                      {JSON.stringify(
                        {
                          kind: decision.action.kind,
                          params: decision.action.params,
                        },
                        null,
                        2,
                      )}
                    </code>
                  </pre>
                </section>
              )}
            </div>
          </details>
        )}

      {/* #364 — pending-action banner + immutable attempt history.
          When the schedule route has locked the decision on a
          scheduled job, surface that as a banner above the action
          row so the user knows another click is queued. The history
          strip below shows every attempt (including cancelled /
          superseded) so a contradictory earlier execution is never
          hidden by the latest overwrite. */}
      {isPending && decision.pending_action && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <div className="flex items-center gap-1.5 font-medium">
            <RemixIcon name="ri-time-line" className="size-3.5" />
            <span>
              {t(
                "loop.card.actionScheduled",
                "Action scheduled: {{verb}} — fires in 30s. Tap Cancel to stop it.",
                {
                  verb:
                    decision.pending_action.action === "run"
                      ? t("loop.run", "Run")
                      : decision.pending_action.action === "dismiss"
                        ? t("loop.dismiss", "Dismiss")
                        : decision.pending_action.action,
                },
              )}
            </span>
          </div>
        </div>
      )}
      {decision.sub_actions && decision.sub_actions.length > 0 && (
        <SubActionsHistory
          records={decision.sub_actions}
          pendingAction={decision.pending_action ?? null}
        />
      )}

      {/* ── Layer 6: Actions ────────────────────────────────────────── */}
      {isPending && showRsvpControls && (
        <footer className="flex flex-col gap-2 border-t pt-3">
          {/* #358 — when a previous run was blocked/failed, surface the
              structured reason from `execution`. The RSVP control row
              below stays so a retry is one tap. */}
          {(decision.execution?.outcome === "blocked" ||
            decision.execution?.outcome === "failed" ||
            decision.context?.last_error) && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              <RemixIcon
                name="ri-error-warning-line"
                className="mt-0.5 size-3.5 shrink-0"
              />
              <span className="break-words">
                {t(
                  "loop.lastAttemptFailed",
                  "Last attempt failed: {{reason}} — retry Run below.",
                  {
                    reason:
                      decision.execution?.reason ??
                      (typeof decision.context?.last_error === "string"
                        ? decision.context.last_error
                        : decision.execution?.outcome),
                  },
                )}
              </span>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {/* #363 — when readiness is not_actionable the only sensible
                action is to look at the source event. The Attend/Decline
                row would otherwise let the user trigger an external write
                that the runner would refuse anyway. */}
            {state !== "not_actionable" ? (
              <>
                <ActionButton
                  icon="ri-check-line"
                  label={t("loop.rsvp.attend", "Attend")}
                  variant="default"
                  onClick={() => act("rsvp_attend")}
                  pending={pendingAction === "rsvp_attend"}
                />
                <ActionButton
                  icon="ri-close-line"
                  label={t("loop.rsvp.decline", "Decline")}
                  variant="outline"
                  onClick={() => act("rsvp_decline")}
                  pending={pendingAction === "rsvp_decline"}
                />
              </>
            ) : null}
            <ActionButton
              icon="ri-external-link-line"
              label={t("loop.rsvp.viewOriginal", "View original")}
              variant="ghost"
              onClick={openOriginal}
            />
            {/* #364 — when a scheduled action is queued, surface a
                dedicated Cancel button so the user can stop a wrong
                choice before the 30s grace elapses. The toast on
                click surfaces the four server response shapes
                (cancelled / already_fired / not_found / error). */}
            <CancelPendingActionButton
              decision={decision}
              onChange={onChange}
            />
            {executable && !isRsvp && (
              <ActionButton
                icon="ri-flask-line"
                label={t("loop.dryRun", "Dry run")}
                variant="outline"
                onClick={() => act("dry")}
                pending={pendingAction === "dry"}
              />
            )}
          </div>
        </footer>
      )}

      {isPending && showRunControls && (
        <footer className="flex flex-col gap-2 border-t pt-3">
          {/* #358 — when a previous run was blocked/failed, surface the
              structured reason from `execution` (falls back to the legacy
              `context.last_error` for rows that predate the verdict field).
              Action buttons remain so a retry is one tap. */}
          {(decision.execution?.outcome === "blocked" ||
            decision.execution?.outcome === "failed" ||
            decision.context?.last_error) && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              <RemixIcon
                name="ri-error-warning-line"
                className="mt-0.5 size-3.5 shrink-0"
              />
              <span className="break-words">
                {decision.execution?.outcome === "blocked" ||
                decision.execution?.outcome === "failed"
                  ? t(
                      "loop.lastAttemptFailed",
                      "Last attempt failed: {{reason}} — retry Run below.",
                      {
                        reason:
                          decision.execution?.reason ??
                          (typeof decision.context?.last_error === "string"
                            ? decision.context.last_error
                            : decision.execution?.outcome),
                      },
                    )
                  : typeof decision.context?.last_error === "string"
                    ? decision.context.last_error
                    : ""}
              </span>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <ActionButton
              icon="ri-flask-line"
              label={t("loop.dryRun", "Dry run")}
              variant="outline"
              onClick={() => act("dry")}
              pending={pendingAction === "dry"}
            />
            <ActionButton
              icon="ri-pencil-line"
              label={t("loop.edit", "Edit")}
              variant="ghost"
              onClick={() => router.push(`/loop/${decision.id}?edit=1`)}
            />
            {/* #359 — a non-actionable decision must not expose a default Run.
                For ready/needs_context we still show Run, but demote it from
                the default CTA when the card isn't cleanly "ready". */}
            {executable && (
              <ActionButton
                icon="ri-play-line"
                label={
                  state === "confirm"
                    ? t("loop.confirmRun", "Confirm & run")
                    : t("loop.run", "Run")
                }
                variant={state === "ready" ? "default" : "outline"}
                onClick={() => act("run")}
                pending={pendingAction === "run"}
              />
            )}
            {/* Legacy Dismiss stays inline for non-RSVP types since the
                card-level kebab is RSVP-only (#363 scope). */}
            <ActionButton
              icon="ri-eye-off-line"
              label={t("loop.dismiss", "Dismiss")}
              variant="ghost"
              onClick={() => act("dismiss")}
              pending={pendingAction === "dismiss"}
            />
            {/* #364 — same Cancel affordance as the RSVP row. */}
            <CancelPendingActionButton
              decision={decision}
              onChange={onChange}
            />
          </div>
        </footer>
      )}

      {/* #378 — quiet_digest cards are read-only summaries. The footer
          offers a single local "Mark as read" button (relabelled from the
          generic "Dismiss" for the github-notifications module) so the
          user can clear the digest without ever exposing a Run control. */}
      {isPending && isQuietDigest && (
        <footer className="flex flex-col gap-2 border-t pt-3">
          {/* Render the bounded item list when present so the web card
              mirrors the pet bubble's grouped GitHub summary. Each item
              shows repo, title, and (when derivable) a validated HTTPS
              link to the thread. */}
          {quietDigestItems.length > 0 ? (
            <ul className="flex flex-col gap-1.5 text-xs">
              {quietDigestItems.map((it, idx) => {
                const title =
                  typeof it.title === "string" ? it.title : "GitHub update";
                const repo = typeof it.repo === "string" ? it.repo : "unknown";
                const summary =
                  typeof it.summary === "string" ? it.summary : "";
                const rawUrl =
                  typeof it.url === "string" && it.url.startsWith("https://")
                    ? it.url
                    : null;
                const githubUrl = rawUrl?.startsWith("https://github.com/")
                  ? rawUrl
                  : null;
                const href =
                  githubUrl ??
                  (isGithubQuietDigest
                    ? "https://github.com/notifications"
                    : rawUrl);
                const kindLabel = githubUrl
                  ? t("loop.quietDigest.openIssue", "Open on GitHub")
                  : isGithubQuietDigest
                    ? t(
                        "loop.quietDigest.openNotifications",
                        "Open notifications",
                      )
                    : t("loop.quietDigest.openLink", "Open");
                return (
                  <li
                    key={`${repo}-${idx}-${title}`}
                    className="flex flex-col gap-0.5 rounded-md border bg-muted/30 px-2 py-1.5"
                  >
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        {repo}
                      </span>
                      <span className="text-sm font-medium leading-snug">
                        {title}
                      </span>
                      {href && (
                        <a
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="ml-auto text-[10px] font-medium text-primary hover:underline"
                        >
                          {kindLabel} ↗
                        </a>
                      )}
                    </div>
                    {summary && (
                      <span className="text-xs text-muted-foreground">
                        {summary}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : isGithubQuietDigest ? (
            <div className="flex flex-col gap-1 rounded-md border bg-muted/30 px-2 py-1.5 text-xs">
              <span className="text-sm font-medium leading-snug">
                {t(
                  "loop.quietDigest.githubDetailsUnavailable",
                  "GitHub notification details unavailable",
                )}
              </span>
              <span className="text-xs text-muted-foreground">
                {t(
                  "loop.quietDigest.githubDetailsUnavailableBody",
                  "OpenLoomi saw unread GitHub notifications, but this card did not receive the item details.",
                )}
              </span>
              <a
                href="https://github.com/notifications"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[10px] font-medium text-primary hover:underline"
              >
                {t("loop.quietDigest.openNotifications", "Open notifications")}
              </a>
            </div>
          ) : null}
          <div className="flex flex-wrap items-center justify-end gap-2">
            {/* #378 — github-notifications digest relabels Dismiss → "Mark
                as read". Other quiet_digest modules keep the legacy
                "Dismiss" label since the existing copy still fits. */}
            <ActionButton
              icon="ri-check-line"
              label={
                isGithubQuietDigest
                  ? t("loop.quietDigest.markAsRead", "Mark as read")
                  : t("loop.dismiss", "Dismiss")
              }
              variant="default"
              onClick={() => act("dismiss")}
              pending={pendingAction === "dismiss"}
            />
          </div>
        </footer>
      )}

      {/* Status footer (done/dismissed) — unchanged. */}
      {!isPending && (
        <footer className="flex flex-col gap-2 border-t pt-3 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <RemixIcon
              name={
                decision.status === "done"
                  ? decision.execution?.outcome === "skipped"
                    ? "ri-checkbox-circle-line"
                    : "ri-check-double-line"
                  : "ri-eye-off-line"
              }
              className="size-3.5"
            />
            {decision.status === "done" ? (
              decision.execution?.outcome === "skipped" ? (
                <span>
                  {t("loop.outcome.skipped", "Skipped")} —{" "}
                  {decision.execution?.reason ??
                    t("loop.outcome.reason", "Reason: {{reason}}", {
                      reason: t("loop.outcome.skipped", "Skipped"),
                    })}
                </span>
              ) : (
                <span>
                  {t("loop.ranAt", "Ran at {{ts}}", {
                    ts: decision.completed_at ?? decision.ts,
                  })}
                </span>
              )
            ) : (
              <span>{t("loop.dismissedAt", "Dismissed")}</span>
            )}
            {/* #358 — small "Executed" badge so the done footer is
                unambiguous about what kind of done it was. */}
            {decision.status === "done" &&
              decision.execution?.outcome === "executed" && (
                <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
                  {t("loop.detail.executedBadge", "Executed")}
                </span>
              )}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => router.push(`/loop/${decision.id}`)}
              className="ml-auto"
            >
              {t("loop.viewDetails", "View details")}
              <RemixIcon name="ri-arrow-right-line" className="ml-1 size-3.5" />
            </Button>
          </div>
        </footer>
      )}
    </article>
  );
}

function buildChain(decision: LoopDecisionCardData): SourceChainNode[] {
  const fromCard = decision.source_chain;
  if (Array.isArray(fromCard) && fromCard.length > 0) {
    return fromCard
      .filter((n): n is SourceChainNode => typeof n !== "string")
      .map((n) => ({
        icon: n.icon ?? "ri-link",
        label: n.label,
        sublabel: n.sublabel,
        tone: n.tone,
      }));
  }
  const sig = decision.source_signal;
  if (!sig) return [];
  const nodes: SourceChainNode[] = [];
  nodes.push({
    icon: sourceIcon(sig.source),
    label: sig.source,
    sublabel: sig.type,
  });
  const person = decision.context?.person;
  if (typeof person === "string" && person) {
    nodes.push({
      icon: "ri-user-line",
      label: person,
      tone: "muted",
    });
  }
  const proj = decision.context?.project_ref;
  if (typeof proj === "string" && proj) {
    nodes.push({
      icon: "ri-folder-line",
      label: proj,
      tone: "muted",
    });
  }
  const mem = decision.context?.memory_refs ?? [];
  for (const m of mem.slice(0, 2)) {
    nodes.push({
      icon: "ri-brain-line",
      label: m,
      tone: "muted",
    });
  }
  return nodes;
}

function sourceIcon(source: string): string {
  switch (source) {
    case "gmail":
      return "ri-mail-line";
    case "slack":
      return "ri-slack-line";
    case "github":
      return "ri-github-line";
    case "linear":
      return "ri-list-check-2";
    case "calendar":
    case "google_calendar":
      return "ri-calendar-line";
    case "obsidian":
      return "ri-file-2-line";
    default:
      return "ri-pulse-line";
  }
}
