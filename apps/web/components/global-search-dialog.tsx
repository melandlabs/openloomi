"use client";

import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@openloomi/ui";
import { Button, Input } from "@openloomi/ui";
import { RemixIcon } from "@/components/remix-icon";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@openloomi/hooks/use-is-mobile";
import { useChatContextOptional } from "@/components/chat-context";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@openloomi/ui";
import { getRecentInsights, type RecentInsight } from "@/lib/insights/recent";
import { fetcher } from "@/lib/utils";
import useSWR from "swr";
import { getIndexedDBManager } from "@openloomi/indexeddb/manager";
import { useSession } from "next-auth/react";

/**
 * Search types (actions/tasks, People, sources removed)
 */
export type SearchType = "events" | "chats" | "files" | "rawMessages";

/**
 * Search result item
 */
export interface SearchResultItem {
  id: string;
  type: SearchType;
  title: string;
  subtitle?: string;
  timestamp?: string;
  platform?: string;
  extra?: Record<string, unknown>;
}

/**
 * Search results response
 */
interface SearchResults {
  events: SearchResultItem[];
  chats: SearchResultItem[];
  files: SearchResultItem[];
  rawMessages: SearchResultItem[];
}

/**
 * All search types (excluding actions/tasks, People, sources)
 */
const SEARCH_TYPES: SearchType[] = ["events", "chats", "files", "rawMessages"];

/**
 * Global search dialog component
 * Supports searching by type with grouped results display, shows recently viewed events when not searching
 */
export function GlobalSearchDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const isMobile = useIsMobile();
  const { data: session } = useSession();
  const [searchQuery, setSearchQuery] = useState("");
  // Single search type selection; "all" means search all types
  const [selectedType, setSelectedType] = useState<SearchType | "all">("all");
  const [recentInsights, setRecentInsights] = useState<RecentInsight[]>([]);
  const [rawMessagesResults, setRawMessagesResults] = useState<
    SearchResultItem[]
  >([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Debounced search query
  const [debouncedQuery, setDebouncedQuery] = useState("");

  // When search query changes, update with debounce
  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, 300);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [searchQuery]);

  // Fetch search results (excluding rawMessages as it's client-side search)
  const searchUrl = useMemo(() => {
    if (!debouncedQuery.trim() || !open) return null;

    // Exclude rawMessages as it's client-side IndexedDB search
    const serverSearchTypes = SEARCH_TYPES.filter((t) => t !== "rawMessages");
    const typesArray =
      selectedType === "all" ? serverSearchTypes : [selectedType];

    // If only rawMessages is selected, no server request needed
    if (typesArray.length === 0) return null;

    return `/api/search?q=${encodeURIComponent(
      debouncedQuery,
    )}&types=${typesArray.join(",")}`;
  }, [debouncedQuery, selectedType, open]);

  const {
    data: searchResults,
    isLoading,
    error,
  } = useSWR<SearchResults>(searchUrl, fetcher, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
  });

  // Load recently viewed events
  useEffect(() => {
    if (open) {
      const recent = getRecentInsights();
      setRecentInsights(recent);
    }
  }, [open]);

  // Search raw messages (IndexedDB client-side query)
  useEffect(() => {
    const searchRawMessages = async () => {
      if (
        !debouncedQuery.trim() ||
        !open ||
        !session?.user?.id ||
        (selectedType !== "all" && selectedType !== "rawMessages")
      ) {
        setRawMessagesResults([]);
        return;
      }

      try {
        const manager = getIndexedDBManager();
        await manager.init();

        const messages = await manager.queryMessages({
          userId: session.user.id,
          keywords: [debouncedQuery],
          limit: 20,
        });

        const results: SearchResultItem[] = messages.map((msg) => ({
          id: msg.messageId,
          type: "rawMessages" as const,
          title: msg.person || msg.channel || "Unknown",
          subtitle:
            msg.content.substring(0, 100) +
            (msg.content.length > 100 ? "..." : ""),
          timestamp: new Date(msg.timestamp * 1000).toISOString(),
          platform: msg.platform,
          extra: {
            channel: msg.channel,
            person: msg.person,
          },
        }));

        setRawMessagesResults(results);
      } catch (error) {
        console.error("[Global Search] Failed to search raw messages:", error);
        setRawMessagesResults([]);
      }
    };

    searchRawMessages();
  }, [debouncedQuery, open, session?.user?.id, selectedType]);

  // Focus input when dialog opens
  useEffect(() => {
    if (open && inputRef.current) {
      setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
    } else {
      setSearchQuery("");
      setDebouncedQuery("");
    }
  }, [open]);

  /**
   * Handle result item click
   */
  const handleResultClick = useCallback(
    (item: SearchResultItem) => {
      onOpenChange(false);
      setSearchQuery("");
      setDebouncedQuery("");

      switch (item.type) {
        case "events": {
          // Use custom event to open global InsightDetailDrawer instead of routing
          const insight = (item.extra as any)?.insight;
          if (insight) {
            window.dispatchEvent(
              new CustomEvent("global:openInsightDrawer", { detail: insight }),
            );
          } else {
            // Fallback to routing (if no full insight object is available)
            router.push(`/inbox?insightDetailId=${item.id}`);
          }
          break;
        }
        case "chats": {
          // Switch to chat (client-side only)
          const chatContext = useChatContextOptional();
          if (chatContext?.switchChatId) {
            chatContext.switchChatId(item.id);
          } else {
            // Fallback: use routing navigation
            router.push(`/chat/${item.id}`);
          }
          break;
        }
        case "files":
          // Navigate to Files panel
          router.push(`/?panel=files&fileId=${item.id}`);
          break;
        case "rawMessages":
          // Raw messages don't need navigation, just close the dialog
          break;
      }
    },
    [onOpenChange, router],
  );

  /**
   * Handle recent event click
   */
  const handleRecentEventClick = useCallback(
    async (recentInsight: RecentInsight) => {
      onOpenChange(false);
      try {
        // Fetch full insight object from API
        const response = await fetch(
          `/api/insights/${recentInsight.id}?fetch=true`,
        );
        if (!response.ok) {
          console.warn(
            "[GlobalSearch] Failed to fetch insight, using fallback",
          );
          router.push(`/inbox?insightDetailId=${recentInsight.id}`);
          return;
        }
        const data = await response.json();
        const insight = data.insight;

        if (insight) {
          // Open drawer via custom event
          window.dispatchEvent(
            new CustomEvent("global:openInsightDrawer", { detail: insight }),
          );
        } else {
          router.push(`/inbox?insightDetailId=${recentInsight.id}`);
        }
      } catch (error) {
        console.warn("[GlobalSearch] Failed to fetch insight:", error);
        // Fallback to routing
        router.push(`/inbox?insightDetailId=${recentInsight.id}`);
      }
    },
    [onOpenChange, router],
  );

  /**
   * Get type display name
   */
  const getTypeDisplayName = (type: SearchType): string => {
    const typeMap: Record<SearchType, string> = {
      events: t("search.events"),
      chats: t("search.chats"),
      files: t("search.files"),
      rawMessages: t("search.rawMessages"),
    };
    return typeMap[type] || type;
  };

  /**
   * Organize search results by type
   */
  const resultsByType = useMemo(() => {
    if (!searchResults) {
      return {} as Record<SearchType, SearchResultItem[]>;
    }

    // Deduplicate all types (by id)
    const deduplicate = (items: SearchResultItem[]) =>
      Array.from(new Map(items.map((item) => [item.id, item])).values());

    const result: Record<SearchType, SearchResultItem[]> = {
      events: deduplicate(searchResults.events || []),
      chats: deduplicate(searchResults.chats || []),
      files: deduplicate(searchResults.files || []),
      rawMessages: deduplicate(rawMessagesResults),
    };

    return result;
  }, [searchResults, rawMessagesResults]);

  /**
   * Check if there are any results
   */
  const hasResults = useMemo(() => {
    return Object.values(resultsByType).some((items) => items.length > 0);
  }, [resultsByType]);

  /**
   * Check whether to show recent events (when no search query)
   */
  const showRecentEvents = !debouncedQuery.trim() && recentInsights.length > 0;

  /**
   * Current dropdown type label
   */
  const selectedTypeLabel =
    selectedType === "all"
      ? t("search.allTypes")
      : getTypeDisplayName(selectedType);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "flex flex-col border-border bg-surface-elevated shadow-md",
          isMobile
            ? "max-w-full w-full h-[100vh] m-0 rounded-none border-0"
            : "w-[95vw] sm:w-[90vw] md:w-[90vw] md:max-w-[1000px] lg:w-[95vw] lg:max-w-[1200px] max-h-[85vh]",
        )}
      >
        <DialogHeader>
          <DialogTitle className="text-foreground tracking-tight">
            {t("search.title")}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4 flex-1 min-h-0">
          {/* Type selection dropdown + search input */}
          <div className="flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  className="min-w-[100px] justify-between border-border"
                >
                  <span className="text-xs truncate">{selectedTypeLabel}</span>
                  <RemixIcon
                    name="arrow_down_s"
                    size="size-4"
                    className="text-muted-foreground"
                  />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuRadioGroup
                  value={selectedType}
                  onValueChange={(value) =>
                    setSelectedType(value as SearchType | "all")
                  }
                >
                  <DropdownMenuRadioItem value="all">
                    {t("search.allTypes")}
                  </DropdownMenuRadioItem>
                  {SEARCH_TYPES.map((type) => (
                    <DropdownMenuRadioItem key={type} value={type}>
                      {getTypeDisplayName(type)}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>

            <div className="relative flex-1">
              <RemixIcon
                name="search"
                size="size-4"
                className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
              />
              <Input
                ref={inputRef}
                type="text"
                placeholder={t("common.searchPlaceholder")}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 border-border"
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    onOpenChange(false);
                  }
                }}
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery("");
                    setDebouncedQuery("");
                  }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-1 rounded-md hover:bg-surface-hover"
                >
                  <RemixIcon name="close" size="size-4" />
                </button>
              )}
            </div>
          </div>

          {/* Results display area */}
          <div className="flex-1 overflow-y-auto min-h-0 border border-border rounded-lg bg-surface-muted">
            {showRecentEvents ? (
              // Show recently viewed events
              <div className="p-4">
                <h3 className="text-sm font-semibold tracking-tight text-foreground mb-3">
                  {t("search.recentEvents")}
                </h3>
                <div className="space-y-1">
                  {recentInsights.map((insight) => (
                    <button
                      key={insight.id}
                      type="button"
                      onClick={() => handleRecentEventClick(insight)}
                      className="w-full px-4 py-3 text-left hover:bg-surface-hover transition-colors rounded-md"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm truncate">
                          {insight.title}
                        </div>
                        {insight.description && (
                          <div className="text-xs text-muted-foreground mt-1 line-clamp-2 whitespace-pre-line">
                            {insight.description}
                          </div>
                        )}
                        <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
                          {insight.platform && <span>{insight.platform}</span>}
                          {insight.time && (
                            <span>
                              • {new Date(insight.time).toLocaleString()}
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ) : isLoading ? (
              <div className="flex items-center justify-center py-12">
                <RemixIcon
                  name="loader_2"
                  size="size-6"
                  className="text-muted-foreground animate-spin"
                />
                <span className="ml-2 text-sm text-muted-foreground">
                  {t("search.loading")}
                </span>
              </div>
            ) : error ? (
              <div className="flex items-center justify-center py-12 text-sm text-destructive">
                {t("search.error")}
              </div>
            ) : !hasResults ? (
              <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
                {debouncedQuery.trim()
                  ? t("search.noResults")
                  : t("search.emptyQuery")}
              </div>
            ) : (
              // Display results grouped by type
              <div className="divide-y divide-border">
                {(selectedType === "all" ? SEARCH_TYPES : [selectedType]).map(
                  (type) => {
                    const items = resultsByType[type] || [];
                    if (items.length === 0) return null;

                    return (
                      <div key={type} className="p-4">
                        <h3 className="text-sm font-semibold tracking-tight text-foreground mb-3 flex items-center gap-2">
                          <span>{getTypeDisplayName(type)}</span>
                          <span className="text-xs text-muted-foreground font-normal">
                            ({items.length})
                          </span>
                        </h3>
                        <div className="space-y-1">
                          {items.map((item) => (
                            <button
                              key={`${item.type}-${item.id}`}
                              type="button"
                              onClick={() => handleResultClick(item)}
                              className="w-full px-4 py-3 text-left hover:bg-surface-hover transition-colors rounded-md"
                            >
                              <div className="flex-1 min-w-0">
                                <div className="font-medium text-sm truncate">
                                  {item.title}
                                </div>
                                {item.subtitle && (
                                  <div className="text-xs text-muted-foreground mt-1 line-clamp-2">
                                    {item.subtitle}
                                  </div>
                                )}
                                <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
                                  {item.platform && (
                                    <span>{item.platform}</span>
                                  )}
                                  {item.timestamp && (
                                    <span>
                                      •{" "}
                                      {new Date(
                                        item.timestamp,
                                      ).toLocaleString()}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  },
                )}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
