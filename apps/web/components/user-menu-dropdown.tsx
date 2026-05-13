"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import type { Session } from "next-auth";
import { DropdownMenu, DropdownMenuContent } from "@openloomi/ui";
import { cn } from "@/lib/utils";
import { useUserProfile } from "@/hooks/use-user-profile";
import { UserMenuContent } from "@/components/user-menu-content";

/**
 * Props for the user menu dropdown component
 */
interface UserMenuDropdownProps {
  /** Session info */
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
  /** Whether it is mobile */
  isMobile: boolean;
  /** Language switch handler */
  onLanguageChange: (code: string) => void;
  /** Login handler */
  onLogin: () => void;
  /** Mobile sidebar close callback */
  onCloseSidebar?: () => void;
  /** Open "Contact Us" dialog (accessed from menu when sidebar is collapsed) */
  onOpenContactUs?: () => void;
  /** Child elements (trigger) */
  children: React.ReactNode;
}

/**
 * User menu dropdown component
 * Displays user info card and menu items.
 * Logout confirmation dialog is rendered outside DropdownMenu
 * to avoid z-index and portal conflicts.
 */
export function UserMenuDropdown({
  session,
  isLoadingCredit,
  plan,
  creditData,
  creditPercentage,
  currentLang,
  isMobile,
  onLanguageChange,
  onLogin,
  onCloseSidebar,
  onOpenContactUs,
  children,
}: UserMenuDropdownProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const { profile } = useUserProfile();

  /**
   * Get user display name (nickname)
   */
  const userDisplayName = useMemo(() => {
    return profile?.name ?? t("common.guest");
  }, [profile?.name, t]);

  /**
   * Get user avatar URL
   */
  const userAvatarUrl = useMemo(() => {
    return profile?.avatarUrl ?? "https://avatar.vercel.sh/default";
  }, [profile?.avatarUrl]);

  /**
   * Handle menu item click
   */
  const handleMenuItemClick = () => {
    setIsDropdownOpen(false);
    if (isMobile && onCloseSidebar) {
      onCloseSidebar();
    }
  };

  /**
   * Handle click on user card "Personal Settings" icon: close dropdown and navigate to personal settings page
   */
  const handlePersonalSettingsClick = () => {
    handleMenuItemClick();
    router.push("/?page=profile");
  };

  /**
   * Listen for open personalization settings event
   */
  useEffect(() => {
    const handleOpenPersonalization = (event: Event) => {
      const customEvent = event as CustomEvent<{
        targetPage?: "profile-soul";
        tab?: "basic" | "contexts" | "roles" | "people" | "linkedAccounts";
        addPlatform?: boolean;
      }>;

      if (customEvent.detail?.targetPage === "profile-soul") {
        router.push("/?page=profile-soul");
        return;
      }

      if (
        customEvent.detail?.tab === "roles" ||
        customEvent.detail?.tab === "people"
      ) {
        router.push("/?page=profile-soul");
        return;
      }

      // Connectors moved to /connectors (legacy events may still send linkedAccounts)
      if (customEvent.detail?.tab === "linkedAccounts") {
        const q = customEvent.detail?.addPlatform ? "?addPlatform=true" : "";
        router.push(`/connectors${q}`);
        return;
      }

      if (customEvent.detail?.tab === "basic") {
        router.push("/?page=openloomi-soul");
        return;
      }
      if (customEvent.detail?.tab === "contexts") {
        router.push("/?page=profile-soul");
        return;
      }

      router.push("/?page=openloomi-soul");
    };

    window.addEventListener(
      "openloomi:open-personalization",
      handleOpenPersonalization as EventListener,
    );

    // Support legacy event names
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
  }, [router]);

  return (
    <>
      <DropdownMenu open={isDropdownOpen} onOpenChange={setIsDropdownOpen}>
        {children}
        <DropdownMenuContent
          className={cn(
            "z-[9999] border-border rounded-lg bg-surface-elevated p-2 shadow-md",
            isMobile
              ? "mx-auto mt-2 w-[calc(100vw-2rem)] max-w-md max-h-[85vh] overflow-y-auto"
              : "w-[320px]",
          )}
          side={isMobile ? "bottom" : "top"}
          align={isMobile ? "center" : "end"}
          sideOffset={isMobile ? 12 : 8}
          collisionPadding={16}
        >
          <UserMenuContent
            session={session}
            isLoadingCredit={isLoadingCredit}
            plan={plan}
            creditData={creditData}
            creditPercentage={creditPercentage}
            currentLang={currentLang}
            isMobile={isMobile}
            isFullscreen={false}
            userDisplayName={userDisplayName}
            userAvatarUrl={userAvatarUrl}
            onLanguageChange={onLanguageChange}
            onLogin={onLogin}
            onMenuItemClick={handleMenuItemClick}
            onOpenContactUs={onOpenContactUs}
            onPersonalSettingsClick={handlePersonalSettingsClick}
          />
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
