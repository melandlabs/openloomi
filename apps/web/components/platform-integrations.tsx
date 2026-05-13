/* eslint-disable @next/next/no-img-element */
"use client";

import Image from "next/image";
import {
  useMemo,
  useState,
  useCallback,
  createContext,
  useContext,
  useEffect,
} from "react";
import { useTranslation } from "react-i18next";
import { useRouter, useSearchParams } from "next/navigation";
import { RemixIcon } from "@/components/remix-icon";
import { Badge, Button, Switch } from "@openloomi/ui";
import { toast } from "./toast";
import { getPlatformDisplayInfo } from "./add-platform-dialog";
import {
  useIntegrations,
  type IntegrationAccountClient,
  type IntegrationId,
} from "@/hooks/use-integrations";
import { resolvePlatformLogo } from "./integration-platform-card";
import { deleteIntegrationAccountRemote } from "@/lib/integrations/client";
import { getAuthToken } from "@/lib/auth/token-manager";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@openloomi/ui";

export interface TelegramTokenFormContextType {
  showTelegramTokenForm: (reconnectAccountId?: string) => void;
  hideTelegramTokenForm: () => void;
  telegramReconnectAccountId?: string;
  isTelegramTokenFormOpen: boolean;
}

export const TelegramTokenFormContext =
  createContext<TelegramTokenFormContextType | null>(null);

export const useTelegramTokenForm = () => {
  const context = useContext(TelegramTokenFormContext);
  if (!context) {
    throw new Error(
      "useTelegramTokenForm must be used within TelegramTokenFormProvider",
    );
  }
  return context;
};

/**
 * TelegramTokenFormProvider - Global Provider
 * Used in AppProviders to avoid duplicating state definitions on every page
 * Note: TelegramTokenForm component is rendered by each component itself to support different isMobile params
 */
export function TelegramTokenFormProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [showTelegramTokenForm, setShowTelegramTokenForm] = useState(false);
  const [telegramReconnectAccountId, setTelegramReconnectAccountId] = useState<
    string | undefined
  >(undefined);

  const value = useMemo(
    () => ({
      showTelegramTokenForm: (reconnectAccountId?: string) => {
        setTelegramReconnectAccountId(reconnectAccountId);
        setShowTelegramTokenForm(true);
      },
      hideTelegramTokenForm: () => {
        setShowTelegramTokenForm(false);
        setTelegramReconnectAccountId(undefined);
      },
      telegramReconnectAccountId,
      isTelegramTokenFormOpen: showTelegramTokenForm,
    }),
    [telegramReconnectAccountId, showTelegramTokenForm],
  );

  return (
    <TelegramTokenFormContext.Provider value={value}>
      {children}
    </TelegramTokenFormContext.Provider>
  );
}

/**
 * Normalize Telegram Bot link
 */
function normalizeTelegramBotLink(
  raw: string | null | undefined,
): string | null {
  if (!raw) {
    return null;
  }
  const trimmed = raw.trim();
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed.replace(/^http:\/\//, "https://");
  }
  const withoutScheme = trimmed.replace(/^@/, "");
  if (withoutScheme.startsWith("t.me/")) {
    return `https://${withoutScheme}`;
  }
  return `https://t.me/${withoutScheme}`;
}

/**
 * Resolve account detail information
 */
function resolveAccountDetail(
  account: IntegrationAccountClient,
): string | undefined {
  const meta = account.metadata ?? {};
  switch (account.platform) {
    case "gmail":
      return (meta.email as string) ?? account.displayName;
    case "outlook":
      return (meta.email as string) ?? account.displayName;
    case "linkedin":
      return (
        (meta.name as string) ?? (meta.email as string) ?? account.displayName
      );
    case "twitter":
      return account.displayName;
    case "instagram": {
      const username = typeof meta.username === "string" ? meta.username : null;
      const handle = typeof meta.handle === "string" ? meta.handle : null;
      return username ?? handle ?? account.displayName;
    }
    case "google_calendar":
      return (meta.email as string) ?? account.displayName;
    case "slack":
      return (meta.teamName as string) ?? account.displayName;
    case "discord":
      return (meta.guildName as string) ?? account.displayName;
    case "whatsapp":
      return (
        (meta.pushName as string) ??
        (meta.formattedNumber as string) ??
        account.displayName
      );
    case "google_drive":
      return (meta.email as string) ?? account.displayName;
    case "google_docs":
      return (meta.email as string) ?? account.displayName;
    case "outlook_calendar": {
      const email = typeof meta.email === "string" ? meta.email : null;
      const displayName =
        typeof meta.displayName === "string" ? meta.displayName : null;
      return email ?? displayName ?? account.displayName;
    }
    case "telegram": {
      const handleName =
        typeof meta.userName === "string" ? meta.userName : null;
      if (handleName && handleName.length > 0) {
        return handleName;
      }
      const fullName = `${meta.firstName ?? ""} ${meta.lastName ?? ""}`.trim();
      if (fullName.length > 0) {
        return fullName;
      }
      return account.displayName;
    }
    case "teams": {
      const upn =
        typeof meta.userPrincipalName === "string"
          ? meta.userPrincipalName
          : null;
      const name =
        typeof meta.displayName === "string" ? meta.displayName : null;
      return upn ?? name ?? account.displayName;
    }
    case "notion": {
      const workspaceName =
        typeof meta.workspaceName === "string" ? meta.workspaceName : null;
      return workspaceName ?? account.displayName;
    }
    case "github": {
      const login = typeof meta.login === "string" ? meta.login : null;
      const name = typeof meta.name === "string" ? meta.name : null;
      return name ?? login ?? account.displayName;
    }
    case "facebook_messenger": {
      const pageName = typeof meta.pageName === "string" ? meta.pageName : null;
      const pageId = typeof meta.pageId === "string" ? meta.pageId : null;
      return pageName ?? pageId ?? account.displayName;
    }
    case "hubspot": {
      const hubDomain =
        typeof meta.hubDomain === "string" ? meta.hubDomain : null;
      const hubId =
        typeof meta.hubId === "number" || typeof meta.hubId === "string"
          ? meta.hubId
          : null;
      const userEmail =
        typeof meta.userEmail === "string" ? meta.userEmail : null;
      return hubDomain ?? userEmail ?? (hubId ? String(hubId) : undefined);
    }
    case "asana": {
      const name = typeof meta.name === "string" ? meta.name : null;
      const email = typeof meta.email === "string" ? meta.email : null;
      const gid = typeof meta.gid === "string" ? meta.gid : null;
      return name ?? email ?? gid ?? account.displayName;
    }
    case "jira": {
      const name = typeof meta.name === "string" ? meta.name : null;
      const email = typeof meta.email === "string" ? meta.email : null;
      const instanceUrl =
        typeof meta.instanceUrl === "string" ? meta.instanceUrl : null;
      return name ?? email ?? instanceUrl ?? account.displayName;
    }
    case "linear": {
      const name = typeof meta.name === "string" ? meta.name : null;
      const email = typeof meta.email === "string" ? meta.email : null;
      const organization =
        typeof meta.organization === "string" ? meta.organization : null;
      return name ?? email ?? organization ?? account.displayName;
    }
    default:
      return account.displayName;
  }
}

/**
 * Summarize connected accounts
 */
export function summarizeConnectedAccounts(
  accounts: IntegrationAccountClient[] | undefined,
): string | null {
  if (!accounts?.length) {
    return null;
  }
  if (accounts.length === 1) {
    return resolveAccountDetail(accounts[0]) ?? accounts[0].displayName;
  }
  const first = resolveAccountDetail(accounts[0]) ?? accounts[0].displayName;
  return `${first} +${accounts.length - 1}`;
}

export interface PlatformIntegrationsProps {
  onGoogleAuthOpen: () => void;
  onWhatsAppAuthOpen: () => void;
  onMessengerAuthOpen: () => void;
  onOutlookAuthOpen: () => void;
  onIMessageAuthOpen?: () => void;
}

/**
 * Messaging Platform Integration Component
 * Manages account connections for various messaging platforms (Telegram, Gmail, WhatsApp, etc.)
 */
export function PlatformIntegrations({
  onGoogleAuthOpen,
  onWhatsAppAuthOpen,
  onMessengerAuthOpen,
  onOutlookAuthOpen,
  onIMessageAuthOpen,
}: PlatformIntegrationsProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { showTelegramTokenForm } = useTelegramTokenForm();
  const { accounts, groupedByIntegration, mutate } = useIntegrations();

  const [isAddPlatformDialogOpen, setIsAddPlatformDialogOpen] = useState(false);
  const [linkingPlatform, setLinkingPlatform] = useState<IntegrationId | null>(
    null,
  );
  const [disconnectingAccountId, setDisconnectingAccountId] = useState<
    string | null
  >(null);
  const [updatingAccountId, setUpdatingAccountId] = useState<string | null>(
    null,
  );
  // Watch for URL parameter to auto-open the add platform dialog
  useEffect(() => {
    if (searchParams.get("addPlatform") === "true") {
      setIsAddPlatformDialogOpen(true);
      // Clear the parameter to prevent reopening on refresh
      const params = new URLSearchParams(searchParams.toString());
      params.delete("addPlatform");
      const newUrl = params.toString()
        ? `?${params.toString()}`
        : window.location.pathname;
      router.replace(newUrl);
    }
  }, [searchParams, router]);

  // Listen for custom event to auto-open the add platform dialog
  useEffect(() => {
    const handleAddPlatform = () => {
      setIsAddPlatformDialogOpen(true);
    };

    window.addEventListener("openloomi:add-platform", handleAddPlatform);

    return () => {
      window.removeEventListener("openloomi:add-platform", handleAddPlatform);
    };
  }, []);

  const telegramBotLink = useMemo(() => {
    const rawLink =
      process.env.NEXT_PUBLIC_TELEGRAM_BOT_URL ??
      process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME ??
      null;
    return normalizeTelegramBotLink(rawLink);
  }, []);

  const connectedAccounts = useMemo(
    () =>
      accounts
        .slice()
        .sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        ),
    [accounts],
  );

  const handleToggleCalendarFeed = useCallback(
    async (account: IntegrationAccountClient, enabled: boolean) => {
      setUpdatingAccountId(account.id);
      try {
        const nextMetadata = {
          ...(account.metadata ?? {}),
          feedEnabled: enabled,
        };

        const headers: HeadersInit = { "Content-Type": "application/json" };
        // Add Bearer token (Tauri mode)
        if (typeof window !== "undefined") {
          const token = getAuthToken();
          if (token) {
            headers.Authorization = `Bearer ${token}`;
          }
        }

        const response = await fetch(`/api/integrations/${account.id}`, {
          method: "PATCH",
          headers,
          credentials: "include",
          body: JSON.stringify({ metadata: nextMetadata }),
        });
        if (!response.ok) {
          const errorBody = await response.json().catch(() => ({}));
          const message =
            typeof errorBody?.error === "string"
              ? errorBody.error
              : t("common.operationFailed");
          throw new Error(message);
        }
        await mutate();
        toast({
          type: "success",
          description: t(
            "integrations.calendarFeedToggleSuccess",
            "Updated calendar feed preference.",
          ),
        });
      } catch (error) {
        toast({
          type: "error",
          description:
            error instanceof Error
              ? error.message
              : t("common.operationFailed"),
        });
      } finally {
        setUpdatingAccountId(null);
      }
    },
    [mutate, t],
  );

  /**
   * Handle account disconnect
   */
  const handleDisconnect = useCallback(
    async (account: IntegrationAccountClient) => {
      setDisconnectingAccountId(account.id);

      try {
        await deleteIntegrationAccountRemote(account.id);
        await mutate();
        toast({
          type: "success",
          description: t(
            "auth.disconnectSuccess",
            "Disconnected successfully.",
          ),
        });
      } catch (error) {
        toast({
          type: "error",
          description:
            error instanceof Error
              ? error.message
              : t("auth.disconnectFailed", "Failed to disconnect account"),
        });
      } finally {
        setDisconnectingAccountId(null);
      }
    },
    [mutate, t],
  );

  /**
   * Handle Telegram reconnection
   * Opens in-app login dialog for direct Telegram login
   */
  const handleTelegramReconnect = useCallback(
    (account: IntegrationAccountClient) => {
      // Directly open Telegram login dialog, passing account ID for updating existing account
      showTelegramTokenForm(account.id);
    },
    [showTelegramTokenForm],
  );

  return (
    <div className="space-y-6">
      <div className="space-y-6">
        {connectedAccounts.length === 0 ? (
          <div className="rounded-xl border border-[#e5e5e5] bg-white p-4 text-xs text-[#6f6e69]">
            {t("common.noConnectedPlatforms")}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {connectedAccounts.map((account) => {
              const platformInfo = getPlatformDisplayInfo(account.platform, t);
              const detail = resolveAccountDetail(account);
              const logoSrc = resolvePlatformLogo(
                account.platform as IntegrationId,
              );
              const isDisconnecting = disconnectingAccountId === account.id;
              const isUpdating = updatingAccountId === account.id;

              return (
                <div
                  key={account.id}
                  className="group flex items-stretch rounded-xl border border-[#e5e5e5] bg-white hover:bg-[#f5f5f5] transition-colors"
                >
                  <div className="flex flex-1 items-center gap-4 sm:gap-4 pl-4 pr-4 py-3">
                    <div className="flex items-center justify-center shrink-0">
                      {logoSrc ? (
                        <Image
                          src={logoSrc}
                          alt={platformInfo.label}
                          width={40}
                          height={40}
                          className="h-8 w-8 sm:h-10 sm:w-10"
                        />
                      ) : (
                        <RemixIcon
                          name={platformInfo.icon}
                          size="size-6"
                          className="text-[#37352f]"
                        />
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-3 mb-0">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-sm font-serif font-semibold text-[#37352f] truncate">
                            {platformInfo.label}
                          </span>
                          {account.platform === "telegram" &&
                          account.metadata?.telegramLastError ? (
                            <Badge className="bg-red-50 text-red-700 border border-red-100">
                              {t("common.telegramReauth", { userName: "" })}
                            </Badge>
                          ) : null}
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <span className="text-[11px] uppercase tracking-wide text-[#a09f9a] whitespace-nowrap">
                            {new Date(account.updatedAt).toLocaleString()}
                          </span>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 shrink-0"
                                disabled={isDisconnecting || isUpdating}
                                onClick={(event) => event.stopPropagation()}
                              >
                                <RemixIcon name="more_2" size="size-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent
                              align="end"
                              className="text-xs"
                            >
                              {account.platform === "telegram" &&
                              account.metadata?.telegramLastError ? (
                                <DropdownMenuItem
                                  disabled={isUpdating}
                                  onClick={() => {
                                    void handleTelegramReconnect(account);
                                  }}
                                >
                                  {t("common.reconnect", "Reconnect")}
                                </DropdownMenuItem>
                              ) : null}
                              <DropdownMenuItem
                                className="text-red-600"
                                disabled={isDisconnecting}
                                onClick={() => {
                                  void handleDisconnect(account);
                                }}
                              >
                                {t("common.unbind", "Unbind")}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>
                      <span className="text-xs text-[#6f6e69] block truncate">
                        {detail}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    {account.platform === "google_calendar" ||
                    account.platform === "outlook_calendar" ? (
                      <div className="flex items-center gap-2 text-xs text-[#6f6e69]">
                        <Switch
                          id={`cal-${account.id}`}
                          checked={
                            (account.metadata as { feedEnabled?: boolean })
                              ?.feedEnabled ?? true
                          }
                          onCheckedChange={(checked) =>
                            handleToggleCalendarFeed(account, checked)
                          }
                          disabled={isDisconnecting || isUpdating}
                        />
                        <label
                          htmlFor={`gcal-${account.id}`}
                          className="cursor-pointer"
                        >
                          {t("integrations.calendarFeedToggle", "Show in feed")}
                        </label>
                      </div>
                    ) : null}
                    {/* Right side only contains controls like toggles; no time or action buttons */}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
