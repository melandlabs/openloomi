"use client";

import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "./toast";
import { useRouter } from "next/navigation";
import { useSWRConfig } from "swr";
import { RemixIcon } from "@/components/remix-icon";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@openloomi/ui";
import { PlatformIntegrations } from "./platform-integrations";
import { RssIntegrations, RssAddControls } from "./rss-integrations";
import { SavedFiles } from "./saved-files";
import { GoogleAuthForm, type GoogleAuthSubmission } from "./google-auth";
import { WhatsAppAuthForm, type WhatsAppUserInfo } from "./whatsapp-auth";
import { OutlookAuthForm, type OutlookAuthSubmission } from "./outlook-auth";
import {
  MessengerAuthForm,
  type MessengerAuthSubmission,
} from "./messenger-auth-form";
import { IMessageAuthForm } from "./imessage-auth-form";
import { FeishuAuthForm } from "./feishu-auth-form";
import { createIntegrationAccount } from "@/lib/integrations/client";
import { getAuthToken } from "@/lib/auth/token-manager";

const SectionDivider = () => (
  <div className="my-6 h-px w-full bg-gradient-to-r from-transparent via-[#e5e5e5] to-transparent" />
);

export function Integrations() {
  const { t } = useTranslation();
  const router = useRouter();
  const { mutate } = useSWRConfig();
  const [isGoogleAuthFormOpen, setIsGoogleAuthFormOpen] = useState(false);
  const [isWhatsAppAuthFormOpen, setIsWhatsAppAuthFormOpen] = useState(false);
  const [isOutlookAuthFormOpen, setIsOutlookAuthFormOpen] = useState(false);
  const [isMessengerAuthFormOpen, setIsMessengerAuthFormOpen] = useState(false);
  const [isIMessageAuthFormOpen, setIsIMessageAuthFormOpen] = useState(false);
  const [isFeishuAuthFormOpen, setIsFeishuAuthFormOpen] = useState(false);

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

      router.refresh();
      setIsGoogleAuthFormOpen(false);
    },
    [router, t],
  );

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

      // Initialize WhatsApp Self Message Listener
      try {
        const cloudAuthToken = getAuthToken() || undefined;
        const response = await fetch("/api/whatsapp/init-self-listener", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            cloudAuthToken ? { authToken: cloudAuthToken } : {},
          ),
        });
        if (response.ok) {
          console.log(
            "[WhatsApp] Self Message Listener initialized successfully",
          );
        }
      } catch (error) {
        console.error(
          "[WhatsApp] Failed to initialize Self Message Listener:",
          error,
        );
      }

      // Show success and usage hint
      toast({
        type: "success",
        description: t("auth.whatsappLogin"),
      });
      toast({
        type: "info",
        description: t("auth.whatsappLoginHint"),
      });

      // Refresh integrations list immediately
      await mutate("/api/integrations");
      router.refresh();
      setIsWhatsAppAuthFormOpen(false);
    },
    [mutate, router, t],
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

      router.refresh();
      setIsOutlookAuthFormOpen(false);
    },
    [router],
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

      router.refresh();
      setIsMessengerAuthFormOpen(false);
    },
    [router],
  );

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8">
      <header className="space-y-3 text-center">
        <h1 className="text-2xl font-semibold text-[#37352f] sm:text-3xl">
          {t("common.myIntegrations")}
        </h1>
        <p className="mx-auto max-w-2xl text-sm leading-relaxed text-[#6f6e69] sm:text-base">
          {t(
            "integrations.description",
            "Manage your connected platforms, RSS feeds, and saved files in one place.",
          )}
        </p>
      </header>

      <SectionDivider />

      <Tabs defaultValue="platforms" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="platforms">
            <RemixIcon name="message_circle" size="size-4" className="mr-2" />
            {t("common.imPlatform")}
          </TabsTrigger>
          <TabsTrigger value="rss">
            <RemixIcon name="rss" size="size-4" className="mr-2" />
            RSS
          </TabsTrigger>
          <TabsTrigger value="files">
            <RemixIcon name="file_text" size="size-4" className="mr-2" />
            {t("nav.savedFiles", "Saved Files")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="platforms" className="space-y-6 mt-6">
          <PlatformIntegrations
            onGoogleAuthOpen={() => setIsGoogleAuthFormOpen(true)}
            onWhatsAppAuthOpen={() => setIsWhatsAppAuthFormOpen(true)}
            onOutlookAuthOpen={() => setIsOutlookAuthFormOpen(true)}
            onMessengerAuthOpen={() => setIsMessengerAuthFormOpen(true)}
            onIMessageAuthOpen={() => setIsIMessageAuthFormOpen(true)}
          />
        </TabsContent>

        <TabsContent value="rss" className="space-y-6 mt-6">
          <RssAddControls />
          <RssIntegrations />
        </TabsContent>

        <TabsContent value="files" className="space-y-6 mt-6">
          <SavedFiles />
        </TabsContent>
      </Tabs>

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
        onSuccess={() => {
          router.refresh();
        }}
      />

      <FeishuAuthForm
        isOpen={isFeishuAuthFormOpen}
        onClose={() => setIsFeishuAuthFormOpen(false)}
        onSuccess={() => router.refresh()}
      />
    </div>
  );
}
