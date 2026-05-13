"use client";

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
} from "@openloomi/ui";
import { Spinner } from "@/components/spinner";
import { toast } from "@/components/toast";
import {
  invalidateDiskUsage,
  invalidateSessions,
  useDiskUsage,
  useSessions,
} from "@/hooks/use-disk-usage";

/**
 * Format byte count as human-readable string.
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const idx = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${Number.parseFloat((bytes / 1024 ** idx).toFixed(1))} ${units[idx]}`;
}

/**
 * Map storage categories to localized labels.
 */
function useStorageCategoryLabel() {
  const { t } = useTranslation();
  return useMemo(
    () => (key: string) => {
      const labels: Record<string, string> = {
        sessions: t("workspace.storageCategory.sessions", "Sessions"),
        logs: t("workspace.storageCategory.logs", "Logs"),
        cache: t("workspace.storageCategory.cache", "Cache"),
        storage: t("workspace.storageCategory.storage", "Storage"),
        database: t("workspace.storageCategory.database", "Database"),
        skills: t("workspace.storageCategory.skills", "Skills"),
        "agent-browser": t(
          "workspace.storageCategory.agent-browser",
          "Agent browser",
        ),
      };
      return labels[key] ?? key;
    },
    [t],
  );
}

/**
 * Return visual color style for storage category.
 */
function getStorageCategoryColorClass(key: string): string {
  const colorMap: Record<string, string> = {
    sessions: "bg-red-400",
    logs: "bg-orange-400",
    cache: "bg-amber-400",
    storage: "bg-zinc-500",
    database: "bg-zinc-400",
    skills: "bg-zinc-300",
    "agent-browser": "bg-zinc-300",
  };
  return colorMap[key] ?? "bg-zinc-300";
}

/**
 * Calculate category percentage of total usage, with minimum visible width preserved.
 */
function getCategoryPercent(sizeBytes: number, totalBytes: number): number {
  if (totalBytes <= 0) return 0;
  const raw = (sizeBytes / totalBytes) * 100;
  return Math.max(raw, 1.2);
}

interface StorageManagementPanelProps {
  onRefresh?: () => void;
}

/**
 * Storage management panel: displays disk usage and provides cleanup entry.
 */
export function StorageManagementPanel({
  onRefresh,
}: StorageManagementPanelProps) {
  const { t } = useTranslation();
  const getLabel = useStorageCategoryLabel();
  const { data: overview, refresh: refreshOverview } = useDiskUsage();
  const { data: sessions } = useSessions();
  const [confirmClean, setConfirmClean] = useState<string | null>(null);
  const [cleaning, setCleaning] = useState(false);
  const totalBytes = overview?.totalBytes ?? 0;
  const overviewCategories = (overview?.categories ?? []).filter(
    (item) => item.key !== "agent-browser",
  );
  const sessionsCategory = overviewCategories.find(
    (item) => item.key === "sessions",
  );

  /**
   * Clean up storage data for specified category.
   */
  const handleCleanCategory = async (category: string) => {
    setCleaning(true);
    try {
      const response = await fetch("/api/storage/cleanup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category }),
      });
      if (!response.ok) {
        throw new Error("Cleanup failed");
      }
      await refreshOverview();
      invalidateSessions();
      onRefresh?.();
      toast({
        type: "success",
        description: t("workspace.storageDeleted", "Deleted successfully"),
      });
    } catch {
      toast({
        type: "error",
        description: t("workspace.storageCleanupFailed", "Cleanup failed"),
      });
    } finally {
      setCleaning(false);
      setConfirmClean(null);
    }
  };

  /**
   * Delete all session data and refresh usage statistics.
   */
  const handleDeleteAllSessions = async () => {
    setCleaning(true);
    try {
      const response = await fetch("/api/storage/sessions", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deleteAll: true }),
      });
      if (!response.ok) {
        throw new Error("Delete failed");
      }
      invalidateSessions();
      invalidateDiskUsage();
      onRefresh?.();
      toast({
        type: "success",
        description: t("workspace.storageDeleted", "Deleted successfully"),
      });
    } catch {
      toast({
        type: "error",
        description: t("workspace.storageCleanupFailed", "Cleanup failed"),
      });
    } finally {
      setCleaning(false);
      setConfirmClean(null);
    }
  };

  return (
    <>
      <div className="w-full max-w-none space-y-3">
        <div className="mb-4 w-full rounded-xl border border-border bg-muted/30 px-4 py-4 sm:px-5">
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <span className="text-base font-semibold text-foreground">
                  {t("settings.storageBreakdownTitle", "Storage Breakdown")}
                </span>
              </div>
              <span className="text-[14px] font-normal text-muted-foreground">
                {overview ? formatBytes(totalBytes) : "..."}
              </span>
            </div>

            <div className="h-4 w-full overflow-hidden rounded-md bg-zinc-200">
              {overview && totalBytes > 0 ? (
                <div className="flex h-full w-full">
                  {overviewCategories
                    .filter((item) => item.sizeBytes > 0)
                    .map((item) => (
                      <div
                        key={`bar-${item.key}`}
                        className={getStorageCategoryColorClass(item.key)}
                        style={{
                          width: `${getCategoryPercent(item.sizeBytes, totalBytes)}%`,
                        }}
                      />
                    ))}
                </div>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              {overviewCategories
                .filter((item) => item.sizeBytes > 0)
                .map((item) => (
                  <div
                    key={`legend-${item.key}`}
                    className="inline-flex items-center gap-1.5 text-sm text-muted-foreground"
                  >
                    <span
                      className={`inline-block size-2.5 rounded-full ${getStorageCategoryColorClass(item.key)}`}
                    />
                    <span>{getLabel(item.key)}</span>
                  </div>
                ))}
            </div>
          </div>
        </div>

        <div className="w-full px-1 sm:px-0">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
            <div className="min-w-0 space-y-1">
              <span className="block text-sm font-medium text-foreground">
                {t("workspace.storageCategory.sessions", "Sessions")}
              </span>
              <span className="block text-sm text-muted-foreground">
                {`${formatBytes(sessionsCategory?.sizeBytes ?? 0)} (${sessions.length})`}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0 self-start sm:self-center"
                onClick={() => setConfirmClean("browser-temp")}
                disabled={cleaning}
              >
                {t("workspace.storageCleanBrowserTemp", "Clear cache")}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0 self-start sm:self-center text-destructive border-destructive/40 hover:bg-destructive/10"
                onClick={() => setConfirmClean("sessions")}
                disabled={cleaning}
              >
                {t("workspace.storageDeleteAllSessions", "Delete all sessions")}
              </Button>
            </div>
          </div>
        </div>

        {overviewCategories
          .filter((item) => item.key !== "sessions")
          .map((item) => (
            <div key={item.key} className="w-full px-1 sm:px-0">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
                <div className="min-w-0 space-y-1">
                  <span className="block text-sm font-medium text-foreground">
                    {getLabel(item.key)}
                  </span>
                  <span className="block text-sm text-muted-foreground">
                    {formatBytes(item.sizeBytes)}
                  </span>
                </div>
                {["sessions", "logs", "cache"].includes(item.key) && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="shrink-0 self-start sm:self-center"
                    onClick={() => setConfirmClean(item.key)}
                    disabled={cleaning}
                  >
                    {t("workspace.storageCleanup", "Cleanup")}
                  </Button>
                )}
              </div>
            </div>
          ))}
      </div>

      <AlertDialog
        open={confirmClean !== null}
        onOpenChange={(open) => !open && setConfirmClean(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("workspace.storageCleanup", "Cleanup")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmClean === "sessions"
                ? t(
                    "workspace.storageConfirmDeleteAll",
                    "Are you sure you want to delete all sessions? This action cannot be undone.",
                  )
                : confirmClean === "browser-temp"
                  ? t(
                      "workspace.storageConfirmBrowserTemp",
                      "Are you sure you want to clear browser temp files from all sessions? This action cannot be undone.",
                    )
                  : t(
                      "workspace.storageConfirmClean",
                      "Are you sure you want to cleanup? This action cannot be undone.",
                    )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {t("common.cancel", "Cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (confirmClean === "sessions") {
                  handleDeleteAllSessions();
                  return;
                }
                if (confirmClean) {
                  handleCleanCategory(confirmClean);
                }
              }}
              disabled={cleaning}
            >
              {cleaning ? (
                <Spinner size={16} />
              ) : (
                t("workspace.storageCleanup", "Cleanup")
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
