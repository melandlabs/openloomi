"use client";

import * as React from "react";
import { RemixIcon } from "@/components/remix-icon";
import { cn } from "@/lib/utils";
import { Button } from "@openloomi/ui";
import { Popover, PopoverContent, PopoverTrigger } from "@openloomi/ui";
import { ScrollArea } from "@openloomi/ui";

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
const MINUTES = Array.from({ length: 60 }, (_, i) =>
  String(i).padStart(2, "0"),
);

export interface TimePickerProps {
  /** Value: HH:mm or empty string */
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
  triggerClassName?: string;
  /** Callback when gaining/losing focus (can be used to submit when closing) */
  onOpenChange?: (open: boolean) => void;
}

/**
 * Time picker: click to open custom time popover (consistent with project style), left column hours, right column minutes.
 */
export function TimePicker({
  value,
  onChange,
  placeholder = "Select time",
  disabled = false,
  id,
  className,
  triggerClassName,
  onOpenChange,
}: TimePickerProps) {
  const [open, setOpen] = React.useState(false);
  const [hour, minute] = value ? value.split(":") : ["", ""];
  const displayText = value || placeholder;
  const hourScrollRef = React.useRef<HTMLDivElement>(null);
  const minuteScrollRef = React.useRef<HTMLDivElement>(null);

  const scrollToSelected = React.useCallback(
    (scrollArea: HTMLDivElement | null, selectedValue: string) => {
      if (!scrollArea || !selectedValue) return;

      const safeValue =
        typeof CSS !== "undefined" ? CSS.escape(selectedValue) : selectedValue;
      const viewport = scrollArea.querySelector<HTMLElement>(
        "[data-radix-scroll-area-viewport]",
      );
      const selectedButton = scrollArea.querySelector<HTMLElement>(
        `button[data-value="${safeValue}"][data-selected="true"]`,
      );

      if (!viewport || !selectedButton) return;

      const nextScrollTop =
        selectedButton.offsetTop -
        viewport.clientHeight / 2 +
        selectedButton.offsetHeight / 2;
      viewport.scrollTop = Math.max(0, nextScrollTop);
    },
    [],
  );

  // Auto-scroll to selected hour/minute when dropdown opens
  React.useEffect(() => {
    if (!open) return;

    const frameId = requestAnimationFrame(() => {
      scrollToSelected(hourScrollRef.current, hour);
      scrollToSelected(minuteScrollRef.current, minute);
    });

    return () => {
      cancelAnimationFrame(frameId);
    };
  }, [open, hour, minute, scrollToSelected]);

  const setHour = (h: string) => {
    const m = minute || "00";
    onChange(`${h}:${m}`);
  };
  const setMinute = (m: string) => {
    const h = hour || "00";
    onChange(`${h}:${m}`);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        onOpenChange?.(next);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          id={id}
          onKeyDown={(e) => {
            if (disabled) return;
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setOpen(true);
            }
          }}
          disabled={disabled}
          className={cn(
            "relative flex h-10 w-full cursor-pointer items-center justify-start gap-2 rounded-md border border-input bg-background px-3 py-2 text-left text-sm ring-offset-background transition-colors placeholder:text-muted-foreground hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 disabled:pointer-events-none",
            !value && "text-muted-foreground",
            triggerClassName,
            className,
          )}
        >
          <RemixIcon
            name="clock"
            size="size-4"
            className="shrink-0 opacity-50"
          />
          <span className="truncate">{displayText}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start" sideOffset={4}>
        <div className="p-2">
          <p className="mb-2 px-2 text-xs font-medium text-muted-foreground">
            {placeholder}
          </p>
          <div className="flex gap-1">
            <ScrollArea
              ref={hourScrollRef}
              className="h-48 w-14 rounded-md border-0 border-[rgba(0,0,0,0)] [border-style:none] [border-image:none]"
            >
              <div className="flex flex-col p-1">
                {HOURS.map((h) => (
                  <Button
                    key={h}
                    type="button"
                    data-selected={hour === h ? "true" : undefined}
                    data-value={h}
                    variant="ghost"
                    size="sm"
                    className={cn(
                      "h-8 w-full justify-center text-sm font-normal",
                      hour === h &&
                        "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground",
                    )}
                    onClick={() => setHour(h)}
                  >
                    {h}
                  </Button>
                ))}
              </div>
            </ScrollArea>
            <ScrollArea
              ref={minuteScrollRef}
              className="h-48 w-14 rounded-md border-0 border-[rgba(0,0,0,0)] [border-style:none] [border-image:none]"
            >
              <div className="flex flex-col p-1">
                {MINUTES.map((m) => (
                  <Button
                    key={m}
                    type="button"
                    data-selected={minute === m ? "true" : undefined}
                    data-value={m}
                    variant="ghost"
                    size="sm"
                    className={cn(
                      "h-8 w-full justify-center text-sm font-normal",
                      minute === m &&
                        "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground",
                    )}
                    onClick={() => setMinute(m)}
                  >
                    {m}
                  </Button>
                ))}
              </div>
            </ScrollArea>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
