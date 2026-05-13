"use client";

import { useState, useEffect, useCallback, lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import { useRouter } from "next/navigation";
import { useSWRConfig } from "swr";
import { RemixIcon } from "@/components/remix-icon";
import { Button } from "@openloomi/ui";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@openloomi/ui";
import type { IntegrationId } from "@/hooks/use-integrations";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@openloomi/ui";
import {
  PlatformIntegrations,
  useTelegramTokenForm,
} from "@/components/platform-integrations";
import { RssIntegrations, RssAddControls } from "@/components/rss-integrations";

// Dynamically import AddPlatformContent to reduce initial JS bundle size
const AddPlatformContentLazy = lazy(() =>
  import("@/components/add-platform-dialog").then((mod) => ({
    default: mod.AddPlatformContent,
  })),
);
import { useRssSubscriptions } from "@/hooks/use-rss-subscriptions";
import {
  GoogleAuthForm,
  type GoogleAuthSubmission,
} from "@/components/google-auth";
import {
  WhatsAppAuthForm,
  type WhatsAppUserInfo,
} from "@/components/whatsapp-auth";
import {
  OutlookAuthForm,
  type OutlookAuthSubmission,
} from "@/components/outlook-auth";
import {
  MessengerAuthForm,
  type MessengerAuthSubmission,
} from "@/components/messenger-auth-form";
import { IMessageAuthForm } from "@/components/imessage-auth-form";
import { TelegramTokenForm } from "@/components/telegram-token-form";
import { FeishuAuthForm } from "@/components/feishu-auth-form";
import { DingTalkAuthForm } from "@/components/dingtalk-auth-form";
import { QQBotAuthForm } from "@/components/qqbot-auth-form";
import { WeixinAuthForm } from "@/components/weixin-auth-form";
import { createIntegrationAccount } from "@/lib/integrations/client";
import { useIntegrations } from "@/hooks/use-integrations";

/**
 * Linked accounts component in personalization settings
 * Used to display and manage all user authorized accounts and RSS in assistant profile
 */
export function PersonalizationLinkedAccounts({
  open,
  isAddConnectorDialogOpen,
  onAddConnectorDialogOpenChange,
  initialAddPanelTab = "apps",
  linkingPlatform,
}: {
  open: boolean;
  isAddConnectorDialogOpen?: boolean;
  onAddConnectorDialogOpenChange?: (open: boolean) => void;
  initialAddPanelTab?: "apps" | "rss";
  linkingPlatform?: IntegrationId | null;
}) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { mutate } = useSWRConfig();
  const { subscriptions: rssSubscriptions } = useRssSubscriptions();
  const [addPanelTab, setAddPanelTab] = useState<"apps" | "rss">(
    initialAddPanelTab,
  );
  const [isGoogleAuthFormOpen, setIsGoogleAuthFormOpen] = useState(false);
  const [isWhatsAppAuthFormOpen, setIsWhatsAppAuthFormOpen] = useState(false);
  const [isOutlookAuthFormOpen, setIsOutlookAuthFormOpen] = useState(false);
  const [isMessengerAuthFormOpen, setIsMessengerAuthFormOpen] = useState(false);
  const [isIMessageAuthFormOpen, setIsIMessageAuthFormOpen] = useState(false);
  /** Tracks the currently selected platform for inline form rendering within the connector dialog */
  const [inlinePlatformView, setInlinePlatformView] = useState<{
    platformId: IntegrationId;
    platformName: string;
  } | null>(null);
  const {
    showTelegramTokenForm,
    hideTelegramTokenForm,
    telegramReconnectAccountId,
    isTelegramTokenFormOpen,
  } = useTelegramTokenForm();
  const { accounts: integrationAccounts, mutate: mutateIntegrations } =
    useIntegrations();
  const [internalAddConnectorDialogOpen, setInternalAddConnectorDialogOpen] =
    useState(false);

  const isConnectorDialogOpen =
    isAddConnectorDialogOpen ?? internalAddConnectorDialogOpen;

  /**
   * Sync dialog tab with externally provided initial tab
   * so deep links can open add-connector dialog in the expected tab.
   */
  /**
   * Keep add-panel tab in sync with route-level intent (apps / rss).
   */
  useEffect(() => {
    setAddPanelTab(initialAddPanelTab);
  }, [initialAddPanelTab, isConnectorDialogOpen]);

  /**
   * Unified add-connector dialog open-state setter for controlled/uncontrolled usage.
   */
  const setConnectorDialogOpen = useCallback(
    (nextOpen: boolean) => {
      onAddConnectorDialogOpenChange?.(nextOpen);
      if (isAddConnectorDialogOpen === undefined) {
        setInternalAddConnectorDialogOpen(nextOpen);
      }
    },
    [isAddConnectorDialogOpen, onAddConnectorDialogOpenChange],
  );

  /**
   * Navigates to an inline platform form view within the connector dialog.
   */
  const handleSelectPlatformForInlineForm = useCallback(
    (platformId: IntegrationId, platformName: string) => {
      setInlinePlatformView({ platformId, platformName });
    },
    [],
  );

  /**
   * Returns to the platform list from an inline form view.
   */
  const handleBackToPlatformList = useCallback(() => {
    setInlinePlatformView(null);
  }, []);

  /**
   * Open Google auth dialog (legacy: used when connector dialog is not open).
   */
  const openGoogleAuthFromConnectorDialog = useCallback(() => {
    setConnectorDialogOpen(false);
    setIsGoogleAuthFormOpen(true);
  }, [setConnectorDialogOpen]);

  /**
   * Open WhatsApp auth dialog (legacy: used when connector dialog is not open).
   */
  const openWhatsAppAuthFromConnectorDialog = useCallback(() => {
    setConnectorDialogOpen(false);
    setIsWhatsAppAuthFormOpen(true);
  }, [setConnectorDialogOpen]);

  /**
   * Open Outlook auth dialog (legacy: used when connector dialog is not open).
   */
  const openOutlookAuthFromConnectorDialog = useCallback(() => {
    setConnectorDialogOpen(false);
    setIsOutlookAuthFormOpen(true);
  }, [setConnectorDialogOpen]);

  /**
   * Open Messenger auth dialog (legacy: used when connector dialog is not open).
   */
  const openMessengerAuthFromConnectorDialog = useCallback(() => {
    setConnectorDialogOpen(false);
    setIsMessengerAuthFormOpen(true);
  }, [setConnectorDialogOpen]);

  /**
   * Open iMessage auth dialog (legacy: used when connector dialog is not open).
   */
  const openIMessageAuthFromConnectorDialog = useCallback(() => {
    setConnectorDialogOpen(false);
    setIsIMessageAuthFormOpen(true);
  }, [setConnectorDialogOpen]);

  /**
   * Handle Google account authorization submission
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

      await mutateIntegrations();
      router.refresh();
      setIsGoogleAuthFormOpen(false);
    },
    [mutateIntegrations, router],
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
      await createIntegrationAccount({
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
          platform: "facebook_messenger",
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

      await mutateIntegrations();
      router.refresh();
      setIsMessengerAuthFormOpen(false);
    },
    [mutateIntegrations, router],
  );

  /**
   * Handle WhatsApp account authorization success
   */
  const handleWhatsAppSuccess = useCallback(
    async (sessionKey: string, user: WhatsAppUserInfo) => {
      await createIntegrationAccount({
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

      // Refresh integrations list immediately
      await mutate("/api/integrations");
      router.refresh();
      setIsWhatsAppAuthFormOpen(false);
    },
    [mutate, router],
  );

  const handleOutlookSubmit = useCallback(
    async ({ email, appPassword, name }: OutlookAuthSubmission) => {
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

      await mutateIntegrations();
      router.refresh();
      setIsOutlookAuthFormOpen(false);
    },
    [mutateIntegrations, router],
  );

  return (
    <>
      {/* Main area: existing platform / RSS list */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="flex flex-col gap-6 w-full px-6 pt-6 pb-6 space-y-4">
          <div className="mt-0 mb-0">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setConnectorDialogOpen(true)}
              className="gap-1.5"
            >
              <i className="ri-add-line" />
              {t("integrations.addConnector", "Add connector")}
            </Button>
          </div>
          <Accordion
            type="multiple"
            defaultValue={["platforms", "rss"]}
            className="flex flex-col gap-6 mt-0 mb-6 divide-y divide-border/60"
          >
            <AccordionItem
              value="platforms"
              className="border-none flex flex-col gap-3"
            >
              <AccordionTrigger className="px-0 py-0 gap-3 hover:no-underline">
                <div className="flex w-full items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-foreground">
                    {t("common.connectedAccounts")}{" "}
                    <span className="text-xs font-medium text-muted-foreground">
                      ({integrationAccounts.length})
                    </span>
                  </span>
                </div>
              </AccordionTrigger>
              <AccordionContent className="pt-0 px-0 pb-0">
                <PlatformIntegrations
                  onGoogleAuthOpen={() => setIsGoogleAuthFormOpen(true)}
                  onWhatsAppAuthOpen={() => setIsWhatsAppAuthFormOpen(true)}
                  onOutlookAuthOpen={() => setIsOutlookAuthFormOpen(true)}
                  onMessengerAuthOpen={() => setIsMessengerAuthFormOpen(true)}
                  onIMessageAuthOpen={() => setIsIMessageAuthFormOpen(true)}
                />
              </AccordionContent>
            </AccordionItem>

            <AccordionItem
              value="rss"
              className="border-none flex flex-col gap-3"
            >
              <AccordionTrigger className="px-0 py-0 hover:no-underline">
                <div className="flex w-full items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-foreground">
                    {t(
                      "integrations.mySubscriptionsTitle",
                      "My subscription sources",
                    )}{" "}
                    <span className="text-xs font-medium text-muted-foreground">
                      ({rssSubscriptions.length})
                    </span>
                  </span>
                </div>
              </AccordionTrigger>
              <AccordionContent className="pt-0 px-0 pb-0">
                <RssIntegrations />
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>
      </div>

      <Dialog
        open={isConnectorDialogOpen}
        onOpenChange={(open) => {
          if (!open) setInlinePlatformView(null);
          setConnectorDialogOpen(open);
        }}
      >
        <DialogContent
          overlayClassName="!z-[120] bg-black/25 backdrop-blur-0"
          className="!z-[121] w-[92vw] max-w-[1200px] sm:!max-w-[1200px] p-0 overflow-hidden bg-[#f6f6f6] border-[#e6e6e6]"
        >
          <div className="flex h-[70vh] min-h-[540px] min-w-0 flex-col">
            <Tabs
              value={addPanelTab}
              onValueChange={(value) =>
                setAddPanelTab((value as "apps" | "rss") ?? "apps")
              }
              className="flex h-full min-w-0 flex-1 flex-col"
            >
              {/* Dialog header: shows back button + platform name when in inline form view */}
              <DialogTitle className="flex items-center justify-between px-8 py-6">
                {inlinePlatformView ? (
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={handleBackToPlatformList}
                      className="h-8 w-8 shrink-0"
                      aria-label={t("common.back", "Back")}
                    >
                      <RemixIcon name="arrow_left" size="size-4" />
                    </Button>
                    <span className="text-2xl font-serif font-semibold text-foreground">
                      {t("integrations.connectPlatform", "Connect {{name}}", {
                        name: inlinePlatformView.platformName,
                      })}
                    </span>
                  </div>
                ) : (
                  <span className="text-2xl font-serif font-semibold text-foreground">
                    {t("integrations.addConnector", "Add Connectors")}
                  </span>
                )}
              </DialogTitle>

              {/* Tabs navigation: hidden when showing inline form */}
              {!inlinePlatformView && (
                <div className="px-8 pt-0 pb-2">
                  <TabsList className="h-auto bg-transparent p-0 gap-4">
                    <TabsTrigger
                      value="apps"
                      className="rounded-none border-b-2 border-transparent px-1 py-2 text-sm data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none"
                    >
                      Apps
                    </TabsTrigger>
                    <TabsTrigger
                      value="rss"
                      className="rounded-none border-b-2 border-transparent px-1 py-2 text-sm data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none"
                    >
                      RSS
                    </TabsTrigger>
                  </TabsList>
                </div>
              )}

              <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-[#f6f6f6]">
                <div className="min-h-0 flex-1 overflow-y-auto px-8 pt-0 pb-4">
                  {inlinePlatformView ? (
                    /* Inline form view: render the selected platform's form directly */
                    <div className="py-4">
                      {inlinePlatformView.platformId === "telegram" && (
                        <TelegramTokenForm
                          embedded
                          isOpen
                          onClose={handleBackToPlatformList}
                          isMobile={false}
                        />
                      )}
                      {inlinePlatformView.platformId === "gmail" && (
                        <GoogleAuthForm
                          embedded
                          isOpen
                          onClose={handleBackToPlatformList}
                          onSubmit={handleGoogleSubmit}
                        />
                      )}
                      {inlinePlatformView.platformId === "outlook" && (
                        <OutlookAuthForm
                          embedded
                          isOpen
                          onClose={handleBackToPlatformList}
                          onSubmit={handleOutlookSubmit}
                        />
                      )}
                      {inlinePlatformView.platformId === "whatsapp" && (
                        <WhatsAppAuthForm
                          embedded
                          isOpen
                          onClose={handleBackToPlatformList}
                          onSuccess={handleWhatsAppSuccess}
                        />
                      )}
                      {inlinePlatformView.platformId ===
                        "facebook_messenger" && (
                        <MessengerAuthForm
                          embedded
                          isOpen
                          onClose={handleBackToPlatformList}
                          onSubmit={handleMessengerSubmit}
                        />
                      )}
                      {inlinePlatformView.platformId === "imessage" && (
                        <IMessageAuthForm
                          embedded
                          isOpen
                          onClose={handleBackToPlatformList}
                          onSuccess={async () => {
                            await mutateIntegrations();
                            router.refresh();
                            handleBackToPlatformList();
                          }}
                        />
                      )}
                      {inlinePlatformView.platformId === "feishu" && (
                        <FeishuAuthForm
                          embedded
                          isOpen
                          onClose={handleBackToPlatformList}
                          onSuccess={() => mutateIntegrations()}
                        />
                      )}
                      {inlinePlatformView.platformId === "dingtalk" && (
                        <DingTalkAuthForm
                          embedded
                          isOpen
                          onClose={handleBackToPlatformList}
                          onSuccess={() => mutateIntegrations()}
                        />
                      )}
                      {inlinePlatformView.platformId === "qqbot" && (
                        <QQBotAuthForm
                          embedded
                          isOpen
                          onClose={handleBackToPlatformList}
                          onSuccess={() => mutateIntegrations()}
                        />
                      )}
                      {inlinePlatformView.platformId === "weixin" && (
                        <WeixinAuthForm
                          embedded
                          isOpen
                          onClose={handleBackToPlatformList}
                          onSuccess={() => mutateIntegrations()}
                        />
                      )}
                    </div>
                  ) : (
                    <>
                      <TabsContent value="apps" className="mt-0">
                        <Suspense fallback={null}>
                          <AddPlatformContentLazy
                            showTelegramTokenForm={showTelegramTokenForm}
                            setIsGoogleAuthFormOpen={
                              openGoogleAuthFromConnectorDialog
                            }
                            setIsOutlookAuthFormOpen={
                              openOutlookAuthFromConnectorDialog
                            }
                            setIsWhatsAppAuthFormOpen={
                              openWhatsAppAuthFromConnectorDialog
                            }
                            setIsMessengerAuthFormOpen={
                              openMessengerAuthFromConnectorDialog
                            }
                            setIsIMessageAuthFormOpen={
                              openIMessageAuthFromConnectorDialog
                            }
                            onSelectPlatform={handleSelectPlatformForInlineForm}
                            linkingPlatform={linkingPlatform}
                          />
                        </Suspense>
                      </TabsContent>
                      <TabsContent value="rss" className="mt-0">
                        <RssAddControls />
                      </TabsContent>
                    </>
                  )}
                </div>
              </div>
            </Tabs>
          </div>
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

      <IMessageAuthForm
        isOpen={isIMessageAuthFormOpen}
        onClose={() => setIsIMessageAuthFormOpen(false)}
        onSuccess={async () => {
          await mutateIntegrations();
          router.refresh();
        }}
      />

      <TelegramTokenForm
        isOpen={isTelegramTokenFormOpen}
        onClose={hideTelegramTokenForm}
        isMobile={false}
        reconnectAccountId={telegramReconnectAccountId}
      />
    </>
  );
}
