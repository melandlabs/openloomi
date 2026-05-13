/**
 * @openloomi/rag - RAG pipeline utilities: chunking, embeddings, and vector stores.
 */

export {
  chunkText,
  countTokens,
  getOptimalChunkSize,
  estimateChunkCount,
} from "./chunking";
export type { ChunkOptions, TextChunk } from "./chunking";

export {
  generateEmbedding,
  generateEmbeddings,
  cosineSimilarity,
  getEmbeddingDimensions,
  getEmbeddingModel,
  getModelPricing,
} from "./embeddings";
export type { EmbeddingResult } from "./embeddings";

export {
  getVectorStore,
  addDocumentToVectorStore,
  searchVectorStore,
  deleteDocumentFromVectorStore,
  getVectorStoreStats,
  configureVectorService,
  type IVectorStore,
  type SearchResult,
} from "./vector-service";

export { UniversalEmbeddings } from "./universal-embeddings";

export {
  TextLoader,
  AppleDocumentLoader,
  parseFile,
  parseFileToDocument,
  getPdfPageCount,
  shouldUseNativePdf,
  estimateChunkCount as ragEstimateChunkCount,
  isSupportedContentType,
  configureParsers,
  type FileContent,
  type ParsersConfig,
} from "./parsers";

export {
  SQLiteVecStore,
  getSQLiteVecStore,
  resetSQLiteVecStore,
  type VectorSearchResult,
  type DocumentChunk,
} from "./sqlite-vec-store";

export {
  getPGVectorStore,
  processDocumentWithPGVector,
  searchWithPGVector,
  deleteDocumentsFromPGVector,
  getDocumentCount,
  listUserDocuments,
  configurePGVector,
} from "./pgvector-store";
