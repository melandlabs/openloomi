"use client";

import { useTranslation } from "react-i18next";
import { RemixIcon } from "@/components/remix-icon";
import { Badge, Button, Input } from "@openloomi/ui";
import { Tooltip, TooltipContent, TooltipTrigger } from "@openloomi/ui";
import { InsightBadge } from "@/components/insight-badge";
import { cn } from "@/lib/utils";

/** Color styles corresponding to status, consistent with the design */
export function getTaskStatusColor(status: string | undefined | null): string {
  switch (status) {
    case "completed":
      return "bg-emerald-100 text-emerald-700";
    case "blocked":
      return "bg-rose-100 text-rose-700";
    case "delegated":
      return "bg-orange-100 text-orange-700";
    case "pending":
    default:
      return "bg-orange-100 text-orange-700";
  }
}

/** Shared action item card base props */
export type InsightTaskCardBaseProps = {
  /** Unique card key, used for list */
  cardKey: string;
  /** Title (read-only display or initial value when editing) */
  title: string;
  /** Whether completed */
  isCompleted: boolean;
  /** Whether allowing toggle of completion status */
  canToggleStatus: boolean;
  /** Whether checkbox is loading */
  isLoadingCheckbox?: boolean;
  /** Click checkbox */
  onToggleComplete: () => void;
  /** Priority label (e.g., high/medium/low or null shows -) */
  priorityLabel: string | null;
  /** Priority value, used for InsightBadge priority */
  effectivePriority: "high" | "medium" | "low" | null;
  /** Type label (e.g., My Promise / Waiting for Me) */
  typeLabel: string;
  /** Deadline display text */
  deadlineLabel: string;
  /** Click on entire card */
  onCardClick: () => void;
  /** When true, clicking card does not trigger onCardClick (e.g., when editing title in detail) */
  disableCardClick?: boolean;
  /** Optional: status Badge text, renders status row when appearing together with statusColor */
  statusBadge?: string;
  /** Optional: className color for status Badge */
  statusColor?: string;
  /** Optional: subtitle (e.g., "From: xxx" in right panel) */
  subtitle?: string;
  /** Optional: extra content (responder/followUp/note of detail card, etc.) */
  children?: React.ReactNode;
};

/** Inline editing and one-click execute in detail mode */
export type InsightTaskCardDetailActions = {
  /** Whether editing title state */
  isEditingTitle: boolean;
  /** Current value of edit input */
  editValue: string;
  /** Edit input onChange */
  onEditChange: (value: string) => void;
  /** Save title (Enter / Save button) */
  onEditSave: () => void;
  /** Edit input onBlur */
  onEditBlur: () => void;
  /** Edit input onKeyDown (Enter to save, Escape to cancel) */
  onEditKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  /** Click title to start editing */
  onStartEdit: () => void;
  /** Saving title request in progress */
  isSavingTitle?: boolean;
  /** Whether to show one-click execute button (when not editing) */
  showExecuteButton: boolean;
  /** One-click execute */
  onExecute: () => void;
  /** Whether one-click execute is disabled */
  executeDisabled?: boolean;
};

export type InsightTaskCardProps = InsightTaskCardBaseProps & {
  /** Detail mode: pass to render editable title + Save/one-click execute buttons */
  detailActions?: InsightTaskCardDetailActions | null;
};

/**
 * Shared action item card
 * Used for the action item list in Insight details and the action item panel in the right toolbar, maintaining consistent style and interaction.
 */
export function InsightTaskCard({
  cardKey,
  title,
  isCompleted,
  canToggleStatus,
  isLoadingCheckbox = false,
  onToggleComplete,
  priorityLabel,
  effectivePriority,
  typeLabel,
  deadlineLabel,
  onCardClick,
  disableCardClick = false,
  statusBadge,
  statusColor,
  subtitle,
  children,
  detailActions,
}: InsightTaskCardProps) {
  const { t } = useTranslation();
  const isDetailMode = !!detailActions;

  return (
    <div
      key={cardKey}
      role="button"
      tabIndex={0}
      className={cn(
        "group rounded-xl border border-border/60 bg-white/80 p-3 shadow-sm transition-all cursor-pointer",
        "hover:border-primary/40 hover:shadow-md",
        isCompleted && "opacity-80",
      )}
      onClick={() => {
        if (disableCardClick) return;
        onCardClick();
      }}
      onKeyDown={(e) => {
        if (disableCardClick) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onCardClick();
        }
      }}
    >
      <div className="flex items-start gap-3">
        {/* Checkbox container - circular style, click to complete task */}
        <div
          className="flex items-center justify-center shrink-0 transition-all"
          onClick={(e) => {
            e.stopPropagation();
            if (!canToggleStatus || isLoadingCheckbox) return;
            onToggleComplete();
          }}
          role="button"
        >
          {isCompleted ? (
            <div className="flex size-5 items-center justify-center rounded-full border-2 border-primary bg-primary transition-all">
              <RemixIcon name="check" size="size-3.5" className="text-white" />
            </div>
          ) : (
            <div
              className={cn(
                "flex size-5 items-center justify-center rounded-full border-2 bg-white transition-all",
                canToggleStatus && !isLoadingCheckbox
                  ? "border-gray-300 hover:border-primary/50 cursor-pointer"
                  : "border-gray-300 cursor-not-allowed opacity-50",
              )}
            />
          )}
        </div>
        <div className="flex-1 min-w-0 space-y-2">
          {/* First row: title + save/quick execute in detail mode */}
          <div className="flex items-center gap-2">
            <div className="flex-1 min-w-0">
              {isDetailMode && detailActions?.isEditingTitle ? (
                <Input
                  value={detailActions.editValue}
                  onChange={(e) => detailActions.onEditChange(e.target.value)}
                  onBlur={detailActions.onEditBlur}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      e.stopPropagation();
                      detailActions.onEditSave();
                    }
                    if (e.key === "Escape") {
                      e.preventDefault();
                      e.stopPropagation();
                    }
                    detailActions.onEditKeyDown(e);
                  }}
                  disabled={detailActions.isSavingTitle}
                  className="h-7 text-sm"
                  autoFocus
                />
              ) : (
                <span
                  role="button"
                  tabIndex={0}
                  className={cn(
                    "text-sm font-semibold leading-tight text-foreground line-clamp-2",
                    isCompleted && "line-through text-muted-foreground",
                    isDetailMode && "cursor-pointer",
                  )}
                  onClick={(e) => {
                    if (!isDetailMode) return;
                    e.stopPropagation();
                    detailActions?.onStartEdit();
                  }}
                  onKeyDown={(e) => {
                    if (!isDetailMode) return;
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      e.stopPropagation();
                      detailActions?.onStartEdit();
                    }
                  }}
                >
                  {title}
                </span>
              )}
            </div>
            {/* Detail mode: show save when editing, quick execute when not editing */}
            {isDetailMode &&
              detailActions &&
              (detailActions.isEditingTitle ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 shrink-0 p-0 text-primary hover:text-primary/90"
                      onClick={(e) => {
                        e.stopPropagation();
                        detailActions.onEditSave();
                      }}
                      disabled={detailActions.isSavingTitle}
                      aria-label={t(
                        "insightDetail.saveTitleEdit",
                        "Save changes",
                      )}
                    >
                      <RemixIcon name="check" size="size-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {t("insightDetail.saveTitleEdit", "Save changes")}
                  </TooltipContent>
                </Tooltip>
              ) : detailActions.showExecuteButton ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      size="sm"
                      variant="magic-secondary"
                      className="h-7 w-7 shrink-0 p-0"
                      onClick={(e) => {
                        e.stopPropagation();
                        detailActions.onExecute();
                      }}
                      disabled={detailActions.executeDisabled}
                      aria-label={t(
                        "insightDetail.todoAskopenloomi",
                        "Execute all",
                      )}
                    >
                      <RemixIcon name="magic" size="size-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {t("insightDetail.todoAskopenloomi", "Execute all")}
                  </TooltipContent>
                </Tooltip>
              ) : null)}
          </div>
          {/* Subtitle (e.g., "From: insight.title" in right panel) */}
          {subtitle != null && subtitle !== "" && (
            <div className="truncate text-xs text-muted-foreground/80">
              {subtitle}
            </div>
          )}
          {/* Second row: importance (if any), type, time — consistent with Insight detail, no priority means no placeholder */}
          <div className="flex flex-wrap items-center gap-2">
            {priorityLabel &&
              (effectivePriority === "high" ||
                effectivePriority === "medium" ||
                effectivePriority === "low") && (
                <InsightBadge
                  type="priority"
                  priority={effectivePriority}
                  label={priorityLabel}
                  iconSize="size-3"
                />
              )}
            {typeLabel && (
              <InsightBadge
                type="taskBucket"
                label={typeLabel}
                iconSize="size-3"
              />
            )}
            <InsightBadge
              type="datetime"
              label={deadlineLabel}
              iconSize="size-3"
            />
          </div>
          {/* Status badge */}
          {statusBadge != null && statusBadge !== "" && statusColor && (
            <div>
              <Badge
                className={cn(
                  "text-[9px] px-1.5 py-0.25 shrink-0 pointer-events-none",
                  statusColor,
                )}
              >
                {statusBadge}
              </Badge>
            </div>
          )}
          {children}
        </div>
      </div>
    </div>
  );
}
