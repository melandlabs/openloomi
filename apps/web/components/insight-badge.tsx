"use client";

import type { ReactNode } from "react";
import { RemixIcon } from "@/components/remix-icon";
import IntegrationIcon from "@/components/integration-icon";
import { Tooltip, TooltipContent, TooltipTrigger } from "@openloomi/ui";

export type InsightBadgeType =
  | "keyword"
  | "person"
  | "action"
  | "urgent"
  | "important"
  | "channel"
  | "context"
  | "priority"
  | "status"
  | "taskBucket"
  | "datetime"
  | "focusGroup";

/** Focus group badge levels: High / Medium / Low, consistent with Brief and Focus page display */
export type FocusGroupLevel = "high" | "medium" | "low";

/** Focus group badge level list (order: high to low) */
export const FOCUS_GROUP_LEVELS: readonly FocusGroupLevel[] = [
  "high",
  "medium",
  "low",
] as const;

/** Focus group badge default labels (can be overridden by label prop for i18n) */
export const FOCUS_GROUP_LABELS: Record<FocusGroupLevel, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};

export type PriorityValue = "vip" | "high" | "medium" | "low";
export type StatusValue = "active" | "dormant";

export interface InsightBadgeProps {
  type: InsightBadgeType;
  /** Required for focusGroup: high / medium / low */
  focusGroupLevel?: FocusGroupLevel;
  /** Optional for focusGroup: count to display after label, rendered as (n) with opacity-70 */
  count?: number;
  label?: string; // Optional; if not provided, only icon is shown; for focusGroup defaults to FOCUS_GROUP_LABELS
  platform?: string | null; // Used for channel type, specifies platform to show corresponding icon
  priority?: PriorityValue; // Used for priority type
  status?: StatusValue; // Used for status type
  variant?: "soft" | "solid"; // Used for priority and status types, defaults to "soft"
  tooltip?: string;
  className?: string;
  iconSize?: string; // Icon size, defaults to "size-3"; focusGroup uses size-4
  iconOnly?: boolean; // Whether to show only the icon, defaults to false
}

const FOCUS_GROUP_ICONS: Record<FocusGroupLevel, string> = {
  high: "signal_cellular_3",
  medium: "signal_cellular_2",
  low: "signal_cellular_1",
};

export function InsightBadge({
  type,
  focusGroupLevel,
  count,
  label,
  platform,
  priority,
  status,
  variant = "soft",
  tooltip,
  className = "",
  iconSize = "size-3",
  iconOnly = false,
}: InsightBadgeProps) {
  /**
   * Get icon
   */
  const getIcon = (): ReactNode => {
    switch (type) {
      case "focusGroup": {
        const level = focusGroupLevel ?? "high";
        return (
          <RemixIcon
            name={FOCUS_GROUP_ICONS[level]}
            size="size-4"
            filled
            className="text-foreground"
          />
        );
      }
      case "keyword":
        return <RemixIcon name="hashtag" size={iconSize} />;
      case "person":
        return <RemixIcon name="user_round" size={iconSize} />;
      case "action":
        return <RemixIcon name="clipboard_list" size={iconSize} />;
      case "urgent":
        return <RemixIcon name="flashlight" size={iconSize} />;
      case "important":
        return <RemixIcon name="error_warning" size={iconSize} />;
      case "channel":
        // If platform info is available, use platform icon; otherwise use default Message icon
        // Channel icons consistently use 12px (size-[12px])
        return platform ? (
          <IntegrationIcon platform={platform} size="size-[12px]" />
        ) : (
          <RemixIcon name="message" size="size-[12px]" />
        );
      case "context":
        return <RemixIcon name="hashtag" size={iconSize} />;
      case "priority":
        // priority type does not show icon, only text
        return null;
      case "status":
        // status type does not show icon, only text
        return null;
      case "taskBucket":
        return null;
      case "datetime":
        return <RemixIcon name="clock" size={iconSize} />;
      default:
        return null;
    }
  };

  /**
   * Get base styles
   */
  const getBaseStyles = (): string => {
    switch (type) {
      case "focusGroup": {
        const level = focusGroupLevel ?? "high";
        const focusGroupBg: Record<FocusGroupLevel, string> = {
          high: "bg-red-50 hover:bg-red-50",
          medium: "bg-yellow-50 hover:bg-yellow-50",
          low: "bg-[var(--primary-50)] hover:bg-[var(--primary-50)]",
        };
        return `inline-flex items-center justify-start gap-1.5 px-3 py-1.5 rounded-md border text-xs font-medium shrink-0 text-foreground border-border ${focusGroupBg[level]}`;
      }
      case "keyword":
        return "inline-flex items-center rounded-[6px] bg-surface-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground";
      case "person":
        return "inline-flex items-center rounded-[6px] bg-surface-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground";
      case "action":
        return "inline-flex items-center rounded-[6px] bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary";
      case "urgent":
        return "inline-flex items-center gap-1 h-[22px] rounded-[6px] bg-transparent px-2 py-0.5 text-xs font-medium text-orange-700 border border-orange-700 shrink-0";
      case "important":
        return "inline-flex items-center gap-1 h-[22px] rounded-[6px] bg-transparent px-2 py-0.5 text-xs font-medium text-red-700 border border-red-700 shrink-0";
      case "channel":
        return "inline-flex items-center justify-start min-h-5 gap-1 rounded-[6px] border border-border/70 bg-surface px-1.5 py-0.5 text-xs font-medium text-foreground";
      case "context":
        return "inline-flex items-center gap-1 rounded-[6px] bg-transparent px-1.5 py-0.5 text-xs font-medium text-muted-foreground border border-muted-foreground";
      case "taskBucket":
        return "inline-flex items-center min-h-5 gap-1 rounded-[6px] border border-border/70 bg-surface px-1.5 py-0.5 text-xs font-medium text-foreground shrink-0";
      case "datetime":
        return "inline-flex items-center min-h-5 gap-1 rounded-[6px] border border-border/70 bg-surface px-1.5 py-0.5 text-xs font-medium text-muted-foreground shrink-0";
      case "priority":
        // Task priority: high red / medium yellow / low gray
        if (!priority) {
          return "inline-flex items-center min-h-5 rounded-[6px] border px-2 py-0.5 text-xs font-medium";
        }
        if (variant === "solid") {
          const solidStyles: Record<PriorityValue, string> = {
            vip: "bg-red-600 text-white border-red-600",
            high: "bg-red-600 text-white border-red-600",
            medium: "bg-amber-500 text-white border-amber-500",
            low: "bg-slate-500 text-white border-slate-500",
          };
          return `inline-flex items-center min-h-5 gap-1 rounded-[6px] border px-2 py-0.5 text-xs font-medium ${solidStyles[priority]}`;
        } else {
          const softStyles: Record<PriorityValue, string> = {
            vip: "bg-red-50 text-red-700 border-red-100",
            high: "bg-red-50 text-red-700 border-red-100",
            medium: "bg-amber-50 text-amber-700 border-amber-100",
            low: "bg-slate-100 text-slate-600 border-slate-200",
          };
          return `inline-flex items-center min-h-5 gap-1 rounded-[6px] border px-2 py-0.5 text-xs font-medium ${softStyles[priority]}`;
        }
      case "status":
        // Status type styles, using unified background color D1FAE5
        if (!status) {
          return "inline-flex items-center gap-1 rounded-[6px] border px-2 py-0.5 text-xs font-medium";
        }
        if (variant === "solid") {
          // solid variant: dark background with white text
          const solidStyles: Record<StatusValue, string> = {
            active: "bg-[#059669] text-white border-[#059669]",
            dormant: "bg-[#6B7280] text-white border-[#6B7280]",
          };
          return `inline-flex items-center gap-1 rounded-[6px] border px-2 py-0.5 text-xs font-medium ${solidStyles[status]}`;
        } else {
          // soft variant: active uses D1FAE5 background, dormant uses gray
          const softStyles: Record<StatusValue, string> = {
            active: "bg-[#D1FAE5] text-[#059669] border-[#6EE7B7]",
            dormant: "bg-[#F3F4F6] text-[#6B7280] border-[#D1D5DB]",
          };
          return `inline-flex items-center gap-1 rounded-[6px] border px-2 py-0.5 text-xs font-medium ${softStyles[status]}`;
        }
      default:
        return "inline-flex items-center rounded-[6px] px-1.5 py-0.5 text-xs font-medium";
    }
  };

  const icon = getIcon();
  let baseStyles = getBaseStyles();
  // Channel badge icon-only: rounded-full (pill), horizontal padding 3px (px-[3px])
  const isChannelIconOnly = type === "channel" && !label;
  if (isChannelIconOnly) {
    baseStyles = baseStyles.replace("rounded-[6px]", "rounded-[9999px]");
    baseStyles = baseStyles.replace("gap-1", "gap-0");
    baseStyles = baseStyles.replace("px-2", "px-[3px]");
  }
  // focusGroup uses default label (High/Medium/Low) when label is not provided
  const effectiveLabel =
    type === "focusGroup" && focusGroupLevel && label === undefined
      ? FOCUS_GROUP_LABELS[focusGroupLevel]
      : label;
  // All badges have unified max width (icon-only channel not limited; focusGroup not truncated)
  // channel type expanded to 140px, others 96px
  const maxWidthStyles =
    isChannelIconOnly || type === "focusGroup"
      ? ""
      : type === "channel"
        ? "max-w-[140px]"
        : "max-w-[96px]";
  const textTruncateStyles = effectiveLabel ? "truncate min-w-0" : "";
  const combinedClassName =
    `${baseStyles} ${maxWidthStyles} ${textTruncateStyles} ${className}`.trim();

  // For channel type, if label is too short (<=1 character), do not show text (prevents displaying abnormal single characters)
  const shouldShowLabel =
    effectiveLabel && (type !== "channel" || effectiveLabel.length > 1);

  /** For channel type with label, if tooltip is not provided, use full channel name as hover tooltip */
  const channelTooltip =
    type === "channel" && shouldShowLabel && tooltip === undefined
      ? effectiveLabel
      : tooltip;

  const badgeContent = iconOnly ? (
    <span className={combinedClassName}>{icon}</span>
  ) : (
    <span className={combinedClassName}>
      {icon && <span className="shrink-0">{icon}</span>}
      {shouldShowLabel && (
        <span className="truncate min-w-0">{effectiveLabel}</span>
      )}
      {type === "focusGroup" && count != null && (
        <span className="opacity-70 text-xs shrink-0">({count})</span>
      )}
    </span>
  );

  if (channelTooltip) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{badgeContent}</TooltipTrigger>
        <TooltipContent>
          <p className="text-xs max-w-[240px] break-words">{channelTooltip}</p>
        </TooltipContent>
      </Tooltip>
    );
  }

  return badgeContent;
}
