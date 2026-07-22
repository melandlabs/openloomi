import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const queryMocks = vi.hoisted(() => ({
  getUserEmbeddingSettingWithApiKey: vi.fn(),
}));

vi.mock("@/lib/db/queries", () => queryMocks);

import {
  getUserEmbeddingRuntimeConfig,
  hasUserEmbeddingProviderConfig,
} from "@/lib/ai/user-embedding-settings";

const ENV_KEYS = ["EMBEDDING_PROVIDER", "OPENROUTER_API_KEY"];

function clearEnv(): void {
  for (const key of ENV_KEYS) {
    Reflect.deleteProperty(process.env, key);
  }
}

describe("user embedding settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearEnv();
  });

  afterEach(() => {
    clearEnv();
  });

  it("maps a local setting to local provider options", async () => {
    queryMocks.getUserEmbeddingSettingWithApiKey.mockResolvedValue({
      enabled: true,
      providerType: "local",
      model: "local/model",
      device: "cpu",
      localFilesOnly: true,
      apiKey: null,
    });

    await expect(getUserEmbeddingRuntimeConfig("user-1")).resolves.toEqual({
      providerType: "local",
      local: {
        modelName: "local/model",
        device: "cpu",
        localFilesOnly: true,
      },
    });
  });

  it("maps cloud credentials without exposing unrelated local options", async () => {
    queryMocks.getUserEmbeddingSettingWithApiKey.mockResolvedValue({
      enabled: true,
      providerType: "cloud",
      model: "text-embedding-custom",
      baseUrl: "https://embedding.example.test/v1",
      apiKey: "secret",
    });

    await expect(getUserEmbeddingRuntimeConfig("user-2")).resolves.toEqual({
      providerType: "cloud",
      cloud: {
        apiKey: "secret",
        baseURL: "https://embedding.example.test/v1",
        modelName: "text-embedding-custom",
      },
    });
  });

  it("falls back to system configuration when the user override is disabled", async () => {
    queryMocks.getUserEmbeddingSettingWithApiKey.mockResolvedValue({
      enabled: false,
      providerType: "local",
    });

    await expect(
      getUserEmbeddingRuntimeConfig("user-3"),
    ).resolves.toBeUndefined();
  });
});

describe("hasUserEmbeddingProviderConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearEnv();
  });

  afterEach(() => {
    clearEnv();
  });

  it("returns true for local mode even without any credentials", async () => {
    queryMocks.getUserEmbeddingSettingWithApiKey.mockResolvedValue(null);
    process.env.EMBEDDING_PROVIDER = "local";

    await expect(
      hasUserEmbeddingProviderConfig({ userId: "user-1", authToken: "jwt" }),
    ).resolves.toBe(true);
  });

  it("returns true when the user has a cloud setting with an API key", async () => {
    queryMocks.getUserEmbeddingSettingWithApiKey.mockResolvedValue({
      enabled: true,
      providerType: "cloud",
      model: "text-embedding-custom",
      baseUrl: "https://embedding.example.test/v1",
      apiKey: "user-key",
    });

    await expect(
      hasUserEmbeddingProviderConfig({ userId: "user-1", authToken: "jwt" }),
    ).resolves.toBe(true);
  });

  it("returns true when OPENROUTER_API_KEY is set and no user override", async () => {
    queryMocks.getUserEmbeddingSettingWithApiKey.mockResolvedValue(null);
    process.env.OPENROUTER_API_KEY = "sk-system-key";

    await expect(
      hasUserEmbeddingProviderConfig({ userId: "user-1", authToken: "jwt" }),
    ).resolves.toBe(true);
  });

  it("returns false when no DB setting, no env key, and only authToken is provided", async () => {
    queryMocks.getUserEmbeddingSettingWithApiKey.mockResolvedValue(null);

    // The user's session JWT is NOT a valid OpenRouter credential, so the
    // helper must not treat it as one — otherwise downstream calls hit
    // OpenRouter with an invalid Bearer and surface a misleading 401.
    await expect(
      hasUserEmbeddingProviderConfig({ userId: "user-1", authToken: "jwt" }),
    ).resolves.toBe(false);
  });

  it("returns false when there is no userId and no env key", async () => {
    await expect(
      hasUserEmbeddingProviderConfig({ authToken: "jwt" }),
    ).resolves.toBe(false);
  });
});
