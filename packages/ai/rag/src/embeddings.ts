/**
 * Embedding service with OpenRouter support and billing.
 * All configuration is read from environment variables.
 * The calling app is responsible for setting the appropriate env vars.
 * Uses lazy import of OpenAI SDK to avoid loading at module load time.
 */

import type OpenAI from "openai";
import { estimateTokens } from "@alloomi/shared";

const OPENROUTER_API_KEY =
  process.env.OPENROUTER_API_KEY || process.env.LLM_API_KEY;
const EMBEDDING_BASE_URL =
  process.env.LLM_EMBEDDING_BASE_URL || "https://openrouter.ai/api/v1";
const EMBEDDING_MODEL =
  process.env.LLM_EMBEDDING_MODEL || "openai/text-embedding-3-small";

// Pricing per 1M tokens (in USD)
const EMBEDDING_PRICING: Record<string, number> = {
  "openai/text-embedding-3-small": 0.02,
  "openai/text-embedding-3-large": 0.13,
  "openai/text-embedding-ada-002": 0.1,
};

// Embedding dimensions per model
const EMBEDDING_DIMENSIONS: Record<string, number> = {
  "openai/text-embedding-3-small": 1536,
  "openai/text-embedding-3-large": 3072,
  "openai/text-embedding-ada-002": 1536,
};

// Credit cost multiplier (converts USD to credits)
const CREDIT_COST_MULTIPLIER = 100; // 1 USD = 100 credits

// Lazy-loaded OpenAI client instance
let _openAIClient: OpenAI | null = null;

/**
 * Calculate credit cost for embedding generation
 */
function calculateCreditCost(model: string, tokenCount: number): number {
  const pricePerMillion = EMBEDDING_PRICING[model] || 0.02;
  const priceInUSD = (tokenCount / 1_000_000) * pricePerMillion;
  return Math.ceil(priceInUSD * CREDIT_COST_MULTIPLIER);
}

async function getOpenAIClient(): Promise<OpenAI> {
  if (_openAIClient) {
    return _openAIClient;
  }

  // Lazy import of OpenAI SDK
  const OpenAI = (await import("openai")).default;
  _openAIClient = new OpenAI({
    apiKey: OPENROUTER_API_KEY,
    baseURL: EMBEDDING_BASE_URL,
    defaultHeaders: {
      "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL || "https://alloomi.ai",
      "X-Title": "Alloomi AI",
    },
  });

  return _openAIClient;
}

export interface EmbeddingResult {
  embedding: number[];
  model: string;
  dimensions: number;
  tokensUsed: number;
  creditCost: number;
}

/**
 * Generate embedding for a single text with billing info
 */
export async function generateEmbedding(
  text: string,
): Promise<EmbeddingResult> {
  try {
    const openai = await getOpenAIClient();

    const estimatedTokens = estimateTokens(text);

    const response = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: text,
      encoding_format: "float",
    });

    const embedding = response.data[0].embedding;
    const actualTokens = response.usage?.total_tokens || estimatedTokens;
    const creditCost = calculateCreditCost(response.model, actualTokens);

    return {
      embedding,
      model: response.model,
      dimensions: embedding.length,
      tokensUsed: actualTokens,
      creditCost,
    };
  } catch (error) {
    console.error("Error generating embedding:", error);
    throw new Error(
      `Failed to generate embedding: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}

/**
 * Generate embeddings for multiple texts in batch with billing info
 */
export async function generateEmbeddings(texts: string[]): Promise<{
  results: EmbeddingResult[];
  totalTokensUsed: number;
  totalCreditCost: number;
}> {
  try {
    const batchSize = 100;
    const allResults: EmbeddingResult[] = [];

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const openai = await getOpenAIClient();

      const batchText = batch.join(" ");
      const estimatedTokens = estimateTokens(batchText);

      const response = await openai.embeddings.create({
        model: EMBEDDING_MODEL,
        input: batch,
        encoding_format: "float",
      });

      const actualTokens = response.usage?.total_tokens || estimatedTokens;
      const tokensPerEmbedding = Math.ceil(actualTokens / batch.length);
      const creditCostPerEmbedding = calculateCreditCost(
        response.model,
        tokensPerEmbedding,
      );

      const batchResults = response.data.map((item) => ({
        embedding: item.embedding,
        model: response.model,
        dimensions: item.embedding.length,
        tokensUsed: tokensPerEmbedding,
        creditCost: creditCostPerEmbedding,
      }));

      allResults.push(...batchResults);
    }

    const totalTokensUsed = allResults.reduce(
      (sum, r) => sum + r.tokensUsed,
      0,
    );
    const totalCreditCost = allResults.reduce(
      (sum, r) => sum + r.creditCost,
      0,
    );

    return {
      results: allResults,
      totalTokensUsed,
      totalCreditCost,
    };
  } catch (error) {
    console.error("Error generating embeddings:", error);
    throw new Error(
      `Failed to generate embeddings: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}

/**
 * Calculate cosine similarity between two vectors
 */
export function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length) {
    throw new Error("Vectors must have the same length");
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Get embedding dimensions
 */
export function getEmbeddingDimensions(): number {
  const override = process.env.LLM_EMBEDDING_DIMENSIONS;
  if (override) {
    const parsed = Number.parseInt(override, 10);
    if (!Number.isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return EMBEDDING_DIMENSIONS[EMBEDDING_MODEL] || 1536;
}

/**
 * Get embedding model name
 */
export function getEmbeddingModel(): string {
  return EMBEDDING_MODEL;
}

/**
 * Get pricing info for a model
 */
export function getModelPricing(model: string): number {
  return EMBEDDING_PRICING[model] || 0.02;
}
