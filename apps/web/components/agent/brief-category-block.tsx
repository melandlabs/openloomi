"use client";

import type { Insight } from "@/lib/db/schema";
import {
  InsightBadge,
  FOCUS_GROUP_LABELS,
  type FocusGroupLevel,
} from "@/components/insight-badge";
import { InsightCardBadgesRow } from "@/components/insight-card/insight-card-badges-row";
import { RemixIcon } from "@/components/remix-icon";
import { Button } from "@openloomi/ui";
import { Tooltip, TooltipContent, TooltipTrigger } from "@openloomi/ui";
import type { ActionCategory } from "@/lib/insights/event-rank";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { zhCN, enUS } from "date-fns/locale";
import { useTranslation } from "react-i18next";
import "../../i18n";

/** ActionCategory to focus group badge level mapping (consistent with InsightBadge focusGroup) */
const ACTION_CATEGORY_TO_FOCUS_GROUP: Record<ActionCategory, FocusGroupLevel> =
  {
    urgent: "high",
    important: "medium",
    monitor: "low",
    archive: "low",
  };

export interface BriefCategoryBlockProps {
  category: ActionCategory;
  insights: Insight[];
  isFirstCategory: boolean;
  isExpanded: boolean;
  onToggleExpand: () => void;
  effectiveSelectedInsight: Insight | null;
  strikethroughInsights: Set<string>;
  draggedInsightId: string | null;
  /** Becomes true one frame after drag starts, used to delay showing empty groups */
  showEmptyDropZones: boolean;
  dragOverCategory: ActionCategory | null;
  onSelectInsight: (insight: Insight) => void;
  // Props for batch selection
  isSelectionMode?: boolean;
  selectedIds?: Set<string>;
  onToggleSelect?: (id: string) => void;
  onSelectAllInCategory?: (insights: Insight[]) => void;
  onDragStart: (e: React.DragEvent, insightId: string) => void;
  onDragEnd: (e: React.DragEvent) => void;
  onDragEnter: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  // Props for operations
  onUnpin?: (insight: Insight) => Promise<void>;
  onMute?: (insight: Insight) => Promise<void>;
}

/**
 * Brief single category block: title row + event list, supports drag-and-drop and expand
 * Colors use design tokens (destructive / accent-brand / primary / muted)
 */
export function BriefCategoryBlock({
  category,
  insights,
  isFirstCategory,
  isExpanded,
  onToggleExpand,
  effectiveSelectedInsight,
  strikethroughInsights,
  draggedInsightId,
  showEmptyDropZones,
  dragOverCategory,
  onSelectInsight,
  isSelectionMode = false,
  selectedIds = new Set(),
  onToggleSelect,
  onSelectAllInCategory,
  onDragStart,
  onDragEnd,
  onDragEnter,
  onDragOver,
  onDragLeave,
  onDrop,
  onUnpin,
  onMute,
}: BriefCategoryBlockProps) {
  const { t, i18n } = useTranslation();
  const dateLocale = i18n.language.includes("zh") ? zhCN : enUS;

  const isEmpty = insights.length === 0;
  /** Only show empty groups when showEmptyDropZones is true (set to true one frame after parent drag starts, avoids drag cancellation) */
  const isHiddenEmpty = isEmpty && !showEmptyDropZones;

  /** Max events shown when collapsed, show "View more" button only when exceeding this limit */
  const COLLAPSED_DISPLAY_LIMIT = 3;
  const displayedInsights = isExpanded
    ? insights
    : insights.slice(0, COLLAPSED_DISPLAY_LIMIT);
  const hasMoreThanLimit = insights.length > COLLAPSED_DISPLAY_LIMIT;
  const isDragOver = dragOverCategory === category;
  const focusGroupLevel = ACTION_CATEGORY_TO_FOCUS_GROUP[category];
  const groupLabel =
    category === "archive"
      ? t("insight.focusCategories.archive", "Archive")
      : FOCUS_GROUP_LABELS[focusGroupLevel];

  /**
   * Within one day show "just now / x min ago / x hr ago" (no "about"); beyond one day use date-fns relative time
   */
  const formatInsightTime = (date: Date): string => {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffHours = diffMs / (1000 * 60 * 60);
    const isZh = i18n.language.includes("zh");

    if (diffHours < 24) {
      if (diffHours < 1 / 60) {
        return isZh ? "Just now" : "just now";
      }
      if (diffHours < 1) {
        const minutes = Math.floor(diffMs / (1000 * 60));
        return isZh
          ? `${minutes}${t("common.minAgo", " min ago")}`
          : `${minutes}m ago`;
      }
      const hours = Math.floor(diffHours);
      return isZh
        ? `${hours}${t("common.hourAgo", " hr ago")}`
        : `${hours}h ago`;
    }
    return formatDistanceToNow(date, {
      addSuffix: true,
      locale: dateLocale,
    });
  };

  return (
    <div
      className={cn(!isFirstCategory && "mt-5", isHiddenEmpty && "hidden")}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      role="region"
      aria-label={`${t(`insight.focusCategories.${category}`)} category drop zone`}
    >
      <div
        className={cn(
          "flex items-center justify-between gap-2 w-full min-w-0 rounded-lg transition-colors pl-6 pr-0 mb-1.5",
          !isFirstCategory && "pt-0",
          isDragOver &&
            "bg-primary/10 border-2 border-dashed border-primary/50",
        )}
      >
        <InsightBadge
          type="focusGroup"
          focusGroupLevel={focusGroupLevel}
          label={groupLabel}
          count={insights.length}
        />
        {hasMoreThanLimit && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onToggleExpand}
            className="mx-1.5 flex shrink-0 items-center gap-0.5 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            <span>{t("common.viewMore", "View more")}</span>
            {isExpanded ? (
              <RemixIcon
                name="chevron_down"
                size="size-3.5"
                className="text-muted-foreground"
              />
            ) : (
              <RemixIcon
                name="chevron_right"
                size="size-3.5"
                className="text-muted-foreground"
              />
            )}
          </Button>
        )}
      </div>
      <div className="mt-0 space-y-0">
        {isEmpty && (
          <div className="py-3 px-2 text-center text-sm text-muted-foreground rounded-md border border-dashed border-muted-foreground/30 bg-muted/30 min-h-[2.5rem] flex items-center justify-center">
            {t("insight.brief.dropHere", "Release to add to this group")}
          </div>
        )}
        {displayedInsights.map((insight) => {
          const isSelected = insight.id === effectiveSelectedInsight?.id;
          const isStrikethrough = strikethroughInsights.has(insight.id);
          const isDragging = draggedInsightId === insight.id;
          const isChecked = selectedIds.has(insight.id);
          const isPinned = (insight.categories || []).includes("keep-focused");
          const isMuted = insight.isArchived ?? false;

          // In selection mode, click behavior is different
          const handleItemClick = () => {
            if (isSelectionMode && onToggleSelect) {
              onToggleSelect(insight.id);
            } else {
              onSelectInsight(insight);
            }
          };

          const handleItemKeyDown = (e: React.KeyboardEvent) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              e.stopPropagation();
              handleItemClick();
            }
          };

          return (
            <div
              key={insight.id}
              draggable={!isSelectionMode}
              onDragStart={(e) =>
                !isSelectionMode && onDragStart(e, insight.id)
              }
              onDragEnd={onDragEnd}
              role="listitem"
              aria-grabbed={isDragging}
              className={cn(
                "group relative flex items-center gap-0 pt-0 pb-0 pl-2 pr-4 rounded-none bg-transparent min-w-0",
                isDragging && "opacity-50 cursor-grabbing",
                !isDragging && !isSelectionMode && "cursor-grab",
                isSelectionMode && "cursor-pointer",
              )}
            >
              {/* Checkbox column: independent of hover background area, only shows icon on hover */}
              {onToggleSelect && (
                <div className="w-4 shrink-0 flex items-center justify-center">
                  <div
                    role="checkbox"
                    aria-checked={isChecked}
                    tabIndex={0}
                    className={cn(
                      "z-20 flex h-6 w-6 items-center justify-center transition-opacity",
                      isChecked
                        ? "opacity-100"
                        : "opacity-0 group-hover:opacity-100",
                    )}
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleSelect(insight.id);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        e.stopPropagation();
                        onToggleSelect(insight.id);
                      }
                    }}
                  >
                    <RemixIcon
                      name={isChecked ? "checkbox" : "checkbox_square"}
                      size="size-4"
                      className={cn(
                        "transition-colors",
                        isChecked ? "text-primary" : "text-muted-foreground/50",
                      )}
                    />
                  </div>
                </div>
              )}
              {/* Content area: background color appears only on hover of this area */}
              <div
                className={cn(
                  "flex min-w-0 flex-1 items-start gap-4 md:items-center md:gap-6 rounded-none pt-2 pb-2 pl-2 pr-2 transition-colors hover:bg-primary-50",
                  isSelected && "bg-primary/5",
                )}
              >
                {/* Title area: left-aligned with category badge; on narrow screens title and info below are displayed on two lines */}
                <div
                  role="button"
                  tabIndex={0}
                  className={cn(
                    "relative z-0 flex min-w-0 flex-1 flex-col gap-1.5 md:flex-row md:items-center md:gap-1.5",
                    isSelectionMode ? "cursor-pointer" : "cursor-pointer",
                  )}
                  onClick={handleItemClick}
                  onKeyDown={handleItemKeyDown}
                >
                  {/* Title: max two lines shown, truncated if exceeding; on wide screens same row as channel badge */}
                  <div className="flex min-w-0 flex-[1_1_auto] items-start md:items-center gap-1.5">
                    {/* Wrapper layer: min-w-0 + overflow-hidden ensures title displays correctly when truncated */}
                    <div className="min-w-0 overflow-hidden">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span
                            className={cn(
                              "font-medium text-sm block w-full min-w-0 line-clamp-2 md:line-clamp-1 break-words",
                              isStrikethrough &&
                                "line-through text-muted-foreground",
                            )}
                          >
                            {insight.title}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent
                          side="top"
                          align="start"
                          className="max-w-[min(90vw,28rem)]"
                        >
                          <p className="text-xs break-words whitespace-normal">
                            {insight.title}
                          </p>
                        </TooltipContent>
                      </Tooltip>
                    </div>
                    <InsightCardBadgesRow
                      platform={insight.platform ?? null}
                      groups={insight.groups ?? null}
                      details={insight.details ?? null}
                      categories={null}
                      importance={null}
                      urgency={null}
                    />
                  </div>
                  {/* Below info row: time on the right / action buttons */}
                  <div className="mt-1 flex items-center justify-between gap-2 min-w-0 md:mt-0 md:ml-1.5 md:justify-end md:flex-shrink-0">
                    <div className="shrink-0 flex items-center justify-end gap-1 min-w-[5rem]">
                      <span className="whitespace-nowrap text-xs text-muted-foreground group-hover:hidden">
                        {formatInsightTime(new Date(insight.time))}
                      </span>
                      <div className="hidden">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className={cn(
                                "size-7",
                                isPinned
                                  ? "text-primary hover:text-primary/90"
                                  : "text-muted-foreground hover:text-foreground",
                              )}
                              onClick={(e) => {
                                e.stopPropagation();
                                onUnpin?.(insight);
                              }}
                            >
                              <RemixIcon
                                name="pushpin"
                                size="size-3.5"
                                filled={isPinned}
                              />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="top">
                            <p className="text-xs">
                              {isPinned
                                ? t("insight.unpin", "Unpin")
                                : t("common.pin", "Pin")}
                            </p>
                          </TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className={cn(
                                "size-7",
                                isMuted
                                  ? "text-primary hover:text-primary/90"
                                  : "text-muted-foreground hover:text-foreground",
                              )}
                              onClick={(e) => {
                                e.stopPropagation();
                                onMute?.(insight);
                              }}
                            >
                              <RemixIcon
                                name="bell_off"
                                size="size-3.5"
                                filled={isMuted}
                              />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="top">
                            <p className="text-xs">
                              {isMuted
                                ? t("insight.unmute", "Unmute")
                                : t("insight.mute", "Mute")}
                            </p>
                          </TooltipContent>
                        </Tooltip>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
