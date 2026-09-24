"use client";

import { Badge } from "@openloomi/ui";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { AI_SETTINGS_CHANGED_EVENT } from "@/lib/ai/conversation-api-configuration";
import {
  LLM_PROVIDER_CATALOG,
  type LlmProviderId,
} from "@/lib/ai/llm-providers";
import type { LlmUsageSummary } from "@/lib/llm-usage/types";
import { fetchWithAuth } from "@/lib/utils";

type UsagePanelStatus = "loading" | "unconfigured" | "ready" | "error";

/**
 * Decide which state the usage panel renders from the summary endpoint
 * response. Kept pure so the decision table stays unit-testable.
 */
export function resolveUsagePanelStatus(
  loading: boolean,
  summary: LlmUsageSummary | null,
): UsagePanelStatus {
  if (loading && !summary) return "loading";
  if (!summary || summary.error) return "error";
  if (!summary.configured) return "unconfigured";
  return "ready";
}

/**
 * Compact token-count formatting for the stats tiles: exact below 10k,
 * abbreviated above. Counts themselves stay exact in the summary — this
 * only shortens the display.
 */
export function formatTokenCount(count: number): string {
  if (!Number.isFinite(count) || count < 0) return "—";
  if (count < 10_000) return String(count);
  if (count < 1_000_000) {
    return `${trimUnitFraction((count / 1_000).toFixed(1))}k`;
  }
  return `${trimUnitFraction((count / 1_000_000).toFixed(1))}M`;
}

function trimUnitFraction(value: string): string {
  return value.endsWith(".0") ? value.slice(0, -2) : value;
}

/**
 * Recorded `providerType` values come from usage rows, which can predate
 * the current provider catalog (e.g. "unknown"), so fall back to the raw
 * value instead of assuming every key resolves.
 */
export function providerTypeDisplayName(providerType: string): string {
  const definition = LLM_PROVIDER_CATALOG[providerType as LlmProviderId];
  return definition?.displayName ?? providerType;
}

function UsageStat({
  label,
  value,
  subline,
}: {
  label: string;
  value: string;
  subline?: string;
}) {
  return (
    <div className="rounded-md border border-border/60 bg-muted/30 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-medium break-words text-foreground">
        {value}
      </p>
      {subline ? (
        <p className="text-xs text-muted-foreground">{subline}</p>
      ) : null}
    </div>
  );
}

export function LlmUsagePanel() {
  const { t } = useTranslation();
  const [summary, setSummary] = useState<LlmUsageSummary | null>(null);
  const [loading, setLoading] = useState(true);

  const loadSummary = useCallback(async () => {
    try {
      const response = await fetchWithAuth("/api/llm/usage/summary");
      if (!response.ok) {
        setSummary(null);
        return;
      }
      setSummary((await response.json()) as LlmUsageSummary);
    } catch {
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSummary();
    // Refresh after the user saves/resets a provider so the panel
    // reflects the newly active configuration without a reload.
    const listener = () => {
      void loadSummary();
    };
    window.addEventListener(AI_SETTINGS_CHANGED_EVENT, listener);
    return () => {
      window.removeEventListener(AI_SETTINGS_CHANGED_EVENT, listener);
    };
  }, [loadSummary]);

  const status = resolveUsagePanelStatus(loading, summary);
  const totals = summary?.totals;

  return (
    <section className="rounded-lg border border-border bg-background p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-semibold text-foreground">
          {t("settings.llmUsageTitle", "API usage")}
        </p>
        <Badge
          variant="secondary"
          className="h-5 rounded-md px-2 text-[11px] font-medium"
        >
          {t("settings.llmUsageLocalBadge", "Local")}
        </Badge>
      </div>

      {status === "loading" ? (
        <p className="mt-2 text-sm text-muted-foreground">
          {t("settings.llmUsageLoading", "Loading usage…")}
        </p>
      ) : status === "unconfigured" ? (
        <p className="mt-2 text-sm text-muted-foreground">
          {t(
            "settings.llmUsageUnconfigured",
            "Save a provider configuration to start tracking token usage.",
          )}
        </p>
      ) : status === "error" ? (
        <p className="mt-2 text-sm text-muted-foreground">
          {t(
            "settings.llmUsageError",
            "Usage tracking is unavailable right now.",
          )}
        </p>
      ) : summary && totals ? (
        <>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <UsageStat
              label={t("settings.llmUsageProvider", "Active provider")}
              value={
                summary.currentProvider
                  ? providerTypeDisplayName(summary.currentProvider.providerType)
                  : "—"
              }
              subline={summary.currentProvider?.model ?? undefined}
            />
            <UsageStat
              label={t("settings.llmUsageRequests", "Requests")}
              value={summary.runCount.toLocaleString()}
            />
            <UsageStat
              label={t("settings.llmUsageTokens", "Tokens")}
              value={formatTokenCount(totals.totalTokens)}
              subline={`${t("settings.llmUsageTokensIn", "in")} ${formatTokenCount(totals.inputTokens)} · ${t("settings.llmUsageTokensOut", "out")} ${formatTokenCount(totals.outputTokens)}`}
            />
            <UsageStat
              label={t("settings.llmUsageLastActivity", "Last activity")}
              value={
                summary.lastRunAt
                  ? new Date(summary.lastRunAt).toLocaleDateString()
                  : "—"
              }
            />
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            {t(
              "settings.llmUsageFootnote",
              "Token counts are recorded locally by OpenLoomi and may exclude requests that fail before the provider reports usage. Your provider's billing dashboard remains the source of truth for spend.",
            )}
          </p>
        </>
      ) : null}
    </section>
  );
}
