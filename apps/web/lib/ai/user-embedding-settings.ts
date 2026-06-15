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
  authToken,
}: {
  userId?: string;
  authToken?: string;
}): Promise<boolean> {
  const config = await getUserEmbeddingRuntimeConfig(userId);
  const providerType = config?.providerType ?? getEmbeddingProviderType();

  if (providerType === "local") {
    return true;
  }

  return Boolean(
    config?.cloud?.apiKey ||
    authToken ||
    process.env.OPENAI_EMBEDDINGS_API_KEY ||
    process.env.OPENROUTER_API_KEY ||
    process.env.LLM_API_KEY,
  );
}
