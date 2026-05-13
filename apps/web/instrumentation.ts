export function register() {
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
