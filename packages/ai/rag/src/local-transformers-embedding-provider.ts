import type { EmbeddingProvider } from "./embedding-provider";

const DEFAULT_LOCAL_EMBEDDING_MODEL = "Xenova/all-MiniLM-L6-v2";
const DEFAULT_LOCAL_EMBEDDING_BATCH_SIZE = 8;
const DEFAULT_LOCAL_EMBEDDING_MAX_TOKENS = 512;
const DEFAULT_LOCAL_EMBEDDING_POOLING = "mean";
const DEFAULT_LOCAL_EMBEDDING_NORMALIZE = true;

type FeatureExtractionPipeline = (
  texts: string | string[],
  options?: {
    pooling?: LocalTransformersEmbeddingProviderOptions["pooling"];
    normalize?: boolean;
  },
) => Promise<unknown>;

export interface LocalTransformersEmbeddingProviderOptions {
  modelName?: string;
  batchSize?: number;
  cacheDir?: string;
  remoteHost?: string;
  device?: string;
  dtype?: string;
  localFilesOnly?: boolean;
  maxTokens?: number;
  pooling?: "none" | "mean" | "cls" | "first_token" | "eos" | "last_token";
  normalize?: boolean;
}

export class LocalTransformersEmbeddingProvider implements EmbeddingProvider {
  private modelName: string;
  private batchSize: number;
  private cacheDir?: string;
  private remoteHost?: string;
  private device?: string;
  private dtype?: string;
  private localFilesOnly: boolean;
  private maxTokens: number;
  private pooling: NonNullable<
    LocalTransformersEmbeddingProviderOptions["pooling"]
  >;
  private normalize: boolean;
  private dimensions?: number;
  private extractorPromise?: Promise<FeatureExtractionPipeline>;

  constructor(options: LocalTransformersEmbeddingProviderOptions = {}) {
    this.modelName =
      options.modelName ||
      process.env.LOCAL_EMBEDDING_MODEL ||
      DEFAULT_LOCAL_EMBEDDING_MODEL;
    this.batchSize = options.batchSize ?? getLocalEmbeddingBatchSize();
    this.cacheDir =
      options.cacheDir || process.env.LOCAL_EMBEDDING_CACHE_DIR || undefined;
    this.remoteHost =
      options.remoteHost ||
      process.env.LOCAL_EMBEDDING_REMOTE_HOST ||
      undefined;
    this.device =
      options.device || process.env.LOCAL_EMBEDDING_DEVICE || undefined;
    this.dtype =
      options.dtype || process.env.LOCAL_EMBEDDING_DTYPE || undefined;
    this.localFilesOnly =
      options.localFilesOnly ??
      process.env.LOCAL_EMBEDDING_LOCAL_ONLY === "true";
    this.maxTokens = options.maxTokens ?? getLocalEmbeddingMaxTokens();
    this.pooling = options.pooling || DEFAULT_LOCAL_EMBEDDING_POOLING;
    this.normalize = options.normalize ?? DEFAULT_LOCAL_EMBEDDING_NORMALIZE;
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
      const batchEmbeddings = await this.embedBatch(batch);
      results.push(...batchEmbeddings);
    }

    return results;
  }

  async embedQuery(text: string): Promise<number[]> {
    const embeddings = await this.embedBatch([text]);
    return embeddings[0];
  }

  private async embedBatch(texts: string[]): Promise<number[][]> {
    const extractor = await this.getExtractor();

    console.log("[RAG] Calling local embeddings provider:", {
      provider: "local-transformers",
      model: this.modelName,
      textCount: texts.length,
      pooling: this.pooling,
      normalize: this.normalize,
      device: this.device,
      dtype: this.dtype,
      maxTokens: this.maxTokens,
      remoteHost: this.remoteHost,
      localFilesOnly: this.localFilesOnly,
    });

    const output = await (extractor as any)(texts, {
      pooling: this.pooling,
      normalize: this.normalize,
    });
    const embeddings = tensorToEmbeddings(output, texts.length);

    this.dimensions = embeddings[0]?.length ?? this.dimensions;
    return embeddings;
  }

  private async getExtractor(): Promise<FeatureExtractionPipeline> {
    this.extractorPromise ??= this.createExtractor();
    return this.extractorPromise;
  }

  private async createExtractor(): Promise<FeatureExtractionPipeline> {
    const transformers = (await import("@huggingface/transformers")) as {
      env: { cacheDir: string; remoteHost: string };
      pipeline: (
        task: "feature-extraction",
        model: string,
        options: Record<string, unknown>,
      ) => Promise<FeatureExtractionPipeline>;
    };

    if (this.cacheDir) {
      transformers.env.cacheDir = this.cacheDir;
    }
    if (this.remoteHost) {
      transformers.env.remoteHost = this.remoteHost;
    }

    const extractor = await transformers.pipeline(
      "feature-extraction",
      this.modelName,
      {
        cache_dir: this.cacheDir,
        device: this.device as any,
        dtype: this.dtype as any,
        local_files_only: this.localFilesOnly,
      },
    );

    // Transformers.js feature-extraction always enables truncation, but relies
    // on tokenizer.model_max_length. Some ONNX exports advertise a tokenizer
    // limit larger than the model position embeddings, so clamp it explicitly.
    if ((extractor as any).tokenizer && this.maxTokens > 0) {
      (extractor as any).tokenizer.model_max_length = this.maxTokens;
    }

    return extractor;
  }
}

function tensorToEmbeddings(output: any, expectedCount: number): number[][] {
  const nested = typeof output?.tolist === "function" ? output.tolist() : null;

  if (Array.isArray(nested)) {
    return normalizeEmbeddingShape(nested, expectedCount);
  }

  if (output?.data && Array.isArray(output?.dims)) {
    const data = Array.from(output.data as ArrayLike<number>);
    const dims = output.dims as number[];

    if (dims.length === 2) {
      const [rows, columns] = dims;
      if (rows !== expectedCount) {
        throw new Error(
          `Local embedding output count mismatch. Expected ${expectedCount}, got ${rows}.`,
        );
      }
      return chunkFlatEmbeddingData(data, rows, columns);
    }
  }

  throw new Error(
    "Unsupported local embedding output format from Transformers.js.",
  );
}

function normalizeEmbeddingShape(
  value: unknown,
  expectedCount: number,
): number[][] {
  if (!Array.isArray(value)) {
    throw new Error("Invalid local embedding output: expected an array.");
  }

  if (expectedCount === 1 && value.every((item) => typeof item === "number")) {
    return [value as number[]];
  }

  if (value.length !== expectedCount) {
    throw new Error(
      `Local embedding output count mismatch. Expected ${expectedCount}, got ${value.length}.`,
    );
  }

  return value.map((item) => {
    if (
      !Array.isArray(item) ||
      !item.every((entry) => typeof entry === "number")
    ) {
      throw new Error("Invalid local embedding vector shape.");
    }
    return item as number[];
  });
}

function chunkFlatEmbeddingData(
  data: number[],
  rows: number,
  columns: number,
): number[][] {
  const results: number[][] = [];

  for (let row = 0; row < rows; row += 1) {
    results.push(data.slice(row * columns, (row + 1) * columns));
  }

  return results;
}

function getLocalEmbeddingBatchSize(): number {
  const rawBatchSize = process.env.LOCAL_EMBEDDING_BATCH_SIZE;
  if (!rawBatchSize) return DEFAULT_LOCAL_EMBEDDING_BATCH_SIZE;

  const parsedBatchSize = Number(rawBatchSize);
  if (!Number.isFinite(parsedBatchSize) || parsedBatchSize < 1) {
    console.warn(
      `[RAG] Invalid LOCAL_EMBEDDING_BATCH_SIZE=${rawBatchSize}; using ${DEFAULT_LOCAL_EMBEDDING_BATCH_SIZE}`,
    );
    return DEFAULT_LOCAL_EMBEDDING_BATCH_SIZE;
  }

  return Math.floor(parsedBatchSize);
}

function getLocalEmbeddingMaxTokens(): number {
  const rawMaxTokens = process.env.LOCAL_EMBEDDING_MAX_TOKENS;
  if (!rawMaxTokens) return DEFAULT_LOCAL_EMBEDDING_MAX_TOKENS;

  const parsedMaxTokens = Number(rawMaxTokens);
  if (!Number.isFinite(parsedMaxTokens) || parsedMaxTokens < 1) {
    console.warn(
      `[RAG] Invalid LOCAL_EMBEDDING_MAX_TOKENS=${rawMaxTokens}; using ${DEFAULT_LOCAL_EMBEDDING_MAX_TOKENS}`,
    );
    return DEFAULT_LOCAL_EMBEDDING_MAX_TOKENS;
  }

  return Math.floor(parsedMaxTokens);
}
