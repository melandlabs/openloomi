/**
 * AI model intelligent routing
 *
 * This module provides local model routing. Cloud AI calls are handled
 * at the web app level via lib/ai/cloud-client.ts.
 *
 * Web apps can override routeModelCallCloud() and checkCloudAIAvailability()
 * to enable cloud routing.
 */

import { getModelProvider } from "./providers";

export interface ModelCallOptions {
  messages: Array<{ role: string; content: string }>;
  model?: string;
  system?: string;
  stream?: boolean;
  /**
   * Force use cloud AI
   * - true: force use cloud (if available)
   * - false: force use local
   * - undefined: auto-select
   */
  useCloud?: boolean;
  /**
   * Whether to fall back to local model when cloud is unavailable
   * @default true
   */
  fallbackToLocal?: boolean;
}

export interface ModelCallResult {
  source: "local" | "cloud";
  stream: ReadableStream;
}

export interface CloudAIRequest {
  messages: Array<{ role: string; content: string }>;
  model?: string;
  system?: string;
  stream?: boolean;
}

/**
 * Determine if cloud AI should be used
 */
function shouldUseCloudAI(
  isNativeMode: boolean,
  options: ModelCallOptions,
): boolean {
  if (options.useCloud === true) {
    return true;
  }
  if (options.useCloud === false) {
    return false;
  }

  if (!isNativeMode) {
    return false;
  }

  return false;
}

/**
 * Call local model (streaming response)
 */
async function callLocalModel(
  isNativeModel: boolean,
  options: ModelCallOptions,
): Promise<ReadableStream> {
  const { streamText, createUIMessageStream, JsonToSseTransformStream } =
    await import("ai");

  const { generateUUID } = await import("@openloomi/shared");

  const model = options.model
    ? getModelProvider(isNativeModel).languageModel(options.model)
    : getModelProvider(isNativeModel).languageModel("chat-model");

  const stream = createUIMessageStream({
    execute: async ({ writer: dataStream }) => {
      const result = streamText({
        model,
        messages: options.messages as any,
        system: options.system,
      });

      dataStream.merge(
        result.toUIMessageStream({
          sendReasoning: false,
        }),
      );
    },
    generateId: generateUUID,
  });

  return stream.pipeThrough(new JsonToSseTransformStream());
}

/**
 * Smart routing - automatically select local or cloud model.
 *
 * Override routeModelCallCloud to enable cloud routing.
 */
export async function routeModelCall(
  isNativeModel: boolean,
  options: ModelCallOptions,
): Promise<ModelCallResult> {
  const useCloud = shouldUseCloudAI(isNativeModel, options);

  if (useCloud) {
    try {
      const stream = await routeModelCallCloud({
        messages: options.messages,
        model: options.model,
        system: options.system,
        stream: true,
      });

      return {
        source: "cloud",
        stream,
      };
    } catch (error) {
      console.error("[Router] Cloud AI call failed:", error);

      if (options.fallbackToLocal !== false) {
        console.warn("[Router] Falling back to local model");
        const stream = await callLocalModel(isNativeModel, options);
        return {
          source: "local",
          stream,
        };
      }

      throw error;
    }
  }

  const stream = await callLocalModel(isNativeModel, options);
  return {
    source: "local",
    stream,
  };
}

/**
 * Override this function in the web app to enable cloud AI routing.
 * Default implementation throws - web app should override with cloud-client logic.
 */
export async function routeModelCallCloud(
  _request: CloudAIRequest,
): Promise<ReadableStream> {
  throw new Error(
    "Cloud routing not available. Override routeModelCallCloud() in the web app.",
  );
}

/**
 * Check cloud AI availability.
 * Override in web app to enable cloud checks.
 */
export async function checkCloudAIAvailability(isNativeMode: boolean): Promise<{
  available: boolean;
  reason?: string;
  status?: string;
}> {
  if (!isNativeMode) {
    return {
      available: false,
      reason: "Web mode uses local API",
    };
  }

  return {
    available: false,
    reason: "Cloud availability check not configured",
  };
}

/**
 * Get recommended mode for current configuration
 */
export function getRecommendedMode(isNativeMode: boolean): "local" | "cloud" {
  if (!isNativeMode) {
    return "local";
  }

  return "local";
}
