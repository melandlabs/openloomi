/**
 * Model Pricing Configuration
 *
 * Based on OpenRouter pricing (approximate values as of 2026)
 * Prices are in USD per million tokens
 * Source: https://openrouter.ai/models
 */

export type ModelType =
  | "default"
  | "anthropic/claude-sonnet-4.6"
  | "anthropic/claude-sonnet-4.5"
  | "anthropic/claude-opus-4.6"
  | "anthropic/claude-opus-4.7"
  | "anthropic/claude-haiku-4.5"
  | "openai/gpt-5.4-mini"
  | "openai/gpt-5.4-nano"
  | "openai/gpt-5.4"
  | "openai/gpt-5.4-pro"
  | "openai/gpt-5.5"
  | "openai/gpt-5.5-pro"
  | "google/gemini-3-flash-preview"
  | "google/gemini-3-pro-preview"
  | "google/gemini-3.1-flash-lite-preview"
  | "google/gemini-3.1-pro-preview"
  | "x-ai/grok-4.3"
  | "x-ai/grok-4.20"
  | "deepseek/deepseek-v4-flash"
  | "deepseek/deepseek-v4-pro"
  | "z-ai/glm-5"
  | "z-ai/glm-5.1"
  | "moonshotai/kimi-k2.5"
  | "moonshotai/kimi-k2.6"
  | "minimax/minimax-m2.5"
  | "minimax/minimax-m2.7"
  | "qwen/qwen3.6-plus"
  | "qwen/qwen3.6-flash"
  | "xiaomi/mimo-v2.5"
  | "xiaomi/mimo-v2.5-pro"
  | "stepfun/step-3.5-flash";

export interface ModelPricing {
  inputPricePerMillion: number;
  outputPricePerMillion: number;
  supportsVision: boolean;
  supportsAudio?: boolean;
  supportsTranscription?: boolean;
}

/**
 * Model pricing configuration based on OpenRouter
 * Source: https://openrouter.ai/models
 */
export const MODEL_PRICING: Record<ModelType, ModelPricing> = {
  default: {
    inputPricePerMillion: 3, // Default to Claude Sonnet pricing
    outputPricePerMillion: 15,
    supportsVision: true,
  },
  "anthropic/claude-sonnet-4.6": {
    inputPricePerMillion: 3,
    outputPricePerMillion: 15,
    supportsVision: true,
  },
  "anthropic/claude-sonnet-4.5": {
    inputPricePerMillion: 3,
    outputPricePerMillion: 15,
    supportsVision: true,
  },
  "anthropic/claude-opus-4.6": {
    inputPricePerMillion: 5,
    outputPricePerMillion: 25,
    supportsVision: true,
  },
  "anthropic/claude-opus-4.7": {
    inputPricePerMillion: 5,
    outputPricePerMillion: 25,
    supportsVision: true,
  },
  "anthropic/claude-haiku-4.5": {
    inputPricePerMillion: 1,
    outputPricePerMillion: 5,
    supportsVision: true,
  },
  "deepseek/deepseek-v4-flash": {
    inputPricePerMillion: 1.392,
    outputPricePerMillion: 2.784,
    supportsVision: false,
  },
  "deepseek/deepseek-v4-pro": {
    inputPricePerMillion: 1.7,
    outputPricePerMillion: 3.4,
    supportsVision: false,
  },
  "google/gemini-3-flash-preview": {
    inputPricePerMillion: 0.5,
    outputPricePerMillion: 3,
    supportsVision: true,
  },
  "google/gemini-3-pro-preview": {
    inputPricePerMillion: 1.25,
    outputPricePerMillion: 10,
    supportsVision: true,
  },
  "google/gemini-3.1-pro-preview": {
    inputPricePerMillion: 2,
    outputPricePerMillion: 12,
    supportsVision: true,
  },
  "google/gemini-3.1-flash-lite-preview": {
    inputPricePerMillion: 0.25,
    outputPricePerMillion: 1.5,
    supportsVision: true,
  },
  "z-ai/glm-5": {
    inputPricePerMillion: 0.6,
    outputPricePerMillion: 2.08,
    supportsVision: false,
  },
  "z-ai/glm-5.1": {
    inputPricePerMillion: 1.05,
    outputPricePerMillion: 3.5,
    supportsVision: false,
  },
  "x-ai/grok-4.3": {
    inputPricePerMillion: 1.25,
    outputPricePerMillion: 2.5,
    supportsVision: true,
  },
  "x-ai/grok-4.20": {
    inputPricePerMillion: 1.25,
    outputPricePerMillion: 2.5,
    supportsVision: true,
  },
  "moonshotai/kimi-k2.5": {
    inputPricePerMillion: 0.44,
    outputPricePerMillion: 2,
    supportsVision: true,
  },
  "moonshotai/kimi-k2.6": {
    inputPricePerMillion: 0.74,
    outputPricePerMillion: 3.49,
    supportsVision: true,
  },
  "minimax/minimax-m2.5": {
    inputPricePerMillion: 0.15,
    outputPricePerMillion: 1.15,
    supportsVision: false,
  },
  "minimax/minimax-m2.7": {
    inputPricePerMillion: 0.3,
    outputPricePerMillion: 1.2,
    supportsVision: false,
  },
  "openai/gpt-5.4-mini": {
    inputPricePerMillion: 30,
    outputPricePerMillion: 180,
    supportsVision: true,
  },
  "openai/gpt-5.4-nano": {
    inputPricePerMillion: 2.5,
    outputPricePerMillion: 15,
    supportsVision: true,
  },
  "openai/gpt-5.4": {
    inputPricePerMillion: 5,
    outputPricePerMillion: 15,
    supportsVision: true,
  },
  "openai/gpt-5.4-pro": {
    inputPricePerMillion: 30,
    outputPricePerMillion: 180,
    supportsVision: true,
  },
  "openai/gpt-5.5": {
    inputPricePerMillion: 0.2,
    outputPricePerMillion: 1.25,
    supportsVision: true,
  },
  "openai/gpt-5.5-pro": {
    inputPricePerMillion: 0.75,
    outputPricePerMillion: 4.5,
    supportsVision: true,
  },
  "stepfun/step-3.5-flash": {
    inputPricePerMillion: 0.1,
    outputPricePerMillion: 0.3,
    supportsVision: false,
  },
  "xiaomi/mimo-v2.5": {
    inputPricePerMillion: 0.4,
    outputPricePerMillion: 2,
    supportsVision: true,
    supportsAudio: true,
    supportsTranscription: true,
  },
  "xiaomi/mimo-v2.5-pro": {
    inputPricePerMillion: 1,
    outputPricePerMillion: 3,
    supportsVision: true,
    supportsAudio: true,
    supportsTranscription: true,
  },
  "qwen/qwen3.6-flash": {
    inputPricePerMillion: 0.1,
    outputPricePerMillion: 0.3,
    supportsVision: false,
  },
  "qwen/qwen3.6-plus": {
    inputPricePerMillion: 0.3,
    outputPricePerMillion: 1,
    supportsVision: true,
  },
};

/**
 * Base conversion rate: 1 credit = $0.0000667 (USD)
 * This means 1 USD = 15,000 credits
 * Based on average model cost ($15/million tokens), 1 credit ≈ 13.33 tokens
 */
export const CREDIT_VALUE_USD = 0.0000667;

/**
 * Base tokens per credit for the default model (Claude Sonnet)
 * Used as reference for backward compatibility
 */
export const BASE_INPUT_TOKENS_PER_CREDIT = 30;
export const BASE_OUTPUT_TOKENS_PER_CREDIT = 3;

/**
 * Calculate credits required for input tokens based on model pricing
 * @param tokens Number of input tokens
 * @param model Model type
 * @returns Number of credits required
 */
export function calculateInputCredits(
  tokens: number,
  model: ModelType = "default",
): number {
  const pricing = MODEL_PRICING[model] || MODEL_PRICING.default;
  const costUsd = (tokens / 1_000_000) * pricing.inputPricePerMillion;
  return costUsd / CREDIT_VALUE_USD;
}

/**
 * Calculate credits required for output tokens based on model pricing
 * @param tokens Number of output tokens
 * @param model Model type
 * @returns Number of credits required
 */
export function calculateOutputCredits(
  tokens: number,
  model: ModelType = "default",
): number {
  const pricing = MODEL_PRICING[model] || MODEL_PRICING.default;
  const costUsd = (tokens / 1_000_000) * pricing.outputPricePerMillion;
  return costUsd / CREDIT_VALUE_USD;
}

/**
 * Calculate total credits for input and output tokens
 * @param inputTokens Number of input tokens
 * @param outputTokens Number of output tokens
 * @param model Model type
 * @returns Total credits required
 */
export function calculateTotalCredits(
  inputTokens: number,
  outputTokens: number,
  model: ModelType = "default",
): number {
  return (
    calculateInputCredits(inputTokens, model) +
    calculateOutputCredits(outputTokens, model)
  );
}

/**
 * Get pricing information for a model
 * @param model Model type
 * @returns Model pricing information
 */
export function getModelPricing(model: ModelType = "default"): ModelPricing {
  return MODEL_PRICING[model] || MODEL_PRICING.default;
}

/**
 * Get the multiplier for a model relative to the default model
 * @param model Model type
 * @returns Multiplier (e.g., 1.0 for default, 5.0 for models 5x more expensive)
 */
export function getModelMultiplier(model: ModelType = "default"): number {
  const defaultPricing = MODEL_PRICING.default;
  const modelPricing = MODEL_PRICING[model] || defaultPricing;

  const defaultAvg =
    (defaultPricing.inputPricePerMillion +
      defaultPricing.outputPricePerMillion) /
    2;
  const modelAvg =
    (modelPricing.inputPricePerMillion + modelPricing.outputPricePerMillion) /
    2;

  return modelAvg / defaultAvg;
}

// ============================================================
// Audio Model Pricing
// ============================================================

/**
 * Audio model pricing configuration
 * whisper-1: transcription, 30 credits/minute
 * tts-1: tts, 0.5 credits/character
 * tts-1-hd: tts, 0.8 credits/character
 */
export const AUDIO_MODEL_PRICING: Record<
  string,
  { type: "transcription" | "tts"; creditsPerUnit: number; description: string }
> = {
  "whisper-1": {
    type: "transcription",
    creditsPerUnit: 30, // 30 credits per minute
    description: "Whisper-1 transcription model",
  },
  "tts-1": {
    type: "tts",
    creditsPerUnit: 0.5, // 0.5 credits per character
    description: "TTS-1 standard quality",
  },
  "tts-1-hd": {
    type: "tts",
    creditsPerUnit: 0.8, // 0.8 credits per character
    description: "TTS-1 HD high quality",
  },
};

/**
 * Calculate credits for audio transcription
 * @param durationSeconds Audio duration in seconds
 * @param model Model name (default: whisper-1)
 * @returns Credits required
 */
export function calculateTranscriptionCredits(
  durationSeconds: number,
  model: string = "whisper-1",
): number {
  const pricing =
    AUDIO_MODEL_PRICING[model] || AUDIO_MODEL_PRICING["whisper-1"];
  const minutes = durationSeconds / 60;
  return Math.ceil(minutes * pricing.creditsPerUnit);
}

/**
 * Calculate credits for TTS generation
 * @param characterCount Number of characters to synthesize
 * @param model Model name (default: tts-1)
 * @returns Credits required
 */
export function calculateTTSCredits(
  characterCount: number,
  model: string = "tts-1",
): number {
  const pricing = AUDIO_MODEL_PRICING[model] || AUDIO_MODEL_PRICING["tts-1"];
  return Math.ceil(characterCount * pricing.creditsPerUnit);
}

/**
 * Get audio model pricing info
 */
export function getAudioModelPricing(
  model: string,
): (typeof AUDIO_MODEL_PRICING)[keyof typeof AUDIO_MODEL_PRICING] | null {
  return AUDIO_MODEL_PRICING[model] || null;
}

// ============================================================
// Image Model Pricing
// ============================================================

/**
 * Image model ID aliases - maps common names to canonical model IDs
 */
export const IMAGE_MODEL_ALIASES: Record<string, string> = {
  "flux-pro": "black-forest-labs/flux-2-pro",
  "flux-schnell": "black-forest-labs/flux-1-schnell",
  "flux-dev": "black-forest-labs/flux-1-dev",
  "dall-e-3": "openai/dall-e-3",
  "dall-e-2": "openai/dall-e-2",
  "gpt-5-image": "openai/gpt-5-image",
  "imagen-3": "google/imagen-3",
  "imagen-3-fast": "google/imagen-3-fast",
  "gemini-2-flash-image": "google/gemini-2-flash-image-preview",
  "gemini-3-pro-image": "google/gemini-3-pro-image-preview",
};

/**
 * Image model pricing configuration
 * Credits per image for standard quality at base size
 * 1 credit ≈ $0.0000667 (USD) based on CREDIT_VALUE_USD
 */
export const IMAGE_MODEL_PRICING: Record<
  string,
  { creditsPerImage: number; hdMultiplier: number; description: string }
> = {
  // Black Forest Labs - Flux (Replicate/OpenRouter)
  "black-forest-labs/flux-2-pro": {
    creditsPerImage: 750, // ~$0.05/image
    hdMultiplier: 2,
    description: "FLUX.2 Pro (schnell, realistic, high quality)",
  },
  "black-forest-labs/flux-1-schnell": {
    creditsPerImage: 150, // ~$0.01/image
    hdMultiplier: 2,
    description: "FLUX.1 Schnell (fast generation)",
  },
  "black-forest-labs/flux-1-dev": {
    creditsPerImage: 300, // ~$0.02/image
    hdMultiplier: 2,
    description: "FLUX.1 Dev (open-weight, non-commercial)",
  },

  // OpenAI - DALL-E / GPT Image
  "openai/dall-e-3": {
    creditsPerImage: 600, // ~$0.04/image
    hdMultiplier: 2,
    description: "DALL-E 3 (high quality, strict content)",
  },
  "openai/dall-e-2": {
    creditsPerImage: 300, // ~$0.02/image
    hdMultiplier: 2,
    description: "DALL-E 2",
  },
  "openai/gpt-5-image": {
    creditsPerImage: 600, // ~$0.04/image (estimated)
    hdMultiplier: 2,
    description: "GPT-5 Image Generation",
  },

  // Google - Imagen / Gemini Image
  "google/imagen-3": {
    creditsPerImage: 450, // ~$0.03/image
    hdMultiplier: 2,
    description: "Imagen 3 (photorealistic, text rendering)",
  },
  "google/imagen-3-fast": {
    creditsPerImage: 150, // ~$0.01/image
    hdMultiplier: 2,
    description: "Imagen 3 Fast",
  },
  "google/gemini-2-flash-image-preview": {
    creditsPerImage: 300, // ~$0.02/image
    hdMultiplier: 2,
    description: "Gemini 2.0 Flash Image",
  },
  "google/gemini-3-pro-image-preview": {
    creditsPerImage: 450, // ~$0.03/image
    hdMultiplier: 2,
    description: "Gemini 3.0 Pro Image",
  },

  // Default fallback
  default: {
    creditsPerImage: 750, // ~$0.05/image
    hdMultiplier: 2,
    description: "Default image model",
  },
};

/**
 * Get canonical model name from alias
 */
export function getCanonicalImageModel(model: string): string {
  const lower = model.toLowerCase();
  return IMAGE_MODEL_ALIASES[lower] || IMAGE_MODEL_ALIASES[model] || model;
}

/**
 * Calculate credits for image generation
 * @param model Image model name (supports aliases)
 * @param imageCount Number of images to generate
 * @param quality Quality level ("standard" | "hd")
 * @returns Credits required (rounded up)
 */
export function calculateImageCredits(
  model: string,
  imageCount = 1,
  quality: "standard" | "hd" = "standard",
): number {
  const canonical = getCanonicalImageModel(model);
  const pricing = IMAGE_MODEL_PRICING[canonical] || IMAGE_MODEL_PRICING.default;

  const qualityMultiplier = quality === "hd" ? pricing.hdMultiplier : 1;
  return Math.ceil(imageCount * pricing.creditsPerImage * qualityMultiplier);
}

/**
 * Get image model pricing info
 */
export function getImageModelPricing(
  model: string,
): (typeof IMAGE_MODEL_PRICING)[keyof typeof IMAGE_MODEL_PRICING] {
  const canonical = getCanonicalImageModel(model);
  return IMAGE_MODEL_PRICING[canonical] || IMAGE_MODEL_PRICING.default;
}

/**
 * Legacy backward compatibility: calculate credits using simple ratio
 */
export function calculateCreditsLegacy(
  inputTokens: number,
  outputTokens: number,
  model?: ModelType,
): number {
  if (model && model !== "default") {
    return calculateTotalCredits(inputTokens, outputTokens, model);
  }
  return (
    inputTokens / BASE_INPUT_TOKENS_PER_CREDIT +
    outputTokens / BASE_OUTPUT_TOKENS_PER_CREDIT
  );
}
