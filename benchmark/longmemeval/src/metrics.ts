/**
 * Evaluation metrics for LongMemEval benchmark.
 *
 * Includes LLM judge, BLEU, F1 score, and other metrics.
 */

import { generateText } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

const openrouter = createOpenAICompatible({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
  name: "openrouter",
});
import { LLM_JUDGE_PROMPT } from "./prompts";

/**
 * Calculate F1 score between prediction and ground truth.
 */
export function calculateF1Score(
  prediction: string,
  groundTruth: string,
): number {
  if (!prediction || !groundTruth) {
    return 0.0;
  }

  // Tokenize
  const predTokens = new Set(prediction.toLowerCase().split(/\s+/));
  const gtTokens = new Set(String(groundTruth).toLowerCase().split(/\s+/));

  if (predTokens.size === 0 || gtTokens.size === 0) {
    return 0.0;
  }

  // Calculate precision, recall, F1
  const commonTokens = new Set([...predTokens].filter((x) => gtTokens.has(x)));
  const precision = commonTokens.size / predTokens.size;
  const recall = commonTokens.size / gtTokens.size;

  if (precision + recall === 0) {
    return 0.0;
  }

  const f1 = (2 * precision * recall) / (precision + recall);
  return f1;
}

/**
 * Calculate BLEU scores between prediction and ground truth.
 * Uses a pure JavaScript implementation with n-gram precision.
 */
export function calculateBLEUScores(
  prediction: string,
  groundTruth: string,
): { bleu1: number; bleu2: number; bleu3: number; bleu4: number } {
  if (!prediction || !groundTruth) {
    return { bleu1: 0.0, bleu2: 0.0, bleu3: 0.0, bleu4: 0.0 };
  }

  // Tokenize by whitespace
  const predTokens = prediction
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 0);
  const gtTokens = String(groundTruth)
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 0);

  if (predTokens.length === 0 || gtTokens.length === 0) {
    return { bleu1: 0.0, bleu2: 0.0, bleu3: 0.0, bleu4: 0.0 };
  }

  // Helper to get n-grams
  const getNgrams = (tokens: string[], n: number): Set<string> => {
    const ngrams = new Set<string>();
    for (let i = 0; i <= tokens.length - n; i++) {
      ngrams.add(tokens.slice(i, i + n).join(" "));
    }
    return ngrams;
  };

  // Calculate n-gram precisions
  const getPrecision = (
    predTokens: string[],
    gtTokens: string[],
    n: number,
  ): number => {
    if (predTokens.length < n) return 0;

    const predNgrams = getNgrams(predTokens, n);
    const gtNgrams = getNgrams(gtTokens, n);

    if (predNgrams.size === 0) return 0;

    let matches = 0;
    for (const ngram of predNgrams) {
      if (gtNgrams.has(ngram)) {
        matches++;
      }
    }

    return matches / predNgrams.size;
  };

  const bleu1 = getPrecision(predTokens, gtTokens, 1);
  const bleu2 = getPrecision(predTokens, gtTokens, 2);
  const bleu3 = getPrecision(predTokens, gtTokens, 3);
  const bleu4 = getPrecision(predTokens, gtTokens, 4);

  // Apply brevity penalty (simplified)
  const brevityPenalty = Math.min(
    1.0,
    Math.exp(1 - gtTokens.length / Math.max(predTokens.length, 1)),
  );

  return {
    bleu1: bleu1 * brevityPenalty,
    bleu2: bleu2 * brevityPenalty,
    bleu3: bleu3 * brevityPenalty,
    bleu4: bleu4 * brevityPenalty,
  };
}

/**
 * Calculate all metrics between prediction and ground truth.
 */
export function calculateMetrics(
  prediction: string,
  groundTruth: string,
): {
  f1: number;
  bleu1: number;
  bleu2: number;
  bleu3: number;
  bleu4: number;
} {
  const f1 = calculateF1Score(prediction, groundTruth);
  const bleuScores = calculateBLEUScores(prediction, groundTruth);

  return {
    f1,
    ...bleuScores,
  };
}

interface LLMJudgeResult {
  label?: string;
  score?: number;
  reasoning?: string;
}

/**
 * Evaluate the generated answer against the gold answer using an LLM judge.
 * Includes retry logic for handling unstable API connections.
 *
 * Returns 1 for CORRECT, 0 for WRONG.
 */
export async function evaluateLLMJudge(
  question: string,
  goldAnswer: string,
  generatedAnswer: string,
  maxRetries = 3,
): Promise<number> {
  const prompt = LLM_JUDGE_PROMPT.replace("{question}", question)
    .replace("{gold_answer}", goldAnswer)
    .replace("{generated_answer}", generatedAnswer);

  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const { text } = await generateText({
        model: openrouter("qwen/qwen3.7-max"),
        system:
          "You are an impartial judge evaluating answers to questions. Always respond with valid JSON.",
        prompt,
      });

      // Parse JSON response
      let result: LLMJudgeResult;
      try {
        result = JSON.parse(text);
      } catch {
        // Try to extract label from non-JSON response
        if (
          text.toUpperCase().includes("CORRECT") &&
          !text.toUpperCase().includes("WRONG")
        ) {
          return 1;
        }
        return 0;
      }

      const label = result.label ?? "WRONG";
      const score = label === "CORRECT" ? 1 : 0;

      return score;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.log(
        `[Judge] Attempt ${attempt}/${maxRetries} failed: ${lastError.message.substring(0, 80)}`,
      );
      if (attempt < maxRetries) {
        // Wait before retry (exponential backoff)
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
      }
    }
  }

  console.error(
    `[Judge] All ${maxRetries} attempts failed. Last error: ${lastError?.message}`,
  );
  return 0;
}

/**
 * Calculate metrics for a category of results.
 */
export function calculateCategoryMetrics(
  results: Array<{
    llm_score?: number;
    f1_score?: number;
    bleu_score?: number;
    bleu4?: number;
  }>,
): {
  count: number;
  llm_judge_accuracy: number;
  llm_judge_correct: number;
  f1_mean: number;
  bleu1_mean: number;
  bleu4_mean: number;
} {
  if (results.length === 0) {
    return {
      count: 0,
      llm_judge_accuracy: 0.0,
      llm_judge_correct: 0,
      f1_mean: 0.0,
      bleu1_mean: 0.0,
      bleu4_mean: 0.0,
    };
  }

  // Extract metrics
  const llmScores = results.map((r) => r.llm_score ?? 0);
  const f1Scores = results.map((r) => r.f1_score ?? 0);
  const bleu1Scores = results.map((r) => r.bleu_score ?? 0);
  const bleu4Scores = results.map((r) => r.bleu4 ?? r.bleu_score ?? 0);

  const mean = (arr: number[]): number =>
    arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

  return {
    count: results.length,
    llm_judge_accuracy: mean(llmScores),
    llm_judge_correct: llmScores.filter((s) => s === 1).length,
    f1_mean: mean(f1Scores),
    bleu1_mean: mean(bleu1Scores),
    bleu4_mean: mean(bleu4Scores),
  };
}
