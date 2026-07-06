"use client";

/**
 * Loop settings section ("General" settings page).
 *
 * Mirrors PetSettings: load current loop preferences from
 * `/api/loop/preferences`, render an enable switch plus the
 * briefTime / wrapTime / intervalSec knobs, and PUT the
 * validated patch back. Saving restarts the scheduler on the
 * server so the new cron expressions and tick interval take
 * effect immediately.
 */

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { toast } from "@/components/toast";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

const TIME_RE = /^([01]?\d|2[0-3]):[0-5]\d$/;

// ---- First-launch notice helpers -----------------------------------
// Module-scoped so re-renders don't recreate them. The storage key is
// namespaced + versioned so a future copy change can re-fire by
// bumping the suffix.
const LOOP_NOTICE_KEY = "openloomi.loop.noticeSeen.v1";

function hasSeenLoopNotice(): boolean {
  try {
    return window.localStorage.getItem(LOOP_NOTICE_KEY) === "1";
  } catch {
    return false;
  }
}

function markLoopNoticeSeen(): void {
  try {
    window.localStorage.setItem(LOOP_NOTICE_KEY, "1");
  } catch {
    /* private mode etc — best-effort */
  }
}

type LoopPreferencesResponse = {
  preferences: {
    enabled: boolean;
    briefTime: string;
    wrapTime: string;
    intervalSec: number;
    noReplySkip: boolean;
    promotionSkip: boolean;
    /**
     * Echoed back from the server — client never reads it directly into
     * the form, but `data.preferences.timezone` is consumed in
     * `handleSave`'s success branch to refresh the in-flight draft state.
     */
    timezone?: string;
  };
};

type DraftState = {
  enabled: boolean;
  briefTime: string;
  wrapTime: string;
  intervalSec: number;
  /**
   * IANA timezone from `Intl.DateTimeFormat()` of the host running this
   * component (i.e. the user's browser). Sent on PUT so the server-side
   * cron rows anchor to the user's wall-clock 09:00 / 21:00 instead of
   * the server's Intl (which in a container is usually `UTC`, producing
   * the 8h drift the user reported). Not user-editable; hidden from the
   * form.
   */
  timezone: string;
};

function emptyDraft(): DraftState {
  return {
    enabled: true,
    briefTime: "09:00",
    wrapTime: "21:00",
    intervalSec: 600,
    timezone: "",
  };
}

/** Best-effort read of the browser's IANA timezone. SSR-safe. */
function resolveBrowserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch {
    return "";
  }
}

function validate(draft: DraftState): string | null {
  if (!TIME_RE.test(draft.briefTime)) return "Morning brief time must be HH:MM";
  if (!TIME_RE.test(draft.wrapTime)) return "Evening wrap time must be HH:MM";
  if (!Number.isFinite(draft.intervalSec) || draft.intervalSec < 30) {
    return "Tick interval must be at least 30 seconds";
  }
  return null;
}

export function LoopSettings() {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/loop/preferences");
      if (!response.ok) return;
      const data = (await response.json()) as LoopPreferencesResponse;
      // Always supply the current browser TZ on save — even if the server
      // has a stale one from a previous session, a re-save re-anchors the
      // cron rows to wherever the user is now. This handles the "user
      // travels" case as a free side effect.
      const browserTz = resolveBrowserTimezone();
      const next: DraftState = {
        enabled: data.preferences.enabled,
        briefTime: data.preferences.briefTime,
        wrapTime: data.preferences.wrapTime,
        intervalSec: data.preferences.intervalSec,
        timezone: browserTz,
      };
      setDraft(next);
      setDirty(false);
      // First-launch notice. Loop is on by default; some platforms
      // (Gmail, Calendar, GitHub, Slack) get polled every 10 minutes. We
      // surface a one-time toast the first time the user opens this
      // settings panel and sees Loop enabled, so they can flip it off
      // here if they prefer. The flag lives in localStorage because
      // it's a UI hint, not a server-side preference.
      if (next.enabled && !hasSeenLoopNotice()) {
        markLoopNoticeSeen();
        toast({
          type: "info",
          description: t(
            "settings.loopNoticeDescription",
            "Loop is on — Loomi is reading Gmail / Calendar / GitHub / Slack in the background to fill your morning brief. Toggle off here if you'd rather not.",
          ),
        });
      }
    } catch (error) {
      console.error("[Loop Settings] Failed to load", error);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const update = useCallback((patch: Partial<DraftState>) => {
    setDraft((prev) => (prev ? { ...prev, ...patch } : prev));
    setDirty(true);
  }, []);

  const handleToggle = useCallback(
    (next: boolean) => {
      update({ enabled: next });
    },
    [update],
  );

  const handleSave = useCallback(async () => {
    if (!draft) return;
    const err = validate(draft);
    if (err) {
      toast({ type: "error", description: err });
      return;
    }
    setSaving(true);
    try {
      const response = await fetch("/api/loop/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      if (!response.ok) {
        const detail = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(detail?.error ?? `HTTP ${response.status.toString()}`);
      }
      const data = (await response.json()) as LoopPreferencesResponse;
      setDraft({
        enabled: data.preferences.enabled,
        briefTime: data.preferences.briefTime,
        wrapTime: data.preferences.wrapTime,
        intervalSec: data.preferences.intervalSec,
        // Server is the source of truth for TZ post-save (it echoes back
        // what it stored); fall back to the browser if it cleared the
        // field for any reason.
        timezone: data.preferences.timezone || resolveBrowserTimezone(),
      });
      setDirty(false);
      toast({
        type: "success",
        description: t("settings.loopSaveOk", "Loop settings saved."),
      });
    } catch (error) {
      console.error("[Loop Settings] Failed to save", error);
      toast({
        type: "error",
        description:
          error instanceof Error
            ? `${t("settings.loopSaveError", "Failed to save Loop settings.")}: ${error.message}`
            : t("settings.loopSaveError", "Failed to save Loop settings."),
      });
    } finally {
      setSaving(false);
    }
  }, [draft, t]);

  if (!draft) {
    return (
      <div className="text-sm text-muted-foreground">
        {t("common.loading", "Loading…")}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
        <div className="min-w-0">
          <Label
            htmlFor="loop-enabled"
            className="text-sm font-medium text-foreground"
          >
            {t("settings.loopEnableLabel", "Enable the Loop")}
          </Label>
          <p className="mt-1 text-sm text-muted-foreground">
            {t(
              "settings.loopEnableDescription",
              "Continuously pulls external signals (Gmail, Calendar, GitHub, Slack), classifies them into typed decisions, and surfaces them to the desktop pet.",
            )}
          </p>
        </div>
        <Switch
          id="loop-enabled"
          checked={draft.enabled}
          disabled={saving}
          onCheckedChange={(next) => handleToggle(next)}
        />
      </div>

      {draft.enabled && (
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label
              htmlFor="loop-brief-time"
              className="text-sm font-medium text-foreground"
            >
              {t("settings.loopBriefTimeLabel", "Morning brief time")}
            </Label>
            <Input
              id="loop-brief-time"
              type="time"
              value={draft.briefTime}
              disabled={saving}
              onChange={(e) => update({ briefTime: e.target.value })}
              className="max-w-[10rem]"
            />
          </div>
          <div className="space-y-1.5">
            <Label
              htmlFor="loop-wrap-time"
              className="text-sm font-medium text-foreground"
            >
              {t("settings.loopWrapTimeLabel", "Evening wrap time")}
            </Label>
            <Input
              id="loop-wrap-time"
              type="time"
              value={draft.wrapTime}
              disabled={saving}
              onChange={(e) => update({ wrapTime: e.target.value })}
              className="max-w-[10rem]"
            />
          </div>
          <div className="space-y-1.5">
            <Label
              htmlFor="loop-interval"
              className="text-sm font-medium text-foreground"
            >
              {t("settings.loopIntervalLabel", "Tick interval (seconds)")}
            </Label>
            <Input
              id="loop-interval"
              type="number"
              min={30}
              step={30}
              value={draft.intervalSec}
              disabled={saving}
              onChange={(e) =>
                update({
                  intervalSec: Number.parseInt(e.target.value, 10) || 0,
                })
              }
              className="max-w-[10rem]"
            />
          </div>
        </div>
      )}

      {dirty && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving}
            className="inline-flex items-center rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {t("common.save", "Save")}
          </button>
        </div>
      )}
    </div>
  );
}

export default LoopSettings;
// Force bundler reference so emptyDraft doesn't get tree-shaken if a future
// caller imports it for reset behaviour. Cheap and harmless.
void emptyDraft;
