import {
  getUserLlmApiSettingWithApiKey,
  type LlmApiProviderType,
} from "@/lib/db/queries";

export type UserLlmProviderConfig = {
  apiKey: string;
  baseUrl: string;
  model: string;
};

export async function getUserLlmProviderConfig({
  userId,
  providerType,
}: {
  userId: string;
  providerType: LlmApiProviderType;
}): Promise<UserLlmProviderConfig | undefined> {
  try {
    const setting = await getUserLlmApiSettingWithApiKey({
      userId,
      providerType,
    });

    if (
      !setting?.enabled ||
      !setting.apiKey ||
      !setting.baseUrl ||
      !setting.model
    ) {
      return undefined;
    }

    return {
      apiKey: setting.apiKey,
      baseUrl: setting.baseUrl,
      model: setting.model,
    };
  } catch (error) {
    console.warn(
      `[AI Settings] Failed to load ${providerType} override`,
      error,
    );
    return undefined;
  }
}
