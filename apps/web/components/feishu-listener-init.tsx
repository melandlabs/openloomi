/**
 * Feishu / DingTalk / QQ / WeChat listener initialization (Bot mode, not self mode)
 *
 * These platforms are all "user chatting with bot": openloomi listens to messages received by bot and replies on behalf.
 * This component only runs under Tauri, after session is ready, passes cloud_auth_token to backend,
 * for bot to call cloud AI when receiving user messages, and re-establishes WebSocket connection after app restart.
 */
"use client";

import { useEffect, useRef } from "react";
import { useSession } from "next-auth/react";
import { getAuthToken } from "@/lib/auth/token-manager";

export function FeishuListenerInit() {
  const { data: session } = useSession();
  const initTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const isTauri =
      typeof window !== "undefined" &&
      // @ts-ignore - __TAURI__ is injected by Tauri
      (window as any).__TAURI__;

    if (!isTauri) {
      return;
    }

    // Too long delay causes server-side WS to connect but token not yet injected; user sends Feishu message first will get 401
    initTimeoutRef.current = setTimeout(async () => {
      const userId = session?.user?.id;
      const isAuthenticated = session !== null && !!userId;
      if (!isAuthenticated) {
        return;
      }

      try {
        const cloudAuthToken = getAuthToken() || undefined;
        if (!cloudAuthToken) {
          return;
        }

        await fetch("/api/feishu/listener/init", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cloudAuthToken }),
        });
      } catch {
        // Silent (no error handling)
      }
    }, 400);

    return () => {
      if (initTimeoutRef.current) {
        clearTimeout(initTimeoutRef.current);
      }
    };
  }, [session?.user?.id]);

  return null;
}

export function DingTalkListenerInit() {
  const { data: session } = useSession();
  const initTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const isTauri =
      typeof window !== "undefined" &&
      // @ts-ignore - __TAURI__ is injected by Tauri
      (window as any).__TAURI__;

    if (!isTauri) {
      return;
    }

    initTimeoutRef.current = setTimeout(async () => {
      const userId = session?.user?.id;
      const isAuthenticated = session !== null && !!userId;
      if (!isAuthenticated) {
        return;
      }

      try {
        const cloudAuthToken = getAuthToken() || undefined;
        if (!cloudAuthToken) {
          return;
        }

        await fetch("/api/dingtalk/listener/init", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cloudAuthToken }),
        });
      } catch {
        // Silent (no error handling)
      }
    }, 3000);

    return () => {
      if (initTimeoutRef.current) {
        clearTimeout(initTimeoutRef.current);
      }
    };
  }, [session?.user?.id]);

  return null;
}

export function QQBotListenerInit() {
  const { data: session } = useSession();
  const initTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const isTauri =
      typeof window !== "undefined" &&
      // @ts-ignore - __TAURI__ is injected by Tauri
      (window as any).__TAURI__;

    if (!isTauri) {
      return;
    }

    initTimeoutRef.current = setTimeout(async () => {
      const userId = session?.user?.id;
      const isAuthenticated = session !== null && !!userId;
      if (!isAuthenticated) {
        return;
      }

      try {
        const cloudAuthToken = getAuthToken() || undefined;
        if (!cloudAuthToken) {
          return;
        }

        await fetch("/api/qqbot/listener/init", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cloudAuthToken }),
        });
      } catch {
        // Silent (no error handling)
      }
    }, 3000);

    return () => {
      if (initTimeoutRef.current) {
        clearTimeout(initTimeoutRef.current);
      }
    };
  }, [session?.user?.id]);

  return null;
}

export function WeixinListenerInit() {
  const { data: session } = useSession();
  const initTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const isTauri =
      typeof window !== "undefined" &&
      // @ts-ignore - __TAURI__ is injected by Tauri
      (window as any).__TAURI__;

    if (!isTauri) {
      return;
    }

    initTimeoutRef.current = setTimeout(async () => {
      const userId = session?.user?.id;
      const isAuthenticated = session !== null && !!userId;
      if (!isAuthenticated) {
        return;
      }

      try {
        const cloudAuthToken = getAuthToken() || undefined;
        if (!cloudAuthToken) {
          return;
        }

        await fetch("/api/weixin/listener/init", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cloudAuthToken }),
        });
      } catch {
        // Silent (no error handling)
      }
    }, 3000);

    return () => {
      if (initTimeoutRef.current) {
        clearTimeout(initTimeoutRef.current);
      }
    };
  }, [session?.user?.id]);

  return null;
}
