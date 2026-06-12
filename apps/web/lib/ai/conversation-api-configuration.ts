export const AI_SETTINGS_CHANGED_EVENT = "openloomi:ai-settings-changed";
export const MISSING_API_KEY_REASON = "missing-api-key";

type ConversationProviderSetting = {
  providerType: string;
  baseUrl: string | null;
  model: string | null;
  enabled: boolean;
  hasApiKey: boolean;
};

type ConversationSystemDefault = {
  hasApiKey: boolean;
};

export type ConversationApiSettingsResponse = {
  settings: ConversationProviderSetting[];
  systemDefaults: {
    anthropic_compatible: ConversationSystemDefault;
  };
};

function hasText(value: string | null) {
  return Boolean(value?.trim());
}

export function hasUsableConversationApiConfiguration(
  response: ConversationApiSettingsResponse,
) {
  const userSetting = response.settings.find(
    (setting) => setting.providerType === "anthropic_compatible",
  );
  const hasUserConfiguration = Boolean(
    userSetting?.enabled &&
    userSetting.hasApiKey &&
    hasText(userSetting.baseUrl) &&
    hasText(userSetting.model),
  );

  return (
    hasUserConfiguration ||
    response.systemDefaults.anthropic_compatible.hasApiKey
  );
}
