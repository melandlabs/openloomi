import * as Sentry from "@sentry/nextjs";
import { sanitizeSentryEvent } from "./lib/analytics/sentry/sentry-sanitize";

export function register() {
  // Only enable OTel in production when not in Tauri mode
  // Tauri local version does not need Vercel OTel
  if (
    process.env.NODE_ENV === "production" &&
    process.env.TAURI_MODE !== "1" &&
    process.env.IS_TAURI !== "true"
  ) {
    const { registerOTel } = require("@vercel/otel");
    registerOTel({ serviceName: "openloomi" });
  }

  // Initialize Sentry server-side for Node.js runtime
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.SENTRY_DSN) {
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.NODE_ENV,
      release: process.env.NEXT_PUBLIC_APP_VERSION,
      tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
      beforeSend: sanitizeSentryEvent,
    });
  }

  // Install audit interceptors: Only load in Node.js runtime, Edge Runtime does not support fs/child_process
  if (process.env.NEXT_RUNTIME === "nodejs") {
    try {
      const { installAuditInterceptors } = require("@openloomi/audit");
      installAuditInterceptors();
    } catch (e) {
      console.warn("[Audit] Failed to load audit interceptors:", e);
    }

    // Start Feishu WebSocket listener (server mode only; Tauri with Telegram/iMessage only starts when frontend calls init with token)
    const isTauri =
      process.env.TAURI_MODE === "1" || process.env.IS_TAURI === "true";
    if (isTauri) {
      import("./lib/integrations/feishu/ws-listener")
        .then(({ startAllFeishuListeners }) => startAllFeishuListeners())
        .catch((e) => console.warn("[Feishu] Failed to start listener:", e));
      import("./lib/integrations/dingtalk/ws-listener")
        .then(({ startAllDingTalkListeners }) => startAllDingTalkListeners())
        .catch((e) => console.warn("[DingTalk] Failed to start listener:", e));
      import("./lib/integrations/qqbot/ws-listener")
        .then(({ startAllQQListeners }) => startAllQQListeners())
        .catch((e) => console.warn("[QQBot] Failed to start listener:", e));
      // Weixin listener is started on-demand by WeixinListenerInit (frontend component)
      // after user authentication, not here, to avoid duplicate poll loops.
    }
  }
}
