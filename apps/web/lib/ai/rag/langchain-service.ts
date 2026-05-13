/**
 * LangChain-based RAG service with pgvector and billing support
 * Uses OpenRouter embeddings with user quota tracking
 */

import { db } from "@/lib/db";
import {
  ragDocuments,
  ragChunks,
  type InsertRAGDocument,
  type InsertRAGChunk,
} from "@/lib/db/schema";
import { eq, desc, sql, inArray, asc } from "drizzle-orm";
import { parseFile } from "@/lib/files/parsers";
import { randomUUID } from "node:crypto";
import { isTauriMode } from "@/lib/env";
import { estimateTokens } from "@/lib/ai";
import { UniversalEmbeddings } from "@openloomi/rag/universal-embeddings";

// Re-export for consumers of langchain-service
export { UniversalEmbeddings };

// Initialize embeddings with universal provider (OpenAI or OpenRouter)
const getEmbeddings = (authToken?: string) => {
  return new UniversalEmbeddings(authToken);
};

// Initialize text splitter
const getTextSplitter = async () => {
  const { RecursiveCharacterTextSplitter } =
    await import("@langchain/textsplitters");
  return new RecursiveCharacterTextSplitter({
    chunkSize: 1000,
    chunkOverlap: 200,
    separators: ["\n\n", "\n", " ", ""],
  });
};

// Embedding pricing per 1M tokens (in USD)
const EMBEDDING_PRICING: Record<string, number> = {
  "openai/text-embedding-3-small": 0.02,
  "openai/text-embedding-3-large": 0.13,
  "openai/text-embedding-ada-002": 0.1,
};

// Credit cost multiplier (converts USD to credits)
const CREDIT_COST_MULTIPLIER = 100; // 1 USD = 100 credits

// estimateTokens is imported from @/lib/ai/tokens for CJK-aware token estimation

/**
 * Calculate credit cost for embedding generation
 */
function calculateCreditCost(model: string, tokenCount: number): number {
  const modelName = model.replace("openai/", "");
  const pricePerMillion = EMBEDDING_PRICING[modelName] || 0.02;
  const priceInUSD = (tokenCount / 1_000_000) * pricePerMillion;
  return Math.ceil(priceInUSD * CREDIT_COST_MULTIPLIER);
}

export interface ProcessDocumentOptions {
  chunkSize?: number;
  chunkOverlap?: number;
  blobPath?: string; // Path to original binary file (for workspace export)
  skipEmbeddings?: boolean; // Skip embeddings generation and storage (for text-only storage)
}

export interface ProcessDocumentResult {
  documentId: string;
  chunksCount: number;
  totalTokensUsed: number;
  totalCreditCost: number;
}

export interface SearchResult {
  chunkId: string;
  documentId: string;
  documentName: string;
  content: string;
  similarity: number;
  chunkIndex: number;
}

export interface SearchOptions {
  limit?: number;
  threshold?: number; // Minimum similarity score (0-1)
  documentIds?: string[]; // Optional: filter to specific document IDs
}

/**
 * Process a document and store it with embeddings in the database
 * Includes quota deduction for embeddings generation
 */
export async function processDocument(
  userId: string,
  userType: string,
  fileName: string,
  contentType: string,
  content: string,
  options: ProcessDocumentOptions = {},
  authToken?: string, // User's JWT token for authentication in local mode
): Promise<ProcessDocumentResult> {
  console.log("[RAG] processDocument started for file:", fileName);

  // 1. Create LangChain document (dynamic import to reduce memory)
  const { Document } = await import("@langchain/core/documents");
  const doc = new Document({
    pageContent: content,
    metadata: {
      fileName,
      contentType,
    },
  });

  // 2. Split text into chunks using LangChain
  console.log("[RAG] Splitting document into chunks...");
  const splitter = await getTextSplitter();
  const chunks = await splitter.splitDocuments([doc]);
  console.log("[RAG] Document split into", chunks.length, "chunks");

  if (chunks.length === 0) {
    throw new Error("Failed to chunk document content");
  }

  // 3. Estimate tokens and calculate credit cost BEFORE generating embeddings
  const embeddings = getEmbeddings(authToken);
  const chunkTexts = chunks.map((c: any) => c.pageContent);
  const totalText = chunkTexts.join(" ");
  const estimatedTokens = options.skipEmbeddings
    ? 0
    : estimateTokens(totalText);
  const estimatedCreditCost = options.skipEmbeddings
    ? 0
    : calculateCreditCost(
        process.env.LLM_EMBEDDING_MODEL || "openai/text-embedding-3-small",
        estimatedTokens,
      );

  // 5. Generate embeddings for all chunks using LangChain
  let embeddingVectors: number[][] | null = null;
  if (!options.skipEmbeddings) {
    console.log(
      "[RAG] Calling embeddings API for",
      chunkTexts.length,
      "chunks...",
    );
    try {
      embeddingVectors = await embeddings.embedDocuments(chunkTexts);
      console.log(
        "[RAG] Embeddings generated successfully, shape:",
        embeddingVectors.length,
        "x",
        embeddingVectors[0]?.length,
      );
    } catch (error) {
      console.error("[RAG] Embeddings generation failed:", error);
      console.error(
        "[RAG] Model:",
        process.env.LLM_EMBEDDING_MODEL || "openai/text-embedding-3-small",
      );
      console.error("[RAG] Chunk count:", chunkTexts.length);
      throw new Error(
        `Failed to generate embeddings: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (embeddingVectors.length !== chunks.length) {
      throw new Error(
        `Mismatch: ${embeddingVectors.length} embeddings for ${chunks.length} chunks`,
      );
    }
  } else {
    console.log("[RAG] Skipping embeddings generation (skipEmbeddings=true)");
  }

  // 6. Create document record
  const documentData: InsertRAGDocument = {
    id: randomUUID(),
    userId,
    fileName,
    contentType,
    sizeBytes: Buffer.byteLength(content, "utf8"),
    totalChunks: chunks.length,
    blobPath: options.blobPath, // Store path to original binary file
  };

  const [document] = await db
    .insert(ragDocuments)
    .values(documentData)
    .returning();

  if (!document) {
    throw new Error("Failed to create document record");
  }

  // 7. Insert chunks with pgvector embeddings
  const chunkData: InsertRAGChunk[] = chunks.map(
    (chunk: any, index: number) => {
      if (embeddingVectors) {
        const embeddingArray = embeddingVectors[index];
        const embeddingString = `[${embeddingArray.join(",")}]`;
        return {
          id: randomUUID(),
          documentId: document.id,
          userId,
          chunkIndex: index,
          content: chunk.pageContent,
          embedding: embeddingString,
        };
      }
      // skipEmbeddings mode: store null embedding
      return {
        id: randomUUID(),
        documentId: document.id,
        userId,
        chunkIndex: index,
        content: chunk.pageContent,
        embedding: null,
      };
    },
  );

  // Batch insert chunks to avoid SQLite "too many SQL variables" limit
  const BATCH_SIZE = 1000;
  for (let i = 0; i < chunkData.length; i += BATCH_SIZE) {
    const batch = chunkData.slice(i, i + BATCH_SIZE);
    await db.insert(ragChunks).values(batch);
  }

  return {
    documentId: document.id,
    chunksCount: chunks.length,
    totalTokensUsed: estimatedTokens,
    totalCreditCost: estimatedCreditCost,
  };
}

/**
 * Process a document from file buffer with billing
 */
export async function processDocumentFromFile(
  userId: string,
  userType: string,
  fileName: string,
  contentType: string,
  buffer: Buffer,
  options: ProcessDocumentOptions = {},
  authToken?: string, // User's JWT token for authentication in local mode
): Promise<ProcessDocumentResult> {
  // Parse file to extract text (pass authToken for image processing)
  const { text: content } = await parseFile(buffer, contentType, authToken);

  // Process the extracted text
  return processDocument(
    userId,
    userType,
    fileName,
    contentType,
    content,
    options,
    authToken,
  );
}

/**
 * Search for similar chunks using pgvector cosine similarity
 * Uses HNSW index for fast approximate nearest neighbor search
 */
export async function searchSimilarChunks(
  userId: string,
  query: string,
  options: SearchOptions = {},
  authToken?: string, // User's JWT token for authentication in local mode
): Promise<SearchResult[]> {
  const { limit = 5, threshold = 0.7, documentIds } = options;

  // 1. Generate embedding for query
  const embeddings = getEmbeddings(authToken);
  const queryEmbedding = await embeddings.embedQuery(query);

  // Convert embedding to pgvector format string
  const embeddingString = `[${queryEmbedding.join(",")}]`;

  // 2. Build the where clause
  // Always filter by userId, and optionally filter by specific document IDs
  const whereConditions = [eq(ragChunks.userId, userId)];

  if (documentIds && documentIds.length > 0) {
    whereConditions.push(inArray(ragChunks.documentId, documentIds));
  }

  // 3. Check if running in Tauri (SQLite) mode
  if (isTauriMode()) {
    // SQLite mode: simplified version without vector similarity search
    // Directly return latest chunks (sorted by chunkIndex)
    console.log(
      "[RAG] Using SQLite mode - simplified search without vector similarity",
    );

    const results = await db
      .select({
        chunkId: ragChunks.id,
        documentId: ragChunks.documentId,
        documentName: ragDocuments.fileName,
        content: ragChunks.content,
        // Return fixed similarity in SQLite mode
        similarity: sql`1.0`,
        chunkIndex: ragChunks.chunkIndex,
      })
      .from(ragChunks)
      .innerJoin(ragDocuments, eq(ragChunks.documentId, ragDocuments.id))
      .where(
        whereConditions.length === 1
          ? whereConditions[0]
          : sql.join(whereConditions, sql` AND `),
      )
      .orderBy(asc(ragChunks.chunkIndex))
      .limit(limit);

    // Format results
    const formattedResults = results.map((r: any) => ({
      chunkId: r.chunkId,
      documentId: r.documentId,
      documentName: r.documentName,
      content: r.content,
      similarity: 1.0, // Fixed similarity in SQLite mode
      chunkIndex: r.chunkIndex,
    }));

    return formattedResults;
  }

  // PostgreSQL mode: Use pgvector to find similar chunks with HNSW index
  // This uses the <=> operator for cosine distance (lower is better)
  const results = await db
    .select({
      chunkId: ragChunks.id,
      documentId: ragChunks.documentId,
      documentName: ragDocuments.fileName,
      content: ragChunks.content,
      // Convert cosine distance to similarity (1 - distance)
      // Cast both text fields to vector type for the <=> operator
      similarity: sql`1 - (${ragChunks.embedding}::vector <=> ${embeddingString}::vector)`,
      chunkIndex: ragChunks.chunkIndex,
    })
    .from(ragChunks)
    .innerJoin(ragDocuments, eq(ragChunks.documentId, ragDocuments.id))
    .where(
      whereConditions.length === 1
        ? whereConditions[0]
        : sql.join(whereConditions, sql` AND `),
    )
    .orderBy(sql`${ragChunks.embedding}::vector <=> ${embeddingString}::vector`)
    .limit(limit);

  // 3. Filter by threshold and format results
  const formattedResults = results
    .filter((r: any) => {
      const similarity = Number(r.similarity);
      return similarity >= threshold;
    })
    .map((r: any) => ({
      chunkId: r.chunkId,
      documentId: r.documentId,
      documentName: r.documentName,
      content: r.content,
      similarity: Number(r.similarity),
      chunkIndex: r.chunkIndex,
    }));

  return formattedResults;
}

/**
 * Get document by ID
 */
export async function getDocument(documentId: string) {
  const [document] = await db
    .select()
    .from(ragDocuments)
    .where(eq(ragDocuments.id, documentId))
    .limit(1);

  return document;
}

/**
 * Get all documents for a user
 */
export async function getUserDocuments(userId: string) {
  return db
    .select()
    .from(ragDocuments)
    .where(eq(ragDocuments.userId, userId))
    .orderBy(desc(ragDocuments.uploadedAt));
}

/**
 * Get chunks for a document
 */
export async function getDocumentChunks(documentId: string) {
  return db
    .select()
    .from(ragChunks)
    .where(eq(ragChunks.documentId, documentId))
    .orderBy(ragChunks.chunkIndex);
}

/**
 * Get full text content of a document by concatenating all chunks
 * Useful for small documents where you want to provide complete content to LLM
 */
export async function getDocumentFullContent(documentId: string): Promise<{
  documentId: string;
  content: string;
  totalChunks: number;
}> {
  const chunks = await getDocumentChunks(documentId);

  if (chunks.length === 0) {
    throw new Error(`No chunks found for document ${documentId}`);
  }

  // Concatenate all chunks in order
  const fullContent = chunks.map((chunk: any) => chunk.content).join("\n\n");

  return {
    documentId,
    content: fullContent,
    totalChunks: chunks.length,
  };
}

/**
 * Delete a document and all its chunks
 */
export async function deleteDocument(documentId: string): Promise<void> {
  await db.delete(ragChunks).where(eq(ragChunks.documentId, documentId));
  await db.delete(ragDocuments).where(eq(ragDocuments.id, documentId));
}

/**
 * Delete all documents for a user
 */
export async function deleteUserDocuments(userId: string): Promise<void> {
  await db.delete(ragChunks).where(eq(ragChunks.userId, userId));
}

/**
 * Get statistics for a user's RAG documents
 */
export async function getUserRAGStats(userId: string) {
  const documents = await getUserDocuments(userId);

  const totalDocuments = documents.length;
  const totalChunks = documents.reduce(
    (sum: number, doc: any) => sum + (doc.totalChunks || 0),
    0,
  );
  const totalSize = documents.reduce(
    (sum: number, doc: any) => sum + Number(doc.sizeBytes || 0),
    0,
  );

  return {
    totalDocuments,
    totalChunks,
    totalSize,
    documents: documents.map((doc: any) => ({
      id: doc.id,
      fileName: doc.fileName,
      contentType: doc.contentType,
      sizeBytes: Number(doc.sizeBytes),
      totalChunks: doc.totalChunks,
      uploadedAt: doc.uploadedAt,
    })),
  };
}

/**
 * Format search results for LLM context
 */
export function formatSearchResultsForLLM(results: SearchResult[]): string {
  if (results.length === 0) {
    return "No relevant information found in the strategy memory.";
  }

  const formatted = results
    .map(
      (result) =>
        `[Document: ${result.documentName} (Chunk ${result.chunkIndex + 1}, Similarity: ${(result.similarity * 100).toFixed(1)}%)]\n${result.content}`,
    )
    .join("\n\n---\n\n");

  return `Relevant information from strategy memory:\n\n${formatted}`;
}

/**
 * Process insight settings and store them as a knowledge base document
 * This allows the AI to reference user's personalization settings when answering questions
 */
export async function processInsightSettingsToKnowledgeBase(
  userId: string,
  userType: string,
  focusPeople: string[],
  focusTopics: string[],
  additionalSettings?: {
    language?: string;
    refreshIntervalMinutes?: number;
    roles?: string[];
    userName?: string;
    industries?: string[];
    workDescription?: string;
    aiSoulPrompt?: string;
  },
  authToken?: string, // User's JWT token for authentication in local mode
): Promise<string | null> {
  console.log("[RAG] Processing insight settings to knowledge base");

  // Build content document with all personalization information
  const contentParts: string[] = [];

  // User Profile Section
  if (additionalSettings?.userName) {
    contentParts.push("# User Personal Information");
    contentParts.push(`User Name: ${additionalSettings.userName}`);
    contentParts.push("");
  }

  // AI Soul Definition Section (added before other settings as it's high priority)
  if (additionalSettings?.aiSoulPrompt) {
    contentParts.push("# AI Soul Definition");
    contentParts.push("User-defined AI Soul Prompt:");
    contentParts.push(additionalSettings.aiSoulPrompt);
    contentParts.push("");
  }

  // Language and Refresh Settings
  if (
    additionalSettings?.language ||
    additionalSettings?.refreshIntervalMinutes
  ) {
    contentParts.push("# Basic Settings");
    if (additionalSettings.language) {
      contentParts.push(`Language Preference: ${additionalSettings.language}`);
    }
    if (additionalSettings.refreshIntervalMinutes) {
      contentParts.push(
        `Refresh Frequency: ${additionalSettings.refreshIntervalMinutes} minutes`,
      );
    }
    contentParts.push("");
  }

  // Roles Section
  if (additionalSettings?.roles && additionalSettings.roles.length > 0) {
    contentParts.push("# User Role");
    contentParts.push(`User's Professional Role:`);
    additionalSettings.roles.forEach((role, index) => {
      contentParts.push(`${index + 1}. ${role}`);
    });
    contentParts.push("");
  }

  // Identity Section
  if (
    additionalSettings?.industries &&
    additionalSettings.industries.length > 0
  ) {
    contentParts.push("# Identity Information");
    contentParts.push(`User's Industry:`);
    additionalSettings.industries.forEach((industry, index) => {
      contentParts.push(`${index + 1}. ${industry}`);
    });
    contentParts.push("");
  }

  if (additionalSettings?.workDescription) {
    if (
      !additionalSettings?.industries ||
      additionalSettings.industries.length === 0
    ) {
      contentParts.push("# Identity Information");
    }
    contentParts.push("Job Description:");
    contentParts.push(additionalSettings.workDescription);
    contentParts.push("");
  }

  // Focus People Section
  if (focusPeople.length > 0) {
    contentParts.push("# Focus People");
    contentParts.push("The user particularly focuses on the following people:");
    focusPeople.forEach((person, index) => {
      contentParts.push(`${index + 1}. ${person}`);
    });
    contentParts.push("");
  }

  // Focus Topics Section
  if (focusTopics.length > 0) {
    contentParts.push("# Focus Topics");
    contentParts.push(
      "The user particularly focuses on the following topics and requirements:",
    );
    focusTopics.forEach((topic, index) => {
      contentParts.push(`${index + 1}. ${topic}`);
    });
    contentParts.push("");
  }

  const content = contentParts.join("\n");

  // Only process if there's content to store
  if (content.trim().length === 0) {
    console.log("[RAG] No insight settings to store");
    return null;
  }

  try {
    // Use a special document name for insight settings
    const fileName = "memory.txt";
    const contentType = "text/plain";

    // Check if a document with this name already exists
    const existingDocs = await getUserDocuments(userId);
    const existingDoc = existingDocs.find((d: any) => d.fileName === fileName);

    // If it exists, delete it first (to update with new content)
    if (existingDoc) {
      console.log("[RAG] Updating existing insight settings document");
      await deleteDocument(existingDoc.id);
    }

    // Process the document
    const result = await processDocument(
      userId,
      userType,
      fileName,
      contentType,
      content,
      {},
      authToken,
    );

    console.log("[RAG] Insight settings stored in knowledge base:", {
      documentId: result.documentId,
      chunksCount: result.chunksCount,
    });

    return result.documentId;
  } catch (error) {
    console.error("[RAG] Failed to process insight settings:", error);
    // Don't throw - this is a non-critical operation
    return null;
  }
}

/**
 * Delete insight settings document from knowledge base
 */
export async function deleteInsightSettingsFromKnowledgeBase(
  userId: string,
): Promise<void> {
  console.log("[RAG] Deleting insight settings from knowledge base");

  const existingDocs = await getUserDocuments(userId);
  const insightDoc = existingDocs.find((d: any) => d.fileName === "memory.txt");

  if (insightDoc) {
    await deleteDocument(insightDoc.id);
    console.log("[RAG] Insight settings document deleted");
  }
}
