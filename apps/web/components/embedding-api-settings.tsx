"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Badge,
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from "@openloomi/ui";

import { RemixIcon } from "@/components/remix-icon";
import { toast } from "@/components/toast";
import { cn, fetchWithAuth } from "@/lib/utils";

type EmbeddingProviderType = "cloud" | "local";

type EmbeddingSetting = {
  id: string;
  userId: string;
  providerType: EmbeddingProviderType;
  baseUrl: string | null;
  model: string | null;
  device: string | null;
  localFilesOnly: boolean;
  enabled: boolean;
  hasApiKey: boolean;
};

type EmbeddingSystemDefaults = {
  providerType: EmbeddingProviderType;
  cloud: {
    baseUrl: string;
    model: string;
    hasApiKey: boolean;
  };
  local: {
    model: string;
    device: string;
    localFilesOnly: boolean;
  };
};

type EmbeddingSettingsResponse = {
  setting: EmbeddingSetting | null;
  systemDefaults: EmbeddingSystemDefaults;
};

type EmbeddingDraft = {
  providerType: EmbeddingProviderType;
  apiKey: string;
  baseUrl: string;
  model: string;
  localFilesOnly: boolean;
};

const CUSTOM_LOCAL_MODEL = "__custom__";
const LOCAL_MODEL_OPTIONS = [
  {
    value: "Xenova/all-MiniLM-L6-v2",
    label: "all-MiniLM-L6-v2",
    dimensions: 384,
  },
  {
    value: "Xenova/bge-large-zh-v1.5",
    label: "bge-large-zh-v1.5",
    dimensions: 1024,
  },
] as const;

const initialDefaults: EmbeddingSystemDefaults = {
  providerType: "cloud",
  cloud: {
    baseUrl: "https://openrouter.ai/api/v1",
    model: "text-embedding-3-small",
    hasApiKey: false,
  },
  local: {
    model: "Xenova/all-MiniLM-L6-v2",
    device: "cpu",
    localFilesOnly: false,
  },
};

function createDraft(
  setting: EmbeddingSetting | null,
  defaults: EmbeddingSystemDefaults,
): EmbeddingDraft {
  const providerType = setting?.providerType ?? defaults.providerType;
  return {
    providerType,
    apiKey: "",
    baseUrl: setting?.baseUrl ?? defaults.cloud.baseUrl,
    model:
      setting?.model ??
      (providerType === "local" ? defaults.local.model : defaults.cloud.model),
    localFilesOnly: setting?.localFilesOnly ?? defaults.local.localFilesOnly,
  };
}

export function EmbeddingApiSettings() {
  const { t } = useTranslation();
  const [setting, setSetting] = useState<EmbeddingSetting | null>(null);
  const [defaults, setDefaults] =
    useState<EmbeddingSystemDefaults>(initialDefaults);
  const [draft, setDraft] = useState<EmbeddingDraft>(() =>
    createDraft(null, initialDefaults),
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [resetting, setResetting] = useState(false);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetchWithAuth("/api/preferences/embeddings");

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(
          `load_failed: HTTP ${response.status} ${response.statusText} — ${body.slice(0, 300)}`,
        );
      }

      const data = (await response.json()) as EmbeddingSettingsResponse;

      setSetting(data.setting);
      setDefaults(data.systemDefaults);
      setDraft(createDraft(data.setting, data.systemDefaults));
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error("[Embedding Settings] Failed to load settings", detail);
      toast({
        type: "error",
        description: `${t(
          "settings.embeddingLoadError",
          "Failed to load embedding settings.",
        )} (${detail})`,
      });
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const updateDraft = (updates: Partial<EmbeddingDraft>) => {
    setDraft((current) => ({ ...current, ...updates }));
  };

  const selectProvider = (providerType: EmbeddingProviderType) => {
    setDraft((current) => ({
      ...current,
      providerType,
      model:
        setting?.providerType === providerType && setting.model
          ? setting.model
          : providerType === "local"
            ? defaults.local.model
            : defaults.cloud.model,
    }));
  };

  const payload = () => ({
    providerType: draft.providerType,
    apiKey: draft.apiKey.trim() || undefined,
    baseUrl: draft.baseUrl.trim() || null,
    model: draft.model.trim() || null,
    device: defaults.local.device,
    localFilesOnly: draft.localFilesOnly,
    enabled: true,
  });

  const saveSettings = async () => {
    setSaving(true);
    try {
      const response = await fetchWithAuth("/api/preferences/embeddings", {
        method: "PUT",
        body: JSON.stringify(payload()),
      });
      const data = (await response.json().catch(() => ({}))) as {
        setting?: EmbeddingSetting;
        code?: string;
        message?: string;
        cause?: string;
      };
      if (!response.ok || !data.setting) {
        // Surface the server-side cause so DevTools shows the real failure
        // instead of an opaque "save_failed". Prefix HTTP status for context.
        const reason = data.cause || data.message || data.code || "save_failed";
        throw new Error(`HTTP ${response.status}: ${reason}`);
      }

      setSetting(data.setting);
      setDraft((current) => ({ ...current, apiKey: "" }));
      toast({
        type: "success",
        description: t("settings.embeddingSaved", "Embedding settings saved."),
      });
    } catch (error) {
      console.error("[Embedding Settings] Failed to save settings", error);
      toast({
        type: "error",
        description: t(
          "settings.embeddingSaveError",
          "Failed to save embedding settings.",
        ),
      });
    } finally {
      setSaving(false);
    }
  };

  const testSettings = async () => {
    setTesting(true);
    try {
      const response = await fetchWithAuth("/api/preferences/embeddings", {
        method: "POST",
        body: JSON.stringify(payload()),
      });
      const data = (await response.json().catch(() => null)) as {
        ok?: boolean;
        dimensions?: number;
        error?: string;
      } | null;
      if (!response.ok || !data?.ok) {
        throw new Error(data?.error ?? "test_failed");
      }

      toast({
        type: "success",
        description: t(
          "settings.embeddingTestSuccess",
          "Embedding test succeeded ({{dimensions}} dimensions).",
          { dimensions: data.dimensions },
        ),
      });
    } catch (error) {
      console.error("[Embedding Settings] Test failed", error);
      toast({
        type: "error",
        description:
          error instanceof Error && error.message !== "test_failed"
            ? error.message
            : t(
                "settings.embeddingTestError",
                "Embedding test failed. Check the configuration.",
              ),
      });
    } finally {
      setTesting(false);
    }
  };

  const resetSettings = async () => {
    setResetting(true);
    try {
      const response = await fetchWithAuth("/api/preferences/embeddings", {
        method: "DELETE",
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as {
          code?: string;
          message?: string;
          cause?: string;
        };
        const reason =
          data.cause || data.message || data.code || "reset_failed";
        throw new Error(`HTTP ${response.status}: ${reason}`);
      }

      setSetting(null);
      setDraft(createDraft(null, defaults));
      toast({
        type: "success",
        description: t(
          "settings.embeddingReset",
          "Embedding settings reset to system defaults.",
        ),
      });
    } catch (error) {
      console.error("[Embedding Settings] Failed to reset settings", error);
      toast({
        type: "error",
        description: t(
          "settings.embeddingResetError",
          "Failed to reset embedding settings.",
        ),
      });
    } finally {
      setResetting(false);
    }
  };

  const busy = loading || saving || testing || resetting;
  const canTest =
    Boolean(draft.model.trim()) &&
    (draft.providerType === "local" ||
      (Boolean(draft.baseUrl.trim()) &&
        Boolean(
          draft.apiKey.trim() || setting?.hasApiKey || defaults.cloud.hasApiKey,
        )));
  const selectedLocalModel = LOCAL_MODEL_OPTIONS.some(
    (option) => option.value === draft.model,
  )
    ? draft.model
    : CUSTOM_LOCAL_MODEL;

  return (
    <section className="space-y-5">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-base font-semibold text-foreground-secondary">
            {t("settings.embeddingTitle", "Embedding models")}
          </p>
          <Badge
            variant={setting ? "default" : "secondary"}
            className="h-5 rounded-md px-2 text-[11px] font-medium"
          >
            {setting
              ? t("settings.aiSettingsOverride", "User override")
              : t("settings.aiSettingsSystem", "System default")}
          </Badge>
        </div>
        <p className="max-w-3xl text-sm text-muted-foreground">
          {t(
            "settings.embeddingDescription",
            "Choose how OpenLoomi creates vectors for knowledge, memory, and semantic search.",
          )}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {(
          [
            {
              type: "cloud" as const,
              icon: "cloud",
              title: t("settings.embeddingCloudTitle", "Online API"),
              description: t(
                "settings.embeddingCloudDescription",
                "Use an OpenAI-compatible embedding endpoint.",
              ),
            },
            {
              type: "local" as const,
              icon: "hard_drive",
              title: t("settings.embeddingLocalTitle", "Local model"),
              description: t(
                "settings.embeddingLocalDescription",
                "Run a Transformers.js model on this device.",
              ),
            },
          ] satisfies Array<{
            type: EmbeddingProviderType;
            icon: string;
            title: string;
            description: string;
          }>
        ).map((option) => {
          const selected = draft.providerType === option.type;
          return (
            <button
              key={option.type}
              type="button"
              disabled={busy}
              onClick={() => selectProvider(option.type)}
              className={cn(
                "flex items-start gap-3 rounded-lg border p-4 text-left transition-colors",
                selected
                  ? "border-primary/50 bg-primary/5 ring-1 ring-primary/15"
                  : "border-border bg-background hover:border-foreground/20 hover:bg-muted/30",
              )}
            >
              <span
                className={cn(
                  "flex size-9 shrink-0 items-center justify-center rounded-lg",
                  selected
                    ? "bg-primary/10 text-primary"
                    : "bg-muted text-muted-foreground",
                )}
              >
                <RemixIcon name={option.icon} size="size-5" />
              </span>
              <span className="min-w-0">
                <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  {option.title}
                  {selected && (
                    <RemixIcon
                      name="circle_check"
                      size="size-4"
                      className="text-primary"
                    />
                  )}
                </span>
                <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                  {option.description}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="rounded-lg border border-border bg-background p-4 sm:p-5">
        {draft.providerType === "cloud" ? (
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="embedding-api-key">
                {t("settings.aiSettingsApiKey", "API Key")}
              </Label>
              <Input
                id="embedding-api-key"
                type="password"
                value={draft.apiKey}
                disabled={busy}
                placeholder={
                  setting?.providerType === "cloud" && setting.hasApiKey
                    ? t(
                        "settings.aiSettingsSavedApiKeyPlaceholder",
                        "Saved. Leave blank to keep unchanged.",
                      )
                    : "sk-..."
                }
                onChange={(event) =>
                  updateDraft({ apiKey: event.target.value })
                }
              />
              <p className="text-xs text-muted-foreground">
                {setting?.providerType === "cloud" && setting.hasApiKey
                  ? t(
                      "settings.aiSettingsUserApiKeyConfigured",
                      "User API key configured",
                    )
                  : defaults.cloud.hasApiKey
                    ? t(
                        "settings.aiSettingsSystemApiKeyConfigured",
                        "Using system API key",
                      )
                    : t(
                        "settings.aiSettingsApiKeyNotConfigured",
                        "No API key configured",
                      )}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="embedding-base-url">
                {t("settings.aiSettingsBaseUrl", "Base URL")}
              </Label>
              <Input
                id="embedding-base-url"
                value={draft.baseUrl}
                disabled={busy}
                placeholder="https://api.openai.com/v1"
                onChange={(event) =>
                  updateDraft({ baseUrl: event.target.value })
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="embedding-cloud-model">
                {t("settings.aiSettingsModel", "Model")}
              </Label>
              <Input
                id="embedding-cloud-model"
                value={draft.model}
                disabled={busy}
                placeholder="text-embedding-3-small"
                onChange={(event) => updateDraft({ model: event.target.value })}
              />
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid items-start gap-4 lg:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="embedding-local-model">
                  {t("settings.embeddingLocalModel", "Model ID or local path")}
                </Label>
                <Select
                  value={selectedLocalModel}
                  disabled={busy}
                  onValueChange={(model) =>
                    updateDraft({
                      model: model === CUSTOM_LOCAL_MODEL ? "" : model,
                    })
                  }
                >
                  <SelectTrigger id="embedding-local-model" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="min-w-[var(--radix-select-trigger-width)]">
                    {LOCAL_MODEL_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label} ({option.dimensions}D)
                      </SelectItem>
                    ))}
                    <SelectItem value={CUSTOM_LOCAL_MODEL}>
                      {t(
                        "settings.embeddingCustomLocalModel",
                        "Custom model ID or local path",
                      )}
                    </SelectItem>
                  </SelectContent>
                </Select>
                {selectedLocalModel === CUSTOM_LOCAL_MODEL && (
                  <Input
                    id="embedding-custom-local-model"
                    value={draft.model}
                    disabled={busy}
                    placeholder={t(
                      "settings.embeddingCustomLocalModelPlaceholder",
                      "Enter a Hugging Face model ID or local path",
                    )}
                    onChange={(event) =>
                      updateDraft({ model: event.target.value })
                    }
                  />
                )}
              </div>
              <div className="flex min-h-[76px] items-start justify-between gap-4 rounded-lg bg-muted/40 p-3 lg:mt-7">
                <div>
                  <Label htmlFor="embedding-local-only">
                    {t("settings.embeddingLocalOnly", "Use local files only")}
                  </Label>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t(
                      "settings.embeddingLocalOnlyDescription",
                      "To use your own local model, enter its path and enable this option. Model downloads will be disabled, and only model files already available on this device will be loaded.",
                    )}
                  </p>
                </div>
                <Switch
                  id="embedding-local-only"
                  checked={draft.localFilesOnly}
                  disabled={busy}
                  onCheckedChange={(localFilesOnly) =>
                    updateDraft({ localFilesOnly })
                  }
                />
              </div>
            </div>
            <div className="flex gap-2 text-xs text-muted-foreground">
              <RemixIcon name="info" size="size-4" className="mt-0.5" />
              <span>
                {t(
                  "settings.embeddingLocalDownloadHint",
                  "The first test may download the model and take a little longer.",
                )}
              </span>
            </div>
          </div>
        )}

        <div className="mt-5 flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">
            {t(
              "settings.embeddingUsageHint",
              "Used by knowledge base, memory, and semantic search.",
            )}
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!canTest || busy}
              onClick={testSettings}
            >
              {testing && (
                <RemixIcon
                  name="loader_2"
                  size="size-4"
                  className="animate-spin"
                />
              )}
              {t("settings.aiSettingsTestButton", "Test")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!setting || busy}
              onClick={resetSettings}
            >
              {resetting && (
                <RemixIcon
                  name="loader_2"
                  size="size-4"
                  className="animate-spin"
                />
              )}
              {t("settings.aiSettingsResetButton", "Reset")}
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={busy || !draft.model.trim()}
              onClick={saveSettings}
              className="min-w-20"
            >
              {saving && (
                <RemixIcon
                  name="loader_2"
                  size="size-4"
                  className="animate-spin"
                />
              )}
              {t("common.save", "Save")}
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
