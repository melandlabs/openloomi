"use client";

import * as React from "react";
import { RemixIcon } from "@/components/remix-icon";
import { cn } from "@/lib/utils";
import { Button, Input } from "@openloomi/ui";
import { ScrollArea } from "@openloomi/ui";
import { Popover, PopoverContent, PopoverTrigger } from "@openloomi/ui";

interface ComboboxOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface ComboboxProps {
  options: ComboboxOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  emptyText?: string;
  searchPlaceholder?: string;
  allowCustom?: boolean;
  disabled?: boolean;
  className?: string;
  clearable?: boolean;
  onClear?: () => void;
}

export function Combobox({
  options,
  value,
  onChange,
  placeholder = "Please select...",
  emptyText = "No related results",
  searchPlaceholder = "Search...",
  allowCustom = true,
  disabled = false,
  className,
  clearable = true,
  onClear,
}: ComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const [inputValue, setInputValue] = React.useState("");

  // Reset input when popover closes
  React.useEffect(() => {
    if (!open) {
      setInputValue("");
    }
  }, [open]);

  const currentLabel = React.useMemo(() => {
    const option = options.find((opt) => opt.value === value);
    return option?.label || value || "";
  }, [value, options]);

  const filteredOptions = React.useMemo(() => {
    if (!inputValue) return options;
    return options.filter(
      (option) =>
        option.label.toLowerCase().includes(inputValue.toLowerCase()) ||
        option.value.toLowerCase().includes(inputValue.toLowerCase()),
    );
  }, [inputValue, options]);

  const handleSelect = React.useCallback(
    (selectedValue: string) => {
      onChange(selectedValue);
      setOpen(false);
    },
    [onChange],
  );

  const handleClear = React.useCallback(
    (e: React.MouseEvent | React.KeyboardEvent) => {
      e.stopPropagation();
      onChange("");
      onClear?.();
    },
    [onChange, onClear],
  );

  const showCustomOption =
    allowCustom &&
    inputValue &&
    !filteredOptions.some((o) => o.value === inputValue);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild disabled={disabled}>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "w-full justify-between text-left font-normal h-9",
            !value && "text-muted-foreground",
            className,
          )}
        >
          <span className="truncate">{currentLabel || placeholder}</span>
          <div className="flex items-center gap-1">
            {clearable && value && (
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  handleClear(e);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    handleClear(e);
                  }
                }}
                className="inline-flex"
              >
                <RemixIcon
                  name="close"
                  size="size-3.5"
                  className="opacity-50 hover:opacity-80 cursor-pointer"
                />
              </span>
            )}
            <RemixIcon
              name="chevron_down"
              size="size-3.5"
              className="opacity-50"
            />
          </div>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] p-0"
        align="start"
      >
        <div className="p-2">
          {/* Search input */}
          <div className="relative">
            <RemixIcon
              name="search"
              size="size-4"
              className="absolute left-2.5 top-2.5 text-muted-foreground"
            />
            <Input
              placeholder={searchPlaceholder}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              className="pl-9 h-9"
              autoFocus
            />
          </div>
        </div>

        {/* Options list */}
        <ScrollArea className="h-[200px]">
          <div className="py-1 px-1">
            {filteredOptions.length === 0 && !showCustomOption && (
              <div className="px-2 py-6 text-center text-sm text-muted-foreground">
                {emptyText}
              </div>
            )}

            {showCustomOption && (
              <button
                type="button"
                className="w-full flex items-center gap-2 px-2 py-2 text-sm hover:bg-accent rounded-md transition-colors cursor-pointer text-left"
                onClick={() => handleSelect(inputValue)}
              >
                <span className="text-xs text-muted-foreground">
                  Use custom:
                </span>
                <span className="font-medium">{inputValue}</span>
              </button>
            )}

            {filteredOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                className={cn(
                  "w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded-md transition-colors cursor-pointer text-left",
                  value === option.value ? "bg-accent" : "hover:bg-accent/50",
                  option.disabled && "opacity-50 cursor-not-allowed",
                )}
                onClick={() => !option.disabled && handleSelect(option.value)}
                disabled={option.disabled}
              >
                <RemixIcon
                  name="check"
                  size="size-4"
                  className={cn(
                    "shrink-0",
                    value === option.value ? "opacity-100" : "opacity-0",
                  )}
                />
                <span className="flex-1 truncate">{option.label}</span>
              </button>
            ))}
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
