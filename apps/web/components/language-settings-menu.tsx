"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { RemixIcon } from "@/components/remix-icon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@openloomi/ui";
import { Button } from "@openloomi/ui";
import { cn } from "@/lib/utils";

/** Supported UI languages (flag kept for potential future use, not shown in menu UI). */
export const languages = [
  { code: "system", name: "Follow system", flag: "💻" },
  { code: "zh-Hans", name: "简体中文", flag: "🇨🇳" },
  { code: "en-US", name: "English", flag: "🇺🇸" },
] as const;

export type LanguageOption = (typeof languages)[number];

export type AccountMenuLanguageRowStyles = {
  iconSize: string;
  itemGap: string;
  itemPadding: string;
  itemTextSize: string;
  itemHover: string;
};

type LanguageSettingsMenuPropsBase = {
  currentLang: string;
  onLanguageChange: (code: string) => void;
  isMobile?: boolean;
};

export type LanguageSettingsMenuProps =
  | (LanguageSettingsMenuPropsBase & {
      variant: "settings-sidebar";
      sidebarCollapsed?: boolean;
    })
  | (LanguageSettingsMenuPropsBase & {
      variant: "personalization";
    })
  | (LanguageSettingsMenuPropsBase & {
      variant: "account-menu";
      accountMenuRow: AccountMenuLanguageRowStyles;
    });

/**
 * Language entry shared by the settings sidebar and the account menu:
 * globe + bilingual label + right chevron; list items are text-only (no emoji).
 */
export function LanguageSettingsMenu(props: LanguageSettingsMenuProps) {
  const { currentLang, onLanguageChange, variant, isMobile = false } = props;
  const sidebarCollapsed =
    variant === "settings-sidebar" ? (props.sidebarCollapsed ?? false) : false;
  const { t } = useTranslation();
  const [isFollowingSystem, setIsFollowingSystem] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const userSelected = localStorage.getItem("langbot_language_user_selected");
    setIsFollowingSystem(userSelected !== "true");
  }, [currentLang]);

  const contentSide =
    variant === "settings-sidebar"
      ? isMobile
        ? "bottom"
        : "right"
      : variant === "personalization"
        ? isMobile
          ? "bottom"
          : "right"
        : isMobile
          ? "bottom"
          : "left";
  const contentAlign =
    variant === "settings-sidebar" || variant === "personalization"
      ? "start"
      : isMobile
        ? "start"
        : "center";

  const contentClassName =
    variant === "settings-sidebar" || variant === "personalization"
      ? "w-48"
      : cn(
          "z-[10000] rounded-lg border-border bg-surface-elevated",
          isMobile ? "w-full max-w-[calc(100vw-2rem)]" : "w-48",
        );

  /**
   * Returns the display label for each language option.
   */
  const getOptionLabel = (
    code: LanguageOption["code"],
    fallbackName: string,
  ) => {
    if (code === "system") {
      return t("nav.followSystem", "Follow system");
    }
    return fallbackName;
  };

  /**
   * Gets the current label to render in trigger button.
   */
  const currentOptionLabel = (() => {
    if (isFollowingSystem) {
      return t("nav.followSystem", "Follow system");
    }
    const matched = languages.find((lang) => lang.code === currentLang);
    return matched
      ? getOptionLabel(matched.code, matched.name)
      : t("nav.languageSidebar");
  })();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {variant === "settings-sidebar" ? (
          <Button
            type="button"
            variant="ghost"
            className={cn(
              "w-full gap-2 px-3 py-2 h-10 rounded-md transition-colors text-muted-foreground hover:bg-sidebar-hover hover:text-muted-foreground",
              sidebarCollapsed ? "justify-center" : "justify-start",
            )}
            aria-label={t("nav.languageSidebar")}
          >
            <RemixIcon name="global" size="size-5" />
            {!sidebarCollapsed && (
              <>
                <span className="truncate font-medium">
                  {t("nav.languageSidebar")}
                </span>
                <RemixIcon
                  name="chevron_right"
                  size="size-5"
                  className="ml-auto shrink-0"
                />
              </>
            )}
          </Button>
        ) : variant === "personalization" ? (
          <Button
            type="button"
            variant="outline"
            className="h-9 w-full sm:w-[220px] shrink-0 self-start sm:self-center justify-between gap-2 rounded-md border border-border/80 bg-surface px-3 py-2 text-sm font-medium text-left hover:bg-surface-hover hover:text-foreground/90 transition-all duration-200"
            aria-label={t("nav.languageSidebar")}
          >
            <span className="truncate">{currentOptionLabel}</span>
            <RemixIcon
              name="arrow_down_s"
              size="size-4"
              className="shrink-0 opacity-70"
            />
          </Button>
        ) : (
          <button
            type="button"
            className={cn(
              "flex items-center justify-between w-full rounded-sm cursor-pointer text-foreground bg-transparent border-0",
              props.accountMenuRow.itemGap,
              props.accountMenuRow.itemPadding,
              props.accountMenuRow.itemTextSize,
              props.accountMenuRow.itemHover,
            )}
            aria-label={t("nav.languageSidebar")}
          >
            <div
              className={cn("flex items-center", props.accountMenuRow.itemGap)}
            >
              <RemixIcon name="global" size={props.accountMenuRow.iconSize} />
              <span>{t("nav.languageSidebar")}</span>
            </div>
            <RemixIcon
              name="chevron_right"
              size={props.accountMenuRow.iconSize}
              className="shrink-0"
            />
          </button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side={contentSide}
        align={contentAlign}
        className={contentClassName}
        sideOffset={variant === "account-menu" && isMobile ? 4 : undefined}
        collisionPadding={variant === "account-menu" ? 16 : undefined}
      >
        {languages.map((lang) =>
          (() => {
            const isActive =
              lang.code === "system"
                ? isFollowingSystem
                : !isFollowingSystem && currentLang === lang.code;
            return (
              <DropdownMenuItem
                key={lang.code}
                onClick={() => {
                  onLanguageChange(lang.code);
                }}
                className={cn(
                  "flex items-center gap-2 cursor-pointer",
                  isActive && "bg-primary/10 text-primary",
                )}
              >
                <span className="flex-1">
                  {getOptionLabel(lang.code, lang.name)}
                </span>
                {isActive && (
                  <div className="size-2 bg-primary rounded-full shrink-0" />
                )}
              </DropdownMenuItem>
            );
          })(),
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
