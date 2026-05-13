"use client";

import { useState, useRef, useMemo, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useRouter } from "next/navigation";
import { Badge, Button } from "@openloomi/ui";
import { Tooltip, TooltipContent, TooltipTrigger } from "@openloomi/ui";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@openloomi/ui";
import { HorizontalScrollContainer, hasDragged } from "@openloomi/ui";
import { useChatContextOptional } from "@/components/chat-context";
import { useIsMobile } from "@openloomi/hooks/use-is-mobile";
import { useSidePanel } from "@/components/agent/side-panel-context";
import { AgentChatPanel } from "@/components/agent/chat-panel";
import { RemixIcon } from "@/components/remix-icon";
import { format } from "date-fns";
import { enUS, zhCN } from "date-fns/locale";
import useSWR from "swr";
import { fetcher, generateUUID } from "@/lib/utils";
import { cn } from "@/lib/utils";
import type { ChatHistoryResponse } from "@/lib/ai/chat/api";
import type { Insight } from "@/lib/db/schema";
import type { InsightReplyContext } from "./types";

interface ChatSidePanelProps {
  activeChatId: string | null;
  /** Ref used in handleExpandFullChat to avoid closure trap */
  activeChatIdRef: React.RefObject<string | null>;
  insight: Insight;
  onClose: () => void;
}

/**
 * Chat Side Panel component - header matches the normal chat page
 * Defined at module top level to maintain stable component identity, avoiding Hooks rules violations
 */
const ChatSidePanel = ({
  activeChatId,
  activeChatIdRef,
  insight,
  onClose,
}: ChatSidePanelProps) => {
  const { t } = useTranslation();
  const router = useRouter();
  const { closeSidePanel } = useSidePanel();
  const isMobile = useIsMobile();
  const chatContext = useChatContextOptional();

  // Directly read prop activeChatId (footer's real-time state)
  const handleExpandFullChat = () => {
    const chatId = activeChatIdRef.current;
    if (chatId) {
      router.push(`/?page=chat&chatId=${encodeURIComponent(chatId)}`);
    } else {
      router.push("/?page=chat");
    }
    // Note: don't call onClose(), to avoid triggering setIsInsightDrawerOpen(false) causing state change
    // closeSidePanel() only closes side panel, doesn't affect drawer state
    closeSidePanel();
  };

  // Mobile view: close side panel, do not display content
  useEffect(() => {
    if (isMobile) {
      closeSidePanel();
    }
  }, [isMobile, closeSidePanel]);

  if (isMobile) {
    return null;
  }

  return (
    <div className="h-full flex flex-col bg-card">
      {/* Header: only keep the close button */}
      <div
        className="flex items-center justify-end gap-1 px-2 py-2 border-none border-transparent bg-white/70 shrink-0"
        style={{ borderImage: "none" }}
      >
        <Button
          size="icon"
          variant="ghost"
          onClick={handleExpandFullChat}
          className="h-8 w-8 shrink-0"
          aria-label={t("insight.openFullChat", "Expand full conversation")}
        >
          <RemixIcon name="external_link" size="size-3" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          onClick={closeSidePanel}
          className="h-8 w-8 shrink-0"
          aria-label={t("common.close", "Close")}
        >
          <RemixIcon name="close" size="size-3" />
        </Button>
      </div>
      {/* Chat Panel Content */}
      <div className="flex-1 min-h-0 flex flex-col">
        <AgentChatPanel chatId={activeChatId ?? undefined} />
      </div>
    </div>
  );
};

interface InsightDetailFooterProps {
  insight: Insight;
  /** When true, automatically opens the chat side panel */
  autoOpenChat?: boolean;
  replyContext?: InsightReplyContext | null;
  initialReplyExpanded?: boolean;
  onReplyExpandedChange?: (expanded: boolean) => void;
  initialRecipient?: string;
  initialAccountId?: string;
  onGenerateStateChange?: (state: {
    isLoading: boolean;
    hasOptions: boolean;
  }) => void;
  /** Additional class for the outer container; used for custom background/border in full-screen scenarios */
  className?: string;
  /** Optional: registers a callback to "pre-fill the chat input"; called by parent components (e.g., Greeting recommended topics) */
  onRegisterPrependToChatInput?: (fn: (text: string) => void) => void;
}

/**
 * Insight detail page Footer component
 * Combines quick action area and chat input
 */
export function InsightDetailFooter({
  insight,
  autoOpenChat = false,
  className,
}: InsightDetailFooterProps) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const isMobile = useIsMobile();
  // Side panel context
  const { openSidePanel, closeSidePanel, sidePanel, setSidePanelContent } =
    useSidePanel() ?? {
      openSidePanel: () => {},
      closeSidePanel: () => {},
      sidePanel: null,
      setSidePanelContent: () => {},
    };
  const {
    toggleFocusedInsight,
    focusedInsights,
    // currentChatId means the normal agent chat panel chat id
    // instead of the insight related chat ids.
    activeChatId: currentChatId,
    switchChatId,
    setFocusedInsightForChat,
  } = useChatContextOptional() ?? {
    isChatPanelOpen: false,
    selectedInsight: null,
    setSelectedInsight: () => {},
    isInsightDrawerOpen: false,
    toggleInsightDrawer: () => {},
    openFilePreviewPanel: () => {},
    messages: [],
    sendMessage: async () => ({ role: "user", id: "" }),
    setMessages: () => {},
    status: "ready",
    stop: () => {},
    regenerate: async () => ({ role: "user", id: "" }),
    isAgentRunning: false,
    focusedInsights: [],
    setFocusedInsight: () => {},
    setFocusedInsightForChat: () => {},
    clearFocusedInsights: () => {},
    toggleFocusedInsight: () => {},
    switchChatId: () => {},
  };

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);

  // Used to set focused insight when switching conversations
  const pendingInsightRef = useRef<Insight | null>(null);

  // Used to avoid closure trap: handleExpandFullChat always reads the latest activeChatId
  const activeChatIdRef = useRef<string | null>(null);

  // Fetch historical chat data (always request, used for badge, input placeholder, and history dropdown menu)
  const { data: chatHistory } = useSWR<ChatHistoryResponse>(
    `/api/insights/${insight.id}/history`,
    fetcher,
  );

  // Get all chats (sorted)
  const sortedChats = useMemo(() => {
    if (!chatHistory?.chats) return [];
    return [...chatHistory.chats].sort((a, b) => {
      const dateA = a.latestMessageTime
        ? new Date(a.latestMessageTime)
        : new Date(a.createdAt);
      const dateB = b.latestMessageTime
        ? new Date(b.latestMessageTime)
        : new Date(b.createdAt);
      return dateB.getTime() - dateA.getTime();
    });
  }, [chatHistory]);

  /**
   * Get recent chat history, returns up to 5 items
   */
  const recentChats = useMemo(() => {
    return sortedChats.slice(0, 5);
  }, [sortedChats]);

  /**
   * Handle creating a new chat
   */
  const handleNewChat = () => {
    // Generate UUID for the new chat
    const newChatId = generateUUID();
    // Switch to the new chat
    setActiveChatId(newChatId);
    activeChatIdRef.current = newChatId; // Synchronously update ref
    // Update panel content, ensure ChatSidePanel gets new chat ID
    if (sidePanel) {
      setSidePanelContent(
        <ChatSidePanel
          activeChatId={newChatId}
          activeChatIdRef={activeChatIdRef}
          insight={insight}
          onClose={closeSidePanel}
        />,
      );
    }
    switchChatId(newChatId);
    // Immediately set focused insight for the new chat
    if (setFocusedInsightForChat) {
      setFocusedInsightForChat(newChatId, insight);
    }
  };

  // Initialize activeChatId: if there is chat history, auto-select the latest; otherwise create a new chat
  const [isInitialized, setIsInitialized] = useState(false);
  useEffect(() => {
    if (isInitialized || !chatHistory) return;

    if (chatHistory.chats && chatHistory.chats.length > 0) {
      // Has chat history, select the latest one
      const sortedChats = [...chatHistory.chats].sort((a, b) => {
        const dateA = a.latestMessageTime
          ? new Date(a.latestMessageTime)
          : new Date(a.createdAt);
        const dateB = b.latestMessageTime
          ? new Date(b.latestMessageTime)
          : new Date(b.createdAt);
        return dateB.getTime() - dateA.getTime();
      });
      const latestChatId = sortedChats[0]?.id;
      if (latestChatId) {
        setActiveChatId(latestChatId);
        activeChatIdRef.current = latestChatId; // Synchronously update ref, avoid ref being null on click due to useEffect async
        switchChatId(latestChatId);
        pendingInsightRef.current = insight;
        // Defer setFocusedInsightForChat until after panel is ready (matching badge-click behavior)
        if (setFocusedInsightForChat) {
          setFocusedInsightForChat(latestChatId, insight);
        }
      }
    } else {
      // Generate UUID for the new chat
      const newChatId = generateUUID();
      // Switch to the new chat
      setActiveChatId(newChatId);
      activeChatIdRef.current = newChatId; // Synchronously update ref
      switchChatId(newChatId);
      // Immediately set focused insight for the new chat
      if (setFocusedInsightForChat) {
        setFocusedInsightForChat(newChatId, insight);
      }
    }
    setIsInitialized(true);
  }, [chatHistory, isInitialized, switchChatId, autoOpenChat, insight]);

  const openChatPanel = useCallback(
    (autoFocusedInsight = true, force = false) => {
      if (autoFocusedInsight) {
        // First set the current insight as focused for the current chat
        const chatId = activeChatId || currentChatId;
        if (chatId && setFocusedInsightForChat) {
          setFocusedInsightForChat(chatId, insight);
        } else {
          // First set the current insight as focused
          const isCurrentlyFocused = focusedInsights.some(
            (i) => i.id === insight.id,
          );
          if (!isCurrentlyFocused) {
            toggleFocusedInsight(insight);
          }
        }
      }
      // Mobile: navigate to chat page
      if (isMobile || force) {
        const chatIdToUse = activeChatId || currentChatId;
        router.push(
          chatIdToUse
            ? `/?page=chat&chatId=${encodeURIComponent(chatIdToUse)}`
            : "/?page=chat",
        );
        return;
      }

      // Desktop: if side panel is not open, open the right side panel
      if (!sidePanel) {
        openSidePanel({
          id: `insight-chat-${insight.id}`,
          content: (
            <ChatSidePanel
              activeChatId={activeChatId}
              activeChatIdRef={activeChatIdRef}
              insight={insight}
              onClose={closeSidePanel}
            />
          ),
          width: 400,
        });
      }
    },
    [
      activeChatId,
      currentChatId,
      setFocusedInsightForChat,
      focusedInsights,
      toggleFocusedInsight,
      insight,
      isMobile,
      router,
      sidePanel,
      openSidePanel,
    ],
  );

  // Auto-open chat side panel (using ref to prevent duplicate triggers)
  const autoOpenChatRef = useRef(false);
  useEffect(() => {
    if (autoOpenChat && !isMobile && !autoOpenChatRef.current) {
      autoOpenChatRef.current = true;
      openChatPanel(false);
    }
    if (!autoOpenChat) {
      autoOpenChatRef.current = false;
    }
  }, [autoOpenChat]);

  // After initialization, check if there is a pending insight (set when switching conversations)
  useEffect(() => {
    if (!isInitialized) return;
    if (!activeChatId) return;

    if (setFocusedInsightForChat && pendingInsightRef.current) {
      setFocusedInsightForChat(activeChatId, pendingInsightRef.current);
      pendingInsightRef.current = null;
    }
  }, [isInitialized, activeChatId, setFocusedInsightForChat]);

  return (
    <div
      className={cn(
        "bg-card shrink-0 border-t border-border flex flex-col gap-3 p-4 h-fit relative",
        className,
      )}
      role="region"
      aria-label={t("chat.fileDropArea", "File drop area")}
    >
      <div className="flex items-center gap-2">
        {/* Chat history badges horizontal scroll area */}
        <HorizontalScrollContainer
          scrollRef={scrollContainerRef}
          autoScrollToEnd
          autoScrollDeps={[recentChats.length, activeChatId]}
          className="gap-2"
        >
          {recentChats.map((chat) => {
            const isActive = activeChatId === chat.id;
            return (
              <Badge
                key={chat.id}
                variant={isActive ? "default" : "outline"}
                className={cn(
                  "cursor-pointer transition-colors rounded-[10px] max-w-[160px] min-w-0 truncate shrink-0 px-3 py-1.5",
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-secondary",
                )}
                onClick={(e) => {
                  // If a drag occurred, do not trigger the click event
                  if (hasDragged(scrollContainerRef)) {
                    e.preventDefault();
                    e.stopPropagation();
                    return;
                  }
                  // Set the active chat and navigate to it immediately
                  setActiveChatId(chat.id);
                  activeChatIdRef.current = chat.id;
                  // Update panel content, ensure ChatSidePanel gets the latest activeChatId
                  if (sidePanel) {
                    setSidePanelContent(
                      <ChatSidePanel
                        activeChatId={chat.id}
                        activeChatIdRef={activeChatIdRef}
                        insight={insight}
                        onClose={closeSidePanel}
                      />,
                    );
                  }
                  if (chat.id !== currentChatId) {
                    // First set pending, then set in useEffect after currentChatId changes
                    pendingInsightRef.current = insight;
                    switchChatId(chat.id);
                  }
                }}
                title={chat.title || t("insight.chatHistory", "Chat history")}
              >
                {chat.title || t("insight.chatHistory", "Chat history")}
              </Badge>
            );
          })}
        </HorizontalScrollContainer>

        {/* Action button group - right-aligned */}
        <div className="flex items-center gap-1 shrink-0 ml-auto">
          {/* New chat button */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={handleNewChat}
                className="size-8"
                aria-label={t("insight.newChat", "New chat")}
              >
                <RemixIcon name="add" size="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>{t("insight.newChat", "New chat")}</p>
            </TooltipContent>
          </Tooltip>

          {/* History button (opens DropdownMenu to view all) */}
          <DropdownMenu>
            <Tooltip>
              <DropdownMenuTrigger asChild>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    aria-label={t("insight.chatHistory", "Chat history")}
                  >
                    <RemixIcon name="history" size="size-4" />
                  </Button>
                </TooltipTrigger>
              </DropdownMenuTrigger>
              <TooltipContent>
                <p>{t("insight.chatHistory", "Chat history")}</p>
              </TooltipContent>
            </Tooltip>
            <DropdownMenuContent
              align="end"
              className="w-[320px] sm:w-[400px] max-h-[50vh] overflow-y-auto"
            >
              {sortedChats.length > 0 ? (
                sortedChats.map((chat) => {
                  const isActive = activeChatId === chat.id;
                  return (
                    <DropdownMenuItem
                      key={chat.id}
                      onClick={() => {
                        setActiveChatId(chat.id);
                        activeChatIdRef.current = chat.id;
                        if (sidePanel) {
                          setSidePanelContent(
                            <ChatSidePanel
                              activeChatId={chat.id}
                              activeChatIdRef={activeChatIdRef}
                              insight={insight}
                              onClose={closeSidePanel}
                            />,
                          );
                        }
                        if (chat.id !== currentChatId) {
                          // First set pending, then set in useEffect after currentChatId changes
                          pendingInsightRef.current = insight;
                          switchChatId(chat.id);
                        }
                      }}
                      className="flex items-start gap-2 p-3 cursor-pointer"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <span className="text-sm font-medium text-[#37352f] truncate">
                            {chat.title}
                          </span>
                          {isActive && (
                            <RemixIcon
                              name="check"
                              size="size-4"
                              className="shrink-0 text-primary"
                            />
                          )}
                        </div>
                        {chat.latestMessageContent && (
                          <p className="text-xs text-[#9b9a97] line-clamp-1">
                            {chat.latestMessageContent}
                          </p>
                        )}
                        <div className="flex items-center gap-2 mt-1 text-xs text-[#9b9a97]">
                          <span>
                            {format(
                              new Date(
                                chat.latestMessageTime || chat.createdAt,
                              ),
                              isMobile ? "MM/dd" : "MM/dd HH:mm",
                              {
                                locale: i18n.language.includes("zh")
                                  ? zhCN
                                  : enUS,
                              },
                            )}
                          </span>
                          <span>·</span>
                          <span>{chat.messageCount}</span>
                        </div>
                      </div>
                    </DropdownMenuItem>
                  );
                })
              ) : (
                <div className="p-4 text-center text-sm text-muted-foreground">
                  {t("insight.noChatHistory", "No relevant chat history")}
                </div>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Switch chat button - opens side panel on desktop, navigates to chat page on mobile */}
          {(activeChatId || currentChatId) && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="secondary"
                  size="icon"
                  onClick={() => {
                    openChatPanel();
                  }}
                  className="size-8"
                  aria-label={t("chat.addEvent", "Add event")}
                >
                  @
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>
                  {t("chat.addEventHint", "Add an event, or type @ to search")}
                </p>
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>
    </div>
  );
}
