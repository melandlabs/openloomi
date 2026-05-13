"use client";

import { useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import type { Session } from "next-auth";
import { RemixIcon } from "@/components/remix-icon";
import { Button, ScrollArea } from "@openloomi/ui";
import { cn } from "@/lib/utils";
import { useUserProfile } from "@/hooks/use-user-profile";
import { useIsMobile } from "@openloomi/hooks/use-is-mobile";
import { UserMenuContent } from "@/components/user-menu-content";

/**
 * Props for the fullscreen user menu component.
 */
interface UserMenuFullscreenProps {
  /** Session information */
  session: Session | null;
  /** Whether credit info is loading */
  isLoadingCredit: boolean;
  /** User plan type */
  plan: string | null;
  /** Credit data */
  creditData?: {
    remaining: number;
    total: number;
  } | null;
  /** Credit usage percentage */
  creditPercentage?: number | null;
  /** Current language code */
  currentLang: string;
  /** Whether it is open */
  isOpen: boolean;
  /** Close callback */
  onClose: () => void;
  /** Language change handler */
  onLanguageChange: (code: string) => void;
  /** Login handler */
  onLogin: () => void;
  /** Callback for closing sidebar on mobile */
  onCloseSidebar?: () => void;
  /** Opens the "Contact Us" dialog */
  onOpenContactUs?: () => void;
}

/**
 * Mobile fullscreen user menu component.
 * Used to display user menu content on mobile.
 */
export function UserMenuFullscreen({
  session,
  isLoadingCredit,
  plan,
  creditData,
  creditPercentage,
  currentLang,
  isOpen,
  onClose,
  onLanguageChange,
  onLogin,
  onCloseSidebar,
  onOpenContactUs,
}: UserMenuFullscreenProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const isMobile = useIsMobile();
  const { profile } = useUserProfile();

  /**
   * Get user display name (nickname).
   */
  const userDisplayName = useMemo(() => {
    return profile?.name ?? t("common.guest");
  }, [profile?.name, t]);

  /**
   * Get user avatar URL.
   */
  const userAvatarUrl = useMemo(() => {
    return profile?.avatarUrl ?? "https://avatar.vercel.sh/default";
  }, [profile?.avatarUrl]);

  /**
   * Handle menu item click.
   * In fullscreen mode, close the menu first, then mark as entered from menu via URL parameter.
   */
  const handleMenuItemClick = () => {
    // Close menu first to avoid blocking sub-pages
    // URL parameter fromUserMenu=true marks entry from menu; menu will reopen on return
    onClose();
  };

  /**
   * Handle clicking the "Personal Settings" icon on the user card: close menu and navigate to personal settings page.
   */
  const handlePersonalSettingsClick = () => {
    onClose();
    router.push("/?page=profile&fromUserMenu=true");
  };

  /**
   * Listen for open personalization settings event.
   */
  useEffect(() => {
    const handleOpenPersonalization = (event: Event) => {
      const customEvent = event as CustomEvent<{
        targetPage?: "profile-soul";
        tab?: "basic" | "contexts" | "roles" | "people" | "linkedAccounts";
        addPlatform?: boolean;
      }>;

      if (customEvent.detail?.targetPage === "profile-soul") {
        onClose();
        router.push("/?page=profile-soul");
        return;
      }

      if (
        customEvent.detail?.tab === "roles" ||
        customEvent.detail?.tab === "people"
      ) {
        onClose();
        router.push("/?page=profile-soul");
        return;
      }

      if (customEvent.detail?.tab === "linkedAccounts") {
        onClose();
        const q = customEvent.detail?.addPlatform ? "?addPlatform=true" : "";
        router.push(`/connectors${q}`);
        return;
      }

      if (customEvent.detail?.tab === "basic") {
        onClose();
        router.push("/?page=openloomi-soul");
        return;
      }
      if (customEvent.detail?.tab === "contexts") {
        onClose();
        router.push("/?page=profile-soul");
        return;
      }

      onClose();
      router.push("/?page=openloomi-soul");
    };

    window.addEventListener(
      "openloomi:open-personalization",
      handleOpenPersonalization as EventListener,
    );

    // Backwards compatibility with old event name
    window.addEventListener(
      "openloomi:open-user-settings",
      handleOpenPersonalization as EventListener,
    );

    return () => {
      window.removeEventListener(
        "openloomi:open-personalization",
        handleOpenPersonalization as EventListener,
      );
      window.removeEventListener(
        "openloomi:open-user-settings",
        handleOpenPersonalization as EventListener,
      );
    };
  }, [onClose, router]);

  // When opening/closing, set data attribute on body to hide the bottom menu
  useEffect(() => {
    if (typeof document === "undefined" || !isMobile) return;

    if (isOpen) {
      document.body.setAttribute("data-user-menu-open", "true");
    } else {
      document.body.removeAttribute("data-user-menu-open");
    }

    return () => {
      document.body.removeAttribute("data-user-menu-open");
    };
  }, [isOpen, isMobile]);

  if (!isMobile) return null;

  return (
    <>
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          "fixed inset-0 z-[70] flex w-full h-full min-h-0 flex-col bg-white transition-opacity duration-300 ease-out",
          isOpen
            ? "opacity-100 pointer-events-auto"
            : "opacity-0 pointer-events-none",
        )}
        style={{
          boxSizing: "border-box",
          overflow: "hidden",
          height: "100vh",
          maxHeight: "100vh",
        }}
      >
        {/* Header */}
        <div
          className="p-3 sm:p-4 border-b border-gray-200 shrink-0 bg-white"
          style={{
            boxSizing: "border-box",
            width: "100%",
            paddingTop: "calc(env(safe-area-inset-top) + 0.75rem)",
          }}
        >
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">
              {t("nav.myAccount")}
            </h2>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                // When closing menu, remove fromUserMenu parameter
                const currentParams = new URLSearchParams(
                  window.location.search,
                );
                currentParams.delete("fromUserMenu");
                const newUrl = currentParams.toString()
                  ? `${window.location.pathname}?${currentParams.toString()}`
                  : window.location.pathname;
                router.push(newUrl);
                onClose();
              }}
              className="h-9 w-9"
              aria-label={t("common.close")}
            >
              <RemixIcon name="close" size="size-5" />
            </Button>
          </div>
        </div>

        {/* Content */}
        <ScrollArea className="flex-1">
          <div className="p-4 space-y-4">
            <UserMenuContent
              session={session}
              isLoadingCredit={isLoadingCredit}
              plan={plan}
              creditData={creditData}
              creditPercentage={creditPercentage}
              currentLang={currentLang}
              isMobile={isMobile}
              isFullscreen={true}
              userDisplayName={userDisplayName}
              userAvatarUrl={userAvatarUrl}
              onLanguageChange={onLanguageChange}
              onLogin={onLogin}
              onMenuItemClick={handleMenuItemClick}
              onOpenContactUs={onOpenContactUs}
              onPersonalSettingsClick={handlePersonalSettingsClick}
            />
          </div>
        </ScrollArea>
      </div>
    </>
  );
}
