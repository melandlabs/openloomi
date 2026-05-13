"use client";

import { useState, useCallback } from "react";
import type { FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { formatDistanceToNow } from "date-fns";
import { zhCN, enUS } from "date-fns/locale";
import { RemixIcon } from "@/components/remix-icon";
import { Badge, Button, Input } from "@openloomi/ui";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@openloomi/ui";
import { toast } from "./toast";
import { useRssSubscriptions } from "@/hooks/use-rss-subscriptions";
import {
  createRssSubscriptionClient,
  deleteRssSubscriptionClient,
  updateRssSubscriptionClient,
} from "@/lib/integrations/rss-client";
import type { RssSubscription } from "@/lib/db/schema";
import { RssOpmlImport } from "./rss-opml-import";

/**
 * RSS subscription add area
 * Used to reuse the "paste subscription link + OPML batch import" add capability in different containers
 */
export function RssAddControls() {
  const { t } = useTranslation();
  const { mutate: mutateSubscriptions } = useRssSubscriptions();
  const [customSourceUrl, setCustomSourceUrl] = useState("");
  const [customTitle, setCustomTitle] = useState("");
  const [customCategory, setCustomCategory] = useState("");
  const [isAddingCustomFeed, setIsAddingCustomFeed] = useState(false);

  const handleCustomFeedSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const trimmedUrl = customSourceUrl.trim();
      if (!trimmedUrl) {
        toast({
          type: "error",
          description: t(
            "integrations.feedUrlRequired",
            "Please enter a valid RSS feed URL.",
          ),
        });
        return;
      }

      setIsAddingCustomFeed(true);
      try {
        await createRssSubscriptionClient({
          sourceUrl: trimmedUrl,
          title: customTitle.trim() || undefined,
          category: customCategory.trim() || undefined,
        });
        await mutateSubscriptions();
        setCustomSourceUrl("");
        setCustomTitle("");
        setCustomCategory("");
        toast({
          type: "success",
          description: t("integrations.addFeedSuccess", "Feed added."),
        });
      } catch (error) {
        toast({
          type: "error",
          description:
            error instanceof Error
              ? error.message
              : t("integrations.addFeedError", "Unable to add feed."),
        });
      } finally {
        setIsAddingCustomFeed(false);
      }
    },
    [customCategory, customSourceUrl, customTitle, mutateSubscriptions, t],
  );

  return (
    <section className="flex flex-col gap-3 pb-4">
      <form
        onSubmit={handleCustomFeedSubmit}
        className="flex flex-col gap-4 rounded-xl border border-[#e5e5e5] bg-white p-4"
      >
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label
              className="text-xs font-medium text-[#6f6e69]"
              htmlFor="rss-feed-url"
            >
              {t("integrations.feedUrlLabel", "Feed URL")}
            </label>
            <Input
              type="url"
              id="rss-feed-url"
              value={customSourceUrl}
              onChange={(event) => setCustomSourceUrl(event.target.value)}
              placeholder={t(
                "integrations.feedUrlPlaceholder",
                "e.g., https://domain.com/feed.xml",
              )}
              required
            />
          </div>
          <div className="flex flex-col gap-1">
            <label
              className="text-xs font-medium text-[#6f6e69]"
              htmlFor="rss-feed-title"
            >
              {t("integrations.feedTitleLabel", "Custom title (optional)")}
            </label>
            <Input
              id="rss-feed-title"
              value={customTitle}
              onChange={(event) => setCustomTitle(event.target.value)}
              placeholder={t(
                "integrations.feedTitlePlaceholder",
                "Name shown in the list",
              )}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label
              className="text-xs font-medium text-[#6f6e69]"
              htmlFor="rss-feed-category"
            >
              {t("integrations.feedCategoryLabel", "Tags (optional)")}
            </label>
            <Input
              id="rss-feed-category"
              value={customCategory}
              onChange={(event) => setCustomCategory(event.target.value)}
              placeholder={t(
                "integrations.feedCategoryPlaceholder",
                "Tag for grouping feeds, e.g., Web3",
              )}
            />
          </div>
        </div>
        <div className="flex flex-col gap-2 text-xs text-[#6f6e69]">
          <p>
            {t(
              "integrations.customFeedDescription",
              "Paste any RSS/Atom/JSON feed URL. openloomi will fetch it periodically and surface new stories in your understanding feed.",
            )}
          </p>
          <Button
            type="submit"
            variant="outline"
            className="self-start"
            disabled={isAddingCustomFeed}
          >
            {isAddingCustomFeed ? (
              <>
                <RemixIcon
                  name="loader_2"
                  size="size-4"
                  className="mr-2 animate-spin"
                />
                {t("integrations.subscribing", "Subscribing...")}
              </>
            ) : (
              <>
                <RemixIcon name="add" size="size-4" className="mr-2" />
                {t("integrations.addFeedCta", "Add feed source")}
              </>
            )}
          </Button>
        </div>
      </form>

      <RssOpmlImport onImported={mutateSubscriptions} />
    </section>
  );
}

/**
 * RSS subscription list component
 * Used to display and manage the status and operations of existing RSS subscriptions
 */
export function RssIntegrations() {
  const { t, i18n } = useTranslation();
  const {
    subscriptions,
    isLoading: isSubscriptionsLoading,
    mutate: mutateSubscriptions,
  } = useRssSubscriptions();
  const [subscriptionAction, setSubscriptionAction] = useState<{
    id: string;
    type: "status" | "delete";
  } | null>(null);

  const handleSubscriptionStatusToggle = useCallback(
    async (subscription: RssSubscription) => {
      setSubscriptionAction({ id: subscription.id, type: "status" });
      try {
        await updateRssSubscriptionClient(subscription.id, {
          status: subscription.status === "active" ? "paused" : "active",
        });
        await mutateSubscriptions();
        toast({
          type: "success",
          description: t(
            "integrations.subscriptionUpdated",
            "Subscription updated.",
          ),
        });
      } catch (error) {
        toast({
          type: "error",
          description:
            error instanceof Error
              ? error.message
              : t(
                  "integrations.subscriptionUpdateError",
                  "Unable to update this subscription.",
                ),
        });
      } finally {
        setSubscriptionAction(null);
      }
    },
    [mutateSubscriptions, t],
  );

  const handleSubscriptionDelete = useCallback(
    async (subscription: RssSubscription) => {
      setSubscriptionAction({ id: subscription.id, type: "delete" });
      try {
        await deleteRssSubscriptionClient(subscription.id);
        await mutateSubscriptions();
        toast({
          type: "success",
          description: t(
            "integrations.subscriptionDeleted",
            "Subscription removed.",
          ),
        });
      } catch (error) {
        toast({
          type: "error",
          description:
            error instanceof Error
              ? error.message
              : t(
                  "integrations.subscriptionDeleteError",
                  "Unable to remove this subscription.",
                ),
        });
      } finally {
        setSubscriptionAction(null);
      }
    },
    [mutateSubscriptions, t],
  );

  const getSubscriptionDisplayName = (subscription: RssSubscription) => {
    if (subscription.title && subscription.title.trim().length > 0) {
      return subscription.title.trim();
    }
    try {
      const url = new URL(subscription.sourceUrl);
      return url.hostname;
    } catch {
      return subscription.sourceUrl;
    }
  };

  const getRssErrorFriendlyMessage = useCallback(
    (code: string | null | undefined, rawMessage?: string | null): string => {
      if (!code && !rawMessage) return "";
      const key =
        code === "error" || code === "timeout"
          ? `integrations.rssErrorCode.${code}`
          : code && /^\d+$/.test(code)
            ? `integrations.rssErrorCode.${code}`
            : "integrations.rssErrorCode.error";
      const fallback = t("integrations.rssErrorCode.error");
      return t(key, fallback);
    },
    [t],
  );

  const formatLastCheck = useCallback(
    (lastFetchedAt: Date | string | null | undefined): string => {
      if (!lastFetchedAt) {
        return t("integrations.lastCheckNever", "Never");
      }
      const date =
        typeof lastFetchedAt === "string"
          ? new Date(lastFetchedAt)
          : lastFetchedAt;
      if (Number.isNaN(date.getTime())) return t("integrations.lastCheckNever");
      const locale = i18n.language.startsWith("zh") ? zhCN : enUS;
      const relative = formatDistanceToNow(date, { addSuffix: false, locale });
      return t("integrations.lastCheckAgo", "{{time}} ago", { time: relative });
    },
    [t, i18n.language],
  );

  const isSubscriptionActionPending = (
    subscriptionId: string,
    action: "status" | "delete",
  ) =>
    subscriptionAction?.id === subscriptionId &&
    subscriptionAction.type === action;

  const renderLoadingState = (label: string) => (
    <div className="flex items-center gap-2 rounded-xl border border-dashed border-[#e5e5e5] bg-white/80 p-4 text-xs text-[#6f6e69]">
      <RemixIcon
        name="loader_2"
        size="size-4"
        className="animate-spin text-[#6f6e69]"
      />
      <span>{label}</span>
    </div>
  );

  return (
    <section className="space-y-6">
      <div className="space-y-2">
        {isSubscriptionsLoading ? (
          renderLoadingState(
            t("integrations.subscriptionsLoading", "Loading subscriptions..."),
          )
        ) : subscriptions.length === 0 ? (
          <div className="rounded-xl border border-[#e5e5e5] bg-white p-4 text-xs text-[#6f6e69]">
            {t(
              "integrations.emptySubscriptions",
              "You haven't subscribed to any feeds yet.",
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {subscriptions.map((subscription) => {
              const isStatusPending = isSubscriptionActionPending(
                subscription.id,
                "status",
              );
              const isDeletePending = isSubscriptionActionPending(
                subscription.id,
                "delete",
              );
              const hasError = Boolean(
                subscription.lastErrorCode ?? subscription.lastErrorMessage,
              );
              const statusLabel = hasError
                ? t("integrations.subscriptionStatusError", "Error")
                : subscription.status === "active"
                  ? t("integrations.subscriptionStatusActive", "Active")
                  : t("integrations.subscriptionStatusPaused", "Paused");
              const statusStyles = hasError
                ? "bg-red-50 text-red-700 border border-red-100"
                : subscription.status === "active"
                  ? "bg-emerald-50 text-emerald-700 border border-emerald-100"
                  : "bg-amber-50 text-amber-700 border border-amber-100";
              const errorFriendlyMessage = getRssErrorFriendlyMessage(
                subscription.lastErrorCode ?? undefined,
                subscription.lastErrorMessage ?? undefined,
              );

              /**
               * Get site favicon URL from subscription source URL
               * Prefer using DuckDuckGo universal favicon service, browser naturally falls back on failure
               */
              const faviconUrl = (() => {
                try {
                  const url = new URL(subscription.sourceUrl);
                  const hostname = url.hostname;
                  if (!hostname) return null;
                  return `https://icons.duckduckgo.com/ip3/${hostname}.ico`;
                } catch {
                  return null;
                }
              })();

              return (
                <div
                  key={subscription.id}
                  className="group relative flex items-stretch rounded-xl border border-[#e5e5e5] bg-white transition-colors hover:bg-[#f5f5f5]"
                >
                  <div className="flex flex-1 items-stretch gap-3 px-4 py-3">
                    <div className="flex items-center justify-center shrink-0 pt-0.5">
                      {faviconUrl ? (
                        <img
                          src={faviconUrl}
                          alt=""
                          className="h-5 w-5 rounded-sm object-contain"
                          loading="lazy"
                        />
                      ) : (
                        <RemixIcon
                          name="rss"
                          size="size-5"
                          className="text-[#ff6a00]"
                        />
                      )}
                    </div>
                    <div className="flex flex-1 flex-col justify-center gap-1.5 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2 min-w-0">
                          <span className="text-sm font-serif font-semibold text-[#37352f] truncate">
                            {getSubscriptionDisplayName(subscription)}
                          </span>
                          <Badge className={statusStyles}>{statusLabel}</Badge>
                          {subscription.category ? (
                            <Badge
                              variant="secondary"
                              className="bg-[#f7f6f3] text-[#6f6e69]"
                            >
                              {subscription.category}
                            </Badge>
                          ) : null}
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <span className="text-[11px] uppercase tracking-wide text-[#a09f9a] whitespace-nowrap">
                            {t("integrations.lastCheck", "Last check")}:{" "}
                            {formatLastCheck(subscription.lastFetchedAt)}
                          </span>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 shrink-0"
                                disabled={isStatusPending || isDeletePending}
                                onClick={(event) => event.stopPropagation()}
                              >
                                <RemixIcon name="more_2" size="size-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent
                              align="end"
                              className="text-xs"
                            >
                              <DropdownMenuItem
                                disabled={isStatusPending}
                                onClick={() => {
                                  void handleSubscriptionStatusToggle(
                                    subscription,
                                  );
                                }}
                              >
                                {subscription.status === "active"
                                  ? t("integrations.pauseSubscription", "Pause")
                                  : t(
                                      "integrations.resumeSubscription",
                                      "Resume",
                                    )}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                className="text-red-600"
                                disabled={isDeletePending}
                                onClick={() => {
                                  void handleSubscriptionDelete(subscription);
                                }}
                              >
                                {t("integrations.removeSubscription", "Remove")}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>
                      <p className="text-xs text-[#6f6e69] break-all">
                        {subscription.sourceUrl}
                      </p>
                      {hasError && errorFriendlyMessage ? (
                        <p className="text-xs font-medium text-red-600">
                          {subscription.lastErrorCode
                            ? `${subscription.lastErrorCode} ${t("integrations.subscriptionStatusError", "Error")} - `
                            : ""}
                          {errorFriendlyMessage}
                        </p>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
