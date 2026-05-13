"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSession } from "next-auth/react";
import type { UseChatHelpers } from "@ai-sdk/react";
import type { ChatMessage } from "@openloomi/shared";

interface RawMessagesResultProps {
  toolCallId: string;
  input?: any;
  sendMessage?: UseChatHelpers<ChatMessage>["sendMessage"];
}

// Component to display raw messages query results
// This handles tool-call input state to execute query on client side
export function RawMessagesResult({
  toolCallId,
  input,
  sendMessage,
}: RawMessagesResultProps) {
  const { t } = useTranslation();
  const { data: session } = useSession();
  const [queryResult, setQueryResult] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const hasExecutedRef = useRef(false);
  const timeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);
  const resultSentRef = useRef(false);

  useEffect(() => {
    const executeQuery = async () => {
      if (hasExecutedRef.current) return;

      // Set timeout to prevent infinite loading
      timeoutRef.current = setTimeout(() => {
        setQueryResult({
          success: false,
          error: "Query timeout - check browser console for errors",
        });
        setLoading(false);
      }, 10000);

      hasExecutedRef.current = true;

      // Get query parameters from tool-call input
      let params = input || {};

      // Always add userId to ensure user data isolation
      if (session?.user?.id) {
        params = {
          ...params,
          userId: session.user.id,
        };
      }

      // Convert days to startTime if provided
      if (params.days && !params.startTime) {
        const secondsPerDay = 24 * 60 * 60;
        const startTime =
          Math.floor(Date.now() / 1000) - params.days * secondsPerDay;
        params = {
          ...params,
          startTime,
        };
      }

      try {
        // Import here to avoid server-side import issues
        const {
          queryRawMessages,
          queryRawMessagesGrouped,
          formatRawMessagesForAI,
        } = await import("@openloomi/indexeddb/client");

        let messages: any[];
        let resultText: string;

        // Use grouped query if groupBy is specified
        if (params.groupBy && params.groupBy !== "none") {
          const grouped = await queryRawMessagesGrouped(params);
          const groupKeys = Object.keys(grouped).sort((a, b) => {
            // Sort with most recent first
            if (a === "Today") return -1;
            if (b === "Today") return 1;
            if (a === "Yesterday") return -1;
            if (b === "Yesterday") return 1;
            return b.localeCompare(a);
          });

          const totalMessages = Object.values(grouped).flat().length;
          resultText = `Found ${totalMessages} messages grouped by ${params.groupBy}:\n\n`;

          for (const key of groupKeys) {
            const groupMessages = grouped[key];
            resultText += `## ${key} (${groupMessages.length} messages)\n`;
            resultText += formatRawMessagesForAI(groupMessages);
            resultText += "\n\n";
          }

          messages = Object.values(grouped).flat();
        } else {
          messages = await queryRawMessages(params);
          resultText = formatRawMessagesForAI(messages);
        }

        // Clear timeout on success
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
        }

        console.log(
          "[RawMessagesResult] Query completed successfully, messages:",
          messages.length,
        );

        if (messages.length === 0) {
          setQueryResult({ success: false, error: "No messages found" });
        } else {
          setQueryResult({
            success: true,
            messageCount: messages.length,
            result: resultText,
            grouped: params.groupBy && params.groupBy !== "none",
          });

          // Send results to conversation context so AI can reference them
          if (sendMessage && !resultSentRef.current) {
            resultSentRef.current = true;
            // Send as a user message with results so AI can reference them
            const title = t("common.queryResultsTitle", {
              count: messages.length,
            });
            const fullText = `${title}\n\n${resultText}`;

            // Split message into parts if it exceeds 2000 characters (API limit)
            const MAX_CHARS = 2000;
            const parts: Array<{ type: "text"; text: string }> = [];

            if (fullText.length <= MAX_CHARS) {
              // Message fits in one part
              parts.push({
                type: "text",
                text: fullText,
              });
            } else {
              // Split message into multiple parts
              let remainingText = fullText;
              let partIndex = 0;

              while (remainingText.length > 0) {
                const chunk = remainingText.slice(0, MAX_CHARS);
                remainingText = remainingText.slice(MAX_CHARS);

                if (partIndex === 0) {
                  parts.push({
                    type: "text",
                    text: chunk,
                  });
                } else {
                  parts.push({
                    type: "text",
                    text: chunk,
                  });
                }
                partIndex++;
              }

              console.log(
                `[RawMessagesResult] Split message into ${parts.length} parts (total: ${fullText.length} chars)`,
              );
            }

            sendMessage({
              role: "user",
              parts,
            });
          }
        }
      } catch (error) {
        setQueryResult({
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        setLoading(false);
      }
    };

    // Only execute if we have input params
    if (input && !hasExecutedRef.current) {
      executeQuery();
    } else {
      if (!input) {
        setLoading(false);
      }
    }

    // Cleanup timeout on unmount
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [toolCallId, input, session?.user?.id, sendMessage]);

  console.log("[RawMessagesResult] Rendering state:", { loading, queryResult });

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-0.5">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-amber-500 animate-spin"
        >
          <path d="M21 12a9 9 0 1 1-6.219-8.56" />
        </svg>
        <span className="text-sm text-gray-600 dark:text-gray-400">
          {t("common.searchingMessages")}
        </span>
      </div>
    );
  }

  if (!queryResult?.success) {
    return (
      <div className="flex items-center gap-2 py-0.5">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-red-500"
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="12" x2="12" y1="8" y2="12" />
          <line x1="12" x2="12.01" y1="16" y2="16" />
        </svg>
        <span className="text-sm text-gray-600 dark:text-gray-400">
          {t("common.noMessagesFound")}
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 py-0.5">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-emerald-500"
      >
        <polyline points="20 6 9 17 4 12" />
      </svg>
      <span className="text-sm text-gray-700 dark:text-gray-300">
        {t("common.foundMessages", { count: queryResult.messageCount })}
      </span>
    </div>
  );
}
