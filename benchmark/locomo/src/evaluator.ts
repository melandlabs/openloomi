/**
 * LoCoMo Evaluator for Memory System.
 *
 * Uses OpenLoomi's MemoryStorageAdapter interface with in-memory implementation
 * for benchmarking the memory system.
 */

import { generateText } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

const openrouter = createOpenAICompatible({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
  name: "openrouter",
});
import type { MemoryRecord, MemorySearchHit } from "./contracts.js";

import { RetrievalMode } from "./types.js";
import type { LoCoMoSample, EvaluationResult, Prediction } from "./types.js";
import { InMemoryStorageAdapter } from "./memory-adapter.js";
import { ANSWER_PROMPT } from "./prompts.js";
import { calculateMetrics, evaluateLLMJudge } from "./metrics.js";

/**
 * Calculate cosine similarity between two vectors.
 */
function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length) {
    return NaN;
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }

  if (normA === 0 || normB === 0) {
    return NaN;
  }

  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Universal embeddings class for text embedding using OpenRouter.
 */
class UniversalEmbeddings {
  private apiKey: string;
  private modelName: string;
  private baseURL: string;

  constructor() {
    this.apiKey =
      process.env.OPENAI_EMBEDDINGS_API_KEY ||
      process.env.OPENROUTER_API_KEY ||
      process.env.LLM_API_KEY ||
      "";

    this.modelName =
      process.env.LLM_EMBEDDING_MODEL || "text-embedding-3-small";
    this.baseURL =
      process.env.LLM_EMBEDDING_BASE_URL || "https://openrouter.ai/api/v1";
  }

  async embedDocuments(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      throw new Error("No texts provided for embedding");
    }

    const batchSize = 100;
    const results: number[][] = [];

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const batchEmbeddings = await this.callEmbeddingAPI(batch);
      results.push(...batchEmbeddings);
    }

    return results;
  }

  async embedQuery(text: string): Promise<number[]> {
    const embeddings = await this.callEmbeddingAPI([text]);
    return embeddings[0];
  }

  private async callEmbeddingAPI(texts: string[]): Promise<number[][]> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;

      if (this.baseURL.includes("openrouter.ai")) {
        headers["HTTP-Referer"] =
          process.env.NEXT_PUBLIC_APP_URL || "https://openloomi.ai";
        headers["X-Title"] = "openloomi AI";
      }
    }

    const response = await fetch(`${this.baseURL}/embeddings`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: this.modelName,
        input: texts,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Embeddings API error (${response.status}): ${errorText}`,
      );
    }

    const data = await response.json();

    if (!data.data || !Array.isArray(data.data)) {
      throw new Error("Invalid response format from embeddings API");
    }

    const sortedData = data.data.sort((a: any, b: any) => a.index - b.index);

    return sortedData.map((item: any) => {
      if (!item.embedding || !Array.isArray(item.embedding)) {
        throw new Error("Invalid embedding format in response");
      }
      return item.embedding;
    });
  }
}

/**
 * Format conversation data into memory records.
 */
function createMemoryRecordsFromDialog(
  sample: LoCoMoSample,
  embeddings: UniversalEmbeddings,
): MemoryRecord[] {
  const records: MemoryRecord[] = [];
  const speakerA = sample.conversation.speaker_a ?? "Speaker A";
  const speakerB = sample.conversation.speaker_b ?? "Speaker B";

  for (const key of Object.keys(sample.conversation).sort()) {
    if (!key.startsWith("session_") || key.endsWith("_date_time")) {
      continue;
    }

    const sessionNum = key.replace("session_", "");
    const datetimeKey = `session_${sessionNum}_date_time`;
    const sessionTimestamp = sample.conversation[datetimeKey] ?? "";
    const session = sample.conversation[key] as string[];

    const dialogParts: string[] = [];
    dialogParts.push(`# Conversation Session ${sessionNum}`);
    if (sessionTimestamp) {
      dialogParts.push(`# Timestamp: ${sessionTimestamp}`);
    }
    dialogParts.push(`# Speakers: ${speakerA}, ${speakerB}`);
    dialogParts.push("");

    for (const turn of session) {
      if (sessionTimestamp) {
        dialogParts.push(`[${sessionTimestamp}] ${turn}`);
      } else {
        dialogParts.push(turn);
      }
    }

    const content = dialogParts.join("\n");
    const id = `${sample.sample_id}_dialog_${sessionNum}`;

    records.push({
      id,
      userId: "benchmark_user",
      timestamp: parseTimestamp(sessionTimestamp) || Date.now(),
      text: content,
      tier: "long",
      dimensions: {
        sample_id: sample.sample_id,
        session_id: sessionNum,
        type: "dialog",
      },
      metadata: {
        sampleId: sample.sample_id,
        sessionId: sessionNum,
        contentType: "dialog",
      },
    });
  }

  return records;
}

/**
 * Format observation data into memory records.
 */
function createMemoryRecordsFromObservation(
  sample: LoCoMoSample,
): MemoryRecord[] {
  const records: MemoryRecord[] = [];

  for (const key of Object.keys(sample.observation).sort()) {
    if (!key.endsWith("_observation")) {
      continue;
    }

    const sessionNum = key.replace("_observation", "");
    const datetimeKey = `${sessionNum}_date_time`;
    const sessionTimestamp = sample.conversation[datetimeKey] ?? "";
    const obsContent = sample.observation[key];

    const obsParts: string[] = [];
    obsParts.push(`# Observation Summary ${sessionNum}`);
    if (sessionTimestamp) {
      obsParts.push(`# Timestamp: ${sessionTimestamp}`);
    }
    obsParts.push("");

    if (typeof obsContent === "object" && obsContent !== null) {
      for (const [speaker, text] of Object.entries(obsContent)) {
        obsParts.push(`${speaker}: ${text}`);
      }
    } else {
      obsParts.push(String(obsContent));
    }

    const content = obsParts.join("\n");
    const id = `${sample.sample_id}_observation_${sessionNum}`;

    records.push({
      id,
      userId: "benchmark_user",
      timestamp: parseTimestamp(sessionTimestamp) || Date.now(),
      text: content,
      tier: "long",
      dimensions: {
        sample_id: sample.sample_id,
        session_id: sessionNum,
        type: "observation",
      },
      metadata: {
        sampleId: sample.sample_id,
        sessionId: sessionNum,
        contentType: "observation",
      },
    });
  }

  return records;
}

/**
 * Format session summary data into memory records.
 */
function createMemoryRecordsFromSummary(sample: LoCoMoSample): MemoryRecord[] {
  const records: MemoryRecord[] = [];

  for (const key of Object.keys(sample.session_summary).sort()) {
    if (!key.endsWith("_summary")) {
      continue;
    }

    const sessionNum = key.replace("_summary", "");
    const datetimeKey = `${sessionNum}_date_time`;
    const sessionTimestamp = sample.conversation[datetimeKey] ?? "";
    const summaryContent = sample.session_summary[key];

    const summaryParts: string[] = [];
    summaryParts.push(`# Session Summary ${sessionNum}`);
    if (sessionTimestamp) {
      summaryParts.push(`# Timestamp: ${sessionTimestamp}`);
    }
    summaryParts.push("");

    if (typeof summaryContent === "object" && summaryContent !== null) {
      for (const [speaker, text] of Object.entries(summaryContent)) {
        summaryParts.push(`${speaker}: ${text}`);
      }
    } else {
      summaryParts.push(String(summaryContent));
    }

    const content = summaryParts.join("\n");
    const id = `${sample.sample_id}_summary_${sessionNum}`;

    records.push({
      id,
      userId: "benchmark_user",
      timestamp: parseTimestamp(sessionTimestamp) || Date.now(),
      text: content,
      tier: "long",
      dimensions: {
        sample_id: sample.sample_id,
        session_id: sessionNum,
        type: "session_summary",
      },
      metadata: {
        sampleId: sample.sample_id,
        sessionId: sessionNum,
        contentType: "session_summary",
      },
    });
  }

  return records;
}

/**
 * Parse timestamp string to Unix ms.
 */
function parseTimestamp(ts: string): number | undefined {
  if (!ts) return undefined;
  try {
    const date = new Date(ts);
    if (!isNaN(date.getTime())) {
      return date.getTime();
    }
    const parsed = Date.parse(ts);
    return isNaN(parsed) ? undefined : parsed;
  } catch {
    return undefined;
  }
}

/**
 * Search memory using semantic similarity.
 * Falls back to simple keyword matching if no embeddings available.
 */
function searchMemorySemantically(
  queryEmbedding: number[],
  records: MemoryRecord[],
  topK: number = 5,
): MemorySearchHit[] {
  // If we have embeddings, use cosine similarity
  const recordsWithEmbeddings = records.filter(
    (r) => r.embedding && r.embedding.length > 0,
  );

  if (recordsWithEmbeddings.length > 0 && queryEmbedding.length > 0) {
    const scored = recordsWithEmbeddings
      .map((record) => ({
        sourceType: "raw" as const,
        timestamp: record.timestamp,
        record,
        score: cosineSimilarity(queryEmbedding, record.embedding!),
      }))
      .filter((hit) => Number.isFinite(hit.score))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    return scored;
  }

  // Fallback: simple keyword matching
  return records.slice(0, topK).map((record) => ({
    sourceType: "raw" as const,
    timestamp: record.timestamp,
    record,
  }));
}

/**
 * Evaluator for LoCoMo benchmark using OpenLoomi Memory API.
 */
export class LoCoMoEvaluator {
  private retrievalMode: RetrievalMode;
  private embeddings: UniversalEmbeddings;
  private storage: InMemoryStorageAdapter;
  private apiKey?: string;

  constructor(
    retrievalMode: RetrievalMode | string = RetrievalMode.OBSERVATION,
    apiKey?: string,
  ) {
    // Convert string to enum if needed
    if (typeof retrievalMode === "string") {
      const modeMap: Record<string, RetrievalMode> = {
        dialog: RetrievalMode.DIALOG,
        observation: RetrievalMode.OBSERVATION,
        session_summary: RetrievalMode.SESSION_SUMMARY,
      };
      this.retrievalMode = modeMap[retrievalMode] || RetrievalMode.OBSERVATION;
    } else {
      this.retrievalMode = retrievalMode;
    }
    this.apiKey = apiKey;
    this.embeddings = new UniversalEmbeddings();
    this.storage = new InMemoryStorageAdapter();
  }

  /**
   * Load a LoCoMo sample into the memory system.
   */
  async loadSample(sample: LoCoMoSample): Promise<void> {
    this.storage.clear();

    // Build memory records based on retrieval mode
    let records: MemoryRecord[];

    if (this.retrievalMode === RetrievalMode.DIALOG) {
      records = createMemoryRecordsFromDialog(sample, this.embeddings);
    } else if (this.retrievalMode === RetrievalMode.OBSERVATION) {
      records = createMemoryRecordsFromObservation(sample);
    } else if (this.retrievalMode === RetrievalMode.SESSION_SUMMARY) {
      records = createMemoryRecordsFromSummary(sample);
    } else {
      records = [];
    }

    // Generate embeddings for all records (skip if embedding API fails)
    const texts = records.map((r) => r.text || "").filter(Boolean);
    try {
      if (texts.length > 0) {
        const vectors = await this.embeddings.embedDocuments(texts);

        for (let i = 0; i < records.length; i++) {
          if (texts[i]) {
            records[i].embedding = vectors[i];
            records[i].embeddingModel = "text-embedding-3-small";
            records[i].embeddingDimensions = vectors[i].length;
            records[i].embeddingUpdatedAt = Date.now();
          }
        }
        console.log(
          `[LoCoMo] Generated embeddings for ${texts.length} records`,
        );
      }
    } catch (error) {
      console.log(
        `[LoCoMo] Skipping embeddings (OpenRouter doesn't support embedding API)`,
      );
    }

    // Store in memory adapter
    for (const record of records) {
      this.storage.addRecord(record);
    }

    console.log(
      `[LoCoMo] Loaded ${records.length} records into memory (mode: ${this.retrievalMode})`,
    );
  }

  /**
   * Evaluate question answering on a LoCoMo sample.
   */
  async evaluateQA(sample: LoCoMoSample): Promise<EvaluationResult> {
    if (this.storage.recordCount === 0) {
      return {
        sample_id: sample.sample_id,
        retrieval_mode: this.retrievalMode,
        total_questions: sample.qa_pairs.length,
        correct_answers: 0,
        accuracy: 0,
        token_usage: {
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0,
        },
        predictions: [],
        error: "No records in storage",
      };
    }

    const predictions: Prediction[] = [];
    let correct = 0;
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;

    for (const qa of sample.qa_pairs) {
      try {
        // Query memory using semantic search
        const { response, promptTokens, completionTokens } =
          await this.queryMemory(qa.question);

        totalPromptTokens += promptTokens;
        totalCompletionTokens += completionTokens;

        // Evaluate answer correctness using LLM judge
        const isCorrect =
          (await evaluateLLMJudge(qa.question, qa.answer, response)) === 1;

        if (isCorrect) {
          correct++;
        }

        // Calculate additional metrics
        const metrics = calculateMetrics(response, qa.answer);

        predictions.push({
          question: qa.question,
          answer: qa.answer,
          response,
          prediction: response,
          ground_truth: qa.answer,
          category: String(qa.category),
          llm_score: isCorrect ? 1 : 0,
          correct: isCorrect,
          f1_score: metrics.f1,
          bleu_score: metrics.bleu1,
          bleu1: metrics.bleu1,
          bleu2: metrics.bleu2,
          bleu3: metrics.bleu3,
          bleu4: metrics.bleu4,
          evidence: qa.evidence,
        });
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        console.error(`Error evaluating question: ${errorMessage}`);

        predictions.push({
          question: qa.question,
          answer: qa.answer,
          response: `Error: ${errorMessage}`,
          prediction: `Error: ${errorMessage}`,
          ground_truth: qa.answer,
          category: String(qa.category),
          llm_score: 0,
          correct: false,
          f1_score: 0.0,
          bleu_score: 0.0,
          bleu1: 0.0,
          bleu2: 0.0,
          bleu3: 0.0,
          bleu4: 0.0,
          evidence: qa.evidence,
        });
      }
    }

    const total = sample.qa_pairs.length;

    return {
      sample_id: sample.sample_id,
      retrieval_mode: this.retrievalMode,
      total_questions: total,
      correct_answers: correct,
      accuracy: total > 0 ? correct / total : 0,
      token_usage: {
        prompt_tokens: totalPromptTokens,
        completion_tokens: totalCompletionTokens,
        total_tokens: totalPromptTokens + totalCompletionTokens,
      },
      predictions,
    };
  }

  /**
   * Query memory using LoCoMo's specialized answer prompt.
   */
  private async queryMemory(question: string): Promise<{
    response: string;
    promptTokens: number;
    completionTokens: number;
  }> {
    // Try to generate query embedding, fallback to empty if fails
    let queryEmbedding: number[] = [];
    try {
      queryEmbedding = await this.embeddings.embedQuery(question);
    } catch {
      console.log(
        "[LoCoMo] Query embedding skipped (OpenRouter doesn't support embedding API)",
      );
    }

    // Get all records from storage
    const result = await this.storage.queryRaw({
      userId: "benchmark_user",
      limit: 100,
    });

    // Search for relevant records using semantic similarity
    const hits = searchMemorySemantically(queryEmbedding, result.items, 5);

    // Build context from hits
    const context = hits
      .map((hit) => ("record" in hit ? hit.record.text : ""))
      .filter(Boolean)
      .join("\n\n---\n\n");

    // Format prompt with context
    const prompt = ANSWER_PROMPT.replace("{question}", question).replace(
      "{context}",
      context || "No relevant memories found.",
    );

    // Generate answer using LLM (use Qwen3.7-Max)
    const { usage, text } = await generateText({
      model: openrouter("qwen/qwen3.7-max"),
      prompt,
    });

    return {
      response: text,
      promptTokens:
        (usage as any).promptTokens ?? (usage as any).inputTokens ?? 0,
      completionTokens:
        (usage as any).completionTokens ?? (usage as any).outputTokens ?? 0,
    };
  }
}
