import type { ModelType } from "./model-pricing";
import {
  calculateInputCredits,
  calculateOutputCredits,
  calculateTotalCredits,
} from "./model-pricing";

// Re-export estimateTokens from shared
export { estimateTokens } from "@openloomi/shared";

// Legacy constants for backward compatibility
// These are based on Claude Sonnet pricing (default model)
export const INPUT_TOKENS_PER_CREDIT = 75;
export const OUTPUT_TOKENS_PER_CREDIT = 7.5;

/**
 * Calculate credits for input tokens with optional model-specific pricing
 * @param inputTokens Number of input tokens
 * @param model Model type (uses default model if not specified)
 * @returns Number of credits required
 */
export function getInputCredits(
  inputTokens: number,
  model?: ModelType,
): number {
  if (model && model !== "default") {
    return calculateInputCredits(inputTokens, model);
  }
  // Legacy calculation for default model
  return inputTokens / INPUT_TOKENS_PER_CREDIT;
}

/**
 * Calculate credits for output tokens with optional model-specific pricing
 * @param outputTokens Number of output tokens
 * @param model Model type (uses default model if not specified)
 * @returns Number of credits required
 */
export function getOutputCredits(
  outputTokens: number,
  model?: ModelType,
): number {
  if (model && model !== "default") {
    return calculateOutputCredits(outputTokens, model);
  }
  // Legacy calculation for default model
  return outputTokens / OUTPUT_TOKENS_PER_CREDIT;
}

/**
 * Calculate total credits for input and output tokens with model-specific pricing
 * @param inputTokens Number of input tokens
 * @param outputTokens Number of output tokens
 * @param model Model type (uses default model if not specified)
 * @returns Total credits required
 */
export function getTotalCredits(
  inputTokens: number,
  outputTokens: number,
  model?: ModelType,
): number {
  if (model && model !== "default") {
    return calculateTotalCredits(inputTokens, outputTokens, model);
  }
  // Legacy calculation for default model
  return (
    inputTokens / INPUT_TOKENS_PER_CREDIT +
    outputTokens / OUTPUT_TOKENS_PER_CREDIT
  );
}

// Re-export model pricing types and utilities
export type { ModelType } from "./model-pricing";
export {
  MODEL_PRICING,
  getModelPricing,
  getModelMultiplier,
  CREDIT_VALUE_USD,
  calculateImageCredits,
  getImageModelPricing,
  IMAGE_MODEL_PRICING,
  getCanonicalImageModel,
} from "./model-pricing";
