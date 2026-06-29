"use client";

import {
  useState,
  useEffect,
  useCallback,
  useRef,
  type KeyboardEvent,
} from "react";
import { useTranslation } from "react-i18next";
import { toast } from "@/components/toast";
import { RemixIcon } from "@/components/remix-icon";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DEFAULT_VISION_LLM,
  setChronicleDebounceInterval,
  useChroniclePreferences,
} from "@/hooks/use-screen-memory";
import { Button } from "@/components/ui/button";
import {
  DEFAULT_CHRONICLE_CAPTURE_SHORTCUT,
  isValidChronicleCaptureShortcutKey,
} from "@/lib/chronicle/chronicle-capture-shortcut-keys";
import { keyboardCodeToChronicleShortcutId } from "@/lib/chronicle/keyboard-code-to-chronicle-shortcut";
import { FF_SCREEN_MEMORY } from "@/lib/env/client-constants";
import {
  isAccessibilityGranted,
  isScreenRecordingGranted,
  persistChronicleBootCheck,
} from "@/lib/permissions/service";
import { isTauri } from "@/lib/tauri";
import { ChroniclePermissionGuide } from "@/components/chronicle/chronicle-permission-guide";

interface ChronicleSettingsProps {
  /** Whether the component is visible */
  open?: boolean;
}

/**
 * Debounced auto-save for a single field inside the custom vision LLM block.
 * We keep a local optimistic value (so typing feels instant) and fire a PUT
 * `delayMs` after the last keystroke. `onSave` receives the new value and
 * returns a Promise; success/failure is surfaced via toast.
 */
function useDebouncedSave(
  value: string,
  onSave: (next: string) => Promise<void>,
  delayMs = 800,
) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<string>(value);
  const [localValue, setLocalValue] = useState(value);

  // Sync when parent value changes (e.g. after a server revalidation)
  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  const handleChange = useCallback(
    (next: string) => {
      setLocalValue(next);
      pendingRef.current = next;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        void onSave(pendingRef.current);
      }, delayMs);
    },
    [onSave, delayMs],
  );

  return { localValue, handleChange };
}

/**
 * Chronicle Screen-Aware Memory Settings Component
 * Provides toggle and configuration for the screen capture memory feature.
 *
 * Toggling propagates through the shared SWR cache used by
 * `useScreenMemoryCapture`, so the native global key listener starts/stops
 * immediately — no app restart required.
 */
export function ChronicleSettings({ open = true }: ChronicleSettingsProps) {
  const { t } = useTranslation();
  const {
    chronicleEnabled,
    chronicleCaptureShortcut,
    chronicleCaptureIntervalMs,
    visionLlm,
    isLoading,
    mutate: mutateChroniclePrefs,
  } = useChroniclePreferences();
  const [isSaving, setIsSaving] = useState(false);
  const [isSavingShortcut, setIsSavingShortcut] = useState(false);
  const [isSavingInterval, setIsSavingInterval] = useState(false);
  const [editingShortcut, setEditingShortcut] = useState(false);
  const [draftShortcut, setDraftShortcut] = useState("");
  const [captureError, setCaptureError] = useState<string | null>(null);
  const captureAreaRef = useRef<HTMLButtonElement>(null);
  /** User tried to enable but lacked screen-recording permission; complete on grant. */
  const pendingEnableRef = useRef(false);
  /** Show the permission guide dialog instead of jumping directly to system settings. */
  const [showPermissionGuide, setShowPermissionGuide] = useState(false);

  // Local optimistic value for the interval input (seconds). Mirrors the
  // server value but lets the user type freely before the debounced save fires.
  const [intervalSecondsDraft, setIntervalSecondsDraft] = useState<string>(
    String(Math.round(chronicleCaptureIntervalMs / 1000)),
  );
  // Re-sync local draft whenever the server value changes underneath us.
  useEffect(() => {
    setIntervalSecondsDraft(
      String(Math.round(chronicleCaptureIntervalMs / 1000)),
    );
  }, [chronicleCaptureIntervalMs]);

  useEffect(() => {
    if (!chronicleEnabled) setEditingShortcut(false);
  }, [chronicleEnabled]);

  useEffect(() => {
    if (!editingShortcut) return;
    const id = requestAnimationFrame(() => {
      captureAreaRef.current?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [editingShortcut]);

  // Trigger a revalidation when the panel becomes visible so we never paint
  // stale data after the user changed it elsewhere (e.g. on another window).
  useEffect(() => {
    if (open) void mutateChroniclePrefs();
  }, [open, mutateChroniclePrefs]);

  const saveMainToggle = useCallback(
    async (enabled: boolean) => {
      setIsSaving(true);
      await mutateChroniclePrefs(
        (prev) => ({ ...(prev ?? {}), chronicleEnabled: enabled }),
        { revalidate: false },
      );
      try {
        const response = await fetch("/api/preferences/insight", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chronicleEnabled: enabled }),
        });
        if (!response.ok) throw new Error("Failed to save settings");
        await mutateChroniclePrefs();
        void persistChronicleBootCheck(false);
        toast({
          type: "success",
          description: enabled
            ? t("chronicle.settings.enabled")
            : t("chronicle.settings.disabled"),
        });
      } catch (error) {
        console.error("[Chronicle Settings] Failed to save:", error);
        if (enabled) {
          void persistChronicleBootCheck(true);
        }
        toast({
          type: "error",
          description: t("chronicle.settings.saveError"),
        });
        await mutateChroniclePrefs();
      } finally {
        setIsSaving(false);
      }
    },
    [mutateChroniclePrefs, t],
  );

  // After the user grants screen recording in System Settings, finish enabling.
  useEffect(() => {
    if (!isTauri() || !open) return;

    const tryCompletePendingEnable = async () => {
      if (!pendingEnableRef.current || chronicleEnabled) return;
      const [screenOk, accessibilityOk] = await Promise.all([
        isScreenRecordingGranted(true),
        isAccessibilityGranted(true),
      ]);
      if (!screenOk || !accessibilityOk) return;
      pendingEnableRef.current = false;
      await saveMainToggle(true);
    };

    const handleFocus = () => {
      void tryCompletePendingEnable();
    };
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [open, chronicleEnabled, saveMainToggle]);

  const saveCaptureShortcut = useCallback(
    async (key: string): Promise<boolean> => {
      setIsSavingShortcut(true);
      await mutateChroniclePrefs(
        (prev) => {
          if (!prev) {
            return {
              chronicleEnabled: false,
              chronicleCaptureShortcut: key,
              visionLlm: DEFAULT_VISION_LLM,
            };
          }
          return { ...prev, chronicleCaptureShortcut: key };
        },
        { revalidate: false },
      );
      try {
        const response = await fetch("/api/preferences/insight", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chronicleCaptureShortcut: key }),
        });
        if (!response.ok) throw new Error("Failed to save shortcut");
        await mutateChroniclePrefs();
        return true;
      } catch (error) {
        console.error("[Chronicle Settings] Shortcut save failed:", error);
        toast({
          type: "error",
          description: t("chronicle.settings.saveError"),
        });
        await mutateChroniclePrefs();
        return false;
      } finally {
        setIsSavingShortcut(false);
      }
    },
    [mutateChroniclePrefs, t],
  );

  /**
   * Save the per-user capture debounce interval (seconds → ms). Always
   * clamps to ≥ 3000ms before sending to the server; we additionally update
   * the module-level threshold in use-screen-memory.ts immediately so
   * concurrent native triggers see the new value without waiting for SWR.
   */
  const saveCaptureInterval = useCallback(
    async (seconds: number): Promise<boolean> => {
      const ms = Math.max(3000, Math.floor(seconds * 1000));
      setIsSavingInterval(true);
      // Apply locally first so the gate in the capture hook flips immediately.
      setChronicleDebounceInterval(ms);
      await mutateChroniclePrefs(
        (prev) => ({
          ...(prev ?? {
            chronicleEnabled: false,
            chronicleCaptureShortcut: DEFAULT_CHRONICLE_CAPTURE_SHORTCUT,
            visionLlm: DEFAULT_VISION_LLM,
          }),
          chronicleCaptureIntervalMs: ms,
        }),
        { revalidate: false },
      );
      try {
        const response = await fetch("/api/preferences/insight", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chronicleCaptureIntervalMs: ms }),
        });
        if (!response.ok) throw new Error("Failed to save capture interval");
        await mutateChroniclePrefs();
        toast({
          type: "success",
          description: t("chronicle.settings.captureIntervalSaved"),
        });
        return true;
      } catch (error) {
        console.error(
          "[Chronicle Settings] Capture interval save failed:",
          error,
        );
        toast({
          type: "error",
          description: t("chronicle.settings.captureIntervalSaveError"),
        });
        await mutateChroniclePrefs();
        return false;
      } finally {
        setIsSavingInterval(false);
      }
    },
    [mutateChroniclePrefs, t],
  );

  const commitIntervalDraft = useCallback(() => {
    const parsed = Number.parseInt(intervalSecondsDraft, 10);
    const fallback = Math.round(chronicleCaptureIntervalMs / 1000);
    const clamped = Number.isFinite(parsed)
      ? Math.max(3, Math.min(3600, parsed))
      : fallback;
    if (clamped !== Math.round(chronicleCaptureIntervalMs / 1000)) {
      void saveCaptureInterval(clamped);
    }
    setIntervalSecondsDraft(String(clamped));
  }, [intervalSecondsDraft, chronicleCaptureIntervalMs, saveCaptureInterval]);

  const beginEditShortcut = useCallback(() => {
    setDraftShortcut("");
    setCaptureError(null);
    setEditingShortcut(true);
  }, []);

  const cancelEditShortcut = useCallback(() => {
    setEditingShortcut(false);
    setDraftShortcut("");
    setCaptureError(null);
  }, []);

  const handleCaptureKey = useCallback(
    (e: KeyboardEvent<HTMLButtonElement>) => {
      if (e.repeat) return;
      if (e.code === "Escape") {
        e.preventDefault();
        cancelEditShortcut();
        return;
      }
      const id = keyboardCodeToChronicleShortcutId(e.code);
      if (id) {
        e.preventDefault();
        setCaptureError(null);
        setDraftShortcut(id);
        return;
      }
      e.preventDefault();
      setCaptureError(t("chronicle.settings.shortcutUnsupportedKey"));
    },
    [cancelEditShortcut, t],
  );

  const commitEditShortcut = useCallback(async () => {
    const next = draftShortcut.trim();
    if (!next) {
      toast({
        type: "error",
        description: t("chronicle.settings.shortcutPickFirst"),
      });
      return;
    }
    if (!isValidChronicleCaptureShortcutKey(next)) {
      toast({
        type: "error",
        description: t("chronicle.settings.shortcutInvalid"),
      });
      return;
    }
    const ok = await saveCaptureShortcut(next);
    if (ok) {
      setEditingShortcut(false);
      setDraftShortcut("");
      setCaptureError(null);
    }
  }, [draftShortcut, saveCaptureShortcut, t]);

  const savedShortcutDisplay =
    chronicleCaptureShortcut ?? DEFAULT_CHRONICLE_CAPTURE_SHORTCUT;

  const handleToggle = useCallback(
    async (checked: boolean) => {
      if (!checked) {
        pendingEnableRef.current = false;
        await saveMainToggle(false);
        return;
      }

      if (isTauri()) {
        // Check current permission states
        const [accessibilityOk, screenOk] = await Promise.all([
          isAccessibilityGranted(true),
          isScreenRecordingGranted(true),
        ]);

        // If both permissions are already granted, enable directly
        if (accessibilityOk && screenOk) {
          await saveMainToggle(true);
          return;
        }

        // Otherwise, show the permission guide and retry on next app start
        void persistChronicleBootCheck(true);
        pendingEnableRef.current = true;
        setShowPermissionGuide(true);
        return;
      }

      await saveMainToggle(true);
    },
    [saveMainToggle],
  );

  /**
   * Generic field saver for the custom vision LLM block.
   * Each field is sent as a partial `visionLlm` payload so the server merges
   * it with the existing row.
   */
  const saveVisionField = useCallback(
    async (
      field: "enabled" | "apiUrl" | "apiKey" | "model",
      value: string | boolean,
    ) => {
      try {
        const response = await fetch("/api/preferences/insight", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            visionLlm: {
              [field]: value,
            },
          }),
        });
        if (!response.ok) throw new Error("Failed to save vision LLM settings");
        await mutateChroniclePrefs();
      } catch (error) {
        console.error("[Chronicle Settings] Vision LLM save failed:", error);
        toast({
          type: "error",
          description: t("chronicle.settings.visionLlm.saveError"),
        });
        await mutateChroniclePrefs();
      }
    },
    [mutateChroniclePrefs, t],
  );

  // Debounced text fields
  const apiUrlField = useDebouncedSave(
    visionLlm.apiUrl,
    useCallback((v: string) => saveVisionField("apiUrl", v), [saveVisionField]),
    800,
  );
  const apiKeyField = useDebouncedSave(
    visionLlm.apiKey,
    useCallback((v: string) => saveVisionField("apiKey", v), [saveVisionField]),
    800,
  );
  const modelField = useDebouncedSave(
    visionLlm.model,
    useCallback((v: string) => saveVisionField("model", v), [saveVisionField]),
    800,
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <RemixIcon
          name="loader_2"
          size="size-4"
          className="mr-2 animate-spin text-muted-foreground"
        />
        <span className="text-muted-foreground text-sm">
          {t("chronicle.settings.loading")}
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10">
          <RemixIcon name="record-circle" className="size-5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-medium">
            {t("chronicle.settings.title")}
          </h3>
          <p className="text-xs text-muted-foreground">
            {t("chronicle.settings.subtitle")}
          </p>
        </div>
        <Switch
          checked={chronicleEnabled}
          onCheckedChange={(checked) => {
            void handleToggle(checked);
          }}
          disabled={isSaving}
        />
      </div>

      {/* Description + interval + shortcut (stacked) */}
      <div className="space-y-4">
        <div className="rounded-lg border bg-card p-4 space-y-3">
          <p className="text-sm text-muted-foreground">
            {t("chronicle.settings.description")}
          </p>
          <div className="space-y-2">
            <div className="flex items-start gap-2 text-sm">
              <RemixIcon
                name="keyboard"
                className="size-4 mt-0.5 text-muted-foreground flex-shrink-0"
              />
              <span>
                {t("chronicle.settings.howItWorks", {
                  shortcut: savedShortcutDisplay,
                })}
              </span>
            </div>
            <div className="flex items-start gap-2 text-sm">
              <RemixIcon
                name="shield-check"
                className="size-4 mt-0.5 text-muted-foreground flex-shrink-0"
              />
              <span>{t("chronicle.settings.privacyNote")}</span>
            </div>
            <div className="flex items-start gap-2 text-sm">
              <RemixIcon
                name="timer"
                className="size-4 mt-0.5 text-muted-foreground flex-shrink-0"
              />
              <span>
                {t("chronicle.settings.debounceNote", {
                  seconds: Math.round(chronicleCaptureIntervalMs / 1000),
                })}
              </span>
            </div>
          </div>
        </div>

        {FF_SCREEN_MEMORY && (
          <>
            {/* Capture interval — single row: label + input + unit */}
            <div className="rounded-lg border bg-card p-4">
              <div className="flex flex-wrap items-center gap-3">
                <Label
                  htmlFor="chronicle-capture-interval"
                  className="text-sm font-medium"
                >
                  {t("chronicle.settings.captureInterval")}
                </Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="chronicle-capture-interval"
                    type="number"
                    inputMode="numeric"
                    min={3}
                    max={3600}
                    step={1}
                    value={intervalSecondsDraft}
                    onChange={(e) => setIntervalSecondsDraft(e.target.value)}
                    onBlur={commitIntervalDraft}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        commitIntervalDraft();
                      }
                    }}
                    disabled={isSavingInterval || isLoading}
                    className="w-24 text-sm"
                  />
                  <span className="text-sm text-muted-foreground">s</span>
                  {isSavingInterval ? (
                    <RemixIcon
                      name="loader_2"
                      className="size-4 animate-spin text-muted-foreground"
                    />
                  ) : null}
                </div>
                <p className="basis-full text-xs text-muted-foreground">
                  {t("chronicle.settings.captureIntervalHint")}
                </p>
              </div>
            </div>

            {/* Capture shortcut — single row: label + current value + edit */}
            <div className="rounded-lg border bg-card p-4 space-y-2">
              {!editingShortcut ? (
                <div className="flex flex-wrap items-center gap-3">
                  <Label
                    htmlFor="chronicle-capture-shortcut"
                    className="text-sm font-medium"
                  >
                    {t("chronicle.settings.captureShortcut")}
                  </Label>
                  <p className="rounded-md border border-dashed bg-muted/30 px-3 py-1.5 font-mono text-sm">
                    {savedShortcutDisplay}
                  </p>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2 text-xs"
                    onClick={beginEditShortcut}
                    disabled={isSaving || isSavingShortcut || isLoading}
                  >
                    {t("chronicle.settings.editShortcut")}
                  </Button>
                  <p className="basis-full text-xs text-muted-foreground">
                    {t("chronicle.settings.captureShortcutHint")}
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <Label
                    htmlFor="chronicle-capture-shortcut"
                    className="text-sm font-medium"
                  >
                    {t("chronicle.settings.captureShortcut")}
                  </Label>
                  <button
                    type="button"
                    ref={captureAreaRef}
                    id="chronicle-capture-shortcut"
                    aria-label={t("chronicle.settings.captureShortcut")}
                    onKeyDown={handleCaptureKey}
                    className="w-full rounded-md border border-dashed border-primary/40 bg-muted/20 px-3 py-6 text-center outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    {draftShortcut ? (
                      <span className="font-mono text-lg font-medium tracking-tight">
                        {draftShortcut}
                      </span>
                    ) : (
                      <span className="text-sm text-muted-foreground">
                        {t("chronicle.settings.shortcutListening")}
                      </span>
                    )}
                  </button>
                  {captureError ? (
                    <p className="text-xs text-destructive">{captureError}</p>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => {
                        void commitEditShortcut();
                      }}
                      disabled={
                        isSavingShortcut || draftShortcut.trim().length === 0
                      }
                    >
                      {isSavingShortcut ? (
                        <RemixIcon
                          name="loader_2"
                          className="size-4 animate-spin"
                        />
                      ) : null}
                      <span>{t("chronicle.settings.saveShortcut")}</span>
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={cancelEditShortcut}
                      disabled={isSavingShortcut}
                    >
                      {t("chronicle.settings.cancelShortcut")}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t("chronicle.settings.captureShortcutHint")}
                  </p>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Custom Vision LLM — only rendered when USE_CUSTOM_CHRONICLE_LLM=1 */}
      {process.env.NEXT_PUBLIC_USE_CUSTOM_CHRONICLE_LLM === "1" && (
        <div
          className={`rounded-lg border p-4 space-y-4 transition-opacity ${
            chronicleEnabled ? "opacity-100" : "opacity-50 pointer-events-none"
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <RemixIcon
                name="brain"
                className="size-4 text-muted-foreground"
              />
              <span className="text-sm font-medium">
                {t("chronicle.settings.visionLlm.title")}
              </span>
            </div>
            <Switch
              checked={visionLlm.enabled}
              onCheckedChange={(checked) => {
                void saveVisionField("enabled", checked);
              }}
              disabled={!chronicleEnabled}
            />
          </div>

          <p className="text-xs text-muted-foreground">
            {t("chronicle.settings.visionLlm.description")}
          </p>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label
                htmlFor="vision-llm-url"
                className="text-xs text-muted-foreground"
              >
                {t("chronicle.settings.visionLlm.apiUrl")}
              </Label>
              <Input
                id="vision-llm-url"
                type="url"
                placeholder="https://api.openai.com/v1"
                value={apiUrlField.localValue}
                onChange={(e) => apiUrlField.handleChange(e.target.value)}
                disabled={!chronicleEnabled || !visionLlm.enabled}
                className="text-sm"
              />
            </div>

            <div className="space-y-1.5">
              <Label
                htmlFor="vision-llm-key"
                className="text-xs text-muted-foreground"
              >
                {t("chronicle.settings.visionLlm.apiKey")}
              </Label>
              <Input
                id="vision-llm-key"
                type="text"
                placeholder="sk-..."
                value={apiKeyField.localValue}
                onChange={(e) => apiKeyField.handleChange(e.target.value)}
                disabled={!chronicleEnabled || !visionLlm.enabled}
                className="text-sm font-mono"
              />
            </div>

            <div className="space-y-1.5">
              <Label
                htmlFor="vision-llm-model"
                className="text-xs text-muted-foreground"
              >
                {t("chronicle.settings.visionLlm.model")}
              </Label>
              <Input
                id="vision-llm-model"
                type="text"
                placeholder="gpt-4o-mini"
                value={modelField.localValue}
                onChange={(e) => modelField.handleChange(e.target.value)}
                disabled={!chronicleEnabled || !visionLlm.enabled}
                className="text-sm"
              />
            </div>
          </div>
        </div>
      )}

      {/* Warning */}
      <div className="flex items-start gap-2 rounded-lg border border-yellow-200 bg-yellow-50 p-3 dark:border-yellow-900 dark:bg-yellow-950">
        <RemixIcon
          name="alert-triangle"
          className="size-4 mt-0.5 text-yellow-600 dark:text-yellow-500 flex-shrink-0"
        />
        <p className="text-xs text-yellow-800 dark:text-yellow-200">
          {t("chronicle.settings.warning")}
        </p>
      </div>

      {/* Permission Guide Dialog */}
      <ChroniclePermissionGuide
        open={showPermissionGuide}
        onOpenChange={setShowPermissionGuide}
        onComplete={async () => {
          pendingEnableRef.current = false;
          await saveMainToggle(true);
        }}
      />
    </div>
  );
}
