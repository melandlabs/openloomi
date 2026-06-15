"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslation } from "react-i18next";
import { Badge, Button, Input, Label, Separator, Switch } from "@openloomi/ui";
import { RemixIcon } from "@/components/remix-icon";
import { toast } from "@/components/toast";
import { fetchWithAuth } from "@/lib/utils";
import { cn } from "@/lib/utils";
import {
  AI_SETTINGS_CHANGED_EVENT,
  MISSING_API_KEY_REASON,
} from "@/lib/ai/conversation-api-configuration";
import { EmbeddingApiSettings } from "@/components/embedding-api-settings";

type ProviderType = "openai_compatible" | "anthropic_compatible";

type AiSetting = {
  id: string;
  userId: string;
  providerType: ProviderType;
  baseUrl: string | null;
  model: string | null;
  enabled: boolean;
  hasApiKey: boolean;
  createdAt: string;
  updatedAt: string;
};

type SystemDefault = {
  baseUrl: string | null;
  model: string | null;
  hasApiKey: boolean;
};

type AiSettingsResponse = {
  settings: AiSetting[];
  systemDefaults: Record<ProviderType, SystemDefault>;
};

type ProviderDraft = {
  apiKey: string;
  baseUrl: string;
  model: string;
  enabled: boolean;
};

const providers: Array<{
  type: ProviderType;
  titleKey: string;
  titleFallback: string;
  descriptionKey: string;
  descriptionFallback: string;
  apiKeyPlaceholderKey: string;
  apiKeyPlaceholderFallback: string;
  baseUrlPlaceholder: string;
  modelPlaceholder: string;
}> = [
  {
    type: "openai_compatible",
    titleKey: "settings.aiSettingsOpenAiTitle",
    titleFallback: "OpenAI compatible",
    descriptionKey: "settings.aiSettingsOpenAiDescription",
    descriptionFallback:
      "OpenAI, OpenRouter, Groq, Perplexity, or custom endpoints",
    apiKeyPlaceholderKey: "settings.aiSettingsOpenAiApiKeyPlaceholder",
    apiKeyPlaceholderFallback: "sk-...",
    baseUrlPlaceholder: "https://openrouter.ai/api/v1",
    modelPlaceholder: "openai/gpt-4o-mini",
  },
  {
    type: "anthropic_compatible",
    titleKey: "settings.aiSettingsAnthropicTitle",
    titleFallback: "Anthropic compatible",
    descriptionKey: "settings.aiSettingsAnthropicDescription",
    descriptionFallback: "Anthropic Claude or compatible provider endpoints",
    apiKeyPlaceholderKey: "settings.aiSettingsAnthropicApiKeyPlaceholder",
    apiKeyPlaceholderFallback: "sk-ant-...",
    baseUrlPlaceholder: "https://api.anthropic.com",
    modelPlaceholder: "claude-sonnet-4-6",
  },
];

const emptyDraft: ProviderDraft = {
  apiKey: "",
  baseUrl: "",
  model: "",
  enabled: false,
};

function createDraft(setting?: AiSetting): ProviderDraft {
  return {
    apiKey: "",
    baseUrl: setting?.baseUrl ?? "",
    model: setting?.model ?? "",
    enabled: setting?.enabled ?? false,
  };
}

export function AiApiSettings() {
  const { t } = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();
  const showMissingApiKeyNotice =
    searchParams.get("reason") === MISSING_API_KEY_REASON;
  const [settings, setSettings] = useState<AiSetting[]>([]);
  const [systemDefaults, setSystemDefaults] = useState<
    Record<ProviderType, SystemDefault>
  >({
    openai_compatible: { baseUrl: null, model: null, hasApiKey: false },
    anthropic_compatible: { baseUrl: null, model: null, hasApiKey: false },
  });
  const [drafts, setDrafts] = useState<Record<ProviderType, ProviderDraft>>({
    openai_compatible: emptyDraft,
    anthropic_compatible: emptyDraft,
  });
  const [loading, setLoading] = useState(true);
  const [savingProvider, setSavingProvider] = useState<ProviderType | null>(
    null,
  );
  const [testingProvider, setTestingProvider] = useState<ProviderType | null>(
    null,
  );
  const [resettingProvider, setResettingProvider] =
    useState<ProviderType | null>(null);

  const settingsByProvider = useMemo(() => {
    const map = new Map<ProviderType, AiSetting>();
    for (const setting of settings) {
      map.set(setting.providerType, setting);
    }
    return map;
  }, [settings]);
  const displayedProviders = useMemo(
    () =>
      showMissingApiKeyNotice
        ? [...providers].sort((provider) =>
            provider.type === "anthropic_compatible" ? -1 : 1,
          )
        : providers,
    [showMissingApiKeyNotice],
  );

  const loadSettings = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetchWithAuth("/api/preferences/ai");
      const data = (await response.json()) as AiSettingsResponse;

      if (!response.ok) {
        throw new Error("load_failed");
      }

      setSettings(data.settings);
      setSystemDefaults(data.systemDefaults);
      setDrafts({
        openai_compatible: createDraft(
          data.settings.find(
            (setting) => setting.providerType === "openai_compatible",
          ),
        ),
        anthropic_compatible: createDraft(
          data.settings.find(
            (setting) => setting.providerType === "anthropic_compatible",
          ),
        ),
      });
    } catch (error) {
      console.error("[AI Settings] Failed to load settings", error);
      toast({
        type: "error",
        description: t(
          "settings.aiSettingsLoadError",
          "Failed to load AI settings.",
        ),
      });
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const updateDraft = (
    providerType: ProviderType,
    updates: Partial<ProviderDraft>,
  ) => {
    setDrafts((current) => ({
      ...current,
      [providerType]: {
        ...current[providerType],
        ...updates,
      },
    }));
  };

  const saveProvider = async (
    providerType: ProviderType,
    options: { enabled?: boolean; showToast?: boolean } = {},
  ) => {
    const draft = drafts[providerType];
    const previousDraft = draft;
    const nextEnabled = options.enabled ?? draft.enabled;
    if (typeof options.enabled === "boolean") {
      updateDraft(providerType, { enabled: options.enabled });
    }
    setSavingProvider(providerType);
    try {
      const payload: {
        providerType: ProviderType;
        apiKey?: string;
        baseUrl: string | null;
        model: string | null;
        enabled: boolean;
      } = {
        providerType,
        baseUrl: draft.baseUrl.trim() || null,
        model: draft.model.trim() || null,
        enabled: nextEnabled,
      };

      if (draft.apiKey.trim()) {
        payload.apiKey = draft.apiKey.trim();
      }

      const response = await fetchWithAuth("/api/preferences/ai", {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      const data = (await response.json()) as { setting?: AiSetting };

      if (!response.ok || !data.setting) {
        throw new Error("save_failed");
      }

      const savedSetting = data.setting;
      setSettings((current) => [
        ...current.filter((setting) => setting.providerType !== providerType),
        savedSetting,
      ]);
      updateDraft(providerType, {
        apiKey: "",
        enabled: savedSetting.enabled,
      });
      window.dispatchEvent(new Event(AI_SETTINGS_CHANGED_EVENT));
      if (
        showMissingApiKeyNotice &&
        providerType === "anthropic_compatible" &&
        savedSetting.enabled &&
        savedSetting.hasApiKey &&
        savedSetting.baseUrl?.trim() &&
        savedSetting.model?.trim()
      ) {
        router.replace("/?page=chat", { scroll: false });
      }
      if (options.showToast !== false) {
        toast({
          type: "success",
          description: t("settings.aiSettingsSaved", "AI settings saved."),
        });
      }
    } catch (error) {
      console.error("[AI Settings] Failed to save settings", error);
      if (typeof options.enabled === "boolean") {
        updateDraft(providerType, { enabled: previousDraft.enabled });
      }
      toast({
        type: "error",
        description: t(
          "settings.aiSettingsSaveError",
          "Failed to save AI settings.",
        ),
      });
    } finally {
      setSavingProvider(null);
    }
  };

  const updateProviderEnabled = (
    providerType: ProviderType,
    enabled: boolean,
  ) => saveProvider(providerType, { enabled, showToast: false });

  const resetProvider = async (providerType: ProviderType) => {
    setResettingProvider(providerType);
    try {
      const response = await fetchWithAuth(
        `/api/preferences/ai?providerType=${providerType}`,
        { method: "DELETE" },
      );

      if (!response.ok) {
        throw new Error("reset_failed");
      }

      setSettings((current) =>
        current.filter((setting) => setting.providerType !== providerType),
      );
      updateDraft(providerType, createDraft());
      window.dispatchEvent(new Event(AI_SETTINGS_CHANGED_EVENT));
      toast({
        type: "success",
        description: t(
          "settings.aiSettingsReset",
          "User override reset to system defaults.",
        ),
      });
    } catch (error) {
      console.error("[AI Settings] Failed to reset settings", error);
      toast({
        type: "error",
        description: t(
          "settings.aiSettingsResetError",
          "Failed to reset AI settings.",
        ),
      });
    } finally {
      setResettingProvider(null);
    }
  };

  const testProvider = async (providerType: ProviderType) => {
    const draft = drafts[providerType];
    setTestingProvider(providerType);
    try {
      const payload: {
        providerType: ProviderType;
        apiKey?: string;
        baseUrl: string | null;
        model: string | null;
      } = {
        providerType,
        baseUrl: draft.baseUrl.trim() || null,
        model: draft.model.trim() || null,
      };

      if (draft.apiKey.trim()) {
        payload.apiKey = draft.apiKey.trim();
      }

      const response = await fetchWithAuth("/api/preferences/ai", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      const data = (await response.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
      } | null;

      if (!response.ok || !data?.ok) {
        throw new Error(data?.error ?? "test_failed");
      }

      toast({
        type: "success",
        description: t(
          "settings.aiSettingsTestSuccess",
          "Provider test succeeded.",
        ),
      });
    } catch (error) {
      console.error("[AI Settings] Provider test failed", error);
      toast({
        type: "error",
        description: t(
          "settings.aiSettingsTestError",
          "Provider test failed. Check the API key, base URL, and model.",
        ),
      });
    } finally {
      setTestingProvider(null);
    }
  };

  return (
    <div className="w-full max-w-none space-y-8">
      <div className="w-full px-1 sm:px-0 space-y-8">
        {showMissingApiKeyNotice && (
          <div
            role="status"
            className="flex gap-3 rounded-lg border border-primary/25 bg-primary/5 p-4 text-sm"
          >
            <RemixIcon
              name="info"
              size="size-5"
              className="mt-0.5 shrink-0 text-primary"
            />
            <div className="space-y-1">
              <p className="font-medium text-foreground">
                {t(
                  "settings.aiSettingsRequiredTitle",
                  "Configure an API key to start chatting",
                )}
              </p>
              <p className="text-muted-foreground">
                {t(
                  "settings.aiSettingsRequiredDescription",
                  "Enable an Anthropic-compatible provider and save its API key, base URL, and model before starting a conversation.",
                )}
              </p>
            </div>
          </div>
        )}
        <div className="flex flex-col gap-2">
          <p className="text-base font-semibold text-foreground-secondary">
            {t("settings.conversationModelsTitle", "Conversation models")}
          </p>
          <p className="max-w-3xl text-sm text-muted-foreground">
            {t(
              "settings.aiSettingsDescription",
              "Configure per-user API settings for compatible AI providers.",
            )}
          </p>
        </div>

        <div className="flex flex-col gap-6">
          {displayedProviders.map((provider) => {
            const setting = settingsByProvider.get(provider.type);
            const draft = drafts[provider.type];
            const defaults = systemDefaults[provider.type];
            const hasSavedSetting = Boolean(setting);
            const hasOverride = draft.enabled;
            const isSaving = savingProvider === provider.type;
            const isTesting = testingProvider === provider.type;
            const isResetting = resettingProvider === provider.type;
            const disabled = loading || isSaving || isTesting || isResetting;
            const canTest =
              Boolean(draft.baseUrl.trim()) &&
              Boolean(draft.model.trim()) &&
              Boolean(draft.apiKey.trim() || setting?.hasApiKey);
            const isRequiredConversationProvider =
              showMissingApiKeyNotice &&
              provider.type === "anthropic_compatible";

            return (
              <section
                key={provider.type}
                className={cn(
                  "rounded-lg border border-border bg-background p-4 sm:p-5",
                  isRequiredConversationProvider &&
                    "border-primary/40 ring-1 ring-primary/15",
                )}
              >
                <div className="flex flex-col gap-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-foreground">
                          {t(provider.titleKey, provider.titleFallback)}
                        </p>
                        <Badge
                          variant={hasOverride ? "default" : "secondary"}
                          className="h-5 rounded-md px-2 text-[11px] font-medium"
                        >
                          {hasOverride
                            ? t("settings.aiSettingsOverride", "User override")
                            : t("settings.aiSettingsSystem", "System default")}
                        </Badge>
                        {isRequiredConversationProvider && (
                          <Badge
                            variant="secondary"
                            className="h-5 rounded-md bg-primary/10 px-2 text-[11px] font-medium text-primary"
                          >
                            {t(
                              "settings.aiSettingsRequiredForChat",
                              "Required for chat",
                            )}
                          </Badge>
                        )}
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {t(
                          provider.descriptionKey,
                          provider.descriptionFallback,
                        )}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <Label
                        htmlFor={`${provider.type}-enabled`}
                        className="text-sm font-normal text-muted-foreground"
                      >
                        {t("settings.aiSettingsEnabled", "Enabled")}
                      </Label>
                      <Switch
                        id={`${provider.type}-enabled`}
                        checked={draft.enabled}
                        disabled={disabled}
                        onCheckedChange={(enabled) =>
                          updateProviderEnabled(provider.type, enabled)
                        }
                      />
                    </div>
                  </div>

                  <div className="grid gap-4 lg:grid-cols-3">
                    <div className="space-y-2">
                      <Label htmlFor={`${provider.type}-api-key`}>
                        {t("settings.aiSettingsApiKey", "API Key")}
                      </Label>
                      <Input
                        id={`${provider.type}-api-key`}
                        type="password"
                        value={draft.apiKey}
                        disabled={disabled}
                        placeholder={
                          setting?.hasApiKey
                            ? t(
                                "settings.aiSettingsSavedApiKeyPlaceholder",
                                "Saved. Leave blank to keep unchanged.",
                              )
                            : t(
                                provider.apiKeyPlaceholderKey,
                                provider.apiKeyPlaceholderFallback,
                              )
                        }
                        onChange={(event) =>
                          updateDraft(provider.type, {
                            apiKey: event.target.value,
                          })
                        }
                      />
                      <p className="text-xs text-muted-foreground">
                        {setting?.hasApiKey
                          ? t(
                              "settings.aiSettingsUserApiKeyConfigured",
                              "User API key configured",
                            )
                          : defaults.hasApiKey
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
                      <Label htmlFor={`${provider.type}-base-url`}>
                        {t("settings.aiSettingsBaseUrl", "Base URL")}
                      </Label>
                      <Input
                        id={`${provider.type}-base-url`}
                        value={draft.baseUrl}
                        disabled={disabled}
                        placeholder={provider.baseUrlPlaceholder}
                        onChange={(event) =>
                          updateDraft(provider.type, {
                            baseUrl: event.target.value,
                          })
                        }
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor={`${provider.type}-model`}>
                        {t("settings.aiSettingsModel", "Model")}
                      </Label>
                      <Input
                        id={`${provider.type}-model`}
                        value={draft.model}
                        disabled={disabled}
                        placeholder={provider.modelPlaceholder}
                        onChange={(event) =>
                          updateDraft(provider.type, {
                            model: event.target.value,
                          })
                        }
                      />
                    </div>
                  </div>

                  <div className="flex flex-col gap-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                      <span>
                        {t("settings.aiSettingsDefaultBaseUrl", "Default URL")}
                        {": "}
                        <span className="text-foreground">
                          {defaults.baseUrl ?? "—"}
                        </span>
                      </span>
                      <span>
                        {t("settings.aiSettingsDefaultModel", "Default model")}
                        {": "}
                        <span className="text-foreground">
                          {defaults.model ?? "—"}
                        </span>
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={disabled || !canTest}
                        onClick={() => testProvider(provider.type)}
                      >
                        {isTesting && (
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
                        disabled={!hasSavedSetting || disabled}
                        onClick={() => resetProvider(provider.type)}
                      >
                        {isResetting && (
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
                        disabled={disabled}
                        onClick={() => saveProvider(provider.type)}
                        className={cn("min-w-20", isSaving && "gap-2")}
                      >
                        {isSaving && (
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
          })}
        </div>

        <Separator />
        <EmbeddingApiSettings />
        <Separator className="mb-8" />
      </div>
    </div>
  );
}
