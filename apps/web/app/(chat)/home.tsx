"use client";

// ============================================================================
// Imports
// ============================================================================

import {
  useState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { useLocalStorage } from "usehooks-ts";
import { AgentLayout } from "@/components/agent/layout";
import { ResponsiveToolbar } from "@/components/agent/responsive-toolbar";
import { AgentChatPanel } from "@/components/agent/chat-panel";
import { ChatHeaderPanel } from "@/components/agent/chat-header-panel";
import { Button, PageSectionHeader } from "@alloomi/ui";
import {
  AgentEventsPanel,
  AgentBriefPanel,
  InsightDetailDrawer,
} from "@/components/agent/dynamic-panels";
import { useTranslation } from "react-i18next";
import "../../i18n";
import type { ChatMessage } from "@alloomi/shared";
import dynamic from "next/dynamic";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { buildNavigationUrl, cn, generateUUID, fetcher } from "@/lib/utils";
import { UserProfileSettings } from "@/components/user-profile-settings";
import { ProfileOverview } from "@/components/profile-overview";
import { AboutSettings } from "@/components/about-settings";
import { StorageManagementPanel } from "@/components/storage-management-panel";
import { PersonalizationProfileSoulPanel } from "@/components/personalization/personalization-profile-soul-panel";
import { useIsMobile } from "@alloomi/hooks/use-is-mobile";
import { useChatContext } from "@/components/chat-context";
import { InsightsPaginationProvider } from "@/hooks/use-insight-data";
import { FilePreviewOverlay } from "@/components/file-preview-overlay";
import { ChatHistorySidePanel } from "@/components/agent/chat-history-side-panel";
import type { ChatHistoryResponse } from "@/lib/ai/chat/api";
import { mutate } from "swr";
import { AddPlatformDialog } from "@/components/add-platform-dialog";
import { useIntegrations } from "@/hooks/use-integrations";
import { PanelSkeleton, ChatSkeleton } from "@/components/agent/panel-skeleton";
import { RemixIcon } from "@/components/remix-icon";

// Lazy load motion components to reduce bundle size
const MotionSection = dynamic(
  () =>
    import("framer-motion").then((mod) => {
      const { motion } = mod;
      return {
        default: motion.section as typeof motion.section,
      };
    }),
  { ssr: true },
);

export function Home() {
  // ============================================================================
  // Hooks & Initialization
  // ============================================================================

  const { t } = useTranslation();

  const router = useRouter();
  const pathname = usePathname();
  const isMobile = useIsMobile();
  const searchParams = useSearchParams();

  const page = searchParams.get("page");
  const category = searchParams.get("category");
  /** Chat page (page=chat) reads chatId from URL, used to correctly open corresponding chat after jumping from Library/Chat Vault "Open chat" */
  const urlChatId = searchParams.get("chatId") ?? undefined;
  /** Chat page reads send parameter from URL, automatically sends that message after mounting (e.g., onboarding "Talk with Alloomi") */
  const urlSendMessage = searchParams.get("send");
  const initialMessageToSend =
    urlSendMessage != null ? decodeURIComponent(urlSendMessage) : undefined;

  /** Inbox page (/inbox) and Focus page (/) are distinguished by pathname, no longer use panel parameter */
  const isInboxPage = pathname === "/inbox";

  // Use useMemo to cache category prop, avoid causing child component re-render due to new reference
  const memoizedCategory = useMemo(() => category ?? undefined, [category]);

  // Chat page right sidebar history switch (only used when page=chat)
  // Default collapsed, use localStorage to persist user preference
  const [isChatHistoryOpen, setIsChatHistoryOpen] = useLocalStorage(
    "chatHistoryPanelOpen",
    false,
  );

  // Get state from ChatContext
  const {
    messages,
    setMessages,
    isAgentRunning,
    activeChatId,
    setActiveChatId: contextSetActiveChatId,
    switchChatId,
    selectedInsight,
    isInsightDrawerOpen,
    previewFile,
    closeFilePreviewPanel,
    setSelectedInsight,
    setIsInsightDrawerOpen,
    sendMessage,
  } = useChatContext();

  // Progressive authorization state
  const [isAddPlatformDialogOpen, setIsAddPlatformDialogOpen] = useState(false);
  const [linkingPlatform, setLinkingPlatform] = useState<
    import("@/hooks/use-integrations").IntegrationId | null
  >(null);
  const { mutate: mutateIntegrations } = useIntegrations();

  // Callbacks for AddPlatformDialog (required by interface, not used in chat flow)
  const [, setIsGoogleAuthFormOpen] = useState(false);
  const [, setIsOutlookAuthFormOpen] = useState(false);
  const [, setIsWhatsAppAuthFormOpen] = useState(false);
  const [, setIsMessengerAuthFormOpen] = useState(false);
  const showTelegramTokenForm = useState(false)[1]; // no-op in chat flow

  // "Connect Account" from tool failures → Connectors page with add-platform flow
  useEffect(() => {
    const handler = () => {
      router.push("/connectors?addPlatform=true");
    };
    window.addEventListener("alloomi:request-integration", handler);
    return () =>
      window.removeEventListener("alloomi:request-integration", handler);
  }, [router]);

  // Listen for integration authorization completion → retry the tool call
  useEffect(() => {
    const handler = () => {
      mutateIntegrations();
      // Send "continue" to retry the tool call with the newly connected integration
      sendMessage({ parts: [{ type: "text", text: "continue" }] });
    };
    window.addEventListener("integration:accountAuthorized", handler);
    return () =>
      window.removeEventListener("integration:accountAuthorized", handler);
  }, [mutateIntegrations, sendMessage]);

  // Use ref to track activeChatId in context, avoid adding it to useEffect dependency array
  const contextActiveChatIdRef = useRef(activeChatId);
  contextActiveChatIdRef.current = activeChatId;

  // Client-side selected chat ID (for highlighting, separated from chatId in URL)
  const [localActiveChatId] = useState<string | null>(() => {
    // If no chatId (new conversation), generate a new UUID
    return generateUUID();
  });

  /** Actually used chatId: Chat page prioritizes URL's chatId, otherwise uses activeChatId or props.chatId */
  const effectiveChatId = useMemo(() => {
    if (page === "chat" && urlChatId) return urlChatId;
    return localActiveChatId;
  }, [page, urlChatId, localActiveChatId]);

  // Data for Chat page right sidebar history (independent of Header, avoid dependency on internal implementation)
  // Pagination state
  const [chatsList, setChatsList] = useState<ChatHistoryResponse["chats"]>([]);
  const [startingAfter, setStartingAfter] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const isFirstLoadRef = useRef(true);

  // Build API URL
  const historyApiUrl = useMemo(() => {
    if (page !== "chat") return null;
    const url = new URL("/api/history", window.location.origin);
    url.searchParams.set("limit", "20");
    if (startingAfter) {
      url.searchParams.set("starting_after", startingAfter);
    }
    return url.toString();
  }, [page, startingAfter]);

  // Use useEffect + fetch instead of useSWR, avoid data not updating due to onSuccess callback timing issue
  useEffect(() => {
    if (!historyApiUrl) return;

    const abortController = new AbortController();
    const isLoadMore = !isFirstLoadRef.current;
    const url = historyApiUrl;

    async function fetchHistory() {
      try {
        const data: ChatHistoryResponse = await fetcher(url);

        // Check if request was aborted
        if (abortController.signal.aborted) return;

        if (isLoadMore) {
          setChatsList((prev) => [...prev, ...data.chats]);
        } else {
          setChatsList(data.chats);
          isFirstLoadRef.current = false;
        }
        setHasMore(data.hasMore);
        setIsLoadingMore(false);
      } catch (error) {
        // Ignore abort errors (component unmounted)
        if (error instanceof Error && error.name === "AbortError") {
          return;
        }
        console.error("Error fetching chat history:", error);
        setIsLoadingMore(false);
      }
    }

    fetchHistory();

    return () => {
      abortController.abort();
    };
  }, [historyApiUrl]);

  // Load more
  const loadMoreChats = useCallback(() => {
    if (!hasMore || isLoadingMore || chatsList.length === 0) return;
    const lastChat = chatsList[chatsList.length - 1];
    if (lastChat) {
      setIsLoadingMore(true);
      setStartingAfter(lastChat.id);
    }
  }, [hasMore, isLoadingMore, chatsList]);

  const sortedChatsForChatPage = useMemo(() => {
    if (!chatsList.length) return [];
    // Deduplicate
    const seen = new Set<string>();
    const unique = chatsList.filter((chat) => {
      if (seen.has(chat.id)) return false;
      seen.add(chat.id);
      return true;
    });
    return [...unique].sort((a, b) => {
      const dateA = a.latestMessageTime
        ? new Date(a.latestMessageTime)
        : new Date(a.createdAt);
      const dateB = b.latestMessageTime
        ? new Date(b.latestMessageTime)
        : new Date(b.createdAt);
      return dateB.getTime() - dateA.getTime();
    });
  }, [chatsList]);

  // Sync effectiveChatId to ChatContext
  // When chatId exists in URL (jumped from scheduled job or execution history), call switchChatId to load messages
  useEffect(() => {
    if (!effectiveChatId) return;

    // If chatId exists in URL (jumped from scheduled job etc.), call switchChatId to load messages
    if (urlChatId) {
      // Always call switchChatId, let it handle caching logic internally
      // Avoid message not loaded due to async loading not completing
      switchChatId(effectiveChatId);
    } else {
      contextSetActiveChatId(effectiveChatId);
    }
  }, [effectiveChatId, contextSetActiveChatId, switchChatId, urlChatId]);

  // When localActiveChatId changes, synchronously update chatId parameter in URL (only on chat page)
  // This can avoid effectiveChatId still using old value due to URL update delay
  // Note: Only need to sync when there's no chatId in URL (avoid overwriting existing chatId, e.g., when jumped from scheduled job)
  useEffect(() => {
    // Skip initial render
    if (!localActiveChatId) return;
    // Only synchronously update URL on chat page
    if (page !== "chat") return;
    // If chatId already exists in URL, no need to update (possibly jumped from scheduled job etc.)
    if (urlChatId) return;

    const newPath = buildNavigationUrl({
      pathname: "/",
      searchParams,
      paramsToUpdate: {
        page: "chat",
        chatId: localActiveChatId,
      },
    });
    router.replace(newPath, { scroll: false });
  }, [localActiveChatId, page, searchParams, router]);

  // Initial redirect: when page is null (first load), redirect to chat page
  useEffect(() => {
    // Only redirect when page is null and localActiveChatId is available
    if (page !== null || !localActiveChatId) return;
    // /inbox is a standalone page that also has no page query parameter.
    // Keep it on the insight/events surface instead of forcing it into chat.
    if (pathname !== "/") return;

    const newPath = buildNavigationUrl({
      pathname: "/",
      searchParams,
      paramsToUpdate: {
        page: "chat",
        chatId: localActiveChatId,
      },
    });
    router.replace(newPath, { scroll: false });
  }, [page, localActiveChatId, pathname, searchParams, router]);

  // Mobile panel state
  // Note: When initializing, need to consider pathname, ensure value in localStorage matches current path
  const [mobileActivePanel, setMobileActivePanel] = useLocalStorage<
    "insight" | "brief" | "chat"
  >("mobileActivePanel", () => {
    if (typeof window === "undefined") return "brief";
    const saved = localStorage.getItem("mobileActivePanel");
    // If saved value matches current path, use saved value
    // "/" path corresponds to "brief", "/inbox" path corresponds to "insight"
    // "chat" needs to be re-judged when not on chat page
    const currentPath = window.location.pathname;
    if (saved === "chat") {
      // If saved value is chat, need to re-judge based on current path
      return currentPath === "/inbox" ? "insight" : "brief";
    }
    if (saved && ["insight", "brief"].includes(saved)) {
      return saved as "insight" | "brief";
    }
    return currentPath === "/inbox" ? "insight" : "brief";
  });

  // Page title
  const [centerTitle, setCenterTitle] = useState("Workspace");

  // Get translations after client hydration completes, avoid hydration error
  useEffect(() => {
    setCenterTitle(t("agent.sections.center", "Workspace"));
  }, [t]);

  // Prevent insightDetailId cleanup logic from repeatedly executing causing infinite loop
  const insightCleanupRef = useRef<Set<string>>(new Set());

  // Listen to insightDetailId in URL parameters, automatically load corresponding insight
  useEffect(() => {
    const insightDetailId = searchParams.get("insightDetailId");
    if (!insightDetailId) return;

    // Check if already attempted to clean up this insight ID, prevent infinite loop
    if (insightCleanupRef.current.has(insightDetailId)) {
      return;
    }

    const abortController = new AbortController();

    async function fetchInsight() {
      try {
        const res = await fetch(`/api/insights/${insightDetailId}?fetch=true`, {
          signal: abortController.signal,
        });

        if (!res.ok) {
          throw new Error(`Failed to fetch insight: ${res.statusText}`);
        }

        const data = await res.json();

        if (data.insight) {
          setSelectedInsight(data.insight);
          setIsInsightDrawerOpen(true);
        } else {
          // If insight doesn't exist, clear URL parameter
          cleanupInsightUrl(insightDetailId);
        }
      } catch (error) {
        // Ignore abort errors (component unmounted)
        if (error instanceof Error && error.name === "AbortError") {
          return;
        }
        console.error("Error fetching insight:", error);
        cleanupInsightUrl(insightDetailId);
      }
    }

    function cleanupInsightUrl(id: string | null) {
      if (!id) return;
      const cleanupSet = insightCleanupRef.current;
      if (!cleanupSet.has(id)) {
        cleanupSet.add(id);
        const newPath = buildNavigationUrl({
          pathname,
          searchParams,
          paramsToUpdate: { insightDetailId: null },
        });
        router.replace(newPath);
      }
    }

    fetchInsight();

    return () => {
      abortController.abort();
    };
  }, [searchParams, pathname, router]);

  // When chatId changes, clear selectedInsight to close mobile drawer
  // This ensures bottom tab displays normally
  // insightDetailId parameter will be retained, drawer will automatically reopen when user switches back
  const selectedInsightRef = useRef(selectedInsight);
  useEffect(() => {
    selectedInsightRef.current = selectedInsight;
  }, [selectedInsight]);

  // Defensive check: ensure effectiveChatId exists and is valid
  const isValidChatId =
    effectiveChatId &&
    typeof effectiveChatId === "string" &&
    effectiveChatId.length > 0;

  // ============================================================================
  // Chat Hook & Refs
  // ============================================================================

  // Use ref to keep messages value always up-to-date in closures
  // This ensures always getting latest messages in native agent's onDone callback
  const messagesRef = useRef(messages);
  const previsAgentRunningRef = useRef(false);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // When isAgentRunning becomes false, automatically update all "executing" status tool parts to "completed"
  // This prevents some tools from not receiving tool_result event causing status to remain "executing"
  useEffect(() => {
    // Only execute when changing from true to false
    if (previsAgentRunningRef.current && !isAgentRunning) {
      // Use current activeChatId to ensure messages update to correct chat
      const currentChatId = activeChatId;
      setMessages((prev) => {
        const updated = prev.map((message) => {
          if (message.role !== "assistant" || !Array.isArray(message.parts)) {
            return message;
          }

          const hasExecutingTools = message.parts.some(
            (part: any) =>
              part.type === "tool-native" && part.status === "executing",
          );

          if (!hasExecutingTools) {
            return message;
          }

          // Update all executing status tools to completed
          const updatedParts = message.parts.map((part: any) => {
            if (part.type === "tool-native" && part.status === "executing") {
              return {
                ...part,
                status: "completed" as const,
              };
            }
            return part;
          });

          return {
            ...message,
            parts: updatedParts,
          } as ChatMessage;
        });
        return updated;
      }, currentChatId);
    }
    previsAgentRunningRef.current = isAgentRunning;
  }, [isAgentRunning, setMessages, activeChatId]);

  const handleAskAiClick = useCallback(() => {
    // Mobile: switch panel
    if (isMobile && !page) {
      if (mobileActivePanel === "chat") {
        setMobileActivePanel(isInboxPage ? "insight" : "brief");
      } else {
        setMobileActivePanel("chat");
      }
      return;
    }
  }, [isMobile, page, isInboxPage, mobileActivePanel]);

  // Sync pathname to mobile panel state (/inbox = insight, / = focus)
  useEffect(() => {
    if (!isMobile || page) return;

    const prevPath = sessionStorage.getItem("prevPathname");
    if (prevPath === null) {
      sessionStorage.setItem("prevPathname", pathname);
      return;
    }

    if (prevPath === pathname) return;

    if (pathname === "/inbox") {
      setMobileActivePanel("insight");
    } else if (pathname === "/") {
      // When switching to home page, ensure set to brief, don't keep chat status
      setMobileActivePanel("brief");
    }
    sessionStorage.setItem("prevPathname", pathname);
  }, [pathname, page, isMobile]);

  // Extracted inline handlers to useCallback for better performance
  const handleChatIdChange = useCallback(
    (newChatId: string | null) => {
      // Read insightDetailId from current URL parameters, not from state
      // Because when switching chat, state may not have updated yet
      const currentInsightDetailId = searchParams.get("insightDetailId");
      // If newChatId is null (new conversation), generate a new UUID
      const targetChatId = newChatId ?? generateUUID();
      // When page=chat, use query parameters instead of /chat/[id] route
      // Because app doesn't have /chat/[id] dynamic route, using /chat/${chatId} will cause 404
      const newPath = buildNavigationUrl({
        pathname: page === "chat" ? "/" : pathname,
        searchParams,
        chatId: page === "chat" ? undefined : targetChatId,
        paramsToUpdate: {
          ...(page === "chat"
            ? { page: "chat", chatId: targetChatId }
            : { rightPanel: "chat" }),
          // Keep current insightDetailId parameter in URL
        },
      });

      console.debug("handleChatIdChange New path:", newPath);
      router.push(newPath);
    },
    [router, pathname, searchParams, page],
  );

  /** Delete chat: call API then remove from local list, switch to new chat if deleted current chat */
  const handleDeleteChat = useCallback(
    async (chatId: string) => {
      const res = await fetch(`/api/chat/${chatId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) return;
      setChatsList((prev) => prev.filter((c) => c.id !== chatId));
      // Refresh history data in ChatHeader
      mutate(
        (key) => typeof key === "string" && key.startsWith("/api/history"),
      );
      if (effectiveChatId === chatId) {
        handleChatIdChange(null);
      }
    },
    [effectiveChatId, handleChatIdChange],
  );

  const handleOpenRelatedInsight = useCallback(
    (insight: import("@/lib/db/schema").Insight | null) => {
      setSelectedInsight(insight);
      // Update insightDetailId parameter in URL
      if (insight?.id) {
        const newPath = buildNavigationUrl({
          pathname,
          searchParams,
          paramsToUpdate: { insightDetailId: insight.id },
        });
        router.replace(newPath);
      }
    },
    [pathname, searchParams, router],
  );

  const handlePageTypeClick = useCallback(() => {
    // Focus/Inbox are independent pages: navigate to another page after clicking
    router.push(isInboxPage ? "/" : "/inbox");
  }, [isInboxPage, router]);

  // Memoized helper for mobile panel title
  const getMobilePanelTitle = useCallback(() => {
    if (isInboxPage) {
      return memoizedCategory || t("nav.inbox", "Insight Box");
    }
    return t("brief.title", "Daily Focus");
  }, [mobileActivePanel, isInboxPage, memoizedCategory, t]);

  /** Utility page title mapping (single source of truth: only maintain here, PageSectionHeader reuses) */
  function getUtilityPageTitle(pageParam: string | null): string {
    switch (pageParam) {
      case "profile":
        return t("settings.profileOverviewTitle", "Personal Settings");
      case "account-settings":
        return t("settings.general", "General");
      case "profile-edit":
        return t("settings.general", "General");
      case "profile-soul":
        return t("settings.profileSoulPageTitle", "About me");
      case "alloomi-soul":
        return t("settings.general", "General");
      case "about":
        return t("about.title", "About");
      case "storage-management":
        return t("settings.storageManagementTitle", "Storage management");
      case "coupons":
        return t("nav.coupons", "Coupons");
      default:
        return t("nav.myAccount", "My Account");
    }
  }

  /**
   * Controls whether utility pages should hide the top header section.
   */
  function shouldHideUtilityHeader(pageParam: string | null): boolean {
    return [
      "profile",
      "account-settings",
      "profile-edit",
      "profile-soul",
      "alloomi-soul",
      "about",
      "storage-management",
    ].includes(pageParam ?? "");
  }

  // ============================================================================
  // Render Functions
  // ============================================================================

  function getPageContent() {
    // Don't use PageContentCard, avoid double-layer border with SidePanelShell's content-area-card
    const renderUtilityPanel = (
      content: ReactNode,
      pageParam: string | null,
      headerRight?: ReactNode,
      titleOverride?: ReactNode,
      headerDescription?: ReactNode,
    ) => (
      <div className="flex flex-col flex-1 min-h-0 h-full max-h-screen overflow-visible">
        {!shouldHideUtilityHeader(pageParam) && (
          <PageSectionHeader
            title={titleOverride ?? getUtilityPageTitle(pageParam)}
            description={headerDescription}
          >
            {headerRight}
          </PageSectionHeader>
        )}
        <MotionSection
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, ease: "easeOut" }}
          className="flex h-full min-h-0 flex-1 flex-col"
        >
          <div className="flex flex-1 min-h-0 flex-col gap-8 overflow-y-auto px-4 pb-6 pt-6 sm:px-6 sm:pb-6 sm:pt-6">
            {content}
          </div>
        </MotionSection>
      </div>
    );

    if (page === "profile") {
      return renderUtilityPanel(<ProfileOverview />, "profile");
    }
    if (page === "account-settings" || page === "profile-edit") {
      return renderUtilityPanel(<UserProfileSettings />, "account-settings");
    }

    if (page === "profile-soul") {
      return renderUtilityPanel(
        <PersonalizationProfileSoulPanel />,
        "profile-soul",
        undefined,
        undefined,
        t("insightPreferences.identity.introDescription"),
      );
    }

    if (page === "alloomi-soul") {
      return renderUtilityPanel(<UserProfileSettings />, "account-settings");
    }

    if (page === "about") {
      return renderUtilityPanel(<AboutSettings />, "about");
    }

    if (page === "storage-management") {
      return renderUtilityPanel(
        <StorageManagementPanel />,
        "storage-management",
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8"
          onClick={() => {
            router.refresh();
          }}
        >
          <RemixIcon name="refresh" size="size-4" />
          {t("common.refresh", "Refresh")}
        </Button>,
      );
    }

    // Determine whether to show mobile menu bar (only show when mobile and on insight/brief page)
    const showMobileToolbar = isMobile && !page;

    // Mobile: display different panel according to mobileActivePanel
    if (showMobileToolbar) {
      let mobilePanelContent: ReactNode;
      // Header title determined by entry page type (first-level page)
      const mobilePanelTitle = getMobilePanelTitle();

      switch (mobileActivePanel) {
        case "insight":
          mobilePanelContent = (
            <AgentEventsPanel
              key="events-panel"
              hideHeader={false}
              category={memoizedCategory}
            />
          );
          break;
        case "brief":
          mobilePanelContent = (
            <AgentBriefPanel key="brief-panel" hideHeader={true} />
          );
          break;
        case "chat":
          mobilePanelContent = (
            <div className="flex h-full flex-col">
              <ChatHeaderPanel onChatIdChange={handleChatIdChange} />
              <div
                className={cn(
                  "flex-1 min-h-0 overflow-auto",
                  // Mobile: add bottom spacing (chat panel needs less spacing)
                  isMobile && "pb-[80px]",
                )}
              >
                <AgentChatPanel initialMessageToSend={initialMessageToSend} />
              </div>
            </div>
          );
          break;
        default:
          mobilePanelContent = (
            <AgentBriefPanel key="brief-panel" hideHeader={true} />
          );
      }

      // Create responsive toolbar component
      const responsiveToolbar = (
        <ResponsiveToolbar
          pageType={isInboxPage ? "insight" : "brief"}
          activePanel={mobileActivePanel}
          onPageTypeClick={handlePageTypeClick}
          onAskAiClick={handleAskAiClick}
        />
      );

      return (
        <InsightsPaginationProvider>
          <AgentLayout
            centerTitle={mobilePanelTitle}
            hideCenterHeader={true}
            mobileActivePanel={mobileActivePanel}
            mobileHeaderTitle={mobilePanelTitle}
          >
            {mobilePanelContent}
          </AgentLayout>
          {/* Mobile bottom menu bar - render independently outside AgentLayout */}
          {responsiveToolbar}
          {/* Global InsightDetailDrawer - Mobile */}
          <InsightDetailDrawer
            insight={selectedInsight}
            isOpen={isInsightDrawerOpen}
            onClose={() => {
              setSelectedInsight(null);
              setIsInsightDrawerOpen(false);
            }}
          />
        </InsightsPaginationProvider>
      );
    }

    // Chat page (entered from left menu "New chat" or Library/Chat Vault "Open chat"): full-screen display chat, no left Focus/Tracking panel; use effectiveChatId to support chatId in URL
    if (page === "chat") {
      return (
        <InsightsPaginationProvider>
          <AgentLayout centerTitle={t("nav.newChat")} hideCenterHeader={true}>
            <div className="flex h-full min-h-0 w-full gap-0">
              {/* Left: chat content */}
              <div className="flex min-w-0 flex-1 flex-col">
                <ChatHeaderPanel
                  chatId={effectiveChatId}
                  onChatIdChange={handleChatIdChange}
                  isHistoryPanelOpen={isChatHistoryOpen}
                  onToggleHistoryPanel={() =>
                    setIsChatHistoryOpen((open) => !open)
                  }
                />
                <div className="flex-1 min-h-0 overflow-hidden">
                  <AgentChatPanel
                    key={effectiveChatId}
                    chatId={effectiveChatId}
                    initialMessageToSend={initialMessageToSend}
                  />
                </div>
              </div>

              {/* Right: history sidebar embedded inside Chat page (display on desktop) */}
              {isChatHistoryOpen && (
                <div className="hidden md:flex h-full max-h-screen min-w-[260px] max-w-[360px] w-[320px] flex-col overflow-hidden content-area-card rounded-none border-0 border-l border-border">
                  <ChatHistorySidePanel
                    sortedChats={sortedChatsForChatPage}
                    currentChatId={effectiveChatId ?? null}
                    onSelectChat={(chatId) => handleChatIdChange(chatId)}
                    onNewChat={() => handleChatIdChange(null)}
                    onDeleteChat={handleDeleteChat}
                    hasMore={hasMore}
                    onLoadMore={loadMoreChats}
                    isLoading={isLoadingMore}
                  />
                </div>
              )}
            </div>
          </AgentLayout>
          <InsightDetailDrawer
            insight={selectedInsight}
            isOpen={isInsightDrawerOpen}
            onClose={() => {
              setSelectedInsight(null);
              setIsInsightDrawerOpen(false);
            }}
          />
        </InsightsPaginationProvider>
      );
    }

    // Desktop: render Focus (Brief) or Insight (EventsPanel) based on pathname; embedInCard avoids double-layer border with Shell's content-area-card
    // Desktop: Insight details are displayed embedded in middle card of respective Panel, don't render global drawer, to coexist with right person detail bar
    const closeExternalInsight = () => {
      setSelectedInsight(null);
      setIsInsightDrawerOpen(false);
      const newPath = buildNavigationUrl({
        pathname,
        searchParams,
        paramsToUpdate: { insightDetailId: null },
      });
      router.replace(newPath);
    };

    const leftPanel = isInboxPage ? (
      <AgentEventsPanel
        key="events-panel"
        category={memoizedCategory}
        embedInCard={true}
        externalSelectedInsight={selectedInsight}
        onExternalInsightClose={closeExternalInsight}
      />
    ) : page === null ? (
      <ChatSkeleton key="chat-skeleton" />
    ) : (
      <PanelSkeleton key="panel-skeleton" />
    );

    return (
      <InsightsPaginationProvider>
        <AgentLayout
          centerTitle={centerTitle}
          hideCenterHeader={true}
          centerOverlay={undefined}
        >
          {leftPanel}
        </AgentLayout>
        {/* Desktop doesn't render global drawer (Events/Brief both embedded in middle card); only mobile uses global drawer */}
        {isMobile && (
          <InsightDetailDrawer
            insight={selectedInsight}
            isOpen={isInsightDrawerOpen}
            onClose={() => {
              setSelectedInsight(null);
              setIsInsightDrawerOpen(false);
            }}
          />
        )}
      </InsightsPaginationProvider>
    );
  }

  return (
    <>
      {getPageContent()}

      {/* File preview overlay and drawer */}
      {previewFile && (
        <FilePreviewOverlay
          file={previewFile}
          onClose={closeFilePreviewPanel}
        />
      )}

      {/* Progressive authorization dialog */}
      <AddPlatformDialog
        isOpen={isAddPlatformDialogOpen}
        onOpenChange={(open) => {
          setIsAddPlatformDialogOpen(open);
          if (!open) setLinkingPlatform(null);
        }}
        linkingPlatform={linkingPlatform}
        showTelegramTokenForm={showTelegramTokenForm as () => void}
        setIsGoogleAuthFormOpen={setIsGoogleAuthFormOpen}
        setIsOutlookAuthFormOpen={setIsOutlookAuthFormOpen}
        setIsWhatsAppAuthFormOpen={setIsWhatsAppAuthFormOpen}
        setIsMessengerAuthFormOpen={setIsMessengerAuthFormOpen}
      />
    </>
  );
}
