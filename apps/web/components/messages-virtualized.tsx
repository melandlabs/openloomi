import { PreviewMessage, ThinkingMessage } from "./message";
import { Greeting } from "./greeting";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { Vote } from "@/lib/db/schema";
import type { UseChatHelpers } from "@ai-sdk/react";
import { useMessages } from "@/hooks/use-messages";
import type { ChatMessage } from "@openloomi/shared";
import type { IntegrationId } from "@/hooks/use-integrations";
import type { SuggestedPrompt } from "./suggested-actions";
import { useVirtualizer } from "@tanstack/react-virtual";

interface MessagesProps {
  chatId: string;
  votes: Array<Vote> | undefined;
  messages: ChatMessage[];
  sendMessage: UseChatHelpers<ChatMessage>["sendMessage"];
  setMessages: UseChatHelpers<ChatMessage>["setMessages"];
  onRefresh: () => Promise<void>;
  onClearFocus?: () => void;
  onReplyRegenerateStart?: (
    targetMessageId: string,
    requestMessageId: string,
  ) => void;
  selectedAccountId?: string | null;
  onAccountChange?: (accountId: string) => void;
  accountSelectorPlatforms?: IntegrationId[];
  onSuggestionsReady?: (suggestions: SuggestedPrompt[]) => void;
  onSuggestionUsed?: (suggestionId: string) => void;
  isAgentRunning?: boolean;
}

// Estimates message height (for virtual list) - uses dynamic estimation for improved accuracy
const estimateMessageHeight = () => {
  // Simple estimation: short messages ~80px, long messages ~200-300px
  // Use average 120px as initial estimation, virtual list will auto-adjust
  return 120;
};
const OVERSCAN = 12; // Increase overscan to reduce flickering during scrolling

function PureVirtualizedMessages({
  chatId,
  votes,
  messages,
  sendMessage,
  setMessages,
  onRefresh,
  onClearFocus,
  onReplyRegenerateStart,
  selectedAccountId,
  onAccountChange,
  accountSelectorPlatforms,
  onSuggestionsReady,
  onSuggestionUsed,
  isAgentRunning = false,
}: MessagesProps) {
  const {
    containerRef: messagesContainerRef,
    endRef: messagesEndRef,
    hasSentMessage,
  } = useMessages({
    chatId,
    isAgentRunning,
  });

  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const highlightTimeoutRef = useRef<number | null>(null);

  // Memoize empty set to avoid creating new Set on every render
  const emptyVisibleLoadingIds = useMemo(() => new Set<string>(), []);

  useEffect(() => {
    return () => {
      if (highlightTimeoutRef.current) {
        window.clearTimeout(highlightTimeoutRef.current);
      }
    };
  }, []);

  const lastMessage =
    messages.length > 0 ? messages[messages.length - 1] : undefined;

  // Check if the last assistant message has text content (non-empty)
  const hasTextContent =
    lastMessage?.role === "assistant" &&
    Array.isArray(lastMessage.parts) &&
    lastMessage.parts.some(
      (part) =>
        (part as any).type === "text" &&
        (part as any).text &&
        (part as any).text.trim().length > 0,
    );

  // Check if the last message has only executing tool-native parts
  const hasOnlyExecutingToolNativeParts =
    lastMessage?.role === "assistant" &&
    Array.isArray(lastMessage.parts) &&
    lastMessage.parts.length > 0 &&
    lastMessage.parts.every(
      (part) =>
        (part as any).type === "tool-native" &&
        (part as any).status === "executing",
    );

  const shouldShowThinkingMessage =
    // Native agent: show thinking only if no text content yet
    (isAgentRunning && !hasTextContent) || hasOnlyExecutingToolNativeParts;

  // Filter messages to display
  const visibleMessages = messages;

  // Virtual list config
  const virtualizer = useVirtualizer({
    count: visibleMessages.length,
    getScrollElement: () => messagesContainerRef.current,
    estimateSize: estimateMessageHeight,
    overscan: OVERSCAN,
  });

  return (
    <div
      ref={messagesContainerRef}
      className="flex flex-col min-w-0 overflow-x-hidden pt-2 sm:pt-4 relative"
    >
      {messages.length === 0 && (
        <Greeting
          chatId={chatId}
          sendMessage={sendMessage}
          onSuggestionsReady={onSuggestionsReady}
          onSuggestionUsed={onSuggestionUsed}
          isAgentRunning={isAgentRunning}
        />
      )}

      {/* Virtual list container */}
      <div
        style={{
          minHeight: `${virtualizer.getTotalSize()}px`,
          width: "100%",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {virtualizer.getVirtualItems().map((virtualItem) => {
          const message = visibleMessages[virtualItem.index];
          const originalIndex = virtualItem.index;

          return (
            <div
              key={virtualItem.key}
              data-index={virtualItem.index}
              ref={virtualizer.measureElement}
              className="mb-8"
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${virtualItem.start}px)`,
              }}
            >
              <PreviewMessage
                key={`${message.id}-${virtualItem.index}`}
                chatId={chatId}
                message={message}
                isLoading={isAgentRunning}
                vote={
                  votes
                    ? votes.find((vote) => vote.messageId === message.id)
                    : undefined
                }
                sendMessage={sendMessage}
                setMessages={setMessages}
                onRefresh={onRefresh}
                requiresScrollPadding={
                  hasSentMessage && originalIndex === messages.length - 1
                }
                isHighlighted={highlightedId === message.id}
                isAgentRunning={isAgentRunning}
                inVisibleLoadingIds={emptyVisibleLoadingIds}
              />
            </div>
          );
        })}
      </div>

      {/* Thinking Message - displayed directly below message list */}
      {shouldShowThinkingMessage && <ThinkingMessage />}

      {/* Placeholder for maintaining scroll position */}
      <div
        ref={messagesEndRef}
        className="shrink-0 min-w-[24px] min-h-[24px]"
      />
    </div>
  );
}

export const VirtualizedMessages = memo(PureVirtualizedMessages);
