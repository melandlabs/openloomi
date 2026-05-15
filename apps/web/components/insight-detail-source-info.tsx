"use client";

import React, {
  useMemo,
  useState,
  useCallback,
  useRef,
  useEffect,
} from "react";
import { useTranslation } from "react-i18next";
import { useSession } from "next-auth/react";
import { RemixIcon } from "@/components/remix-icon";
import { format, isSameDay } from "date-fns";
import { enGB, zhCN } from "date-fns/locale";
import type { Insight } from "@/lib/db/schema";
import type { DetailData } from "@/lib/ai/subagents/insights";
import InsightDetailContent from "@/components/insight-detail-content";
import { Badge, Button, Input } from "@openloomi/ui";
import { Tooltip, TooltipContent, TooltipTrigger } from "@openloomi/ui";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from "@openloomi/ui";
import { coerceDate } from "@openloomi/shared";
import { ReplyWorkspace } from "@/components/insight-detail-footer";

/**
 * Raw messages store second-level timestamps, DetailData.time expects millisecond-level timestamps
 * Returns timestamp number after conversion using coerceDate
 */
function convertRawMessageTimestamp(secondsTimestamp: number): number {
  return coerceDate(secondsTimestamp).getTime();
}

import { useIntegrations, type IntegrationId } from "@/hooks/use-integrations";
import { useSendInsightReply } from "@/components/insight-detail-footer/hooks";
import { cn, normalizeTimestamp } from "@/lib/utils";
import { queryRawMessages } from "@openloomi/indexeddb/client";
import type { RawMessage } from "@openloomi/indexeddb";
import { toast } from "sonner";
import { useInsightOptimisticUpdates } from "@/components/insight-optimistic-context";

const QUICK_EMOJI_LIST = ["👍", "👌", "🙏"];
const PAGE_SIZE = 50;

interface InsightDetailSourceInfoProps {
  insight: Insight;
  targetSourceDetailIds?: string[];
  generateState?: {
    isLoading: boolean;
    hasOptions: boolean;
  };
  onGenerateStateChange?: (state: {
    isLoading: boolean;
    hasOptions: boolean;
  }) => void;
  /** Callback when the number of displayed messages changes */
  onDisplayMessageCountChange?: (count: number) => void;
  /**
   * Prepend @name to the quick reply footer input field (without opening the reply detail panel)
   * When passed, clicking "Reply" on message bubbles will call this callback instead of opening the reply view
   */
  onPrependToReplyInput?: (name: string) => void;
}

/**
 * Insight detail page source info component
 * Displays all original messages of the insight in IM conversation bubble form, supports inline viewing of original messages and quick emoji replies
 */
export function InsightDetailSourceInfo({
  insight,
  targetSourceDetailIds,
  generateState,
  onGenerateStateChange,
  onDisplayMessageCountChange,
  onPrependToReplyInput,
}: InsightDetailSourceInfoProps) {
  // IMPORTANT: All hooks must be called BEFORE any early returns
  // to avoid "rendered fewer hooks than expected" error
  const { t, i18n } = useTranslation();
  const { data: session } = useSession();
  const { accounts, groupedByIntegration } = useIntegrations();
  const {
    sendReply,
    isSending: isSendingEmoji,
    retryMessage,
  } = useSendInsightReply(insight);

  // Get globally cached details (data added by optimistic updates)
  const { getInsightReply } = useInsightOptimisticUpdates();
  const cachedReplyData = useMemo(
    () => getInsightReply(insight.id),
    [insight.id, getInsightReply],
  );

  // Merged details (insight's own + globally cached)
  // Deduplicate using normalized time (second-level) + originalContent/content, prioritize insight.details data
  const mergedDetails = useMemo(() => {
    const cached = cachedReplyData?.details || [];
    const original = insight.details || [];
    // Deduplicate using normalized time (second-level) + originalContent/content
    const map = new Map<string, DetailData>();
    // First put cached (raw message), then put original to override
    for (const d of cached) {
      const normalizedTime = Math.floor(normalizeTimestamp(d.time) / 1000);
      const content = d.originalContent ?? d.content ?? "";
      const key = `${normalizedTime}-${content}`;
      map.set(key, d);
    }
    for (const d of original) {
      const normalizedTime = Math.floor(normalizeTimestamp(d.time) / 1000);
      const content = d.originalContent ?? d.content ?? "";
      const key = `${normalizedTime}-${content}`;
      map.set(key, d);
    }
    return Array.from(map.values());
  }, [insight.details, cachedReplyData]);

  /** Select the correct date-fns locale based on i18n language */
  const dateLocale = useMemo(() => {
    const lang = i18n.language;
    if (lang?.startsWith("zh") || lang === "zh-Hans" || lang === "zh-CN") {
      return zhCN;
    }
    return enGB;
  }, [i18n.language]);

  /** Whether this is an RSS source (RSS keeps forward order, non-RSS sorts by time descending + scrolls to bottom on entry) */
  const isRssSource = useMemo(() => {
    if (insight.taskLabel === "rss_feed") return true;
    return (mergedDetails ?? []).some(
      (d) => d.platform?.toLowerCase() === "rss",
    );
  }, [insight.taskLabel, mergedDetails]);

  /** Whether this is an email or RSS source (these channels default to showing only insight-referenced messages) */
  const isEmailOrRssSource = useMemo(() => {
    if (insight.taskLabel === "rss_feed") return true;
    return (mergedDetails ?? []).some((d) => {
      const platform = d.platform?.toLowerCase();
      return (
        platform === "rss" ||
        platform === "email" ||
        platform === "gmail" ||
        platform === "outlook" ||
        platform?.includes("mail")
      );
    });
  }, [insight.taskLabel, mergedDetails]);

  /** Whether to show all messages from the channel (true) or only insight-referenced messages (false) */
  const [showAllChannelMessages, setShowAllChannelMessages] =
    useState(!isEmailOrRssSource);

  /** All messages from the channel (fetched from API) */
  const [allChannelMessages, setAllChannelMessages] = useState<DetailData[]>(
    [],
  );

  /** Whether channel messages are loading */
  const [isLoadingChannelMessages, setIsLoadingChannelMessages] =
    useState(false);

  /** Whether loading more (pagination) */
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  /** Whether there are more messages to load */
  const [hasMoreMessages, setHasMoreMessages] = useState(true);

  /** Save scroll position or message index before loading more */
  const scrollPositionBeforeLoadMore = useRef<number | string | null>(null);

  /** Set of all loaded message timestamps (used to avoid duplicate loading) */
  const [loadedTimestamps, setLoadedTimestamps] = useState<Set<number>>(
    new Set(),
  );

  /** Set of message IDs referenced by the current insight (for displaying quote badge) */
  const quotedMessageKeys = useMemo(() => {
    return new Set(
      (mergedDetails ?? []).map(
        (d) => `${d.time}-${d.person ?? ""}-${d.channel ?? ""}`,
      ),
    );
  }, [mergedDetails]);

  /**
   * Get channel messages (supports pagination through raw message storage)
   * First load gets latest messages (reverse order), load more gets older messages (forward order)
   * @param loadMore Whether it's load more mode (append data instead of replace)
   */
  const fetchChannelMessages = useCallback(
    async (loadMore = false): Promise<void> => {
      const loadingStateSetter = loadMore
        ? setIsLoadingMore
        : setIsLoadingChannelMessages;
      if (isLoadingChannelMessages || isLoadingMore) return;
      loadingStateSetter(true);
      try {
        // Get channel name - use insight.platform or insight.taskLabel as fallback when groups is empty
        const channelName =
          (insight.groups?.[0] as string | undefined) ||
          insight.platform ||
          insight.taskLabel?.replace("_feed", "") ||
          null;

        // Get platform (from details, to avoid query failure due to botId changes)
        const platform =
          mergedDetails?.[0]?.platform ||
          insight.platform ||
          insight.taskLabel?.replace("_feed", "") ||
          null;

        if (!channelName || !platform) {
          setAllChannelMessages([]);
          setHasMoreMessages(false);
          setLoadedTimestamps(new Set());
          return;
        }

        // Initial load: use reverse: true to get latest messages
        // Load more: continue using reverse: true, get more messages, then deduplicate to keep only new ones
        const fetchLimit = loadMore
          ? allChannelMessages.length + PAGE_SIZE
          : PAGE_SIZE;

        const rawMessageItems = await queryRawMessages({
          userId: session?.user?.id,
          platform,
          channel: channelName,
          reverse: true, // Always fetch in reverse order, newest first
          limit: fetchLimit,
        });
        const rawMessages = rawMessageItems.filter(
          (item): item is RawMessage & { sourceType: "raw" } =>
            item.sourceType === "raw",
        );

        // Determine if there are more messages (if returned count equals loaded count, no more messages)
        const hasMore = rawMessages.length >= fetchLimit;
        setHasMoreMessages(hasMore);

        // Convert to DetailData format
        // Note: raw message timestamps are second-level and need conversion.
        const messages: DetailData[] = rawMessages.map((msg) => ({
          time: convertRawMessageTimestamp(msg.timestamp),
          person: msg.person,
          platform: msg.platform,
          channel: msg.channel,
          content: msg.content,
          originalContent: undefined,
          attachments: msg.attachments?.map((att) => ({
            name: att.name,
            url: att.url,
            contentType: att.contentType || "application/octet-stream",
            downloadUrl: att.url,
            sizeBytes: att.sizeBytes,
          })),
        }));

        // Sort by time ascending (old -> new), maintain IM chat record order
        messages.sort((a, b) => {
          const aTime = normalizeTimestamp(a.time);
          const bTime = normalizeTimestamp(b.time);
          return aTime - bTime;
        });

        if (loadMore) {
          // Load more: filter out previously loaded messages from fetched messages
          const newMessages = messages.filter(
            (msg) => !loadedTimestamps.has(msg.time ?? 0),
          );
          if (newMessages.length === 0) {
            // No new messages, meaning already loaded completely
            setHasMoreMessages(false);
          } else {
            // Insert new messages before existing messages
            setAllChannelMessages((prev) => [...newMessages, ...prev]);
            // Update loaded timestamp set and earliest timestamp
            setLoadedTimestamps((prev) => {
              const newSet = new Set(prev);
              newMessages.forEach((msg) => {
                if (msg.time) newSet.add(msg.time);
              });
              return newSet;
            });
          }
        } else {
          // Initial load: replace all messages
          setAllChannelMessages(messages);
          // Record loaded timestamp set and earliest timestamp
          const timestampSet = new Set<number>();
          messages.forEach((msg) => {
            if (msg.time) timestampSet.add(msg.time);
          });
          setLoadedTimestamps(timestampSet);
        }
      } catch (error) {
        console.error("Failed to fetch channel messages:", error);
      } finally {
        loadingStateSetter(false);
      }
    },
    [
      mergedDetails,
      insight.groups,
      insight.taskLabel,
      session?.user?.id,
      isLoadingChannelMessages,
      isLoadingMore,
      allChannelMessages.length,
      loadedTimestamps,
      PAGE_SIZE,
    ],
  );

  /**
   * Load more messages (load historical messages upward)
   */
  const handleLoadMore = useCallback(() => {
    if (isLoadingMore || !hasMoreMessages) return;

    // Save current scroll position and first visible element
    const container = listContainerRef.current;
    if (!container) return;

    const scrollTop = container.scrollTop;
    // Get first visible message element
    const firstVisibleElement = Array.from(
      container.querySelectorAll("[data-message-index]"),
    ).find((el) => {
      const rect = el.getBoundingClientRect();
      return rect.top >= container.getBoundingClientRect().top;
    }) as HTMLElement | undefined;

    if (firstVisibleElement) {
      // Save first visible element's data-message-index
      scrollPositionBeforeLoadMore.current =
        firstVisibleElement.getAttribute("data-message-index") ?? null;
    } else {
      // If no visible element, save scrollHeight and scrollTop difference
      scrollPositionBeforeLoadMore.current = container.scrollHeight - scrollTop;
    }

    fetchChannelMessages(true);
  }, [isLoadingMore, hasMoreMessages, fetchChannelMessages]);

  const selfIdentifiers = useMemo(() => {
    const ids = new Set<string>();
    ids.add("Me");
    for (const account of accounts) {
      if (account.displayName?.trim()) ids.add(account.displayName.trim());
      if (account.bot?.name?.trim()) ids.add(account.bot.name.trim());
    }
    return Array.from(ids);
  }, [accounts]);

  const isDetailFromOwnAccount = useCallback(
    (detail: DetailData): boolean => {
      const sender = detail.person?.trim();
      if (!sender) return false;
      return selfIdentifiers.some(
        (id) => id.toLowerCase() === sender.toLowerCase(),
      );
    },
    [selfIdentifiers],
  );

  const [detailShowOriginal, setDetailShowOriginal] = useState<
    Record<string, boolean>
  >({});
  const [filterType, setFilterType] = useState<"all" | "group" | "person">(
    "all",
  );
  const [filterValue, setFilterValue] = useState<string | null>(null);
  const [messageSearch, setMessageSearch] = useState<string>("");
  const [replyingToDetail, setReplyingToDetail] = useState<
    DetailData | undefined | null
  >(null);
  const [initialRecipient, setInitialRecipient] = useState<string | undefined>(
    undefined,
  );
  const [initialAccountId, setInitialAccountId] = useState<string | undefined>(
    undefined,
  );

  /** Source info list scroll container ref, used for non-RSS entry tab scroll to bottom (IM-style experience) */
  const listContainerRef = useRef<HTMLDivElement>(null);
  /** Bottom anchor ref, used for auto scroll to bottom */
  const bottomAnchorRef = useRef<HTMLDivElement>(null);
  /** Top anchor ref, used to maintain scroll position after loading more */
  const topAnchorRef = useRef<HTMLDivElement>(null);
  const lastScrolledTargetRef = useRef<string>("");

  const detailIdBySignature = useMemo(() => {
    const map = new Map<string, string>();
    (insight.details ?? []).forEach((detail, index) => {
      const normalizedTime = Math.floor(normalizeTimestamp(detail.time) / 1000);
      const content = detail.originalContent ?? detail.content ?? "";
      const signature = [
        normalizedTime,
        detail.person ?? "",
        detail.channel ?? "",
        content,
      ].join("::");
      if (!map.has(signature)) {
        map.set(
          signature,
          String((detail as DetailData & { id?: string }).id ?? index),
        );
      }
    });
    return map;
  }, [insight.details]);

  /**
   * Handle reply button click: pre-fill recipient/account and open reply view
   */
  const handleReplyClick = useCallback(
    (detail?: DetailData) => {
      if (detail) {
        if (detail.channel) setInitialRecipient(detail.channel);
        else if (detail.person) setInitialRecipient(detail.person);
        if (detail.platform) {
          const detailPlatform = detail.platform.toLowerCase().trim();
          const normalized = detailPlatform.replace(
            /\s+/g,
            "",
          ) as IntegrationId;
          const platformAccounts = groupedByIntegration[normalized];
          if (platformAccounts?.length > 0) {
            const botAccount = accounts.find(
              (a) => a.bot?.id === insight.botId,
            );
            const matchingBotAccount = platformAccounts.find(
              (a) => a.bot?.id === insight.botId,
            );
            const selectedAccount =
              matchingBotAccount ??
              (botAccount &&
              platformAccounts.some((a) => a.id === botAccount.id)
                ? botAccount
                : platformAccounts[0]);
            if (selectedAccount) setInitialAccountId(selectedAccount.id);
          }
        }
        setReplyingToDetail(detail);
      } else {
        setInitialRecipient(undefined);
        setInitialAccountId(undefined);
        setReplyingToDetail(undefined);
      }
    },
    [accounts, groupedByIntegration, insight.botId],
  );

  const handleCloseReply = useCallback(() => {
    setReplyingToDetail(null);
    setInitialRecipient(undefined);
    setInitialAccountId(undefined);
  }, []);

  /**
   * Handle message search input change: used to filter list based on message content
   */
  const handleMessageSearchChange = useCallback((value: string) => {
    setMessageSearch(value);
  }, []);

  /**
   * Quick emoji reply: infer recipient and account from detail and send message containing only emoji
   */
  const handleQuickEmojiReply = useCallback(
    (detail: DetailData, emoji: string) => {
      const recipient = detail.channel || detail.person;
      if (!recipient) return;
      let accountId: string | undefined;
      if (detail.platform) {
        const detailPlatform = detail.platform.toLowerCase().trim();
        const normalized = detailPlatform.replace(/\s+/g, "") as IntegrationId;
        const platformAccounts = groupedByIntegration[normalized];
        if (platformAccounts?.length > 0) {
          const botAccount = accounts.find((a) => a.bot?.id === insight.botId);
          const matching = platformAccounts.find(
            (a) => a.bot?.id === insight.botId,
          );
          const selected =
            matching ??
            (botAccount && platformAccounts.some((a) => a.id === botAccount.id)
              ? botAccount
              : platformAccounts[0]);
          if (selected) accountId = selected.id;
        }
      }
      if (!accountId) {
        const norm = detail.platform?.toLowerCase().trim().replace(/\s+/g, "");
        const first = accounts.find((a) => a.platform === norm) ?? accounts[0];
        accountId = first?.id;
      }
      if (accountId) {
        sendReply({ content: emoji, recipient, accountId });
      }
    },
    [accounts, groupedByIntegration, insight.botId, sendReply],
  );

  /**
   * Get messages to send/in progress
   * Filter messages containing pendingId from mergedDetails (messages added by optimistic update)
   */
  const pendingMessages = useMemo(() => {
    return (mergedDetails ?? []).filter(
      (detail) => (detail as any).pendingId,
    ) as any[];
  }, [mergedDetails]);

  /**
   * Handle retry for failed message sending
   */
  const handleRetryMessage = useCallback(
    async (pendingMessage: any) => {
      if (!pendingMessage.pendingId) return;
      try {
        const result = await retryMessage(pendingMessage.pendingId);
        if (!result.success) {
          toast.error(t("insightDetail.retryFailed", "Retry failed"), {
            description: result.error,
          });
        }
      } catch (error) {
        toast.error(t("insightDetail.retryFailed", "Retry failed"));
      }
    },
    [retryMessage, t],
  );

  /** Unified chronological order (old to new), latest at bottom of list; on entry non-RSS scrolls to bottom, IM-like */
  const filteredAndSortedDetails = useMemo(() => {
    const normalizedMessageSearch = messageSearch.trim().toLowerCase();

    // When showing all messages, take union of mergedDetails and allChannelMessages
    // Deduplicate using normalized time (second-level) + originalContent/content, prioritize insight.details data
    const mergedMessages = showAllChannelMessages
      ? (() => {
          const messageMap = new Map<string, DetailData>();

          // First add allChannelMessages
          allChannelMessages.forEach((msg) => {
            const normalizedTime = Math.floor(
              normalizeTimestamp(msg.time) / 1000,
            );
            const key = `${normalizedTime}-${msg.content ?? ""}`;
            messageMap.set(key, msg);
          });

          // Then add mergedDetails, if key is the same use mergedDetails data (because may contain more processed info)
          (mergedDetails ?? []).forEach((detail) => {
            const normalizedTime = Math.floor(
              normalizeTimestamp(detail.time) / 1000,
            );
            const content = detail.originalContent ?? detail.content ?? "";
            const key = `${normalizedTime}-${content}`;
            messageMap.set(key, detail);
          });

          return Array.from(messageMap.values());
        })()
      : (mergedDetails ?? []);

    return mergedMessages
      .filter((detail) => {
        // Exclude pending-to-send messages (displayed separately at the bottom)
        if ((detail as any).pendingId) return false;

        // Search message content (case insensitive), match originalContent/content
        if (normalizedMessageSearch) {
          const searchableContent = (
            detail.originalContent ??
            detail.content ??
            ""
          ).toString();
          if (
            !searchableContent.toLowerCase().includes(normalizedMessageSearch)
          )
            return false;
        }

        if (filterType === "all") return true;
        if (filterType === "group" && filterValue)
          return detail.channel === filterValue;
        if (filterType === "person" && filterValue)
          return detail.person === filterValue;
        return true;
      })
      .sort((a, b) => {
        // Both have no time, maintain original order
        if (!a.time && !b.time) return 0;
        // Only a has no time, place after
        if (!a.time) return 1;
        // Only b has no time, place after
        if (!b.time) return -1;
        // Both have time, sort by time ascending
        return normalizeTimestamp(a.time) - normalizeTimestamp(b.time);
      });
  }, [
    showAllChannelMessages,
    allChannelMessages,
    mergedDetails,
    filterType,
    filterValue,
    messageSearch,
  ]);

  /** For non-RSS, on entry source info tab scrolls to bottom (only message area scrolls), prioritize seeing latest messages (IM-style) */
  useEffect(() => {
    if (isRssSource || filteredAndSortedDetails.length === 0) return;
    const el = listContainerRef.current;
    if (!el) return;
    const id = setTimeout(() => {
      el.scrollTop = el.scrollHeight;
    }, 50);
    return () => clearTimeout(id);
  }, [isRssSource, filteredAndSortedDetails.length]);

  /**
   * When component first mounts, automatically load first page of messages
   */
  useEffect(() => {
    if (showAllChannelMessages && allChannelMessages.length === 0) {
      fetchChannelMessages(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only execute on first mount

  useEffect(() => {
    if ((targetSourceDetailIds?.length ?? 0) === 0) return;
    setShowAllChannelMessages(false);
    setFilterType("all");
    setFilterValue(null);
    setMessageSearch("");
  }, [targetSourceDetailIds]);

  /**
   * After initial load completes, scroll to bottom
   * Executed when isLoadingChannelMessages changes from true to false and message count is greater than 0
   */
  useEffect(() => {
    const el = listContainerRef.current;
    if (
      !isLoadingChannelMessages &&
      el &&
      filteredAndSortedDetails.length > 0 &&
      !isRssSource
    ) {
      // Use scrollIntoView to scroll to bottom anchor
      const anchor = bottomAnchorRef.current;
      if (anchor) {
        anchor.scrollIntoView({ behavior: "auto", block: "end" });
      } else {
        // Fallback: set scrollTop
        setTimeout(() => {
          el.scrollTop = el.scrollHeight;
        }, 100);
      }
    }
  }, [isLoadingChannelMessages, filteredAndSortedDetails.length, isRssSource]);

  /**
   * Restore scroll position after loading more
   * When isLoadingMore changes from true to false, restore to previous position
   */
  useEffect(() => {
    if (!isLoadingMore && scrollPositionBeforeLoadMore.current !== null) {
      const container = listContainerRef.current;
      if (!container) return;

      // Use requestAnimationFrame to ensure DOM is updated
      const id = requestAnimationFrame(() => {
        const savedValue = scrollPositionBeforeLoadMore.current;
        if (savedValue === null) return;

        if (typeof savedValue === "string") {
          // Saved value is message index
          const newIndex = Number.parseInt(savedValue, 10) + PAGE_SIZE;
          const targetElement = container.querySelector(
            `[data-message-index="${newIndex}"]`,
          ) as HTMLElement;

          if (targetElement) {
            // Scroll to target element
            targetElement.scrollIntoView({ behavior: "auto", block: "start" });
          }
        } else {
          // Saved value is scrollHeight - scrollTop difference
          container.scrollTop = container.scrollHeight - (savedValue + 100); // Slightly offset so user knows there's new content
        }

        // Clear saved position
        scrollPositionBeforeLoadMore.current = null;
      });

      return () => cancelAnimationFrame(id);
    }
  }, [isLoadingMore, PAGE_SIZE]);

  useEffect(() => {
    const targetDetailIds = targetSourceDetailIds ?? [];
    if (targetDetailIds.length === 0) return;

    const nextTargetKey = targetDetailIds.join(",");
    if (lastScrolledTargetRef.current === nextTargetKey) return;

    const container = listContainerRef.current;
    if (!container) return;

    const frame = requestAnimationFrame(() => {
      const target = targetDetailIds
        .map((detailId) =>
          container.querySelector<HTMLElement>(
            `[data-source-detail-id="${CSS.escape(detailId)}"]`,
          ),
        )
        .find(Boolean);

      if (!target) return;

      target.scrollIntoView({ behavior: "smooth", block: "center" });
      lastScrolledTargetRef.current = nextTargetKey;
    });

    return () => cancelAnimationFrame(frame);
  }, [filteredAndSortedDetails, targetSourceDetailIds]);

  /** Current channel name: prioritize insight.groups[0], otherwise take first detail's channel, otherwise fall back to "Source Info" */
  const channelLabel = useMemo(() => {
    const groups = insight.groups;
    if (Array.isArray(groups) && groups.length > 0 && groups[0]) {
      return String(groups[0]);
    }
    const firstChannel = mergedDetails?.[0]?.channel;
    if (firstChannel) return firstChannel;
    return t("insightDetail.sourceInfo");
  }, [insight.groups, mergedDetails, t]);

  // Early return AFTER all hooks are called
  // Only return null if BOTH mergedDetails is empty AND allChannelMessages is empty
  if (
    (!mergedDetails || mergedDetails.length === 0) &&
    allChannelMessages.length === 0
  ) {
    return null;
  }

  // If RSS or manual platform, don't show reply function
  const shouldHideReply = insight.platform === "manual";

  if (shouldHideReply) {
    return null;
  }

  // Return reply mode if replying to a detail
  if (replyingToDetail !== null) {
    return (
      <div
        className="flex h-full flex-col gap-2 overflow-hidden"
        style={{ width: "100%", maxWidth: "100%", boxSizing: "border-box" }}
      >
        <div className="flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={handleCloseReply}
              aria-label={t("common.back")}
            >
              <RemixIcon name="arrow_left_s" size="size-4" />
            </Button>
            <h3 className="text-base font-semibold text-foreground">
              {replyingToDetail
                ? t("insightDetail.replyToDetail")
                : t("insightDetail.composeReply")}
            </h3>
          </div>
        </div>
        <ReplyWorkspace
          insight={insight}
          onExpandedChange={() => {}}
          initialExpanded={true}
          initialRecipient={initialRecipient}
          initialAccountId={initialAccountId}
          onGenerateStateChange={onGenerateStateChange}
        />
      </div>
    );
  }

  const defaultShowAllChannelMessages = !isEmailOrRssSource;
  const isFilterActive =
    filterType !== "all" ||
    filterValue !== null ||
    showAllChannelMessages !== defaultShowAllChannelMessages ||
    messageSearch.trim() !== "";

  // Normal render mode
  return (
    <div className="flex h-full min-h-0 flex-col px-0 pt-0 pb-0">
      {/* Header: current channel name; view original messages on filter left; count moved to tab */}
      <div className="flex shrink-0 items-center justify-between gap-1.5 pt-4 pb-2">
        <h3 className="text-base font-semibold text-foreground truncate min-w-0">
          {channelLabel}
          {/* Show current message count */}
          <span className="text-xs text-muted-foreground ml-2">
            {filteredAndSortedDetails.length > 0 &&
              `(${filteredAndSortedDetails.length})`}
          </span>
        </h3>
        <div className="flex items-center gap-1.5 shrink-0">
          <div className="relative w-full max-w-56">
            <RemixIcon
              name="search"
              size="size-3.5"
              className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              type="text"
              value={messageSearch}
              onChange={(e) => handleMessageSearchChange(e.target.value)}
              placeholder={t(
                "insightDetail.searchMessages",
                "Search message content",
              )}
              className="pl-7 h-7 text-sm"
              aria-label={t(
                "insightDetail.searchMessages",
                "Search message content",
              )}
            />
          </div>
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant={isFilterActive ? "secondary" : "outline"}
                    size="icon"
                    className={cn(
                      "h-7 w-7",
                      isFilterActive &&
                        "bg-primary/15 text-primary border-primary/40 ring-1 ring-primary/20",
                    )}
                    aria-pressed={isFilterActive}
                    aria-label={t("insightDetail.filterSource")}
                  >
                    <RemixIcon name="filter" size="size-4" />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>
                <p>{t("insightDetail.filterSource")}</p>
              </TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel>
                {t("insightDetail.filterBy", "Filter by")}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => {
                  setFilterType("all");
                  setFilterValue(null);
                }}
              >
                <span className="flex items-center gap-2 w-full">
                  {filterType === "all" && (
                    <RemixIcon name="check" size="size-4" />
                  )}
                  {filterType !== "all" && <span className="size-4" />}
                  {t("insightDetail.filterAll", "All")}
                </span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  {t("insightDetail.filterByGroup", "By channel")}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-48">
                  {Array.from(
                    new Set(
                      mergedDetails
                        ?.map((d) => d.channel)
                        .filter((c): c is string => !!c) ?? [],
                    ),
                  ).map((channel) => (
                    <DropdownMenuItem
                      key={channel}
                      onClick={() => {
                        setFilterType("group");
                        setFilterValue(channel);
                      }}
                    >
                      <span className="flex items-center gap-2 w-full">
                        {filterType === "group" && filterValue === channel && (
                          <RemixIcon name="check" size="size-4" />
                        )}
                        {!(
                          filterType === "group" && filterValue === channel
                        ) && <span className="size-4" />}
                        {channel}
                      </span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  {t("insightDetail.filterByPerson", "By person")}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-48">
                  {Array.from(
                    new Set(
                      mergedDetails
                        ?.map((d) => d.person)
                        .filter((p): p is string => !!p) ?? [],
                    ),
                  ).map((person) => (
                    <DropdownMenuItem
                      key={person}
                      onClick={() => {
                        setFilterType("person");
                        setFilterValue(person);
                      }}
                    >
                      <span className="flex items-center gap-2 w-full">
                        {filterType === "person" && filterValue === person && (
                          <RemixIcon name="check" size="size-4" />
                        )}
                        {!(
                          filterType === "person" && filterValue === person
                        ) && <span className="size-4" />}
                        {person}
                      </span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Main: IM conversation list + optional inline original messages */}
      <div className="flex flex-1 min-h-0 gap-3 flex-col md:flex-row overflow-hidden mt-2">
        <div
          ref={listContainerRef}
          className="flex-1 min-h-0 overflow-y-auto space-y-2 flex flex-col"
        >
          {/* Load more button when showing all messages (top) */}
          {showAllChannelMessages && hasMoreMessages && (
            <div className="flex justify-center py-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleLoadMore}
                disabled={isLoadingMore}
                className="h-8 text-xs"
              >
                {isLoadingMore ? (
                  <>
                    <RemixIcon
                      name="loader_2"
                      size="size-3.5"
                      className="animate-spin mr-1.5"
                    />
                    {t("common.loading", "Loading...")}
                  </>
                ) : (
                  t("insightDetail.loadMore", "Load more")
                )}
              </Button>
            </div>
          )}
          {/* Top anchor, used to maintain scroll position after loading more */}
          <div ref={topAnchorRef} className="h-1" />
          {filteredAndSortedDetails.map((detail, index) => {
            const fromOwnAccount = isDetailFromOwnAccount(detail);
            // Key for quote matching (without index, consistent with quotedMessageKeys format)
            const quoteKey = `${detail.time}-${detail.person ?? ""}-${detail.channel ?? ""}`;
            // Unique key for React rendering (includes index to ensure uniqueness)
            const detailKey = `${quoteKey}-${index}`;
            const showOriginal = detailShowOriginal[detailKey] ?? false;
            const normalizedTime = Math.floor(
              normalizeTimestamp(detail.time) / 1000,
            );
            const detailSignature = [
              normalizedTime,
              detail.person ?? "",
              detail.channel ?? "",
              detail.originalContent ?? detail.content ?? "",
            ].join("::");
            const sourceDetailId = detailIdBySignature.get(detailSignature);
            const isTargeted =
              sourceDetailId !== undefined &&
              (targetSourceDetailIds ?? []).includes(sourceDetailId);
            const timeStr = format(
              detail.time ? coerceDate(detail.time) : new Date(),
              "HH:mm",
              { locale: dateLocale },
            );
            const name = detail.person?.trim() || t("insightDetail.unknown");
            /** Whether current message is from email platform */
            const isEmailPlatform = (() => {
              const platform = detail.platform?.toLowerCase();
              return (
                platform === "email" ||
                platform === "gmail" ||
                platform === "outlook" ||
                platform?.includes("mail")
              );
            })();

            // Check if date divider needs to be shown (date differs from previous message)
            let dateDivider = null;
            const currentDetailDate = detail.time
              ? coerceDate(detail.time)
              : new Date();
            const prevDetail =
              index > 0 ? filteredAndSortedDetails[index - 1] : null;
            const prevDetailDate = prevDetail?.time
              ? coerceDate(prevDetail.time)
              : null;
            const showDateDivider =
              !prevDetailDate || !isSameDay(currentDetailDate, prevDetailDate);

            if (showDateDivider) {
              // Determine if it's today
              const today = new Date();
              const yesterday = new Date(today);
              yesterday.setDate(yesterday.getDate() - 1);

              let dateLabel = format(currentDetailDate, "yyyy-MM-dd", {
                locale: dateLocale,
              });
              if (isSameDay(currentDetailDate, today)) {
                dateLabel = t("insightDetail.dateToday");
              } else if (isSameDay(currentDetailDate, yesterday)) {
                dateLabel = t("insightDetail.dateYesterday");
              }

              dateDivider = (
                <div
                  key={`date-${dateLabel}`}
                  className="flex items-center gap-2 w-full my-3"
                >
                  <span
                    className="flex-1 h-px bg-border shrink-0"
                    aria-hidden
                  />
                  <span className="text-xs text-muted-foreground shrink-0 px-2">
                    {dateLabel}
                  </span>
                  <span
                    className="flex-1 h-px bg-border shrink-0"
                    aria-hidden
                  />
                </div>
              );
            }

            return (
              <React.Fragment key={detailKey}>
                {dateDivider}
                <div
                  className="group flex w-full justify-start"
                  data-message-index={index}
                  data-source-detail-id={sourceDetailId}
                >
                  <div className="flex w-full max-w-full flex-col gap-0.5 items-start relative">
                    {/* Unified left alignment: name, source badge, time on same row as hover actions */}
                    <div className="flex items-center gap-1.5 text-xxs text-muted-foreground flex-wrap flex-row">
                      {/* Action area shown on hover: white background + border only wraps buttons, does not include name and time */}
                      <div
                        className={cn(
                          "absolute right-0 top-0 flex items-center gap-0.5 opacity-0 pointer-events-none transition-opacity duration-150 rounded-md border border-transparent bg-transparent px-1 py-0.5",
                          "group-hover:opacity-100 group-hover:pointer-events-auto",
                          "group-hover:bg-card group-hover:border-border",
                          "focus-within:opacity-100 focus-within:pointer-events-auto focus-within:bg-card focus-within:border-border",
                        )}
                      >
                        {detail.originalContent && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 text-foreground/80 hover:text-primary hover:bg-primary/5"
                                onClick={() => {
                                  setDetailShowOriginal((prev) => ({
                                    ...prev,
                                    [detailKey]: !prev[detailKey],
                                  }));
                                }}
                                aria-label={
                                  showOriginal
                                    ? t(
                                        "insightDetail.showTranslatedTooltip",
                                        "Show translation",
                                      )
                                    : t(
                                        "insightDetail.showOriginalTooltip",
                                        "View original message",
                                      )
                                }
                              >
                                <i
                                  className="ri-info-i size-4 shrink-0 inline-flex items-center justify-center"
                                  aria-hidden
                                />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>
                                {showOriginal
                                  ? t(
                                      "insightDetail.showTranslatedTooltip",
                                      "Show translation",
                                    )
                                  : t(
                                      "insightDetail.showOriginalTooltip",
                                      "View original message",
                                    )}
                              </p>
                            </TooltipContent>
                          </Tooltip>
                        )}
                        {(detail.channel || detail.person) && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6"
                                onClick={() => {
                                  if (onPrependToReplyInput) {
                                    const name =
                                      detail.person || detail.channel || "";
                                    if (name) onPrependToReplyInput(name);
                                  } else {
                                    handleReplyClick(detail);
                                  }
                                }}
                                aria-label={t("insightDetail.reply", "Reply")}
                              >
                                <RemixIcon
                                  name="message"
                                  size="size-4"
                                  className="shrink-0"
                                />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>{t("insightDetail.reply", "Reply")}</p>
                            </TooltipContent>
                          </Tooltip>
                        )}
                        {QUICK_EMOJI_LIST.map((emoji) => (
                          <Tooltip key={emoji}>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 text-base"
                                disabled={isSendingEmoji}
                                onClick={() =>
                                  handleQuickEmojiReply(detail, emoji)
                                }
                                aria-label={t(
                                  "insightDetail.sendEmojiReply",
                                  "Send {{emoji}} reply",
                                  { emoji },
                                )}
                              >
                                {emoji}
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>
                                {t(
                                  "insightDetail.sendEmojiReply",
                                  "Send {{emoji}} reply",
                                  { emoji },
                                )}
                              </p>
                            </TooltipContent>
                          </Tooltip>
                        ))}
                      </div>
                    </div>
                    {/* Bubble */}
                    <div
                      className={cn(
                        "rounded-lg px-4 py-2 text-sm break-words scroll-mt-24 transition-colors",
                        fromOwnAccount
                          ? "bg-primary-50 text-foreground border border-border"
                          : "text-foreground border border-border",
                        isTargeted &&
                          "border-primary bg-primary/5 ring-1 ring-primary/20",
                        isEmailPlatform && "w-full",
                      )}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span
                          className={cn(
                            "text-sm font-medium truncate max-w-[140px]",
                            fromOwnAccount
                              ? "text-primary"
                              : "text-foreground/80",
                          )}
                        >
                          {name}
                        </span>
                        {/* Only show quote badge for quoted messages when displaying all messages */}
                        {showAllChannelMessages &&
                          quotedMessageKeys.has(quoteKey) && (
                            <Badge
                              variant="secondary"
                              className="text-[10px] px-1.5 py-0 font-normal shrink-0"
                            >
                              {t("insightDetail.quoteBadge", "Quote")}
                            </Badge>
                          )}
                      </div>
                      <InsightDetailContent
                        detail={detail}
                        noBorder
                        contentBgClass="bg-transparent dark:bg-transparent"
                        showAttachmentDetailOnClick
                        compactAttachments
                        showOriginal={showOriginal}
                        className={isEmailPlatform ? "w-full" : undefined}
                      />
                      <div className="mt-1 text-xs text-muted-foreground text-right">
                        {timeStr}
                      </div>
                    </div>
                  </div>
                </div>
              </React.Fragment>
            );
          })}

          {/* Messages pending/sending (optimistic update) */}
          {pendingMessages.map((pendingMessage) => {
            const isPending =
              pendingMessage.status === "sending" ||
              pendingMessage.status === "pending";
            const fromOwnAccount = isDetailFromOwnAccount(
              pendingMessage as DetailData,
            );
            const isFailed = pendingMessage.status === "failed";
            const timeStr = format(
              pendingMessage.time
                ? coerceDate(pendingMessage.time)
                : new Date(),
              "HH:mm",
              { locale: dateLocale },
            );
            const name =
              pendingMessage.person?.trim() || t("insightDetail.unknown");

            return (
              <div
                key={pendingMessage.pendingId}
                className="group flex w-full justify-start"
              >
                <div className="flex w-full max-w-full flex-col gap-0.5 items-start">
                  {/* Bubble + status indicator */}
                  <div className="flex items-end gap-1">
                    <div
                      className={cn(
                        "rounded-lg px-4 py-2 text-sm break-words",
                        isPending && "opacity-70",
                      )}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span
                          className={cn(
                            "text-sm font-medium truncate max-w-[140px]",
                            fromOwnAccount
                              ? "text-primary"
                              : "text-foreground/80",
                          )}
                        >
                          {name}
                        </span>
                      </div>
                      <InsightDetailContent
                        detail={pendingMessage as DetailData}
                        noBorder
                        contentBgClass="bg-transparent dark:bg-transparent"
                        showAttachmentDetailOnClick
                        compactAttachments
                        showOriginal={false}
                      />
                      <div className="mt-1 text-xs text-muted-foreground text-right">
                        {timeStr}
                      </div>
                    </div>
                    {/* Status indicator - shows red exclamation on send failure */}
                    {isFailed && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            onClick={() => handleRetryMessage(pendingMessage)}
                            className="flex-shrink-0 w-6 h-6 rounded-full bg-destructive hover:bg-destructive/90 text-destructive-foreground transition-colors flex items-center justify-center"
                          >
                            <RemixIcon
                              name="error_warning"
                              size="size-3"
                              className="shrink-0"
                            />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p className="text-xs max-w-[200px]">
                            {pendingMessage.error ||
                              t(
                                "insightDetail.sendFailedDesc",
                                "Send failed, click to retry",
                              )}
                          </p>
                        </TooltipContent>
                      </Tooltip>
                    )}
                    {/* Loading indicator while sending */}
                    {isPending && (
                      <div className="flex-shrink-0 w-6 h-6 flex items-center justify-center">
                        <RemixIcon
                          name="loader_2"
                          size="size-3"
                          className="animate-spin text-muted-foreground"
                        />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          {/* Bottom anchor, used for auto-scroll */}
          <div ref={bottomAnchorRef} className="h-1" />
        </div>
      </div>
    </div>
  );
}
