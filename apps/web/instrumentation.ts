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
      // Load token from ~/.openloomi/token and pass it to listeners
      let token: string | undefined;
      try {
        const { homedir } = require("node:os");
        const { join } = require("node:path");
        const { existsSync, readFileSync } = require("node:fs");

        const tokenPath = join(homedir(), ".openloomi", "token");
        if (existsSync(tokenPath)) {
          const encoded = readFileSync(tokenPath, "utf-8").trim();
          if (encoded) {
            try {
              token =
                Buffer.from(encoded, "base64").toString("utf-8") || undefined;
              console.log(
                `[Instrumentation] Loaded auth token from ${tokenPath}, ` +
                  `length=${token?.length ?? 0}, valid=${token ? "yes" : "no"}`,
              );
            } catch {
              console.warn(
                "[Instrumentation] Failed to decode auth token from base64",
              );
            }
          } else {
            console.warn(
              "[Instrumentation] Auth token file exists but is empty",
            );
          }
        } else {
          console.warn(
            "[Instrumentation] Auth token file does not exist at",
            tokenPath,
          );
        }
      } catch (e) {
        console.warn("[Instrumentation] Failed to load auth token:", e);
      }

      import("./lib/integrations/feishu/ws-listener")
        .then(({ startAllFeishuListeners }) => {
          console.log(
            "[Instrumentation] Starting Feishu listeners with token:",
            token ? "yes" : "no",
          );
          startAllFeishuListeners(token);
        })
        .catch((e) => console.warn("[Feishu] Failed to start listener:", e));
      import("./lib/integrations/dingtalk/ws-listener")
        .then(({ startAllDingTalkListeners }) => startAllDingTalkListeners())
        .catch((e) => console.warn("[DingTalk] Failed to start listener:", e));
      import("./lib/integrations/qqbot/ws-listener")
        .then(({ startAllQQListeners }) => startAllQQListeners())
        .catch((e) => console.warn("[QQBot] Failed to start listener:", e));
      // Weixin listener is started on-demand by WeixinListenerInit (frontend component)
      // after user authentication, not here, to avoid duplicate poll loops.

      // Loop cron handlers + scheduler: register the three custom handler
      // names ("loop.tick" / "loop.brief" / "loop.wrap") so the existing
      // local-scheduler can dispatch Loop's ScheduledJob rows through the
      // cron executor. ensureLoopJobs() runs idempotently and soft-fails on
      // any DB / fs error so the rest of the runtime is unaffected.
      import("./lib/loop/handlers")
        .then(({ registerLoopHandlers }) => {
          try {
            registerLoopHandlers();
          } catch (e) {
            console.warn("[Loop] Handler registration failed:", e);
          }
        })
        .catch((e) => console.warn("[Loop] Handler import failed:", e));
      import("./lib/loop/scheduler")
        .then(({ start: startLoopScheduler }) => {
          // Awaited via .catch — startLoopScheduler is async but we don't
          // need to block instrumentation on it.
          startLoopScheduler().catch((e: unknown) =>
            console.warn("[Loop] start failed:", e),
          );
        })
        .catch((e) => console.warn("[Loop] Scheduler import failed:", e));

      // Legacy daemon cleanup (#288): sweep for any stale
      // `openloomi-loop.cjs schedule|watch` process left running from an
      // older debug build and SIGTERM it. Best-effort; soft-fails so the
      // rest of instrumentation runs unaffected.
      import("./lib/loop/legacy-cleanup")
        .then(({ cleanupLegacyLoopDaemon }) => {
          try {
            const r = cleanupLegacyLoopDaemon();
            if (r.killedPids.length || r.pidFileRemoved) {
              console.log(
                `[Loop] legacy cleanup: killed=${r.killedPids.length} pidFileRemoved=${r.pidFileRemoved}`,
              );
            }
          } catch (e) {
            console.warn("[Loop] legacy cleanup failed:", e);
          }
        })
        .catch((e) => console.warn("[Loop] legacy-cleanup import failed:", e));
    }
  }
}
