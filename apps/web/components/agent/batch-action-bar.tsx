"use client";

import { useTranslation } from "react-i18next";
import { Button } from "@openloomi/ui";
import { RemixIcon } from "@/components/remix-icon";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@openloomi/hooks/use-is-mobile";
import "../../i18n";

export interface BatchActionBarProps {
  /** Number of selected items */
  selectedCount: number;
  /** Whether all selected */
  isAllSelected: boolean;
  /** Whether processing */
  isProcessing: boolean;
  /** Whether to show importance option (optional) */
  showImportance?: boolean;
  /** Cancel selection mode */
  onCancel: () => void;
  /** Select all / deselect all */
  onToggleSelectAll: () => void;
  /** Batch archive */
  onArchive?: () => void;
  /** Batch favorite */
  onFavorite?: () => void;
  /** Batch delete */
  onDelete?: () => void;
  /** Batch unpin */
  onUnpin?: () => void;
  /** Batch set importance */
  onSetImportance?: (importance: "low" | "medium" | "high") => void;
  /** Custom className */
  className?: string;
}

/**
 * Batch action bar component
 * Displayed at the bottom of the Brief panel as a batch operations toolbar
 */
export function BatchActionBar({
  selectedCount,
  isAllSelected,
  isProcessing,
  showImportance = false,
  onCancel,
  onToggleSelectAll,
  onArchive,
  onFavorite,
  onDelete,
  onUnpin,
  onSetImportance,
  className,
}: BatchActionBarProps) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  /** Partial selection: some items selected but not all; clicking selects all; when all selected, clicking deselects */
  const isIndeterminate = selectedCount > 0 && !isAllSelected;

  return (
    <div
      className={cn(
        "flex items-center justify-between gap-2 pl-0 pr-2 pt-0 pb-3",
        "transition-all duration-200 ease-in-out",
        className,
      )}
      role="toolbar"
      aria-label="Batch actions"
    >
      {/* Left: Checkbox → Selected x items → Divider → Unpin | Mute (ghost); Right: Cancel (ghost icon) */}
      <div className="flex items-center gap-2">
        {/* Select all: checkbox only, no text */}
        <Button
          variant="ghost"
          size="icon"
          onClick={onToggleSelectAll}
          disabled={isProcessing}
          className={cn(
            "h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground",
            (isAllSelected || isIndeterminate) && "text-primary",
          )}
          aria-label={
            isAllSelected
              ? t("common.deselectAll", "Deselect all")
              : t("common.selectAll", "Select all")
          }
          title={
            isAllSelected
              ? t("common.deselectAll", "Deselect all")
              : t("common.selectAll", "Select all")
          }
        >
          <RemixIcon
            name={
              isAllSelected
                ? "checkbox"
                : isIndeterminate
                  ? "checkbox_indeterminate"
                  : "checkbox_square"
            }
            size="size-4"
          />
        </Button>

        <span className="text-sm text-muted-foreground">
          {t("common.selectedCount", {
            count: selectedCount,
            defaultValue: `${selectedCount} selected`,
          })}
        </span>

        <div className="h-4 w-px bg-border" />

        {/* Unpin, Mute: ghost buttons, divider in between */}
        {onUnpin && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2 text-muted-foreground hover:text-foreground"
            onClick={onUnpin}
            disabled={isProcessing || selectedCount === 0}
            title={t("insight.unpin", "Unpin")}
          >
            <RemixIcon name="unpin" size="size-4" className="mr-1" />
            {!isMobile && t("insight.unpin", "Unpin")}
          </Button>
        )}
        {onUnpin && onArchive && <div className="h-4 w-px bg-border" />}
        {onArchive && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2 text-muted-foreground hover:text-foreground"
            onClick={onArchive}
            disabled={isProcessing || selectedCount === 0}
            title={t("insight.mute", "Mute")}
          >
            <RemixIcon
              name="bell_off"
              size={isMobile ? "size-4" : "size-4"}
              className="mr-1"
            />
            {!isMobile && t("insight.mute", "Mute")}
          </Button>
        )}
      </div>

      {/* Far right: exit selection mode */}
      <Button
        variant="ghost"
        size="icon"
        onClick={onCancel}
        disabled={isProcessing}
        className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
        aria-label={t("common.cancel", "Cancel")}
        title={t("common.cancel", "Cancel")}
      >
        <RemixIcon name="close" size="size-4" />
      </Button>
    </div>
  );
}
