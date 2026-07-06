"use client";

/**
 * Loop empty state — rendered when the decision feed is empty for a status
 * bucket (e.g. "no pending decisions"). Keeps the page calm when there's
 * nothing to act on; nudge users towards the "Tick now" button so they can
 * verify the pipeline without waiting for the cron.
 */

import { Button } from "@openloomi/ui";
import { RemixIcon } from "@/components/remix-icon";
import { useTranslation } from "react-i18next";

interface LoopEmptyStateProps {
  title: string;
  description: string;
  icon?: string;
  action?: {
    label: string;
    onClick: () => void;
    icon?: string;
  };
}

export function LoopEmptyState({
  title,
  description,
  icon = "ri-inbox-line",
  action,
}: LoopEmptyStateProps) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed bg-card/40 p-10 text-center">
      <RemixIcon name={icon} className="size-8 text-muted-foreground/60" />
      <div className="space-y-1">
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="max-w-sm text-xs text-muted-foreground">{description}</p>
      </div>
      {action && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={action.onClick}
          className="mt-2 gap-1.5"
        >
          <RemixIcon
            name={action.icon ?? "ri-flashlight-line"}
            className="size-3.5"
          />
          {action.label ?? t("loop.empty.runTick", "Run tick")}
        </Button>
      )}
    </div>
  );
}
