"use client";

import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useSession } from "next-auth/react";

import { isTauriMode } from "@/lib/env/client-mode";

/**
 * TokenSync
 *
 * Keeps `~/.openloomi/token` aligned with the current NextAuth session.
 *
 * - Only runs in Tauri mode (web mode: no-op).
 * - Fetches a freshly signed JWT from `/api/auth/token` using the current
 *   session cookie (no login flow, no redirect).
 * - Compares with what's already on disk via Tauri `load_token`.
 * - Writes to disk via Tauri `save_token` only when out of sync.
 * - Per-user memoization avoids re-issuing a token when the session user
 *   hasn't changed.
 *
 * Mounted once at the root layout (alongside `ScheduledJobsInit`).
 */
export function TokenSync() {
  const { data: session, status } = useSession();
  const lastUserId = useRef<string | null>(null);

  useEffect(() => {
    if (!isTauriMode()) return;
    if (status !== "authenticated" || !session?.user?.id) return;

    const userId = session.user.id;
    if (lastUserId.current === userId) return; // same user, skip

    (async () => {
      try {
        const res = await fetch("/api/auth/token", {
          credentials: "include",
        });
        if (!res.ok) return;
        const data = (await res.json()) as { token?: string };
        const token = data?.token;
        if (!token) return;

        const existing = await invoke<string | null>("load_token");
        if (existing === token) {
          lastUserId.current = userId;
          return; // already in sync
        }

        await invoke("save_token", { token });
        lastUserId.current = userId;
        console.log("[TokenSync] token synced to ~/.openloomi/token");
      } catch (err) {
        console.warn("[TokenSync] failed:", err);
      }
    })();
  }, [status, session?.user?.id]);

  return null;
}
