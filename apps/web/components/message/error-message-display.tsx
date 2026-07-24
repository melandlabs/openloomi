"use client";

import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { RemixIcon } from "@/components/remix-icon";
import { Button } from "@/components/ui/button";
import type { ChatMessage } from "@openloomi/shared";
import type { UseChatHelpers } from "@ai-sdk/react";

interface ErrorMessageDisplayProps {
  errorContent: string;
  /**
   * Optional continuation payload extracted from a `data-interruption` part
   * that follows this error part. When present, we render an explicit
   * Continue action that reuses the preserved workspace instead of the
   * misleading "system will automatically retry" wording. See issue #356.
   */
  interruption?: {
    reason: "timeout";
    timeoutMs?: number;
    workspacePath?: string;
    completedArtifacts: string[];
    canResume: boolean;
  };
  /** Chat helper exposed by the surrounding message tree so Continue can
   *  inject the continuation prompt into the existing conversation. */
  sendMessage?: UseChatHelpers<ChatMessage>["sendMessage"];
}

export function ErrorMessageDisplay({
  errorContent,
  interruption,
  sendMessage,
}: ErrorMessageDisplayProps) {
  const { t } = useTranslation();

  // Provider-timeout interruption path — render an actionable card that
  // explicitly invites the user to continue the task. We deliberately do not
  // route this through the generic timeout branch below because that branch
  // promises "the system will automatically retry", which is not true: the
  // provider was killed mid-tool-call and there is no auto-retry scheduled.
  if (interruption?.canResume) {
    const artifactCount = interruption.completedArtifacts.length;
    return (
      <div
        className={cn(
          "my-3 rounded-lg border p-4",
          "border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/20 text-amber-900 dark:text-amber-200",
        )}
      >
        <div className="flex items-start gap-3">
          <RemixIcon name="timer" size="size-5" className="shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0 space-y-2">
            <h4 className="font-semibold text-sm">
              {t("auth.errors.agentTimeoutError.title")}
            </h4>
            <p className="text-xs opacity-90">{errorContent}</p>
            {artifactCount > 0 ? (
              <p className="text-xs opacity-80">
                {t("auth.errors.agentTimeoutError.completedArtifacts", {
                  count: artifactCount,
                })}
              </p>
            ) : null}
            {sendMessage ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="mt-1"
                onClick={() => {
                  const artifactList =
                    interruption.completedArtifacts.length > 0
                      ? `\n\nFiles preserved from the previous run:\n${interruption.completedArtifacts
                          .map((path) => `- ${path}`)
                          .join("\n")}`
                      : "";
                  const workspaceHint = interruption.workspacePath
                    ? `\n\nWorkspace: ${interruption.workspacePath}`
                    : "";
                  sendMessage({
                    role: "user",
                    parts: [
                      {
                        type: "text",
                        text: `Continue the previous task from where it was interrupted. Reuse any files already created — do not restart from scratch.${workspaceHint}${artifactList}`,
                      },
                    ],
                  });
                }}
              >
                {t("auth.errors.agentTimeoutError.continueAction")}
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  // Parse error content and provide friendly messages
  const getErrorDetails = (error: string) => {
    const lowerError = error.toLowerCase();

    // Codex CLI/model compatibility errors are already actionable at the
    // provider boundary. Preserve that original diagnostic instead of
    // replacing it with the generic "try again later" copy (issue #437).
    if (
      lowerError.includes("codex") &&
      (lowerError.includes("requires a newer") ||
        lowerError.includes("not available in codex cli") ||
        lowerError.includes("not supported") ||
        lowerError.includes("unsupported model") ||
        lowerError.includes("upgrade codex") ||
        lowerError.includes("codex cli executable not found") ||
        lowerError.includes("codex cli version check"))
    ) {
      const suggestions = t(
        "common.errors.codexCompatibilityError.suggestions",
        {
          returnObjects: true,
        },
      );
      return {
        title: t("common.errors.codexCompatibilityError.title"),
        description: sanitizeErrorForDisplay(error),
        suggestions: Array.isArray(suggestions) ? suggestions : [],
        icon: "alert_triangle",
        severity: "warning" as const,
        showCodexDocs: true,
      };
    }

    // IMPROVED: Handle special error markers from Claude Extension
    // Process crash errors (OOM, killed) - retryable
    if (
      error.includes("__PROCESS_CRASH__") ||
      lowerError.includes("process crash") ||
      lowerError.includes("killed") ||
      lowerError.includes("oom")
    ) {
      const suggestions = t("auth.errors.processCrashError.suggestions", {
        returnObjects: true,
      });
      return {
        title: t("auth.errors.processCrashError.title"),
        description: t("auth.errors.processCrashError.description"),
        suggestions: Array.isArray(suggestions) ? suggestions : [],
        icon: "alert_triangle",
        severity: "warning" as const,
      };
    }

    // Timeout errors (with special marker)
    if (
      error.includes("__TIMEOUT_ERROR__") ||
      lowerError.includes("timeout") ||
      lowerError.includes("timed out")
    ) {
      const suggestions = t("auth.errors.agentTimeoutError.suggestions", {
        returnObjects: true,
      });
      return {
        title: t("auth.errors.agentTimeoutError.title"),
        description: t("auth.errors.agentTimeoutError.description"),
        suggestions: Array.isArray(suggestions) ? suggestions : [],
        icon: "alert_triangle",
        severity: "warning" as const,
      };
    }

    // Stream errors (SSE connection issues)
    if (lowerError.includes("stream error") || lowerError.includes("stream")) {
      const suggestions = t("auth.errors.streamError.suggestions", {
        returnObjects: true,
      });
      return {
        title: t("auth.errors.streamError.title"),
        description: t("auth.errors.streamError.description"),
        suggestions: Array.isArray(suggestions) ? suggestions : [],
        icon: "alert_triangle",
        severity: "warning" as const,
      };
    }

    // Check for insufficient credits / quota errors (402) - MUST check before generic API error
    // This handles errors from API calls that return 402 status with insufficient_quota
    // Priority: highest - must check before "api error" to avoid false match

    // Try to extract error from JSON format first
    let extractedError = lowerError;
    try {
      // Try to find and parse JSON in the error message
      const jsonMatch = error.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        // Navigate through nested error structure: error.error.message or error.message
        const errorObj = parsed.error || parsed;
        const message = errorObj.message || parsed.message || "";
        if (message) {
          extractedError = message.toLowerCase();
        }
      }
    } catch {
      // Use original error if JSON parsing fails
    }

    if (
      extractedError.includes("insufficient_quota") ||
      extractedError.includes("insufficient quota") ||
      extractedError.includes("insufficient credits") ||
      extractedError.includes("insufficient_credits") ||
      lowerError.includes("insufficient_quota") ||
      lowerError.includes("insufficient quota") ||
      lowerError.includes("insufficient credits") ||
      lowerError.includes("insufficient_credits") ||
      (lowerError.includes("402") && lowerError.includes("api error"))
    ) {
      // Credits insufficient - show friendly message
      const suggestions = t(
        "auth.errors.insufficientCreditsError.suggestions",
        {
          returnObjects: true,
        },
      );
      return {
        title: t("auth.errors.insufficientCreditsError.title"),
        description: t("auth.errors.insufficientCreditsError.description"),
        suggestions: Array.isArray(suggestions) ? suggestions : [],
        icon: "alert_triangle",
        severity: "warning" as const,
      };
    }

    // API errors (backend issues) - check after insufficient credits
    if (
      lowerError.includes("api error") ||
      lowerError.includes("api call failed")
    ) {
      const suggestions = t("common.errors.apiError.suggestions", {
        returnObjects: true,
      });
      return {
        title: t("common.errors.apiError.title"),
        description: t("common.errors.apiError.description"),
        suggestions: Array.isArray(suggestions) ? suggestions : [],
        icon: "alert_triangle",
        severity: "error" as const,
      };
    }

    // Request too large error (file size exceeds limit)
    if (
      lowerError.includes("request too large") ||
      lowerError.includes("max 20mb") ||
      lowerError.includes("file too large")
    ) {
      const suggestions = t("auth.errors.requestTooLargeError.suggestions", {
        returnObjects: true,
      });
      return {
        title: t("auth.errors.requestTooLargeError.title"),
        description: t("auth.errors.requestTooLargeError.description"),
        suggestions: Array.isArray(suggestions) ? suggestions : [],
        icon: "file_cloud",
        severity: "warning" as const,
      };
    }

    // Custom API errors - check for insufficient credits (402)
    if (error.includes("__CUSTOM_API_ERROR__")) {
      // Check for insufficient_quota in the entire error message (not just JSON extract)
      // Use lowerError directly since it already contains lowercase version of error
      const errorLower = lowerError;

      if (
        errorLower.includes("insufficient_quota") ||
        errorLower.includes("insufficient quota") ||
        errorLower.includes("insufficient credits") ||
        errorLower.includes("insufficient_credits") ||
        errorLower.includes("402")
      ) {
        // Credits insufficient - show friendly message
        const suggestions = t(
          "auth.errors.insufficientCreditsError.suggestions",
          {
            returnObjects: true,
          },
        );
        return {
          title: t("auth.errors.insufficientCreditsError.title"),
          description: t("auth.errors.insufficientCreditsError.description"),
          suggestions: Array.isArray(suggestions) ? suggestions : [],
          icon: "alert_triangle",
          severity: "warning" as const,
        };
      }

      // Generic custom API error without specific credit issue - don't show raw error to user
      const suggestions = t("auth.errors.customApiError.suggestions", {
        returnObjects: true,
      });
      return {
        title: t("auth.errors.customApiError.title"),
        description: t("auth.errors.customApiError.description"),
        suggestions: Array.isArray(suggestions) ? suggestions : [],
        icon: "alert_triangle",
        severity: "error" as const,
      };
    }

    // Network errors
    if (
      lowerError.includes("network") ||
      lowerError.includes("fetch") ||
      lowerError.includes("connection")
    ) {
      const suggestions = t("common.errors.networkError.suggestions", {
        returnObjects: true,
      });
      return {
        title: t("common.errors.networkError.title"),
        description: t("common.errors.networkError.description"),
        suggestions: Array.isArray(suggestions) ? suggestions : [],
        icon: "alert_triangle",
        severity: "warning" as const,
      };
    }

    // Permission errors
    if (
      lowerError.includes("permission") ||
      lowerError.includes("not allowed") ||
      lowerError.includes("unauthorized")
    ) {
      const suggestions = t("common.errors.permissionError.suggestions", {
        returnObjects: true,
      });
      return {
        title: t("common.errors.permissionError.title"),
        description: t("common.errors.permissionError.description"),
        suggestions: Array.isArray(suggestions) ? suggestions : [],
        icon: "alert_triangle",
        severity: "error" as const,
      };
    }

    // File not found errors
    if (
      lowerError.includes("not found") ||
      lowerError.includes("no such file")
    ) {
      const suggestions = t("common.errors.fileNotFoundError.suggestions", {
        returnObjects: true,
      });
      return {
        title: t("common.errors.fileNotFoundError.title"),
        description: t("common.errors.fileNotFoundError.description"),
        suggestions: Array.isArray(suggestions) ? suggestions : [],
        icon: "info",
        severity: "info" as const,
      };
    }

    // Service unavailable
    if (
      lowerError.includes("service unavailable") ||
      lowerError.includes("503")
    ) {
      return {
        title: "Service temporarily unavailable",
        description: "The server may be under maintenance or overloaded.",
        suggestions: ["Retry later", "Check service status"],
        icon: "alert_triangle",
        severity: "warning" as const,
      };
    }

    // Rate limit errors (429) - extract friendly message from JSON response
    if (
      lowerError.includes("429") ||
      lowerError.includes("rate limit") ||
      lowerError.includes("Rate limit") ||
      lowerError.includes("rate exceeded")
    ) {
      // Try to extract the error message from JSON format
      let friendlyMessage = t("common.errors.rateLimitError.description");
      const jsonMatch = error.match(/\{[^}]*"message"[^}]*\}/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]);
          friendlyMessage =
            parsed.message || parsed.error?.message || friendlyMessage;
          // Remove request_id if present
          friendlyMessage = friendlyMessage
            .replace(/，request_id[：:][^，]+/, "")
            .trim();
        } catch {
          // Use original message if parsing fails
        }
      }
      // Also remove request_id from raw error text
      friendlyMessage = friendlyMessage
        .replace(/"request_id"[^,\}]+/g, "")
        .trim();
      friendlyMessage = friendlyMessage.replace(/\s+/g, " ");

      const suggestions = t("common.errors.rateLimitError.suggestions", {
        returnObjects: true,
      });
      return {
        title: t("common.errors.rateLimitError.title"),
        description: friendlyMessage,
        suggestions: Array.isArray(suggestions) ? suggestions : [],
        icon: "timer",
        severity: "warning" as const,
      };
    }

    // Default error - clean up any sensitive paths
    const defaultSuggestions = t("common.errors.genericError.suggestions", {
      returnObjects: true,
    });
    // Remove log file paths and other sensitive info from error message
    const cleanError = sanitizeErrorForDisplay(error);
    return {
      title: t("common.errors.genericError.title"),
      description: cleanError || t("common.errors.genericError.description"),
      suggestions: Array.isArray(defaultSuggestions) ? defaultSuggestions : [],
      icon: "alert_triangle",
      severity: "error" as const,
    };
  };

  const errorDetails = getErrorDetails(errorContent);

  const severityColors = {
    error:
      "border-red-200 bg-red-50 dark:border-red-900/50 dark:bg-red-950/20 text-red-900 dark:text-red-200",
    warning:
      "border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/20 text-amber-900 dark:text-amber-200",
    info: "border-blue-200 bg-blue-50 dark:border-blue-900/50 dark:bg-blue-950/20 text-blue-900 dark:text-blue-200",
  };

  return (
    <div
      className={cn(
        "my-3 rounded-lg border p-4",
        severityColors[errorDetails.severity],
      )}
    >
      <div className="flex items-start gap-3">
        <RemixIcon
          name={errorDetails.icon}
          size="size-5"
          className="shrink-0 mt-0.5"
        />

        <div className="flex-1 min-w-0 space-y-2">
          <h4 className="font-semibold text-sm">{errorDetails.title}</h4>

          <p className="text-xs opacity-90 whitespace-pre-wrap break-words">
            {errorDetails.description}
          </p>

          {/* Suggestions */}
          {errorDetails.suggestions.length > 0 && (
            <div className="space-y-1">
              <ul className="text-xs opacity-80 space-y-0.5">
                {errorDetails.suggestions.map((suggestion) => (
                  <li key={suggestion} className="flex items-start gap-2">
                    <span className="shrink-0">•</span>
                    <span>{suggestion}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {"showCodexDocs" in errorDetails &&
          errorDetails.showCodexDocs === true ? (
            <Button asChild size="sm" variant="outline">
              <a
                href="https://github.com/openai/codex#installation"
                target="_blank"
                rel="noreferrer"
              >
                {t("common.errors.codexCompatibilityError.docsAction")}
              </a>
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function sanitizeErrorForDisplay(error: string): string {
  return error
    .replace(/\/Users\/[^/]+\/\.openloomi\/logs\/[^\s]+/g, "")
    .replace(/\/home\/[^/]+\/\.openloomi\/logs\/[^\s]+/g, "")
    .replace(/http:\/\/[^/]+\/[^/]+\/Users\/[^/]+\/[^\s]+/g, "")
    .replace(/__CUSTOM_API_ERROR__\|[^|]+/g, "")
    .trim()
    .replace(/\s+/g, " ");
}
