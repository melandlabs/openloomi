"use client";

import * as React from "react";
import {
  format,
  addMonths,
  subMonths,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  isSameMonth,
  isSameDay,
  startOfDay,
  isToday,
  getDay,
} from "date-fns";
import { zhCN, enUS } from "date-fns/locale";
import { RemixIcon } from "@/components/remix-icon";
import { cn } from "@/lib/utils";
import { Button } from "@openloomi/ui";
import { Popover, PopoverContent, PopoverTrigger } from "@openloomi/ui";

const WEEKDAY_ZH = ["日", "一", "二", "三", "四", "五", "六"];
const WEEKDAY_EN = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

export interface DatePickerProps {
  /** Value: YYYY-MM-DD or empty string */
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
  triggerClassName?: string;
  /** Callback when gaining/losing focus (can be used to submit when closing) */
  onOpenChange?: (open: boolean) => void;
  /** Whether to use Chinese weekdays/months (default true) */
  localeZh?: boolean;
  /** Clear button label (must be passed from parent component with t()) */
  clearLabel?: string;
  /** Today button label (must be passed from parent component with t()) */
  todayLabel?: string;
}

/**
 * Date picker: click to open custom calendar popover (consistent with project style), with clear and today buttons.
 */
export function DatePicker({
  value,
  onChange,
  placeholder = "Select date",
  disabled = false,
  id,
  className,
  triggerClassName,
  onOpenChange,
  localeZh = true,
  clearLabel = "Clear",
  todayLabel = "Today",
}: DatePickerProps) {
  const [open, setOpen] = React.useState(false);
  const [viewMonth, setViewMonth] = React.useState(() => {
    if (value && value.length >= 10) {
      const d = new Date(`${value.slice(0, 10)}T12:00:00`);
      return Number.isNaN(d.getTime()) ? new Date() : d;
    }
    return new Date();
  });

  const selectedDate =
    value && value.length >= 10
      ? new Date(`${value.slice(0, 10)}T12:00:00`)
      : null;
  const displayText = selectedDate
    ? format(selectedDate, "yyyy-MM-dd", {
        locale: localeZh ? zhCN : enUS,
      })
    : placeholder;

  const locale = localeZh ? zhCN : enUS;
  const weekdays = localeZh ? WEEKDAY_ZH : WEEKDAY_EN;

  const monthStart = startOfMonth(viewMonth);
  const monthEnd = endOfMonth(viewMonth);
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd });
  // Pad the empty space before the start of the month (last few days of previous month)
  const startWeekday = getDay(monthStart);
  const prevMonthEnd = endOfMonth(subMonths(viewMonth, 1));
  const paddingStartDays = Array.from(
    { length: startWeekday },
    (_, i) =>
      new Date(
        prevMonthEnd.getFullYear(),
        prevMonthEnd.getMonth(),
        prevMonthEnd.getDate() - (startWeekday - 1 - i),
      ),
  );
  const totalCells = 42; // 6 rows × 7 columns
  const needEnd = totalCells - paddingStartDays.length - days.length;
  const nextMonthStart = addMonths(monthStart, 1);
  const paddingEndDays = Array.from(
    { length: Math.max(0, needEnd) },
    (_, i) =>
      new Date(nextMonthStart.getFullYear(), nextMonthStart.getMonth(), i + 1),
  );
  const allDays = [...paddingStartDays, ...days, ...paddingEndDays];

  const handleSelect = (d: Date) => {
    onChange(format(d, "yyyy-MM-dd"));
    setOpen(false);
    onOpenChange?.(false);
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange("");
    setOpen(false);
    onOpenChange?.(false);
  };

  const handleToday = (e: React.MouseEvent) => {
    e.stopPropagation();
    const today = startOfDay(new Date());
    onChange(format(today, "yyyy-MM-dd"));
    setViewMonth(today);
    setOpen(false);
    onOpenChange?.(false);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        onOpenChange?.(next);
        if (!next) return;
        if (value && value.length >= 10) {
          const d = new Date(`${value.slice(0, 10)}T12:00:00`);
          if (!Number.isNaN(d.getTime())) setViewMonth(d);
        } else {
          setViewMonth(new Date());
        }
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          id={id}
          disabled={disabled}
          className={cn(
            "relative flex h-10 w-full cursor-pointer items-center justify-start gap-2 rounded-md border border-input bg-background px-3 py-2 text-left text-sm ring-offset-background transition-colors placeholder:text-muted-foreground hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 disabled:pointer-events-none",
            !value && "text-muted-foreground",
            triggerClassName,
            className,
          )}
        >
          <RemixIcon
            name="calendar"
            size="size-4"
            className="shrink-0 opacity-50"
          />
          <span className="truncate">{displayText}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-auto max-w-[calc(100vw-32px)] p-0"
        align="start"
        sideOffset={4}
      >
        <div className="p-3">
          {/* Month navigation */}
          <div className="flex items-center justify-between">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              onClick={() => setViewMonth((m) => subMonths(m, 1))}
              aria-label="Previous month"
            >
              <RemixIcon name="chevron_left" size="size-4" />
            </Button>
            <span className="text-sm font-medium">
              {localeZh
                ? format(viewMonth, "yyyy 年 MM 月", { locale })
                : format(viewMonth, "MMMM yyyy", { locale })}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              onClick={() => setViewMonth((m) => addMonths(m, 1))}
              aria-label="Next month"
            >
              <RemixIcon name="chevron_right" size="size-4" />
            </Button>
          </div>
          {/* Weekday header */}
          <div className="mt-4 grid grid-cols-7 gap-1 text-center text-xs text-muted-foreground">
            {weekdays.map((w) => (
              <div key={w} className="h-8 flex items-center justify-center">
                {w}
              </div>
            ))}
          </div>
          {/* Date grid */}
          <div className="mt-1 grid grid-cols-7 gap-1">
            {allDays.slice(0, 42).map((d) => {
              const inMonth = isSameMonth(d, viewMonth);
              const selected = selectedDate && isSameDay(d, selectedDate);
              const dayIsToday = isToday(d);
              return (
                <Button
                  key={d.toISOString()}
                  type="button"
                  variant="ghost"
                  size="icon"
                  className={cn(
                    "h-11 w-11 md:h-9 md:w-9 p-0 text-sm md:text-sm font-normal",
                    !inMonth && "text-muted-foreground opacity-50",
                    selected &&
                      "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground",
                    dayIsToday &&
                      !selected &&
                      "bg-accent text-accent-foreground",
                  )}
                  onClick={() => handleSelect(d)}
                >
                  {format(d, "d")}
                </Button>
              );
            })}
          </div>
          {/* Clear / Today */}
          <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
            <button
              type="button"
              className="text-sm text-muted-foreground hover:text-foreground"
              onClick={handleClear}
            >
              {clearLabel}
            </button>
            <button
              type="button"
              className="text-sm text-muted-foreground hover:text-foreground"
              onClick={handleToday}
            >
              {todayLabel}
            </button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
