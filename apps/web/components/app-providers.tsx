/**
 * App Providers component
 * Unified management of all Providers, reduces nesting depth
 * Uses lazy initialization to defer loading of non-critical Providers
 */

"use client";

import { Suspense, memo } from "react";
import { SessionProvider } from "next-auth/react";
import { InsightOptimisticProvider } from "@/components/insight-optimistic-context";
import { MobileLayoutWrapper } from "@/components/mobile-layout-wrapper";
import { MobileBackButton } from "@/components/mobile-back-button";
import { TelegramSelfListenerInit } from "@/components/telegram-self-listener-init";
import { WhatsAppSelfListenerInit } from "@/components/whatsapp-self-listener-init";
import { IMessageSelfListenerInit } from "@/components/imessage-self-listener-init";
import {
  FeishuListenerInit,
  DingTalkListenerInit,
  QQBotListenerInit,
  WeixinListenerInit,
} from "@/components/feishu-listener-init";
import { CloudSyncInit } from "@/components/cloud-sync-init";
import { InsightRefreshInit } from "@/components/insight-refresh-init";
import { RawMessagesMigrationInit } from "@/components/raw-messages-migration-init";
import { TelegramTokenFormProvider } from "@/components/platform-integrations";

// Lazy load initialization components - use Suspense boundaries to avoid blocking initial render
const IntegrationInitComponents = memo(() => (
  <Suspense fallback={null}>
    <TelegramSelfListenerInit />
    <WhatsAppSelfListenerInit />
    <IMessageSelfListenerInit />
    <FeishuListenerInit />
    <DingTalkListenerInit />
    <QQBotListenerInit />
    <WeixinListenerInit />
    <CloudSyncInit />
    <InsightRefreshInit />
    <RawMessagesMigrationInit />
  </Suspense>
));

IntegrationInitComponents.displayName = "IntegrationInitComponents";

// Lazy load mobile components
const MobileComponents = memo(() => (
  <Suspense fallback={null}>
    <MobileBackButton />
  </Suspense>
));

MobileComponents.displayName = "MobileComponents";

/**
 * Core app content - only includes necessary initialization
 */
export function AppContent({ children }: { children: React.ReactNode }) {
  return <InsightOptimisticProvider>{children}</InsightOptimisticProvider>;
}

/**
 * Complete app Provider tree
 */
export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      {/* Lazy load integration initialization components */}
      <IntegrationInitComponents />
      <TelegramTokenFormProvider>
        <MobileLayoutWrapper>
          <AppContent>{children}</AppContent>
          <MobileComponents />
        </MobileLayoutWrapper>
      </TelegramTokenFormProvider>
    </SessionProvider>
  );
}
