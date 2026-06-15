/**
 * Shared embedding provider abstraction.
 *
 * The app should depend on this interface instead of coupling directly to a
 * specific cloud API or local model runtime.
 */

import {
  LocalTransformersEmbeddingProvider,
  type LocalTransformersEmbeddingProviderOptions,
} from "./local-transformers-embedding-provider";

const DEFAULT_CLOUD_EMBEDDING_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_CLOUD_EMBEDDING_MODEL = "text-embedding-3-small";
const DEFAULT_EMBEDDING_BATCH_SIZE = 10;

export type EmbeddingProviderType = "cloud" | "local";

export interface EmbeddingProvider {
  embedDocuments(texts: string[]): Promise<number[][]>;
  embedQuery(text: string): Promise<number[]>;
  getModelName(): string;
  getDimensions(): number | undefined;
}

export interface EmbeddingProviderFactoryOptions {
  userAuthToken?: string;
  providerType?: EmbeddingProviderType;
  cloud?: Omit<CloudEmbeddingProviderOptions, "userAuthToken">;
  local?: LocalTransformersEmbeddingProviderOptions;
}

export interface CloudEmbeddingProviderOptions {
  userAuthToken?: string;
  apiKey?: string;
  baseURL?: string;
  modelName?: string;
  batchSize?: number;
}

export function getConfiguredEmbeddingProvider(
  options: EmbeddingProviderFactoryOptions = {},
): EmbeddingProvider {
  const provider = options.providerType ?? getEmbeddingProviderType();

  if (provider === "local") {
    return new LocalTransformersEmbeddingProvider(options.local);
  }

  return new CloudEmbeddingProvider({
    ...options.cloud,
    userAuthToken: options.userAuthToken,
  });
}

export function getConfiguredEmbeddingModelName(
  options: EmbeddingProviderFactoryOptions = {},
): string {
  const provider = options.providerType ?? getEmbeddingProviderType();
  if (provider === "local") {
    return (
      options.local?.modelName ||
      process.env.LOCAL_EMBEDDING_MODEL ||
      "Xenova/all-MiniLM-L6-v2"
    ).trim();
  }

  return (
    options.cloud?.modelName ||
    process.env.LLM_EMBEDDING_MODEL ||
    DEFAULT_CLOUD_EMBEDDING_MODEL
  ).trim();
}

export function getEmbeddingProviderType(): EmbeddingProviderType {
  const provider = (process.env.EMBEDDING_PROVIDER || "cloud")
    .trim()
    .toLowerCase();

  return provider === "local" ? "local" : "cloud";
}

export class CloudEmbeddingProvider implements EmbeddingProvider {
  private apiKey: string;
  private modelName: string;
  private baseURL: string;
  private userAuthToken?: string;
  private batchSize: number;
  private dimensions?: number;

  constructor(options: CloudEmbeddingProviderOptions = {}) {
    this.apiKey =
      options.apiKey ||
      process.env.OPENAI_EMBEDDINGS_API_KEY ||
      process.env.OPENROUTER_API_KEY ||
      process.env.LLM_API_KEY ||
      "";

    this.userAuthToken = options.userAuthToken;
    this.modelName =
      options.modelName ||
      process.env.LLM_EMBEDDING_MODEL ||
      DEFAULT_CLOUD_EMBEDDING_MODEL;
    this.baseURL =
      options.baseURL ||
      process.env.LLM_EMBEDDING_BASE_URL ||
      DEFAULT_CLOUD_EMBEDDING_BASE_URL;
    this.baseURL = this.baseURL.replace(/\/+$/, "");
    this.batchSize = options.batchSize ?? getEmbeddingBatchSize();
  }

  getModelName(): string {
    return this.modelName;
  }

  getDimensions(): number | undefined {
    return this.dimensions;
  }

  async embedDocuments(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      throw new Error("No texts provided for embedding");
    }

    const results: number[][] = [];

    for (let i = 0; i < texts.length; i += this.batchSize) {
      const batch = texts.slice(i, i + this.batchSize);
      const batchEmbeddings = await this.callEmbeddingAPI(batch);
      results.push(...batchEmbeddings);
    }

    return results;
  }

  async embedQuery(text: string): Promise<number[]> {
    const embeddings = await this.callEmbeddingAPI([text]);
    return embeddings[0];
  }

  private async callEmbeddingAPI(texts: string[]): Promise<number[][]> {
    console.log("[RAG] Calling embeddings API:", {
      provider: "cloud",
      baseURL: this.baseURL,
      model: this.modelName,
      textCount: texts.length,
      hasApiKey: !!this.apiKey,
      hasUserAuthToken: !!this.userAuthToken,
    });

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;

      if (this.baseURL.includes("openrouter.ai")) {
        headers["HTTP-Referer"] =
          process.env.NEXT_PUBLIC_APP_URL || "https://openloomi.ai";
        headers["X-Title"] = "OpenLoomi AI";
      }
    } else if (this.userAuthToken) {
      headers.Authorization = `Bearer ${this.userAuthToken}`;
    } else {
      console.warn(
        `[RAG] No auth token available for embeddings API. This may cause request failures or use default rate limits. baseURL=${this.baseURL}, hasApiKey=${!!this.apiKey}`,
      );
    }

    const response = await fetch(`${this.baseURL}/embeddings`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: this.modelName,
        input: texts,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      const errorMessage = `Embeddings API error (${response.status}): ${errorText}`;
      throw new Error(errorMessage);
    }

    const data = await response.json();

    if (!data.data || !Array.isArray(data.data)) {
      throw new Error(
        "Invalid response format from embeddings API. Expected data.data array.",
      );
    }

    const sortedData = data.data.sort((a: any, b: any) => a.index - b.index);
    const embeddings = sortedData.map((item: any) => {
      if (!item.embedding || !Array.isArray(item.embedding)) {
        throw new Error("Invalid embedding format in response");
      }
      return item.embedding;
    });

    this.dimensions = embeddings[0]?.length ?? this.dimensions;
    return embeddings;
  }
}

function getEmbeddingBatchSize(): number {
  const rawBatchSize = process.env.LLM_EMBEDDING_BATCH_SIZE;
  if (!rawBatchSize) return DEFAULT_EMBEDDING_BATCH_SIZE;

  const parsedBatchSize = Number(rawBatchSize);
  if (!Number.isFinite(parsedBatchSize) || parsedBatchSize < 1) {
    console.warn(
      `[RAG] Invalid LLM_EMBEDDING_BATCH_SIZE=${rawBatchSize}; using ${DEFAULT_EMBEDDING_BATCH_SIZE}`,
    );
    return DEFAULT_EMBEDDING_BATCH_SIZE;
  }

  return Math.floor(parsedBatchSize);
}
