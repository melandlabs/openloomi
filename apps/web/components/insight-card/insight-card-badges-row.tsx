"use client";

/**
 * Insight card second row: source (channel/task/urgency/importance badges)
 * Uses design tokens: bg-muted, border-border, text-muted-foreground
 */

import { RemixIcon } from "@/components/remix-icon";
import { InsightBadge } from "@/components/insight-badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@openloomi/ui";
import { useTranslation } from "react-i18next";
import "../../i18n";
import {
  insightIsImport,
  insightIsUrgent,
} from "@/lib/insights/focus-classifier";

export interface InsightCardBadgesRowProps {
  platform?: string | null;
  groups?: string[] | null;
  details?: Array<{ platform?: string | null }> | null;
  /** List of category/context names, used to display category badges */
  categories?: string[] | null;
  importance?: string | null;
  urgency?: string | null;
}

export function InsightCardBadgesRow({
  platform,
  groups,
  details,
  categories,
  importance,
  urgency,
}: InsightCardBadgesRowProps) {
  const { t } = useTranslation();

  // Ensure groups is an array (defensive programming: handle potentially unparsed JSON strings)
  // Supports: 1) array 2) JSON string 3) other cases
  let normalizedGroups: string[] = [];
  if (Array.isArray(groups)) {
    normalizedGroups = groups;
  } else if (typeof groups === "string" && groups) {
    try {
      const parsed = JSON.parse(groups);
      normalizedGroups = Array.isArray(parsed) ? parsed : [];
    } catch {
      normalizedGroups = [];
    }
  }
  // Filter out empty strings
  normalizedGroups = normalizedGroups.filter((g) => g?.trim());

  /** Normalized category list: supports array or JSON string, excludes system category keep-focused */
  const displayCategories = (() => {
    if (!categories || categories.length === 0) return [];
    const list = Array.isArray(categories) ? categories : [];
    return list.filter((c) => c && c !== "keep-focused");
  })();

  return (
    <div className="flex items-center gap-1">
      <div className="flex items-center gap-1 flex-wrap flex-1 min-w-0">
        {/* 1. Channel badge */}
        {normalizedGroups.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1">
            {normalizedGroups.slice(0, 2).map((group, index) => (
              <InsightBadge
                key={`${index}|${group}`}
                type="channel"
                label={group}
                platform={platform || details?.[0]?.platform || undefined}
                tooltip={group}
                iconSize="size-3"
              />
            ))}
            {normalizedGroups.length > 2 && (
              <span className="inline-flex items-center rounded-[6px] bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground border border-border">
                +{normalizedGroups.length - 2}
              </span>
            )}
          </div>
        ) : (
          <div className="flex flex-wrap items-center">
            <InsightBadge
              type="channel"
              platform={platform || details?.[0]?.platform || undefined}
              iconSize="size-3"
            />
          </div>
        )}
        {/* 2. Importance badge (with text) */}
        {insightIsImport({ importance: importance ?? undefined }) && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex items-center gap-1 h-[22px] rounded-[6px] bg-transparent px-1.5 py-0.5 text-xs font-medium text-destructive border border-destructive shrink-0">
                <RemixIcon name="alert_triangle" size="size-3" />
                <span>{t("priority.important", "Important")}</span>
              </span>
            </TooltipTrigger>
            <TooltipContent>
              <p>{t("priority.important", "Important")}</p>
            </TooltipContent>
          </Tooltip>
        )}
        {/* 3. Urgency badge (with text) */}
        {insightIsUrgent({ urgency: urgency ?? undefined }) && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex items-center gap-1 h-[22px] rounded-[6px] bg-transparent px-1.5 py-0.5 text-xs font-medium text-accent-brand border border-accent-brand shrink-0">
                <RemixIcon name="flashlight" size="size-3" />
                <span>{t("insight.urgent", "Urgent")}</span>
              </span>
            </TooltipTrigger>
            <TooltipContent>
              <p>{t("insight.urgent", "Urgent")}</p>
            </TooltipContent>
          </Tooltip>
        )}
        {/* 4. Category badge */}
        {displayCategories.length > 0 && (
          <div className="flex flex-wrap items-center gap-1">
            {displayCategories.slice(0, 2).map((cat, index) => (
              <InsightBadge
                key={`ctx-${index}|${cat}`}
                type="context"
                label={cat}
                tooltip={cat}
                iconSize="size-3"
              />
            ))}
            {displayCategories.length > 2 && (
              <span className="inline-flex items-center rounded-[6px] bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground border border-border">
                +{displayCategories.length - 2}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
