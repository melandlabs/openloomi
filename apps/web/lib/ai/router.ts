/**
 * AI Router - web app implementation
 *
 * Full implementation with cloud routing support for the web app.
 * Imports core routing logic from @openloomi/ai/router for local model calls.
 */

import { isTauriMode } from "@/lib/env/constants";
import { getModelProvider } from "@openloomi/ai/agent/model";
import type {
  ModelCallOptions,
  ModelCallResult,
} from "@openloomi/ai/agent/routing";

export type { ModelCallOptions, ModelCallResult };
export { getRecommendedMode } from "@openloomi/ai/agent/routing";

export interface CloudAIRequest {
  messages: Array<{ role: string; content: string }>;
  model?: string;
  system?: string;
  stream?: boolean;
}

function shouldUseCloudAI(options: ModelCallOptions): boolean {
  if (options.useCloud === true) return true;
  if (options.useCloud === false) return false;
  if (!isTauriMode()) return false;
  return false;
}

async function callLocalModel(
  options: ModelCallOptions,
): Promise<ReadableStream> {
  const { streamText, createUIMessageStream, JsonToSseTransformStream } =
    await import("ai");

  const { generateUUID } = await import("@openloomi/shared");

  const modelProvider = getModelProvider(isTauriMode());
  const model = options.model
    ? modelProvider.languageModel(options.model)
    : modelProvider.languageModel("chat-model");

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

export async function routeModelCall(
  options: ModelCallOptions,
): Promise<ModelCallResult> {
  const useCloud = shouldUseCloudAI(options);

  if (useCloud) {
    try {
      const { callCloudAIStream } = await import("./cloud-client");
      const cloudRequest: CloudAIRequest = {
        messages: options.messages,
        model: options.model,
        system: options.system,
        stream: true,
      };

      const stream = await callCloudAIStream(cloudRequest);

      return { source: "cloud", stream };
    } catch (error) {
      console.error("[Router] Cloud AI call failed:", error);

      if (options.fallbackToLocal !== false) {
        console.warn("[Router] Falling back to local model");
        const stream = await callLocalModel(options);
        return { source: "local", stream };
      }

      throw error;
    }
  }

  const stream = await callLocalModel(options);
  return { source: "local", stream };
}

export async function routeModelCallCloud(
  request: CloudAIRequest,
): Promise<ReadableStream> {
  const { callCloudAIStream } = await import("./cloud-client");
  return callCloudAIStream(request);
}

export async function checkCloudAIAvailability(): Promise<{
  available: boolean;
  reason?: string;
  status?: string;
}> {
  const { checkCloudAIAvailability: check } = await import("./cloud-client");
  return check();
}
