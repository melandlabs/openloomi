"use client";

/**
 * Desktop pet settings section ("General" settings page).
 *
 * One switch: enable/disable the desktop pet (apps/pet). Enabled by default;
 * the server launches the pet together with the client at startup, and the
 * switch applies immediately (PUT starts/stops the pet on the spot).
 */

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { toast } from "@/components/toast";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

type PetSettingsResponse = {
  enabled: boolean;
  running?: boolean;
  launchError?: string;
};

export function PetSettings() {
  const { t } = useTranslation();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/preferences/pet");
      if (!response.ok) return;
      const data = (await response.json()) as PetSettingsResponse;
      setEnabled(data.enabled);
      setRunning(Boolean(data.running));
    } catch (error) {
      console.error("[Pet Settings] Failed to load", error);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleToggle = async (next: boolean) => {
    setSaving(true);
    setEnabled(next); // optimistic
    try {
      const response = await fetch("/api/preferences/pet", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status.toString()}`);
      const data = (await response.json()) as PetSettingsResponse;
      setEnabled(data.enabled);
      setRunning(Boolean(data.running));
      if (data.enabled && data.launchError) {
        toast({
          type: "error",
          description:
            t(
              "settings.petLaunchError",
              "Saved, but the pet could not be started: ",
            ) + data.launchError,
        });
      }
    } catch (error) {
      console.error("[Pet Settings] Failed to save", error);
      setEnabled(!next); // roll back
      toast({
        type: "error",
        description: t(
          "settings.petSaveError",
          "Failed to save desktop pet setting.",
        ),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <div className="min-w-0">
        <Label
          htmlFor="desktop-pet-enabled"
          className="text-sm font-medium text-foreground"
        >
          {t("settings.petEnableLabel", "Show the desktop pet")}
        </Label>
        <p className="mt-1 text-sm text-muted-foreground">
          {t(
            "settings.petEnableDescription",
            "A Loomi fox on your desktop that mirrors what OpenLoomi is doing. Starts together with the app.",
          )}
          {enabled && running
            ? ` · ${t("settings.petRunning", "Running")}`
            : ""}
        </p>
      </div>
      <Switch
        id="desktop-pet-enabled"
        checked={Boolean(enabled)}
        disabled={enabled === null || saving}
        onCheckedChange={(next) => void handleToggle(next)}
      />
    </div>
  );
}
