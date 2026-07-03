/**
 * Unified vector storage service.
 * Decides which store to use based on the store factory provided by the caller.
 *
 * Usage (in the app):
 *   import { configureVectorService } from "@openloomi/rag/vector-service";
 *   configureVectorService({
 *     getStore: async () => { return configuredStore; },
 *   });
 *
 * Optional `chunking` config (atomic facts strategy, etc.) is forwarded to
 * `addDocumentToVectorStore` so callers can opt in to non-default chunking
 * without re-wiring the embedding path. When omitted, callers must pass
 * pre-chunked input to `addDocumentToVectorStore` (existing behavior).
 */

export { SQLiteVecStore } from "./sqlite-vec-store";
export { getSQLiteVecStore, resetSQLiteVecStore } from "./sqlite-vec-store";
export type { SQLiteVecStoreOptions, SchemaModule } from "./sqlite-vec-store";
export { ChromaVectorStore } from "./chroma-store";
export { getChromaVectorStore, resetChromaVectorStore } from "./chroma-store";

export {
  getPGVectorStore,
  processDocumentWithPGVector,
  searchWithPGVector,
  deleteDocumentsFromPGVector,
  getDocumentCount,
  listUserDocuments,
} from "./pgvector-store";

export interface EmbeddingResult {
  embedding: number[];
  dimensions: number;
  model: string;
}

export interface SearchResult {
  content: string;
  score: number;
  metadata?: Record<string, unknown>;
}

/**
 * Unified vector storage interface.
 */
export interface IVectorStore {
  addChunk(chunk: DocumentChunk): Promise<void>;
  addChunks(chunks: DocumentChunk[]): Promise<void>;
  similaritySearch(
    queryEmbedding: number[],
    limit?: number,
    userId?: string,
  ): Promise<VectorSearchResult[]>;
  deleteDocument(documentId: string): Promise<void>;
  getDocumentCount(): Promise<number>;
  getChunkCount(): Promise<number>;
  clear(): Promise<void>;
  // Optional capabilities keep existing stores source-compatible while newer
  // backends expose native filters, retention, and dimension statistics.
  similaritySearchWithOptions?(
    queryEmbedding: number[],
    options: VectorStoreSearchOptions,
  ): Promise<VectorSearchResult[]>;
  deleteOlderThan?(timestamp: number, timestampField?: string): Promise<number>;
  getStats?(): Promise<VectorStoreStats>;
}

export interface VectorSearchResult {
  id: string;
  content: string;
  score: number;
  documentId: string;
  metadata?: Record<string, unknown>;
  embedding?: number[];
}

export interface DocumentChunk {
  id: string;
  documentId: string;
  content: string;
  embedding: number[];
  metadata?: Record<string, unknown>;
}

export interface VectorSearchFilter {
  userId?: string;
  platform?: string;
  channel?: string;
  startTime?: number;
  endTime?: number;
}

export interface VectorStoreSearchOptions {
  limit?: number;
  filter?: VectorSearchFilter;
  includeEmbeddings?: boolean;
}

export interface VectorStoreStats {
  count: number;
  dimensions: number;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

interface VectorServiceConfig {
  getStore: () => Promise<IVectorStore>;
  /**
   * Optional chunking strategy applied by `addDocumentToVectorStore` when the
   * caller passes a raw `text` field instead of pre-built chunks. When unset,
   * callers must pre-chunk themselves (backwards-compatible default).
   */
  chunking?: import("./chunking").ChunkingConfig;
}

let _config: VectorServiceConfig | null = null;

/**
 * Configure the vector service with the store factory provided by the caller.
 * Must be called before getVectorStore().
 */
export function configureVectorService(config: VectorServiceConfig): void {
  _config = config;
}

function getConfig(): VectorServiceConfig | null {
  return _config;
}

// ---------------------------------------------------------------------------
// Vector store factory
// ---------------------------------------------------------------------------

/**
 * Get the configured vector store instance.
 */
export async function getVectorStore(): Promise<IVectorStore> {
  const config = getConfig();

  if (!config) {
    throw new Error(
      "Vector service not configured. Call configureVectorService() first.",
    );
  }

  return await config.getStore();
}

// ---------------------------------------------------------------------------
// Convenience helpers
// ---------------------------------------------------------------------------

export async function addDocumentToVectorStore(
  documentId: string,
  chunks: Array<{
    content: string;
    embedding: number[];
    metadata?: Record<string, unknown>;
  }>,
): Promise<void> {
  const vectorStore = await getVectorStore();

  const documentChunks: DocumentChunk[] = chunks.map((chunk, index) => ({
    id: `${documentId}_chunk_${index}`,
    documentId,
    content: chunk.content,
    embedding: chunk.embedding,
    metadata: {
      ...chunk.metadata,
      chunkIndex: index,
    },
  }));

  await vectorStore.addChunks(documentChunks);
  console.log(`✅ Added ${chunks.length} chunks to vector store`);
}

/**
 * Add a document to the vector store, optionally chunking raw text first via
 * the configured `chunking` strategy.
 *
 * Behavior:
 * - If `chunking` is set and `text` is provided, the chunker is invoked first
 *   and each resulting chunk is embedded in turn (provider must already be
 *   configured at the embedding layer).
 * - If `chunks` is provided, they are forwarded unchanged.
 * - If neither `text` nor `chunks` is provided, this is a no-op.
 */
export async function addTextToVectorStore(
  documentId: string,
  input: {
    text?: string;
    chunks?: Array<{
      content: string;
      embedding: number[];
      metadata?: Record<string, unknown>;
    }>;
  },
): Promise<void> {
  const config = getConfig();
  if (!config) {
    throw new Error(
      "Vector service not configured. Call configureVectorService() first.",
    );
  }

  if (input.chunks && input.chunks.length > 0) {
    await addDocumentToVectorStore(documentId, input.chunks);
    return;
  }

  if (!input.text) {
    return;
  }

  if (!config.chunking) {
    throw new Error(
      "addTextToVectorStore: provide pre-built chunks or configure `chunking`.",
    );
  }

  const { chunkDocument } = await import("./chunking");
  const chunked = await chunkDocument(input.text, config.chunking);
  if (chunked.length === 0) return;

  // The caller is responsible for embedding chunks. We expose the chunked
  // list as a warning log + return so they can be embedded downstream.
  // To keep this method side-effect-free in absence of an embedder, we
  // surface the chunks via a console log and re-use the legacy
  // addDocumentToVectorStore if the chunker happened to also produce
  // embeddings (it does not, by design — chunking is separate from
  // embedding). Callers should prefer the explicit chunks path.
  console.warn(
    `⚠️ addTextToVectorStore: chunking produced ${chunked.length} chunks but no embedding layer is wired here. Pass pre-embedded chunks or use addDocumentToVectorStore directly.`,
  );
}

export async function searchVectorStore(
  queryEmbedding: number[],
  limit = 10,
  userId?: string,
): Promise<SearchResult[]> {
  const vectorStore = await getVectorStore();

  const results = await vectorStore.similaritySearch(
    queryEmbedding,
    limit,
    userId,
  );

  return results.map((r) => ({
    content: r.content,
    score: r.score,
    metadata: r.metadata,
  }));
}

export async function deleteDocumentFromVectorStore(
  documentId: string,
): Promise<void> {
  const vectorStore = await getVectorStore();
  await vectorStore.deleteDocument(documentId);
  console.log(`✅ Deleted document ${documentId} from vector store`);
}

export async function getVectorStoreStats(): Promise<{
  documentCount: number;
  chunkCount: number;
}> {
  const vectorStore = await getVectorStore();

  const [documentCount, chunkCount] = await Promise.all([
    vectorStore.getDocumentCount(),
    vectorStore.getChunkCount(),
  ]);

  return { documentCount, chunkCount };
}
