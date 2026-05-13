"use client";

import * as React from "react";
import { useTranslation } from "react-i18next";
import { RemixIcon } from "@/components/remix-icon";
import { cn } from "@/lib/utils";
import { Badge, Input } from "@openloomi/ui";
import { ScrollArea } from "@openloomi/ui";
import { Popover, PopoverContent, PopoverTrigger } from "@openloomi/ui";

export interface MultiComboboxOption {
  value: string;
  label: string;
}

export interface MultiComboboxProps {
  /** Options list */
  options: MultiComboboxOption[];
  /** Currently selected value list */
  value: string[];
  /** Selection change callback */
  onChange: (value: string[]) => void;
  /** Maximum number of selections */
  max?: number;
  /**
   * Maximum number of selected items to display as badges.
   * When selected items exceed `maxVisible`, the remaining count is shown as `+N`.
   */
  maxVisible?: number;
  /** Placeholder text */
  placeholder?: string;
  /** Whether to allow custom input */
  allowCustom?: boolean;
  /** Dropdown search placeholder */
  searchPlaceholder?: string;
  /** Custom item placeholder/button label */
  customPlaceholder?: string;
  /** Parse display text from value (for i18n), if not provided uses options or value */
  getOptionLabel?: (value: string) => string;
  /** Disabled */
  disabled?: boolean;
  /** Root node class */
  className?: string;
}

/**
 * Multi-select combobox: input-style trigger, click to expand dropdown, multi-select + optional custom input, selected items displayed as Badge in the box
 * Conforms to design specs: border-border, rounded-md, bg-background
 */
export function MultiCombobox({
  options,
  value,
  onChange,
  max = 99,
  maxVisible = max,
  placeholder,
  allowCustom = true,
  searchPlaceholder,
  customPlaceholder,
  getOptionLabel,
  disabled = false,
  className,
}: MultiComboboxProps) {
  const { t } = useTranslation();

  const placeholderText =
    placeholder ?? t("common.selectPlaceholder", "Please select...");
  const searchPlaceholderText =
    searchPlaceholder ?? t("common.search", "Search...");
  const customPlaceholderText =
    customPlaceholder ??
    t("common.customInputPlaceholder", "Press Enter to add after input");

  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const [customInput, setCustomInput] = React.useState("");
  const contentRef = React.useRef<HTMLDivElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const measureRef = React.useRef<HTMLDivElement>(null);
  const scrollAreaRef = React.useRef<HTMLDivElement>(null);
  const [calculatedVisibleCount, setCalculatedVisibleCount] =
    React.useState(maxVisible);
  const firstSelectedValue = value[0] ?? "";

  React.useEffect(() => {
    if (open) return;
    setSearch("");
  }, [open]);

  /**
   * Calculates the number of selected items that can be displayed in a single row (including width reservation for +N)
   */
  const recalculateVisibleCount = React.useCallback(() => {
    const trigger = triggerRef.current;
    const measure = measureRef.current;
    if (!trigger || !measure) return;

    const maxAllowedVisible = Math.min(maxVisible, value.length);
    if (maxAllowedVisible <= 0) {
      setCalculatedVisibleCount(0);
      return;
    }

    // Trigger horizontal padding px-3, total 24
    const horizontalPadding = 24;
    // Badge spacing gap-1.5 = 6
    const badgeGap = 6;
    // Right chevron icon (size-4) + spacing from content
    const chevronReserve = 24;
    const availableWidth =
      trigger.clientWidth - horizontalPadding - chevronReserve;

    if (availableWidth <= 0) {
      setCalculatedVisibleCount(0);
      return;
    }

    const badgeWidths = value
      .map((_, index) => {
        const el = measure.querySelector<HTMLElement>(
          `[data-measure-index="${index}"]`,
        );
        return el?.offsetWidth ?? 0;
      })
      .slice(0, maxAllowedVisible);

    const plusWidthMap = new Map<number, number>();
    for (let hidden = 1; hidden <= value.length; hidden++) {
      const plusEl = measure.querySelector<HTMLElement>(
        `[data-measure-plus="${hidden}"]`,
      );
      plusWidthMap.set(hidden, plusEl?.offsetWidth ?? 0);
    }

    let currentWidth = 0;
    let visible = 0;

    for (let i = 0; i < badgeWidths.length; i++) {
      const nextBadgeWidth = badgeWidths[i] ?? 0;
      const hiddenAfterThis = value.length - (i + 1);
      const hasVisibleBefore = visible > 0;
      const badgeGapWidth = hasVisibleBefore ? badgeGap : 0;
      const plusWidth =
        hiddenAfterThis > 0 ? (plusWidthMap.get(hiddenAfterThis) ?? 0) : 0;
      const plusGapWidth = hiddenAfterThis > 0 ? badgeGap : 0;
      const projectedWidth =
        currentWidth +
        badgeGapWidth +
        nextBadgeWidth +
        plusGapWidth +
        plusWidth;

      if (projectedWidth <= availableWidth) {
        currentWidth += badgeGapWidth + nextBadgeWidth;
        visible++;
      } else {
        break;
      }
    }

    setCalculatedVisibleCount(value.length > 0 ? Math.max(1, visible) : 0);
  }, [maxVisible, value]);

  React.useLayoutEffect(() => {
    recalculateVisibleCount();
  }, [recalculateVisibleCount]);

  const scrollSelectedIntoView = React.useCallback((selectedValue: string) => {
    const scrollArea = scrollAreaRef.current;
    if (!scrollArea || !selectedValue) return false;

    const safeValue =
      typeof CSS !== "undefined" ? CSS.escape(selectedValue) : selectedValue;
    const selectedButton = scrollArea.querySelector<HTMLElement>(
      `button[data-value="${safeValue}"][data-selected="true"]`,
    );
    const viewport = scrollArea.querySelector<HTMLElement>(
      "[data-radix-scroll-area-viewport]",
    );

    if (!selectedButton || !viewport || viewport.clientHeight <= 0) {
      return false;
    }

    const viewportRect = viewport.getBoundingClientRect();
    const selectedRect = selectedButton.getBoundingClientRect();
    const selectedTop =
      selectedRect.top - viewportRect.top + viewport.scrollTop;
    const nextScrollTop =
      selectedTop - viewport.clientHeight / 2 + selectedRect.height / 2;
    viewport.scrollTop = Math.max(0, nextScrollTop);
    return true;
  }, []);

  React.useEffect(() => {
    if (!open || !firstSelectedValue || search.trim()) return;

    let cancelled = false;
    let frameId = 0;
    let attempts = 0;

    const tryScroll = () => {
      if (cancelled) return;
      attempts += 1;

      if (scrollSelectedIntoView(firstSelectedValue)) return;
      if (attempts >= 8) return;

      frameId = requestAnimationFrame(tryScroll);
    };

    frameId = requestAnimationFrame(tryScroll);

    return () => {
      cancelled = true;
      cancelAnimationFrame(frameId);
    };
  }, [open, firstSelectedValue, search, scrollSelectedIntoView]);

  React.useEffect(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;

    const observer = new ResizeObserver(() => {
      recalculateVisibleCount();
    });
    observer.observe(trigger);
    return () => observer.disconnect();
  }, [recalculateVisibleCount]);

  const visibleCount = Math.min(
    maxVisible,
    Math.max(0, Math.min(value.length, calculatedVisibleCount)),
  );
  const visibleValues = value.slice(0, visibleCount);
  const hiddenCount = Math.max(0, value.length - visibleValues.length);

  const getLabel = React.useCallback(
    (v: string) => {
      if (getOptionLabel) return getOptionLabel(v);
      const opt = options.find((o) => o.value === v);
      return opt ? opt.label : v;
    },
    [options, getOptionLabel],
  );

  const filteredOptions = React.useMemo(() => {
    if (!search.trim()) return options;
    const s = search.toLowerCase();
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(s) || o.value.toLowerCase().includes(s),
    );
  }, [options, search]);

  const toggle = React.useCallback(
    (v: string) => {
      const next = value.includes(v)
        ? value.filter((x) => x !== v)
        : value.length >= max
          ? value
          : [...value, v];
      onChange(next);
    },
    [value, max, onChange],
  );

  const addCustom = React.useCallback(() => {
    const trimmed = customInput.trim();
    if (!trimmed || value.includes(trimmed) || value.length >= max) return;
    onChange([...value, trimmed]);
    setCustomInput("");
  }, [customInput, value, max, onChange]);

  const remove = React.useCallback(
    (v: string) => {
      onChange(value.filter((x) => x !== v));
    },
    [value, onChange],
  );

  const showCustomHint =
    allowCustom &&
    customInput.trim() &&
    !value.includes(customInput.trim()) &&
    value.length < max;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild disabled={disabled}>
        <button
          ref={triggerRef}
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-haspopup="listbox"
          className={cn(
            "flex h-10 w-full items-center rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 cursor-pointer text-left",
            "appearance-none [&::-webkit-appearance:none]",
            disabled && "cursor-not-allowed opacity-50",
            className,
          )}
        >
          <span className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden whitespace-nowrap">
            {value.length > 0 ? (
              <>
                {visibleValues.map((v) => (
                  <Badge
                    key={v}
                    variant="secondary"
                    className="rounded-md px-2 py-0 font-normal gap-1 pointer-events-none shrink-0 max-w-full"
                  >
                    <span className="truncate">{getLabel(v)}</span>
                    <span
                      role="button"
                      tabIndex={-1}
                      className="rounded hover:bg-muted-foreground/20 pointer-events-auto ml-0.5 inline-flex"
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        remove(v);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          e.stopPropagation();
                          remove(v);
                        }
                      }}
                      aria-label="Remove"
                    >
                      <RemixIcon name="close" size="size-3" />
                    </span>
                  </Badge>
                ))}
                {hiddenCount > 0 && (
                  <Badge
                    variant="secondary"
                    className="rounded-md px-2 py-0 font-normal gap-1 pointer-events-none shrink-0"
                  >
                    +{hiddenCount}
                  </Badge>
                )}
              </>
            ) : (
              <span className="text-muted-foreground truncate">
                {placeholderText}
              </span>
            )}
          </span>
          <RemixIcon
            name="chevron_down"
            size="size-4"
            className="ml-2 shrink-0 text-muted-foreground"
          />
        </button>
      </PopoverTrigger>
      <div
        ref={measureRef}
        aria-hidden="true"
        className="pointer-events-none absolute -z-10 left-0 top-0 h-0 overflow-hidden whitespace-nowrap opacity-0"
      >
        {value.map((v, index) => (
          <Badge
            key={`measure-${v}`}
            variant="secondary"
            data-measure-index={index}
            className="rounded-md px-2 py-0 font-normal gap-1 inline-flex"
          >
            <span>{getLabel(v)}</span>
            <span className="ml-0.5 inline-flex">
              <RemixIcon name="close" size="size-3" />
            </span>
          </Badge>
        ))}
        {Array.from({ length: value.length }, (_, index) => index + 1).map(
          (hidden) => (
            <Badge
              key={`measure-plus-${hidden}`}
              variant="secondary"
              data-measure-plus={hidden}
              className="rounded-md px-2 py-0 font-normal gap-1 inline-flex"
            >
              +{hidden}
            </Badge>
          ),
        )}
      </div>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] p-0"
        align="start"
        onInteractOutside={(e) => {
          const target = e.target as Node;
          if (contentRef.current?.contains(target)) {
            e.preventDefault();
          }
        }}
        onPointerDownOutside={(e) => {
          const target = e.target as Node;
          if (contentRef.current?.contains(target)) {
            e.preventDefault();
          }
        }}
      >
        <div ref={contentRef} className="outline-none">
          <div className="p-2 border-b border-border">
            <Input
              placeholder={searchPlaceholderText}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9"
              autoFocus
            />
          </div>
          <ScrollArea ref={scrollAreaRef} className="h-[200px]">
            <div className="p-1">
              {filteredOptions.map((opt) => {
                const selected = value.includes(opt.value);
                return (
                  <button
                    key={opt.value}
                    type="button"
                    data-selected={selected ? "true" : undefined}
                    data-value={opt.value}
                    className={cn(
                      "w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded-md text-left transition-colors",
                      selected ? "bg-accent" : "hover:bg-accent/50",
                    )}
                    onClick={() => toggle(opt.value)}
                    disabled={!selected && value.length >= max}
                  >
                    <RemixIcon
                      name={selected ? "checkbox_circle" : "checkbox_blank"}
                      size="size-4"
                      filled={selected}
                      className="shrink-0 text-primary"
                    />
                    <span className="truncate">{opt.label}</span>
                  </button>
                );
              })}
            </div>
          </ScrollArea>
          {allowCustom && (
            <div className="p-2 border-t border-border flex gap-2">
              <Input
                placeholder={customPlaceholderText}
                value={customInput}
                onChange={(e) => setCustomInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addCustom();
                  }
                }}
                className="h-9 flex-1"
              />
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
