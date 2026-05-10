"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import { signOut, useSession } from "next-auth/react";
import { Badge, Button } from "@alloomi/ui";
import { RemixIcon } from "@/components/remix-icon";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@alloomi/ui";
import {
  useState,
  useEffect,
  useMemo,
  startTransition,
  useDeferredValue,
} from "react";
import { generateUUID } from "@/lib/utils";
import { useMobileDetection } from "@/hooks/use-mobile-detection";
import { useCustomEvent } from "@alloomi/hooks/use-custom-event";
import "../i18n";
import { Tooltip, TooltipContent, TooltipTrigger } from "@alloomi/ui";
import { toast } from "./toast";
import { isTauri } from "@/lib/tauri";
import useSWR from "swr";
import { fetcher, cn, getHomePath } from "@/lib/utils";
import { UserMenuDropdown } from "@/components/user-menu-dropdown";
import { LanguageSettingsMenu } from "@/components/language-settings-menu";
import { saveLanguage } from "@/i18n";
import dynamic from "next/dynamic";
import ContactUs from "@/components/contact-us";
import { useLocalStorage } from "usehooks-ts";
import { useUserProfile } from "@/hooks/use-user-profile";
import { guestRegex } from "@/lib/env/constants";

/**
 * Stub hook for onboarding state - returns default values since onboarding was removed
 */
function useOnboarding() {
  return {
    isOnboarding: false,
    unlockedNavKeys: new Set<string>(),
  };
}

/** Unified size for RemixIcon in the left sidebar (18px), paired with navigation text font-weight 400. */
const SIDEBAR_NAV_ICON_SIZE = "size-[18px]";

// Bundle optimization: Dynamically import large components
// ContactUs uses static import to avoid dynamic chunk loading failure in Tauri WebView (Failed to load chunk)
const UserMenuFullscreen = dynamic(
  () =>
    import("@/components/user-menu-fullscreen").then((mod) => ({
      default: mod.UserMenuFullscreen,
    })),
  {
    loading: () => (
      <RemixIcon
        name="loader_2"
        size={SIDEBAR_NAV_ICON_SIZE}
        className="animate-spin"
      />
    ),
    ssr: false,
  },
);

const GlobalSearchDialog = dynamic(
  () =>
    import("@/components/global-search-dialog").then((mod) => ({
      default: mod.GlobalSearchDialog,
    })),
  {
    ssr: false,
  },
);

// Extract static navigation items outside component to prevent re-creation on each render.
// Focus page entry is intentionally hidden from sidebar navigation.
const MAIN_NAV_ITEMS: Array<{ title: string; url: string; icon: string }> = [];

export function AppSidebar() {
  const { t, i18n } = useTranslation();

  // Use custom hooks for cleaner state management
  const isMobile = useMobileDetection();
  const [mounted, setMounted] = useState(false);

  const [isMounted, setIsMounted] = useState(false);
  const [currentLang, setCurrentLang] = useState("en-US");
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [chatId, setChatId] = useState<string | null>(null);
  const [canManageCoupons, setCanManageCoupons] = useState(false);
  const [isUserMenuFullscreenOpen, setIsUserMenuFullscreenOpen] =
    useState(false);
  const [isGlobalSearchOpen, setIsGlobalSearchOpen] = useState(false);
  /** Dialog opened when "Contact Us" is clicked from user menu */
  const [contactDialogOpen, setContactDialogOpen] = useState(false);
  const [isContextExpanded, setIsContextExpanded] = useState(true);
  const [isMyStuffExpanded, setIsMyStuffExpanded] = useState(true);

  // Use custom hooks for localStorage sync
  const [contextTimeFilter, setContextTimeFilter] = useLocalStorage<
    "all" | "24h" | "today"
  >("alloomi_focusTimeFilter", "24h");

  const [categoryStats, setCategoryStats] = useLocalStorage<
    Record<string, number>
  >("alloomi_categoryStats", {});

  // Total insights count (not affected by filter conditions)
  const [totalCategoryStats, setTotalCategoryStats] = useLocalStorage<
    Record<string, number>
  >("alloomi_totalCategoryStats", {});

  const [plan, setPlan] = useState<string | null>(null);
  const { profile } = useUserProfile();

  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Use deferred values to prevent blocking UI during navigation
  const deferredPathname = useDeferredValue(pathname);
  const deferredSearchParams = useDeferredValue(searchParams?.toString() ?? "");

  const { data: session, status, update: updateSession } = useSession();
  const router = useRouter();

  // Get user category list
  const { data: categoriesData } = useSWR<{
    categories: Array<{
      id: string;
      name: string;
      isActive: boolean;
      sortOrder: number;
    }>;
  }>(session?.user ? "/api/categories" : null, fetcher, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    dedupingInterval: 60000,
  });

  /**
   * Get enabled category list (maintains sortOrder order)
   */
  const activeCategories = useMemo(() => {
    if (!categoriesData?.categories) {
      return [];
    }
    return categoriesData.categories
      .filter((cat) => cat.isActive)
      .sort((a, b) => a.sortOrder - b.sortOrder) // Sort by sortOrder
      .map((cat) => cat.name);
  }, [categoriesData]);

  /**
   * Get insights count per category (read from localStorage, synced by EventsPanel)
   * All count uses totalCategoryStats (not affected by filter conditions), individual category counts use categoryStats (affected by filter conditions)
   *
   * Optimization: Use JSON.stringify for stable dependency comparison to avoid
   * unnecessary recalculations when the objects are re-created but values are same
   */
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};

    // Initialize all enabled category counts to 0
    activeCategories.forEach((category) => {
      counts[category] = 0;
    });
    counts.all = 0;
    counts.Other = 0;

    // Use category stats synced from EventsPanel (individual category counts)
    if (categoryStats) {
      Object.assign(counts, categoryStats);
    }

    // All count uses totalCategoryStats (not affected by time/read/read filter)
    if (totalCategoryStats && totalCategoryStats.all !== undefined) {
      counts.all = totalCategoryStats.all;
    }

    return counts;
    // Use stringified values for stable comparison - only recalculate when values actually change
  }, [
    JSON.stringify(categoryStats),
    JSON.stringify(totalCategoryStats),
    activeCategories,
  ]);

  /**
   * Toggle visibility of the "My stuff" list.
   */
  function handleToggleMyStuff(): void {
    setIsMyStuffExpanded((prev) => !prev);
  }

  // Listen to URL params, open menu if fromUserMenu=true and no page param
  useEffect(() => {
    if (!isMounted || !isMobile) return;

    const fromUserMenu = searchParams?.get("fromUserMenu");
    const page = searchParams?.get("page");

    // Only open menu when fromUserMenu=true and no page param
    // This way menu won't cover content when user is on sub-pages
    // When user returns to home (no page param), menu will automatically open
    if (fromUserMenu === "true" && !page) {
      setIsUserMenuFullscreenOpen(true);
    } else {
      // If has page param or no fromUserMenu param, close menu
      setIsUserMenuFullscreenOpen(false);
    }
  }, [searchParams, isMounted, isMobile]);

  // Use deferred search params to avoid blocking UI during navigation
  const searchParamsString = isMounted ? deferredSearchParams : "";
  const location = searchParamsString
    ? `${deferredPathname}?${searchParamsString}`
    : deferredPathname;

  // Listen for category stats updates from EventsPanel
  useCustomEvent<Record<string, number>>(
    "alloomi:categoryStatsUpdate",
    (stats) => {
      if (stats) {
        setCategoryStats(stats);
      }
    },
  );

  // Listen for total category stats updates (unfiltered count) from EventsPanel
  useCustomEvent<Record<string, number>>(
    "alloomi:totalCategoryStatsUpdate",
    (stats) => {
      if (stats) {
        setTotalCategoryStats(stats);
      }
    },
  );

  /**
   * Get user display name (nickname)
   */
  const userDisplayName = useMemo(() => {
    return profile?.name;
  }, [profile?.name]);

  /**
   * Get user avatar URL
   */
  const userAvatarUrl = useMemo(() => {
    return profile?.avatarUrl ?? "https://avatar.vercel.sh/default";
  }, [profile?.avatarUrl]);

  useEffect(() => {
    const getCurrentChatId = () => {
      const chatMatch = pathname.match(/^\/chat\/([^\/]+)/);
      return chatMatch ? chatMatch[1] : null;
    };
    const id = getCurrentChatId();
    // Use startTransition to prioritize navigation over state updates
    startTransition(() => {
      setChatId(id);
    });
  }, [pathname, router]);

  useEffect(() => {
    setPlan("free");
  }, [session?.user]);

  // Performance optimization: Check coupon permission only once per session
  // instead of on every render. Store result to avoid repeated checks.
  useEffect(() => {
    let cancelled = false;
    if (!session?.user?.id) {
      setCanManageCoupons(false);
      return;
    }

    // Only check permission if we haven't already checked it
    fetch("/api/admin/coupons?limit=1")
      .then((response) => {
        if (cancelled) return;
        setCanManageCoupons(response.ok);
      })
      .catch(() => {
        if (cancelled) return;
        setCanManageCoupons(false);
      });

    return () => {
      cancelled = true;
    };
  }, [session?.user?.id]);

  const isGuest = guestRegex.test(session?.user?.email ?? "");

  // Onboarding state: used to hide navigation items not yet unlocked during onboarding; during onboarding sidebar is always minimized (logo + avatar only)
  const { isOnboarding, unlockedNavKeys } = useOnboarding();
  /** Whether in "logo + avatar only" minimized sidebar state (minimized regardless of quick setup completion during onboarding) */
  const isSidebarMinimal = isOnboarding;
  /** Determine if a navigation item should be displayed (filtered by unlock status during onboarding) */
  const isNavVisible = (key: string) =>
    !isOnboarding || unlockedNavKeys.has(key);

  // Pre-calculate navigation items with preserved URLs to avoid repeated computation in render
  const navItems = useMemo(() => {
    const items = MAIN_NAV_ITEMS.filter((item) => {
      if (item.url === "/?page=affiliate" && isGuest) {
        return false;
      }
      return true;
    });

    if (canManageCoupons) {
      items.push({
        title: "nav.coupons",
        url: "/?page=coupons",
        icon: "gift",
      });
    }

    // Pre-calculate preserved URLs for each item
    return items.map((item) => ({
      ...item,
      preservedUrl:
        item.url === "/" && chatId ? `/?page=chat&chatId=${chatId}` : item.url,
    }));
  }, [isGuest, canManageCoupons, chatId]);

  /**
   * Determine whether current route is within settings context,
   * so sidebar can switch to contextual sub-navigation.
   */
  const isInSettingsContext = useMemo(() => {
    const currentPage = searchParams?.get("page");
    const isProfileSettingsPage =
      currentPage === "profile" ||
      currentPage === "profile-soul" ||
      currentPage === "alloomi-soul" ||
      currentPage === "account-settings" ||
      currentPage === "profile-edit" ||
      currentPage === "about";
    return isProfileSettingsPage;
  }, [pathname, searchParams]);

  /**
   * Build settings contextual navigation entries shown when user enters settings module.
   * Items with type "external" open documentation or URLs via openUrl (Tauri / web).
   */
  const settingsSubNavItems = useMemo(
    () => [
      {
        key: "account-settings",
        title: "settings.general",
        icon: "equalizer_2",
        type: "internal" as const,
        href: "/?page=account-settings",
      },
      {
        key: "profile-soul",
        title: "settings.profileSoulNavTitle",
        icon: "brain_ai_3",
        type: "internal" as const,
        href: "/?page=profile-soul",
      },
      {
        key: "about",
        title: "about.title",
        icon: "information",
        type: "internal" as const,
        href: "/?page=about",
      },
    ],
    [],
  );

  const handleLanguageChange = (code: string) => {
    saveLanguage(code);
    i18n.changeLanguage(code);
  };

  /** Open "Contact Us" dialog from user dropdown menu (entry when sidebar is collapsed) */
  const onOpenContactUs = () => setContactDialogOpen(true);

  const handleLogout = async () => {
    if (status === "loading") {
      toast({
        type: "error",
        description: "Checking authentication status, please try again!",
      });
      return;
    }

    // Cleanup all listeners (Telegram, WhatsApp, imessage etc.)
    try {
      const userId = session?.user?.id;
      if (userId) {
        await fetch("/api/listeners/cleanup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId }),
        });
      }
    } catch (error) {
      console.error("Failed to cleanup listeners:", error);
      // Do not block logout flow
    }

    // Clear auth cookie (server-side clears httpOnly cookie)
    try {
      await fetch("/api/auth/clear-auth-cookie", {
        method: "POST",
        credentials: "include",
      });
    } catch (error) {
      console.error("Failed to clear auth cookies:", error);
    }

    // Clear auth token from localStorage
    localStorage.removeItem("cloud_auth_token");

    // Tauri environment: additionally clear session stored in file
    if (isTauri()) {
      try {
        await fetch("/api/auth/signout", {
          method: "POST",
        });
      } catch (error) {
        console.error("Failed to clear session file:", error);
        // Do not block logout flow
      }
    }

    // Web: call server to clear session first, then redirect
    if (!isTauri()) {
      try {
        // Call server to clear cloud auth cookies
        await fetch("/api/auth/clear-auth-cookie", {
          method: "POST",
          credentials: "include",
        });
      } catch (error) {
        console.error("Failed to sign out:", error);
      }
      // Redirect to home page
      window.location.replace("/");
      return;
    }

    signOut({
      redirectTo: "/",
    });
  };

  const handleLogin = () => {
    if (status === "loading") {
      toast({
        type: "error",
        description: "Checking authentication status, please try again!",
      });
      return;
    }
    // Use startTransition to prioritize navigation
    startTransition(() => {
      router.push("/");
    });
  };

  useEffect(() => {
    setMounted(true);
    setIsMounted(true);
    if (i18n.language) {
      setCurrentLang(i18n.language);
    }
  }, [i18n.language]);

  // Read saved state from localStorage when client mounts (do not restore expanded state in minimized mode)
  useEffect(() => {
    if (typeof window !== "undefined" && !isMobile && !isSidebarMinimal) {
      const saved = localStorage.getItem("sidebar-collapsed");
      if (saved !== null) {
        setIsCollapsed(saved === "true");
      }
    }
  }, [isMobile, isSidebarMinimal]);

  useEffect(() => {
    if (isMobile) {
      setIsCollapsed(true);
    }
  }, [isMobile]);

  // Save sidebar state to localStorage (only save on non-mobile)
  useEffect(() => {
    if (typeof window !== "undefined" && !isMobile && isMounted) {
      localStorage.setItem("sidebar-collapsed", String(isCollapsed));
    }
  }, [isCollapsed, isMobile, isMounted]);

  // Do not allow sidebar expansion in minimized mode
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handleOpenSidebar = () => {
      if (!isSidebarMinimal) setIsCollapsed(false);
    };

    window.addEventListener("alloomi:open-sidebar", handleOpenSidebar);

    return () => {
      window.removeEventListener("alloomi:open-sidebar", handleOpenSidebar);
    };
  }, [isSidebarMinimal]);

  // Force collapsed in minimized mode and cannot expand
  const effectiveCollapsed = isSidebarMinimal ? true : isCollapsed;
  useEffect(() => {
    if (isSidebarMinimal) setIsCollapsed(true);
  }, [isSidebarMinimal]);

  const collapsedWidthClass = isMobile ? "w-0" : "w-16";
  const offsetClass = isMobile
    ? "ml-0"
    : effectiveCollapsed
      ? "ml-16"
      : "ml-64";

  // On mobile, if page param exists (on sub-page), completely hide sidebar
  const page = searchParams?.get("page");
  const shouldHideSidebarOnMobile = isMobile && page !== null;

  return (
    <>
      <div
        className={`transition-all duration-300 ${isMobile ? "w-0 px-0" : offsetClass}`}
      >
        <div
          className={`fixed ${
            isMobile
              ? "left-0 top-0 h-screen pb-[64px] safe-area-inset-bottom"
              : "left-0 top-0 h-full"
          } ${isMobile ? "bg-background" : "bg-sidebar"} transition-all duration-300 ${
            isMobile && shouldHideSidebarOnMobile
              ? "z-0"
              : isMobile
                ? "z-40"
                : "z-50"
          } ${
            isMobile
              ? effectiveCollapsed || shouldHideSidebarOnMobile
                ? "w-0"
                : "w-full"
              : effectiveCollapsed
                ? collapsedWidthClass
                : "w-64"
          } ${
            isMobile && (effectiveCollapsed || shouldHideSidebarOnMobile)
              ? "-translate-x-full opacity-0 pointer-events-none"
              : "translate-x-0"
          } overflow-hidden`}
        >
          <div className="flex flex-col h-full">
            {/* Logo & Header: logo only when minimized and cannot expand; symmetric 12px horizontal padding when expanded; logo clickable to expand when collapsed */}
            <div
              className={
                effectiveCollapsed ? "px-0 py-3 pr-0" : "pl-3 pr-3 pt-3 pb-0"
              }
              style={effectiveCollapsed ? { paddingRight: 0 } : undefined}
            >
              <div className="flex items-center justify-start w-full">
                {isInSettingsContext ? (
                  <Button
                    type="button"
                    variant="ghost"
                    className={cn(
                      // Settings: Back / Language / Log out — same color as main content area text-muted-foreground hint text (including hover)
                      "w-full rounded-md transition-colors text-muted-foreground hover:bg-sidebar-hover hover:text-muted-foreground",
                      effectiveCollapsed
                        ? "size-8 p-0 mx-auto justify-center"
                        : "h-10 justify-start gap-2 px-3 py-2",
                    )}
                    onClick={() => {
                      startTransition(() => {
                        router.push(getHomePath());
                        if (isMobile) {
                          setIsCollapsed(true);
                          window.dispatchEvent(
                            new CustomEvent("alloomi:close-sidebar"),
                          );
                        }
                      });
                    }}
                    aria-label={t("common.back")}
                  >
                    <RemixIcon
                      name="arrow_left_s"
                      size={SIDEBAR_NAV_ICON_SIZE}
                    />
                    {!effectiveCollapsed && (
                      <span className="truncate font-normal">
                        {t("common.back")}
                      </span>
                    )}
                  </Button>
                ) : !effectiveCollapsed ? (
                  <>
                    <div className="flex items-center justify-start gap-1 w-full">
                      <div className="flex flex-row">
                        <div className="flex items-center gap-2">
                          <Image
                            src="/images/logo-full-light.svg"
                            alt="Alloomi Logo"
                            width={96}
                            height={24}
                            className="h-5 w-auto object-contain shrink-0"
                          />
                          <Badge
                            variant="outline"
                            className="border border-accent-700 bg-[linear-gradient(90deg,#FDF6EF_0%,#F1F5F9_100%)] text-accent-brand text-[10px] font-bold uppercase tracking-[0.12em] px-2 py-0.5 rounded-lg"
                          >
                            Alpha
                          </Badge>
                        </div>
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="ml-0 shrink-0 p-2 hover:bg-transparent hover:text-foreground"
                      onClick={() => {
                        setIsCollapsed(true);
                        window.dispatchEvent(
                          new CustomEvent("alloomi:close-sidebar"),
                        );
                      }}
                      aria-label={t("toggleSidebar")}
                      suppressHydrationWarning
                    >
                      <RemixIcon
                        name="sidebar_fold"
                        size={SIDEBAR_NAV_ICON_SIZE}
                      />
                    </Button>
                  </>
                ) : (
                  <button
                    type="button"
                    className={cn(
                      "size-8 flex items-center justify-center mx-auto bg-transparent border-0",
                      !isSidebarMinimal &&
                        "cursor-pointer hover:bg-sidebar-hover rounded-md",
                    )}
                    disabled={isSidebarMinimal}
                    onClick={
                      isSidebarMinimal ? undefined : () => setIsCollapsed(false)
                    }
                    aria-label={
                      isSidebarMinimal ? undefined : t("toggleSidebar")
                    }
                    suppressHydrationWarning
                  >
                    <Image
                      src="/images/logo_web.png"
                      alt="Alloomi Logo"
                      width={24}
                      height={24}
                      className="object-contain"
                    />
                  </button>
                )}
              </div>
            </div>

            {/* Navigation: do not show any navigation items when minimized */}
            {!isSidebarMinimal && (
              <div className="flex-1 p-3 pt-3 overflow-y-auto flex flex-col">
                <nav className="flex flex-col gap-1.5 flex-shrink-0">
                  {isInSettingsContext &&
                    settingsSubNavItems.map((item) => {
                      const isActive =
                        (item.href === "/?page=profile" &&
                          searchParams?.get("page") === "profile") ||
                        (item.href === "/?page=profile-soul" &&
                          searchParams?.get("page") === "profile-soul") ||
                        (item.href === "/?page=account-settings" &&
                          (searchParams?.get("page") === "account-settings" ||
                            searchParams?.get("page") === "profile-edit")) ||
                        (item.href === "/?page=about" &&
                          searchParams?.get("page") === "about");

                      return (
                        <Tooltip key={item.key}>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              className={cn(
                                "w-full gap-2 px-3 py-2 h-auto rounded-md transition-colors",
                                isCollapsed
                                  ? "justify-center"
                                  : "justify-start",
                                isActive
                                  ? "text-primary"
                                  : "text-sidebar-foreground hover:bg-sidebar-hover hover:text-sidebar-hover-foreground",
                              )}
                              onClick={() => {
                                if (item.href) {
                                  startTransition(() => {
                                    router.push(item.href);
                                    if (isMobile) {
                                      setIsCollapsed(true);
                                      window.dispatchEvent(
                                        new CustomEvent(
                                          "alloomi:close-sidebar",
                                        ),
                                      );
                                    }
                                  });
                                }
                              }}
                            >
                              <RemixIcon
                                name={item.icon}
                                filled={isActive}
                                size={SIDEBAR_NAV_ICON_SIZE}
                                className={
                                  isActive ? "text-primary" : undefined
                                }
                              />
                              {!isCollapsed && (
                                <span
                                  className={cn(
                                    "truncate",
                                    isActive
                                      ? "font-normal text-primary"
                                      : "font-normal text-sidebar-foreground",
                                  )}
                                >
                                  {t(item.title)}
                                </span>
                              )}
                            </Button>
                          </TooltipTrigger>
                        </Tooltip>
                      );
                    })}

                  {!isInSettingsContext && (
                    <>
                      {navItems.map((item) => {
                        // Use pre-calculated preservedUrl from memoized navItems
                        const targetUrl = item.preservedUrl;
                        const tourId =
                          item.title === "nav.subscriptions"
                            ? "nav-subscriptions"
                            : undefined;
                        const isActive = location === targetUrl;
                        return (
                          <Tooltip key={item.title}>
                            <TooltipTrigger asChild>
                              <Button
                                asChild
                                variant="ghost"
                                className={cn(
                                  "w-full gap-2 px-3 py-2 h-auto rounded-md transition-colors",
                                  isCollapsed
                                    ? "justify-center"
                                    : "justify-start",
                                  isActive
                                    ? "text-primary"
                                    : "text-sidebar-foreground hover:bg-sidebar-hover hover:text-sidebar-hover-foreground",
                                )}
                              >
                                <Link
                                  href={targetUrl}
                                  data-tour={tourId}
                                  className={cn(
                                    "flex items-center w-full min-h-0",
                                    isCollapsed
                                      ? "justify-center"
                                      : "gap-2 justify-start",
                                  )}
                                  onClick={() => {
                                    // Close sidebar after clicking navigation item on mobile
                                    if (isMobile) {
                                      startTransition(() => {
                                        setIsCollapsed(true);
                                      });
                                      window.dispatchEvent(
                                        new CustomEvent(
                                          "alloomi:close-sidebar",
                                        ),
                                      );
                                    }
                                  }}
                                >
                                  <RemixIcon
                                    name={
                                      typeof item.icon === "string"
                                        ? item.icon
                                        : "robot_2"
                                    }
                                    filled={isActive}
                                    size={SIDEBAR_NAV_ICON_SIZE}
                                    className={
                                      isActive ? "text-primary" : undefined
                                    }
                                  />
                                  {!isCollapsed && (
                                    <span
                                      className={cn(
                                        "truncate",
                                        isActive
                                          ? "font-normal text-primary"
                                          : "font-normal text-sidebar-foreground",
                                      )}
                                    >
                                      {t(item.title)}
                                    </span>
                                  )}
                                </Link>
                              </Button>
                            </TooltipTrigger>
                          </Tooltip>
                        );
                      })}

                      {/* New Chat - opens as right panel under Focus/Tracking, keeping left Insight/Focus visible; otherwise chat page only */}
                      {isNavVisible("chat") &&
                        (() => {
                          const isNewChatActive =
                            pathname === "/" &&
                            searchParams?.get("page") === "chat";
                          return (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  className={cn(
                                    "w-full gap-2 px-3 py-2 h-auto rounded-md transition-colors",
                                    isCollapsed
                                      ? "justify-center"
                                      : "justify-start",
                                    isNewChatActive
                                      ? "text-primary"
                                      : "text-sidebar-foreground hover:bg-sidebar-hover hover:text-sidebar-hover-foreground",
                                  )}
                                  onClick={() => {
                                    const newChatId = generateUUID();
                                    // "New Chat" in left sidebar: enters full-screen chat page (standalone page), not right panel
                                    // Use startTransition to prioritize navigation over sidebar state update
                                    startTransition(() => {
                                      router.push(
                                        `/?page=chat&chatId=${encodeURIComponent(newChatId)}`,
                                      );
                                      if (isMobile) {
                                        setIsCollapsed(true);
                                        window.dispatchEvent(
                                          new CustomEvent(
                                            "alloomi:close-sidebar",
                                          ),
                                        );
                                      }
                                    });
                                  }}
                                  aria-label={t("nav.newChat")}
                                >
                                  <RemixIcon
                                    name="chat_ai"
                                    size={SIDEBAR_NAV_ICON_SIZE}
                                    filled={isNewChatActive}
                                    className={
                                      isNewChatActive
                                        ? "text-primary"
                                        : undefined
                                    }
                                  />
                                  {!isCollapsed && (
                                    <span
                                      className={cn(
                                        "truncate font-normal",
                                        isNewChatActive
                                          ? "text-primary"
                                          : "text-sidebar-foreground",
                                      )}
                                    >
                                      {t("nav.newChat")}
                                    </span>
                                  )}
                                </Button>
                              </TooltipTrigger>
                            </Tooltip>
                          );
                        })()}

                      {/* Insight analytics entry - exposes /inbox from the primary sidebar. */}
                      {isNavVisible("chat") && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              className={cn(
                                "w-full gap-2 px-3 py-2 h-auto rounded-md transition-colors",
                                pathname === "/inbox"
                                  ? "text-primary bg-sidebar-hover"
                                  : "text-sidebar-foreground hover:bg-sidebar-hover hover:text-sidebar-hover-foreground",
                                isCollapsed
                                  ? "justify-center"
                                  : "justify-start",
                              )}
                              aria-current={
                                pathname === "/inbox" ? "page" : undefined
                              }
                              asChild
                            >
                              <Link
                                href="/inbox"
                                onClick={() => {
                                  if (isMobile) {
                                    setIsCollapsed(true);
                                    window.dispatchEvent(
                                      new CustomEvent("alloomi:close-sidebar"),
                                    );
                                  }
                                }}
                                className={cn(
                                  "flex items-center w-full min-h-0",
                                  isCollapsed
                                    ? "justify-center"
                                    : "gap-2 justify-start",
                                )}
                              >
                                <RemixIcon
                                  name="radar"
                                  size={SIDEBAR_NAV_ICON_SIZE}
                                  filled={pathname === "/inbox"}
                                  className={
                                    pathname === "/inbox" ? "text-primary" : ""
                                  }
                                />
                                {!isCollapsed && (
                                  <span
                                    className={cn(
                                      "truncate font-normal",
                                      pathname === "/inbox"
                                        ? "text-primary"
                                        : "text-sidebar-foreground",
                                    )}
                                  >
                                    {t("nav.insights", "Tracking Events")}
                                  </span>
                                )}
                              </Link>
                            </Button>
                          </TooltipTrigger>
                          {isCollapsed && (
                            <TooltipContent
                              side="right"
                              className="border border-border bg-card text-card-foreground z-[9999]"
                            >
                              <p>{t("nav.insights", "Tracking Events")}</p>
                            </TooltipContent>
                          )}
                        </Tooltip>
                      )}

                      {/* Collection - temporarily hidden */}
                      {/* <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      asChild
                      variant="ghost"
                      className={cn(
                        "w-full gap-2 px-3 py-2 h-auto rounded-md transition-colors",
                        isCollapsed ? "justify-center" : "justify-start",
                        pathname === "/" &&
                          searchParams?.get("page") === "favorites"
                          ? "text-primary"
                          : "text-sidebar-foreground hover:bg-sidebar-hover hover:text-sidebar-hover-foreground",
                      )}
                    >
                      <Link
                        href="/?page=favorites"
                        onClick={() => {
                          if (isMobile) {
                            setIsCollapsed(true);
                            window.dispatchEvent(
                              new CustomEvent("alloomi:close-sidebar"),
                            );
                          }
                        }}
                        className={cn(
                          "flex items-center w-full min-h-0",
                          isCollapsed
                            ? "justify-center"
                            : "gap-2 justify-start",
                        )}
                      >
                        <RemixIcon
                          name="bookmark"
                          filled={
                            pathname === "/" &&
                            searchParams?.get("page") === "favorites"
                          }
                          size={SIDEBAR_NAV_ICON_SIZE}
                        />
                        {!isCollapsed && (
                          <span
                            className={cn(
                              "truncate font-normal",
                              pathname === "/" &&
                                searchParams?.get("page") === "favorites"
                                ? "text-primary"
                                : "text-sidebar-foreground",
                            )}
                          >
                            {t("nav.favorites")}
                          </span>
                        )}
                      </Link>
                    </Button>
                  </TooltipTrigger>
                  {isCollapsed && (
                    <TooltipContent
                      side="right"
                      className="border border-border bg-card text-card-foreground z-[9999]"
                    >
                      <p>{t("nav.favorites")}</p>
                    </TooltipContent>
                  )}
                </Tooltip> */}

                      {/* Connectors (linked accounts / integrations) — same unlock as Library */}
                      {isNavVisible("workspace") && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              className={cn(
                                "w-full gap-2 px-3 py-2 h-auto rounded-md transition-colors",
                                pathname === "/connectors"
                                  ? "text-primary bg-sidebar-hover"
                                  : "text-sidebar-foreground hover:bg-sidebar-hover hover:text-sidebar-hover-foreground",
                                isCollapsed
                                  ? "justify-center"
                                  : "justify-start",
                              )}
                              aria-current={
                                pathname === "/connectors" ? "page" : undefined
                              }
                              asChild
                            >
                              <Link
                                href="/connectors"
                                onClick={() => {
                                  if (isMobile) {
                                    setIsCollapsed(true);
                                    window.dispatchEvent(
                                      new CustomEvent("alloomi:close-sidebar"),
                                    );
                                  }
                                }}
                                className={cn(
                                  "flex items-center w-full min-h-0",
                                  isCollapsed
                                    ? "justify-center"
                                    : "gap-2 justify-start",
                                )}
                              >
                                <RemixIcon
                                  name="connector"
                                  size={SIDEBAR_NAV_ICON_SIZE}
                                  filled={pathname === "/connectors"}
                                  className={
                                    pathname === "/connectors"
                                      ? "text-primary"
                                      : ""
                                  }
                                />
                                {!isCollapsed && (
                                  <span
                                    className={cn(
                                      "truncate font-normal",
                                      pathname === "/connectors"
                                        ? "text-primary"
                                        : "text-sidebar-foreground",
                                    )}
                                  >
                                    {t("nav.connectors", "Connectors")}
                                  </span>
                                )}
                              </Link>
                            </Button>
                          </TooltipTrigger>
                        </Tooltip>
                      )}

                      {/* Scheduled Jobs - above search, use router.push to ensure reliable Tauri/client navigation */}
                      {isNavVisible("scheduled-jobs") && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              className={cn(
                                "w-full gap-2 px-3 py-2 h-auto rounded-md transition-colors flex items-center",
                                isCollapsed
                                  ? "justify-center"
                                  : "justify-start",
                                pathname === "/scheduled-jobs"
                                  ? "text-primary"
                                  : "text-sidebar-foreground hover:bg-sidebar-hover hover:text-sidebar-hover-foreground",
                              )}
                              onClick={() => {
                                // Use startTransition to prioritize navigation
                                startTransition(() => {
                                  router.push("/scheduled-jobs");
                                  if (isMobile) {
                                    setIsCollapsed(true);
                                    window.dispatchEvent(
                                      new CustomEvent("alloomi:close-sidebar"),
                                    );
                                  }
                                });
                              }}
                              aria-current={
                                pathname === "/scheduled-jobs"
                                  ? "page"
                                  : undefined
                              }
                            >
                              <RemixIcon
                                name="robot_3"
                                size={SIDEBAR_NAV_ICON_SIZE}
                                filled={pathname === "/scheduled-jobs"}
                                className={
                                  pathname === "/scheduled-jobs"
                                    ? "text-primary"
                                    : ""
                                }
                              />
                              {!isCollapsed && (
                                <span
                                  className={cn(
                                    "truncate font-normal",
                                    pathname === "/scheduled-jobs"
                                      ? "text-primary"
                                      : "text-sidebar-foreground",
                                  )}
                                >
                                  {t("nav.agent", "Agent")}
                                </span>
                              )}
                            </Button>
                          </TooltipTrigger>
                        </Tooltip>
                      )}

                      {/* Library - standalone page entry */}
                      {isNavVisible("workspace") && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              className={cn(
                                "w-full gap-2 px-3 py-2 h-auto rounded-md transition-colors",
                                pathname === "/workspace"
                                  ? "text-primary bg-sidebar-hover"
                                  : "text-sidebar-foreground hover:bg-sidebar-hover hover:text-sidebar-hover-foreground",
                                isCollapsed
                                  ? "justify-center"
                                  : "justify-start",
                              )}
                              aria-current={
                                pathname === "/workspace" ? "page" : undefined
                              }
                              asChild
                            >
                              <Link
                                href="/workspace"
                                onClick={() => {
                                  if (isMobile) {
                                    setIsCollapsed(true);
                                    window.dispatchEvent(
                                      new CustomEvent("alloomi:close-sidebar"),
                                    );
                                  }
                                }}
                                className={cn(
                                  "flex items-center w-full min-h-0",
                                  isCollapsed
                                    ? "justify-center"
                                    : "gap-2 justify-start",
                                )}
                              >
                                <RemixIcon
                                  name="stack_overflow"
                                  size={SIDEBAR_NAV_ICON_SIZE}
                                  className={
                                    pathname === "/workspace"
                                      ? "text-primary"
                                      : ""
                                  }
                                />
                                {!isCollapsed && (
                                  <span
                                    className={cn(
                                      "truncate font-normal",
                                      pathname === "/workspace"
                                        ? "text-primary"
                                        : "text-sidebar-foreground",
                                    )}
                                  >
                                    {t("nav.workspace", "Library")}
                                  </span>
                                )}
                              </Link>
                            </Button>
                          </TooltipTrigger>
                        </Tooltip>
                      )}

                      {/* Search button - below workspace */}
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            className={cn(
                              "w-full gap-2 px-3 py-2 h-auto rounded-md transition-colors flex items-center text-sidebar-foreground hover:bg-sidebar-hover hover:text-sidebar-hover-foreground",
                              isCollapsed ? "justify-center" : "justify-start",
                            )}
                            onClick={() => {
                              setIsGlobalSearchOpen(true);
                              if (isMobile) {
                                setIsCollapsed(true);
                                window.dispatchEvent(
                                  new CustomEvent("alloomi:close-sidebar"),
                                );
                              }
                            }}
                          >
                            <RemixIcon
                              name="search"
                              size={SIDEBAR_NAV_ICON_SIZE}
                            />
                            {!isCollapsed && (
                              <span className="truncate font-normal text-sidebar-foreground">
                                {t("common.search")}
                              </span>
                            )}
                          </Button>
                        </TooltipTrigger>
                      </Tooltip>

                      {/* When collapsed: hide context submenu trigger per UX requirement */}
                      {false && isCollapsed && !isMobile && (
                        <DropdownMenu>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="ghost"
                                  className="w-full justify-center gap-2 px-3 py-2 h-auto rounded-md transition-colors text-sidebar-foreground hover:bg-sidebar-hover hover:text-sidebar-hover-foreground flex items-center"
                                >
                                  <RemixIcon
                                    name="radar"
                                    size={SIDEBAR_NAV_ICON_SIZE}
                                  />
                                </Button>
                              </DropdownMenuTrigger>
                            </TooltipTrigger>
                          </Tooltip>
                          <DropdownMenuContent
                            side="right"
                            align="start"
                            sideOffset={8}
                            className="min-w-[10rem] max-h-[min(20rem,70vh)] overflow-y-auto border border-border bg-card text-card-foreground z-[9999]"
                          >
                            {/* All */}
                            <DropdownMenuItem
                              onSelect={() => {
                                // Direct jump to /inbox, not preserving any current params
                                window.location.href = "/inbox";
                              }}
                              className="cursor-pointer"
                            >
                              <span className="flex-1">
                                {t("nav.contextAll", "All")}
                              </span>
                              {categoryCounts.all > 0 && (
                                <span className="ml-auto rounded-full px-1 py-px text-xs font-medium bg-primary/10 text-primary">
                                  {categoryCounts.all}
                                </span>
                              )}
                            </DropdownMenuItem>
                            {/* Each context category */}
                            {(activeCategories.length > 0
                              ? [...activeCategories, "Other"]
                              : []
                            ).map((category) => {
                              const isActive =
                                searchParams?.get("category") === category;
                              return (
                                <DropdownMenuItem
                                  key={category}
                                  onSelect={() => {
                                    // Use startTransition to prioritize navigation
                                    startTransition(() => {
                                      router.push(
                                        `/inbox?category=${encodeURIComponent(category)}`,
                                      );
                                    });
                                  }}
                                  className={cn(
                                    "cursor-pointer",
                                    isActive && "bg-sidebar-hover font-normal",
                                  )}
                                >
                                  <span className="flex-1">
                                    {category === "Other"
                                      ? t("nav.contextOther", "Other")
                                      : t(
                                          `settings.contextTemplates.${category}.name`,
                                          category,
                                        )}
                                  </span>
                                  {categoryCounts[category] > 0 && (
                                    <span className="ml-auto rounded-full px-1 py-px text-xs font-medium bg-primary/10 text-primary">
                                      {categoryCounts[category]}
                                    </span>
                                  )}
                                </DropdownMenuItem>
                              );
                            })}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </>
                  )}
                </nav>

                {isInSettingsContext && (
                  <div className="mt-auto pt-3">
                    <LanguageSettingsMenu
                      variant="settings-sidebar"
                      currentLang={currentLang}
                      onLanguageChange={handleLanguageChange}
                      isMobile={isMobile}
                      sidebarCollapsed={isCollapsed}
                    />
                  </div>
                )}
              </div>
            )}
            {isSidebarMinimal && <div className="flex-1 min-h-0" aria-hidden />}

            {/* Bottom Actions: hidden in settings contextual sub-navigation mode */}
            {!isInSettingsContext && (
              <div
                className="px-3 py-3 md:px-3 md:py-3 w-full box-border overflow-hidden"
                style={
                  isMobile
                    ? {
                        paddingBottom: "12px",
                        maxWidth: "100vw",
                        overflowX: "hidden",
                        marginTop: "0.5rem",
                      }
                    : undefined
                }
              >
                {isSidebarMinimal ? (
                  /* Minimized sidebar: logo + avatar only, avatar can still open account menu */
                  <div className="flex w-full justify-center">
                    {!mounted ? (
                      <div className="w-full h-12 animate-pulse bg-muted/50 rounded-md" />
                    ) : isMobile ? (
                      <>
                        <Button
                          variant="ghost"
                          className="size-8 p-0 shrink-0 rounded-md text-sidebar-foreground hover:bg-sidebar-hover hover:text-sidebar-hover-foreground"
                          onClick={() => setIsUserMenuFullscreenOpen(true)}
                        >
                          <div className="shrink-0 w-6 h-6 rounded-full overflow-hidden">
                            <Image
                              src={userAvatarUrl}
                              alt={"User Avatar"}
                              width={24}
                              height={24}
                              className="w-full h-full object-cover"
                              suppressHydrationWarning
                            />
                          </div>
                        </Button>
                        <UserMenuFullscreen
                          session={session}
                          isLoadingCredit={false}
                          plan={plan}
                          currentLang={currentLang}
                          isOpen={isUserMenuFullscreenOpen}
                          onClose={() => {
                            setIsUserMenuFullscreenOpen(false);
                            const currentParams = new URLSearchParams(
                              window.location.search,
                            );
                            if (currentParams.get("fromUserMenu") === "true") {
                              currentParams.delete("fromUserMenu");
                              const newUrl = currentParams.toString()
                                ? `${window.location.pathname}?${currentParams.toString()}`
                                : window.location.pathname;
                              startTransition(() => router.push(newUrl));
                            }
                          }}
                          onLanguageChange={handleLanguageChange}
                          onLogin={handleLogin}
                          onCloseSidebar={() => setIsCollapsed(true)}
                          onOpenContactUs={onOpenContactUs}
                        />
                      </>
                    ) : (
                      <UserMenuDropdown
                        session={session}
                        isLoadingCredit={false}
                        plan={plan}
                        currentLang={currentLang}
                        isMobile={isMobile}
                        onLanguageChange={handleLanguageChange}
                        onLogin={handleLogin}
                        onCloseSidebar={() => setIsCollapsed(true)}
                        onOpenContactUs={onOpenContactUs}
                      >
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            className="size-8 p-0 shrink-0 rounded-md text-sidebar-foreground hover:bg-sidebar-hover hover:text-sidebar-hover-foreground"
                          >
                            <div className="shrink-0 w-6 h-6 rounded-full overflow-hidden">
                              <Image
                                src={userAvatarUrl}
                                alt={"User Avatar"}
                                width={24}
                                height={24}
                                className="w-full h-full object-cover"
                                suppressHydrationWarning
                              />
                            </div>
                          </Button>
                        </DropdownMenuTrigger>
                      </UserMenuDropdown>
                    )}
                  </div>
                ) : !mounted ? (
                  <div className="w-full h-12 animate-pulse bg-muted/50 rounded-md" />
                ) : isMobile ? (
                  <>
                    <div
                      className={cn(
                        "flex w-full gap-1",
                        isCollapsed
                          ? "flex-col items-center justify-center"
                          : "flex-row items-center",
                      )}
                    >
                      {/* When collapsed: personalization above avatar */}
                      {isCollapsed && (
                        <Tooltip open={false}>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-8 shrink-0 text-sidebar-foreground hover:bg-sidebar-hover hover:text-sidebar-hover-foreground"
                              aria-label={t(
                                "nav.personalization",
                                "Personalization",
                              )}
                              onClick={() => {
                                window.dispatchEvent(
                                  new CustomEvent(
                                    "alloomi:open-personalization",
                                  ),
                                );
                                setIsCollapsed(true);
                                window.dispatchEvent(
                                  new CustomEvent("alloomi:close-sidebar"),
                                );
                              }}
                            >
                              <RemixIcon
                                name="brain_ai_3"
                                size={SIDEBAR_NAV_ICON_SIZE}
                                className="shrink-0"
                              />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent
                            side="right"
                            className="border border-border bg-card text-card-foreground z-[9999]"
                          >
                            <p>{t("nav.personalization", "Personalization")}</p>
                          </TooltipContent>
                        </Tooltip>
                      )}
                      <div
                        className={cn(
                          "flex w-full items-center gap-0",
                          isCollapsed ? "justify-center" : "justify-between",
                        )}
                      >
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              className="size-8 p-0 shrink-0 rounded-md text-sidebar-foreground hover:bg-sidebar-hover hover:text-sidebar-hover-foreground"
                              onClick={() => {
                                setIsUserMenuFullscreenOpen(true);
                              }}
                            >
                              <div className="shrink-0 w-6 h-6 rounded-full overflow-hidden">
                                <Image
                                  src={userAvatarUrl}
                                  alt={"User Avatar"}
                                  width={24}
                                  height={24}
                                  className="w-full h-full object-cover"
                                  suppressHydrationWarning
                                />
                              </div>
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent
                            side="right"
                            className="border border-border bg-card text-card-foreground shadow-lg z-[9999]"
                          >
                            <p>{t("nav.myAccount")}</p>
                          </TooltipContent>
                        </Tooltip>
                        {/* When expanded: personalization right-aligned */}
                        {!isCollapsed && (
                          <div className="ml-auto flex items-center gap-1 shrink-0">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="size-8 shrink-0 text-sidebar-foreground hover:bg-sidebar-hover hover:text-sidebar-hover-foreground"
                                  aria-label={t(
                                    "nav.personalization",
                                    "Personalization",
                                  )}
                                  onClick={() => {
                                    window.dispatchEvent(
                                      new CustomEvent(
                                        "alloomi:open-personalization",
                                      ),
                                    );
                                    setIsCollapsed(true);
                                    window.dispatchEvent(
                                      new CustomEvent("alloomi:close-sidebar"),
                                    );
                                  }}
                                >
                                  <RemixIcon
                                    name="brain_ai_3"
                                    size={SIDEBAR_NAV_ICON_SIZE}
                                    className="shrink-0"
                                  />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent
                                side="right"
                                className="border border-border bg-card text-card-foreground z-[9999]"
                              >
                                <p>
                                  {t("nav.personalization", "Personalization")}
                                </p>
                              </TooltipContent>
                            </Tooltip>
                          </div>
                        )}
                      </div>
                    </div>
                    <UserMenuFullscreen
                      session={session}
                      isLoadingCredit={false}
                      plan={plan}
                      currentLang={currentLang}
                      isOpen={isUserMenuFullscreenOpen}
                      onClose={() => {
                        setIsUserMenuFullscreenOpen(false);
                        // Remove fromUserMenu param when closing menu
                        const currentParams = new URLSearchParams(
                          window.location.search,
                        );
                        if (currentParams.get("fromUserMenu") === "true") {
                          currentParams.delete("fromUserMenu");
                          const newUrl = currentParams.toString()
                            ? `${window.location.pathname}?${currentParams.toString()}`
                            : window.location.pathname;
                          // Use startTransition to prioritize navigation
                          startTransition(() => {
                            router.push(newUrl);
                          });
                        }
                      }}
                      onLanguageChange={handleLanguageChange}
                      onLogin={handleLogin}
                      onCloseSidebar={() => setIsCollapsed(true)}
                      onOpenContactUs={onOpenContactUs}
                    />
                  </>
                ) : (
                  <div
                    className={cn(
                      "flex w-full gap-1 rounded-md overflow-hidden",
                      isCollapsed
                        ? "flex-col items-center justify-center"
                        : "flex-row items-center",
                    )}
                  >
                    {/* When collapsed: personalization above avatar */}
                    {isCollapsed && (
                      <Tooltip open={false}>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8 shrink-0 text-sidebar-foreground hover:bg-sidebar-hover hover:text-sidebar-hover-foreground"
                            aria-label={t(
                              "nav.personalization",
                              "Personalization",
                            )}
                            onClick={() => {
                              window.dispatchEvent(
                                new CustomEvent("alloomi:open-personalization"),
                              );
                            }}
                          >
                            <RemixIcon
                              name="brain_ai_3"
                              size={SIDEBAR_NAV_ICON_SIZE}
                              className="shrink-0"
                            />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent
                          side="right"
                          className="border border-border bg-card text-card-foreground z-[9999]"
                        >
                          <p>{t("nav.personalization", "Personalization")}</p>
                        </TooltipContent>
                      </Tooltip>
                    )}
                    <div
                      className={cn(
                        "flex w-full items-center gap-0",
                        isCollapsed ? "justify-center" : "justify-between",
                      )}
                    >
                      <UserMenuDropdown
                        session={session}
                        isLoadingCredit={false}
                        plan={plan}
                        currentLang={currentLang}
                        isMobile={isMobile}
                        onLanguageChange={handleLanguageChange}
                        onLogin={handleLogin}
                        onCloseSidebar={() => setIsCollapsed(true)}
                        onOpenContactUs={onOpenContactUs}
                      >
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                className="size-8 p-0 shrink-0 rounded-md text-sidebar-foreground hover:bg-sidebar-hover hover:text-sidebar-hover-foreground"
                              >
                                <div className="shrink-0 w-6 h-6 rounded-full overflow-hidden">
                                  <Image
                                    src={userAvatarUrl}
                                    alt={"User Avatar"}
                                    width={24}
                                    height={24}
                                    className="w-full h-full object-cover"
                                    suppressHydrationWarning
                                  />
                                </div>
                              </Button>
                            </DropdownMenuTrigger>
                          </TooltipTrigger>
                          <TooltipContent
                            side="right"
                            className="border border-border bg-card text-card-foreground shadow-lg z-[9999]"
                          >
                            <p>{t("nav.myAccount")}</p>
                          </TooltipContent>
                        </Tooltip>
                      </UserMenuDropdown>
                      {!isCollapsed && (
                        <div className="ml-auto flex items-center gap-1 shrink-0">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-8 shrink-0 text-sidebar-foreground hover:bg-sidebar-hover hover:text-sidebar-hover-foreground"
                                aria-label={t(
                                  "settings.menuSettings",
                                  "Settings",
                                )}
                                onClick={() => {
                                  router.push("/?page=account-settings");
                                }}
                              >
                                <RemixIcon
                                  name="settings_line"
                                  size={SIDEBAR_NAV_ICON_SIZE}
                                  className="shrink-0"
                                />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent
                              side="right"
                              className="border border-border bg-card text-card-foreground z-[9999]"
                            >
                              <p>{t("settings.menuSettings", "Settings")}</p>
                            </TooltipContent>
                          </Tooltip>

                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-8 shrink-0 text-sidebar-foreground hover:bg-sidebar-hover hover:text-sidebar-hover-foreground"
                                aria-label={t(
                                  "nav.personalization",
                                  "Personalization",
                                )}
                                onClick={() => {
                                  window.dispatchEvent(
                                    new CustomEvent(
                                      "alloomi:open-personalization",
                                    ),
                                  );
                                }}
                              >
                                <RemixIcon
                                  name="brain_ai_3"
                                  size={SIDEBAR_NAV_ICON_SIZE}
                                  className="shrink-0"
                                />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent
                              side="right"
                              className="border border-border bg-card text-card-foreground z-[9999]"
                            >
                              <p>
                                {t("nav.personalization", "Personalization")}
                              </p>
                            </TooltipContent>
                          </Tooltip>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Global search dialog */}
      <GlobalSearchDialog
        open={isGlobalSearchOpen}
        onOpenChange={setIsGlobalSearchOpen}
      />

      {/* Dialog opened from user menu "Contact Us" (controlled only, no trigger) */}
      <ContactUs
        placement="sidebar"
        dialogOpen={contactDialogOpen}
        onDialogOpenChange={setContactDialogOpen}
      />
    </>
  );
}
