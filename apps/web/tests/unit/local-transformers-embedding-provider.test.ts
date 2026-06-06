import { beforeEach, describe, expect, it, vi } from "vitest";

const transformersMocks = vi.hoisted(() => {
  const extractor = vi.fn(async (texts: string | string[]) => {
    const items = Array.isArray(texts) ? texts : [texts];
    return {
      tolist: () => items.map((text, index) => [text.length, index + 1, 0]),
    };
  });
  Object.assign(extractor, {
    tokenizer: {
      model_max_length: 9999,
    },
  });

  return {
    extractor,
    pipeline: vi.fn(async () => extractor),
    env: {
      cacheDir: "",
      remoteHost: "",
    },
  };
});

vi.mock("@huggingface/transformers", () => transformersMocks);

import { LocalTransformersEmbeddingProvider } from "../../../../packages/ai/rag/src/local-transformers-embedding-provider";

describe("LocalTransformersEmbeddingProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    transformersMocks.env.cacheDir = "";
    transformersMocks.env.remoteHost = "";
    (
      transformersMocks.extractor as typeof transformersMocks.extractor & {
        tokenizer: { model_max_length: number };
      }
    ).tokenizer.model_max_length = 9999;
  });

  it("loads the configured local model once and embeds in batches", async () => {
    const provider = new LocalTransformersEmbeddingProvider({
      modelName: "local/test-model",
      batchSize: 2,
      cacheDir: "test-cache",
      remoteHost: "https://models.example.test",
      device: "cpu",
      dtype: "fp32",
      localFilesOnly: true,
      maxTokens: 128,
    });

    const embeddings = await provider.embedDocuments(["a", "bb", "ccc"]);

    expect(transformersMocks.pipeline).toHaveBeenCalledOnce();
    expect(transformersMocks.pipeline).toHaveBeenCalledWith(
      "feature-extraction",
      "local/test-model",
      {
        cache_dir: "test-cache",
        device: "cpu",
        dtype: "fp32",
        local_files_only: true,
      },
    );
    expect(transformersMocks.extractor).toHaveBeenCalledTimes(2);
    expect(embeddings).toEqual([
      [1, 1, 0],
      [2, 2, 0],
      [3, 1, 0],
    ]);
    expect(provider.getDimensions()).toBe(3);
    expect(transformersMocks.env.cacheDir).toBe("test-cache");
    expect(transformersMocks.env.remoteHost).toBe(
      "https://models.example.test",
    );
    expect(
      (
        transformersMocks.extractor as typeof transformersMocks.extractor & {
          tokenizer: { model_max_length: number };
        }
      ).tokenizer.model_max_length,
    ).toBe(128);
  });

  it("rejects an empty document batch", async () => {
    const provider = new LocalTransformersEmbeddingProvider();
    await expect(provider.embedDocuments([])).rejects.toThrow(
      "No texts provided for embedding",
    );
  });
});
