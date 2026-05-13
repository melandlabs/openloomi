"use client";

/**
 * Insight event card main component
 * Combines sub-components: badges row, title row, keywords, mobile time; uses design tokens (bg-card, border-border, shadow-sm, rounded-lg)
 */

import { useMemo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import "../../i18n";
import { cn } from "@/lib/utils";
import type { Insight } from "@/lib/db/schema";
import { coerceDate } from "@openloomi/shared";
import { formatTimeForTable } from "@/components/agent/events-panel-utils";
import { Button } from "@openloomi/ui";
import { RemixIcon } from "@/components/remix-icon";
import { toast } from "@/components/toast";
import { Tooltip, TooltipContent, TooltipTrigger } from "@openloomi/ui";
import { InsightCardBadgesRow } from "./insight-card-badges-row";
import { InsightCardTitleRow } from "./insight-card-title-row";
import { TimeFormatCache, useUnreadState } from "./insight-card-storage";
import type { InsightCardProps } from "./insight-card-types";

const timeFormatCache = new TimeFormatCache();
const enableAction = false;

export function InsightCard(props: InsightCardProps) {
  const {
    id,
    title,
    details = [],
    time,
    platform,
    importance,
    urgency,
    people,
    groups,
    taskLabel,
    topKeywords,
    isSelected,
    hasMyNickname = false,
    onMarkAsRead,
    onSelect,
    onArchive,
    isArchived = false,
    onPin,
    isPinned = false,
  } = props;

  const { isUnread, markAsRead } = useUnreadState(id);
  const { t, i18n } = useTranslation();

  const [hasTodos, todoCount] = useMemo(() => {
    const count =
      (props.myTasks?.length ?? 0) +
      (props.waitingForMe?.length ?? 0) +
      (props.waitingForOthers?.length ?? 0);
    return [count > 0, count];
  }, [props.myTasks, props.waitingForMe, props.waitingForOthers]);

  /** Normalized categories list: Insight.categories may be an array or JSON string */
  const categoriesList = useMemo((): string[] => {
    const raw = props.categories;
    if (Array.isArray(raw)) return raw;
    if (typeof raw === "string") {
      try {
        const parsed = JSON.parse(raw || "[]");
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return [];
  }, [props.categories]);

  const isRssSummary =
    taskLabel === "rss_feed" ||
    (details?.some((d) => d.platform?.toLowerCase() === "rss") ?? false);

  const timeDisplay = useMemo(() => {
    let dateToFormat: Date;
    if (details && details.length > 0) {
      const last = details[details.length - 1];
      dateToFormat = last.time ? coerceDate(last.time) : new Date(time);
    } else {
      dateToFormat = new Date(time);
    }
    const cacheKey = `${dateToFormat.getTime()}-${i18n.language}`;
    const cached = timeFormatCache.get(cacheKey);
    if (cached) return cached;
    const formatted = formatTimeForTable(
      dateToFormat,
      i18n.language,
      (key: string, defaultValue?: string) => t(key, defaultValue ?? ""),
    );
    timeFormatCache.set(cacheKey, formatted);
    return formatted;
  }, [details, time, i18n.language, t]);

  const handleCardClick = useCallback(() => {
    if (isUnread) {
      markAsRead();
      onMarkAsRead?.();
    }
    onSelect?.(props as Insight);
  }, [isUnread, markAsRead, onMarkAsRead, onSelect, props]);

  const baseCardClasses =
    "group cursor-pointer rounded-none border-0 border-t border-border shadow-none insight-card";
  const cardBackgroundClasses = isSelected
    ? "bg-card border-primary/20"
    : hasMyNickname
      ? "bg-surface/80 border-primary/20"
      : isUnread
        ? "bg-card border-primary/20"
        : "bg-card border-border";

  return (
    <div
      className={cn(
        baseCardClasses,
        cardBackgroundClasses,
        "relative w-full transition-colors duration-200 hover:bg-primary-50",
      )}
      onClick={handleCardClick}
      role="button"
      data-insight-id={id}
      style={{ overflow: "hidden" }}
    >
      <div className="px-2 py-3 w-full">
        <div className="space-y-2">
          {/* First row: title */}
          <InsightCardTitleRow title={title ?? ""} isUnread={isUnread} />
          {/* Second row: source badges (channel/importance/urgency/category) */}
          <InsightCardBadgesRow
            platform={platform}
            groups={groups}
            details={details}
            categories={categoriesList}
            importance={importance}
            urgency={urgency}
          />
          {/* Third row: time (left, muted) + Pin/Mute on hover (right) */}
          <div className="flex items-center justify-between gap-2 w-full min-w-0">
            <span className="text-xs text-muted-foreground truncate min-w-0">
              {timeDisplay}
            </span>
            <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
              {onPin && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className={cn(
                        "h-7 w-7 hover:bg-transparent",
                        isPinned ? "text-primary" : "text-muted-foreground",
                      )}
                      onClick={(e) => {
                        e.stopPropagation();
                        onPin(props as Insight);
                      }}
                      aria-label={
                        isPinned
                          ? t("insight.unpin", "Unpin")
                          : t("insight.pin", "Pin to today's focus")
                      }
                    >
                      <RemixIcon
                        name="pushpin"
                        size="size-4"
                        filled={isPinned}
                      />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>
                      {isPinned
                        ? t("insight.unpin", "Unpin")
                        : t("insight.pin", "Pin to today's focus")}
                    </p>
                  </TooltipContent>
                </Tooltip>
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className={cn(
                      "h-7 w-7 hover:bg-transparent",
                      isArchived ? "text-primary" : "text-muted-foreground",
                    )}
                    onClick={(e) => {
                      e.stopPropagation();
                      onArchive?.(props as Insight);
                    }}
                    aria-label={
                      isArchived
                        ? t("insight.unmute", "Unmute")
                        : t("insight.mute", "Mute")
                    }
                  >
                    <RemixIcon
                      name="bell_off"
                      size="size-4"
                      filled={isArchived}
                    />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>
                    {isArchived
                      ? t("insight.unmute", "Unmute")
                      : t("insight.mute", "Mute")}
                  </p>
                </TooltipContent>
              </Tooltip>
            </div>
          </div>
          {!isRssSummary && enableAction && (
            <div className="mt-2">
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start h-auto p-2 text-left hover:bg-primary/5 hover:border-primary/30 transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  toast({
                    type: "success",
                    description: t(
                      "insightDetail.actionSendAlert",
                      "Sending alert...",
                    ),
                  });
                }}
              >
                <div className="flex items-center gap-2 w-full">
                  <RemixIcon
                    name="send_plane"
                    size="size-3.5"
                    className="text-primary shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] sm:text-xs font-semibold text-foreground truncate">
                      {t(
                        "insightDetail.action1Title",
                        "Send alert to Portfolio X CEO",
                      )}
                    </p>
                  </div>
                </div>
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
