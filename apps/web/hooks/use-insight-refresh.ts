import { useState, useRef, useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useSession } from "next-auth/react";
import { autoCleanupOldMessages } from "@openloomi/indexeddb/client";
import { getAuthToken } from "@/lib/auth/token-manager";

/**
 * Refresh error information interface
 */
interface RefreshError {
  code: string;
  message: string;
  friendlyMessage: string;
  errors?: Array<{
    botId?: string;
    error: string;
    friendlyMessage: string;
  }>;
  errorCount?: number;
  actionType?:
    | "telegram_reconnect"
    | "slack_reconnect"
    | "discord_reconnect"
    | "retry"
    | null;
}

/**
 * Return value of Insight refresh Hook
 */
interface UseInsightRefreshReturn {
  isRefreshing: boolean;
  refreshStatus: string | null;
  refreshError: RefreshError | null;
  handleRefresh: () => Promise<void>;
  stopAutoRefresh: () => void; // Expose method to stop auto refresh (optional)
}

/**
 * Auto refresh configuration options
 */
interface AutoRefreshOptions {
  enabled?: boolean; // Whether auto refresh is enabled
  interval?: number; // Normal refresh interval (ms), defaults to 30 minutes (1800000)
  retryInterval?: number; // Retry interval during refresh (ms), defaults to 1 minute (60000)
}

/**
 * Custom hook for Insight refresh related functionality
 * @param assistantName - Assistant name, used to replace "openloomi" in copy
 * @param isFirstLanding - Whether it's the first visit (no Insight events)
 * @param initialRefresh - Whether to execute refresh once on Hook initialization, defaults to true
 * @param autoRefreshOptions - Auto refresh configuration, defaults to enabled
 * @returns Refresh-related state and functions
 */
export function useInsightRefresh(
  assistantName?: string,
  isFirstLanding?: boolean,
  initialRefresh = true,
  autoRefreshOptions: AutoRefreshOptions = {
    enabled: true,
    interval: 1800000,
    retryInterval: 60000,
  },
): UseInsightRefreshReturn {
  const { t } = useTranslation();
  const { data: session } = useSession();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshStatus, setRefreshStatus] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<RefreshError | null>(null);

  // Use Ref to sync state, avoiding frequent rebuilds due to useCallback depending on state
  const isRefreshingRef = useRef(isRefreshing);
  const refreshPollingRef = useRef<boolean>(false);
  // Timer Ref
  const refreshTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Sync refresh state to Ref
  useEffect(() => {
    isRefreshingRef.current = isRefreshing;
  }, [isRefreshing]);

  // Assistant name
  const name = assistantName || "openloomi";

  /**
   * Convert API errors to friendly error messages
   */
  const getFriendlyErrorMessage = useCallback(
    (errorData: {
      code?: string;
      message?: string;
      cause?: string;
      botId?: string;
    }): string => {
      const { code, message, cause } = errorData;

      // Combine all fields that may contain error information
      const allErrorText = [message, cause]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      // Telegram authentication error
      if (
        code?.includes("telegram") ||
        allErrorText.includes("telegram") ||
        allErrorText.includes("auth_bytes_invalid") ||
        allErrorText.includes("auth_key_unregistered") ||
        allErrorText.includes("auth_key_duplicated")
      ) {
        if (
          allErrorText.includes("auth_bytes_invalid") ||
          allErrorText.includes("auth_key_unregistered")
        ) {
          return t(
            "insight.refreshError.telegramAuth",
            "Telegram authentication expired, please reconnect",
          );
        }
        if (allErrorText.includes("auth_key_duplicated")) {
          return t(
            "insight.refreshError.telegramDuplicate",
            "Telegram account is already logged in elsewhere",
          );
        }
        return t(
          "insight.refreshError.telegram",
          "Telegram connection error, please check authorization",
        );
      }

      // Timeout error
      if (allErrorText.includes("timeout")) {
        return t(
          "insight.refreshError.timeout",
          "Request timed out, please try again",
        );
      }

      // Decryption error - token is invalid or corrupted
      if (
        allErrorText.includes("decrypt") ||
        allErrorText.includes("invalid version") ||
        allErrorText.includes("fernet")
      ) {
        return t(
          "insight.refreshError.decrypt",
          "Authorization token expired, please reconnect your account",
        );
      }

      // RSS/subscription source error
      if (
        allErrorText.includes("rss") ||
        (allErrorText.includes("fetch") && allErrorText.includes("insights"))
      ) {
        // Try to extract URL
        const urlMatch = allErrorText.match(/url\s+(https?:\/\/[^\s,]+)/i);
        const url = urlMatch ? urlMatch[1] : null;

        if (url) {
          return t(
            "insight.refreshError.rssWithURL",
            "Failed to fetch subscription content: {{url}}",
            { url },
          );
        }
        return t(
          "insight.refreshError.rss",
          "Failed to fetch subscription content, please check if the source is available",
        );
      }

      // Network error
      if (
        allErrorText.includes("network") ||
        allErrorText.includes("etimedout") ||
        allErrorText.includes("econnrefused") ||
        allErrorText.includes("fetch failed")
      ) {
        return t(
          "insight.refreshError.network",
          "Network connection error, please check your network settings",
        );
      }

      // LLM-related errors - only use when clearly an LLM issue
      if (
        (allErrorText.includes("openai") && allErrorText.includes("api")) ||
        (allErrorText.includes("llm") && !allErrorText.includes("rss")) ||
        allErrorText.includes("anthropic") ||
        allErrorText.includes("claude")
      ) {
        return t(
          "insight.refreshError.ai",
          "AI service temporarily unavailable, please try again later",
        );
      }

      // Database error
      if (code?.includes("database") || allErrorText.includes("database")) {
        return t(
          "insight.refreshError.database",
          "Data storage error, please try again later",
        );
      }

      // Authentication error
      if (
        code?.includes("unauthorized") ||
        code?.includes("auth") ||
        allErrorText.includes("unauthorized")
      ) {
        return t(
          "insight.refreshError.auth",
          "Authentication expired, please log in again",
        );
      }

      // Insufficient credits error
      if (
        code?.includes("rate_limit") ||
        allErrorText.includes("credits") ||
        allErrorText.includes("credit") ||
        allErrorText.includes("insufficient") ||
        allErrorText.includes("exhausted")
      ) {
        return t(
          "insight.refreshError.credits",
          "Insufficient credits, please upgrade your plan and try again",
        );
      }

      // Slack-related errors
      if (
        allErrorText.includes("slack") ||
        allErrorText.includes("missing_scope")
      ) {
        return t(
          "insight.refreshError.slack",
          "Slack authorization expired, please reconnect",
        );
      }

      // Discord-related errors
      if (allErrorText.includes("discord")) {
        return t(
          "insight.refreshError.discord",
          "Discord connection error, please check authorization",
        );
      }

      // Default error message
      return (
        message ||
        t("insight.refreshError.default", "Refresh failed, please try again")
      );
    },
    [t],
  );

  /**
   * Core refresh logic
   */
  const handleRefresh = useCallback(async () => {
    if (isRefreshingRef.current || refreshPollingRef.current) {
      return;
    }

    setIsRefreshing(true);
    refreshPollingRef.current = true;
    setRefreshError(null); // Clear previous error

    // Set initial refresh copy
    if (isFirstLanding) {
      setRefreshStatus(
        t(
          "insight.refreshingFetchMessage.firstLanding",
          "{{name}} is connecting to your channels…",
          { name },
        ),
      );
    } else {
      setRefreshStatus(
        t(
          "insight.refreshingFetchMessage.default",
          "{{name}} is checking for updates from your channels…",
          { name },
        ),
      );
    }

    try {
      // Get cloud auth token for AI Provider authentication
      const headers: HeadersInit = {};
      try {
        const cloudAuthToken = getAuthToken();
        if (cloudAuthToken) {
          headers.Authorization = `Bearer ${cloudAuthToken}`;
        }
      } catch (error) {
        console.error(
          "[useInsightRefresh] Failed to read cloud_auth_token:",
          error,
        );
      }

      // Use a 5-minute timeout — enough for the slowest possible refresh
      // (max 12 concurrent bots × ~20s each ≈ 240s, plus response delivery)
      const refreshResponse = await fetch("/api/insights/all", {
        method: "GET",
        headers,
        credentials: "include",
        signal: AbortSignal.timeout(5 * 60 * 1000),
      });

      if (!refreshResponse.ok) {
        // Try to parse error information from response
        let errorData: { code?: string; message?: string; cause?: string } = {};
        try {
          const errorBody = await refreshResponse.json();
          errorData = {
            code: errorBody.code,
            message: errorBody.message,
            cause: errorBody.cause,
          };
        } catch {
          // If unable to parse JSON, use default error
          errorData = { message: `HTTP ${refreshResponse.status}` };
        }

        // Use readable message as Error content to avoid JSON strings being displayed as console errors
        const message =
          typeof errorData.message === "string" && errorData.message
            ? errorData.message
            : `Request failed (${refreshResponse.status})`;
        const error = new Error(message);
        (error as Error & { cause?: typeof errorData }).cause = errorData;
        throw error;
      }

      const refreshResult = await refreshResponse.json();

      // Check if there are errors (from API's errors field)
      if (
        refreshResult.errors &&
        Array.isArray(refreshResult.errors) &&
        refreshResult.errors.length > 0
      ) {
        // Parse all errors
        const parsedErrors = refreshResult.errors.map((err: any) => {
          let errorData: {
            code?: string;
            message?: string;
            cause?: string;
            botId?: string;
          } = {
            botId: err.botId,
            message: err.error,
          };

          // Try to extract more information from error messages
          try {
            if (err.error && typeof err.error === "string") {
              // Check if it contains JSON-formatted error
              const jsonMatch = err.error.match(/\{[^}]*\}/);
              if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                errorData = { ...errorData, ...parsed };
              }

              // Check for common error patterns
              if (
                err.error.includes("AUTH_BYTES_INVALID") ||
                err.error.includes("AUTH_KEY_UNREGISTERED") ||
                err.error.includes("AUTH_KEY_DUPLICATED")
              ) {
                errorData.code = "telegram";
              }
            }
          } catch (e) {
            // Parse failed, use original error message
          }

          const friendlyMessage = getFriendlyErrorMessage(errorData);

          return {
            botId: err.botId,
            error: err.error,
            friendlyMessage,
          };
        });

        // Deduplicate error messages, only keep one for each unique friendlyMessage
        const uniqueErrorsMap = new Map<string, (typeof parsedErrors)[0]>();
        parsedErrors.forEach((err: (typeof parsedErrors)[0]) => {
          if (!uniqueErrorsMap.has(err.friendlyMessage)) {
            uniqueErrorsMap.set(err.friendlyMessage, err);
          }
        });
        const uniqueErrors = Array.from(uniqueErrorsMap.values());

        // Get main error type (use type of first error)
        const firstError = uniqueErrors[0];
        const errorData = {
          code: firstError.friendlyMessage.includes("Telegram")
            ? "telegram"
            : firstError.friendlyMessage.includes("Slack")
              ? "slack"
              : firstError.friendlyMessage.includes("Discord")
                ? "discord"
                : firstError.friendlyMessage.includes("subscription") ||
                    firstError.friendlyMessage.includes(
                      "Unable to fetch subscription",
                    ) ||
                    firstError.friendlyMessage.includes("RSS")
                  ? "rss"
                  : firstError.friendlyMessage.includes("timeout") ||
                      firstError.friendlyMessage.includes("timeout")
                    ? "timeout"
                    : firstError.friendlyMessage.includes("Network")
                      ? "network"
                      : firstError.friendlyMessage.includes("AI") ||
                          firstError.friendlyMessage.includes("LLM")
                        ? "ai"
                        : "api_error",
          message: t(
            "insight.multipleChannelsFailed",
            "{{count}} channel(s) failed to refresh",
            { count: refreshResult.errors.length },
          ),
          friendlyMessage:
            uniqueErrors.length === 1
              ? firstError.friendlyMessage
              : t(
                  "insight.multipleChannelsFailedWithDetails",
                  "{{count}} channel(s) failed to refresh, click for details",
                  { count: refreshResult.errors.length },
                ),
        };

        // Determine the operation type to execute
        let actionType:
          | "telegram_reconnect"
          | "slack_reconnect"
          | "discord_reconnect"
          | "retry"
          | null = null;
        if (errorData.code === "telegram") {
          actionType = "telegram_reconnect";
        } else if (errorData.code === "slack") {
          actionType = "slack_reconnect";
        } else if (errorData.code === "discord") {
          actionType = "discord_reconnect";
        } else {
          actionType = "retry";
        }

        // Set error state
        setRefreshError({
          code: errorData.code,
          message: errorData.message,
          friendlyMessage: errorData.friendlyMessage,
          errors: uniqueErrors,
          errorCount: uniqueErrors.length,
          actionType,
        });

        setRefreshStatus(null);
        setIsRefreshing(false);
        refreshPollingRef.current = false;

        return; // Return early, don't continue
      }

      // Update refresh status text
      if (refreshResult.successful !== undefined) {
        if (isFirstLanding) {
          setRefreshStatus(
            t(
              "insight.refreshingSummary.firstLanding",
              "{{name}} is understanding the information and extracting insights…",
              { name },
            ),
          );
        } else {
          setRefreshStatus(
            t(
              "insight.refreshingSummary.default",
              "{{name}} is understanding new information…",
              { name },
            ),
          );
        }
      }

      // Store raw messages to IndexedDB
      if (
        refreshResult.rawMessages &&
        Array.isArray(refreshResult.rawMessages)
      ) {
        try {
          const { storeRawMessagesFromInsight } =
            await import("@openloomi/indexeddb/client");
          const userId = session?.user?.id;
          if (userId) {
            const result = await storeRawMessagesFromInsight(
              userId,
              refreshResult.rawMessages,
            );
            console.log(
              `[Raw Messages] Stored ${result.stored} raw messages to IndexedDB for userId: ${userId}`,
            );
            // Auto-cleanup old messages based on user entitlements
            await autoCleanupOldMessages(userId);
          }
        } catch (error) {
          console.error("[Raw Messages] Failed to store raw messages:", error);
        }
      }

      setIsRefreshing(false);
      refreshPollingRef.current = false;
    } catch (error) {
      console.error("Error refreshing insights:", error);

      // Try to parse error information returned by API
      let errorData: { code?: string; message?: string; cause?: string } = {};
      let errorMessage = "Unknown error";

      if (error instanceof Error) {
        errorMessage = error.message;
        // Try to extract API error information from Error object
        try {
          if (error.message.includes("{")) {
            const parsed = JSON.parse(
              error.message.slice(error.message.indexOf("{")),
            );
            errorData = parsed;
          }
        } catch {
          // If parsing fails, continue using default error
        }
      }

      // If fetch response is not ok, may need to get error from response
      if (error instanceof TypeError && error.message.includes("fetch")) {
        errorData.message = "Network error";
      }

      // Detect timeout/connection interrupt errors
      if (
        error instanceof Error &&
        (error.name === "TimeoutError" ||
          error.name === "AbortError" ||
          error.message.includes("aborted") ||
          error.message.includes("Load failed"))
      ) {
        errorData.code = "timeout";
        errorData.message =
          "Refresh request timed out. This can happen when processing a large number of messages.";
      }

      // Build friendly error message
      const friendlyMessage = getFriendlyErrorMessage(errorData);

      // Set error state
      setRefreshError({
        code: errorData.code || "unknown",
        message: errorMessage,
        friendlyMessage,
      });

      setRefreshStatus(null);
      setIsRefreshing(false);
      refreshPollingRef.current = false;
    }
  }, [t, name, isFirstLanding, session, getFriendlyErrorMessage]);

  /**
   * Start auto refresh timer
   */
  const startAutoRefreshTimer = useCallback(() => {
    // Destructure config options with defaults
    const {
      enabled = true,
      interval = 1800000,
      retryInterval = 60000,
    } = autoRefreshOptions;

    if (!enabled) return;

    // Clear existing timer to avoid duplication
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
    }

    // Set new timer
    refreshTimerRef.current = setTimeout(async () => {
      if (!isRefreshingRef.current) {
        // Not refreshing, execute refresh and continue timer
        await handleRefresh();
        startAutoRefreshTimer();
      } else {
        // Refreshing, delayed retry
        refreshTimerRef.current = setTimeout(
          startAutoRefreshTimer,
          retryInterval,
        );
      }
    }, interval);
  }, [autoRefreshOptions, handleRefresh]);

  /**
   * Stop auto refresh
   */
  const stopAutoRefresh = useCallback(() => {
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
  }, []);

  // 1. Execute refresh on first load (configurable)
  useEffect(() => {
    if (initialRefresh) {
      handleRefresh();
    }
  }, [initialRefresh, handleRefresh]);

  // 2. Start auto refresh and cleanup on unmount
  useEffect(() => {
    startAutoRefreshTimer();

    // Cleanup timer when component unmounts
    return () => {
      stopAutoRefresh();
    };
  }, [startAutoRefreshTimer, stopAutoRefresh]);

  return {
    isRefreshing,
    refreshStatus,
    refreshError,
    handleRefresh,
    stopAutoRefresh,
  };
}
