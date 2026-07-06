"use client";

/**
 * Dry-run preview pane — shows the agent's plan / draft that was attached to
 * `decision.context.dry_run`. Read-only display plus a "Run dry" action that
 * re-triggers the dry run through the action API.
 *
 * Three states:
 *  - empty    : never run; show empty state + the "Run dry" button
 *  - running  : request in flight, show inline spinner
 *  - ready    : context.dry_run populated, render as a code block
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Badge, Button } from "@openloomi/ui";
import { RemixIcon } from "@/components/remix-icon";
import { Spinner } from "@/components/spinner";
import { toast } from "@/components/toast";

import { cn } from "@/lib/utils";

interface DryRunPreviewProps {
  decisionId: string;
  /** Latest cached dry-run output from `decision.context.dry_run` (string). */
  cached?: string | null;
  /** Called after a successful dry-run so the parent can re-fetch decision. */
  onRanDry?: () => void;
  className?: string;
}

export function DryRunPreview({
  decisionId,
  cached,
  onRanDry,
  className,
}: DryRunPreviewProps) {
  const { t } = useTranslation();
  const [running, setRunning] = useState(false);
  const [text, setText] = useState<string | null>(cached ?? null);

  // Sync external state (parent re-fetched decision).
  if (cached != null && text !== cached && !running) {
    setText(cached);
  }

  async function runDry() {
    setRunning(true);
    try {
      const res = await fetch(`/api/loop/decision/${decisionId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "dry" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        toast({
          type: "error",
          description:
            data?.error ??
            t("loop.detail.dryFailed", "Dry run failed: {{msg}}", {
              msg: res.statusText,
            }),
        });
        return;
      }
      const next =
        typeof data?.decision?.context?.dry_run === "string"
          ? data.decision.context.dry_run
          : null;
      setText(next);
      onRanDry?.();
      toast({
        type: "success",
        description: t(
          "loop.detail.dryDone",
          "Dry run ready · review the plan, then hit Run.",
        ),
      });
    } catch (e) {
      toast({
        type: "error",
        description: t("loop.detail.dryFailed", "Dry run failed: {{msg}}", {
          msg: e instanceof Error ? e.message : "unknown",
        }),
      });
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className={cn("rounded-lg border bg-card p-4 shadow-sm", className)}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {t("loop.detail.dryRunLabel", "Dry run plan")}
        </span>
        {text ? (
          <Badge variant="secondary" className="gap-1">
            <RemixIcon name="ri-flask-line" className="size-3" />
            {t("loop.detail.dryReady", "Ready")}
          </Badge>
        ) : null}
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={runDry}
          disabled={running}
          className="ml-auto gap-1.5"
        >
          {running ? (
            <Spinner size={14} label="" className="!size-3.5" />
          ) : (
            <RemixIcon name="ri-flask-line" className="size-3.5" />
          )}
          {running
            ? t("loop.detail.dryRunning", "Running…")
            : text
              ? t("loop.detail.dryRerun", "Re-run dry")
              : t("loop.detail.dryRunButton", "Run dry")}
        </Button>
      </div>

      {running && !text && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Spinner size={14} />
          {t(
            "loop.detail.dryWaiting",
            "Agent is working on the plan. This takes a few seconds…",
          )}
        </div>
      )}

      {text ? (
        <pre className="max-h-96 overflow-auto rounded-md border bg-muted/40 p-3 text-xs leading-relaxed text-foreground/90">
          <code>{text}</code>
        </pre>
      ) : !running ? (
        <div className="rounded-md border border-dashed bg-muted/20 px-3 py-4 text-center text-xs text-muted-foreground">
          {t(
            "loop.detail.dryEmpty",
            "No plan yet. Hit Run dry to have the agent draft what it would do — without committing anything.",
          )}
        </div>
      ) : null}
    </div>
  );
}
