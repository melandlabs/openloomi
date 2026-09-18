"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
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
  Separator,
} from "@openloomi/ui";
import { AgentRuntimeSettings } from "@/components/agent-runtime-settings";
import { EmbeddingApiSettings } from "@/components/embedding-api-settings";
import { LlmUsagePanel } from "@/components/llm-usage-panel";
import { RemixIcon } from "@/components/remix-icon";
import { toast } from "@/components/toast";
import { MISSING_API_KEY_REASON } from "@/lib/ai/conversation-api-configuration";
import {
  getLlmProviderDefinition,
  LLM_PROVIDER_CATALOG,
  LLM_PROVIDER_IDS,
  type LlmProviderId,
  type LlmProviderTransport,
} from "@/lib/ai/llm-providers";
import { notifyAiSettingsChanged } from "@/lib/ai/notify-ai-settings-changed";
import { cn, fetchWithAuth } from "@/lib/utils";

type AiSetting = {
  id: string;
  userId: string;
  providerId: LlmProviderId;
  providerType: LlmProviderTransport;
  baseUrl: string | null;
  model: string | null;
  region: string | null;
  enabled: boolean;
  hasApiKey: boolean;
  createdAt: string;
  updatedAt: string;
};

type SystemDefault = {
  baseUrl: string | null;
  model: string | null;
  region: string | null;
  hasApiKey: boolean;
};

type AiSettingsResponse = {
  settings: AiSetting[];
  systemDefaults: Record<LlmProviderId, SystemDefault>;
};

type ProviderDraft = {
  apiKey: string;
  baseUrl: string;
  model: string;
  region: string;
};

const MASKED_API_KEY_CHAR = "•";
const DEFAULT_MASKED_API_KEY_VALUE = MASKED_API_KEY_CHAR.repeat(52);

function createSystemDefaults(): Record<LlmProviderId, SystemDefault> {
  return Object.fromEntries(
    LLM_PROVIDER_IDS.map((providerId) => {
      const provider = LLM_PROVIDER_CATALOG[providerId];
      return [
        providerId,
        {
          baseUrl: provider.defaultBaseUrl,
          model: provider.defaultModel,
          region: provider.defaultRegion,
          hasApiKey: false,
        },
      ];
    }),
  ) as Record<LlmProviderId, SystemDefault>;
}

function createDraft(setting?: AiSetting): ProviderDraft {
  return {
    apiKey: "",
    baseUrl: setting?.baseUrl ?? "",
    model: setting?.model ?? "",
    region: setting?.region ?? "",
  };
}

function createDrafts(
  settings: AiSetting[] = [],
): Record<LlmProviderId, ProviderDraft> {
  return Object.fromEntries(
    LLM_PROVIDER_IDS.map((providerId) => [
      providerId,
      createDraft(
        settings.find((setting) => setting.providerId === providerId),
      ),
    ]),
  ) as Record<LlmProviderId, ProviderDraft>;
}

function createApiKeyMasks(
  settings: AiSetting[] = [],
): Record<LlmProviderId, string> {
  return Object.fromEntries(
    LLM_PROVIDER_IDS.map((providerId) => [
      providerId,
      settings.find((setting) => setting.providerId === providerId)?.hasApiKey
        ? DEFAULT_MASKED_API_KEY_VALUE
        : "",
    ]),
  ) as Record<LlmProviderId, string>;
}

function maskApiKey(apiKey: string): string {
  return MASKED_API_KEY_CHAR.repeat(apiKey.length);
}

function removeApiKeyMask(value: string): string {
  return value.replaceAll(MASKED_API_KEY_CHAR, "");
}

export function AiApiSettings() {
  const { t } = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();
  const showMissingApiKeyNotice =
    searchParams.get("reason") === MISSING_API_KEY_REASON;
  const initialDefaults = useMemo(() => createSystemDefaults(), []);
  const [settings, setSettings] = useState<AiSetting[]>([]);
  const [systemDefaults, setSystemDefaults] =
    useState<Record<LlmProviderId, SystemDefault>>(initialDefaults);
  const [drafts, setDrafts] =
    useState<Record<LlmProviderId, ProviderDraft>>(createDrafts());
  const [apiKeyMasks, setApiKeyMasks] =
    useState<Record<LlmProviderId, string>>(createApiKeyMasks());
  const [selectedProviderId, setSelectedProviderId] =
    useState<LlmProviderId>("openai_compatible");
  const [loading, setLoading] = useState(true);
  const [savingProvider, setSavingProvider] = useState<LlmProviderId | null>(
    null,
  );
  const [testingProvider, setTestingProvider] = useState<LlmProviderId | null>(
    null,
  );
  const [resettingProvider, setResettingProvider] =
    useState<LlmProviderId | null>(null);

  const settingsByProvider = useMemo(() => {
    const map = new Map<LlmProviderId, AiSetting>();
    for (const setting of settings) map.set(setting.providerId, setting);
    return map;
  }, [settings]);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetchWithAuth("/api/preferences/ai");
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(
          `load_failed: HTTP ${response.status} ${response.statusText} — ${body.slice(0, 300)}`,
        );
      }

      const data = (await response.json()) as AiSettingsResponse;
      setSettings(data.settings);
      setSystemDefaults(data.systemDefaults);
      setApiKeyMasks(createApiKeyMasks(data.settings));
      setDrafts(createDrafts(data.settings));
      setSelectedProviderId(
        data.settings.find((setting) => setting.enabled)?.providerId ??
          data.settings[0]?.providerId ??
          "openai_compatible",
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error("[AI Settings] Failed to load settings", detail);
      toast({
        type: "error",
        description: `${t("settings.aiSettingsLoadError", "Failed to load AI settings.")} (${detail})`,
      });
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const updateDraft = (
    providerId: LlmProviderId,
    updates: Partial<ProviderDraft>,
  ) => {
    setDrafts((current) => ({
      ...current,
      [providerId]: { ...current[providerId], ...updates },
    }));
  };

  const isComplete = (providerId: LlmProviderId): boolean => {
    const definition = getLlmProviderDefinition(providerId);
    const setting = settingsByProvider.get(providerId);
    const defaults = systemDefaults[providerId];
    const draft = drafts[providerId];
    const hasApiKey = Boolean(
      draft.apiKey.trim() || setting?.hasApiKey || defaults.hasApiKey,
    );
    const credentialsComplete = !definition.apiKeyRequired || hasApiKey;
    const endpointComplete =
      definition.transport === "bedrock" ||
      Boolean(
        draft.baseUrl.trim() || defaults.baseUrl || definition.defaultBaseUrl,
      );
    const regionComplete =
      definition.transport !== "bedrock" ||
      Boolean(
        draft.region.trim() || defaults.region || definition.defaultRegion,
      );
    return (
      credentialsComplete &&
      endpointComplete &&
      regionComplete &&
      Boolean(draft.model.trim() || defaults.model || definition.defaultModel)
    );
  };

  const saveProvider = async (providerId: LlmProviderId) => {
    const draft = drafts[providerId];
    const nextApiKey = draft.apiKey.trim();
    const nextEnabled = isComplete(providerId);
    setSavingProvider(providerId);
    try {
      const payload: {
        providerId: LlmProviderId;
        apiKey?: string;
        baseUrl: string | null;
        model: string | null;
        region: string | null;
        enabled: boolean;
      } = {
        providerId,
        baseUrl: draft.baseUrl.trim() || null,
        model: draft.model.trim() || null,
        region: draft.region.trim() || null,
        enabled: nextEnabled,
      };
      if (nextApiKey) payload.apiKey = nextApiKey;

      const response = await fetchWithAuth("/api/preferences/ai", {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      const data = (await response.json().catch(() => ({}))) as {
        setting?: AiSetting;
        code?: string;
        message?: string;
        cause?: string;
      };
      if (!response.ok || !data.setting) {
        const reason = data.cause || data.message || data.code || "save_failed";
        throw new Error(`HTTP ${response.status}: ${reason}`);
      }

      const savedSetting = data.setting;
      setApiKeyMasks((current) => ({
        ...current,
        [providerId]: nextApiKey
          ? maskApiKey(nextApiKey)
          : savedSetting.hasApiKey
            ? current[providerId] || DEFAULT_MASKED_API_KEY_VALUE
            : "",
      }));
      setSettings((current) => [
        ...current
          .filter((setting) => setting.providerId !== providerId)
          .map((setting) => ({
            ...setting,
            enabled: nextEnabled ? false : setting.enabled,
          })),
        savedSetting,
      ]);
      updateDraft(providerId, { apiKey: "" });
      notifyAiSettingsChanged();
      if (showMissingApiKeyNotice && savedSetting.enabled) {
        router.replace("/?page=chat", { scroll: false });
      }
      toast({
        type: "success",
        description: nextEnabled
          ? t(
              "settings.aiSettingsSavedAndEnabled",
              "API settings saved and provider enabled.",
            )
          : t("settings.aiSettingsSaved", "AI settings saved."),
      });
    } catch (error) {
      console.error("[AI Settings] Failed to save settings", error);
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

  const resetProvider = async (providerId: LlmProviderId) => {
    setResettingProvider(providerId);
    try {
      const response = await fetchWithAuth(
        `/api/preferences/ai?providerId=${providerId}`,
        { method: "DELETE" },
      );
      if (!response.ok) throw new Error("reset_failed");

      setSettings((current) =>
        current.filter((setting) => setting.providerId !== providerId),
      );
      setApiKeyMasks((current) => ({ ...current, [providerId]: "" }));
      updateDraft(providerId, createDraft());
      notifyAiSettingsChanged();
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

  const testProvider = async (providerId: LlmProviderId) => {
    const draft = drafts[providerId];
    setTestingProvider(providerId);
    try {
      const payload: {
        providerId: LlmProviderId;
        apiKey?: string;
        baseUrl: string | null;
        model: string | null;
        region: string | null;
      } = {
        providerId,
        baseUrl: draft.baseUrl.trim() || null,
        model: draft.model.trim() || null,
        region: draft.region.trim() || null,
      };
      if (draft.apiKey.trim()) payload.apiKey = draft.apiKey.trim();

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
          "Provider test failed. Check its credentials and model settings.",
        ),
      });
    } finally {
      setTestingProvider(null);
    }
  };

  return (
    <div className="w-full max-w-none space-y-8">
      <div className="w-full space-y-8 px-1 sm:px-0">
        {showMissingApiKeyNotice && (
          <output
            aria-live="polite"
            aria-atomic="true"
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
                  "Configure a model provider to start chatting",
                )}
              </p>
              <p className="text-muted-foreground">
                {t(
                  "settings.aiSettingsRequiredDescription",
                  "Configure and save any supported provider below.",
                )}
              </p>
            </div>
          </output>
        )}

        <AgentRuntimeSettings />
        <div className="flex flex-col gap-2">
          <p className="text-base font-semibold text-foreground-secondary">
            {t("settings.conversationModelsTitle", "Conversation models")}
          </p>
          <p className="max-w-3xl text-sm text-muted-foreground">
            {t(
              "settings.aiSettingsDescription",
              "Save one active provider. API keys remain encrypted at rest; Ollama and AWS IAM credentials do not require a stored key.",
            )}
          </p>
        </div>

        <div className="flex flex-col gap-6">
          <div className="max-w-xl space-y-2">
            <Label htmlFor="conversation-model-provider">
              {t("settings.aiSettingsProvider", "Model provider")}
            </Label>
            <Select
              value={selectedProviderId}
              disabled={loading}
              onValueChange={(providerId) =>
                setSelectedProviderId(providerId as LlmProviderId)
              }
            >
              <SelectTrigger
                id="conversation-model-provider"
                className="w-full"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="min-w-[var(--radix-select-trigger-width)]">
                {LLM_PROVIDER_IDS.map((providerId) => {
                  const provider = getLlmProviderDefinition(providerId);
                  const setting = settingsByProvider.get(providerId);
                  return (
                    <SelectItem key={providerId} value={providerId}>
                      <span>
                        {t(
                          `settings.aiSettingsProviderNames.${providerId}`,
                          provider.displayName,
                        )}
                      </span>
                      {setting?.enabled ? (
                        <span className="text-xs text-primary">
                          {t("settings.aiSettingsActive", "Active")}
                        </span>
                      ) : setting ? (
                        <span className="text-xs text-muted-foreground">
                          {t("settings.aiSettingsConfigured", "Configured")}
                        </span>
                      ) : null}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {t(
                "settings.aiSettingsProviderHint",
                "Choose and configure one provider. Saving a complete configuration makes it the active conversation model provider.",
              )}
            </p>
          </div>

          {LLM_PROVIDER_IDS.filter(
            (providerId) => providerId === selectedProviderId,
          ).map((providerId) => {
            const provider = getLlmProviderDefinition(providerId);
            const setting = settingsByProvider.get(providerId);
            const draft = drafts[providerId];
            const defaults = systemDefaults[providerId];
            const disabled =
              loading ||
              savingProvider === providerId ||
              testingProvider === providerId ||
              resettingProvider === providerId;
            const savedApiKeyMask =
              apiKeyMasks[providerId] || DEFAULT_MASKED_API_KEY_VALUE;
            const apiKeyValue =
              draft.apiKey || (setting?.hasApiKey ? savedApiKeyMask : "");
            const showBaseUrl = provider.transport !== "bedrock";
            const showRegion = provider.transport === "bedrock";

            return (
              <section
                key={providerId}
                className={cn(
                  "rounded-lg border border-border bg-background p-4 sm:p-5",
                  setting?.enabled &&
                    "border-primary/40 ring-1 ring-primary/15",
                )}
              >
                <div className="flex flex-col gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-foreground">
                        {t(
                          `settings.aiSettingsProviderNames.${providerId}`,
                          provider.displayName,
                        )}
                      </p>
                      <Badge
                        variant={setting?.enabled ? "default" : "secondary"}
                        className="h-5 rounded-md px-2 text-[11px] font-medium"
                      >
                        {setting?.enabled
                          ? t("settings.aiSettingsActive", "Active")
                          : setting
                            ? t("settings.aiSettingsConfigured", "Configured")
                            : t(
                                "settings.aiSettingsNotConfigured",
                                "Not configured",
                              )}
                      </Badge>
                      <Badge
                        variant="secondary"
                        className="h-5 rounded-md px-2 text-[11px] font-medium"
                      >
                        {provider.transport === "bedrock"
                          ? t(
                              "settings.aiSettingsTransportConverse",
                              "Converse",
                            )
                          : provider.transport === "anthropic_compatible"
                            ? t(
                                "settings.aiSettingsTransportMessages",
                                "Messages",
                              )
                            : t(
                                "settings.aiSettingsTransportChatCompletions",
                                "Chat Completions",
                              )}
                      </Badge>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {t(
                        `settings.aiSettingsProviderDescriptions.${providerId}`,
                        provider.description,
                      )}
                    </p>
                  </div>

                  <div className={cn("grid gap-4", "lg:grid-cols-3")}>
                    <div className="space-y-2">
                      <Label htmlFor={`${providerId}-api-key`}>
                        {provider.apiKeyRequired
                          ? t("settings.aiSettingsApiKey", "API Key")
                          : t(
                              "settings.aiSettingsOptionalApiKey",
                              "API Key (optional)",
                            )}
                      </Label>
                      <Input
                        id={`${providerId}-api-key`}
                        type="password"
                        value={apiKeyValue}
                        disabled={disabled}
                        placeholder={t(
                          `settings.aiSettingsProviderApiKeyPlaceholders.${providerId}`,
                          provider.apiKeyPlaceholder,
                        )}
                        onFocus={(event) => {
                          if (!draft.apiKey && setting?.hasApiKey) {
                            event.currentTarget.select();
                          }
                        }}
                        onChange={(event) => {
                          const nextValue = event.target.value;
                          updateDraft(providerId, {
                            apiKey:
                              !draft.apiKey && setting?.hasApiKey
                                ? removeApiKeyMask(nextValue)
                                : nextValue,
                          });
                        }}
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
                                "Using environment credentials",
                              )
                            : provider.apiKeyRequired
                              ? t(
                                  "settings.aiSettingsApiKeyNotConfigured",
                                  "No API key configured",
                                )
                              : providerId === "bedrock"
                                ? t(
                                    "settings.aiSettingsBedrockCredentialChain",
                                    "Uses the AWS credential chain when blank",
                                  )
                                : t(
                                    "settings.aiSettingsApiKeyNotRequired",
                                    "This provider does not require a key",
                                  )}
                      </p>
                    </div>

                    {showBaseUrl && (
                      <div className="space-y-2">
                        <Label htmlFor={`${providerId}-base-url`}>
                          {t("settings.aiSettingsBaseUrl", "Base URL")}
                        </Label>
                        <Input
                          id={`${providerId}-base-url`}
                          value={draft.baseUrl}
                          disabled={disabled}
                          placeholder={
                            defaults.baseUrl ?? provider.defaultBaseUrl ?? ""
                          }
                          onChange={(event) =>
                            updateDraft(providerId, {
                              baseUrl: event.target.value,
                            })
                          }
                        />
                      </div>
                    )}

                    {showRegion && (
                      <div className="space-y-2">
                        <Label htmlFor={`${providerId}-region`}>
                          {t("settings.aiSettingsAwsRegion", "AWS Region")}
                        </Label>
                        <Input
                          id={`${providerId}-region`}
                          value={draft.region}
                          disabled={disabled}
                          placeholder={
                            defaults.region ??
                            provider.defaultRegion ??
                            "us-east-1"
                          }
                          onChange={(event) =>
                            updateDraft(providerId, {
                              region: event.target.value,
                            })
                          }
                        />
                      </div>
                    )}

                    <div className="space-y-2">
                      <Label htmlFor={`${providerId}-model`}>
                        {t("settings.aiSettingsModel", "Model")}
                      </Label>
                      <Input
                        id={`${providerId}-model`}
                        value={draft.model}
                        disabled={disabled}
                        placeholder={defaults.model ?? provider.defaultModel}
                        onChange={(event) =>
                          updateDraft(providerId, { model: event.target.value })
                        }
                      />
                    </div>
                  </div>

                  <div className="flex flex-col gap-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
                    <span>
                      {showRegion
                        ? t(
                            "settings.aiSettingsDefaultRegion",
                            "Default region",
                          )
                        : t("settings.aiSettingsDefaultBaseUrl", "Default URL")}
                      {": "}
                      <span className="text-foreground">
                        {showRegion
                          ? (defaults.region ?? "—")
                          : (defaults.baseUrl ?? "—")}
                      </span>
                      {" · "}
                      {t("settings.aiSettingsDefaultModel", "Default model")}
                      {": "}
                      <span className="text-foreground">
                        {defaults.model ?? "—"}
                      </span>
                    </span>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={disabled || !isComplete(providerId)}
                        onClick={() => testProvider(providerId)}
                      >
                        {testingProvider === providerId && (
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
                        disabled={!setting || disabled}
                        onClick={() => resetProvider(providerId)}
                      >
                        {resettingProvider === providerId && (
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
                        onClick={() => saveProvider(providerId)}
                        className={cn(
                          "min-w-20",
                          savingProvider === providerId && "gap-2",
                        )}
                      >
                        {savingProvider === providerId && (
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

          <LlmUsagePanel />
        </div>

        <Separator />
        <EmbeddingApiSettings />
        <Separator className="mb-8" />
      </div>
    </div>
  );
}
