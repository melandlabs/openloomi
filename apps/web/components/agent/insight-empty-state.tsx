"use client";

import { useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import "../../i18n";
import Image from "next/image";
import type { AvatarConfiguration } from "@/components/agent-avatar/types";
import { AvatarDisplay } from "@/components/agent-avatar";
import { InsightTipsCard } from "./insight-tips-card";
import { AgentEmptyState } from "./agent-empty-state";

/**
 * Get empty state text key for preset tabs
 * @param tabId - Tab ID
 * @returns Corresponding translation key or undefined
 */
function getPresetTabPlaceholderKey(tabId: string): string | undefined {
  // Determine if it's a preset tab and return the corresponding text key
  if (tabId === "focus" || tabId === "preset:focus") {
    return "insight.noDataPlaceholder.focus";
  }
  if (tabId === "preset:important-people") {
    return "insight.noDataPlaceholder.vip";
  }
  if (tabId === "preset:mentions-me") {
    return "insight.noDataPlaceholder.mentions";
  }
  return undefined;
}

/**
 * List of platforms supported by the system
 */
const SUPPORTED_PLATFORMS = [
  { id: "slack", icon: "/images/apps/slack.png", label: "Slack" },
  { id: "telegram", icon: "/images/apps/telegram.png", label: "Telegram" },
  { id: "discord", icon: "/images/apps/discord.png", label: "Discord" },
  { id: "gmail", icon: "/images/apps/gmail.png", label: "Gmail" },
  { id: "whatsapp", icon: "/images/apps/whatsapp.png", label: "WhatsApp" },
  { id: "imessage", icon: "/images/apps/iMessage.png", label: "iMessage" },
  { id: "teams", icon: "/images/apps/teams.png", label: "Microsoft Teams" },
] as const;

/**
 * Props for the Insight empty state component
 */
export interface InsightEmptyStateProps {
  /**
   * Avatar configuration
   */
  avatarConfig?: AvatarConfiguration | null;
  /**
   * Assistant name
   */
  assistantName: string;
  /**
   * Number of accounts (used to determine if platforms are connected)
   */
  accountsCount: number;
  /**
   * Whether to show the tips card
   */
  showTips?: boolean;
  /**
   * Current tab ID (used to display preset tab-specific text)
   */
  tabId?: string;
}

/**
 * Insight empty state component
 * Used to display placeholders when empty, including avatar, text, platform connection button, and tips card
 */
export function InsightEmptyState({
  avatarConfig,
  assistantName,
  accountsCount,
  showTips = true,
  tabId,
}: InsightEmptyStateProps) {
  const { t } = useTranslation();
  const router = useRouter();

  /**
   * Gets the preset tab-specific text key
   */
  const presetPlaceholderKey = useMemo(
    () => (tabId ? getPresetTabPlaceholderKey(tabId) : undefined),
    [tabId],
  );

  /**
   * Opens Connectors page with add-platform flow (replaces personalization tab).
   */
  const handleGoToIntegrations = useCallback(() => {
    router.push("/connectors?addPlatform=true");
  }, [router]);

  /**
   * Handles keyboard events
   */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        handleGoToIntegrations();
      }
    },
    [handleGoToIntegrations],
  );

  const content =
    accountsCount === 0 ? (
      <>
        <div>
          {t(
            "insight.noDataPlaceholder.noPlatformsConnectedLine1",
            "No platforms connected yet, ",
          )}
        </div>
        <div>
          {t(
            "insight.noDataPlaceholder.noPlatformsConnectedLine2",
            "{{name}} cannot bring you new insights for now.",
            { name: assistantName },
          )}
        </div>
      </>
    ) : presetPlaceholderKey ? (
      <div className="whitespace-pre-line">
        {t(
          presetPlaceholderKey,
          presetPlaceholderKey.replace("insight.noDataPlaceholder.", ""),
          { name: assistantName },
        )}
      </div>
    ) : (
      <>
        <div>
          {t(
            "insight.noDataPlaceholder.line1",
            "When there are new tracked events, {{name}} will keep an eye on them for you.",
            { name: assistantName },
          )}
        </div>
        <div>
          {t(
            "insight.noDataPlaceholder.line2",
            "You can also chat with {{name}} to get some new perspectives.",
            { name: assistantName },
          )}
        </div>
      </>
    );

  const integrationsAction =
    accountsCount === 0 ? (
      <div
        className="relative flex items-center shrink-0 cursor-pointer hover:opacity-80 transition-opacity rounded-md border border-border/60 p-3 gap-2 overflow-hidden mt-4"
        onClick={handleGoToIntegrations}
        role="button"
        tabIndex={0}
        onKeyDown={handleKeyDown}
        aria-label={t(
          "insight.noDataPlaceholder.goToIntegrations",
          "Connect platforms",
        )}
      >
        <div className="absolute inset-0 opacity-30 rounded-md bg-[length:200%_100%] [background-image:linear-gradient(90deg,transparent,hsl(var(--muted)_/_0.3),transparent)] [animation:shimmer_3s_ease-in-out_infinite]" />
        <div className="relative z-10 flex items-center gap-2">
          <span className="text-base font-medium text-foreground whitespace-nowrap">
            {t(
              "insight.noDataPlaceholder.goToIntegrations",
              "Connect platforms",
            )}
          </span>
          <div className="flex items-center -space-x-1.5">
            {SUPPORTED_PLATFORMS.slice(0, 6).map((platform, index) => (
              <div
                key={platform.id}
                className="relative flex items-center justify-center rounded-full border-2 border-card bg-card shadow-sm size-5 overflow-hidden"
                style={{ zIndex: 6 - index }}
                title={platform.label}
              >
                <Image
                  src={platform.icon}
                  alt={platform.label}
                  width={16}
                  height={16}
                  className="rounded-full"
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    ) : null;

  return (
    <div
      className="flex h-full flex-col items-center justify-center pt-4 pb-4"
      style={{ height: "100%" }}
    >
      <AgentEmptyState
        avatarConfig={avatarConfig ?? undefined}
        avatarClassName="size-48"
        className="gap-4 flex h-full flex-col justify-center"
        action={integrationsAction}
      >
        {content}
      </AgentEmptyState>
      {showTips && accountsCount > 0 && (
        <div className="mt-auto">
          <InsightTipsCard />
        </div>
      )}
    </div>
  );
}

/**
 * Props for the Insight refreshing state component
 */
export interface InsightRefreshingStateProps {
  /**
   * Avatar configuration
   */
  avatarConfig?: AvatarConfiguration | null;
  /**
   * Refresh status text (main title)
   */
  refreshStatus?: string | null;
  /**
   * Whether it is currently refreshing
   */
  isRefreshing: boolean;
  /**
   * Refresh progress (0-100)
   */
  refreshProgress?: number | null;
  /**
   * Number of fetched messages
   */
  totalFetchingMsgCount?: number;
  /**
   * Number of accounts (used to determine if tips should be shown)
   */
  accountsCount: number;
  /**
   * Assistant name
   */
  assistantName?: string;
  /**
   * Whether it is first landing (no Insight events)
   */
  isFirstLanding?: boolean;
}

/**
 * Insight refreshing state component
 * Used to display status information during refresh
 */
export function InsightRefreshingState({
  avatarConfig,
  refreshStatus,
  isRefreshing,
  refreshProgress,
  totalFetchingMsgCount,
  accountsCount,
  assistantName,
  isFirstLanding = false,
}: InsightRefreshingStateProps) {
  const { t } = useTranslation();

  /**
   * Gets the assistant name, defaults to "openloomi"
   */
  const name = assistantName || "openloomi";

  /**
   * Checks if there are sessions with messages being fetched
   */
  const hasFetchingSessions = useMemo(() => {
    // This logic should be passed from outside; for now use totalFetchingMsgCount to determine
    return totalFetchingMsgCount !== undefined && totalFetchingMsgCount > 0;
  }, [totalFetchingMsgCount]);

  /**
   * Gets the subtitle text
   */
  const subtitle = useMemo(() => {
    // If there's progress, show subtitle with progress
    if (refreshProgress !== null) {
      const progress = Math.round(refreshProgress ?? 0);

      // Special handling for first-time entry
      if (isFirstLanding) {
        if (refreshStatus?.includes("Connecting your channels")) {
          // First entry - initial refresh state
          return t(
            "insight.refreshingSubtitle.firstLanding.fetching",
            "Syncing data for the first time, may take some time - {{progress}}%",
            { progress },
          );
        }
        if (
          refreshStatus?.includes(
            "Understanding information and extracting insights",
          )
        ) {
          // First entry - generating understanding state
          return t(
            "insight.refreshingSubtitle.firstLanding.summarizing",
            "Converting to Insight events, please wait - {{progress}}%",
            { progress },
          );
        }
        // First entry - default state (with progress)
        return t(
          "insight.refreshingSubtitle.firstLanding.default",
          "Preparing event view - {{progress}}%",
          { progress },
        );
      }

      // Normal flow for non-first entry
      // Determine which stage based on refreshStatus
      if (refreshStatus?.includes("Checking channels")) {
        // Initial refresh state
        return t(
          "insight.refreshingSubtitle.fetching",
          "Syncing latest changes - {{progress}}%",
          { progress },
        );
      }
      if (refreshStatus?.includes("Understanding new")) {
        // Generating understanding state
        return t(
          "insight.refreshingSubtitle.summarizing",
          "Integrating new changes, updating Insight events - {{progress}}%",
          { progress },
        );
      }
      // Default state (with progress)
      return t(
        "insight.refreshingSubtitle.default",
        "Updating Insight events - {{progress}}%",
        { progress },
      );
    }

    // When there's no progress, show default subtitle
    // Use inline fallback to avoid nested key access which may return objects
    if (isFirstLanding) {
      return t("insight.firstLandingWaiting", "Please wait patiently");
    }
    return t("insight.refreshingSubtitle.waiting", "Please wait");
  }, [refreshProgress, refreshStatus, isFirstLanding, t]);

  /**
   * Gets the main title text
   */
  const mainTitle = useMemo(() => {
    if (refreshStatus) {
      return refreshStatus;
    }
    // Default refresh state
    // Use inline fallback to avoid nested key access which may return objects
    if (isFirstLanding) {
      return t(
        "insight.firstLandingSummary",
        "{{name}} is understanding information and distilling key points...",
        { name },
      );
    }
    return t(
      "insight.refreshingSummary.default",
      "{{name}} is understanding newly appearing information...",
      {
        name,
      },
    );
  }, [refreshStatus, name, isFirstLanding, t]);

  return (
    <div className="flex h-full flex-col items-center gap-4 py-8">
      <div className="flex flex-col items-center justify-center gap-4 h-full">
        {avatarConfig && (
          <AvatarDisplay
            config={avatarConfig}
            className="size-48"
            enableInteractions={true}
          />
        )}
        <div className="text-center text-muted-foreground space-y-1">
          <div>{mainTitle}</div>
          <div className="text-xs">{subtitle}</div>
        </div>
      </div>
      {/* Tips card - shown during refresh as well (only when platforms are linked), pushed to bottom with mt-auto */}
      {accountsCount > 0 && (
        <div className="mt-auto">
          <InsightTipsCard />
        </div>
      )}
    </div>
  );
}
