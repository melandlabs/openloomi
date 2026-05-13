"use client";

import { useMemo, useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import "../i18n";
import { Button } from "@openloomi/ui";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@openloomi/ui";
import { RemixIcon } from "@/components/remix-icon";
import { cn } from "@/lib/utils";

interface TimeFilterButtonProps {
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
 * Time range filter button component
 * Only includes time selection functionality
 */
export function TimeFilterButton({
  timeFilter,
  onTimeFilterChange,
  disabled = false,
}: TimeFilterButtonProps) {
  const { t } = useTranslation();
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  /**
   * Get display text for time filter
   */
  const timeFilterLabel = useMemo(() => {
    if (!isMounted) {
      if (timeFilter === "24h") return "Last 24 hours";
      if (timeFilter === "today") return "Today";
      return "All time";
    }
    if (timeFilter === "24h") {
      return t("insight.timeFilter.24h", "Last 24 hours");
    }
    if (timeFilter === "today") {
      return t("insight.timeFilter.today", "Today only");
    }
    return t("insight.timeFilter.all", "All time");
  }, [timeFilter, t, isMounted]);

  /**
   * Check if there are non-default filter conditions
   * Default state: timeFilter="24h"
   */
  const hasActiveFilter = useMemo(() => {
    return timeFilter !== "24h";
  }, [timeFilter]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            "h-6 px-2 text-xs text-sidebar-foreground/60 hover:text-sidebar-foreground/80 gap-0.5",
            hasActiveFilter && "text-primary hover:text-primary",
          )}
          disabled={disabled}
          aria-label={t("insight.filter.timeRange", "Time range")}
        >
          <RemixIcon
            name="calendar"
            size="size-3"
            className={cn("mr-1", hasActiveFilter && "text-primary")}
          />
          {timeFilterLabel}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
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
