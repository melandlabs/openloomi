"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { isTauri } from "@/lib/tauri";
import type { PermissionWithStatus } from "@/lib/permissions/registry";
import {
  getPermissions,
  invalidatePermissionCache,
  openSystemSettings,
  type SettingsPane,
} from "@/lib/permissions/service";

const FOCUS_DEBOUNCE_MS = 3000;

export function usePermissions() {
  const [permissions, setPermissions] = useState<PermissionWithStatus[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const lastFocusRefresh = useRef(0);

  const refresh = useCallback(async () => {
    if (!isTauri()) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      invalidatePermissionCache();
      const result = await getPermissions(true);
      setPermissions(result);
    } catch (error) {
      console.error("Failed to refresh permissions:", error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isTauri()) {
      setIsLoading(false);
      return;
    }

    getPermissions()
      .then(setPermissions)
      .catch(console.error)
      .finally(() => setIsLoading(false));

    const handleFocus = () => {
      const now = Date.now();
      if (now - lastFocusRefresh.current < FOCUS_DEBOUNCE_MS) return;
      lastFocusRefresh.current = now;
      getPermissions(true).then(setPermissions).catch(console.error);
    };
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, []);

  const openSettings = useCallback(async (pane: SettingsPane) => {
    await openSystemSettings(pane);
  }, []);

  const grantedCount = permissions.filter((p) => p.status === "granted").length;
  const totalCount = permissions.length;

  return {
    permissions,
    isLoading,
    isTauriEnv: isTauri(),
    grantedCount,
    totalCount,
    refresh,
    openSettings,
  };
}
