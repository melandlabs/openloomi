"use client";

/**
 * Action params viewer — renders `decision.action` (kind + params) as a
 * monospace JSON block with a copy button. Read-only in B3: editing params
 * before a Run would require a backend change (runner always uses the saved
 * params), so we surface the action for inspection only.
 *
 * If the params object is empty we collapse the block and just show the
 * action kind so the pane doesn't feel like filler.
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Badge, Button } from "@openloomi/ui";
import { RemixIcon } from "@/components/remix-icon";
import { toast } from "@/components/toast";

import { cn } from "@/lib/utils";

interface ActionParamsViewerProps {
  action?: { kind: string; params: Record<string, unknown> };
  className?: string;
}

export function ActionParamsViewer({
  action,
  className,
}: ActionParamsViewerProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);
  const [copied, setCopied] = useState(false);

  if (!action) return null;
  const { kind, params } = action;
  const paramsJson = JSON.stringify(params ?? {}, null, 2);
  const hasParams =
    params != null &&
    typeof params === "object" &&
    !Array.isArray(params) &&
    Object.keys(params as Record<string, unknown>).length > 0;

  async function copy() {
    const blob = JSON.stringify({ kind, params }, null, 2);
    try {
      await navigator.clipboard.writeText(blob);
      setCopied(true);
      toast({
        type: "success",
        description: t(
          "loop.detail.actionCopied",
          "Action copied to clipboard",
        ),
      });
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard denied — no-op */
    }
  }

  return (
    <div className={cn("rounded-lg border bg-card p-4 shadow-sm", className)}>
      <div className="mb-2 flex items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {t("loop.detail.actionLabel", "Action")}
        </span>
        <Badge variant="outline" className="gap-1">
          <RemixIcon name="ri-flashlight-line" className="size-3" />
          {kind || "—"}
        </Badge>
        {hasParams && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setOpen((v) => !v)}
            className="ml-auto"
          >
            <RemixIcon
              name={open ? "ri-eye-off-line" : "ri-eye-line"}
              className="mr-1 size-3.5"
            />
            {open
              ? t("loop.detail.actionHide", "Hide")
              : t("loop.detail.actionShow", "Show")}
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={copy}
          className={hasParams ? "" : "ml-auto"}
        >
          <RemixIcon
            name={copied ? "ri-check-line" : "ri-file-copy-line"}
            className="mr-1 size-3.5"
          />
          {copied
            ? t("loop.detail.actionCopiedShort", "Copied")
            : t("loop.detail.actionCopy", "Copy")}
        </Button>
      </div>
      {hasParams && open && (
        <pre className="max-h-72 overflow-auto rounded-md border bg-muted/40 p-3 text-xs leading-relaxed text-foreground/90">
          <code>{paramsJson}</code>
        </pre>
      )}
      {!hasParams && (
        <div className="text-xs text-muted-foreground">
          {t(
            "loop.detail.noParams",
            "No parameters — the agent will infer what to do from context.",
          )}
        </div>
      )}
    </div>
  );
}
