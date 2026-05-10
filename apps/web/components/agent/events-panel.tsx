"use client";

import { InsightCard } from "@/components/insight-card";
import type { Insight } from "@/lib/db/schema";
import { RemixIcon } from "@/components/remix-icon";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  lazy,
  Suspense,
} from "react";
import { useTranslation } from "react-i18next";
import "../../i18n";
import { AvatarState, getAvatarConfigByState } from "@/components/agent-avatar";

const InsightTabsDialogLazy = lazy(() =>
  import("./insight-tabs-dialog").then((mod) => ({
    default: mod.InsightTabsDialog,
  })),
);

const ANALYTICS_TAB_VALUE = "analytics";

import { useChatContext } from "@/components/chat-context";
import {
  GoogleAuthForm,
  type GoogleAuthSubmission,
} from "@/components/google-auth";
import { IMessageAuthForm } from "@/components/imessage-auth-form";
import { FeishuAuthForm } from "@/components/feishu-auth-form";
import InsightDetailDrawer from "@/components/insight-detail-drawer";
import { Spinner } from "@/components/spinner";
import {
  MessengerAuthForm,
  type MessengerAuthSubmission,
} from "@/components/messenger-auth-form";
import {
  OutlookAuthForm,
  type OutlookAuthSubmission,
} from "@/components/outlook-auth";
import { TelegramTokenForm } from "@/components/telegram-token-form";
import { Button } from "@alloomi/ui";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@alloomi/ui";
import { toast } from "@/components/toast";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@alloomi/ui";
import { HorizontalScrollContainer } from "@alloomi/ui";
import {
  WhatsAppAuthForm,
  type WhatsAppUserInfo,
} from "@/components/whatsapp-auth";
import { useInsightOptimisticUpdates } from "@/components/insight-optimistic-context";
import { useEventsData } from "@/hooks/use-events-data";
import { useInsightActions } from "@/hooks/use-insight-actions";
import { useInsightAvatar } from "@/hooks/use-insight-avatar";
import { useInsightRefresh } from "@/hooks/use-insight-refresh";
import { useInsightTabs } from "@/hooks/use-insight-tabs";
import { useInsightUnread } from "@/hooks/use-insight-unread";
import { useInsightWeights } from "@/hooks/use-insight-weights";
import { useIntegrations } from "@/hooks/use-integrations";
import type { IntegrationId } from "@/hooks/use-integrations";
import { useIsMobile } from "@alloomi/hooks/use-is-mobile";
import { AppError } from "@alloomi/shared/errors";
import { sortInsightsByEventRank } from "@/lib/insights/event-rank";
import { insightMatchesFilter } from "@/lib/insights/filter-utils";
import {
  insightIsImport,
  insightIsUrgent,
} from "@/lib/insights/focus-classifier";
import { createIntegrationAccount } from "@/lib/integrations/client";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import { useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import { CombinedFilterButton } from "./combined-filter-button";
import type { QuickFilterValue, ViewOptionValue } from "./events-panel-types";
import { InsightAnalyticsPanel } from "./insight-analytics-panel";
import {
  deduplicateInsights,
  filterEmptyInsights,
  getInsightTime,
  groupInsightsByDay,
  hasOverdueTasks,
  hasTaskDueToday,
  safeLocalStorageSetItem,
  timeFilterToDays,
} from "./events-panel-utils";
import {
  InsightEmptyState,
  InsightRefreshingState,
} from "./insight-empty-state";
import { AgentSectionHeader } from "./section-header";
import { useLocalStorage } from "@alloomi/hooks/use-local-storage";

/**
 * Event panel component for Agent workspace
 * Contains all functions of the event bar, but does not include conversation functionality
 */
export function AgentEventsPanel({
  hideHeader = false,
  category,
  embedInCard = false,
  /** Selected event passed by page (e.g., opened via URL insightDetailId), embedded in middle card on desktop */
  externalSelectedInsight = null,
  /** Callback when page-passed selected event is closed (to sync clear URL with page state) */
  onExternalInsightClose,
}: {
  hideHeader?: boolean;
  category?: string;
  /** When true, outer layer (e.g., AgentLayout middle area) provides card style, this component doesn't wrap another card to avoid double nesting */
  embedInCard?: boolean;
  externalSelectedInsight?: Insight | null;
  onExternalInsightClose?: () => void;
} = {}) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data } = useSession();

  // Global optimistic update management
  const { getInsightFavorite } = useInsightOptimisticUpdates();
  const { focusedInsights, toggleFocusedInsight } = useChatContext();

  const isMobile = useIsMobile();
  // Ensure translation is only used after client mount to avoid hydration errors
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  // User authentication info processing
  const { accounts, groupedByIntegration, mutate } = useIntegrations();
  const [showTelegramTokenForm, setShowTelegramTokenForm] = useState(false);
  const showTelegramTokenFormHandler = useCallback(() => {
    setShowTelegramTokenForm(true);
  }, []);

  // Add platform dialog related state
  const [isAddPlatformDialogOpen, setIsAddPlatformDialogOpen] = useState(false);
  const [linkingPlatform, setLinkingPlatform] = useState<IntegrationId | null>(
    null,
  );
  const [isGoogleAuthFormOpen, setIsGoogleAuthFormOpen] = useState(false);
  const [isWhatsAppAuthFormOpen, setIsWhatsAppAuthFormOpen] = useState(false);
  const [isOutlookAuthFormOpen, setIsOutlookAuthFormOpen] = useState(false);
  const [isMessengerAuthFormOpen, setIsMessengerAuthFormOpen] = useState(false);
  const [isIMessageAuthFormOpen, setIsIMessageAuthFormOpen] = useState(false);
  const [isFeishuAuthFormOpen, setIsFeishuAuthFormOpen] = useState(false);

  // Tab management dialog state
  const [isTabsDialogOpen, setIsTabsDialogOpen] = useState(false);

  // More menu state
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);

  // Tabs management
  const { tabs, isLoaded: isTabsLoaded } = useInsightTabs();

  // Get enabled tabs (exclude system tabs)
  const enabledTabs = useMemo(() => {
    return tabs.filter(
      (tab) =>
        tab.type !== "system" && tab.id !== "preset:focus" && tab.enabled,
    );
  }, [tabs]);

  /**
   * Handle Gmail authorization submission
   */
  const handleGoogleSubmit = useCallback(
    async ({ email, appPassword, name }: GoogleAuthSubmission) => {
      await createIntegrationAccount({
        platform: "gmail",
        externalId: email,
        displayName: name ?? email,
        credentials: {
          email,
          appPassword,
        },
        metadata: {
          email,
          name: name ?? email,
        },
        bot: {
          name: `Gmail · ${name ?? email}`,
          description: "Automatically created through Gmail authorization",
          adapter: "gmail",
          enable: true,
        },
      });

      router.refresh();
      await mutate();
      setIsGoogleAuthFormOpen(false);
    },
    [router, mutate],
  );

  const handleOutlookSubmit = useCallback(
    async ({ email, appPassword, name }: OutlookAuthSubmission) => {
      try {
        await createIntegrationAccount({
          platform: "outlook",
          externalId: email,
          displayName: name ?? email,
          credentials: {
            email,
            appPassword,
          },
          metadata: {
            email,
            name: name ?? email,
          },
          bot: {
            name: `Outlook · ${name ?? email}`,
            description: "Automatically created through Outlook authorization",
            adapter: "outlook",
            enable: true,
            adapterConfig: {
              IMAP_HOST: "outlook.office365.com",
              IMAP_PORT: 993,
              SMTP_HOST: "smtp.office365.com",
              SMTP_PORT: 587,
            },
          },
        });

        router.refresh();
        await mutate();
        setIsOutlookAuthFormOpen(false);
      } finally {
        setIsOutlookAuthFormOpen(false);
      }
    },
    [router, mutate],
  );

  // Optimization 2: cache fetcher function to avoid recreation on every render
  const fetcher = useCallback(async (url: string) => {
    const res = await fetch(url);
    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      throw new AppError(
        error.type ?? "unknown",
        error.message ?? "Failed to fetch",
      );
    }
    return res.json();
  }, []);

  /**
   * Handle WhatsApp authorization success
   */
  const handleWhatsAppSuccess = useCallback(
    async (sessionKey: string, user: WhatsAppUserInfo) => {
      const account = await createIntegrationAccount({
        platform: "whatsapp",
        externalId: user.wid ?? sessionKey,
        displayName:
          user.pushName ?? user.formattedNumber ?? user.wid ?? "WhatsApp",
        credentials: {
          sessionKey, // Only store the session key, user info is in metadata
        },
        metadata: {
          wid: user.wid,
          pushName: user.pushName ?? null,
          formattedNumber: user.formattedNumber ?? null,
        },
        bot: {
          name: `WhatsApp · ${user.pushName ?? user.formattedNumber ?? user.wid ?? sessionKey}`,
          description: "Automatically created through WhatsApp authorization",
          adapter: "whatsapp",
          enable: true,
        },
      });

      router.refresh();
      await mutate();
      setIsWhatsAppAuthFormOpen(false);
    },
    [router, mutate],
  );

  const handleMessengerSubmit = useCallback(
    async ({
      pageId,
      pageAccessToken,
      pageName,
      appId,
      appSecret,
      verifyToken,
    }: MessengerAuthSubmission) => {
      const account = await createIntegrationAccount({
        platform: "facebook_messenger",
        externalId: pageId,
        displayName: pageName ?? `Messenger · ${pageId}`,
        credentials: {
          pageId,
          pageAccessToken,
          pageName,
          appId,
          appSecret,
          verifyToken,
        },
        metadata: {
          pageId,
          pageName: pageName ?? null,
          appId: appId ?? null,
          appSecret: appSecret ?? null,
          verifyToken: verifyToken ?? null,
        },
        bot: {
          name: `Messenger · ${pageName ?? pageId}`,
          description:
            "Automatically created through Facebook Messenger authorization",
          adapter: "facebook_messenger",
          adapterConfig: { pageId },
          enable: true,
        },
      });

      router.refresh();
      await mutate();
      setIsMessengerAuthFormOpen(false);
    },
    [router, mutate],
  );

  const myNicknames = useMemo(() => {
    const names = new Set<string>();

    const append = (value: unknown) => {
      if (typeof value === "string") {
        const trimmed = value.trim();
        if (trimmed.length > 0) {
          names.add(trimmed);
        }
      }
    };

    append(data?.user?.name);
    append(data?.user?.email);

    for (const account of accounts) {
      append(account.displayName);
      const meta = account.metadata ?? {};
      append((meta as Record<string, unknown>).userName);
      append((meta as Record<string, unknown>).user);
      append((meta as Record<string, unknown>).email);

      const firstName = (meta as Record<string, unknown>).firstName;
      const lastName = (meta as Record<string, unknown>).lastName;
      if (typeof firstName === "string" || typeof lastName === "string") {
        append(
          `${typeof firstName === "string" ? firstName : ""} ${
            typeof lastName === "string" ? lastName : ""
          }`,
        );
      }
    }

    return Array.from(names);
  }, [accounts, data?.user?.email, data?.user?.name]);

  const insightHasMyNickname = useCallback(
    (insight: Insight) => {
      if (
        !insight.people ||
        insight.people.length === 0 ||
        myNicknames.length === 0
      ) {
        return false;
      }

      const nicknameSet = new Set(
        myNicknames.map((nick) => nick.toLowerCase()),
      );
      return insight.people.some((person: string) =>
        nicknameSet.has(person.toLowerCase()),
      );
    },
    [myNicknames],
  );

  const { data: insightPreferences } = useSWR<{
    focusPeople?: string[];
  } | null>(data?.user ? "/api/preferences/insight" : null, fetcher);

  // Get user category list
  const { data: categoriesData } = useSWR<{
    categories: Array<{
      id: string;
      name: string;
      isActive: boolean;
      sortOrder: number;
    }>;
  }>(data?.user ? "/api/categories" : null, fetcher, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    dedupingInterval: 60000,
  });

  /**
   * Get enabled category name list (maintain sortOrder order)
   * Use JSON.stringify comparison to avoid unnecessary recalculation
   */
  const activeCategoryNames = useMemo(() => {
    if (!categoriesData?.categories) {
      return [];
    }
    return categoriesData.categories
      .filter((cat) => cat.isActive)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((cat) => cat.name);
  }, [categoriesData]);

  /**
   * Set of active category names for fast lookup (case-insensitive)
   * Use JSON.stringify comparison to avoid unnecessary recalculation
   */
  const activeCategoryNamesLower = useMemo(() => {
    return new Set(activeCategoryNames.map((name) => name.toLowerCase()));
  }, [JSON.stringify(activeCategoryNames)]);

  const focusPeople = useMemo(
    () => insightPreferences?.focusPeople ?? [],
    [insightPreferences],
  );

  const filterContext = useMemo(
    () => ({ myNicknames, focusPeople }),
    [myNicknames, focusPeople],
  );

  // Component state and basic functionality
  // Read last selected tab from localStorage, only timeline: all or custom tab id, default to "all"
  const [selectedValue, setSelectedValue] = useLocalStorage<ViewOptionValue>(
    "alloomi_selectedTab",
    "all",
  );

  // Sub-tab state (All / custom tab under timeline)
  const [subTab, setSubTab] = useState<ViewOptionValue>(() => {
    if (selectedValue === "all") return "all";
    if (selectedValue === "other") return "all";
    return "all";
  });
  const [selectedInsight, setSelectedInsight] = useState<Insight | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [quickFilter, setQuickFilter] = useState<QuickFilterValue>("all");
  const [isHeaderScrolled, setIsHeaderScrolled] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  // Timeline read/unread filter state
  const [sharedReadStatus, setSharedReadStatus] = useLocalStorage<
    "unread" | "read" | "all"
  >("alloomi_focusReadStatus", "all");

  // Timeline time filter state
  const [sharedTimeFilter, setSharedTimeFilter] = useLocalStorage<
    "all" | "24h" | "today"
  >("alloomi_focusTimeFilter", "today");

  const allReadStatus = sharedReadStatus;
  const allTimeFilter = sharedTimeFilter;

  // View archive mode state
  const [isViewingArchived, setIsViewingArchived] = useState(false);

  // Use extracted hooks
  const { insightIsUnread } = useInsightUnread();
  const { assistantName } = useInsightAvatar();

  // Open drawer when insight is selected
  useEffect(() => {
    setIsDrawerOpen(!!selectedInsight);
  }, [selectedInsight]);

  const preferenceStorageKey = useMemo(() => {
    const userId = data?.user?.id ?? data?.user?.email ?? "guest";
    return `alloomi:insight:prefs:${userId}`;
  }, [data?.user?.email, data?.user?.id]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const payload = JSON.stringify({
      view: selectedValue,
      filter: quickFilter,
    });
    safeLocalStorageSetItem(preferenceStorageKey, payload);
  }, [preferenceStorageKey, quickFilter, selectedValue]);

  useEffect(() => {
    const node = scrollContainerRef.current;
    if (!node) return;
    const updateScrollState = () => {
      setIsHeaderScrolled(node.scrollTop > 12);
    };
    updateScrollState();
    node.addEventListener("scroll", updateScrollState, { passive: true });
    return () => node.removeEventListener("scroll", updateScrollState);
  }, []);

  useEffect(() => {
    const node = scrollContainerRef.current;
    if (!node) return;
    setIsHeaderScrolled(node.scrollTop > 12);
  }, [selectedValue, quickFilter]);

  const insightIsImportCallback = useCallback(insightIsImport, []);
  const insightIsUrgentCallback = useCallback(insightIsUrgent, []);

  const insightGetActions = useCallback(
    (insight: Insight): Array<{ id?: string; title?: string }> => {
      const buckets = [
        insight.waitingForMe,
        insight.myTasks,
        insight.waitingForOthers,
      ];

      const deduped = new Map<string, { id?: string; title?: string }>();
      for (const bucket of buckets) {
        if (!Array.isArray(bucket)) {
          continue;
        }
        for (const task of bucket) {
          if (!task) continue;
          const key =
            task.id ??
            JSON.stringify({
              title: task.title ?? null,
            });
          if (!deduped.has(key)) {
            deduped.set(key, {
              id: task.id ?? undefined,
              title: task.title ?? undefined,
            });
          }
        }
      }

      return Array.from(deduped.values());
    },
    [],
  );

  // Calculate days parameter for current tab's time filter
  // All tabs share the same time filter state
  const currentDays = useMemo(() => {
    return timeFilterToDays(allTimeFilter);
  }, [allTimeFilter]);

  // Use independent events data management hook
  const {
    mutateEventsList,
    eventsData,
    progress: refreshProgress,
    hasReachedEnd,
    incrementSize,
  } = useEventsData(currentDays);

  // For backward compatibility, rename variables
  const mutateInsightList = mutateEventsList;
  const insightData = eventsData;

  // Use extracted action hooks (need to be after mutateInsightList and selectedInsight definitions)
  const {
    handleFavoriteInsight,
    handleArchiveInsight,
    handleDeleteInsight,
    handleUnderstandInsight,
    deleteInsight,
    isDeleteDialogOpen,
    setIsDeleteDialogOpen,
    isDeleting,
    understandingInsightId,
  } = useInsightActions(
    mutateInsightList,
    selectedInsight,
    setSelectedInsight,
    () => {}, // No longer need drawer close callback
  );

  /**
   * Handle toggling focus Insight (supports multiple)
   */
  const handleToggleFocus = useCallback(
    (insight: Insight) => {
      toggleFocusedInsight(insight);
    },
    [toggleFocusedInsight],
  );

  /**
   * Get categories array of insight
   */
  const getInsightCategories = useCallback((insight: Insight): string[] => {
    const raw = insight.categories;
    if (Array.isArray(raw)) return raw;
    if (typeof raw === "string") {
      try {
        return JSON.parse(raw || "[]");
      } catch {
        return [];
      }
    }
    return [];
  }, []);

  /**
   * Check if insight is pinned (via keep-focused in categories)
   */
  const isInsightPinned = useCallback(
    (insight: Insight): boolean => {
      const categories = getInsightCategories(insight);
      return categories.includes("keep-focused");
    },
    [getInsightCategories],
  );

  /**
   * Pin insight to today's focus (call API and trigger event)
   */
  const handlePinInsight = useCallback(
    async (insight: Insight) => {
      const insightId = insight.id;
      const originalCategories = getInsightCategories(insight);
      const newCategories = [...originalCategories, "keep-focused"];

      try {
        const response = await fetch(`/api/insights/${insightId}/pin`, {
          method: "POST",
        });
        if (!response.ok) {
          throw new Error(t("insight.pinFailed", "Pin failed"));
        }

        // Optimistic update: update local insight data
        const updatedInsight = {
          ...insight,
          categories: newCategories,
        };
        mutateEventsList((currentData) => {
          if (!currentData) return currentData;
          return currentData.map((data) => ({
            ...data,
            items: data.items.map((item: Insight) =>
              item.id === insightId ? updatedInsight : item,
            ),
          }));
        }, false);

        toast({
          type: "success",
          description: t("insight.pinned", "Pinned to today's focus"),
        });

        // Trigger event to notify brief panel to refresh status (optimistic update)
        window.dispatchEvent(
          new CustomEvent("insightPinStatusChanged", {
            detail: { insightId, isPinned: true },
          }),
        );
        // Trigger event to force refresh list
        window.dispatchEvent(
          new CustomEvent("insightListRefresh", {
            detail: { insightId, isPinned: true },
          }),
        );
        // Trigger brief panel refresh
        window.dispatchEvent(new CustomEvent("brief:refresh"));
      } catch (error) {
        console.error("[handlePinInsight] Error:", error);
        toast({
          type: "error",
          description:
            error instanceof Error
              ? error.message
              : t("insight.pinFailed", "Pin failed"),
        });
      }
    },
    [getInsightCategories, mutateEventsList, t],
  );

  /**
   * Remove insight from today's focus (call API and trigger event)
   */
  const handleUnpinInsight = useCallback(
    async (insight: Insight) => {
      const insightId = insight.id;
      const originalCategories = getInsightCategories(insight);
      const newCategories = originalCategories.filter(
        (c: string) => c !== "keep-focused",
      );

      try {
        const response = await fetch(`/api/insights/${insightId}/pin`, {
          method: "DELETE",
        });
        if (!response.ok) {
          throw new Error(t("insight.unpinFailed", "Unpin failed"));
        }

        // Optimistic update: update local insight data
        const updatedInsight = {
          ...insight,
          categories: newCategories,
        };
        mutateEventsList((currentData) => {
          if (!currentData) return currentData;
          return currentData.map((data) => ({
            ...data,
            items: data.items.map((item: Insight) =>
              item.id === insightId ? updatedInsight : item,
            ),
          }));
        }, false);

        toast({
          type: "success",
          description: t("insight.unpinned", "Removed from today's focus"),
        });

        // Trigger event to notify brief panel to refresh status (optimistic update)
        window.dispatchEvent(
          new CustomEvent("insightPinStatusChanged", {
            detail: { insightId, isPinned: false },
          }),
        );
        // Trigger brief panel refresh
        window.dispatchEvent(new CustomEvent("brief:refresh"));
      } catch (error) {
        console.error("[handleUnpinInsight] Error:", error);
        toast({
          type: "error",
          description:
            error instanceof Error
              ? error.message
              : t("insight.unpinFailed", "Unpin failed"),
        });
      }
    },
    [getInsightCategories, mutateEventsList, t],
  );

  /**
   * Handle pin/unpin button click
   */
  const handlePinToggle = useCallback(
    async (insight: Insight) => {
      const pinned = isInsightPinned(insight);
      if (pinned) {
        await handleUnpinInsight(insight);
      } else {
        await handlePinInsight(insight);
      }
    },
    [isInsightPinned, handlePinInsight, handleUnpinInsight],
  );

  /**
   * Calculate total message count of bots currently fetching messages
   */
  const totalFetchingMsgCount = useMemo(() => {
    if (!insightData?.sessions) return 0;
    const total = insightData.sessions.reduce(
      (sum, session) => sum + (session.msgCount ?? 0),
      0,
    );
    return total;
  }, [insightData?.sessions]);

  // Process summary data (consistent with Brief panel)
  const uniqueInsights = useMemo(() => {
    const items = insightData.items || [];
    // First deduplicate by id, then by title (consistent with Brief panel)
    const deduplicatedById = deduplicateInsights(items, "id");
    const deduplicatedByTitle = deduplicateInsights(deduplicatedById, "title");
    // Filter out empty insights (insights without substantial content)
    return filterEmptyInsights(deduplicatedByTitle);
  }, [insightData.items]);

  // Listen to URL parameters to restore drawer (use ref to avoid closure issues)
  const selectedInsightRef = useRef(selectedInsight);
  useEffect(() => {
    selectedInsightRef.current = selectedInsight;
  }, [selectedInsight]);

  /**
   * Filter insights only by archive mode (for calculating category statistics)
   */
  const archivedFilteredInsights = useMemo(() => {
    const insights = [...uniqueInsights];
    let filtered = insights;

    // First filter by archive mode
    if (isViewingArchived) {
      // Archive mode: only show archived insights (using database field)
      filtered = filtered.filter((insight) => insight.isArchived === true);
    } else {
      // Normal mode: only show unarchived insights (using database field)
      filtered = filtered.filter((insight) => !insight.isArchived);
    }

    return filtered;
  }, [uniqueInsights, isViewingArchived]);

  /**
   * Filter insights by archive mode and category parameter
   * @param insight - Insight object
   * @param category - Category name
   * @param activeCategoryNamesLower - Set of active category names
   * @returns Whether it meets category condition
   */
  const categoryMatches = useCallback(
    (
      insight: Insight,
      category: string | undefined,
      activeCategoryNamesLower: Set<string>,
    ): boolean => {
      if (!category) return true;

      const categoryLower = category.toLowerCase();
      if (categoryLower === "all") {
        return true;
      }

      const categories = insight.categories ?? [];
      if (categories.length === 0) {
        return false;
      }

      if (categoryLower === "other") {
        // "Other" category: show insights without category or categories not in active category list
        const hasActiveCategory = categories.some((cat) =>
          activeCategoryNamesLower.has(cat.toLowerCase()),
        );
        return !hasActiveCategory;
      }

      // Other categories: show insights containing this category
      return categories.some((cat) => cat.toLowerCase() === categoryLower);
    },
    [],
  );

  /**
   * Base insights list
   * Filtered by archive mode and category parameter
   */
  const baseInsights = useMemo(() => {
    const insights = [...archivedFilteredInsights];
    let filtered = insights;

    // If category parameter is specified, further filter to insights containing this category
    if (category) {
      filtered = filtered.filter((insight) =>
        categoryMatches(insight, category, activeCategoryNamesLower),
      );
    }

    return filtered;
  }, [
    archivedFilteredInsights,
    category,
    activeCategoryNamesLower,
    categoryMatches,
  ]);

  // Get weight data (supports features like favorite increases weight)
  const insightIds = useMemo(
    () => baseInsights.map((i) => i.id),
    [baseInsights],
  );
  const { weightMultipliers, lastViewedAtMap } = useInsightWeights(insightIds);

  const sortedInsights = useMemo(() => {
    // Use EventRank algorithm for sorting
    const result = sortInsightsByEventRank(baseInsights, {
      weightMultipliers, // Pass weight data, favorited insights get higher priority
      lastViewedAtMap, // Pass last viewed time for gradual decay (auto downgrade after 24h inactivity)
    });
    return result.sorted;
  }, [baseInsights, weightMultipliers, lastViewedAtMap]);

  /**
   * Check if it's first entry (no Insight events)
   * Condition: not in archive mode and baseInsights is empty
   */
  const isFirstLanding = useMemo(() => {
    return !isViewingArchived && baseInsights.length === 0;
  }, [isViewingArchived, baseInsights.length]);

  const { isRefreshing, refreshStatus, refreshError, handleRefresh } =
    useInsightRefresh(assistantName, isFirstLanding);

  // When authentication error is detected, automatically open the corresponding connection panel
  useEffect(() => {
    if (refreshError?.actionType === "telegram_reconnect") {
      setShowTelegramTokenForm(true);
    } else if (refreshError?.actionType === "slack_reconnect") {
      setIsAddPlatformDialogOpen(true);
      setLinkingPlatform("slack");
    } else if (refreshError?.actionType === "discord_reconnect") {
      setIsAddPlatformDialogOpen(true);
      setLinkingPlatform("discord");
    }
  }, [refreshError?.actionType]);

  // Listen to account authorization success event and trigger refresh
  useEffect(() => {
    const handleAccountAuthorized = () => {
      handleRefresh();
    };

    window.addEventListener(
      "integration:accountAuthorized",
      handleAccountAuthorized,
    );
    return () => {
      window.removeEventListener(
        "integration:accountAuthorized",
        handleAccountAuthorized,
      );
    };
  }, [handleRefresh]);

  // Dynamically get avatar config based on refresh status
  const avatarConfig = useMemo(() => {
    return getAvatarConfigByState(
      isRefreshing ? AvatarState.REFRESHING : AvatarState.DEFAULT,
    );
  }, [isRefreshing]);

  /**
   * Filter insights by time filter condition (aligned with BriefPanel logic)
   * @param insight - Insight object
   * @param timeFilter - Time filter type: all (all), 24h (within 24h), today (today only)
   * @returns Whether it meets time filter condition
   *
   * Filter logic (consistent with BriefPanel):
   * - today: show insights related to today (generated today/have today tasks/have uncompleted tasks/have nextActions)
   * - 24h: show insights related to 24h (generated within 24h/have tasks within 24h/have uncompleted tasks/have nextActions)
   */
  const filterByTime = useCallback(
    (insight: Insight, timeFilter: "all" | "24h" | "today"): boolean => {
      if (timeFilter === "all") {
        return true;
      }

      const insightTime = getInsightTime(insight);
      const now = new Date();
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      if (timeFilter === "24h") {
        // 24h reference time: 24 hours before current time
        const hours24Ago = new Date(now.getTime() - 24 * 60 * 60 * 1000);

        // Condition 1: insights generated within 24h
        const isGeneratedIn24h = insightTime >= hours24Ago;

        // Condition 2: has tasks due within 24h
        const hasDueIn24hResult = hasTaskDueToday(insight, hours24Ago);
        const hasDueIn24h = hasDueIn24hResult === true;

        // Condition 3: has overdue uncompleted tasks
        const hasOverdueResult = hasOverdueTasks(insight, today);
        const hasOverdue = hasOverdueResult === true;

        // Condition 4: check if there are any tasks (including completed)
        const hasAnyTasks = [
          insight.myTasks,
          insight.waitingForMe,
          insight.waitingForOthers,
        ].some((tasks) => {
          if (!tasks || tasks.length === 0) return false;
          return tasks.length > 0;
        });

        // Condition 5: has nextActions
        const hasNextActions =
          insight.nextActions && insight.nextActions.length > 0;

        // Display if any condition is met (OR short-circuit evaluation)
        return (
          isGeneratedIn24h ||
          hasDueIn24h ||
          hasOverdue ||
          hasAnyTasks ||
          hasNextActions ||
          false
        );
      }

      if (timeFilter === "today") {
        // Condition 1: insights generated today
        const isGeneratedToday = insightTime >= today;

        // Condition 2: has tasks due today
        const hasDueTodayResult = hasTaskDueToday(insight, today);
        const hasDueToday = hasDueTodayResult === true;

        // Condition 3: has overdue uncompleted tasks
        const hasOverdueResult = hasOverdueTasks(insight, today);
        const hasOverdue = hasOverdueResult === true;

        // Condition 4: check if there are any tasks (including completed)
        const hasAnyTasks = [
          insight.myTasks,
          insight.waitingForMe,
          insight.waitingForOthers,
        ].some((tasks) => {
          if (!tasks || tasks.length === 0) return false;
          return tasks.length > 0;
        });

        // Condition 5: has nextActions
        const hasNextActions =
          insight.nextActions && insight.nextActions.length > 0;

        // Display if any condition is met (OR short-circuit evaluation)
        return (
          isGeneratedToday ||
          hasDueToday ||
          hasOverdue ||
          hasAnyTasks ||
          hasNextActions ||
          false
        );
      }

      return true;
    },
    [],
  );

  /**
   * Check if insight is contained in any enabled custom Tab (for "Other" group)
   */
  const isInsightInAnyTabExceptOther = useCallback(
    (insight: Insight): boolean => {
      for (const tab of enabledTabs) {
        if (insightMatchesFilter(insight, tab.filter, filterContext)) {
          return true;
        }
      }
      return false;
    },
    [enabledTabs, insightMatchesFilter, filterContext],
  );

  /**
   * Filter insights not in any group by read/unread status and time filter
   */
  const filteredOtherInsights = useMemo(() => {
    // Filter insights not in any group
    const baseOther = sortedInsights.filter(
      (insight) => !isInsightInAnyTabExceptOther(insight),
    );

    // First apply time filter (using all tab's filter state)
    let filteredByTime = baseOther;
    if (allTimeFilter !== "all") {
      filteredByTime = baseOther.filter((insight) =>
        filterByTime(insight, allTimeFilter),
      );
    }

    // Apply read/unread filter (using all tab's filter state)
    let filteredByReadStatus = filteredByTime;
    if (allReadStatus !== "all") {
      filteredByReadStatus = filteredByTime.filter((insight) => {
        const isUnread = insightIsUnread(insight.id);
        if (allReadStatus === "unread") {
          return isUnread;
        }
        return !isUnread;
      });
    }

    return filteredByReadStatus;
  }, [
    sortedInsights,
    isInsightInAnyTabExceptOther,
    allReadStatus,
    allTimeFilter,
    insightIsUnread,
    filterByTime,
  ]);

  /**
   * Filter insights by custom tab filter rules and filter conditions
   * Includes time filter, read/unread filter and quick filter tags
   */
  const getFilteredTabInsights = useCallback(
    (tabId: string) => {
      const tab = tabs.find((t) => t.id === tabId);
      if (!tab) return [];

      // 1. Apply tab's filter rules
      const baseFiltered = baseInsights.filter((insight) =>
        insightMatchesFilter(insight, tab.filter, filterContext),
      );

      // 2. Apply time filter (all tabs share the same time filter state)
      let filteredByTime = baseFiltered;
      if (allTimeFilter !== "all") {
        filteredByTime = baseFiltered.filter((insight) =>
          filterByTime(insight, allTimeFilter),
        );
      }

      // 3. Apply read/unread filter
      const readStatus = "all";
      let filteredByReadStatus = filteredByTime;
      if (readStatus !== "all") {
        filteredByReadStatus = filteredByTime.filter((insight) => {
          const isUnread = insightIsUnread(insight.id);
          return readStatus === "unread" ? isUnread : !isUnread;
        });
      }

      return filteredByReadStatus;
    },
    [
      tabs,
      baseInsights,
      allTimeFilter,
      insightIsUnread,
      insightIsImportCallback,
      insightIsUrgentCallback,
      insightHasMyNickname,
      insightGetActions,
      filterContext,
      filterByTime,
    ],
  );

  /**
   * Calculate all timeline insights (for "all" option)
   * Includes all baseInsights (because All should display everything)
   * Apply All tab's time filter and read/unread filter
   */
  const allTimelineInsights = useMemo(() => {
    // Use baseInsights directly (already filtered by archive mode and category)
    const allInsights = baseInsights;

    // Apply All tab's time filter
    let filteredByTime = allInsights;
    if (allTimeFilter !== "all") {
      filteredByTime = allInsights.filter((insight) =>
        filterByTime(insight, allTimeFilter),
      );
    }

    // Apply All tab's read/unread filter
    let filteredByReadStatus = filteredByTime;
    if (allReadStatus !== "all") {
      filteredByReadStatus = filteredByTime.filter((insight) => {
        const isUnread = insightIsUnread(insight.id);
        if (allReadStatus === "unread") {
          return isUnread;
        }
        return !isUnread;
      });
    }

    // Sort by time
    return filteredByReadStatus.sort((a, b) => {
      const timeA = getInsightTime(a).getTime();
      const timeB = getInsightTime(b).getTime();
      return timeB - timeA;
    });
  }, [
    baseInsights,
    allTimeFilter,
    allReadStatus,
    insightIsUnread,
    filterByTime,
  ]);

  /**
   * Group all timeline insights by date
   */
  const allTimelineGroupedInsights = useMemo(
    () => groupInsightsByDay(allTimelineInsights, i18n.language),
    [allTimelineInsights, i18n.language],
  );

  /**
   * Calculate category statistics (for sync to AppSidebar)
   * Count insights in each category (applied archive, time, read/unread filters)
   * Each insight is only counted in one category (first matching active category)
   * Insights not in any active category go to Other
   * Ensure: each category count + Other count = All count
   */
  const categoryStats = useMemo(() => {
    // First apply time filter (using timeline shared filter)
    let filteredByTime = archivedFilteredInsights;
    if (allTimeFilter !== "all") {
      filteredByTime = archivedFilteredInsights.filter((insight) =>
        filterByTime(insight, allTimeFilter),
      );
    }

    // Then apply read/unread filter
    let filteredByReadStatus = filteredByTime;
    if (allReadStatus !== "all") {
      filteredByReadStatus = filteredByTime.filter((insight) => {
        const isUnread = insightIsUnread(insight.id);
        if (allReadStatus === "unread") {
          return isUnread;
        }
        return !isUnread;
      });
    }

    // Calculate count for each category
    const counts: Record<string, number> = {
      all: filteredByReadStatus.length,
      Other: 0,
    };

    // Count insights for each category
    // Each insight is only counted in one category (first matching in active category list order)
    for (const insight of filteredByReadStatus) {
      const categories = insight.categories ?? [];

      // If no category, count to "Other"
      if (categories.length === 0) {
        counts.Other = counts.Other + 1;
        continue;
      }

      // Find first matching category by active category list order
      let matchedCategory: string | null = null;
      for (const activeCat of activeCategoryNames) {
        const activeCatLower = activeCat.toLowerCase();
        if (categories.some((cat) => cat.toLowerCase() === activeCatLower)) {
          matchedCategory = activeCat;
          break;
        }
      }

      if (matchedCategory) {
        // Found matching active category, count to that category
        counts[matchedCategory] = (counts[matchedCategory] || 0) + 1;
      } else {
        // All insight categories are not in active category list, count to "Other"
        counts.Other = counts.Other + 1;
      }
    }

    return counts;
  }, [
    archivedFilteredInsights,
    allTimeFilter,
    filterByTime,
    allReadStatus,
    insightIsUnread,
    activeCategoryNames,
  ]);

  /**
   * Calculate total category statistics (without time/read/unread filters, only based on archive status)
   * Used for sync to AppSidebar to display "All" count, independent of page filter conditions
   */
  const totalCategoryStats = useMemo(() => {
    // Only filter based on archive status (without using time and read/unread filters)
    const insights = archivedFilteredInsights;

    const counts: Record<string, number> = {
      all: insights.length,
      Other: 0,
    };

    // Count insights for each category
    for (const insight of insights) {
      const categories = insight.categories ?? [];

      if (categories.length === 0) {
        counts.Other = counts.Other + 1;
        continue;
      }

      let matchedCategory: string | null = null;
      for (const activeCat of activeCategoryNames) {
        const activeCatLower = activeCat.toLowerCase();
        if (categories.some((cat) => cat.toLowerCase() === activeCatLower)) {
          matchedCategory = activeCat;
          break;
        }
      }

      if (matchedCategory) {
        counts[matchedCategory] = (counts[matchedCategory] || 0) + 1;
      } else {
        counts.Other = counts.Other + 1;
      }
    }

    return counts;
  }, [archivedFilteredInsights, activeCategoryNames]);

  // Sync category statistics to localStorage for AppSidebar use
  const lastCategoryStatsRef = useRef<Record<string, number> | null>(null);
  const lastTotalStatsRef = useRef<Record<string, number> | null>(null);
  useEffect(() => {
    if (typeof window === "undefined") return;

    const statsStr = JSON.stringify(categoryStats);
    const lastStatsStr = lastCategoryStatsRef.current
      ? JSON.stringify(lastCategoryStatsRef.current)
      : null;

    const totalStatsStr = JSON.stringify(totalCategoryStats);
    const lastTotalStatsStr = lastTotalStatsRef.current
      ? JSON.stringify(lastTotalStatsRef.current)
      : null;

    // Only update and dispatch event when categoryStats actually changes
    if (statsStr !== lastStatsStr) {
      safeLocalStorageSetItem("alloomi_categoryStats", statsStr);
      // Trigger custom event to notify AppSidebar
      window.dispatchEvent(
        new CustomEvent("alloomi:categoryStatsUpdate", {
          detail: categoryStats,
        }),
      );
      lastCategoryStatsRef.current = categoryStats;
    }

    // Also sync totalCategoryStats (total count not affected by filters)
    if (totalStatsStr !== lastTotalStatsStr) {
      safeLocalStorageSetItem("alloomi_totalCategoryStats", totalStatsStr);
      window.dispatchEvent(
        new CustomEvent("alloomi:totalCategoryStatsUpdate", {
          detail: totalCategoryStats,
        }),
      );
      lastTotalStatsRef.current = totalCategoryStats;
    }
  }, [categoryStats, totalCategoryStats]);

  // Validate if stored tab is valid; if old "focus" or invalid custom tab, fallback to "all"
  const lastValidatedSelectedValueRef = useRef<ViewOptionValue | null>(null);
  useEffect(() => {
    if (!isTabsLoaded) return;

    if (lastValidatedSelectedValueRef.current === selectedValue) return;

    // Old data compatibility: treat as "all" when was focus tab
    if (selectedValue === "focus") {
      setSelectedValue("all");
      setSubTab("all");
      lastValidatedSelectedValueRef.current = "all";
      return;
    }

    if (selectedValue === "all") {
      lastValidatedSelectedValueRef.current = "all";
      return;
    }

    if (selectedValue === ANALYTICS_TAB_VALUE) {
      lastValidatedSelectedValueRef.current = ANALYTICS_TAB_VALUE;
      return;
    }

    const isValidCustomTab = enabledTabsRef.current.some(
      (tab) => tab.id === selectedValue,
    );
    if (!isValidCustomTab) {
      setSelectedValue("all");
      setSubTab("all");
      lastValidatedSelectedValueRef.current = "all";
    } else {
      lastValidatedSelectedValueRef.current = selectedValue;
    }
  }, [isTabsLoaded, selectedValue]);

  useEffect(() => {
    if (!selectedInsight) return;
    const stillVisible = sortedInsights.some(
      (insight) => insight.id === selectedInsight.id,
    );
    if (!stillVisible) {
      setSelectedInsight(null);
      setIsDrawerOpen(false);
    }
  }, [selectedInsight, sortedInsights]);

  /**
   * Handle sub-tab switching (All / custom tab)
   */
  const handleSubTabChange = (value: ViewOptionValue) => {
    setSubTab(value);
    setSelectedValue(value);
  };

  const lastSyncedSelectedValueRef = useRef<ViewOptionValue | null>(null);
  const lastSyncedSubTabRef = useRef<ViewOptionValue | null>(null);
  const enabledTabsRef = useRef<typeof enabledTabs>([]);

  // Sync selectedValue to subTab
  useEffect(() => {
    enabledTabsRef.current = enabledTabs;

    if (
      lastSyncedSelectedValueRef.current === selectedValue &&
      lastSyncedSubTabRef.current === subTab
    ) {
      return;
    }

    if (selectedValue === "all" || selectedValue === ANALYTICS_TAB_VALUE) {
      if (subTab !== "all") {
        setSubTab("all");
        lastSyncedSubTabRef.current = "all";
      }
    } else if (
      isTabsLoaded &&
      enabledTabs.some((tab) => tab.id === selectedValue)
    ) {
      if (subTab !== selectedValue) {
        setSubTab(selectedValue);
        lastSyncedSubTabRef.current = selectedValue;
      }
    } else if (isTabsLoaded && selectedValue !== "all") {
      setSubTab("all");
      setSelectedValue("all");
      lastSyncedSubTabRef.current = "all";
      lastSyncedSelectedValueRef.current = "all";
    }

    lastSyncedSelectedValueRef.current = selectedValue;
  }, [selectedValue, isTabsLoaded, enabledTabs]);

  /**
   * Calculate page title based on currently selected left context, consistent with context items in sidebar nav:
   * - When URL category exists, use same copy as sidebar (settings.contextTemplates.xxx.name or nav.contextOther)
   * - When no category (all contexts): title always "Tracking Events", doesn't change with panel grouping (All / VIP 25, etc.) switching
   */
  const headerTitle = useMemo(() => {
    if (category) {
      return category === "Other"
        ? t("nav.contextOther", "Other")
        : t(`settings.contextTemplates.${category}.name`, category);
    }
    return t("nav.insights", "Tracking Events");
  }, [category, t]);

  /**
   * Listen to favorite status changes and sync update selectedInsight
   * When favorite status changes in other panels (e.g., favorite panel), update event panel's detail drawer
   */
  useEffect(() => {
    const handleFavoriteChange = (event: Event) => {
      const customEvent = event as CustomEvent<{
        insightId: string;
        isFavorited: boolean;
      }>;
      const { insightId, isFavorited } = customEvent.detail;

      // If currently selected insight's favorite status changed, update it
      if (selectedInsight?.id === insightId) {
        setSelectedInsight({
          ...selectedInsight,
          isFavorited,
        });
      }
    };

    window.addEventListener("insightFavoriteChanged", handleFavoriteChange);

    return () => {
      window.removeEventListener(
        "insightFavoriteChanged",
        handleFavoriteChange,
      );
    };
  }, [selectedInsight, setSelectedInsight]);

  /**
   * Handle closing detail drawer
   */
  const handleCloseDrawer = useCallback(() => {
    setIsDrawerOpen(false);
    setSelectedInsight(null);
  }, []);

  /**
   * Render custom tab view
   */
  const renderTabView = (tabId: string) => {
    const tab = tabs.find((t) => t.id === tabId);
    if (!tab) {
      return (
        <div className="py-8 text-center text-muted-foreground">
          {t("insight.tabNotFound", "Tab not found")}
        </div>
      );
    }

    // Use new filter function
    const tabInsights = getFilteredTabInsights(tabId);
    const tabGroupedInsights = groupInsightsByDay(tabInsights, i18n.language);

    if (tabGroupedInsights.length === 0) {
      // If refreshing, show refresh status placeholder (also show tips)
      if (isRefreshing) {
        return (
          <InsightRefreshingState
            avatarConfig={avatarConfig}
            refreshStatus={refreshStatus ?? undefined}
            isRefreshing={isRefreshing}
            refreshProgress={refreshProgress}
            totalFetchingMsgCount={
              insightData?.sessions?.some(
                (session) => session.status === "fetching",
              )
                ? totalFetchingMsgCount
                : undefined
            }
            accountsCount={accounts.length}
            assistantName={assistantName}
            isFirstLanding={isFirstLanding}
          />
        );
      }

      // Normal empty state placeholder (custom tab)
      return (
        <InsightEmptyState
          avatarConfig={avatarConfig}
          assistantName={assistantName}
          accountsCount={accounts.length}
          showTips={true}
          tabId={tabId}
        />
      );
    }

    return (
      <div className="w-full">
        {tabGroupedInsights.map((group) => (
          <div key={group.dateString} className="mb-3 last:mb-0 w-full">
            <div className="px-2 pb-1 w-full">
              <span className="text-xs font-medium text-muted-foreground">
                {group.date}
              </span>
            </div>

            <div className="space-y-0">
              {group.insights.map((item) => (
                <div
                  key={item.id}
                  className="rounded-2xl transition-colors duration-200 hover:bg-primary-50"
                >
                  <InsightCard
                    isSelected={item.id === effectiveSelectedInsight?.id}
                    hasMyNickname={insightHasMyNickname(item)}
                    onSelect={(insight) => {
                      setSelectedInsight(insight);
                    }}
                    onDelete={handleDeleteInsight}
                    onArchive={handleArchiveInsight}
                    onFavorite={handleFavoriteInsight}
                    onPin={handlePinToggle}
                    isPinned={isInsightPinned(item)}
                    isFocused={focusedInsights.some((i) => i.id === item.id)}
                    onToggleFocus={handleToggleFocus}
                    isFocusDisabled={
                      !focusedInsights.some((i) => i.id === item.id) &&
                      focusedInsights.length >= 5
                    }
                    {...item}
                    // Use optimistic updated favorite status
                    isFavorited={getInsightFavorite(
                      item.id,
                      item.isFavorited || false,
                    )}
                  />
                </div>
              ))}
            </div>
          </div>
        ))}
        <motion.div
          viewport={{ once: true, amount: 0.1, margin: "100px" }}
          onViewportEnter={() => {
            if (!hasReachedEnd) {
              incrementSize();
            }
          }}
          className="h-10 w-full"
        />

        {!hasReachedEnd && (
          <div className="flex flex-row items-center p-2 text-zinc-500 justify-center">
            <Spinner size={20} />
            <div>{t("common.loading")}</div>
          </div>
        )}
      </div>
    );
  };

  // Render other views
  /**
   * Render all timeline views ("all" option)
   */
  const renderAllView = () => {
    if (allTimelineGroupedInsights.length === 0) {
      // If refreshing, show refresh status placeholder (also show tips)
      if (isRefreshing) {
        return (
          <InsightRefreshingState
            avatarConfig={avatarConfig}
            refreshStatus={refreshStatus ?? undefined}
            isRefreshing={isRefreshing}
            refreshProgress={refreshProgress}
            totalFetchingMsgCount={
              insightData?.sessions?.some(
                (session) => session.status === "fetching",
              )
                ? totalFetchingMsgCount
                : undefined
            }
            accountsCount={accounts.length}
            assistantName={assistantName}
            isFirstLanding={isFirstLanding}
          />
        );
      }

      // Normal empty state placeholder
      return (
        <InsightEmptyState
          avatarConfig={avatarConfig}
          assistantName={assistantName}
          accountsCount={accounts.length}
          showTips={true}
        />
      );
    }

    return (
      <div className="w-full">
        {allTimelineGroupedInsights.map((group) => (
          <div key={group.dateString} className="mb-3 last:mb-0 w-full">
            <div className="px-2 pb-1 w-full">
              <span className="text-xs font-medium text-muted-foreground">
                {group.date}
              </span>
            </div>

            <div className="space-y-0">
              {group.insights.map((item) => (
                <div
                  key={item.id}
                  className="rounded-2xl transition-colors duration-200 hover:bg-primary-50"
                >
                  <InsightCard
                    isSelected={item.id === effectiveSelectedInsight?.id}
                    hasMyNickname={insightHasMyNickname(item)}
                    onSelect={(insight) => {
                      setSelectedInsight(insight);
                    }}
                    onDelete={handleDeleteInsight}
                    onArchive={handleArchiveInsight}
                    onFavorite={handleFavoriteInsight}
                    onPin={handlePinToggle}
                    isPinned={isInsightPinned(item)}
                    isFocused={focusedInsights.some((i) => i.id === item.id)}
                    onToggleFocus={handleToggleFocus}
                    isFocusDisabled={
                      !focusedInsights.some((i) => i.id === item.id) &&
                      focusedInsights.length >= 5
                    }
                    {...item}
                    // Use optimistic updated favorite status
                    isFavorited={getInsightFavorite(
                      item.id,
                      item.isFavorited || false,
                    )}
                  />
                </div>
              ))}
            </div>
          </div>
        ))}
        <motion.div
          viewport={{ once: true, amount: 0.1, margin: "100px" }}
          onViewportEnter={() => {
            if (!hasReachedEnd) {
              incrementSize();
            }
          }}
          className="h-10 w-full"
        />

        {!hasReachedEnd && (
          <div className="flex flex-row items-center p-2 text-zinc-500 justify-center">
            <Spinner size={20} />
            <div>{t("common.loading")}</div>
          </div>
        )}
      </div>
    );
  };

  /**
   * Automatically open corresponding event detail drawer based on insightId parameter in URL
   * Ensure that when clicking event from global search etc., event details can be seen directly
   */
  useEffect(() => {
    const insightId = searchParams.get("insightId");
    if (!insightId || !eventsData?.items || eventsData.items.length === 0) {
      return;
    }

    const target = eventsData.items.find((insight) => insight.id === insightId);
    if (!target) return;

    setSelectedInsight(target);
    setIsDrawerOpen(true);
  }, [searchParams, eventsData?.items]);

  if (!isMounted) {
    return (
      <div className="flex h-full flex-col overflow-hidden bg-background">
        <div className="flex flex-col justify-start items-center flex-1 min-h-0 w-full overflow-y-auto">
          <div className="px-4 pt-3 sm:px-5 w-full h-full" />
        </div>
      </div>
    );
  }

  /** Effectively selected event: prioritize page-passed (e.g., URL opened), otherwise use panel click selected */
  const effectiveSelectedInsight = externalSelectedInsight ?? selectedInsight;
  /** Desktop with selected event: list + middle card displays Insight details, convenient for coexistence with right person detail column */
  const showEmbeddedInsight = !isMobile && !!effectiveSelectedInsight;
  const isAnalyticsView = selectedValue === ANALYTICS_TAB_VALUE;

  return (
    <>
      <div
        className={cn(
          showEmbeddedInsight
            ? "flex h-full flex-row overflow-hidden gap-2 sm:gap-3 relative"
            : "flex h-full flex-col overflow-hidden",
          // Don't duplicate card style when embedded in layout card; mobile concise background
          !showEmbeddedInsight &&
            (embedInCard
              ? ""
              : isMobile
                ? "bg-background"
                : "bg-card/90 backdrop-blur-md rounded-2xl border border-border/40"),
        )}
      >
        {/* Left side: event list (when desktop has selected item, flex-1 fills remaining width, detail card fixed at 480px on right side) */}
        <div
          className={cn(
            "flex h-full flex-col overflow-hidden min-h-0",
            showEmbeddedInsight && "flex-1 min-w-[280px]",
          )}
        >
          {/* Header - use AgentSectionHeader component */}
          {!hideHeader && (
            <AgentSectionHeader
              title={
                <span className="truncate text-3xl font-serif font-semibold tracking-tight text-foreground flex-1 min-w-0 leading-10">
                  {headerTitle}
                </span>
              }
              footer={
                <HorizontalScrollContainer className="w-full gap-1">
                  {/* All option - leftmost */}
                  <button
                    type="button"
                    onClick={() => handleSubTabChange("all")}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 h-8 text-xs font-semibold transition-colors shrink-0",
                      selectedValue === "all" ||
                        (selectedValue !== "other" &&
                          selectedValue !== ANALYTICS_TAB_VALUE &&
                          !enabledTabs.some((tab) => tab.id === selectedValue))
                        ? "border-primary/20 bg-primary/10 text-primary"
                        : "border-border bg-background text-muted-foreground hover:bg-muted",
                    )}
                  >
                    <span>{t("insight.all", "All")}</span>
                    {(() => {
                      const allCount = allTimelineInsights.length;
                      return allCount > 0 ? (
                        <span
                          className={cn(
                            "rounded-full px-1.5 py-0.5 text-[10px] font-medium bg-primary/10 text-primary",
                          )}
                        >
                          {allCount}
                        </span>
                      ) : null;
                    })()}
                  </button>

                  <button
                    type="button"
                    onClick={() => handleSubTabChange(ANALYTICS_TAB_VALUE)}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 h-8 text-xs font-semibold transition-colors shrink-0",
                      isAnalyticsView
                        ? "border-primary/20 bg-primary/10 text-primary"
                        : "border-border bg-background text-muted-foreground hover:bg-muted",
                    )}
                  >
                    <RemixIcon name="chart_gantt" size="size-3.5" />
                    <span>{t("insight.analytics.tab", "Analytics")}</span>
                  </button>

                  {/* Enabled custom and preset Tabs */}
                  {isTabsLoaded &&
                    enabledTabs.map((tab) => {
                      // Apply tab's filter rules, then apply All tab's time and read/unread filters (for consistency)
                      const tabFiltered = baseInsights.filter((insight) =>
                        insightMatchesFilter(
                          insight,
                          tab.filter,
                          filterContext,
                        ),
                      );

                      // Apply All tab's time filter
                      let filteredByTime = tabFiltered;
                      if (allTimeFilter !== "all") {
                        filteredByTime = tabFiltered.filter((insight) =>
                          filterByTime(insight, allTimeFilter),
                        );
                      }

                      // Apply All tab's read/unread filter
                      let filteredByReadStatus = filteredByTime;
                      if (allReadStatus !== "all") {
                        filteredByReadStatus = filteredByTime.filter(
                          (insight) => {
                            const isUnread = insightIsUnread(insight.id);
                            return allReadStatus === "unread"
                              ? isUnread
                              : !isUnread;
                          },
                        );
                      }

                      const totalCount = filteredByReadStatus.length;
                      const isActive = selectedValue === tab.id;
                      return (
                        <button
                          key={tab.id}
                          type="button"
                          onClick={() => handleSubTabChange(tab.id)}
                          className={cn(
                            "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 h-8 text-xs font-semibold transition-colors shrink-0",
                            isActive
                              ? "border-primary/20 bg-primary/10 text-primary"
                              : "border-border bg-background text-muted-foreground hover:bg-muted",
                          )}
                        >
                          <span>{tab.name}</span>
                          {totalCount > 0 && (
                            <span
                              className={cn(
                                "rounded-full px-1.5 py-0.5 text-[10px] font-medium bg-primary/10 text-primary",
                              )}
                            >
                              {totalCount}
                            </span>
                          )}
                        </button>
                      );
                    })}
                </HorizontalScrollContainer>
              }
            >
              {/* Right side actions */}
              {/* Combined filter button - desktop display, left of refresh button */}
              {!isMobile && !isAnalyticsView && (
                <CombinedFilterButton
                  readStatus={sharedReadStatus}
                  onReadStatusChange={setSharedReadStatus}
                  timeFilter={sharedTimeFilter}
                  onTimeFilterChange={setSharedTimeFilter}
                  disabled={isViewingArchived}
                />
              )}

              {/* Refresh button - desktop display, right of filter button */}
              {!isMobile && !isAnalyticsView && (
                <Button
                  variant="outline"
                  size="icon"
                  onClick={handleRefresh}
                  disabled={isRefreshing}
                  className={cn(
                    "h-8 w-8",
                    refreshError &&
                      "border-destructive/50 text-destructive hover:bg-destructive/10",
                  )}
                  title={
                    isRefreshing
                      ? t("insight.refreshing", "Refreshing...")
                      : refreshError
                        ? refreshError.friendlyMessage
                        : t("insight.doRefresh", "Refresh")
                  }
                >
                  {isRefreshing ? (
                    <Spinner className="size-4" />
                  ) : (
                    <RemixIcon name="refresh" size="size-4" />
                  )}
                </Button>
              )}

              {/* More button */}
              <DropdownMenu
                open={isMoreMenuOpen}
                onOpenChange={setIsMoreMenuOpen}
              >
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    aria-label={t("common.more", "More")}
                  >
                    <RemixIcon name="more_vertical" size="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  {/* Mobile: refresh button */}
                  {isMobile && (
                    <DropdownMenuItem
                      onClick={() => {
                        handleRefresh();
                        setIsMoreMenuOpen(false);
                      }}
                      disabled={isRefreshing}
                      className={cn(
                        "cursor-pointer",
                        refreshError &&
                          "text-destructive focus:text-destructive",
                      )}
                    >
                      {isRefreshing ? (
                        <Spinner className="mr-2 size-4" />
                      ) : (
                        <RemixIcon
                          name="refresh"
                          size="size-4"
                          className="mr-2"
                        />
                      )}
                      {isRefreshing
                        ? t("insight.refreshing", "Refreshing...")
                        : refreshError
                          ? refreshError.friendlyMessage
                          : t("insight.doRefresh", "Refresh")}
                    </DropdownMenuItem>
                  )}
                  {/* Group management */}
                  <DropdownMenuItem
                    onClick={() => {
                      setIsTabsDialogOpen(true);
                      setIsMoreMenuOpen(false);
                    }}
                    className="cursor-pointer"
                  >
                    <RemixIcon
                      name="layout_grid"
                      size="size-4"
                      className="mr-2"
                    />
                    {t("insight.tabs.manage", "Manage Groups")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => {
                      setIsViewingArchived(!isViewingArchived);
                      setIsMoreMenuOpen(false);
                    }}
                    className="cursor-pointer"
                  >
                    <RemixIcon name="bell_off" size="size-4" className="mr-2" />
                    {isViewingArchived
                      ? t("insight.viewActive", "View Active")
                      : t("insight.viewArchived", "View Archived")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </AgentSectionHeader>
          )}
          <div
            ref={scrollContainerRef}
            className={cn(
              "flex flex-col justify-start items-center flex-1 min-h-0 w-full overflow-y-auto no-scrollbar",
              // Add bottom spacing on mobile to avoid overlap with bottom navigation (event panel needs more spacing)
              isMobile && "pb-[80px]",
            )}
          >
            <div
              className={cn(
                "sticky top-0 z-20 transition-shadow duration-200",
                "relative after:pointer-events-none after:absolute after:inset-x-4 after:bottom-0 after:h-[1px] after:bg-gradient-to-r after:from-transparent after:via-border/60 after:to-transparent after:transition-opacity after:duration-200",
                !isHeaderScrolled && "after:opacity-0",
                isHeaderScrolled &&
                  !isMobile &&
                  "shadow-[0_16px_32px_-28px_rgba(44,62,120,0.45)] after:opacity-100 md:shadow-[0_18px_38px_-30px_rgba(44,62,120,0.45)]",
                isHeaderScrolled && isMobile && "after:opacity-100",
              )}
            />

            <div className="px-6 pt-0 pb-6 flex flex-col justify-start items-center w-full h-full">
              {isAnalyticsView ? (
                <InsightAnalyticsPanel />
              ) : (
                <>
                  {selectedValue === "all" && renderAllView()}
                  {selectedValue !== "all" && renderTabView(selectedValue)}
                </>
              )}
            </div>
          </div>
        </div>

        {/* Desktop: middle card embedded Insight details; when width insufficient (max-lg) completely cover left list */}
        {showEmbeddedInsight && effectiveSelectedInsight && (
          <div className="shrink-0 h-full min-h-0 max-lg:absolute max-lg:inset-0 max-lg:z-[40]">
            <InsightDetailDrawer
              insight={effectiveSelectedInsight}
              isOpen={true}
              onClose={() => {
                if (externalSelectedInsight && onExternalInsightClose) {
                  onExternalInsightClose();
                } else {
                  setSelectedInsight(null);
                }
              }}
              onUnderstand={handleUnderstandInsight}
              understandingInsightId={understandingInsightId}
              onArchive={handleArchiveInsight}
              onFavorite={handleFavoriteInsight}
              embedInLayout={true}
              autoOpenChat={true}
            />
          </div>
        )}
      </div>

      {/* Delete confirmation dialog */}
      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <DialogContent className="sm:max-w-[300px]">
          <DialogHeader>
            <DialogTitle className="text-red-600 flex items-center">
              <RemixIcon name="delete_bin" size="size-5" className="mr-2" />
              {t("insight.confirmDeleteTitle")}
            </DialogTitle>
          </DialogHeader>
          <p>{t("insight.confirmDeleteMessage")}</p>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setIsDeleteDialogOpen(false)}
              disabled={isDeleting}
            >
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={deleteInsight}
              disabled={isDeleting}
            >
              {isDeleting ? t("common.deleting") : t("insight.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <GoogleAuthForm
        isOpen={isGoogleAuthFormOpen}
        onClose={() => setIsGoogleAuthFormOpen(false)}
        onSubmit={handleGoogleSubmit}
      />

      <WhatsAppAuthForm
        isOpen={isWhatsAppAuthFormOpen}
        onClose={() => setIsWhatsAppAuthFormOpen(false)}
        onSuccess={handleWhatsAppSuccess}
      />
      <OutlookAuthForm
        isOpen={isOutlookAuthFormOpen}
        onClose={() => setIsOutlookAuthFormOpen(false)}
        onSubmit={handleOutlookSubmit}
      />
      <MessengerAuthForm
        isOpen={isMessengerAuthFormOpen}
        onClose={() => setIsMessengerAuthFormOpen(false)}
        onSubmit={handleMessengerSubmit}
      />

      <FeishuAuthForm
        isOpen={isFeishuAuthFormOpen}
        onClose={() => setIsFeishuAuthFormOpen(false)}
        onSuccess={() => router.refresh()}
      />

      <IMessageAuthForm
        isOpen={isIMessageAuthFormOpen}
        onClose={() => setIsIMessageAuthFormOpen(false)}
        onSuccess={() => {
          router.refresh();
          mutate();
        }}
      />

      <TelegramTokenForm
        isOpen={showTelegramTokenForm}
        onClose={() => setShowTelegramTokenForm(false)}
      />

      {/* Tab management dialog */}
      <Suspense fallback={null}>
        <InsightTabsDialogLazy
          isOpen={isTabsDialogOpen}
          onOpenChange={setIsTabsDialogOpen}
          insights={insightData.items ?? []}
        />
      </Suspense>

      {/* Insight detail drawer: mobile uses global drawer only; desktop uses middle card embedded (see showEmbeddedInsight above) */}
      {isMobile && (
        <InsightDetailDrawer
          insight={selectedInsight}
          isOpen={isDrawerOpen}
          onClose={handleCloseDrawer}
          onUnderstand={handleUnderstandInsight}
          understandingInsightId={understandingInsightId}
          onArchive={handleArchiveInsight}
          onFavorite={handleFavoriteInsight}
        />
      )}
    </>
  );
}
