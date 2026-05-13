"use client";

/**
 * Chat history right panel (embedded inside Chat page)
 * Contains: search, new chat, pinned group, chat list, and left status indicator
 */

import { useTranslation } from "react-i18next";
import "../../i18n";
import { Button, Input } from "@openloomi/ui";
import { ScrollArea } from "@openloomi/ui";
import { RemixIcon } from "@/components/remix-icon";
import { useMemo, useState, useCallback, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import type { ChatWithExtendedInfo } from "@/lib/ai/chat/api";
import {
  useChatContext,
  useChatContextOptional,
  type ChatContextValue,
} from "@/components/chat-context";

export interface ChatHistorySidePanelProps {
  /** Sorted chat list (newest first) */
  sortedChats: ChatWithExtendedInfo[];
  /** Currently selected chat ID */
  currentChatId: string | null;
  /** Select chat */
  onSelectChat: (chatId: string) => void;
  /** New chat */
  onNewChat: () => void;
  /** Delete chat (optional, if provided, list items show delete button on hover) */
  onDeleteChat?: (chatId: string) => void;
  /** Pinned chat ID list (optional, can be empty when no backend) */
  pinnedChatIds?: string[];
  /** Close panel (optional, can be omitted when embedded) */
  onClose?: () => void;
  /** Whether there is more data */
  hasMore?: boolean;
  /** Load more callback */
  onLoadMore?: () => void;
  /** Whether loading */
  isLoading?: boolean;
}

type ChatStatus = "running" | "completed" | "idle";

/**
 * Individual chat item - used in sidebar list
 * Left: status consistent with header Badge (running=loader, completed=check)
 * hover/selected: background primary-50; on hover right side time becomes delete button
 */
function ChatItemRow({
  chat,
  isActive,
  isPinned,
  status,
  onSelect,
  onClose,
  onDelete,
}: {
  chat: ChatWithExtendedInfo;
  isActive: boolean;
  isPinned?: boolean;
  status: ChatStatus;
  onSelect: (chatId: string) => void;
  onClose?: () => void;
  onDelete?: (chatId: string) => void;
}) {
  const { t } = useTranslation();

  const isRunning = status === "running";
  const isCompleted = status === "completed";

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => {
        onSelect(chat.id);
        onClose?.();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(chat.id);
          onClose?.();
        }
      }}
      className={cn(
        "group w-full max-w-full min-w-0 flex items-center gap-2 rounded-md px-3 py-2.5 text-left transition-colors cursor-pointer",
        "hover:bg-primary-50 active:bg-primary-50/80",
        isActive && "bg-primary-50 text-primary font-medium",
      )}
    >
      {/* Status indicator: consistent with header Badge - running=loader, completed=check; idle keeps placeholder for consistent width */}
      <div className="w-3.5 shrink-0">
        {isRunning && (
          <RemixIcon
            name="loader_icon"
            size="size-3.5"
            className="animate-spin text-primary"
          />
        )}
        {isCompleted && !isActive && (
          <RemixIcon name="check" size="size-3.5" className="text-green-500" />
        )}
      </div>

      <div className="flex-1 w-0 min-w-0">
        <div className="flex items-center justify-between w-full gap-2">
          <p className="truncate text-sm font-medium text-foreground min-w-0">
            {chat.title || "Chat Name"}
          </p>
          {/* Right side: delete button shown on hover */}
          <span className="relative flex shrink-0 items-center justify-end w-7">
            {onDelete && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                aria-label={t("common.delete", "Delete")}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onDelete(chat.id);
                }}
              >
                <RemixIcon name="delete_bin" size="size-3.5" />
              </Button>
            )}
          </span>
        </div>
      </div>

      {isPinned && (
        <RemixIcon
          name="pushpin"
          size="size-3.5"
          className="shrink-0 text-muted-foreground"
        />
      )}
    </div>
  );
}

/**
 * Chat history right panel content
 */
export function ChatHistorySidePanel({
  sortedChats,
  currentChatId,
  onSelectChat,
  onNewChat,
  onDeleteChat,
  pinnedChatIds = [],
  onClose,
  hasMore,
  onLoadMore,
  isLoading,
}: ChatHistorySidePanelProps) {
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState("");

  // Access ChatContext for getting each chat's running status
  const chatContextOptional = useChatContextOptional();
  let chatContext: ChatContextValue | null = null;
  let getChatSessionStates:
    | (() => Map<string, { isAgentRunning: boolean }>)
    | null = null;
  try {
    chatContext = useChatContext();
    getChatSessionStates = chatContext.getChatSessionStates;
  } catch {
    chatContext = chatContextOptional;
  }

  const getStatusForChat = useCallback(
    (chat: ChatWithExtendedInfo): ChatStatus => {
      if (!getChatSessionStates) {
        // Without status info, distinguish completed/idle by whether there are messages
        return chat.messageCount > 0 ? "completed" : "idle";
      }
      const states = getChatSessionStates();
      const isRunning = states.get(chat.id)?.isAgentRunning ?? false;
      if (isRunning) return "running";
      if (chat.messageCount > 0) return "completed";
      return "idle";
    },
    [getChatSessionStates],
  );

  /** Filter chats by search keyword */
  const filteredChats = useMemo(() => {
    if (!searchQuery.trim()) return sortedChats;
    const q = searchQuery.trim().toLowerCase();
    return sortedChats.filter(
      (c) =>
        (c.title || "").toLowerCase().includes(q) ||
        (c.latestMessageContent || "").toLowerCase().includes(q),
    );
  }, [sortedChats, searchQuery]);

  /** Pinned area: only show chats that are in pinnedChatIds and still in list */
  const pinnedChats = useMemo(() => {
    const set = new Set(pinnedChatIds);
    return filteredChats.filter((c) => set.has(c.id));
  }, [filteredChats, pinnedChatIds]);

  /** Unpinned chats */
  const unpinnedChats = useMemo(() => {
    const set = new Set(pinnedChatIds);
    return filteredChats.filter((c) => !set.has(c.id));
  }, [filteredChats, pinnedChatIds]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-card">
      {/* Top: search + new chat */}
      <div className="shrink-0 flex flex-col gap-3 border-b border-border/60 px-4 py-3">
        <div className="relative">
          <RemixIcon
            name="search"
            size="size-4"
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            placeholder={t("common.search", "Search")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-9 pl-9 pr-3 text-sm"
            aria-label={t("common.search", "Search")}
          />
        </div>
        <Button
          onClick={() => {
            onNewChat();
            onClose?.();
          }}
          className="w-full justify-center bg-primary text-primary-foreground hover:bg-primary/90"
          size="sm"
        >
          <RemixIcon name="add" size="size-4" className="mr-1.5" />
          {t("common.newChat")}
        </Button>
      </div>

      {/* Chat list: Pinned + Chats */}
      <ScrollArea className="flex-1 min-h-0 overflow-x-hidden min-w-0">
        <div className="flex flex-col gap-1 px-2 py-2 min-w-0 overflow-hidden">
          {pinnedChats.length > 0 && (
            <div className="mb-2">
              <p className="px-2 py-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                {t("common.pinned", "Pinned")}
              </p>
              <div className="flex flex-col gap-0.5 min-w-0 overflow-hidden">
                {pinnedChats.map((chat) => (
                  <ChatItemRow
                    key={chat.id}
                    chat={chat}
                    isActive={currentChatId === chat.id}
                    isPinned
                    status={getStatusForChat(chat)}
                    onSelect={onSelectChat}
                    onClose={onClose}
                    onDelete={onDeleteChat}
                  />
                ))}
              </div>
            </div>
          )}

          <p className="px-2 py-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider">
            {t("common.chats", "Chats")}
          </p>
          {unpinnedChats.length === 0 && pinnedChats.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center text-sm text-muted-foreground">
              <RemixIcon
                name="message"
                size="size-8"
                className="mb-2 opacity-50"
              />
              <p>
                {searchQuery.trim()
                  ? t("common.noSearchResults", "No results")
                  : t(
                      "common.startChatting",
                      "Start a conversation to see it here.",
                    )}
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-0.5 min-w-0 overflow-hidden">
              {unpinnedChats.map((chat) => (
                <ChatItemRow
                  key={chat.id}
                  chat={chat}
                  isActive={currentChatId === chat.id}
                  status={getStatusForChat(chat)}
                  onSelect={onSelectChat}
                  onClose={onClose}
                  onDelete={onDeleteChat}
                />
              ))}
            </div>
          )}

          {/* Infinite scroll load more */}
          {hasMore && onLoadMore && (
            <LoadMoreTrigger
              isLoading={isLoading}
              onLoadMore={onLoadMore}
              t={t}
            />
          )}
        </div>
      </ScrollArea>

      {/* Optional: bottom close button (for collapsible scenarios) */}
      {onClose && (
        <div className="shrink-0 flex items-center justify-end border-t border-border/60 px-4 py-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="h-8"
            aria-label={t("common.close", "Close")}
          >
            <RemixIcon name="close" size="size-3.5" className="mr-1" />
            {t("common.close", "Close")}
          </Button>
        </div>
      )}
    </div>
  );
}

import type { TFunction } from "i18next";

/** Infinite scroll load more trigger */
function LoadMoreTrigger({
  isLoading,
  onLoadMore,
  t,
}: {
  isLoading?: boolean;
  onLoadMore: () => void;
  t: TFunction;
}) {
  const triggerRef = useRef<HTMLDivElement>(null);
  const isLoadingRef = useRef(isLoading);

  useEffect(() => {
    isLoadingRef.current = isLoading;
  }, [isLoading]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !isLoadingRef.current) {
          onLoadMore();
        }
      },
      { threshold: 0.1 },
    );

    if (triggerRef.current) {
      observer.observe(triggerRef.current);
    }

    return () => observer.disconnect();
  }, [onLoadMore]);

  return (
    <div ref={triggerRef} className="flex justify-center py-2">
      {isLoading && (
        <div className="flex items-center text-xs text-muted-foreground">
          <RemixIcon
            name="loader"
            size="size-3.5"
            className="mr-1.5 animate-spin"
          />
          {t("common.loading", "Loading...")}
        </div>
      )}
    </div>
  );
}
