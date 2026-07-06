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

type LoopPreferencesResponse = {
  preferences: {
    enabled: boolean;
    briefTime: string;
    wrapTime: string;
    intervalSec: number;
    noReplySkip: boolean;
    promotionSkip: boolean;
  };
};

type DraftState = {
  enabled: boolean;
  briefTime: string;
  wrapTime: string;
  intervalSec: number;
};

function emptyDraft(): DraftState {
  return {
    enabled: true,
    briefTime: "09:00",
    wrapTime: "21:00",
    intervalSec: 600,
  };
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
      setDraft({
        enabled: data.preferences.enabled,
        briefTime: data.preferences.briefTime,
        wrapTime: data.preferences.wrapTime,
        intervalSec: data.preferences.intervalSec,
      });
      setDirty(false);
    } catch (error) {
      console.error("[Loop Settings] Failed to load", error);
    }
  }, []);

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
