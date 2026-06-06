/**
 * ChromaDB Vector Store.
 * Client-server vector search using ChromaDB's TypeScript client.
 */

import {
  ChromaClient,
  ChromaNotFoundError,
  IncludeEnum,
  type Where,
} from "chromadb";
import type {
  DocumentChunk,
  IVectorStore,
  VectorSearchFilter,
  VectorSearchResult,
  VectorStoreSearchOptions,
  VectorStoreStats,
} from "./vector-service";

type ChromaCollection = Awaited<
  ReturnType<InstanceType<typeof ChromaClient>["getOrCreateCollection"]>
>;

export interface ChromaVectorStoreOptions {
  url?: string;
  host?: string;
  port?: number;
  ssl?: boolean;
  collectionName?: string;
}

type ChromaMetadataValue = string | number | boolean | null;
type ChromaMetadata = Record<string, ChromaMetadataValue>;

const DEFAULT_CHROMA_URL = "http://localhost:8000";
const DEFAULT_COLLECTION_NAME = "openloomi_rag_chunks";

/**
 * Chroma-backed implementation of the shared vector store interface.
 */
export class ChromaVectorStore implements IVectorStore {
  private client: InstanceType<typeof ChromaClient>;
  private collectionName: string;
  private collection: ChromaCollection | null = null;

  constructor(options: ChromaVectorStoreOptions = {}) {
    const clientOptions = buildClientOptions(options);
    this.client = new ChromaClient(clientOptions);
    this.collectionName =
      options.collectionName ||
      process.env.CHROMA_COLLECTION ||
      DEFAULT_COLLECTION_NAME;
  }

  async addChunk(chunk: DocumentChunk): Promise<void> {
    await this.addChunks([chunk]);
  }

  async addChunks(chunks: DocumentChunk[]): Promise<void> {
    if (chunks.length === 0) return;

    const collection = await this.getCollection();

    await collection.upsert({
      ids: chunks.map((chunk) => chunk.id),
      embeddings: chunks.map((chunk) => chunk.embedding),
      documents: chunks.map((chunk) => chunk.content),
      metadatas: chunks.map((chunk) => this.toMetadata(chunk)),
    });
  }

  async similaritySearch(
    queryEmbedding: number[],
    limit = 10,
    userId?: string,
  ): Promise<VectorSearchResult[]> {
    return this.similaritySearchWithOptions(queryEmbedding, {
      limit,
      filter: userId ? { userId } : undefined,
    });
  }

  async similaritySearchWithOptions(
    queryEmbedding: number[],
    options: VectorStoreSearchOptions,
  ): Promise<VectorSearchResult[]> {
    const collection = await this.getCollection();
    // Embeddings are comparatively large, so request them only when the caller
    // explicitly needs to reuse or inspect the returned vectors.
    const include = [
      IncludeEnum.documents,
      IncludeEnum.metadatas,
      IncludeEnum.distances,
    ];
    if (options.includeEmbeddings) {
      include.push(IncludeEnum.embeddings);
    }

    const result = await collection.query({
      queryEmbeddings: [queryEmbedding],
      nResults: options.limit ?? 10,
      where: buildWhereFilter(options.filter),
      include,
    });

    const ids = result.ids?.[0] ?? [];
    const documents = result.documents?.[0] ?? [];
    const metadatas = result.metadatas?.[0] ?? [];
    const distances = result.distances?.[0] ?? [];
    const embeddings = result.embeddings?.[0] ?? [];

    return ids.map((id, index) => {
      const metadata = normalizeMetadata(metadatas[index]);
      return {
        id,
        content: documents[index] ?? "",
        score: distanceToScore(distances[index]),
        documentId: String(metadata.documentId ?? ""),
        metadata,
        embedding: embeddings[index] ?? undefined,
      };
    });
  }

  async deleteDocument(documentId: string): Promise<void> {
    const collection = await this.getCollection();

    await collection.delete({
      where: { documentId },
    });
  }

  async getDocumentCount(): Promise<number> {
    return await this.getChunkCount();
  }

  async getChunkCount(): Promise<number> {
    const collection = await this.getCollection();
    return await collection.count();
  }

  async deleteOlderThan(
    timestamp: number,
    timestampField = "timestamp",
  ): Promise<number> {
    const collection = await this.getCollection();
    const where: Where = {
      [timestampField]: { $lt: timestamp },
    };
    const matches = await collection.get({
      where,
      include: [],
    });

    // Chroma's delete result does not consistently expose a deleted count
    // across client/server versions, so collect matching IDs first.
    if (matches.ids.length === 0) {
      return 0;
    }

    await collection.delete({ ids: matches.ids });
    return matches.ids.length;
  }

  async getStats(): Promise<VectorStoreStats> {
    const collection = await this.getCollection();
    const count = await collection.count();
    if (count === 0) {
      return { count: 0, dimensions: 0 };
    }

    const sample = await collection.get({
      limit: 1,
      include: [IncludeEnum.embeddings],
    });
    return {
      count,
      dimensions: sample.embeddings[0]?.length ?? 0,
    };
  }

  async clear(): Promise<void> {
    try {
      await this.client.deleteCollection({ name: this.collectionName });
    } catch (error) {
      if (!isNotFoundError(error)) {
        throw error;
      }
    } finally {
      this.collection = null;
    }
  }

  private async getCollection(): Promise<ChromaCollection> {
    if (!this.collection) {
      this.collection = await this.client.getOrCreateCollection({
        name: this.collectionName,
        // OpenLoomi always supplies vectors explicitly. Disabling Chroma's
        // default embedding function avoids model downloads and dimension drift.
        embeddingFunction: null,
        metadata: {
          source: "@openloomi/rag",
          store: "chroma",
        },
      });
    }

    return this.collection;
  }

  private toMetadata(chunk: DocumentChunk): ChromaMetadata {
    return sanitizeMetadata({
      ...chunk.metadata,
      documentId: chunk.documentId,
    });
  }
}

function buildWhereFilter(filter?: VectorSearchFilter): Where | undefined {
  if (!filter) {
    return undefined;
  }

  const clauses: Where[] = [];
  if (filter.userId) clauses.push({ userId: filter.userId });
  if (filter.platform) clauses.push({ platform: filter.platform });
  if (filter.channel) clauses.push({ channel: filter.channel });
  if (filter.startTime !== undefined) {
    clauses.push({ timestamp: { $gte: filter.startTime } });
  }
  if (filter.endTime !== undefined) {
    clauses.push({ timestamp: { $lte: filter.endTime } });
  }

  if (clauses.length === 0) return undefined;
  if (clauses.length === 1) return clauses[0];
  return { $and: clauses };
}

let chromaVectorStoreInstance: ChromaVectorStore | null = null;

export function getChromaVectorStore(
  options: ChromaVectorStoreOptions = {},
): ChromaVectorStore {
  if (!chromaVectorStoreInstance) {
    chromaVectorStoreInstance = new ChromaVectorStore(options);
  }

  return chromaVectorStoreInstance;
}

export function resetChromaVectorStore(): void {
  chromaVectorStoreInstance = null;
}

function buildClientOptions(
  options: ChromaVectorStoreOptions,
): ConstructorParameters<typeof ChromaClient>[0] {
  const url = options.url || process.env.CHROMA_URL || DEFAULT_CHROMA_URL;

  if (options.host || options.port || options.ssl !== undefined) {
    return {
      host: options.host,
      port: options.port,
      ssl: options.ssl,
    };
  }

  const parsedUrl = new URL(url);

  return {
    host: parsedUrl.hostname,
    port: parsedUrl.port ? Number(parsedUrl.port) : undefined,
    ssl: parsedUrl.protocol === "https:",
  };
}

function sanitizeMetadata(metadata: Record<string, unknown>): ChromaMetadata {
  const sanitized: ChromaMetadata = {};

  for (const [key, value] of Object.entries(metadata)) {
    if (isChromaMetadataValue(value)) {
      sanitized[key] = value;
      continue;
    }

    if (value === undefined) {
      continue;
    }

    // Chroma accepts scalar metadata only; preserve structured values as JSON
    // instead of silently dropping useful application context.
    sanitized[key] = JSON.stringify(value);
  }

  return sanitized;
}

function normalizeMetadata(metadata: unknown): Record<string, unknown> {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return {};
  }

  return metadata as Record<string, unknown>;
}

function isChromaMetadataValue(value: unknown): value is ChromaMetadataValue {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

function distanceToScore(distance: number | null | undefined): number {
  if (typeof distance !== "number") return 0;
  // Convert a lower-is-better distance into a bounded higher-is-better score.
  return 1 / (1 + Math.max(0, distance));
}

function isNotFoundError(error: unknown): boolean {
  if (error instanceof ChromaNotFoundError) {
    return true;
  }
  if (!error || typeof error !== "object") return false;

  const name = "name" in error ? String(error.name) : "";
  const message = "message" in error ? String(error.message) : "";
  return /not.?found|does not exist|404/i.test(`${name} ${message}`);
}
