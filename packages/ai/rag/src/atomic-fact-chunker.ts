/**
 * Atomic Facts Decomposition chunker.
 *
 * Splits a source document into individual atomic facts (single, self-contained
 * statements) using an `AtomicFactProvider`. Each resulting chunk is one atomic
 * fact with its source sentence and a confidence score in [0, 1].
 *
 * Use cases:
 * - Higher retrieval recall: queries match against a single fact rather than
 *   a multi-sentence paragraph, reducing embedding dilution.
 * - Cleaner evidence clustering: each chunk is a discrete proposition.
 *
 * Defaults:
 * - `maxFactsPerChunk`: 8 (cap facts returned per source document; protects
 *   against pathological LLM outputs).
 * - `minConfidence`: 0.5 (drop facts below this confidence).
 * - `fallbackStrategy`: "fixed" (when the provider throws, fall back to the
 *   built-in fixed-size chunker so ingestion never blocks on LLM errors).
 */

import { chunkText, type ChunkOptions } from "./chunking";

export interface AtomicFactChunk {
  /** Single atomic fact, normalized for embedding. */
  text: string;
  /** The source sentence the fact was extracted from. */
  sourceText: string;
  /** Confidence score in [0, 1]. */
  confidence: number;
  /** Optional metadata forwarded to the downstream vector store. */
  metadata?: Record<string, unknown>;
}

export interface AtomicFactProvider {
  /**
   * Decompose text into atomic facts. The provider is responsible for any
   * sentence segmentation; the chunker treats `text` as opaque input.
   */
  decompose(
    text: string,
  ): Promise<Array<{ fact: string; confidence: number; sourceText?: string }>>;
}

export interface AtomicFactChunkerConfig {
  provider: AtomicFactProvider;
  /** Max facts to keep per chunked document. Default 8. */
  maxFactsPerChunk?: number;
  /** Drop facts whose confidence is below this threshold. Default 0.5. */
  minConfidence?: number;
  /**
   * Behavior when `provider.decompose` throws or returns invalid output.
   * Default "fixed": fall back to `chunkText` with the provided `fallbackOptions`.
   */
  fallbackStrategy?: "fixed" | "throw";
  /** Options forwarded to the fixed chunker when falling back. */
  fallbackOptions?: ChunkOptions;
}

const DEFAULT_MAX_FACTS = 8;
const DEFAULT_MIN_CONFIDENCE = 0.5;
const FALLBACK_METADATA_TAG = "atomic_fact_fallback";

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function isValidAtomicFact(
  value: unknown,
): value is { fact: string; confidence: number; sourceText?: string } {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.fact !== "string") return false;
  if (typeof candidate.confidence !== "number") return false;
  return true;
}

function normalizeFact(
  raw: { fact: string; confidence: number; sourceText?: string },
  minConfidence: number,
  defaultSource: string,
): AtomicFactChunk | null {
  const fact = raw.fact.trim();
  if (fact.length === 0) return null;
  const confidence = clamp01(raw.confidence);
  if (confidence < minConfidence) return null;
  const sourceText = raw.sourceText?.trim() || defaultSource;
  return { text: fact, sourceText, confidence };
}

/**
 * Decompose `text` into atomic fact chunks.
 *
 * The function is defensive: an empty input returns `[]` without invoking the
 * provider. Provider errors fall back to `chunkText` (configurable) so the
 * downstream RAG pipeline can continue even when the LLM is unavailable.
 */
export async function chunkAtomicFacts(
  text: string,
  config: AtomicFactChunkerConfig,
): Promise<AtomicFactChunk[]> {
  const trimmed = text?.trim() ?? "";
  if (trimmed.length === 0) return [];

  const maxFacts = Math.max(1, config.maxFactsPerChunk ?? DEFAULT_MAX_FACTS);
  const minConfidence = clamp01(config.minConfidence ?? DEFAULT_MIN_CONFIDENCE);
  const fallbackStrategy = config.fallbackStrategy ?? "fixed";

  let rawFacts: Array<{
    fact: string;
    confidence: number;
    sourceText?: string;
  }>;
  try {
    rawFacts = await config.provider.decompose(trimmed);
  } catch (error) {
    if (fallbackStrategy === "throw") throw error;
    return fallbackFixed(trimmed, config, error);
  }

  if (!Array.isArray(rawFacts)) {
    if (fallbackStrategy === "throw") {
      throw new TypeError("AtomicFactProvider returned a non-array result");
    }
    return fallbackFixed(trimmed, config, new TypeError("non-array result"));
  }

  const out: AtomicFactChunk[] = [];
  for (const raw of rawFacts) {
    if (!isValidAtomicFact(raw)) continue;
    const normalized = normalizeFact(raw, minConfidence, trimmed);
    if (normalized) out.push(normalized);
    if (out.length >= maxFacts) break;
  }

  // If the LLM returned nothing usable, fall back so callers always get at
  // least one chunk (empty chunks break similarity search silently).
  if (out.length === 0) {
    return fallbackFixed(trimmed, config, undefined);
  }

  return out;
}

function fallbackFixed(
  text: string,
  config: AtomicFactChunkerConfig,
  error: unknown,
): AtomicFactChunk[] {
  const reason =
    error instanceof Error
      ? `${error.name}: ${error.message}`
      : "unknown provider error";
  const chunks = chunkText(text, config.fallbackOptions ?? {});
  return chunks.map((chunk) => ({
    text: chunk.content,
    sourceText: chunk.content,
    confidence: 0,
    metadata: {
      [FALLBACK_METADATA_TAG]: true,
      fallbackReason: reason,
    },
  }));
}
