"use client";

import { cn } from "@/lib/utils";
import type { InlineRefKind } from "@openloomi/shared/ref";

/**
 * Inline reference Badge: displayed mixed with text inside message bubbles or input fields.
 * Style reference lexical-beautiful-mentions: pill shape, clear type color, compact and readable.
 */
export function InlineRefBadge({
  kind,
  label,
  t,
  className,
}: {
  kind: InlineRefKind;
  label: string;
  t: (key: string, fallback: string) => string;
  className?: string;
}) {
  const typeLabel =
    kind === "people"
      ? t("chat.badgePeople", "People")
      : kind === "task"
        ? t("chat.badgeTask", "Action items")
        : kind === "channel"
          ? t("chat.badgeChannel", "Channels")
          : kind === "event"
            ? t("chat.badgeEvent", "Events")
            : t("chat.badgeFile", "Files");
  const bgClass =
    kind === "people"
      ? "bg-sky-100/90 dark:bg-sky-900/40 border-sky-200 dark:border-sky-700/80"
      : kind === "task"
        ? "bg-amber-100/90 dark:bg-amber-900/40 border-amber-200 dark:border-amber-700/80"
        : kind === "channel"
          ? "bg-emerald-100/90 dark:bg-emerald-900/40 border-emerald-200 dark:border-emerald-700/80"
          : kind === "event"
            ? "bg-indigo-100/90 dark:bg-indigo-900/40 border-indigo-200 dark:border-indigo-700/80"
            : "bg-violet-100/90 dark:bg-violet-900/40 border-violet-200 dark:border-violet-700/80";
  const typeColorClass =
    kind === "people"
      ? "text-sky-600 dark:text-sky-400"
      : kind === "task"
        ? "text-amber-600 dark:text-amber-400"
        : kind === "channel"
          ? "text-emerald-600 dark:text-emerald-400"
          : kind === "event"
            ? "text-indigo-600 dark:text-indigo-400"
            : "text-violet-600 dark:text-violet-400";
  /** The event label may be id|title; display takes the title part */
  const displayLabel =
    kind === "event" && label.includes("|")
      ? label.split("|").slice(1).join("|").trim() || label
      : label;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium align-baseline",
        "shadow-sm",
        bgClass,
        "shrink-0 max-w-[180px]",
        className,
      )}
      title={displayLabel}
    >
      <span className={cn("shrink-0", typeColorClass)}>{typeLabel}</span>
      <span className="truncate text-foreground/90">{displayLabel}</span>
    </span>
  );
}
