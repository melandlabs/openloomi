import { beforeEach, describe, expect, it, vi } from "vitest";

const queryMocks = vi.hoisted(() => ({
  getUserEmbeddingSettingWithApiKey: vi.fn(),
}));

vi.mock("@/lib/db/queries", () => queryMocks);

import { getUserEmbeddingRuntimeConfig } from "@/lib/ai/user-embedding-settings";

describe("user embedding settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
