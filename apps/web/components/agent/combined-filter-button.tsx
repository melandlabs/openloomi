"use client";

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import "../../i18n";
import { Button } from "@openloomi/ui";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@openloomi/ui";
import { RemixIcon } from "@/components/remix-icon";
import { cn } from "@/lib/utils";

interface CombinedFilterButtonProps {
  /**
   * Read/unread filter state
   */
  readStatus: "unread" | "read" | "all";
  /**
   * Read/unread filter state change callback
   */
  onReadStatusChange: (value: "unread" | "read" | "all") => void;
  /**
   * Time filter state
   */
  timeFilter: "all" | "24h" | "today";
  /**
   * Time filter state change callback
   */
  onTimeFilterChange: (value: "all" | "24h" | "today") => void;
  /**
   * Whether disabled
   */
  disabled?: boolean;
}

/**
 * Combined filter button component
 * Merges read/unread selection and time selection into one dropdown menu
 */
export function CombinedFilterButton({
  readStatus,
  onReadStatusChange,
  timeFilter,
  onTimeFilterChange,
  disabled = false,
}: CombinedFilterButtonProps) {
  const { t } = useTranslation();

  /**
   * Get display text for read/unread filter (only used when label display is needed, currently not used in UI)
   */
  const readStatusLabel = useMemo(() => {
    if (readStatus === "unread") return t("common.unread");
    if (readStatus === "read") return t("common.read");
    return t("insight.filter.all");
  }, [readStatus, t]);

  /**
   * Check if any non-default filter conditions are active
   * Default state: readStatus="all" and timeFilter="24h"
   */
  const hasActiveFilter = useMemo(() => {
    return readStatus !== "all" || timeFilter !== "24h";
  }, [readStatus, timeFilter]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className={cn(
            "h-8 w-8",
            hasActiveFilter && "bg-primary/10 border-primary/20",
          )}
          disabled={disabled}
          aria-label={t("insight.filter.title", "Filter")}
        >
          <RemixIcon
            name="filter"
            size="size-4"
            className={cn(hasActiveFilter && "text-primary")}
          />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>
          {t("insight.filter.readStatus", "Read/Unread")}
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={readStatus}
          onValueChange={(value) =>
            onReadStatusChange(value as "unread" | "read" | "all")
          }
        >
          <DropdownMenuRadioItem value="all" className="cursor-pointer">
            <div className="flex items-center gap-2">
              <span>{t("insight.filter.all")}</span>
            </div>
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="unread" className="cursor-pointer">
            <div className="flex items-center gap-2">
              <RemixIcon name="checkbox_blank" size="size-3.5" />
              <span>{t("common.unread")}</span>
            </div>
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="read" className="cursor-pointer">
            <div className="flex items-center gap-2">
              <RemixIcon name="circle_check" size="size-3.5" />
              <span>{t("common.read")}</span>
            </div>
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>

        <DropdownMenuSeparator />

        <DropdownMenuLabel>
          {t("insight.filter.timeRange", "Time range")}
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={timeFilter}
          onValueChange={(value) =>
            onTimeFilterChange(value as "all" | "24h" | "today")
          }
        >
          <DropdownMenuRadioItem value="24h" className="cursor-pointer">
            <div className="flex items-center gap-2">
              <RemixIcon name="calendar" size="size-3.5" />
              <span>{t("insight.timeFilter.24h", "Last 24 hours")}</span>
            </div>
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="today" className="cursor-pointer">
            <div className="flex items-center gap-2">
              <RemixIcon name="calendar" size="size-3.5" />
              <span>{t("insight.timeFilter.today", "Today only")}</span>
            </div>
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="all" className="cursor-pointer">
            <div className="flex items-center gap-2">
              <RemixIcon name="calendar" size="size-3.5" />
              <span>{t("insight.timeFilter.all", "All time")}</span>
            </div>
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
