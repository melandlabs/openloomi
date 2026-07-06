"use client";

/**
 * Loop detail workspace — the rich drill-down view of one decision. B3.
 *
 * Layout (lg+):
 *   ┌─ Main (2fr) ────────────────────────┐ ┌─ Sidebar (1fr) ─────────┐
 *   │ Header (type · title · conf · prio) │ │ Why this surfaced       │
 *   │ Dialogue bubble                     │ │ Memory chips            │
 *   │ ┌ Action block (status-dependent) ┐ │ │ Source signal           │
 *   │ │  pending → DryRunPreview +      │ │ │ Metadata (id, ts, etc.) │
 *   │ │            ActionParamsViewer + │ │ └─────────────────────────┘
 *   │ │            Run / Dismiss footer │
 *   │ │  done     → Result panel + "ran │
 *   │ │            at" footer           │
 *   │ │  dismissed → Reason + Promote   │
 *   │ └─────────────────────────────────┘ │
 *   │ DecisionCard (full)                  │
 *   └───────────────────────────────────────┘
 *
 * On narrow widths the sidebar collapses under the main column. Action
 * callbacks refresh the whole workspace through the `onChange` prop.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";

import { Badge, Button } from "@openloomi/ui";

import { RemixIcon } from "@/components/remix-icon";
import { Spinner } from "@/components/spinner";
import { toast } from "@/components/toast";

import {
  DecisionCard,
  type LoopDecisionCardData,
} from "@/components/loop/decision-card";
import {
  LoopSourceChain,
  type SourceChainNode,
} from "@/components/loop/source-chain";
import { DryRunPreview } from "@/components/loop/dry-run-preview";
import { DismissInput } from "@/components/loop/dismiss-input";
import { ActionParamsViewer } from "@/components/loop/action-params-viewer";
import { MemoryChips } from "@/components/loop/memory-chips";

import { cn } from "@/lib/utils";

interface LoopDetailWorkspaceProps {
  decision: LoopDecisionCardData;
  onRefresh: () => Promise<void> | void;
}

const STATUS_TONE: Record<
  LoopDecisionCardData["status"],
  { className: string; icon: string; label: string }
> = {
  pending: {
    className: "border-amber-300 bg-amber-50 text-amber-800",
    icon: "ri-time-line",
    label: "Pending",
  },
  done: {
    className: "border-emerald-300 bg-emerald-50 text-emerald-800",
    icon: "ri-check-double-line",
    label: "Done",
  },
  dismissed: {
    className: "border-slate-300 bg-slate-100 text-slate-700",
    icon: "ri-eye-off-line",
    label: "Dismissed",
  },
};

function priorityFromConfidence(c?: number): "P0" | "P1" | "P2" {
  if (c == null) return "P2";
  if (c >= 0.85) return "P0";
  if (c >= 0.75) return "P1";
  return "P2";
}

function priorityClass(p: "P0" | "P1" | "P2"): string {
  if (p === "P0") return "bg-red-100 text-red-700";
  if (p === "P1") return "bg-amber-100 text-amber-700";
  return "bg-muted text-muted-foreground";
}

function formatResult(result: unknown): string {
  if (result == null) return "";
  if (typeof result === "string") return result;
  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return String(result);
  }
}

function formatTs(ts?: string): string {
  if (!ts) return "—";
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return ts;
  }
}

function buildChainFromCard(decision: LoopDecisionCardData): SourceChainNode[] {
  // `source_chain` from /api/loop/card/[id] is `string[]` (source / type / ts).
  // Fall back to a single source_signal node when the card endpoint is
  // unavailable or didn't populate it.
  const fromCard = decision.source_chain;
  if (Array.isArray(fromCard) && fromCard.length > 0) {
    const [source, kind, when] = fromCard as string[];
    const nodes: SourceChainNode[] = [];
    if (source) {
      nodes.push({
        icon: sourceIcon(source),
        label: source,
        sublabel: kind,
      });
    }
    const person = decision.context?.person;
    if (typeof person === "string" && person) {
      nodes.push({ icon: "ri-user-line", label: person, tone: "muted" });
    }
    const proj = decision.context?.project_ref;
    if (typeof proj === "string" && proj) {
      nodes.push({ icon: "ri-folder-line", label: proj, tone: "muted" });
    }
    if (when) {
      nodes.push({
        icon: "ri-time-line",
        label: when,
        tone: "muted",
      });
    }
    return nodes;
  }
  return [];
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

export function LoopDetailWorkspace({
  decision,
  onRefresh,
}: LoopDetailWorkspaceProps) {
  const router = useRouter();
  const { t } = useTranslation();
  const [running, setRunning] = useState(false);
  const [promoting, setPromoting] = useState(false);

  const status = decision.status;
  const statusMeta = STATUS_TONE[status];
  const priority = priorityFromConfidence(decision.confidence);
  const dryRunText =
    typeof decision.context?.dry_run === "string"
      ? decision.context.dry_run
      : null;
  const lastError =
    typeof decision.context?.last_error === "string"
      ? decision.context.last_error
      : null;
  const result = decision.result;

  const whyBullets =
    decision.why ?? (decision.context?.why as string[] | undefined) ?? [];
  const chain = buildChainFromCard(decision);

  async function runNow() {
    if (status !== "pending") return;
    setRunning(true);
    try {
      const res = await fetch(`/api/loop/decision/${decision.id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "run" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        toast({
          type: "error",
          description: t("loop.detail.runFailed", "Run failed: {{msg}}", {
            msg: data?.error ?? res.statusText,
          }),
        });
        return;
      }
      toast({
        type: "success",
        description: t("loop.detail.ranToast", "Decision executed"),
      });
      await onRefresh();
    } catch (e) {
      toast({
        type: "error",
        description: t("loop.detail.runFailed", "Run failed: {{msg}}", {
          msg: e instanceof Error ? e.message : "unknown",
        }),
      });
    } finally {
      setRunning(false);
    }
  }

  async function promote() {
    if (status !== "dismissed") return;
    setPromoting(true);
    try {
      const res = await fetch(`/api/loop/decision/${decision.id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "promote" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        toast({
          type: "error",
          description: t(
            "loop.detail.promoteFailed",
            "Promote failed: {{msg}}",
            { msg: data?.error ?? res.statusText },
          ),
        });
        return;
      }
      toast({
        type: "success",
        description: t("loop.detail.promotedToast", "Back to pending"),
      });
      await onRefresh();
    } catch (e) {
      toast({
        type: "error",
        description: t("loop.detail.promoteFailed", "Promote failed: {{msg}}", {
          msg: e instanceof Error ? e.message : "unknown",
        }),
      });
    } finally {
      setPromoting(false);
    }
  }

  return (
    <div className="mx-auto grid w-full max-w-6xl gap-4 lg:grid-cols-[minmax(0,2fr)_320px]">
      {/* ── Main column ───────────────────────────────────────── */}
      <div className="flex min-w-0 flex-col gap-4">
        {/* Header */}
        <div className="flex flex-col gap-3 rounded-lg border bg-card p-5 shadow-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
                statusMeta.className,
              )}
            >
              <RemixIcon name={statusMeta.icon} className="size-3" />
              {t(`loop.detail.statusLabel.${status}`, statusMeta.label)}
            </span>
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                priorityClass(priority),
              )}
            >
              {priority}
            </span>
            <span className="text-xs uppercase tracking-wide text-muted-foreground">
              {decision.type}
            </span>
            {decision.confidence != null && (
              <Badge variant="secondary" className="ml-auto">
                {t("loop.detail.confidenceBadge", "conf {{n}}", {
                  n: decision.confidence.toFixed(2),
                })}
              </Badge>
            )}
          </div>
          <h2 className="text-xl font-semibold leading-tight">
            {decision.title}
          </h2>
          <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <RemixIcon name="ri-time-line" className="size-3" />
              {t("loop.detail.created", "Created {{ts}}", {
                ts: formatTs(decision.ts),
              })}
            </span>
            <span className="font-mono opacity-70">#{decision.id}</span>
          </div>
        </div>

        {/* Dialogue bubble */}
        {decision.dialogue && (
          <div className="rounded-lg border bg-muted/40 px-4 py-3 text-sm leading-relaxed text-foreground/90 shadow-sm">
            {decision.dialogue}
          </div>
        )}

        {/* Source chain (if any) */}
        {chain.length > 0 && (
          <section className="rounded-lg border bg-card p-4 shadow-sm">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t("loop.sourceChain", "Source chain")}
            </div>
            <LoopSourceChain nodes={chain} />
          </section>
        )}

        {/* Status-dependent action block */}
        {status === "pending" && (
          <div className="flex flex-col gap-3">
            <DryRunPreview
              decisionId={decision.id}
              cached={dryRunText}
              onRanDry={() => void onRefresh()}
            />
            <ActionParamsViewer
              action={
                decision.action
                  ? {
                      kind: decision.action.kind,
                      params: decision.action.params as Record<string, unknown>,
                    }
                  : undefined
              }
            />

            {/* Action footer */}
            <div className="flex flex-col gap-3 rounded-lg border bg-card p-4 shadow-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="default"
                  onClick={runNow}
                  disabled={running}
                  className="gap-1.5"
                >
                  {running ? (
                    <Spinner size={14} label="" className="!size-3.5" />
                  ) : (
                    <RemixIcon name="ri-play-line" className="size-3.5" />
                  )}
                  {running
                    ? t("loop.detail.running", "Running…")
                    : t("loop.detail.runButton", "Run")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => router.push(`/loop/${decision.id}?edit=1`)}
                  className="gap-1.5"
                >
                  <RemixIcon name="ri-pencil-line" className="size-3.5" />
                  {t("loop.detail.editButton", "Edit")}
                </Button>
                <div className="ml-auto">
                  <DismissInput
                    decisionId={decision.id}
                    onDismissed={() => void onRefresh()}
                  />
                </div>
              </div>
              {lastError && (
                <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                  <RemixIcon
                    name="ri-error-warning-line"
                    className="mt-0.5 size-3.5 shrink-0"
                  />
                  <span className="break-words">{lastError}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {status === "done" && (
          <div className="flex flex-col gap-3 rounded-lg border bg-card p-4 shadow-sm">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <RemixIcon name="ri-check-double-line" className="size-3.5" />
              {t("loop.detail.resultLabel", "Result")}
            </div>
            {formatResult(result).trim() ? (
              <pre className="max-h-96 overflow-auto rounded-md border bg-muted/40 p-3 text-xs leading-relaxed text-foreground/90">
                <code>{formatResult(result)}</code>
              </pre>
            ) : (
              <div className="rounded-md border border-dashed bg-muted/20 px-3 py-4 text-center text-xs text-muted-foreground">
                {t(
                  "loop.detail.noResult",
                  "Ran without attaching a result payload — check the agent logs.",
                )}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <RemixIcon name="ri-time-line" className="size-3" />
                {t("loop.detail.ranAt", "Ran at {{ts}}", {
                  ts: formatTs(decision.completed_at ?? decision.ts),
                })}
              </span>
            </div>
          </div>
        )}

        {status === "dismissed" && (
          <div className="flex flex-col gap-3 rounded-lg border bg-card p-4 shadow-sm">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <RemixIcon name="ri-eye-off-line" className="size-3.5" />
              {t("loop.detail.dismissedLabel", "Dismissed")}
            </div>
            {typeof result === "string" && result.trim() ? (
              <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs italic text-foreground/80">
                {result}
              </div>
            ) : (
              <div className="text-xs text-muted-foreground">
                {t("loop.detail.dismissedNoReason", "No reason recorded.")}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={promote}
                disabled={promoting}
                className="gap-1.5"
              >
                {promoting ? (
                  <Spinner size={14} label="" className="!size-3.5" />
                ) : (
                  <RemixIcon
                    name="ri-arrow-go-back-line"
                    className="size-3.5"
                  />
                )}
                {t("loop.detail.promote", "Promote back to pending")}
              </Button>
            </div>
          </div>
        )}

        {/* DecisionCard as a fallback / full-card view — kept because the
            source-chain / why rendering still lives there. */}
        <DecisionCard decision={decision} onChange={() => void onRefresh()} />
      </div>

      {/* ── Sidebar ─────────────────────────────────────────────── */}
      <aside className="flex min-w-0 flex-col gap-4">
        <section className="rounded-lg border bg-card p-4 shadow-sm">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t("loop.detail.whyLabel", "Why this surfaced")}
          </div>
          {whyBullets.length > 0 ? (
            <ul className="space-y-1.5 text-xs text-foreground/80">
              {whyBullets.map((w) => (
                <li key={w} className="flex items-start gap-2">
                  <span className="mt-1.5 inline-block size-1.5 shrink-0 rounded-full bg-primary/60" />
                  <span>{w}</span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="text-xs text-muted-foreground">
              {t("loop.detail.noWhy", "No notes yet.")}
            </div>
          )}
        </section>

        <section className="rounded-lg border bg-card p-4 shadow-sm">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t("loop.detail.contextLabel", "Context")}
          </div>
          <MemoryChips
            memoryRefs={
              (decision.context?.memory_refs as string[] | undefined) ?? []
            }
            insightRefs={
              (decision.context?.insight_refs as string[] | undefined) ?? []
            }
            projectRef={
              typeof decision.context?.project_ref === "string"
                ? decision.context.project_ref
                : null
            }
            person={
              typeof decision.context?.person === "string"
                ? decision.context.person
                : null
            }
          />
        </section>

        {decision.source_signal && (
          <section className="rounded-lg border bg-card p-4 shadow-sm">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t("loop.detail.sourceSignal", "Source signal")}
            </div>
            <div className="flex items-start gap-2 text-xs">
              <RemixIcon
                name={sourceIcon(decision.source_signal.source)}
                className="mt-0.5 size-4 shrink-0 text-muted-foreground"
              />
              <div className="min-w-0 flex-1">
                <div className="font-medium">
                  {decision.source_signal.source} ·{" "}
                  {decision.source_signal.type}
                </div>
                {decision.source_signal.ts && (
                  <div className="text-[11px] text-muted-foreground">
                    {formatTs(decision.source_signal.ts)}
                  </div>
                )}
              </div>
            </div>
          </section>
        )}

        <section className="rounded-lg border bg-card p-4 shadow-sm text-xs text-muted-foreground">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide">
            {t("loop.detail.metaLabel", "Meta")}
          </div>
          <div className="space-y-1 font-mono">
            <div className="break-all">id: {decision.id}</div>
            <div>type: {decision.type}</div>
          </div>
        </section>
      </aside>
    </div>
  );
}
