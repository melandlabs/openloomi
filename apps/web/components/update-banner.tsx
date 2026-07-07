"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Progress } from "@openloomi/ui";
import { RemixIcon } from "@/components/remix-icon";
import { isTauri } from "@/lib/tauri";
import {
  checkForUpdate,
  finishUpdateDownload,
  pollUpdateDownloadProgress,
  restartForUpdate,
  startUpdateDownload,
  type DownloadProgress,
  type UpdateCheckResult,
  type UpdateInstallResult,
} from "@/lib/tauri";

type Phase =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "ready"
  | "installing"
  | "error"
  | "dismissed";

const DISMISS_KEY_PREFIX = "openloomi.update.dismissed.";

/**
 * Auto-update banner for the Tauri desktop app.
 *
 * Renders nothing on the web (non-Tauri). In Tauri it:
 *  1. Waits 5s after mount, then calls `checkForUpdate()`.
 *  2. If a new version is available, shows a bottom banner.
 *  3. On "Update now": calls `startUpdateDownload`, polls progress every 1s.
 *  4. When download is `done`, swaps the banner copy to "Install & restart" and
 *     triggers the installer + relaunch on confirm.
 */
export function UpdateBanner() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<UpdateCheckResult | null>(null);
  const [progress, setProgress] = useState<DownloadProgress>({
    downloaded: 0,
    total: 0,
    percent: 0,
    done: false,
    error: null,
  });
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [backupBeforeInstall, setBackupBeforeInstall] = useState(false);
  const [installResult, setInstallResult] =
    useState<UpdateInstallResult | null>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

  // Initial check, 5s after mount (Tauri only).
  useEffect(() => {
    if (!isTauri()) return;
    const timer = setTimeout(async () => {
      setPhase("checking");
      try {
        const r = await checkForUpdate();
        if (!r || !r.has_update) {
          setPhase("idle");
          return;
        }
        if (typeof window !== "undefined") {
          const dismissed = window.localStorage.getItem(
            `${DISMISS_KEY_PREFIX}${r.latest_version}`,
          );
          if (dismissed) {
            setPhase("dismissed");
            return;
          }
        }
        setResult(r);
        setPhase("available");
      } catch (err) {
        console.warn("[UpdateBanner] check failed:", err);
        setPhase("idle");
      }
    }, 5_000);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => () => stopPolling(), [stopPolling]);

  const handleStartDownload = useCallback(async () => {
    if (!result) return;
    setErrorMessage(null);
    setInstallResult(null);
    setProgress({
      downloaded: 0,
      total: 0,
      percent: 0,
      done: false,
      error: null,
    });
    setPhase("downloading");
    try {
      await startUpdateDownload(result.download_url, result.file_size);
    } catch (err) {
      setErrorMessage(String(err));
      setPhase("error");
      return;
    }
    stopPolling();
    pollTimer.current = setInterval(async () => {
      try {
        const p = await pollUpdateDownloadProgress();
        setProgress(p);
        if (p.done) {
          stopPolling();
          if (p.error) {
            setErrorMessage(p.error);
            setPhase("error");
          } else {
            setPhase("ready");
          }
        }
      } catch (err) {
        stopPolling();
        setErrorMessage(String(err));
        setPhase("error");
      }
    }, 1_000);
  }, [result, stopPolling]);

  const handleInstall = useCallback(async () => {
    if (!result) return;
    setPhase("installing");
    setErrorMessage(null);
    setInstallResult(null);
    try {
      const installResult = await finishUpdateDownload({
        backup: backupBeforeInstall,
      });
      setInstallResult(installResult);
      // restart_for_update exits the process on success.
      await restartForUpdate();
    } catch (err) {
      setErrorMessage(String(err));
      setPhase("error");
    }
  }, [backupBeforeInstall, result]);

  const handleDismiss = useCallback(() => {
    if (result && typeof window !== "undefined") {
      window.localStorage.setItem(
        `${DISMISS_KEY_PREFIX}${result.latest_version}`,
        "1",
      );
    }
    setPhase("dismissed");
  }, [result]);

  if (!isTauri()) return null;
  if (phase === "idle" || phase === "checking" || phase === "dismissed")
    return null;
  if (!result) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-0 inset-x-0 z-[55] border-t border-[#e5e5e5] bg-white shadow-lg dark:bg-[#191919] dark:border-[#2a2a2a]"
    >
      <div className="max-w-7xl mx-auto p-4 sm:px-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 flex-1">
            {phase === "available" && (
              <>
                <p className="text-sm font-semibold">
                  New version available: v{result.latest_version}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  You are on v{result.current_version}.
                  {result.release_url && (
                    <>
                      {" "}
                      <a
                        href={result.release_url}
                        target="_blank"
                        rel="noreferrer"
                        className="underline hover:no-underline"
                      >
                        Release notes
                      </a>
                    </>
                  )}
                </p>
              </>
            )}
            {(phase === "downloading" || phase === "ready") && (
              <>
                <p className="text-sm font-semibold">
                  {phase === "ready"
                    ? "Download complete — ready to install"
                    : `Downloading v${result.latest_version}…`}
                </p>
                <div className="mt-2 max-w-md">
                  <Progress value={progress.percent} />
                  <p className="mt-1 text-xs text-muted-foreground">
                    {progress.percent.toFixed(0)}%
                    {progress.total > 0 &&
                      ` · ${(progress.downloaded / 1024 / 1024).toFixed(1)} / ${(
                        progress.total /
                        1024 /
                        1024
                      ).toFixed(1)} MB`}
                  </p>
                </div>
              </>
            )}
            {phase === "installing" && (
              <>
                <p className="text-sm font-semibold">Installing update…</p>
                {installResult?.backup_created && installResult.backup_path && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Backup created at {installResult.backup_path}
                  </p>
                )}
              </>
            )}
            {phase === "error" && (
              <p className="text-sm font-semibold text-red-600">
                Update failed{errorMessage ? `: ${errorMessage}` : ""}
              </p>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {phase === "available" && (
              <>
                <Button variant="ghost" size="sm" onClick={handleDismiss}>
                  Later
                </Button>
                <Button size="sm" onClick={handleStartDownload}>
                  Download
                </Button>
              </>
            )}
            {phase === "ready" && (
              <>
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={backupBeforeInstall}
                    onChange={(event) =>
                      setBackupBeforeInstall(event.currentTarget.checked)
                    }
                    className="h-3.5 w-3.5"
                  />
                  Create backup before installing
                </label>
                <Button variant="ghost" size="sm" onClick={handleDismiss}>
                  Later
                </Button>
                <Button size="sm" onClick={handleInstall}>
                  Install and restart
                </Button>
              </>
            )}
            {phase === "downloading" && (
              <Button variant="ghost" size="sm" disabled>
                <RemixIcon
                  name="ri-loader-4-line"
                  className="mr-1 animate-spin"
                />
                Downloading
              </Button>
            )}
            {phase === "installing" && (
              <Button variant="ghost" size="sm" disabled>
                <RemixIcon
                  name="ri-loader-4-line"
                  className="mr-1 animate-spin"
                />
                Installing
              </Button>
            )}
            {phase === "error" && (
              <Button size="sm" onClick={handleStartDownload}>
                Retry
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
