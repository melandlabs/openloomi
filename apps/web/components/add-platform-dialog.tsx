"use client";

import Image from "next/image";
import { useMemo, useState, useCallback, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useSWRConfig } from "swr";
import { RemixIcon } from "@/components/remix-icon";
import { Button } from "@openloomi/ui";
import { isTauri, openUrl } from "@/lib/tauri";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@openloomi/ui";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@openloomi/ui";
import { toast } from "./toast";
import type { TFunction } from "i18next";
import type { IntegrationId } from "@/hooks/use-integrations";
import {
  getDiscordAuthorizationUrl,
  getSlackAuthorizationUrl,
  getTeamsAuthorizationUrl,
  getHubspotAuthorizationUrl,
  getJiraAuthorizationUrl,
  getLinearAuthorizationUrl,
  getXAuthorizationUrl,
  getNotionAuthorizationUrl,
} from "@/lib/integrations";
import { useIsMobile } from "@openloomi/hooks/use-is-mobile";
import {
  useIntegrations,
  type IntegrationAccountClient,
} from "@/hooks/use-integrations";
import { FeishuAuthForm } from "@/components/feishu-auth-form";
import { DingTalkAuthForm } from "@/components/dingtalk-auth-form";
import { QQBotAuthForm } from "@/components/qqbot-auth-form";
import { WeixinAuthForm } from "@/components/weixin-auth-form";
import {
  IntegrationPlatformCard,
  resolvePlatformLogo,
} from "@/components/integration-platform-card";

/**
 * Resolve short display text for an account
 */
function resolveAccountDetail(
  account: IntegrationAccountClient,
): string | undefined {
  const meta = account.metadata ?? {};
  switch (account.platform) {
    case "gmail":
    case "outlook":
    case "google_drive":
    case "google_docs":
    case "google_calendar":
    case "linkedin":
      return (meta.email as string) ?? account.displayName;
    case "twitter":
      return account.displayName;
    case "instagram": {
      const username = typeof meta.username === "string" ? meta.username : null;
      const handle = typeof meta.handle === "string" ? meta.handle : null;
      return username ?? handle ?? account.displayName;
    }
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
    case "outlook_calendar": {
      const email = typeof meta.email === "string" ? meta.email : null;
      const displayName =
        typeof meta.displayName === "string" ? meta.displayName : null;
      return email ?? displayName ?? account.displayName;
    }
    case "telegram": {
      const handleName =
        typeof meta.userName === "string" ? meta.userName : null;
      if (handleName && handleName.length > 0) return handleName;
      const fullName = `${meta.firstName ?? ""} ${meta.lastName ?? ""}`.trim();
      if (fullName.length > 0) return fullName;
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
    case "notion":
      return (
        (typeof meta.workspaceName === "string" ? meta.workspaceName : null) ??
        account.displayName
      );
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
      const userEmail =
        typeof meta.userEmail === "string" ? meta.userEmail : null;
      const hubId =
        typeof meta.hubId === "number" || typeof meta.hubId === "string"
          ? meta.hubId
          : null;
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
 * Summarize connected account info into a short string
 */
function summarizeConnectedAccountsLocal(
  accounts: IntegrationAccountClient[] | undefined,
): string | null {
  if (!accounts?.length) return null;
  if (accounts.length === 1)
    return resolveAccountDetail(accounts[0]) ?? accounts[0].displayName;
  const first = resolveAccountDetail(accounts[0]) ?? accounts[0].displayName;
  return `${first} +${accounts.length - 1}`;
}

/**
 * Platform definition type
 */
export type PlatformDefinition = {
  id: IntegrationId;
  label: string;
  description: string;
  icon: string;
  buttonClass: string;
  iconBackground: string;
  onConnect: () => void | Promise<void>;
  disable?: boolean;
};

/**
 * Props for the Add Platform content component (can be embedded in sidebar or any container)
 */
export interface AddPlatformContentProps {
  /** Callback to show Telegram Token form */
  showTelegramTokenForm: () => void;
  /** Callback to set Google auth form open state */
  setIsGoogleAuthFormOpen: (open: boolean) => void;
  /** Callback to set Outlook auth form open state */
  setIsOutlookAuthFormOpen: (open: boolean) => void;
  /** Callback to set WhatsApp auth form open state */
  setIsWhatsAppAuthFormOpen: (open: boolean) => void;
  /** Callback to set Facebook Messenger auth form open state */
  setIsMessengerAuthFormOpen: (open: boolean) => void;
  /** Callback to set iMessage auth form open state */
  setIsIMessageAuthFormOpen?: (open: boolean) => void;
  /** Optional: pre-select/highlight a platform when dialog opens */
  linkingPlatform?: IntegrationId | null;
  /**
   * When provided, form-based platforms call this instead of opening separate dialogs.
   * The parent is responsible for rendering the embedded form inline.
   */
  onSelectPlatform?: (platformId: IntegrationId, platformName: string) => void;
}

/**
 * Props for the Add Platform dialog component (backward compatible interface)
 */
export type AddPlatformDialogProps = AddPlatformContentProps & {
  /** Whether the dialog is open */
  isOpen: boolean;
  /** Callback when dialog open state changes */
  onOpenChange: (open: boolean) => void;
};

/**
 * Add Platform content component
 * Self-contained: internally calls useIntegrations(), can be directly embedded in sidebar or dialog content area
 */
export function AddPlatformContent({
  showTelegramTokenForm,
  setIsGoogleAuthFormOpen,
  setIsOutlookAuthFormOpen,
  setIsWhatsAppAuthFormOpen,
  setIsMessengerAuthFormOpen,
  setIsIMessageAuthFormOpen,
  linkingPlatform: linkingPlatformProp,
  onSelectPlatform,
}: AddPlatformContentProps) {
  const { t } = useTranslation();
  const { mutate } = useSWRConfig();
  const { groupedByIntegration } = useIntegrations();
  /** linkingPlatform: null in self-contained mode, passed via prop when used in chat integration flow */
  const linkingPlatform = linkingPlatformProp ?? null;

  // Feishu / DingTalk / QQ independent auth modal states
  const [isFeishuAuthFormOpen, setIsFeishuAuthFormOpen] = useState(false);
  const [isDingTalkAuthFormOpen, setIsDingTalkAuthFormOpen] = useState(false);
  const [isQQBotAuthFormOpen, setIsQQBotAuthFormOpen] = useState(false);
  const [isWeixinAuthFormOpen, setIsWeixinAuthFormOpen] = useState(false);

  // Store polling timer reference
  const pollingTimerRef = useRef<NodeJS.Timeout | null>(null);
  const autoTriggeredPlatformRef = useRef<IntegrationId | null>(null);

  // Cleanup polling timer (on dialog close or component unmount)
  useEffect(() => {
    return () => {
      if (pollingTimerRef.current) {
        clearInterval(pollingTimerRef.current);
        pollingTimerRef.current = null;
      }
    };
  }, []);

  // Flatten groupedByIntegration into a single array of integrations
  const integrations = useMemo(() => {
    return Object.values(groupedByIntegration).flat();
  }, [groupedByIntegration]);

  const hubspotEnabled = process.env.NEXT_PUBLIC_HUBSPOT_ENABLED === "true";
  const googleDocsEnabled =
    process.env.NEXT_PUBLIC_GOOGLE_DOCS_ENABLED === "true";
  const outlookCalendarEnabled =
    process.env.NEXT_PUBLIC_OUTLOOK_CALENDAR_ENABLED === "true";

  // Admin permission confirmation dialog state
  const [adminConfirmOpen, setAdminConfirmOpen] = useState(false);
  const [pendingPlatform, setPendingPlatform] = useState<
    "slack" | "discord" | "twitter" | null
  >(null);

  /**
   * Execute Slack OAuth authorization
   */
  const executeSlackConnect = useCallback(async () => {
    try {
      // In Tauri mode: get token and pass to backend
      let authToken: string | undefined = undefined;
      const { isTauri } = await import("@/lib/tauri");
      if (isTauri()) {
        const { getAuthToken } = await import("@/lib/auth/token-manager");
        const token = getAuthToken();
        authToken = token || undefined;
        if (!authToken) {
          toast({
            type: "error",
            description: "Authentication required. Please log in again.",
          });
          return;
        }
      }

      const authorizationUrl = await getSlackAuthorizationUrl(authToken);

      if (isTauri()) {
        // Tauri environment: use Tauri openUrl API
        const { openUrl } = await import("@/lib/tauri");
        await openUrl(authorizationUrl);

        // Start polling cloud accounts (Tauri mode only)
        startPollingForAccounts("slack");
      } else {
        // Web environment: use window.open
        openUrl(authorizationUrl);
      }
    } catch (error) {
      console.error("[Slack Connect] Error:", error);
      toast({
        type: "error",
        description:
          error instanceof Error
            ? error.message
            : t("common.operationFailed", "Operation failed"),
      });
    }
  }, [integrations, t]);

  /**
   * Start polling cloud accounts (Tauri mode)
   */
  const startPollingForAccounts = useCallback(
    (platform: "slack" | "discord" | "twitter" | "notion") => {
      // Clear any existing polling timer
      if (pollingTimerRef.current) {
        clearInterval(pollingTimerRef.current);
        pollingTimerRef.current = null;
      }

      let pollCount = 0;
      const maxPolls = 60; // Poll at most 60 times (3 minutes, every 3 seconds)
      const pollInterval = 3000; // Poll every 3 seconds

      // Record current account count
      const currentAccounts =
        integrations?.filter((i) => i.platform === platform) || [];
      const currentCount = currentAccounts.length;
      const currentAccountIds = new Set(currentAccounts.map((a) => a.id));

      const pollTimer = setInterval(async () => {
        pollCount++;

        try {
          // Get auth token (required for Tauri mode)
          const { getAuthToken } = await import("@/lib/auth/token-manager");
          const token = getAuthToken();

          const headers: HeadersInit = {
            "Content-Type": "application/json",
          };

          // If token exists, add Authorization header
          if (token) {
            headers.Authorization = `Bearer ${token}`;
          } else {
            console.error(
              `[${platform.toUpperCase()}] No auth token available!`,
            );
          }

          const response = await fetch("/api/integrations/accounts", {
            headers,
          });
          if (!response.ok) {
            // 401 Unauthorized: stop polling because auth has an issue
            if (response.status === 401) {
              console.error(
                `[${platform.toUpperCase()}] Auth failed (401), stopping poll.`,
              );
              clearInterval(pollTimer);
              pollingTimerRef.current = null;

              toast({
                type: "error",
                description: `${platform.charAt(0).toUpperCase() + platform.slice(1)} authorization failed. Please check your authentication.`,
              });

              return;
            }

            console.error(
              `[${platform.toUpperCase()}] Polling failed:`,
              response.status,
            );
            return;
          }

          const data = await response.json();
          const accounts =
            data.accounts?.filter((a: any) => a.platform === platform) || [];

          const newAccountIds = accounts.filter(
            (a: any) => !currentAccountIds.has(a.id),
          );
          if (newAccountIds.length > 0) {
            clearInterval(pollTimer);
            pollingTimerRef.current = null;

            // Refresh local account list
            await mutate("/api/integrations");

            toast({
              type: "success",
              description: `${platform.charAt(0).toUpperCase() + platform.slice(1)} connected successfully!`,
            });

            return;
          }

          if (pollCount >= maxPolls) {
            clearInterval(pollTimer);
            pollingTimerRef.current = null;

            toast({
              type: "info",
              description: `${platform.charAt(0).toUpperCase() + platform.slice(1)} authorization timed out. Please try again.`,
            });

            return;
          }
        } catch (error) {
          console.error(`[${platform.toUpperCase()}] Polling error:`, error);
          // Continue polling, don't stop due to a single network error
        }
      }, pollInterval);

      // Store timer reference for later cleanup
      pollingTimerRef.current = pollTimer;
    },
    [integrations, mutate],
  );

  /**
   * Execute Discord OAuth authorization
   */
  const executeDiscordConnect = useCallback(async () => {
    try {
      // In Tauri mode: get token and pass to backend
      let authToken: string | undefined = undefined;
      const { isTauri } = await import("@/lib/tauri");
      if (isTauri()) {
        const { getAuthToken } = await import("@/lib/auth/token-manager");
        const token = getAuthToken();
        authToken = token || undefined;
        if (!authToken) {
          toast({
            type: "error",
            description: "Authentication required. Please log in again.",
          });
          return;
        }
      }

      const authorizationUrl = await getDiscordAuthorizationUrl(authToken);

      if (isTauri()) {
        // Tauri environment: use Tauri openUrl API
        const { openUrl } = await import("@/lib/tauri");
        await openUrl(authorizationUrl);

        // Start polling cloud accounts (Tauri mode only)
        startPollingForAccounts("discord");
      } else {
        // Web environment: use window.open
        openUrl(authorizationUrl);
      }
    } catch (error) {
      console.error("[Discord Connect] Error:", error);
      toast({
        type: "error",
        description:
          error instanceof Error
            ? error.message
            : t("common.operationFailed", "Operation failed"),
      });
    }
  }, [integrations, t, mutate]);

  /**
   * Start polling session status (Web mode)
   */
  const startPollingForSessionStatus = useCallback(
    (sessionId: string, popupWindow: Window | null) => {
      let pollCount = 0;
      const maxPolls = 60; // Poll at most 60 times (3 minutes, every 3 seconds)
      const pollInterval = 3000; // Poll every 3 seconds

      const pollTimer = setInterval(async () => {
        pollCount++;

        try {
          const response = await fetch(`/api/x/status?sessionId=${sessionId}`);
          const data = await response.json();

          if (data.status === "completed") {
            clearInterval(pollTimer);
            popupWindow?.close();

            // Refresh local account list
            await mutate("/api/integrations");

            toast({
              type: "success",
              description: "Twitter connected successfully!",
            });
            return;
          }

          if (data.status === "error") {
            clearInterval(pollTimer);
            popupWindow?.close();

            toast({
              type: "error",
              description: data.error || "Twitter authorization failed",
            });
            return;
          }
        } catch (error) {
          console.error("[Twitter] Polling error:", error);
          // Continue polling, don't stop due to a single network error
        }

        if (pollCount >= maxPolls) {
          clearInterval(pollTimer);

          toast({
            type: "error",
            description: "Connection timed out. Please try again.",
          });
        }
      }, pollInterval);

      // Store timer reference for cleanup
      pollingTimerRef.current = pollTimer;
    },
    [mutate, t],
  );

  /**
   * Execute X (Twitter) OAuth authorization
   */
  const executeTwitterConnect = useCallback(async () => {
    try {
      // In Tauri mode: get token and pass to backend
      let authToken: string | undefined = undefined;
      const { isTauri } = await import("@/lib/tauri");
      if (isTauri()) {
        const { getAuthToken } = await import("@/lib/auth/token-manager");
        const token = getAuthToken();
        authToken = token || undefined;
        if (!authToken) {
          toast({
            type: "error",
            description: "Authentication required. Please log in again.",
          });
          return;
        }
      }

      const { authorizationUrl, sessionId } =
        await getXAuthorizationUrl(authToken);

      if (isTauri()) {
        // Tauri environment: use Tauri openUrl API
        const { openUrl } = await import("@/lib/tauri");
        await openUrl(authorizationUrl);

        // Start polling cloud accounts (Tauri mode only)
        startPollingForAccounts("twitter");
      } else {
        // Web environment: use window.open and poll session status
        const popupWindow = window.open(authorizationUrl, "_blank");
        if (popupWindow) {
          startPollingForSessionStatus(sessionId, popupWindow);
        }
      }
    } catch (error) {
      console.error("[Twitter Connect] Error:", error);
      toast({
        type: "error",
        description:
          error instanceof Error
            ? error.message
            : t("common.operationFailed", "Operation failed"),
      });
    }
  }, [integrations, t, mutate]);

  /**
   * Build platform definitions
   * Contains configuration and connection logic for all available platforms
   */
  // Auto-trigger platform-specific auth when linkingPlatform is set
  const platformDefs = useMemo<
    Partial<Record<IntegrationId, PlatformDefinition>>
  >(() => {
    /**
     * Slack platform connection handler
     * Shows admin permission confirmation dialog, opens authorization page in new tab after confirmation
     */
    const slackConnect = async () => {
      setPendingPlatform("slack");
      setAdminConfirmOpen(true);
    };

    /**
     * Discord platform connection handler
     * Shows admin permission confirmation dialog, opens authorization page in new tab after confirmation
     */
    const discordConnect = async () => {
      setPendingPlatform("discord");
      setAdminConfirmOpen(true);
    };

    /**
     * X (Twitter) platform connection handler
     * Directly starts OAuth authorization flow, no admin permission required
     */
    const twitterConnect = async () => {
      await executeTwitterConnect();
    };

    /**
     * Microsoft Teams platform connection handler
     * Opens authorization page in a new tab
     */
    const teamsConnect = async () => {
      try {
        const authorizationUrl = await getTeamsAuthorizationUrl();
        openUrl(authorizationUrl);
      } catch (error) {
        toast({
          type: "error",
          description:
            error instanceof Error
              ? error.message
              : t("common.operationFailed", "Operation failed"),
        });
      }
    };

    /**
     * Telegram platform connection handler
     * Shows inline form when onSelectPlatform is provided, otherwise opens Telegram Token form
     */
    const telegramConnect = () => {
      if (onSelectPlatform) {
        onSelectPlatform("telegram", "Telegram");
      } else {
        showTelegramTokenForm();
      }
    };

    /**
     * Gmail platform connection handler
     * Shows inline form when onSelectPlatform is provided, otherwise opens Gmail auth form
     */
    const gmailConnect = () => {
      if (onSelectPlatform) {
        onSelectPlatform("gmail", "Gmail");
      } else {
        setIsGoogleAuthFormOpen(true);
      }
    };

    /**
     * Outlook platform connection handler
     * Shows inline form when onSelectPlatform is provided, otherwise opens Outlook auth form
     */
    const outlookConnect = () => {
      if (onSelectPlatform) {
        onSelectPlatform("outlook", "Outlook");
      } else {
        setIsOutlookAuthFormOpen(true);
      }
    };

    /**
     * Google Drive platform connection handler
     * Opens authorization page in a new tab
     */
    const googleDriveConnect = () => {
      if (typeof window !== "undefined") {
        openUrl("/api/google-drive/oauth");
      }
    };

    const googleCalendarConnect = () => {
      if (typeof window !== "undefined") {
        openUrl("/api/google-calendar/oauth");
      }
    };

    const notionConnect = async () => {
      try {
        let authToken: string | undefined;
        if (isTauri()) {
          const { getAuthToken } = await import("@/lib/auth/token-manager");
          const token = getAuthToken();
          authToken = token || undefined;
        }
        const authorizationUrl = await getNotionAuthorizationUrl(authToken);
        if (isTauri()) {
          const { openUrl: tauriOpenUrl } = await import("@/lib/tauri");
          await tauriOpenUrl(authorizationUrl);
          startPollingForAccounts("notion");
        } else {
          openUrl(authorizationUrl);
        }
      } catch (error) {
        console.error("[Notion Connect] Error:", error);
        toast({
          type: "error",
          description:
            error instanceof Error
              ? error.message
              : t("common.operationFailed", "Operation failed"),
        });
      }
    };

    /**
     * WhatsApp platform connection handler
     * Shows inline form when onSelectPlatform is provided, otherwise opens WhatsApp auth form
     */
    const whatsappConnect = () => {
      if (onSelectPlatform) {
        onSelectPlatform("whatsapp", "WhatsApp");
      } else {
        setIsWhatsAppAuthFormOpen(true);
      }
    };

    const messengerConnect = () => {
      if (onSelectPlatform) {
        onSelectPlatform("facebook_messenger", "Facebook Messenger");
      } else {
        setIsMessengerAuthFormOpen(true);
      }
    };

    const hubspotConnect = async () => {
      try {
        const authorizationUrl = await getHubspotAuthorizationUrl();
        openUrl(authorizationUrl);
      } catch (error) {
        toast({
          type: "error",
          description:
            error instanceof Error
              ? error.message
              : t("common.operationFailed", "Operation failed"),
        });
      }
    };

    const googleDocsConnect = async () => {
      if (typeof window !== "undefined") {
        openUrl("/api/google-docs/oauth");
      }
    };

    const outlookCalendarConnect = () => {
      if (typeof window !== "undefined") {
        openUrl("/api/outlook-calendar/oauth");
      }
    };

    const asanaConnect = () => {
      if (typeof window !== "undefined") {
        openUrl("/api/asana/oauth");
      }
    };

    const jiraConnect = async () => {
      try {
        const authorizationUrl = await getJiraAuthorizationUrl();
        openUrl(authorizationUrl);
      } catch (error) {
        toast({
          type: "error",
          description:
            error instanceof Error
              ? error.message
              : t("common.operationFailed", "Operation failed"),
        });
      }
    };

    const linearConnect = async () => {
      try {
        const authorizationUrl = await getLinearAuthorizationUrl();
        openUrl(authorizationUrl);
      } catch (error) {
        toast({
          type: "error",
          description:
            error instanceof Error
              ? error.message
              : t("common.operationFailed", "Operation failed"),
        });
      }
    };

    /**
     * iMessage platform connection handler
     * Shows inline form when onSelectPlatform is provided, otherwise opens iMessage auth form
     */
    const imessageConnect = () => {
      if (onSelectPlatform) {
        onSelectPlatform("imessage", "iMessage");
      } else {
        setIsIMessageAuthFormOpen?.(true);
      }
    };

    const feishuConnect = () => {
      if (onSelectPlatform) {
        onSelectPlatform("feishu", "Lark/Feishu");
      } else {
        setIsFeishuAuthFormOpen(true);
      }
    };

    const dingtalkConnect = () => {
      if (onSelectPlatform) {
        onSelectPlatform("dingtalk", "DingTalk");
      } else {
        setIsDingTalkAuthFormOpen(true);
      }
    };

    const qqbotConnect = () => {
      if (onSelectPlatform) {
        onSelectPlatform("qqbot", "QQ");
      } else {
        setIsQQBotAuthFormOpen(true);
      }
    };

    const weixinConnect = () => {
      if (onSelectPlatform) {
        onSelectPlatform("weixin", t("auth.weixinLabel"));
      } else {
        setIsWeixinAuthFormOpen(true);
      }
    };

    return {
      slack: {
        id: "slack",
        label: "Slack",
        description: t("auth.slackDes"),
        icon: "slack",
        buttonClass: "bg-[#4A154B] text-white hover:bg-[#3A0F3A]",
        iconBackground: "bg-[#4A154B]/10 text-[#4A154B]",
        onConnect: slackConnect,
      },
      telegram: {
        id: "telegram",
        label: "Telegram",
        description: t("auth.telegramDes"),
        icon: "send_plane",
        buttonClass: "bg-sky-500 text-white hover:bg-sky-600",
        iconBackground: "bg-[#0088CC]/10 text-[#0088CC]",
        onConnect: telegramConnect,
      },
      discord: {
        id: "discord",
        label: "Discord",
        description: t("auth.discordDes"),
        icon: "hashtag",
        buttonClass: "bg-[#5865F2] text-white hover:bg-[#4752C4]",
        iconBackground: "bg-[#5865F2]/10 text-[#5865F2]",
        onConnect: discordConnect,
      },
      whatsapp: {
        id: "whatsapp",
        label: "WhatsApp",
        description: t("auth.whatsappDes"),
        icon: "message",
        buttonClass: "bg-[#25D366] text-white hover:bg-[#1ea952]",
        iconBackground: "bg-[#25D366]/10 text-[#25D366]",
        onConnect: whatsappConnect,
      },
      gmail: {
        id: "gmail",
        label: "Gmail",
        description: t("auth.gmailDes"),
        icon: "mail",
        buttonClass: "bg-red-500 text-white hover:bg-red-600",
        iconBackground: "bg-red-500/10 text-red-500",
        onConnect: gmailConnect,
      },
      outlook: {
        id: "outlook",
        label: "Outlook",
        description: t(
          "auth.outlookDes",
          "Connect Outlook via IMAP/SMTP with an app password.",
        ),
        icon: "mail",
        buttonClass: "bg-[#0F7BFF] text-white hover:bg-[#0c62ca]",
        iconBackground: "bg-[#0F7BFF]/10 text-[#0F7BFF]",
        onConnect: outlookConnect,
      },
      imessage: {
        id: "imessage",
        label: "iMessage",
        description: t(
          "auth.imessageDes",
          "Connect iMessage to read and send messages from your Mac (macOS only).",
        ),
        icon: "apple",
        buttonClass: "bg-[#007AFF] text-white hover:bg-[#0056CC]",
        iconBackground: "bg-[#007AFF]/10 text-[#007AFF]",
        onConnect: imessageConnect,
      },
      feishu: {
        id: "feishu",
        label: "Lark/Feishu",
        description: t(
          "auth.feishuDes",
          "Connect Lark/Feishu with App ID and App Secret to chat with openloomi via WebSocket.",
        ),
        icon: "chat-smile",
        buttonClass: "bg-[#3370FF] text-white hover:bg-[#2860E6]",
        iconBackground: "bg-[#3370FF]/10 text-[#3370FF]",
        onConnect: feishuConnect,
      },
      dingtalk: {
        id: "dingtalk",
        label: "DingTalk",
        description: t(
          "auth.dingtalkDes",
          "Connect DingTalk via Stream mode using Client ID and Client Secret to chat with openloomi.",
        ),
        icon: "chat-smile",
        buttonClass: "bg-[#0089FF] text-white hover:bg-[#0078E0]",
        iconBackground: "bg-[#0089FF]/10 text-[#0089FF]",
        onConnect: dingtalkConnect,
      },
      qqbot: {
        id: "qqbot",
        label: "QQ",
        description: t(
          "auth.qqbotDes",
          "Connect QQ Open Platform using AppID and AppSecret via WebSocket to chat with openloomi.",
        ),
        icon: "qq",
        buttonClass: "bg-[#12B7F5] text-white hover:bg-[#0E9AD4]",
        iconBackground: "bg-[#12B7F5]/10 text-[#12B7F5]",
        onConnect: qqbotConnect,
      },
      weixin: {
        id: "weixin",
        label: t("auth.weixinLabel"),
        description: t("auth.weixinDes"),
        icon: "chat-smile",
        buttonClass: "bg-[#07C160] text-white hover:bg-[#06a854]",
        iconBackground: "bg-[#07C160]/10 text-[#07C160]",
        onConnect: weixinConnect,
      },
      twitter: {
        id: "twitter",
        label: "X (Twitter)",
        description: t(
          "auth.twitterDes",
          "Connect your X account to read/post tweets and reply to DMs.",
        ),
        icon: "twitter-x",
        buttonClass: "bg-black text-white hover:bg-gray-800",
        iconBackground: "bg-black/10 text-black",
        onConnect: twitterConnect,
      },
      google_drive: {
        id: "google_drive",
        label: "Google Drive",
        description: t(
          "auth.googleDriveDes",
          "Save files directly into your Drive.",
        ),
        icon: "cloud",
        buttonClass: "bg-[#1A73E8] text-white hover:bg-[#1558b0]",
        iconBackground: "bg-[#1A73E8]/10 text-[#1A73E8]",
        onConnect: googleDriveConnect,
        disable: true,
      },
      github: {
        id: "github",
        label: "GitHub",
        description: t(
          "auth.githubDes",
          "Connect GitHub repositories to let openloomi learn from your code.",
        ),
        icon: "github",
        buttonClass: "bg-black text-white hover:bg-neutral-800",
        iconBackground: "bg-neutral-900/10 text-neutral-900",
        onConnect: () => {
          if (typeof window !== "undefined") {
            openUrl("/api/github/oauth");
          }
        },
        disable: true,
      },
      google_docs: {
        id: "google_docs",
        label: "Google Docs",
        description: t(
          "auth.googleDocsDes",
          "Connect Google Docs to watch document changes and update content directly from openloomi.",
        ),
        icon: "file_text",
        buttonClass: "bg-[#1A73E8] text-white hover:bg-[#1558b0]",
        iconBackground: "bg-[#1A73E8]/10 text-[#1A73E8]",
        onConnect: googleDocsConnect,
        disable: !googleDocsEnabled,
      },
      hubspot: {
        id: "hubspot",
        label: "HubSpot",
        description: t(
          "auth.hubspotDes",
          "Connect HubSpot to watch pipeline changes and update deal stages from openloomi.",
        ),
        icon: "orbit",
        buttonClass: "bg-[#FF7A59] text-white hover:bg-[#e66545]",
        iconBackground: "bg-[#FF7A59]/10 text-[#FF7A59]",
        onConnect: hubspotConnect,
        disable: !hubspotEnabled,
      },
      outlook_calendar: {
        id: "outlook_calendar",
        label: "Outlook Calendar",
        description: t(
          "auth.outlookCalendarDes",
          "Sync Outlook Calendar to see updates and manage events in openloomi.",
        ),
        icon: "calendar",
        buttonClass: "bg-[#0F7BFF] text-white hover:bg-[#0c62ca]",
        iconBackground: "bg-[#0F7BFF]/10 text-[#0F7BFF]",
        onConnect: outlookCalendarConnect,
        disable: !outlookCalendarEnabled,
      },
      google_calendar: {
        id: "google_calendar",
        label: "Google Calendar",
        description: t(
          "auth.googleCalendarDes",
          "Sync your events and get reminders directly in openloomi.",
        ),
        icon: "calendar",
        buttonClass: "bg-[#1A73E8] text-white hover:bg-[#1558b0]",
        iconBackground: "bg-[#1A73E8]/10 text-[#1A73E8]",
        onConnect: googleCalendarConnect,
        disable: true,
      },
      linkedin: {
        id: "linkedin",
        label: "LinkedIn",
        description: t(
          "auth.linkedinDes",
          "Connect LinkedIn inbox to read and summarize conversations.",
        ),
        icon: "linkedin",
        buttonClass: "bg-[#0A66C2] text-white hover:bg-[#085197]",
        iconBackground: "bg-[#0A66C2]/10 text-[#0A66C2]",
        onConnect: () => {
          openUrl("/api/linkedin/oauth");
        },
        disable: true,
      },
      instagram: {
        id: "instagram",
        label: "Instagram",
        description: t(
          "auth.instagramDes",
          "Connect Instagram DMs to keep conversations and replies together.",
        ),
        icon: "instagram",
        buttonClass:
          "bg-gradient-to-r from-[#F58529] via-[#DD2A7B] to-[#8134AF] text-white hover:brightness-110",
        iconBackground:
          "bg-gradient-to-r from-[#F58529]/20 via-[#DD2A7B]/20 to-[#8134AF]/20 text-[#DD2A7B]",
        onConnect: () => {
          openUrl("/api/instagram/oauth");
        },
        disable: true,
      },
      facebook_messenger: {
        id: "facebook_messenger",
        label: "Facebook Messenger",
        description: t(
          "auth.messengerDes",
          "Connect a Facebook Page and respond to Messenger conversations.",
        ),
        icon: "message",
        buttonClass: "bg-[#0084FF] text-white hover:bg-[#006fd6]",
        iconBackground: "bg-[#0084FF]/10 text-[#0084FF]",
        onConnect: messengerConnect,
        disable: true,
      },
      teams: {
        id: "teams",
        label: "Microsoft Teams",
        description: t(
          "auth.teamsDes",
          "Connect Teams chats and channels for openloomi insights.",
        ),
        icon: "panel_left",
        buttonClass: "bg-[#6264A7] text-white hover:bg-[#4e4f9a]",
        iconBackground: "bg-[#6264A7]/10 text-[#6264A7]",
        onConnect: teamsConnect,
        disable: true,
      },
      notion: {
        id: "notion",
        label: "Notion",
        description: t(
          "auth.notionDes",
          "Save files to Notion and let openloomi learn from selected pages.",
        ),
        icon: "blocks",
        buttonClass: "bg-black text-white hover:bg-neutral-800",
        iconBackground: "bg-neutral-900/10 text-neutral-900",
        onConnect: notionConnect,
      },
      asana: {
        id: "asana",
        label: "Asana",
        description: t(
          "auth.asanaDes",
          "Connect Asana to manage tasks, track projects, and update work items.",
        ),
        icon: "circle_check",
        buttonClass: "bg-[#06B7D2] text-white hover:bg-[#0596ad]",
        iconBackground: "bg-[#06B7D2]/10 text-[#06B7D2]",
        onConnect: asanaConnect,
        disable: true,
      },
      jira: {
        id: "jira",
        label: "Jira",
        description: t(
          "auth.jiraDes",
          "Connect Jira to track issues, manage projects, and collaborate with your team.",
        ),
        icon: "ticket",
        buttonClass: "bg-[#0052CC] text-white hover:bg-[#0041a3]",
        iconBackground: "bg-[#0052CC]/10 text-[#0052CC]",
        onConnect: jiraConnect,
        disable: true,
      },
      linear: {
        id: "linear",
        label: "Linear",
        description: t(
          "auth.linearDes",
          "Connect Linear to manage issues, track projects, and streamline your workflow.",
        ),
        icon: "zap",
        buttonClass: "bg-[#5E6AD2] text-white hover:bg-[#4c56b8]",
        iconBackground: "bg-[#5E6AD2]/10 text-[#5E6AD2]",
        onConnect: linearConnect,
        disable: true,
      },
    };
  }, [
    showTelegramTokenForm,
    setIsGoogleAuthFormOpen,
    setIsOutlookAuthFormOpen,
    setIsWhatsAppAuthFormOpen,
    setIsMessengerAuthFormOpen,
    setIsIMessageAuthFormOpen,
    onSelectPlatform,
    t,
    hubspotEnabled,
    googleDocsEnabled,
    outlookCalendarEnabled,
  ]);

  // Auto-trigger platform-specific auth when linkingPlatform is set
  useEffect(() => {
    if (!linkingPlatform) {
      autoTriggeredPlatformRef.current = null;
      return;
    }
    if (autoTriggeredPlatformRef.current === linkingPlatform) return;

    const definition = platformDefs[linkingPlatform];
    if (definition?.onConnect && definition.disable !== true) {
      autoTriggeredPlatformRef.current = linkingPlatform;
      void definition.onConnect();
    }
  }, [linkingPlatform, platformDefs]);

  /**
   * Handle admin permission confirmation dialog confirm action
   */
  const handleAdminConfirm = async () => {
    if (pendingPlatform === "slack") {
      await executeSlackConnect();
    } else if (pendingPlatform === "discord") {
      await executeDiscordConnect();
    } else if (pendingPlatform === "twitter") {
      await executeTwitterConnect();
    }
    setAdminConfirmOpen(false);
    setPendingPlatform(null);
  };

  /**
   * Handle admin permission confirmation dialog cancel action
   */
  const handleAdminCancel = () => {
    setAdminConfirmOpen(false);
    setPendingPlatform(null);
  };

  /**
   * Platform list content component (shared by Dialog and Drawer)
   */
  const platformListContent = (
    <>
      <div className="pb-0 mb-0">
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {(Object.keys(platformDefs) as IntegrationId[])
            .filter((platformId) => platformDefs[platformId]?.disable !== true)
            .map((platformId) => {
              const definition = platformDefs[platformId];
              if (!definition) {
                return <></>;
              }
              const accountsForPlatform =
                groupedByIntegration[platformId] ?? [];
              const isLinking = linkingPlatform === platformId;
              const summary =
                summarizeConnectedAccountsLocal(accountsForPlatform);

              return (
                <IntegrationPlatformCard
                  key={platformId}
                  platformId={platformId}
                  label={definition.label}
                  summary={summary}
                  isLinking={isLinking}
                  disabled={definition?.disable}
                  onConnect={() => {
                    void definition.onConnect();
                  }}
                />
              );
            })}
        </div>

        {(Object.keys(platformDefs) as IntegrationId[]).some(
          (platformId) => platformDefs[platformId]?.disable === true,
        ) && (
          <div className="mt-3 mb-3 rounded-xl border border-[#e5e5e5] p-4">
            <div className="flex flex-wrap items-center gap-3 mb-2">
              {(Object.keys(platformDefs) as IntegrationId[])
                .filter(
                  (platformId) => platformDefs[platformId]?.disable === true,
                )
                .map((platformId) => {
                  const logoSrc = resolvePlatformLogo(platformId);
                  const info = getPlatformDisplayInfo(platformId, t);
                  return (
                    <div
                      key={platformId}
                      className="flex h-8 w-8 items-center justify-center rounded-full bg-[#f7f6f3] overflow-hidden"
                    >
                      {logoSrc ? (
                        <Image
                          src={logoSrc}
                          alt={info.label}
                          width={24}
                          height={24}
                          className="h-5 w-5"
                        />
                      ) : (
                        <RemixIcon
                          name={info.icon}
                          size="size-4"
                          className="text-[#6f6e69]"
                        />
                      )}
                    </div>
                  );
                })}
            </div>
            <p className="text-xs text-[#6f6e69] pt-1">
              {t(
                "integrations.comingSoonGroup",
                "More platforms are coming soon",
              )}
            </p>
          </div>
        )}
      </div>

      <div className="space-y-2 rounded-xl border border-[#e5e5e5] bg-primary-50 p-4 text-xs text-[#6f6e69] mt-0 mb-3">
        <div className="font-serif font-semibold text-[#37352f] mb-2">
          {t("auth.privacyCommitment")}
        </div>
        <ul className="list-disc space-y-1 pl-4">
          <li>{t("securityPrompt.principles.leastAccessDesc")}</li>
          <li>{t("securityPrompt.principles.localFirstDesc")}</li>
          <li>{t("securityPrompt.principles.encryptedStorageDesc")}</li>
          <li>{t("auth.infoItem3")}</li>
        </ul>
        <p>
          {t("auth.infoItem4")}
          {isTauri() ? (
            <>
              <button
                type="button"
                onClick={() => openUrl("https://app.openloomi.ai/privacy")}
                className="text-blue-500 hover:underline bg-transparent border-none cursor-pointer p-0"
              >
                {t("auth.privacy")}
              </button>
              {t("auth.and")}
              <button
                type="button"
                onClick={() => openUrl("https://app.openloomi.ai/terms")}
                className="text-blue-500 hover:underline bg-transparent border-none cursor-pointer p-0"
              >
                {t("auth.tos")}
              </button>
            </>
          ) : (
            <>
              <a
                href="/privacy"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-500 hover:underline"
              >
                {t("auth.privacy")}
              </a>
              {t("auth.and")}
              <a
                href="/terms"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-500 hover:underline"
              >
                {t("auth.tos")}
              </a>
            </>
          )}
          {t("auth.end")}
        </p>
      </div>
    </>
  );

  return (
    <>
      {platformListContent}

      {/* Admin permission confirmation dialog */}
      <AlertDialog open={adminConfirmOpen} onOpenChange={setAdminConfirmOpen}>
        <AlertDialogContent className="z-[1050]">
          <AlertDialogHeader>
            <div className="flex items-center gap-3 mb-2">
              <RemixIcon
                name="error_warning"
                size="size-6"
                className="text-amber-500"
              />
              <AlertDialogTitle>
                {pendingPlatform === "slack"
                  ? t("auth.slackAdminConfirmTitle", "Slack Admin Required")
                  : t(
                      "auth.discordAdminConfirmTitle",
                      "Discord Admin Required",
                    )}
              </AlertDialogTitle>
            </div>
            <AlertDialogDescription>
              {pendingPlatform === "slack"
                ? t(
                    "auth.slackAdminConfirmDesc",
                    "You need to be a Slack workspace administrator to authorize this integration. Regular members cannot add openloomi to the workspace.",
                  )
                : t(
                    "auth.discordAdminConfirmDesc",
                    "You need to be a Discord server administrator to authorize this integration. Regular members cannot add openloomi to the server.",
                  )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleAdminCancel}>
              {t("common.cancel", "Cancel")}
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleAdminConfirm}>
              {t("auth.iAmAdmin", "I am an Admin")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {!onSelectPlatform && (
        <>
          <FeishuAuthForm
            isOpen={isFeishuAuthFormOpen}
            onClose={() => setIsFeishuAuthFormOpen(false)}
            onSuccess={() => mutate("/api/integrations")}
          />
          <DingTalkAuthForm
            isOpen={isDingTalkAuthFormOpen}
            onClose={() => setIsDingTalkAuthFormOpen(false)}
            onSuccess={() => mutate("/api/integrations")}
          />
          <QQBotAuthForm
            isOpen={isQQBotAuthFormOpen}
            onClose={() => setIsQQBotAuthFormOpen(false)}
            onSuccess={() => mutate("/api/integrations")}
          />
          <WeixinAuthForm
            isOpen={isWeixinAuthFormOpen}
            onClose={() => setIsWeixinAuthFormOpen(false)}
            onSuccess={() => mutate("/api/integrations")}
          />
        </>
      )}
    </>
  );
}

/**
 * Add Platform dialog component (backward compatible Dialog/Drawer wrapper)
 * Uses Dialog on desktop, bottom drawer on mobile
 */
export function AddPlatformDialog({
  isOpen,
  onOpenChange,
  ...contentProps
}: AddPlatformDialogProps) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();

  const handleClose = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);

  const dialogTitle = t(
    "integrations.selectPlatform",
    "Select platform to connect",
  );
  const dialogDescription = t(
    "integrations.selectPlatformDesc",
    "Select a messaging platform to authorize and connect",
  );

  if (isMobile) {
    const transformClass = isOpen ? "translate-y-0" : "translate-y-full";

    return (
      <>
        {/* Overlay */}
        <div
          className={`fixed inset-0 z-[1009] bg-slate-950/30 transition-opacity duration-300 ease-out ${
            isOpen
              ? "pointer-events-auto opacity-100"
              : "pointer-events-none opacity-0"
          }`}
          onClick={handleClose}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              handleClose();
            }
          }}
          role="button"
          tabIndex={0}
        />
        {/* Drawer panel */}
        <div
          role="dialog"
          aria-modal="true"
          className={`fixed inset-x-0 bottom-0 z-[1010] flex w-full flex-col rounded-t-3xl border-t border-border/60 bg-white transition-transform duration-300 ease-out ${transformClass}`}
          style={{ maxHeight: "85vh", height: "85vh" }}
        >
          {/* Drawer header */}
          <div className="flex items-center justify-between bg-card p-4 shrink-0">
            <div className="flex-1">
              <h2 className="text-lg font-semibold text-foreground">
                {dialogTitle}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {dialogDescription}
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleClose}
              className="shrink-0"
              aria-label={t("common.cancel", "Close")}
            >
              <RemixIcon name="close" size="size-5" />
            </Button>
          </div>

          {/* Drawer content - supports scrolling */}
          <div className="flex-1 min-h-0 overflow-y-auto">
            <div className="px-4 py-4">
              <AddPlatformContent {...contentProps} />
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-3xl max-h-[80vh] overflow-y-auto !z-[1010]"
        overlayClassName="!z-[1009]"
      >
        <DialogHeader>
          <DialogTitle>{dialogTitle}</DialogTitle>
          <DialogDescription>{dialogDescription}</DialogDescription>
        </DialogHeader>
        <AddPlatformContent {...contentProps} />
      </DialogContent>
    </Dialog>
  );
}

/**
 * Platform display info type
 */
export interface PlatformDisplayInfo {
  icon: string;
  label: string;
  iconBackground: string;
}

/**
 * Get platform display info (icon, label, background color)
 * Used to display platform info in the connected accounts list
 * @param t Optional: pass i18next t to localize platform names (e.g. Weixin)
 */
export function getPlatformDisplayInfo(
  platformId: IntegrationId,
  t?: TFunction,
): PlatformDisplayInfo {
  const platformMap: Record<IntegrationId, PlatformDisplayInfo> = {
    slack: {
      icon: "slack",
      label: "Slack",
      iconBackground: "bg-[#4A154B]/10 text-[#4A154B]",
    },
    telegram: {
      icon: "send_plane",
      label: "Telegram",
      iconBackground: "bg-[#0088CC]/10 text-[#0088CC]",
    },
    discord: {
      icon: "hashtag",
      label: "Discord",
      iconBackground: "bg-[#5865F2]/10 text-[#5865F2]",
    },
    twitter: {
      icon: "twitter-x",
      label: "X (Twitter)",
      iconBackground: "bg-black/10 text-black",
    },
    gmail: {
      icon: "mail",
      label: "Gmail",
      iconBackground: "bg-red-500/10 text-red-500",
    },
    teams: {
      icon: "panel_left",
      label: "Microsoft Teams",
      iconBackground: "bg-[#6264A7]/10 text-[#6264A7]",
    },
    whatsapp: {
      icon: "message",
      label: "WhatsApp",
      iconBackground: "bg-[#25D366]/10 text-[#25D366]",
    },
    outlook: {
      icon: "mail",
      label: "Outlook",
      iconBackground: "bg-[#0F7BFF]/10 text-[#0F7BFF]",
    },
    linkedin: {
      icon: "linkedin",
      label: "LinkedIn",
      iconBackground: "bg-[#0A66C2]/10 text-[#0A66C2]",
    },
    facebook_messenger: {
      icon: "message",
      label: "Facebook Messenger",
      iconBackground: "bg-[#0084FF]/10 text-[#0084FF]",
    },
    google_drive: {
      icon: "cloud",
      label: "Google Drive",
      iconBackground: "bg-[#1A73E8]/10 text-[#1A73E8]",
    },
    google_docs: {
      icon: "file_text",
      label: "Google Docs",
      iconBackground: "bg-[#1A73E8]/10 text-[#1A73E8]",
    },
    outlook_calendar: {
      icon: "calendar",
      label: "Outlook Calendar",
      iconBackground: "bg-[#0F7BFF]/10 text-[#0F7BFF]",
    },
    hubspot: {
      icon: "orbit",
      label: "HubSpot",
      iconBackground: "bg-[#FF7A59]/10 text-[#FF7A59]",
    },
    notion: {
      icon: "blocks",
      label: "Notion",
      iconBackground: "bg-neutral-900/10 text-neutral-900",
    },
    github: {
      icon: "github",
      label: "GitHub",
      iconBackground: "bg-neutral-900/10 text-neutral-900",
    },
    google_calendar: {
      icon: "calendar",
      label: "Google Calendar",
      iconBackground: "bg-[#1A73E8]/10 text-[#1A73E8]",
    },
    instagram: {
      icon: "instagram",
      label: "Instagram",
      iconBackground:
        "bg-gradient-to-r from-[#F58529]/20 via-[#DD2A7B]/20 to-[#8134AF]/20 text-[#DD2A7B]",
    },
    asana: {
      icon: "circle_check",
      label: "Asana",
      iconBackground: "bg-[#06B7D2]/10 text-[#06B7D2]",
    },
    jira: {
      icon: "ticket",
      label: "Jira",
      iconBackground: "bg-[#0052CC]/10 text-[#0052CC]",
    },
    linear: {
      icon: "zap",
      label: "Linear",
      iconBackground: "bg-[#5E6AD2]/10 text-[#5E6AD2]",
    },
    imessage: {
      icon: "apple",
      label: "iMessage",
      iconBackground: "bg-[#007AFF]/10 text-[#007AFF]",
    },
    feishu: {
      icon: "chat-smile",
      label: "Lark/Feishu",
      iconBackground: "bg-[#3370FF]/10 text-[#3370FF]",
    },
    dingtalk: {
      icon: "chat-smile",
      label: "DingTalk",
      iconBackground: "bg-[#0089FF]/10 text-[#0089FF]",
    },
    qqbot: {
      icon: "qq",
      label: "QQ",
      iconBackground: "bg-[#12B7F5]/10 text-[#12B7F5]",
    },
    weixin: {
      icon: "chat-smile",
      label: t?.("platform.weixin") ?? "Weixin",
      iconBackground: "bg-[#07C160]/10 text-[#07C160]",
    },
  };

  return (
    platformMap[platformId] ?? {
      icon: "ticket",
      label: platformId.charAt(0).toUpperCase() + platformId.slice(1),
      iconBackground: "bg-gray-500/10 text-gray-500",
    }
  );
}
