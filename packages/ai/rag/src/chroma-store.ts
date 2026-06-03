/**
 * ChromaDB Vector Store.
 * Client-server vector search using ChromaDB's TypeScript client.
 */

import { ChromaClient } from "chromadb";
import type {
  DocumentChunk,
  IVectorStore,
  VectorSearchResult,
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
    const collection = await this.getCollection();

    const result = await collection.query({
      queryEmbeddings: [queryEmbedding],
      nResults: limit,
      where: userId ? { userId } : undefined,
    });

    const ids = result.ids?.[0] ?? [];
    const documents = result.documents?.[0] ?? [];
    const metadatas = result.metadatas?.[0] ?? [];
    const distances = result.distances?.[0] ?? [];

    return ids.map((id, index) => {
      const metadata = normalizeMetadata(metadatas[index]);
      return {
        id,
        content: documents[index] ?? "",
        score: distanceToScore(distances[index]),
        documentId: String(metadata.documentId ?? ""),
        metadata,
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
  return 1 / (1 + Math.max(0, distance));
}

function isNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;

  const message = "message" in error ? String(error.message) : "";
  return /not.?found|does not exist|404/i.test(message);
}
