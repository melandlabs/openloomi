"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import type { Session } from "next-auth";
import { RemixIcon } from "@/components/remix-icon";
import { cn } from "@/lib/utils";
import { guestRegex } from "@/lib/env/constants";
import {
  LanguageSettingsMenu,
  languages,
} from "@/components/language-settings-menu";

export { languages };

/**
 * Props for the user menu content component.
 */
interface UserMenuContentProps {
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
  /** Whether in mobile mode */
  isMobile: boolean;
  /** Whether in fullscreen mode */
  isFullscreen?: boolean;
  /** User display name */
  userDisplayName: string;
  /** User avatar URL */
  userAvatarUrl: string;
  /** Language change handler */
  onLanguageChange: (code: string) => void;
  /** Login handler */
  onLogin: () => void;
  /** Menu item click handler */
  onMenuItemClick: () => void;
  /** Callback when clicking the "Personal Settings" icon on the user card (navigates to personal settings page) */
  onPersonalSettingsClick?: () => void;
  /** Callback when clicking the user card to navigate to subscription management page */
  onGoToSubscriptionManagement?: () => void;
}

/**
 * User menu content component.
 * Contains user info card and all functional menu items.
 * Can be reused in dropdown menu and fullscreen page.
 */
export function UserMenuContent({
  session,
  isLoadingCredit,
  plan,
  creditData,
  creditPercentage,
  currentLang,
  isMobile,
  isFullscreen = false,
  userDisplayName,
  userAvatarUrl,
  onLanguageChange,
  onLogin,
  onMenuItemClick,
  onPersonalSettingsClick,
  onGoToSubscriptionManagement,
}: UserMenuContentProps) {
  const router = useRouter();
  const { t } = useTranslation();
  const isGuest = guestRegex.test(session?.user?.email ?? "");

  /**
   * Navigate to Billing & Usage page from the user card.
   * Always closes menu first to avoid stale overlay state.
   */
  const handleGoToBillingAndUsage = () => {
    onMenuItemClick();
    if (onGoToSubscriptionManagement) {
      onGoToSubscriptionManagement();
      return;
    }
    router.push(
      isFullscreen ? "/?page=profile&fromUserMenu=true" : "/?page=profile",
    );
  };

  // Set style variables based on mode
  const styles = isFullscreen
    ? {
        // Fullscreen mode styles
        avatarSize: 48,
        avatarClassName: "w-12 h-12",
        nameSize: "text-base",
        iconSize: "size-5",
        itemGap: "gap-3",
        itemPadding: "px-3 py-3",
        itemTextSize: "text-base",
        itemHover: "active:bg-surface-hover",
        dividerMargin: "my-2",
        planTextSize: "text-sm",
        planBadgePadding: "px-3 py-1",
        planBadgeTextSize: "text-sm",
        creditTextSize: "text-base",
        creditSubTextSize: "text-sm",
        progressHeight: "h-2.5",
        buttonPadding: "px-4 py-2.5",
        buttonTextSize: "text-sm",
        cardPadding: "p-4",
        cardGap: "gap-3",
        userInfoGap: "gap-3",
        userInfoMargin: "mb-4",
      }
    : {
        // Dropdown menu mode styles
        avatarSize: 32,
        avatarClassName: "w-8 h-8",
        nameSize: "text-sm",
        iconSize: "size-4",
        itemGap: "gap-2",
        itemPadding: "px-2 py-2",
        itemTextSize: "text-sm",
        itemHover: "hover:bg-surface-hover",
        dividerMargin: "my-1",
        planTextSize: "text-xs",
        planBadgePadding: "px-2.5 py-0.5",
        planBadgeTextSize: "text-xs",
        creditTextSize: "text-sm",
        creditSubTextSize: "text-xs",
        progressHeight: "h-2",
        buttonPadding: "px-3 py-2",
        buttonTextSize: "text-xs",
        cardPadding: "p-4",
        cardGap: "gap-2",
        userInfoGap: "gap-2",
        userInfoMargin: "mb-4",
      };

  /**
   * Render the user info card.
   */
  const renderUserCard = () => (
    <div
      onClick={handleGoToBillingAndUsage}
      role="button"
      className={cn(
        "relative rounded-lg border border-border bg-card shadow-sm transition-all",
        "cursor-pointer",
        isFullscreen
          ? "active:shadow-md active:border-border"
          : "hover:shadow-md hover:border-border",
        styles.cardPadding,
      )}
    >
      {/* User info */}
      <div
        className={cn(
          "flex items-center",
          styles.userInfoMargin,
          styles.userInfoGap,
        )}
      >
        <div
          className={cn(
            "shrink-0 rounded-full overflow-hidden ring-2 ring-card shadow-sm",
            styles.avatarClassName,
          )}
        >
          <Image
            src={userAvatarUrl}
            alt={"User Avatar"}
            width={styles.avatarSize}
            height={styles.avatarSize}
            className="w-full h-full object-cover"
            suppressHydrationWarning
          />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p
              data-testid="user-email-card"
              className={cn(
                "font-medium text-foreground truncate",
                styles.nameSize,
              )}
            >
              {isGuest ? t("common.guest") : userDisplayName}
            </p>
            {/* Removed quick settings icon per menu simplification */}
          </div>
          {/* User email */}
          {session?.user?.email && !isGuest && (
            <p
              className={cn(
                "text-muted-foreground truncate",
                isFullscreen ? "text-sm" : "text-xs",
                "mt-0.5",
              )}
            >
              {session.user.email}
            </p>
          )}
        </div>
      </div>

      {/* Plan and credits info */}
      <div className="space-y-3">
        {/* Current plan */}
        <div className="flex items-center justify-between">
          <span
            className={cn(
              "font-medium text-muted-foreground",
              styles.planTextSize,
            )}
          >
            {t("nav.currentPlan")}
          </span>
          {!isLoadingCredit && (
            <span
              className={cn(
                "inline-flex items-center rounded-full bg-primary/10 font-semibold text-primary border border-primary/20",
                styles.planBadgePadding,
                styles.planBadgeTextSize,
              )}
            >
              {plan}
            </span>
          )}
        </div>

        {/* Remaining credits */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span
              className={cn(
                "font-medium text-muted-foreground",
                styles.planTextSize,
              )}
            >
              {t("nav.creditsUsed")}
            </span>
            {!isLoadingCredit && creditData && (
              <span
                className={cn(
                  "font-bold text-foreground",
                  styles.creditTextSize,
                )}
              >
                {creditData.remaining.toLocaleString()}
                <span
                  className={cn(
                    "font-normal text-muted-foreground",
                    styles.creditSubTextSize,
                  )}
                >
                  /{creditData.total.toLocaleString()}
                </span>
              </span>
            )}
          </div>

          {/* Progress bar */}
          <div
            className={cn(
              "relative w-full overflow-hidden rounded-full bg-muted",
              styles.progressHeight,
            )}
          >
            <div
              className="h-full rounded-full bg-primary shadow-sm transition-all duration-500 ease-out"
              style={{ width: `${creditPercentage}%` }}
            />
          </div>
        </div>

        {/* Subscription management is now handled by dialog, no longer provides navigation button */}
      </div>
    </div>
  );

  /**
   * Render feature menu items.
   */
  const renderMenuItems = () => (
    <>
      {/* Language settings */}
      <LanguageSettingsMenu
        variant="account-menu"
        currentLang={currentLang}
        onLanguageChange={onLanguageChange}
        isMobile={isMobile}
        accountMenuRow={{
          iconSize: styles.iconSize,
          itemGap: styles.itemGap,
          itemPadding: styles.itemPadding,
          itemTextSize: styles.itemTextSize,
          itemHover: styles.itemHover,
        }}
      />

      <Link
        href={
          isFullscreen
            ? "/?page=account-settings&fromUserMenu=true"
            : "/?page=account-settings"
        }
        onClick={onMenuItemClick}
        className={cn(
          "flex items-center w-full rounded-sm text-foreground",
          styles.itemGap,
          styles.itemPadding,
          styles.itemTextSize,
          styles.itemHover,
        )}
      >
        <RemixIcon name="settings_line" size={styles.iconSize} />
        <span>{t("settings.menuSettings", "Settings")}</span>
      </Link>
    </>
  );

  return (
    <>
      {/* User info card: dropdown uses SubscriptionInfoCard variant, fullscreen uses original card */}
      <div className={isFullscreen ? undefined : "mb-0"}>
        {isFullscreen ? (
          renderUserCard()
        ) : (
          <div
            onClick={handleGoToBillingAndUsage}
            role="button"
            className="cursor-pointer"
          />
        )}
      </div>

      {/* Feature menu items */}
      <div className={isFullscreen ? "space-y-1" : "py-1 mt-0"}>
        {renderMenuItems()}
      </div>
    </>
  );
}
