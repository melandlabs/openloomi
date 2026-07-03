/**
 * @openloomi/rag - RAG pipeline utilities: chunking, embeddings, and vector stores.
 */

export {
  chunkText,
  countTokens,
  getOptimalChunkSize,
  estimateChunkCount,
  chunkDocument,
} from "./chunking";
export type {
  ChunkOptions,
  TextChunk,
  ChunkingStrategy,
  ChunkingConfig,
  ChunkDocumentChunk,
} from "./chunking";

export {
  chunkAtomicFacts,
  type AtomicFactChunk,
  type AtomicFactProvider,
  type AtomicFactChunkerConfig,
} from "./atomic-fact-chunker";

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
  addTextToVectorStore,
  searchVectorStore,
  deleteDocumentFromVectorStore,
  getVectorStoreStats,
  configureVectorService,
  type IVectorStore,
  type SearchResult,
  type VectorSearchFilter,
  type VectorStoreSearchOptions,
  type VectorStoreStats,
} from "./vector-service";

export {
  UnifiedVectorSearchService,
  createVectorStore,
  type RawMessageWithEmbedding,
  type UnifiedVectorSearchResult,
  type UnifiedVectorSearchServiceOptions,
  type UnifiedVectorSearchStats,
  type VectorSearchByVectorOptions,
  type VectorSearchOptions,
  type VectorStoreConfig,
} from "./unified-vector-search-service";

export { UniversalEmbeddings } from "./universal-embeddings";
export {
  CloudEmbeddingProvider,
  getConfiguredEmbeddingModelName,
  getConfiguredEmbeddingProvider,
  getEmbeddingProviderType,
  type CloudEmbeddingProviderOptions,
  type EmbeddingProvider,
  type EmbeddingProviderFactoryOptions,
  type EmbeddingProviderType,
} from "./embedding-provider";
export {
  LocalTransformersEmbeddingProvider,
  type LocalTransformersEmbeddingProviderOptions,
} from "./local-transformers-embedding-provider";

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
  type SQLiteVecStoreOptions,
  type SchemaModule,
} from "./sqlite-vec-store";

export {
  ChromaVectorStore,
  getChromaVectorStore,
  resetChromaVectorStore,
} from "./chroma-store";

export {
  getPGVectorStore,
  processDocumentWithPGVector,
  searchWithPGVector,
  deleteDocumentsFromPGVector,
  getDocumentCount,
  listUserDocuments,
  configurePGVector,
} from "./pgvector-store";
