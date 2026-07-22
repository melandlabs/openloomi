import {
  getUserEmbeddingSettingWithApiKey,
  type UserEmbeddingSettingWithApiKey,
} from "@/lib/db/queries";
import {
  getConfiguredEmbeddingModelName,
  getConfiguredEmbeddingProvider,
  getEmbeddingProviderType,
  type EmbeddingProvider,
  type EmbeddingProviderFactoryOptions,
} from "@openloomi/rag";

export type UserEmbeddingRuntimeConfig = Omit<
  EmbeddingProviderFactoryOptions,
  "userAuthToken"
>;

function toRuntimeConfig(
  setting: UserEmbeddingSettingWithApiKey | null,
): UserEmbeddingRuntimeConfig | undefined {
  if (!setting?.enabled) {
    return undefined;
  }

  if (setting.providerType === "local") {
    return {
      providerType: "local",
      local: {
        modelName: setting.model ?? undefined,
        device: setting.device ?? undefined,
        localFilesOnly: setting.localFilesOnly,
      },
    };
  }

  return {
    providerType: "cloud",
    cloud: {
      apiKey: setting.apiKey ?? undefined,
      baseURL: setting.baseUrl ?? undefined,
      modelName: setting.model ?? undefined,
    },
  };
}

export async function getUserEmbeddingRuntimeConfig(
  userId?: string,
): Promise<UserEmbeddingRuntimeConfig | undefined> {
  if (!userId) return undefined;

  try {
    return toRuntimeConfig(await getUserEmbeddingSettingWithApiKey(userId));
  } catch (error) {
    console.warn("[Embedding Settings] Failed to load user override", error);
    return undefined;
  }
}

export async function createUserEmbeddingProvider({
  userId,
  authToken,
}: {
  userId?: string;
  authToken?: string;
}): Promise<EmbeddingProvider> {
  const config = await getUserEmbeddingRuntimeConfig(userId);
  return getConfiguredEmbeddingProvider({
    ...config,
    userAuthToken: authToken,
  });
}

export async function getUserEmbeddingModelName(
  userId?: string,
): Promise<string> {
  const config = await getUserEmbeddingRuntimeConfig(userId);
  return getConfiguredEmbeddingModelName(config);
}

export async function hasUserEmbeddingProviderConfig({
  userId,
  authToken: _authToken,
}: {
  userId?: string;
  /**
   * Kept for backward compatibility with existing callers. Intentionally
   * ignored for the cloud check: the user's session JWT is a NextAuth token,
   * not an OpenRouter API key, so treating it as a valid cloud credential
   * causes requests to hit OpenRouter with an invalid Bearer and surface a
   * misleading 401 "Missing Authentication header" instead of a clear
   * "no provider configured" error. For local mode (which never needs a
   * key) the check below already short-circuits.
   */
  authToken?: string;
}): Promise<boolean> {
  const config = await getUserEmbeddingRuntimeConfig(userId);
  const providerType = config?.providerType ?? getEmbeddingProviderType();

  if (providerType === "local") {
    return true;
  }

  return Boolean(config?.cloud?.apiKey || process.env.OPENROUTER_API_KEY);
}
