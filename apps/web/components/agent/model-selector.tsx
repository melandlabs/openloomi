"use client";
import { useLocalStorage } from "usehooks-ts";

/**
 * Available model types
 */
export type ModelType =
  | "default"
  | "anthropic/claude-sonnet-4.6"
  | "anthropic/claude-sonnet-4.5"
  | "anthropic/claude-opus-4.6"
  | "anthropic/claude-opus-4.7"
  | "anthropic/claude-haiku-4.5"
  | "google/gemini-3-flash-preview"
  | "google/gemini-3-pro-preview"
  | "google/gemini-3.1-flash-lite-preview"
  | "google/gemini-3.1-pro-preview"
  | "openai/gpt-5.4-mini"
  | "openai/gpt-5.4-nano"
  | "openai/gpt-5.4"
  | "openai/gpt-5.4-pro"
  | "openai/gpt-5.5"
  | "openai/gpt-5.5-pro"
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
  | "stepfun/step-3.5-flash";

/**
 * Export MODELS for use in other components
 */
export { MODELS };

/**
 * Model configuration
 */
interface ModelConfig {
  id: ModelType;
  name: string;
  provider: string;
  description: string;
  requiresReasoning?: boolean;
  supportsVision?: boolean;
  supportsThinking?: boolean;
  defaultThinkingLevel?: "disabled" | "low" | "adaptive";
  nativeCapabilities?: {
    search?: boolean;
  };
  contextTokens?: number;
  monthlyFreeQuota?: number;
}

/**
 * Available models configuration
 */
const MODELS = {
  default: {
    id: "default",
    name: "Default",
    provider: "System",
    description: "Use system default auto route model",
  },
  "anthropic/claude-opus-4.7": {
    id: "anthropic/claude-opus-4.7",
    name: "Claude Opus 4.7",
    provider: "Anthropic",
    description: "Highest quality, slower response",
    requiresReasoning: true,
    supportsVision: true,
    supportsThinking: true,
    defaultThinkingLevel: "adaptive",
    contextTokens: 1000000,
    monthlyFreeQuota: 13,
  },
  "anthropic/claude-opus-4.6": {
    id: "anthropic/claude-opus-4.6",
    name: "Claude Opus 4.6",
    provider: "Anthropic",
    description: "Highest quality, slower response",
    requiresReasoning: true,
    supportsVision: true,
    supportsThinking: true,
    defaultThinkingLevel: "adaptive",
    contextTokens: 200000,
    monthlyFreeQuota: 13,
  },
  "anthropic/claude-sonnet-4.6": {
    id: "anthropic/claude-sonnet-4.6",
    name: "Claude Sonnet 4.6",
    provider: "Anthropic",
    description: "Balanced performance and speed",
    supportsVision: true,
    supportsThinking: true,
    defaultThinkingLevel: "adaptive",
    nativeCapabilities: { search: true },
    contextTokens: 200000,
    monthlyFreeQuota: 82,
  },
  "anthropic/claude-sonnet-4.5": {
    id: "anthropic/claude-sonnet-4.5",
    name: "Claude Sonnet 4.5",
    provider: "Anthropic",
    description: "Balanced performance and speed",
    supportsVision: true,
    contextTokens: 200000,
    monthlyFreeQuota: 79.5,
  },
  "anthropic/claude-haiku-4.5": {
    id: "anthropic/claude-haiku-4.5",
    name: "Claude Haiku 4.5",
    provider: "Anthropic",
    description: "Fast and efficient",
    supportsVision: true,
    contextTokens: 200000,
    monthlyFreeQuota: 200,
  },
  "openai/gpt-5.5-pro": {
    id: "openai/gpt-5.5-pro",
    name: "GPT-5.5 Pro",
    provider: "OpenAI",
    description: "Fast and efficient",
    supportsVision: true,
    contextTokens: 1050000,
    monthlyFreeQuota: 200,
  },
  "openai/gpt-5.5": {
    id: "openai/gpt-5.5",
    name: "GPT-5.5",
    provider: "OpenAI",
    description: "Fast next-gen model",
    supportsVision: true,
    contextTokens: 1050000,
    monthlyFreeQuota: 146,
  },
  "openai/gpt-5.4-pro": {
    id: "openai/gpt-5.4-pro",
    name: "GPT-5.4 Pro",
    provider: "OpenAI",
    description: "Next generation capabilities",
    supportsVision: true,
    contextTokens: 1050000,
    monthlyFreeQuota: 116,
  },
  "openai/gpt-5.4": {
    id: "openai/gpt-5.4",
    name: "GPT-5.4",
    provider: "OpenAI",
    description: "Multimodal with strong performance",
    supportsVision: true,
    contextTokens: 1050000,
    monthlyFreeQuota: 72.4,
  },
  "openai/gpt-5.4-mini": {
    id: "openai/gpt-5.4-mini",
    name: "GPT-5.4 Mini",
    provider: "OpenAI",
    description: "Fast and efficient",
    supportsVision: true,
    contextTokens: 1050000,
    monthlyFreeQuota: 200,
  },
  "openai/gpt-5.4-nano": {
    id: "openai/gpt-5.4-nano",
    name: "GPT-5.4 Nano",
    provider: "OpenAI",
    description: "Ultra fast and efficient",
    supportsVision: true,
    contextTokens: 1050000,
    monthlyFreeQuota: 290,
  },
  "google/gemini-3.1-pro-preview": {
    id: "google/gemini-3.1-pro-preview",
    name: "Gemini 3.1 Pro",
    provider: "Google",
    description: "Latest advanced capabilities",
    supportsVision: true,
    contextTokens: 200000,
    monthlyFreeQuota: 44.2,
  },
  "google/gemini-3.1-flash-lite-preview": {
    id: "google/gemini-3.1-flash-lite-preview",
    name: "Gemini 3.1 Flash Lite",
    provider: "Google",
    description: "Fast and efficient",
    supportsVision: true,
    contextTokens: 1048576,
    monthlyFreeQuota: 44.2,
  },
  "google/gemini-3-pro-preview": {
    id: "google/gemini-3-pro-preview",
    name: "Gemini 3 Pro",
    provider: "Google",
    description: "Advanced capabilities",
    supportsVision: true,
    contextTokens: 72.2,
    monthlyFreeQuota: 63.6,
  },
  "google/gemini-3-flash-preview": {
    id: "google/gemini-3-flash-preview",
    name: "Gemini 3 Flash",
    provider: "Google",
    description: "Fast and efficient",
    supportsVision: true,
    contextTokens: 385000,
    monthlyFreeQuota: 435,
  },
  "x-ai/grok-4.3": {
    id: "x-ai/grok-4.3",
    name: "Grok 4.3",
    provider: "X-AI",
    description: "Fast and efficient",
    supportsVision: true,
    contextTokens: 1000000,
    monthlyFreeQuota: 200,
  },
  "x-ai/grok-4.20": {
    id: "x-ai/grok-4.20",
    name: "Grok 4.20",
    provider: "X-AI",
    description: "Fast and efficient",
    supportsVision: true,
    contextTokens: 2000000,
    monthlyFreeQuota: 200,
  },
  "deepseek/deepseek-v4-pro": {
    id: "deepseek/deepseek-v4-pro",
    name: "DeepSeek V4 Pro",
    provider: "DeepSeek",
    description: "Cost-effective and efficient",
    supportsVision: false,
    contextTokens: 1048576,
    monthlyFreeQuota: 113,
  },
  "deepseek/deepseek-v4-flash": {
    id: "deepseek/deepseek-v4-flash",
    name: "DeepSeek V4 Flash",
    provider: "DeepSeek",
    description: "Cost-effective and efficient",
    supportsVision: false,
    contextTokens: 1048576,
    monthlyFreeQuota: 113,
  },
  "z-ai/glm-5.1": {
    id: "z-ai/glm-5.1",
    name: "GLM 5.1",
    provider: "Z-ai",
    description: "Next generation capabilities",
    supportsVision: false,
    contextTokens: 202752,
    monthlyFreeQuota: 515,
  },
  "z-ai/glm-5": {
    id: "z-ai/glm-5",
    name: "GLM 5",
    provider: "Z-ai",
    description: "Next generation capabilities",
    supportsVision: false,
    contextTokens: 128000,
    monthlyFreeQuota: 515,
  },
  "moonshotai/kimi-k2.6": {
    id: "moonshotai/kimi-k2.6",
    name: "Kimi K2.6",
    provider: "Moonshot",
    description: "Fast and efficient",
    supportsVision: true,
    contextTokens: 262142,
    monthlyFreeQuota: 200,
  },
  "moonshotai/kimi-k2.5": {
    id: "moonshotai/kimi-k2.5",
    name: "Kimi K2.5",
    provider: "Moonshot",
    description: "Fast and efficient",
    supportsVision: true,
    contextTokens: 128000,
    monthlyFreeQuota: 200,
  },
  "minimax/minimax-m2.7": {
    id: "minimax/minimax-m2.7",
    name: "MiniMax M2.7",
    provider: "MiniMax",
    description: "Fast and efficient",
    supportsVision: false,
    contextTokens: 200000,
    monthlyFreeQuota: 787,
  },
  "minimax/minimax-m2.5": {
    id: "minimax/minimax-m2.5",
    name: "MiniMax M2.5",
    provider: "MiniMax",
    description: "Fast and efficient",
    supportsVision: false,
    contextTokens: 200000,
    monthlyFreeQuota: 787,
  },
  "stepfun/step-3.5-flash": {
    id: "stepfun/step-3.5-flash",
    name: "Step 3.5 Flash",
    provider: "Step",
    description: "Fast and efficient",
    supportsVision: false,
    contextTokens: 200000,
    monthlyFreeQuota: 385,
  },
} as Record<ModelType, ModelConfig>;

/**
 * Local storage key for model preference
 */
const MODEL_PREFERENCE_KEY = "openloomi:preferredModel";

/**
 * Model selector component props
 */
export interface ModelSelectorProps {
  /** Current selected model */
  value?: ModelType;
  /** Callback when model is changed */
  onModelChange?: (model: ModelType) => void;
  /** Custom className */
  className?: string;
  /** Compact mode for smaller screens */
  compact?: boolean;
  /** Disable selector */
  disabled?: boolean;
}

/**
 * Hook to access current selected model
 *
 * This provides a convenient way to read and update model preference
 * without needing to import ModelSelector component.
 *
 * @returns A tuple of [currentModel, setModel]
 */
export function useModelPreference(): [ModelType, (model: ModelType) => void] {
  const [model, setModel] = useLocalStorage<ModelType>(
    MODEL_PREFERENCE_KEY,
    "default",
  );
  return [model, setModel];
}

/**
 * Get model configuration for a given model ID
 *
 * @param modelId - The model ID
 * @returns The model configuration, or undefined if not found
 */
export function getModelConfig(modelId: ModelType): ModelConfig | undefined {
  return MODELS[modelId];
}
