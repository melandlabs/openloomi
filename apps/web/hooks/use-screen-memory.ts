"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import useSWR from "swr";
import { toast } from "@/components/toast";
import { fetcher } from "@/lib/utils";
import { chronicleAnalysisQueue } from "@/lib/chronicle/analysis-queue";
import { DEFAULT_CHRONICLE_CAPTURE_SHORTCUT } from "@/lib/chronicle/chronicle-capture-shortcut-keys";
import {
  areChroniclePermissionsGranted,
  isAccessibilityGranted,
  persistChronicleBootCheck,
  persistChronicleDisabled,
  persistChronicleEnabled,
} from "@/lib/permissions/service";
import { isTauri } from "@/lib/tauri";
import { v4 as uuidv4 } from "uuid";

const DEFAULT_DEBOUNCE_INTERVAL_MS = 5000;
const MIN_DEBOUNCE_INTERVAL_MS = 3000;

// Module-level "current" interval shared by all triggers / module-level
// dedupe checks. The settings panel writes it via setChronicleDebounceInterval
// as soon as the user saves a new value, so concurrent triggers all observe
// the latest threshold without needing to wait for SWR revalidation to ripple
// through every consumer of useChroniclePreferences.
let __chronicleDebounceIntervalMs = DEFAULT_DEBOUNCE_INTERVAL_MS;

function clampDebounceInterval(ms: number | undefined | null): number {
  if (ms == null || !Number.isFinite(ms)) return DEFAULT_DEBOUNCE_INTERVAL_MS;
  return Math.max(MIN_DEBOUNCE_INTERVAL_MS, Math.floor(ms));
}

export function setChronicleDebounceInterval(ms: number) {
  __chronicleDebounceIntervalMs = clampDebounceInterval(ms);
}

// Module-level dedupe state. Survives React re-renders, StrictMode double-
// invocation, and multiple hook instances. Without it, a single shortcut press
// can fan out to N requests if the global Tauri event listener gets
// re-registered (the async `listen()` race below would leak stale
// subscriptions), since every listener calls capture() within the same tick
// and React-state debounce reads `lastCaptureTime=0` for all of them.
let __chronicleCaptureBusy = false;
let __chronicleLastTriggerMs = 0;

// Strictly serialize native shortcut register/unregister IPC. When the user
// toggles the setting from off → on, React tears down the old effect (which
// queues an async `unregister_screen_capture_shortcut`) and then runs the new
// effect (which queues `unregister` + `register`). Both chains are async and
// can interleave — without this queue the cleanup's unregister can land
// AFTER the new register and tear down the listener thread we just spawned,
// so the UI says "enabled" but the shortcut does nothing. With the queue, cleanup
// always finishes its unregister before setup's register is allowed to start.
let __shortcutOpChain: Promise<unknown> = Promise.resolve();

/** Ensures boot-time Chronicle retry runs at most once per page load. */
let __chronicleBootCheckInFlight = false;
function enqueueShortcutOp<T>(op: () => Promise<T>): Promise<T> {
  const next = __shortcutOpChain.then(op, op);
  __shortcutOpChain = next.catch(() => undefined);
  return next as Promise<T>;
}

// 1080p JPEG is plenty readable for code / chats / UI labels while cutting
// the upload payload (and therefore upstream LLM latency) ~5-8x vs the raw
// retina-DPI PNG from the OS capture.
const OCR_MAX_DIMENSION = 1920;
const OCR_JPEG_QUALITY = 0.85;

function isTauriRuntime(): boolean {
  return (
    typeof window !== "undefined" &&
    !!(window as unknown as { __TAURI__?: unknown }).__TAURI__
  );
}

async function compressScreenshotForOcr(input: Blob): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(input);
    const { width, height } = bitmap;
    const longest = Math.max(width, height);
    const scale = longest > OCR_MAX_DIMENSION ? OCR_MAX_DIMENSION / longest : 1;
    const targetW = Math.max(1, Math.round(width * scale));
    const targetH = Math.max(1, Math.round(height * scale));

    const canvas =
      typeof OffscreenCanvas !== "undefined"
        ? new OffscreenCanvas(targetW, targetH)
        : Object.assign(document.createElement("canvas"), {
            width: targetW,
            height: targetH,
          });

    const ctx = (canvas as HTMLCanvasElement | OffscreenCanvas).getContext(
      "2d",
    ) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!ctx) {
      bitmap.close?.();
      return input;
    }
    ctx.drawImage(bitmap, 0, 0, targetW, targetH);
    bitmap.close?.();

    let out: Blob | null = null;
    if (canvas instanceof OffscreenCanvas) {
      out = await canvas.convertToBlob({
        type: "image/jpeg",
        quality: OCR_JPEG_QUALITY,
      });
    } else {
      out = await new Promise<Blob | null>((resolve) =>
        (canvas as HTMLCanvasElement).toBlob(
          resolve,
          "image/jpeg",
          OCR_JPEG_QUALITY,
        ),
      );
    }

    if (!out || out.size === 0) return input;
    if (out.size > input.size) return input;
    return out;
  } catch (err) {
    console.warn("[ScreenMemory] OCR compression failed, sending raw:", err);
    return input;
  }
}

interface VisionLlmConfig {
  enabled: boolean;
  apiUrl: string;
  apiKey: string;
  model: string;
}

interface ChroniclePreferencesResponse {
  chronicleEnabled: boolean;
  chronicleBootCheck?: boolean;
  chronicleCaptureShortcut?: string;
  chronicleCaptureIntervalMs?: number;
  visionLlm?: VisionLlmConfig;
  meetingRecordingEnabled?: boolean;
  meetingAutoDetectionEnabled?: boolean;
  [key: string]: unknown;
}

export const DEFAULT_VISION_LLM: VisionLlmConfig = {
  enabled: false,
  apiUrl: "",
  apiKey: "",
  model: "",
};

/**
 * Hook to get chronicle (screen-aware memory) enabled status
 */
export function useChroniclePreferences() {
  const { t } = useTranslation();
  const { data, isLoading, mutate } = useSWR<ChroniclePreferencesResponse>(
    "/api/preferences/insight",
    fetcher,
    {
      keepPreviousData: true,
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      dedupingInterval: 10000,
    },
  );

  const [isReconcilingPermissions, setIsReconcilingPermissions] =
    useState(false);
  const reconcileInFlightRef = useRef(false);

  const intervalMs = clampDebounceInterval(data?.chronicleCaptureIntervalMs);

  // Sync module-level threshold whenever the server truth changes.
  useEffect(() => {
    __chronicleDebounceIntervalMs = intervalMs;
  }, [intervalMs]);

  // If Chronicle is on in the DB but macOS permissions were revoked, turn it
  // off so startup never registers global shortcuts and settings stay usable.
  useEffect(() => {
    if (!isTauri() || isLoading || !data?.chronicleEnabled) {
      return;
    }

    const reconcile = async () => {
      if (reconcileInFlightRef.current) return;
      const permissionsOk = await areChroniclePermissionsGranted(true);
      if (permissionsOk) return;

      reconcileInFlightRef.current = true;
      setIsReconcilingPermissions(true);
      try {
        await mutate(
          (prev) => (prev ? { ...prev, chronicleEnabled: false } : prev),
          { revalidate: false },
        );
        const saved = await persistChronicleDisabled();
        if (saved) {
          await mutate();
          console.warn(
            "[Chronicle] Disabled automatically: required macOS permissions are missing",
          );
        } else {
          await mutate();
        }
      } finally {
        reconcileInFlightRef.current = false;
        setIsReconcilingPermissions(false);
      }
    };

    void reconcile();

    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void reconcile();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [isLoading, data?.chronicleEnabled, mutate]);

  // One-shot boot retry: user toggled Chronicle on but lacked permissions;
  // on next app start, auto-enable when both permissions are now granted.
  useEffect(() => {
    if (!isTauri() || isLoading || !data?.chronicleBootCheck) {
      return;
    }
    if (__chronicleBootCheckInFlight) {
      return;
    }
    __chronicleBootCheckInFlight = true;

    const runBootCheck = async () => {
      const wasEnabled = data.chronicleEnabled ?? false;

      await mutate(
        (prev) => (prev ? { ...prev, chronicleBootCheck: false } : prev),
        { revalidate: false },
      );

      const cleared = await persistChronicleBootCheck(false);
      if (!cleared) {
        await mutate();
        return;
      }

      const permissionsOk = await areChroniclePermissionsGranted(true);
      if (permissionsOk && !wasEnabled) {
        const enabled = await persistChronicleEnabled(true);
        if (enabled) {
          await mutate();
          toast({
            type: "success",
            description: t("chronicle.settings.bootCheckEnabled"),
          });
          return;
        }
      }

      await mutate();
    };

    void runBootCheck();
  }, [isLoading, data?.chronicleBootCheck, data?.chronicleEnabled, mutate, t]);

  return {
    chronicleEnabled: data?.chronicleEnabled ?? false,
    chronicleCaptureShortcut:
      data?.chronicleCaptureShortcut?.trim() ||
      DEFAULT_CHRONICLE_CAPTURE_SHORTCUT,
    chronicleCaptureIntervalMs: intervalMs,
    visionLlm: data?.visionLlm ?? DEFAULT_VISION_LLM,
    meetingRecordingEnabled: data?.meetingRecordingEnabled ?? false,
    meetingAutoDetectionEnabled: data?.meetingAutoDetectionEnabled ?? false,
    isLoading: isLoading || isReconcilingPermissions,
    mutate,
  };
}

/**
 * Callback type for when screen memory is captured and analyzed
 */
export type OnScreenMemoryCaptured = (memory: {
  screenshotPath: string;
  description: string;
  keyContent: string[];
  extractedText: string;
  timestamp: Date;
}) => void;

interface ScreenCaptureShortcutEvent {
  shortcut: string;
  state: string;
}

/**
 * Hook to handle screen-aware memory capture
 *
 * Features:
 * - Listens for a configurable global shortcut (default Enter)
 * - Captures screen screenshot
 * - Sends to LLM for analysis
 * - Saves memory locally
 * - Records to Insights
 * - Debounce protection (configurable, default 5s, min 3s)
 */
export function useScreenMemoryCapture(options?: {
  onCaptured?: OnScreenMemoryCaptured;
  enabled?: boolean;
}) {
  const { onCaptured, enabled = true } = options ?? {};
  const {
    chronicleEnabled,
    chronicleCaptureShortcut,
    chronicleCaptureIntervalMs,
    isLoading: isLoadingPrefs,
  } = useChroniclePreferences();

  const [isCapturing, setIsCapturing] = useState(false);
  const [lastCaptureTime, setLastCaptureTime] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);

  const isEnabled = enabled && chronicleEnabled && !isLoadingPrefs;

  // Stable ref for the onCaptured callback. The queue processes jobs
  // asynchronously and may complete after the component has re-rendered with
  // a new onCaptured identity. Using a ref ensures the completion handler
  // always calls the latest version.
  const onCapturedRef = useRef(onCaptured);
  onCapturedRef.current = onCaptured;

  // Mirror isEnabled into a ref *synchronously during render* (legal: ref
  // mutation during render is fine when idempotent). Doing this in a
  // useEffect would lag one tick behind state, so a Tauri event fired right
  // after the user flips the toggle could still see the stale `true` and
  // start a capture. Reading the ref in the listener callback below is the
  // last line of defense against "I turned it off but the shortcut still fires".
  const isEnabledRef = useRef(isEnabled);
  isEnabledRef.current = isEnabled;

  /**
   * Whether enough time has passed since the last capture. Reads the
   * module-level timestamp so concurrent triggers cannot all observe a
   * stale React state.
   */
  const canCapture = useCallback(() => {
    return (
      Date.now() - __chronicleLastTriggerMs >= __chronicleDebounceIntervalMs
    );
  }, []);

  const captureViaTauri = async (): Promise<Blob | null> => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const screenshotData = await invoke<number[]>("capture_screen");
      if (!screenshotData || screenshotData.length === 0) return null;
      return new Blob([new Uint8Array(screenshotData)], { type: "image/png" });
    } catch (err) {
      console.error("[ScreenMemory] Tauri capture failed:", err);
      return null;
    }
  };

  const captureViaBrowser = async (): Promise<Blob | null> => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: "screen" } as MediaTrackConstraints,
      });

      const video = document.createElement("video");
      video.srcObject = stream;
      await video.play();

      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        stream.getTracks().forEach((track) => track.stop());
        return null;
      }
      ctx.drawImage(video, 0, 0);
      stream.getTracks().forEach((track) => track.stop());

      return await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/png"),
      );
    } catch (err) {
      console.error("[ScreenMemory] Browser capture failed:", err);
      return null;
    }
  };

  /**
   * Capture screen and save memory
   */
  const captureScreenMemory = useCallback(async () => {
    // Belt-and-suspenders: the listener already gates on isEnabledRef, but
    // captureScreenMemory is also exposed as `capture` for manual use, and
    // events queued before disable can still reach us late.
    if (!isEnabledRef.current) {
      console.log("[ScreenMemory] capture aborted: chronicle is disabled");
      return;
    }
    // Strict, synchronous module-level dedupe. Concurrent triggers all race
    // through this prefix; only the first wins, the rest return immediately.
    const now = Date.now();
    if (__chronicleCaptureBusy) {
      console.log("[ScreenMemory] capture in flight, dropping duplicate");
      return;
    }
    if (now - __chronicleLastTriggerMs < __chronicleDebounceIntervalMs) {
      console.log(
        `[ScreenMemory] debounced (${now - __chronicleLastTriggerMs}ms < ${__chronicleDebounceIntervalMs}ms)`,
      );
      return;
    }
    __chronicleCaptureBusy = true;
    __chronicleLastTriggerMs = now;

    setIsCapturing(true);
    setError(null);
    const captureStartTime = now;

    try {
      const isTauri = isTauriRuntime();
      let screenshotBlob: Blob | null = isTauri
        ? await captureViaTauri()
        : null;
      if (isTauri && !screenshotBlob) {
        throw new Error(
          "Failed to capture screenshot via native Tauri command",
        );
      }
      if (!screenshotBlob) {
        screenshotBlob = await captureViaBrowser();
      }
      if (!screenshotBlob) {
        throw new Error("Failed to capture screenshot");
      }

      // Down-sample for OCR. The raw retina-DPI PNG is often > 1 MiB; the
      // model only needs ~1080p JPEG for accurate text reading, and a
      // smaller payload sidesteps OpenRouter's 30 s non-stream timeout on
      // huge vision bodies.
      const originalSize = screenshotBlob.size;
      const compressed = await compressScreenshotForOcr(screenshotBlob);
      if (compressed !== screenshotBlob) {
        console.log(
          `[ScreenMemory] Compressed ${originalSize} -> ${compressed.size} bytes`,
        );
        screenshotBlob = compressed;
      }
      const screenshotExt =
        screenshotBlob.type === "image/jpeg" ? "jpg" : "png";

      const screenshotFormData = new FormData();
      screenshotFormData.append(
        "file",
        screenshotBlob,
        `screen_${Date.now()}.${screenshotExt}`,
      );
      const uploadResponse = await fetch("/api/chronicle/screenshot", {
        method: "POST",
        body: screenshotFormData,
      });
      if (!uploadResponse.ok) {
        throw new Error(
          `Upload failed: ${uploadResponse.status} ${await uploadResponse.text()}`,
        );
      }
      const { path: screenshotPath } = (await uploadResponse.json()) as {
        path: string;
      };

      // Tauri mode: AI proxy needs the real cloud auth token. It only exists
      // on the client, so we forward it explicitly; otherwise the server
      // falls back to the placeholder-token path and hits `MissingSecret`
      // from next-auth `getToken()`.
      const { getAuthToken } = await import("@/lib/auth/token-manager");
      const cloudAuthToken = getAuthToken() || undefined;

      // Enqueue analysis to the background queue. This returns immediately —
      // the queue will call /api/chronicle/analyze then /api/chronicle/memories
      // asynchronously, one job at a time. The capture flow is no longer
      // blocked by LLM latency.
      const jobId = uuidv4();
      chronicleAnalysisQueue.enqueue(
        {
          id: jobId,
          screenshotPath,
          cloudAuthToken,
        },
        (result) => {
          // Fire the completion callback on the latest handler. Using the ref
          // ensures we don't call a stale closure even if the component
          // re-rendered between enqueue and completion.
          setLastCaptureTime(Date.now());
          onCapturedRef.current?.({
            screenshotPath: result.screenshotPath,
            description: result.description,
            keyContent: result.keyContent,
            extractedText: result.extractedText,
            timestamp: result.timestamp,
          });
        },
      );

      setLastCaptureTime(Date.now());

      console.log(
        `[ScreenMemory] capture uploaded in ${Date.now() - captureStartTime}ms (queue pending=${chronicleAnalysisQueue.pending})`,
      );
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      console.error("[ScreenMemory] capture failed:", errorMessage);
      setError(errorMessage);
    } finally {
      __chronicleCaptureBusy = false;
      setIsCapturing(false);
    }
  }, []);

  // captureRef lets the long-lived listener (registered once at mount) always
  // call the freshest captureScreenMemory closure even though we never
  // re-register the listener on captureScreenMemory identity changes.
  const captureRef = useRef(captureScreenMemory);
  useEffect(() => {
    captureRef.current = captureScreenMemory;
  }, [captureScreenMemory]);

  /**
   * Effect 1 — listener subscription. Lives for the whole component
   * lifetime so we never tear it down on isEnabled flips. The callback gates
   * itself on `isEnabledRef.current`, which is updated synchronously in
   * render. Decoupling subscription lifetime from isEnabled is what kills
   * the cleanup/setup race: there is simply no cleanup to mis-order with
   * the next register call.
   */
  useEffect(() => {
    if (!isTauriRuntime()) return;

    let cancelled = false;
    let unlistenEvent: (() => void) | null = null;

    void (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        if (cancelled) return;

        const off = await listen<ScreenCaptureShortcutEvent>(
          "screen-capture-shortcut",
          (event) => {
            if (event.payload?.state !== "Pressed") return;
            // Strict gate: if Chronicle was just disabled, the ref has
            // already been updated synchronously during the render that
            // followed the SWR mutate, so we'll see `false` here even if
            // the Rust thread hasn't yet observed its unregister.
            if (!isEnabledRef.current) return;
            void captureRef.current();
          },
        );

        if (cancelled) {
          off();
          return;
        }
        unlistenEvent = off;
      } catch (err) {
        console.error("[ScreenMemory] listen() failed:", err);
      }
    })();

    return () => {
      cancelled = true;
      if (unlistenEvent) {
        unlistenEvent();
        unlistenEvent = null;
      }
    };
  }, []);

  /** Sync Rust global shortcut with Chronicle enabled state and macOS a11y. */
  const syncChronicleGlobalShortcut = useCallback(async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("unregister_screen_capture_shortcut").catch((err) => {
      console.error("[ScreenMemory] unregister failed:", err);
    });
    if (!isEnabledRef.current) return;
    if (!(await isAccessibilityGranted(true))) {
      console.warn(
        "[ScreenMemory] Skipping shortcut register: accessibility not granted",
      );
      return;
    }
    await invoke("register_screen_capture_shortcut", {
      shortcut: chronicleCaptureShortcut,
    }).catch((err) => {
      console.error("[ScreenMemory] register failed:", err);
    });
  }, [chronicleCaptureShortcut]);

  /**
   * Effect 2 — native global shortcut lifecycle. Toggles the Rust
   * `device_query` thread on/off in lockstep with `isEnabled`. All
   * register/unregister IPC goes through `enqueueShortcutOp` so a setup
   * triggered by isEnabled=true can never overtake the cleanup-unregister
   * from the previous isEnabled=false→true→false sequence.
   *
   * Importantly this effect no longer owns the listener subscription, so
   * there's nothing to tear down except the Rust shortcut itself. That
   * eliminates the previous failure mode where a fast off→on→off would
   * leave the listener registered while the Rust thread happened to be
   * down (or vice versa).
   */
  useEffect(() => {
    if (!isTauriRuntime()) return;

    let cancelled = false;

    void enqueueShortcutOp(async () => {
      if (cancelled) return;
      await syncChronicleGlobalShortcut();
    });

    return () => {
      cancelled = true;
      void enqueueShortcutOp(async () => {
        const { invoke } = await import("@tauri-apps/api/core");
        // On disable (or unmount), force the thread down regardless of
        // what isEnabledRef now says — the cleanup represents the user's
        // most recent intent at the moment this effect was torn down.
        await invoke("unregister_screen_capture_shortcut").catch((err) => {
          console.error("[ScreenMemory] cleanup unregister failed:", err);
        });
      });
    };
  }, [isEnabled, syncChronicleGlobalShortcut]);

  /** Re-attempt shortcut registration after the user grants accessibility. */
  useEffect(() => {
    if (!isTauriRuntime() || !isEnabled) return;

    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      void enqueueShortcutOp(() => syncChronicleGlobalShortcut());
    };

    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [isEnabled, syncChronicleGlobalShortcut]);

  return {
    isEnabled,
    isLoading: isLoadingPrefs,
    isCapturing,
    lastCaptureTime,
    error,
    capture: captureScreenMemory,
    canCapture: canCapture(),
    debounceRemaining: Math.max(
      0,
      __chronicleDebounceIntervalMs - (Date.now() - lastCaptureTime),
    ),
  };
}

/**
 * Hook to query screen memory for conversation context
 */
export function useScreenMemory(options?: { query?: string; limit?: number }) {
  const { query, limit = 10 } = options ?? {};

  const apiUrl = query
    ? `/api/chronicle/memories?query=${encodeURIComponent(query)}&limit=${limit}`
    : `/api/chronicle/memories?limit=${limit}`;

  const { data, isLoading, error } = useSWR(apiUrl, fetcher, {
    keepPreviousData: true,
    revalidateOnFocus: false,
    dedupingInterval: 30000,
  });

  return {
    memories: data?.memories ?? [],
    isLoading,
    error,
  };
}
