/**
 * @openloomi/ai - AI Layer: model pricing, token estimation, conversation windows,
 * compaction, model providers, and intelligent routing.
 */

// Tokens & pricing
export {
  estimateTokens,
  getInputCredits,
  getOutputCredits,
  getTotalCredits,
  INPUT_TOKENS_PER_CREDIT,
  OUTPUT_TOKENS_PER_CREDIT,
} from "./tokens";
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
  calculateInputCredits,
  calculateOutputCredits,
  calculateTotalCredits,
  AUDIO_MODEL_PRICING,
  calculateTranscriptionCredits,
  calculateTTSCredits,
  getAudioModelPricing,
} from "./model-pricing";

// Compaction
export {
  COMPACTION_SOFT_RATIO,
  COMPACTION_HARD_RATIO,
  COMPACTION_EMERGENCY_RATIO,
  COMPACTION_MODEL,
  buildCompactionPrompt,
} from "./compaction";
export type {
  CompactionLevel,
  CompactionPlatform,
  CompactionResult,
} from "./compaction";
export { triggerCompaction, triggerCompactionAsync } from "./compaction-client";
export type {
  CompactionOptions,
  CompactionResponse,
} from "./compaction-client";

// Conversation windows
export {
  prepareConversationWindows,
  estimateConversationTokens,
  getConversationBucket,
  DEFAULT_CONVERSATION_WINDOW_CONFIG,
} from "./conversation-windows";
export type {
  ConversationWindowMessage,
  ConversationWindowConfig,
  ConversationWindowBucket,
  ConversationWindowResult,
  TokenizedConversationWindowMessage,
  ConversationWindowBucketStats,
  ConversationWindowRole,
} from "./conversation-windows";

// Providers
export {
  getModel,
  getVLMModel,
  createDynamicModel,
  getModelProvider,
  setAIUserContext,
  clearAIUserContext,
  getAIUserContext,
} from "./providers";
export type { AIUserContext, UserType } from "./providers";

// Router
export {
  routeModelCall,
  checkCloudAIAvailability,
  getRecommendedMode,
} from "./router";
export type { ModelCallOptions, ModelCallResult } from "./router";

// Utils
export { extractJsonFromMarkdown } from "./utils";
