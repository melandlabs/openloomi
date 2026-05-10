"use client";

import type React from "react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  lazy,
  Suspense,
} from "react";
import { ScrollArea } from "@alloomi/ui";
import { Button, Tabs, TabsList, TabsTrigger } from "@alloomi/ui";
import { Tooltip, TooltipContent, TooltipTrigger } from "@alloomi/ui";
import { useTranslation } from "react-i18next";
import { RemixIcon } from "@/components/remix-icon";
import { useLocalStorage } from "@alloomi/hooks/use-local-storage";
import { useSingleInsightRefresh } from "@/hooks/use-single-insight-refresh";
import { useInsightCache } from "@/hooks/use-insight-cache";
import { useInsightOptimisticUpdates } from "@/components/insight-optimistic-context";
import { useSidePanel } from "@/components/agent/side-panel-context";
import { useChatContext } from "@/components/chat-context";
import { AgentChatPanel } from "@/components/agent/chat-panel";
import type { Insight } from "@/lib/db/schema";
import type { DetailData, TimelineData } from "@/lib/ai/subagents/insights";
import { useIsMobile } from "@alloomi/hooks/use-is-mobile";
import { InsightDetailContext } from "@/components/insight-detail-context";
import { InsightDetailSourceInfo } from "@/components/insight-detail-source-info";
import {
  InsightDetailFooter,
  ReplyWorkspace,
} from "@/components/insight-detail-footer";
import { toast } from "./toast";
import { cn, normalizeTimestamp } from "@/lib/utils";
import { TimelineEventCard } from "@/components/timeline-event-card";
import type { InsightTimelineHistory } from "@/lib/db/schema";
import { addRecentInsight } from "@/lib/insights/recent";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@alloomi/ui";

const TimelineHistoryDialog = lazy(() =>
  import("@/components/timeline-history-dialog").then((mod) => ({
    default: mod.TimelineHistoryDialog,
  })),
);

// client-event-listeners: Global event manager to avoid duplicate listeners
class EventManager {
  private listeners = new Map<string, Set<EventListener>>();

  add(event: string, listener: EventListener): void {
    let eventListeners = this.listeners.get(event);
    if (!eventListeners) {
      eventListeners = new Set();
      this.listeners.set(event, eventListeners);
    }

    // Check if the same listener already exists
    if (!eventListeners.has(listener)) {
      window.addEventListener(event, listener);
      eventListeners.add(listener);
    }
  }

  remove(event: string, listener: EventListener): void {
    const eventListeners = this.listeners.get(event);
    if (eventListeners) {
      window.removeEventListener(event, listener);
      eventListeners.delete(listener);

      // If no listeners remain, delete this event
      if (eventListeners.size === 0) {
        this.listeners.delete(event);
      }
    }
  }

  removeAll(): void {
    this.listeners.forEach((listeners, event) => {
      listeners.forEach((listener) => {
        window.removeEventListener(event, listener);
      });
    });
    this.listeners.clear();
  }
}

// Use module-level singleton
const eventManager = new EventManager();

interface TimelineActionChatSidePanelContentProps {
  initialMessage: string;
  onClose: () => void;
}

function TimelineActionChatSidePanelContent({
  initialMessage,
  onClose,
}: TimelineActionChatSidePanelContentProps) {
  const { t } = useTranslation();
  const { sidePanel, setSidePanelDisplayMode } = useSidePanel();
  const isFullscreen = sidePanel?.displayMode === "fullscreen";

  return (
    <div className="h-full flex flex-col bg-card">
      <div className="flex items-center justify-end gap-1 px-2 py-2 bg-white/70 shrink-0">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              onClick={() =>
                setSidePanelDisplayMode(isFullscreen ? "sidebar" : "fullscreen")
              }
              className="h-8 w-8 shrink-0"
              aria-label={t("common.fullscreen", "Fullscreen")}
            >
              <RemixIcon
                name={isFullscreen ? "minimize_2" : "fullscreen"}
                className="size-3"
              />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <span>
              {isFullscreen
                ? t("common.exitFullscreen", "Exit fullscreen")
                : t("common.fullscreen", "Fullscreen")}
            </span>
          </TooltipContent>
        </Tooltip>
        <Button
          size="icon"
          variant="ghost"
          onClick={onClose}
          className="h-8 w-8 shrink-0"
          aria-label={t("common.close", "Close")}
        >
          <RemixIcon name="close" className="size-3" />
        </Button>
      </div>
      <div className="flex-1 min-h-0 flex flex-col">
        <AgentChatPanel chatId={null} initialInput={initialMessage} />
      </div>
    </div>
  );
}

/**
 * Event detail sidebar: icon-only navigation (Digest / Sources / Notes / Files)
 */
function InsightDetailSidebar({
  activeTab,
  onTabChange,
  platform,
}: {
  activeTab: "digest" | "sources" | "attached" | "files";
  onTabChange: (tab: "digest" | "sources" | "attached" | "files") => void;
  platform?: string;
}) {
  const { t } = useTranslation();

  const isManual = platform === "manual";

  const tabs = [
    {
      id: "digest" as const,
      icon: "timeline_view",
      tooltip: t("insightDetail.sidebarTooltipDigest", "Updates"),
    },
    ...(isManual
      ? []
      : [
          {
            id: "sources" as const,
            icon: "discuss",
            tooltip: t("insightDetail.sidebarTooltipSources", "Info"),
          },
        ]),
  ];

  return (
    <div className="flex flex-col items-center gap-1 py-0 w-fit">
      {tabs.map((tab) => (
        <Tooltip key={tab.id}>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                "size-9 shrink-0 transition-colors",
                activeTab === tab.id
                  ? "text-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-transparent",
              )}
              onClick={() => onTabChange(tab.id)}
              aria-label={tab.tooltip}
            >
              <RemixIcon
                name={tab.icon as any}
                size="size-5"
                className="shrink-0"
                filled={activeTab === tab.id}
              />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right" sideOffset={8}>
            <p>{tab.tooltip}</p>
          </TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}

export default function InsightDetailDrawer({
  insight,
  isOpen,
  onClose,
  onUnderstand,
  understandingInsightId,
  onArchive,
  onFavorite,
  /** When true, embedded in layout (middle card), no fixed positioning or overlay, allows coexistence with right-side person detail panel */
  embedInLayout = false,
  /** When true, opened on Today Focus page; if event is in list, pin status is treated as pinned */
  isInBriefContext = false,
  /** Current Today Focus list insight IDs, used with isInBriefContext to determine pin display */
  briefListInsightIds,
  /** Callback when user confirms removal from Today Focus (used to remove from current session list) */
  onUnpinnedFromBrief,
  /** When true, auto-open chat side panel */
  autoOpenChat = false,
  initialTab,
  targetSourceDetailIds,
}: {
  insight: Insight | null;
  isOpen: boolean;
  onClose: () => void;
  onUnderstand?: (insight: Insight) => void;
  understandingInsightId?: string | null;
  onArchive?: (insight: Insight) => void;
  onFavorite?: (insight: Insight) => void;
  /** When true, embedded in layout (middle card), no fixed positioning or overlay */
  embedInLayout?: boolean;
  /** When true, auto-open chat side panel */
  autoOpenChat?: boolean;
  isInBriefContext?: boolean;
  briefListInsightIds?: Set<string>;
  onUnpinnedFromBrief?: (insightId: string) => void;
  initialTab?: "digest" | "sources" | "attached" | "files";
  targetSourceDetailIds?: string[];
}) {
  if (!insight) {
    return null;
  }

  return (
    <InsightDetailDrawerContent
      insight={insight}
      isOpen={isOpen}
      onClose={onClose}
      onUnderstand={onUnderstand}
      understandingInsightId={understandingInsightId}
      onArchive={onArchive}
      onFavorite={onFavorite}
      embedInLayout={embedInLayout}
      isInBriefContext={isInBriefContext}
      briefListInsightIds={briefListInsightIds}
      onUnpinnedFromBrief={onUnpinnedFromBrief}
      autoOpenChat={autoOpenChat}
      initialTab={initialTab}
      targetSourceDetailIds={targetSourceDetailIds}
    />
  );
}

function InsightDetailDrawerContent({
  insight,
  isOpen,
  onClose,
  onUnderstand,
  understandingInsightId,
  onArchive,
  onFavorite,
  embedInLayout = false,
  isInBriefContext = false,
  briefListInsightIds,
  onUnpinnedFromBrief,
  autoOpenChat = false,
  initialTab,
  targetSourceDetailIds,
}: {
  insight: Insight;
  isOpen: boolean;
  onClose: () => void;
  onReplyToDetail?: (insight: Insight, detail: DetailData) => void;
  onUnderstand?: (insight: Insight) => void;
  understandingInsightId?: string | null;
  onArchive?: (insight: Insight) => void;
  onFavorite?: (insight: Insight) => void;
  embedInLayout?: boolean;
  isInBriefContext?: boolean;
  briefListInsightIds?: Set<string>;
  onUnpinnedFromBrief?: (insightId: string) => void;
  autoOpenChat?: boolean;
  initialTab?: "digest" | "sources" | "attached" | "files";
  targetSourceDetailIds?: string[];
}) {
  const { t, i18n } = useTranslation();

  // Global optimistic update management
  const { updateInsightCategories, getInsightCategories } =
    useInsightOptimisticUpdates();
  const { updateCategories } = useInsightCache();

  // Drawer open counter - increments each time the drawer opens, used to force remount child components
  const [drawerOpenCount, setDrawerOpenCount] = useState(0);

  // Store the latest insight state (may be updated via global events)
  const [latestInsight, setLatestInsight] = useState<Insight>(insight);

  // When prop.insight changes, sync update latestInsight
  useEffect(() => {
    setLatestInsight(insight);
  }, [insight]);

  // Close chat side panel when drawer closes
  const { closeSidePanel, openSidePanel } = useSidePanel() ?? {
    closeSidePanel: () => {},
    openSidePanel: () => {},
  };
  const { switchChatId } = useChatContext() ?? { switchChatId: () => {} };

  // Wrap onClose to close side panel when drawer closes
  const handleClose = useCallback(() => {
    closeSidePanel();
    onClose();
  }, [onClose, closeSidePanel]);

  // Handle timeline action click - opens a chat side panel with the action pre-filled
  const handleTimelineActionClick = useCallback(
    (action: string) => {
      switchChatId(null);
      openSidePanel({
        id: `timeline-action-chat-${Date.now()}`,
        width: 400,
        content: (
          <TimelineActionChatSidePanelContent
            initialMessage={action}
            onClose={closeSidePanel}
          />
        ),
      });
    },
    [closeSidePanel, openSidePanel, switchChatId],
  );

  // Listen for global favorite change events, sync update the currently open insight
  // client-event-listeners: use eventManager to avoid duplicate listeners
  useEffect(() => {
    const handleFavoriteChanged = (
      event: CustomEvent<{
        insightId: string;
        isFavorited: boolean;
      }>,
    ) => {
      const { insightId, isFavorited } = event.detail;
      if (insightId === latestInsight.id) {
        setLatestInsight((prev) => ({
          ...prev,
          isFavorited,
        }));
      }
    };

    eventManager.add(
      "insightFavoriteChanged",
      handleFavoriteChanged as EventListener,
    );
    return () => {
      eventManager.remove(
        "insightFavoriteChanged",
        handleFavoriteChanged as EventListener,
      );
    };
  }, [latestInsight.id]);

  // Listen for category change events, sync update the currently open insight
  // client-event-listeners: use eventManager to avoid duplicate listeners
  useEffect(() => {
    const handleCategoryChanged = (
      event: CustomEvent<{
        insightId: string;
        category?: string;
      }>,
    ) => {
      const { insightId } = event.detail;
      if (insightId === latestInsight.id) {
        // Re-fetch the insight to get updated categories
        // The categories might have changed from drag-and-drop in Brief panel
        setLatestInsight((prev) => ({
          ...prev,
        }));
      }
    };

    eventManager.add(
      "insightCategoryChanged",
      handleCategoryChanged as EventListener,
    );
    return () => {
      eventManager.remove(
        "insightCategoryChanged",
        handleCategoryChanged as EventListener,
      );
    };
  }, [latestInsight.id]);

  // Listen for reply sent events, sync update the currently open insight's details and timeline
  // This ensures the sources tab immediately shows newly sent messages
  useEffect(() => {
    const handleReplySent = (
      event: CustomEvent<{
        insightId: string;
        detail: DetailData;
        timeline: TimelineData;
      }>,
    ) => {
      const { insightId, detail, timeline } = event.detail;
      if (insightId === latestInsight.id) {
        setLatestInsight((prev) => ({
          ...prev,
          details: [...(prev.details || []), detail],
          timeline: [...(prev.timeline || []), timeline],
        }));
      }
    };

    eventManager.add("insight:replySent", handleReplySent as EventListener);
    return () => {
      eventManager.remove(
        "insight:replySent",
        handleReplySent as EventListener,
      );
    };
  }, [latestInsight.id]);

  // When drawer opens, increment the counter
  useEffect(() => {
    if (isOpen) {
      setDrawerOpenCount((prev) => prev + 1);
    }
  }, [isOpen]);

  // Normalize insight object (parse JSON fields in SQLite mode)
  const normalizedInsight = useMemo(() => {
    // Use the latest insight state (with latest values for fields like isFavorite)
    const data = latestInsight as any;

    // Check if parsing is needed (if it's a string, it needs to be parsed)
    const needsParsing = (field: any) =>
      typeof field === "string" &&
      (field.startsWith("[") || field.startsWith("{"));

    // Parse all JSON fields (using original insight's JSON fields)
    // Parse timeline and sort by time (normalize timestamps before sorting to handle mixed second/millisecond precision)
    const parsedTimeline = needsParsing(data.timeline)
      ? JSON.parse(data.timeline || "[]")
      : data.timeline;

    // Sort timeline by time ascending (oldest to newest)
    const sortedTimeline = Array.isArray(parsedTimeline)
      ? parsedTimeline.sort(
          (a, b) => normalizeTimestamp(a.time) - normalizeTimestamp(b.time),
        )
      : parsedTimeline;

    return {
      ...latestInsight,
      groups: needsParsing(data.groups)
        ? JSON.parse(data.groups || "[]")
        : data.groups,
      people: needsParsing(data.people)
        ? JSON.parse(data.people || "[]")
        : data.people,
      details: needsParsing(data.details)
        ? JSON.parse(data.details || "[]")
        : data.details,
      timeline: sortedTimeline,
      insights: needsParsing(data.insights)
        ? JSON.parse(data.insights || "[]")
        : data.insights,
      topKeywords: needsParsing(data.topKeywords)
        ? JSON.parse(data.topKeywords || "[]")
        : data.topKeywords,
      topEntities: needsParsing(data.topEntities)
        ? JSON.parse(data.topEntities || "[]")
        : data.topEntities,
      topVoices: needsParsing(data.topVoices)
        ? JSON.parse(data.topVoices || "[]")
        : data.topVoices,
      sources: needsParsing(data.sources)
        ? JSON.parse(data.sources || "[]")
        : data.sources,
      buyerSignals: needsParsing(data.buyerSignals)
        ? JSON.parse(data.buyerSignals || "[]")
        : data.buyerSignals,
      stakeholders: needsParsing(data.stakeholders)
        ? JSON.parse(data.stakeholders || "[]")
        : data.stakeholders,
      nextActions: needsParsing(data.nextActions)
        ? JSON.parse(data.nextActions || "[]")
        : data.nextActions,
      followUps: needsParsing(data.followUps)
        ? JSON.parse(data.followUps || "[]")
        : data.followUps,
      actionRequiredDetails: needsParsing(data.actionRequiredDetails)
        ? JSON.parse(data.actionRequiredDetails || "[]")
        : data.actionRequiredDetails,
      myTasks: needsParsing(data.myTasks)
        ? JSON.parse(data.myTasks || "[]")
        : data.myTasks,
      waitingForMe: needsParsing(data.waitingForMe)
        ? JSON.parse(data.waitingForMe || "[]")
        : data.waitingForMe,
      waitingForOthers: needsParsing(data.waitingForOthers)
        ? JSON.parse(data.waitingForOthers || "[]")
        : data.waitingForOthers,
      categories: needsParsing(data.categories)
        ? JSON.parse(data.categories || "[]")
        : data.categories,
      priority: needsParsing(data.priority)
        ? JSON.parse(data.priority || "{}")
        : data.priority,
      experimentIdeas: needsParsing(data.experimentIdeas)
        ? JSON.parse(data.experimentIdeas || "[]")
        : data.experimentIdeas,
      riskFlags: needsParsing(data.riskFlags)
        ? JSON.parse(data.riskFlags || "[]")
        : data.riskFlags,
      historySummary: needsParsing(data.historySummary)
        ? JSON.parse(data.historySummary || "{}")
        : data.historySummary,
      strategic: needsParsing(data.strategic)
        ? JSON.parse(data.strategic || "[]")
        : data.strategic,
      roleAttribution: needsParsing(data.roleAttribution)
        ? JSON.parse(data.roleAttribution || "[]")
        : data.roleAttribution,
      alerts: needsParsing(data.alerts)
        ? JSON.parse(data.alerts || "[]")
        : data.alerts,
    };
  }, [latestInsight]);
  // Check if pinned to today's focus:
  // First check if in today's focus list, if not check if categories has keep-focused
  const isPinned = useMemo(() => {
    // If in today's focus list, consider it pinned
    const inBriefList =
      !!isInBriefContext && !!briefListInsightIds?.has(normalizedInsight.id);
    if (inBriefList) {
      return true;
    }
    // If not in list, check if categories has keep-focused
    const hasKeepFocused =
      (
        getInsightCategories(
          normalizedInsight.id,
          normalizedInsight.categories,
        ) || []
      ).includes("keep-focused") || false;
    return hasKeepFocused;
  }, [
    normalizedInsight.id,
    normalizedInsight.categories,
    getInsightCategories,
    isInBriefContext,
    briefListInsightIds,
  ]);

  const isMobile = useIsMobile();

  const [isMuteConfirmOpen, setIsMuteConfirmOpen] = useState(false);
  /** Secondary confirmation dialog before removing from Today Focus */
  const [isUnpinConfirmOpen, setIsUnpinConfirmOpen] = useState(false);

  /** Click "Mute" */
  const handleArchiveClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      // Optimistic update: immediately remove from brief panel
      onUnpinnedFromBrief?.(normalizedInsight.id);
      onArchive?.(normalizedInsight);
    },
    [onArchive, normalizedInsight, onUnpinnedFromBrief],
  );

  /** Execute archive and close dialog after user confirms "Complete and Mute" */
  const handleMuteConfirm = useCallback(() => {
    // Optimistic update: remove from brief panel immediately
    onUnpinnedFromBrief?.(normalizedInsight.id);
    onArchive?.(normalizedInsight);
    setIsMuteConfirmOpen(false);
  }, [onArchive, normalizedInsight, onUnpinnedFromBrief]);

  /** Execute pin to Today Focus (pin only, no dialog logic) */
  const performPin = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      const insightId = normalizedInsight.id;
      const originalCategories =
        getInsightCategories(insightId, normalizedInsight.categories) || [];
      const newCategories = [...originalCategories, "keep-focused"];

      try {
        await updateInsightCategories(insightId, newCategories, async () => {
          const response = await fetch(`/api/insights/${insightId}/pin`, {
            method: "POST",
          });
          if (!response.ok) {
            throw new Error(t("insight.pinFailed", "Failed to pin"));
          }
          await updateCategories(insightId, newCategories);
        });
        toast({
          type: "success",
          description: t("insight.pinned", "Pinned to today's focus"),
        });
        // Dispatch event to notify refresh status (optimistic update)
        window.dispatchEvent(
          new CustomEvent("insightPinStatusChanged", {
            detail: { insightId, isPinned: true },
          }),
        );
        // Dispatch event to force refresh list
        window.dispatchEvent(
          new CustomEvent("insightListRefresh", {
            detail: { insightId, isPinned: true },
          }),
        );
        // Dispatch event to refresh brief panel
        window.dispatchEvent(new CustomEvent("brief:refresh"));
      } catch (error) {
        console.error("[performPin] Error:", error);
        toast({
          type: "error",
          description:
            error instanceof Error
              ? error.message
              : t("insight.pinFailed", "Failed to pin"),
        });
      }
    },
    [
      normalizedInsight.id,
      normalizedInsight.categories,
      t,
      updateCategories,
      updateInsightCategories,
      getInsightCategories,
    ],
  );

  /** Execute remove from Today Focus (unpin only, called after confirmation dialog confirmed) */
  const performUnpin = useCallback(async () => {
    const insightId = normalizedInsight.id;
    const originalCategories =
      getInsightCategories(insightId, normalizedInsight.categories) || [];
    const newCategories = originalCategories.filter(
      (c: string) => c !== "keep-focused",
    );

    try {
      await updateInsightCategories(insightId, newCategories, async () => {
        const response = await fetch(`/api/insights/${insightId}/pin`, {
          method: "DELETE",
        });
        if (!response.ok) {
          throw new Error(t("insight.unpinFailed", "Failed to unpin"));
        }
        await updateCategories(insightId, newCategories);
      });
      toast({
        type: "success",
        description: t("insight.unpinned", "Removed from today's focus"),
      });
      // Trigger event to notify status refresh (optimistic update)
      window.dispatchEvent(
        new CustomEvent("insightPinStatusChanged", {
          detail: { insightId, isPinned: false },
        }),
      );
      // Trigger brief panel refresh
      window.dispatchEvent(new CustomEvent("brief:refresh"));
    } catch (error) {
      console.error("[performUnpin] Error:", error);
      toast({
        type: "error",
        description:
          error instanceof Error
            ? error.message
            : t("insight.unpinFailed", "Failed to unpin"),
      });
    }
  }, [
    normalizedInsight.id,
    normalizedInsight.categories,
    t,
    updateCategories,
    updateInsightCategories,
    getInsightCategories,
  ]);

  /** Click pin button: if already in Today Focus, show dialog to confirm removal; otherwise pin directly */
  const handlePinClick = useCallback(
    async (e: React.MouseEvent) => {
      if (isPinned) {
        setIsUnpinConfirmOpen(true);
        return;
      }
      await performPin(e);
    },
    [isPinned, performPin],
  );

  /** Execute unpin, notify parent, and close dialog after user confirms "Remove from Today Focus" */
  const handleUnpinConfirm = useCallback(() => {
    const insightId = normalizedInsight.id;
    setIsUnpinConfirmOpen(false);
    onUnpinnedFromBrief?.(insightId);
    void performUnpin();
  }, [normalizedInsight.id, onUnpinnedFromBrief, performUnpin]);

  const handleCloseClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      handleClose();
    },
    [handleClose],
  );

  const [showIterationHistory, setShowIterationHistory] = useState(false);
  /** Detail inner Tabs: Digest | Sources | Attached | Files */
  const [detailTab, setDetailTab] = useLocalStorage<
    "digest" | "sources" | "attached" | "files"
  >("alloomi_insight_detail_tab", "digest");

  // Timeline history dialog state
  const [timelineHistoryDialog, setTimelineHistoryDialog] = useState<{
    open: boolean;
    eventId: string;
    eventName: string;
    history: InsightTimelineHistory[];
  }>({
    open: false,
    eventId: "",
    eventName: "",
    history: [],
  });

  const [isTimelineHistoryLoading, setIsTimelineHistoryLoading] =
    useState(false);

  /** Called by "Reply" button on message bubble in source: prepend @name to quick reply input */
  const prependToReplyInputRef = useRef<((name: string) => void) | null>(null);

  const [generateState, setGenerateState] = useState<{
    isLoading: boolean;
    hasOptions: boolean;
  }>({
    isLoading: false,
    hasOptions: false,
  });
  const scrollAreaRef = useRef<HTMLDivElement | null>(null);

  // rerender-move-effect-to-event: use ref to track recorded insight, avoid duplicate calls
  const lastRecordedInsightRef = useRef<string | null>(null);
  const lastRecordedInsightViewRef = useRef<string | null>(null);

  // Single insight refresh hook
  const { isRefreshing, handleRefresh: refreshInsight } =
    useSingleInsightRefresh();

  /**
   * Handle refreshing a single insight
   */
  const handleRefresh = async () => {
    const result = await refreshInsight(normalizedInsight.id);
    if (result?.insight) {
      window.dispatchEvent(
        new CustomEvent("insight:refreshed", {
          detail: { insightId: normalizedInsight.id, insight: result.insight },
        }),
      );
    }
  };

  // handleRefreshClick needs to be defined after handleRefresh (rerender-defer-reads)
  const handleRefreshClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    handleRefresh();
  }, []);

  // When insight changes, clear generation state and local state overrides
  useEffect(() => {
    setGenerateState({
      isLoading: false,
      hasOptions: false,
    });
  }, [normalizedInsight.id]);

  // When drawer opens, record recently viewed insight
  // rerender-move-effect-to-event: use ref to avoid unnecessary duplicate calls
  useEffect(() => {
    if (isOpen && normalizedInsight) {
      // Only record on first open or when insight changes
      if (lastRecordedInsightRef.current !== normalizedInsight.id) {
        addRecentInsight(normalizedInsight);
        lastRecordedInsightRef.current = normalizedInsight.id;
      }
    }
  }, [isOpen, normalizedInsight]);

  useEffect(() => {
    if (!isOpen) {
      lastRecordedInsightViewRef.current = null;
      return;
    }

    const insightId = normalizedInsight.id;
    if (lastRecordedInsightViewRef.current === insightId) {
      return;
    }

    lastRecordedInsightViewRef.current = insightId;
    const controller = new AbortController();

    void fetch(`/api/insights/${encodeURIComponent(insightId)}/view`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        viewSource: "detail",
        viewContext: {
          surface: embedInLayout ? "embedded" : "drawer",
          isInBriefContext,
          initialTab: initialTab ?? null,
        },
      }),
      signal: controller.signal,
    }).catch((error) => {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
      console.warn(
        "[InsightDetailDrawer] Failed to record insight view:",
        error,
      );
    });

    return () => controller.abort();
  }, [
    embedInLayout,
    initialTab,
    isInBriefContext,
    isOpen,
    normalizedInsight.id,
  ]);

  const shouldHideReplyWorkspace =
    normalizedInsight.taskLabel === "rss_feed" ||
    normalizedInsight.platform === "manual" ||
    normalizedInsight.details?.some((detail: any) => {
      const platform = detail.platform?.toLowerCase();
      return platform === "rss";
    });

  // Mobile fullscreen mode, no longer need to calculate panel height
  // Remove mobilePanelHeight-related useEffect

  // When drawer opens/closes, set data attribute on body to hide bottom menu
  useEffect(() => {
    if (typeof document === "undefined" || !isOpen || !isMobile) return;
    document.body.setAttribute("data-insight-drawer-open", "true");
    return () => {
      document.body.removeAttribute("data-insight-drawer-open");
    };
  }, [isOpen, isMobile]);

  useEffect(() => {
    if (!isOpen) return;
    const frame = requestAnimationFrame(() => {
      const viewport = scrollAreaRef.current?.querySelector<HTMLElement>(
        "[data-radix-scroll-area-viewport]",
      );
      if (viewport) {
        viewport.scrollTop = 0;
      }
    });

    return () => cancelAnimationFrame(frame);
  }, [isOpen, normalizedInsight.id]);

  // Scroll to bottom when switching to Sources tab
  useEffect(() => {
    if (detailTab === "sources") {
      const frame = requestAnimationFrame(() => {
        const viewport = scrollAreaRef.current?.querySelector<HTMLElement>(
          "[data-radix-scroll-area-viewport]",
        );
        if (viewport) {
          viewport.scrollTop = viewport.scrollHeight;
        }
      });

      return () => cancelAnimationFrame(frame);
    }
  }, [detailTab]);

  // Manual platform doesn't show Sources tab, switch back to digest
  useEffect(() => {
    if (detailTab === "sources" && normalizedInsight.platform === "manual") {
      setDetailTab("digest");
    }
  }, [normalizedInsight.platform, detailTab]);

  useEffect(() => {
    if (!isOpen) return;
    if (initialTab) {
      setDetailTab(initialTab);
      return;
    }
    if ((targetSourceDetailIds?.length ?? 0) > 0) {
      setDetailTab("sources");
    }
  }, [initialTab, isOpen, setDetailTab, targetSourceDetailIds]);

  const normalizedDetailPlatform =
    normalizedInsight.details?.[0]?.platform?.toLowerCase() ??
    normalizedInsight.platform?.toLowerCase() ??
    "";
  const canUnderstand =
    normalizedDetailPlatform === "gmail" ||
    normalizedDetailPlatform === "rss" ||
    normalizedInsight.taskLabel === "rss_feed";
  const isUnderstanding = understandingInsightId === normalizedInsight.id;

  // Embed mode: fullscreen display within SidebarInset area
  const basePanelClass = embedInLayout
    ? "absolute inset-0 z-50 flex h-full w-full min-h-0 flex-col bg-card shadow-xl transition-opacity duration-300 ease-out"
    : isMobile
      ? "fixed inset-0 z-[60] flex w-full h-full min-h-0 flex-col bg-card transition-opacity duration-300 ease-out"
      : "absolute inset-0 z-50 flex h-full w-full min-h-0 flex-col bg-card shadow-xl transition-opacity duration-300 ease-out";

  const transformClass = isOpen
    ? "opacity-100 pointer-events-auto"
    : "opacity-0 pointer-events-none";

  /**
   * Show timeline event history
   */
  const handleShowTimelineHistory = async (event: {
    id?: string;
    summary?: string;
    time?: number | null;
  }) => {
    if (!event.id) {
      toast({
        type: "error",
        description: "Event ID is missing",
      });
      return;
    }

    setIsTimelineHistoryLoading(true);
    setTimelineHistoryDialog({
      open: true,
      eventId: event.id,
      eventName: event.summary || "Unknown Event",
      history: [],
    });

    try {
      const response = await fetch(
        `/api/insights/${normalizedInsight.id}/timeline/${encodeURIComponent(event.id)}`,
      );

      if (!response.ok) {
        throw new Error("Failed to fetch timeline history");
      }

      const data = await response.json();
      setTimelineHistoryDialog((prev) => ({
        ...prev,
        history: data.history || [],
      }));
    } catch (error) {
      console.error("Failed to fetch timeline history:", error);
      toast({
        type: "error",
        description: t(
          "insightDetail.timelineHistory.noHistory",
          "Failed to load event history",
        ),
      });
      setTimelineHistoryDialog((prev) => ({ ...prev, open: false }));
    } finally {
      setIsTimelineHistoryLoading(false);
    }
  };

  return (
    <>
      {/* Background overlay: not needed for embedded mode and mobile, kept for desktop drawer */}
      {!embedInLayout && !isMobile && (
        <div
          className={cn(
            "fixed inset-0 z-40 bg-foreground/25 transition-opacity duration-300 ease-out",
            isOpen
              ? "pointer-events-auto opacity-100"
              : "pointer-events-none opacity-0",
          )}
          onClick={handleClose}
          aria-hidden="true"
        />
      )}
      <div
        role="dialog"
        aria-modal="true"
        data-tour="insight-detail"
        className={`${basePanelClass} ${transformClass}`}
        style={{
          boxSizing: "border-box",
          overflow: "hidden",
          // Mobile fullscreen, no height limit needed
          height: isMobile ? "100vh" : undefined,
          maxHeight: isMobile ? "100vh" : undefined,
        }}
      >
        <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
          {/* Header */}
          <div
            className="p-0 shrink-0"
            style={{
              boxSizing: "border-box",
              width: "100%",
              paddingTop: isMobile
                ? "calc(env(safe-area-inset-top) + 0.75rem)"
                : undefined,
            }}
          >
            <div className="flex flex-col gap-0.5">
              {/* Header in update history state */}
              {showIterationHistory ? (
                <div className="flex items-center justify-between gap-2 px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="shrink-0 size-7"
                      onClick={() => setShowIterationHistory(false)}
                      aria-label={t("common.back", "Back")}
                    >
                      <RemixIcon name="arrow_left_s" size="size-4" />
                    </Button>
                    <h3 className="text-sm font-semibold text-foreground">
                      {t("insightDetail.iterationHistory", "Updates")}
                    </h3>
                  </div>
                  {/* Close button */}
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={handleCloseClick}
                    className="shrink-0 size-7"
                    aria-label={t("tour.common.close", "Close")}
                  >
                    <RemixIcon name="close" size="size-3" />
                  </Button>
                </div>
              ) : (
                <>
                  {/* First row - close button + title on left, action buttons on right */}
                  <div className="flex items-center justify-between gap-2 px-3 py-3 border-b border-border">
                    {/* Left: close button + title (title takes as much remaining width as possible) */}
                    <div className="flex items-center gap-0 min-w-0 flex-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={handleCloseClick}
                        className="shrink-0 size-7"
                        aria-label={t("tour.common.close", "Close")}
                      >
                        <RemixIcon name="arrow_left_s" size="size-4" />
                      </Button>
                      <h1 className="text-sm font-medium text-foreground line-clamp-1 min-w-0 flex-1 truncate">
                        {normalizedInsight.title}
                      </h1>
                    </div>
                    {/* Right: action buttons (Mute, Pin, Refresh, Close) */}
                    <div className="flex items-center gap-1 shrink-0">
                      {/* Favorite button temporarily hidden */}
                      {/* {onFavorite && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={handleFavoriteClick}
                              className={`shrink-0 size-7 ${
                                isFav
                                  ? "text-yellow-600 hover:text-yellow-700"
                                  : "text-gray-500 hover:text-yellow-600"
                              }`}
                              aria-label={
                                isFav
                                  ? t("insight.unfavorite", "Unfavorite")
                                  : t("insight.favorite", "Favorite")
                              }
                            >
                              <Star
                                className={`size-3 ${isFav ? "fill-current" : ""}`}
                              />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>
                              {isFav
                                ? t("insight.unfavorite", "Unfavorite")
                                : t("insight.favorite", "Favorite")}
                            </p>
                          </TooltipContent>
                        </Tooltip>
                      )} */}
                      {/* Mute / unmute button (bell-off), state syncs with isArchived */}
                      {onArchive && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={handleArchiveClick}
                              className={cn(
                                "shrink-0 size-7",
                                normalizedInsight.isArchived
                                  ? "text-primary hover:text-primary/90"
                                  : "text-muted-foreground hover:text-primary",
                              )}
                              aria-label={
                                normalizedInsight.isArchived
                                  ? t("insight.unmute", "Unmute")
                                  : t("insight.mute", "Mute")
                              }
                            >
                              <RemixIcon
                                name="bell_off"
                                size="size-3"
                                filled={!!normalizedInsight.isArchived}
                              />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>
                              {normalizedInsight.isArchived
                                ? t("insight.unmute", "Unmute")
                                : t("insight.mute", "Mute")}
                            </p>
                          </TooltipContent>
                        </Tooltip>
                      )}
                      {/* Pin button - pin to Today Focus */}
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={handlePinClick}
                            className={cn(
                              "shrink-0 size-7",
                              isPinned
                                ? "text-primary hover:text-primary/90"
                                : "text-muted-foreground hover:text-primary",
                            )}
                            aria-label={
                              isPinned
                                ? t("insight.unpin", "Unpin")
                                : t("insight.pin", "Pin to today's focus")
                            }
                          >
                            <RemixIcon
                              name="pushpin"
                              size="size-3"
                              filled={isPinned}
                            />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>
                            {isPinned
                              ? t("insight.unpin", "Unpin")
                              : t("insight.pin", "Pin to today's focus")}
                          </p>
                        </TooltipContent>
                      </Tooltip>
                      {/* Refresh button */}
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={handleRefreshClick}
                            disabled={isRefreshing}
                            className="shrink-0 size-7 text-muted-foreground hover:text-primary"
                            aria-label={t(
                              "insightDetail.refresh.button",
                              "Refresh",
                            )}
                          >
                            {isRefreshing ? (
                              <RemixIcon
                                name="loader_2"
                                size="size-3"
                                className="animate-spin"
                              />
                            ) : (
                              <RemixIcon name="refresh" size="size-3" />
                            )}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>
                            {isRefreshing
                              ? t(
                                  "insightDetail.refresh.refreshing",
                                  "Refreshing...",
                                )
                              : t(
                                  "insightDetail.refresh.tooltip",
                                  "Regenerate this event's content",
                                )}
                          </p>
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Content with sidebar navigation */}
          {!showIterationHistory && (
            <div className="flex flex-1 min-h-0 overflow-hidden">
              {/* Sidebar - fixed height with content area */}
              <div className="hidden sm:flex flex-col w-fit shrink-0 border-r border-border py-3 px-2">
                <InsightDetailSidebar
                  activeTab={detailTab}
                  onTabChange={(tab) => setDetailTab(tab)}
                  platform={normalizedInsight.platform ?? undefined}
                />
              </div>

              {/* Main content area with footer */}
              <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
                {/* Mobile tabs - only shown on mobile */}
                <div className="px-3 sm:hidden pt-3 pb-2 shrink-0 bg-card">
                  <Tabs
                    value={detailTab}
                    onValueChange={(v) =>
                      setDetailTab(
                        v as "digest" | "sources" | "attached" | "files",
                      )
                    }
                    className="w-full"
                  >
                    <TabsList
                      className={cn(
                        "grid w-full",
                        normalizedInsight.platform === "manual"
                          ? "grid-cols-1"
                          : "grid-cols-2",
                      )}
                    >
                      <TabsTrigger
                        value="digest"
                        className="flex items-center gap-2"
                      >
                        <RemixIcon
                          name="refresh"
                          size="size-4"
                          className="shrink-0"
                        />
                        {t("insightDetail.tabDigest", "Digest")}
                      </TabsTrigger>
                      {normalizedInsight.platform !== "manual" && (
                        <TabsTrigger
                          value="sources"
                          className="flex items-center gap-2"
                        >
                          <RemixIcon
                            name="link"
                            size="size-4"
                            className="shrink-0"
                          />
                          {t("insightDetail.tabSources", "Sources")}
                        </TabsTrigger>
                      )}
                    </TabsList>
                  </Tabs>
                </div>

                {/* Sources tab: render directly, no ScrollArea, scrolling controlled internally by InsightDetailSourceInfo */}
                {!showIterationHistory && detailTab === "sources" && (
                  <div
                    className="flex-1 min-h-0 overflow-hidden flex flex-col px-4 sm:px-4 pt-0 pb-0"
                    style={{
                      width: "100%",
                      boxSizing: "border-box",
                      paddingBottom: isMobile
                        ? "calc(env(safe-area-inset-bottom) + 0.75rem)"
                        : undefined,
                    }}
                  >
                    <InsightDetailSourceInfo
                      key={`sources-${normalizedInsight.id}-${drawerOpenCount}`}
                      insight={normalizedInsight}
                      targetSourceDetailIds={targetSourceDetailIds}
                      generateState={generateState}
                      onGenerateStateChange={setGenerateState}
                      onPrependToReplyInput={(name) =>
                        prependToReplyInputRef.current?.(name)
                      }
                    />
                  </div>
                )}

                {/* Other tabs and iteration history: use ScrollArea */}
                {(showIterationHistory || detailTab !== "sources") && (
                  <ScrollArea
                    ref={scrollAreaRef}
                    className="flex-1 min-h-0"
                    style={{ width: "100%" }}
                  >
                    <div
                      className={cn(
                        showIterationHistory
                          ? "p-4 space-y-2 sm:space-y-3"
                          : "p-4 flex flex-col min-h-0 gap-0 justify-start items-start",
                      )}
                      style={{
                        width: "100%",
                        boxSizing: "border-box",
                        paddingBottom: isMobile
                          ? "calc(env(safe-area-inset-bottom) + 1rem)"
                          : undefined,
                      }}
                    >
                      {showIterationHistory ? (
                        <>
                          {normalizedInsight.timeline &&
                          normalizedInsight.timeline.length > 0 ? (
                            <div className="space-y-3">
                              {/* Reverse array: newest events display at the top */}
                              {[...normalizedInsight.timeline]
                                .reverse()
                                .map((item, index) => (
                                  <TimelineEventCard
                                    key={`timeline-${item.id || item.time}-${index}`}
                                    event={{
                                      ...item,
                                      lastUpdatedAt:
                                        item.lastUpdatedAt ??
                                        item.time ??
                                        undefined,
                                    }}
                                    locale={
                                      i18n.language.includes("zh") ? "zh" : "en"
                                    }
                                    showHistory={
                                      (item.changeCount || 0) > 0
                                        ? () => handleShowTimelineHistory(item)
                                        : undefined
                                    }
                                    onActionClick={handleTimelineActionClick}
                                  />
                                ))}
                            </div>
                          ) : (
                            <div className="text-sm text-muted-foreground text-center py-8">
                              {t(
                                "insightDetail.noIterationHistory",
                                "No update records yet",
                              )}
                            </div>
                          )}
                        </>
                      ) : (
                        <>
                          {/* Content area: displays different content based on detailTab */}
                          <div className="flex flex-col min-h-0 w-full">
                            {detailTab === "digest" && (
                              <InsightDetailContext
                                key={`${normalizedInsight.id}-${drawerOpenCount}`}
                                insight={normalizedInsight}
                                timeline={normalizedInsight.timeline}
                                onShowIterationHistory={() =>
                                  setShowIterationHistory(true)
                                }
                                canUnderstand={canUnderstand}
                                isUnderstanding={isUnderstanding}
                                onUnderstand={onUnderstand}
                                onTimelineActionClick={
                                  handleTimelineActionClick
                                }
                              />
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  </ScrollArea>
                )}

                {/* Footer - placed inside main content area, below scroll area */}
                {detailTab === "digest" ? (
                  <div className="pb-0">
                    <InsightDetailFooter
                      key={`footer-${normalizedInsight.id}-${drawerOpenCount}`}
                      insight={normalizedInsight}
                      autoOpenChat={autoOpenChat}
                      onGenerateStateChange={setGenerateState}
                    />
                  </div>
                ) : detailTab === "sources" &&
                  !(shouldHideReplyWorkspace ?? false) ? (
                  <div className="pb-0">
                    <div className="bg-card shrink-0 border-t border-border flex flex-col gap-3 p-4 h-fit">
                      <ReplyWorkspace
                        insight={normalizedInsight}
                        initialExpanded={false}
                        onGenerateStateChange={setGenerateState}
                        registerPrependToReplyInput={(fn) => {
                          prependToReplyInputRef.current = fn;
                        }}
                      />
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Timeline history dialog */}
      <Suspense
        fallback={
          <div className="fixed inset-0 z-[70] flex items-center justify-center bg-background/80">
            <RemixIcon
              name="loader_2"
              size="size-8"
              className="animate-spin text-primary"
            />
          </div>
        }
      >
        <TimelineHistoryDialog
          open={timelineHistoryDialog.open}
          onClose={() =>
            setTimelineHistoryDialog((prev) => ({ ...prev, open: false }))
          }
          eventId={timelineHistoryDialog.eventId}
          eventName={timelineHistoryDialog.eventName}
          history={timelineHistoryDialog.history}
          isLoading={isTimelineHistoryLoading}
        />
      </Suspense>

      {/* Mute confirmation before proceeding */}
      <AlertDialog open={isMuteConfirmOpen} onOpenChange={setIsMuteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("insight.muteConfirmTitle", "Confirm mute?")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                "insight.muteConfirmDescription",
                "After muting, this event will no longer appear in Today's Focus.",
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {t("insight.muteConfirmCancel", "Cancel")}
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleMuteConfirm}>
              {t("insight.muteConfirmComplete", "Confirm mute")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Secondary confirmation before removing from Today Focus */}
      <AlertDialog
        open={isUnpinConfirmOpen}
        onOpenChange={setIsUnpinConfirmOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t(
                "insight.unpinConfirmTitle",
                "Remove this event from today's focus?",
              )}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                "insight.unpinConfirmDescription",
                "After removing, this event will no longer appear in Today's Focus list, you can pin it again anytime.",
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {t("insight.muteConfirmCancel", "Cancel")}
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleUnpinConfirm}>
              {t("insight.unpin", "Unpin")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// Extract the first URL from Insight (optimized: early return and precompiled regex)
