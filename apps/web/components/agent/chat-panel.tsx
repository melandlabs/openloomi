"use client";

import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import "../../i18n";
import type { UseChatHelpers } from "@ai-sdk/react";
import { useMemo, useState, useCallback, useEffect, useRef } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { generateUUID } from "@/lib/utils";
import type { ChatMessage } from "@openloomi/shared";
import { VirtualizedMessages } from "@/components/messages-virtualized";
import { MultimodalInput } from "@/components/multimodal-input";
import useSWR from "swr";
import { fetcher } from "@/lib/utils";
import type { Attachment } from "@openloomi/shared";
import type { SuggestedPrompt } from "@/components/suggested-actions";
import { useChatContext } from "../chat-context";
import { ArrowUpIcon, ArrowDownIcon } from "@/components/icons";
import { Button } from "@openloomi/ui";
import { FocusedInsightFloatingBar } from "../focused-insight-floating-bar";
import { WorkspaceFloatPanel } from "./workspace-float-panel";
import { useGlobalInsightDrawer } from "@/components/global-insight-drawer";
import { ErrorBoundary } from "@/components/error-boundary";

interface AgentChatPanelProps {
  chatId?: string | null; // External chatId; if null, creates a new chat
  /** Initial input value (e.g., pre-filled when navigating from skill page /skill-creator) */
  initialInput?: string;
  /** Refresh token for replacing the current draft with the latest initial input. */
  prefillToken?: string;
  /** A message to send immediately after mount (e.g., from onboarding "Chat with openloomi" card), sent only once */
  initialMessageToSend?: string;
}

/**
 * Agent page chat panel component
 * Implements full AI chat functionality with message list and input field
 * Note: the header is managed by ChatHeaderPanel component, unified in layout.tsx
 */
export function AgentChatPanel({
  chatId: externalChatId,
  initialInput,
  prefillToken,
  initialMessageToSend,
}: AgentChatPanelProps = {}) {
  const { t } = useTranslation();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [input, setInput] = useState<string>(initialInput ?? "");
  const [attachments, setAttachments] = useState<Array<Attachment>>([]);

  // Note: previousChatIdRef is not needed because the component gets the latest messages from context
  // When chatId changes, useChat in parent AgentPageClient handles the message switch automatically
  // Manages suggestion state
  const [allSuggestions, setAllSuggestions] = useState<SuggestedPrompt[]>([]);
  const [usedSuggestionIds, setUsedSuggestionIds] = useState<Set<string>>(
    new Set(),
  );
  // Scroll state management
  const [isScrolled, setIsScrolled] = useState(false);
  // Whether near the bottom (used to determine scroll-to-top or scroll-to-bottom button)
  const [isNearBottom, setIsNearBottom] = useState(true);
  // Whether to show scroll button (with auto-hide)
  const [showScrollButton, setShowScrollButton] = useState(false);
  const scrollButtonTimerRef = useRef<NodeJS.Timeout | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  // Get chat context (must be called before using status)
  const {
    messages,
    sendMessage,
    setMessages,
    stop,
    isAgentRunning,
    setIsAgentRunning,
    activeChatId: contextActiveChatId,
    switchChatId,
    isVaultOpen,
    setVaultOpen,
    focusedInsights,
    getIsAgentRunningByChatId,
  } = useChatContext();

  // Use global drawer context (same approach as global search to open drawer)
  const { openDrawer } = useGlobalInsightDrawer();

  const handleCloseVault = useCallback(
    () => setVaultOpen(false),
    [setVaultOpen],
  );

  // Apply initialInput (e.g., from skill page /?input=/skill-creator navigation) and clear URL params (runs only once)
  const initialInputAppliedRef = useRef(false);
  useEffect(() => {
    if (
      initialInput == null ||
      initialInput === "" ||
      initialInputAppliedRef.current
    )
      return;
    initialInputAppliedRef.current = true;
    setInput(initialInput);
    const next = new URLSearchParams(searchParams.toString());
    next.delete("input");
    next.delete("preset");
    const qs = next.toString();
    const url = qs ? `${pathname}?${qs}` : (pathname ?? "/");
    router.replace(url, { scroll: false });
  }, [initialInput, pathname, router, searchParams]);

  const lastAppliedPrefillTokenRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!prefillToken || !initialInput?.trim()) return;
    if (lastAppliedPrefillTokenRef.current === prefillToken) return;

    lastAppliedPrefillTokenRef.current = prefillToken;
    setInput(initialInput);

    if (typeof window !== "undefined" && chatInputKeyRef.current) {
      localStorage.setItem(chatInputKeyRef.current, initialInput);
    }
  }, [initialInput, prefillToken]);

  // Use externally provided chatId, or generate a new one if not provided
  const chatId = useMemo(() => {
    return externalChatId || contextActiveChatId || generateUUID();
  }, [contextActiveChatId, externalChatId]);

  // Get isAgentRunning for THIS chat panel's chatId (not the activeChatId)
  // This ensures the side panel shows correct status even when activeChatId changes
  const isAgentRunningForChat = getIsAgentRunningByChatId(chatId);

  // Per-chat input persistence: track previous chat for saving input on switch
  const prevChatIdForInputRef = useRef<string | null>(null);
  const chatInputKeyRef = useRef<string>("");
  const inputRef = useRef(input);

  // Keep inputRef in sync with input state
  useEffect(() => {
    inputRef.current = input;
  }, [input]);

  // Load input from localStorage for a specific chat
  const loadChatInput = useCallback(
    (targetChatId: string, initial?: string) => {
      if (typeof window === "undefined") return initial ?? "";
      const key = `openloomi:chat-input-${targetChatId}`;
      chatInputKeyRef.current = key;
      const saved = localStorage.getItem(key);
      return saved ?? initial ?? "";
    },
    [],
  );

  // Update chatInputKeyRef when chatId changes (for new chats that don't trigger switch)
  useEffect(() => {
    const key = `openloomi:chat-input-${chatId}`;
    chatInputKeyRef.current = key;
  }, [chatId]);

  // Handle chat switch: save previous chat's input, load new chat's input
  useEffect(() => {
    if (!chatId || typeof window === "undefined") return;

    const prevChatId = prevChatIdForInputRef.current;

    // If this is a chat switch (not initial load)
    if (prevChatId && prevChatId !== chatId) {
      // Save previous chat's input using ref to avoid dependency issues
      const prevKey = `openloomi:chat-input-${prevChatId}`;
      const currentInput = inputRef.current;
      if (currentInput) {
        localStorage.setItem(prevKey, currentInput);
      }

      // Load new chat's input
      const newInput = loadChatInput(chatId);
      setInput(newInput);
    } else if (!prevChatId) {
      // Initial load: try to load saved input or use initialInput
      const initialInputValue = initialInput?.trim()
        ? initialInput
        : loadChatInput(chatId, "");
      setInput(initialInputValue);
    }

    prevChatIdForInputRef.current = chatId;
  }, [chatId, initialInput, loadChatInput]);

  // Persist input to localStorage on change (debounced)
  const saveInputTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const handleSetInput = useCallback(
    (value: string | ((prev: string) => string)) => {
      setInput((prev) => {
        const newValue = typeof value === "function" ? value(prev) : value;

        // Clear any pending save timeout
        if (saveInputTimeoutRef.current) {
          clearTimeout(saveInputTimeoutRef.current);
        }

        // Handle input change
        if (typeof window !== "undefined" && chatInputKeyRef.current) {
          if (!newValue) {
            // When input is cleared (e.g., message sent), clear localStorage
            localStorage.removeItem(chatInputKeyRef.current);
          } else {
            // Debounce save to localStorage for non-empty values
            saveInputTimeoutRef.current = setTimeout(() => {
              localStorage.setItem(chatInputKeyRef.current, newValue);
            }, 500);
          }
        }

        return newValue;
      });
    },
    [],
  );

  /**
   * Handle suggestions list ready
   * Supports incremental updates: show default suggestions first, then update to full list after AI generates
   */
  const handleSuggestionsReady = useCallback(
    (suggestions: SuggestedPrompt[]) => {
      setAllSuggestions((prev) => {
        // If the new list has more suggestions, update (from default to full list)
        // Keep used suggestion IDs, do not reset
        if (suggestions.length >= prev.length) {
          return suggestions;
        }
        // If the new list has fewer, it may be a reset, use the new list
        return suggestions;
      });
    },
    [],
  );

  /**
   * Mark a suggestion as used
   */
  const handleSuggestionUsed = useCallback((suggestionId: string) => {
    setUsedSuggestionIds((prev) => {
      const next = new Set(prev);
      next.add(suggestionId);
      return next;
    });
  }, []);

  /**
   * Get remaining suggestions (unused)
   */
  const remainingSuggestions = useMemo(() => {
    return allSuggestions.filter(
      (suggestion) => !usedSuggestionIds.has(suggestion.id),
    );
  }, [allSuggestions, usedSuggestionIds]);

  /**
   * Listen to scroll events and detect scroll state
   */
  useEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) return;

    const handleScroll = () => {
      const scrollTop = scrollContainer.scrollTop;
      const scrollHeight = scrollContainer.scrollHeight;
      const clientHeight = scrollContainer.clientHeight;

      // Detect if scrolled up more than 20px
      setIsScrolled(scrollTop > 20);

      // Detect if near the bottom (distance to bottom less than 100px)
      const distanceToBottom = scrollHeight - scrollTop - clientHeight;
      setIsNearBottom(distanceToBottom < 100);

      // Show button and set auto-hide timer
      setShowScrollButton(true);
      if (scrollButtonTimerRef.current) {
        clearTimeout(scrollButtonTimerRef.current);
      }
      scrollButtonTimerRef.current = setTimeout(() => {
        setShowScrollButton(false);
      }, 3000);
    };

    scrollContainer.addEventListener("scroll", handleScroll);
    // Initial check
    handleScroll();
    // On init, show button based on scroll state (show immediately if already scrolled)
    if (scrollContainer.scrollTop > 20) {
      setShowScrollButton(true);
    }

    return () => {
      scrollContainer.removeEventListener("scroll", handleScroll);
      if (scrollButtonTimerRef.current) {
        clearTimeout(scrollButtonTimerRef.current);
      }
    };
  }, []);

  /**
   * Scroll to top
   */
  const scrollToTop = useCallback(() => {
    const scrollContainer = scrollContainerRef.current;
    if (scrollContainer) {
      scrollContainer.scrollTo({
        top: 0,
        behavior: "smooth",
      });
    }
  }, []);

  /**
   * Scroll to bottom
   */
  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    const scrollContainer = scrollContainerRef.current;
    const endElement = endRef.current;
    if (scrollContainer && endElement) {
      // Use offsetTop for more reliable positioning instead of scrollHeight
      scrollContainer.scrollTo({
        top: endElement.offsetTop,
        behavior,
      });
    }
  }, []);

  // Track previous activeChatId to detect chat switches
  const prevActiveChatIdRef = useRef<string | null>(null);
  // Track previous message count to detect when messages finish loading
  const prevMessagesCountRef = useRef(0);

  /**
   * Scroll to bottom
   * Auto-scrolls when messages change (loading complete, chat switch, new message)
   */
  useEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) return;

    // Detect if chat switched
    const didSwitchChat =
      prevActiveChatIdRef.current !== null &&
      prevActiveChatIdRef.current !== contextActiveChatId;
    prevActiveChatIdRef.current = contextActiveChatId;

    // Detect if messages just finished loading (from 0 to > 0)
    const didLoadMessages =
      prevMessagesCountRef.current === 0 && messages.length > 0;
    prevMessagesCountRef.current = messages.length;

    // On chat switch or message load complete, use auto for immediate scroll
    // On new message send, use smooth animation
    const isNewMessage = messages.length > prevMessagesCountRef.current;
    const behavior =
      didSwitchChat || didLoadMessages
        ? "auto"
        : isNewMessage
          ? "smooth"
          : "instant";

    // Use double rAF to ensure DOM and virtual list rendering complete before scrolling
    // This is more reliable than fixed timeout (50ms) which may fire before DOM updates
    const rafId = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        scrollToBottom(behavior);
      });
    });

    return () => cancelAnimationFrame(rafId);
  }, [messages, contextActiveChatId, scrollToBottom]);

  /**
   * Send message
   */
  const sendMessagePresent = useCallback<
    UseChatHelpers<ChatMessage>["sendMessage"]
  >(
    (message, requestOptions) => {
      // Check if sendMessage is available
      if (!sendMessage) {
        console.error("[sendMessage] sendMessage is not available");
        return Promise.reject(new Error("Chat is not properly initialized"));
      }

      // Check if AI is already responding to prevent duplicate submissions
      if (isAgentRunning) {
        console.warn("[sendMessage] Agent is already running");
        return Promise.reject(new Error("Agent is already running"));
      }

      return sendMessage(message, requestOptions);
    },
    [sendMessage, isAgentRunning],
  );

  /** Auto-send initialMessageToSend after mount (e.g., from onboarding "Chat with openloomi" click): switches to new chat first, then sends, runs only once; if from URL send param, clears after sending */
  const initialMessageSentRef = useRef(false);
  useEffect(() => {
    if (
      !initialMessageToSend?.trim() ||
      initialMessageSentRef.current ||
      !sendMessagePresent
    )
      return;
    initialMessageSentRef.current = true;
    const sendParam = searchParams.get("send");
    // First switch to new chat, then delay send to ensure context is updated to new session
    switchChatId(null);
    const timerId = setTimeout(() => {
      sendMessagePresent({
        role: "user",
        parts: [{ type: "text", text: initialMessageToSend.trim() }],
      })
        .then(() => {
          if (sendParam != null) {
            const next = new URLSearchParams(searchParams.toString());
            next.delete("send");
            const qs = next.toString();
            const url = qs ? `${pathname}?${qs}` : (pathname ?? "/");
            router.replace(url, { scroll: false });
          }
        })
        .catch(() => {
          initialMessageSentRef.current = false;
        });
    }, 350);
    return () => clearTimeout(timerId);
  }, [
    initialMessageToSend,
    pathname,
    router,
    searchParams,
    sendMessagePresent,
    switchChatId,
  ]);

  /**
   * Refresh insights data
   * Wrapped in useCallback to maintain reference stability and prevent infinite re-renders
   */
  const handleRefresh = useCallback(async () => {
    // Empty function for now - can be extended later if needed
  }, []);

  // Fetch vote data
  const { data: votes } = useSWR<Array<any>>(
    chatId ? `/api/vote?chatId=${chatId}` : null,
    fetcher,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      refreshWhenHidden: false,
      refreshWhenOffline: false,
      dedupingInterval: 5000,
    },
  );

  const openWorkspacePanel = useCallback(
    (targetChatId?: string) => {
      const id = targetChatId ?? chatId;
      if (id) {
        router.push(`/workspace?chatId=${encodeURIComponent(id)}`);
      } else {
        router.push("/workspace");
      }
    },
    [chatId, router],
  );

  return (
    <ErrorBoundary
      fallback={
        <div className="flex h-full flex-col items-center justify-center p-8 text-center">
          <p className="text-6xl mb-4">💬</p>
          <p className="text-lg font-medium mb-2">
            {t("common.errorBoundary.chatFailed") || "Chat component failed"}
          </p>
          <p className="text-sm text-muted-foreground mb-4">
            {t("common.errorBoundary.chatFailedHint") ||
              "Please refresh the page"}
          </p>
          <Button variant="outline" onClick={() => window.location.reload()}>
            {t("common.refresh") || "Refresh"}
          </Button>
        </div>
      }
    >
      <div
        className={cn(
          "relative flex h-full flex-col bg-card/90 backdrop-blur-md",
        )}
      >
        {/* Chat Vault floating panel: controlled by header library button, positioned at top-right of content area */}
        <div className="absolute top-2 right-3 z-[100] flex flex-col items-end">
          <WorkspaceFloatPanel
            chatId={contextActiveChatId}
            messages={messages}
            open={isVaultOpen}
            onClose={handleCloseVault}
            onOpenWorkspace={
              chatId ? () => openWorkspacePanel(chatId) : undefined
            }
            onOpenInsight={(insight) => {
              // Use global drawer context to open drawer
              openDrawer(insight);
              setVaultOpen(false);
            }}
            className="absolute top-full right-0 mt-2"
          />
        </div>

        {/* Message content area - scrollable; overflow-y: overlay keeps scrollbar from taking width */}
        <div className="relative flex flex-col flex-1 min-h-0 w-full">
          {/* FocusedInsight floats at the top of the scroll area, does not move with scrolling */}
          <FocusedInsightFloatingBar contentClassName="mx-auto w-full max-w-3xl min-w-0" />

          <div
            ref={scrollContainerRef}
            className={cn(
              "flex flex-col items-center flex-1 min-h-0 w-full overflow-y-scroll overflow-x-hidden",
              // When the floating bar is shown, increase top padding to avoid covering the first message
              "transition-[padding-top] duration-300",
              focusedInsights.length > 0 ? "pt-[56px]" : "pt-0",
            )}
          >
            <div className="px-4 pb-4 w-full min-w-0">
              <div className="mx-auto w-full max-w-3xl min-w-0">
                <VirtualizedMessages
                  chatId={chatId}
                  votes={votes}
                  messages={messages}
                  sendMessage={sendMessagePresent}
                  setMessages={setMessages}
                  onRefresh={handleRefresh}
                  onSuggestionsReady={handleSuggestionsReady}
                  onSuggestionUsed={handleSuggestionUsed}
                  isAgentRunning={isAgentRunningForChat}
                />
              </div>
            </div>
            {/* Scroll anchor - used by scrollToBottom to determine bottom position */}
            <div ref={endRef} className="shrink-0 min-w-[24px] min-h-[24px]" />
          </div>
        </div>

        {/* Input area - fixed at bottom */}
        <div
          className="sticky bottom-0 z-20 pb-4 px-4 safe-area-inset-bottom"
          style={{ paddingBottom: "16px" }}
        >
          {/* Scroll button - toggles between scroll-to-top and scroll-to-bottom */}
          {showScrollButton && (isScrolled || !isNearBottom) && (
            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-30">
              <Button
                variant="outline"
                size="icon"
                onClick={() =>
                  isNearBottom ? scrollToTop() : scrollToBottom()
                }
                className="h-9 w-9 rounded-full shadow-md bg-background/95 backdrop-blur-sm border-border/60 hover:bg-background hover:shadow-lg transition-all"
                aria-label={
                  isNearBottom
                    ? t("common.scrollToTop", "Back to top")
                    : t("common.scrollToBottom", "Scroll to bottom")
                }
              >
                {isNearBottom ? (
                  <ArrowUpIcon size={16} />
                ) : (
                  <ArrowDownIcon size={16} />
                )}
              </Button>
            </div>
          )}

          <form className="mx-auto flex w-full max-w-3xl flex-col gap-6">
            <MultimodalInput
              chatId={chatId}
              input={input}
              setInput={handleSetInput}
              stop={stop}
              attachments={attachments}
              setAttachments={setAttachments}
              setMessages={setMessages}
              sendMessage={sendMessagePresent}
              remainingSuggestions={remainingSuggestions}
              onSuggestionClick={(suggestion) => {
                handleSuggestionUsed(suggestion.id);
                // Capture potential errors
                try {
                  sendMessagePresent({
                    role: "user",
                    parts: [{ type: "text", text: suggestion.title }],
                  }).catch((error) => {
                    console.error(
                      "[onSuggestionClick] Failed to send message:",
                      error,
                    );
                  });
                } catch (error) {
                  console.error(
                    "[onSuggestionClick] Error sending message:",
                    error,
                  );
                }
              }}
            />
          </form>
        </div>
      </div>
    </ErrorBoundary>
  );
}
