/**
 * Unified vector storage service.
 * Decides which store to use based on the store factory provided by the caller.
 *
 * Usage (in the app):
 *   import { configureVectorService } from "@openloomi/rag/vector-service";
 *   configureVectorService({
 *     getStore: async () => { return configuredStore; },
 *   });
 */

export { SQLiteVecStore } from "./sqlite-vec-store";
export { getSQLiteVecStore, resetSQLiteVecStore } from "./sqlite-vec-store";

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
}

export interface VectorSearchResult {
  id: string;
  content: string;
  score: number;
  documentId: string;
  metadata?: Record<string, unknown>;
}

export interface DocumentChunk {
  id: string;
  documentId: string;
  content: string;
  embedding: number[];
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

interface VectorServiceConfig {
  getStore: () => Promise<IVectorStore>;
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
