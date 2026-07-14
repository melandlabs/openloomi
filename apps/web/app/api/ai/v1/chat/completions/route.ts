/**
 * OpenAI Chat Completions API proxy — `app/api/ai/v1/chat/completions`.
 *
 * Mirrors `app/api/ai/v1/messages/route.ts` (the Anthropic Messages proxy) but
 * for the OpenAI Chat Completions shape.
 *
 * Resolution uses {@link resolveLlmProvider}, so the call site automatically
 * falls back to the configured agent runtime (Codex / OpenCode / Hermes /
 * Openclaw) when the user has no `openai_compatible` row saved. For HTTP
 * transports we still forward the upstream body as-is so SSE streaming is
 * preserved; for the agent runtime we buffer the CLI output and wrap it in
 * Chat Completions shape.
 */
import { randomUUID } from "node:crypto";

import { auth } from "@/app/(auth)/auth";
import { isTauriMode } from "@/lib/env/constants";
import { resolveLlmProvider } from "@/lib/ai/provider-resolver";
import type { LlmImage, LlmUsage } from "@/lib/ai/provider";
import { getUserLlmProviderConfig } from "@/lib/ai/user-llm-api-settings";
import { AppError } from "@openloomi/shared/errors";

export const runtime = "nodejs";

type ChatCompletionsBody = {
  model?: unknown;
  messages?: unknown;
  [key: string]: unknown;
};

type ProviderConfig = {
  apiKey: string;
  baseUrl: string;
  model: string;
};

function buildChatCompletionsUrl(baseUrl: string) {
  const normalized = baseUrl.replace(/\/+$/, "");
  if (normalized.endsWith("/v1")) {
    return `${normalized}/chat/completions`;
  }
  return `${normalized}/v1/chat/completions`;
}

async function resolveHttpProviderConfig(
  userId?: string,
): Promise<ProviderConfig | undefined> {
  if (!userId) return undefined;
  return getUserLlmProviderConfig({
    userId,
    providerType: "openai_compatible",
  });
}

function resolveModel(body: ChatCompletionsBody, fallbackModel: string) {
  return typeof body.model === "string" &&
    body.model.trim() &&
    body.model !== "default" &&
    body.model !== "chat-model"
    ? body.model
    : fallbackModel;
}

function buildProviderHeaders(config: ProviderConfig) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.apiKey}`,
    "Content-Type": "application/json",
  };

  if (config.baseUrl.includes("openrouter.ai")) {
    headers["HTTP-Referer"] =
      process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3515";
    headers["X-Title"] = "OpenLoomi";
  }

  return headers;
}

function copyResponseHeaders(response: Response) {
  const headers = new Headers();
  for (const [key, value] of response.headers.entries()) {
    const lowerKey = key.toLowerCase();
    if (
      lowerKey === "content-type" ||
      lowerKey === "cache-control" ||
      lowerKey === "x-request-id"
    ) {
      headers.set(key, value);
    }
  }
  return headers;
}

// =============================================================================
// Agent runtime → Chat Completions translation
// =============================================================================

interface ChatMessage {
  role?: string;
  content?: unknown;
}

function extractMessages(messages: unknown): {
  system: string | undefined;
  text: string;
  images: LlmImage[];
} {
  if (!Array.isArray(messages) || messages.length === 0) {
    return { system: undefined, text: "", images: [] };
  }

  const systemParts: string[] = [];
  for (const m of messages) {
    const msg = m as ChatMessage | undefined;
    if (msg?.role === "system") {
      const flattened = flattenContentText(msg.content);
      if (flattened) systemParts.push(flattened);
    }
  }
  const system = systemParts.length > 0 ? systemParts.join("\n") : undefined;

  // Walk back to the last user message. We collapse prior history into a
  // single transcript string so the agent CLI can read it.
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as ChatMessage | undefined;
    if (!m || m.role !== "user") continue;
    const { text, images } = flattenContentWithImages(m.content);
    return { system, text, images };
  }
  return { system, text: "", images: [] };
}

function flattenContentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const out: string[] = [];
  for (const block of content) {
    if (
      block &&
      typeof block === "object" &&
      (block as { type?: string }).type === "text" &&
      typeof (block as { text?: unknown }).text === "string"
    ) {
      out.push((block as { text: string }).text);
    }
  }
  return out.join("\n");
}

function flattenContentWithImages(content: unknown): {
  text: string;
  images: LlmImage[];
} {
  if (typeof content === "string") {
    return { text: content, images: [] };
  }
  if (!Array.isArray(content)) {
    return { text: "", images: [] };
  }
  const textParts: string[] = [];
  const images: LlmImage[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const b = block as { type?: string; text?: unknown; image_url?: unknown };
    if (b.type === "text" && typeof b.text === "string") {
      textParts.push(b.text);
    } else if (
      b.type === "image_url" &&
      b.image_url &&
      typeof b.image_url === "object"
    ) {
      const url = (b.image_url as { url?: unknown }).url;
      if (typeof url === "string") {
        const parsed = parseDataUrl(url);
        if (parsed) {
          images.push({ base64: parsed.data, mediaType: parsed.mediaType });
        }
      }
    }
  }
  return { text: textParts.join("\n"), images };
}

function parseDataUrl(
  url: string,
): { data: string; mediaType: string } | undefined {
  const match = url.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return undefined;
  return { mediaType: match[1], data: match[2] };
}

function buildChatCompletionResponse(
  text: string,
  model: string,
  usage: LlmUsage | undefined,
): Record<string, unknown> {
  return {
    id: `chatcmpl-${randomUUID()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: text },
        finish_reason: "stop",
      },
    ],
    usage: usage
      ? {
          prompt_tokens: usage.inputTokens,
          completion_tokens: usage.outputTokens,
          total_tokens: usage.inputTokens + usage.outputTokens,
        }
      : { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}

// =============================================================================
// POST handler
// =============================================================================

export async function POST(request: Request) {
  const session = await auth().catch(() => null);
  if (!session?.user?.id && !isTauriMode()) {
    return new AppError("unauthorized:auth").toResponse();
  }

  const body = (await request.json().catch((error) => {
    console.error("[AI Proxy] Invalid chat completions payload", error);
    return null;
  })) as ChatCompletionsBody | null;

  if (!body) {
    return new AppError(
      "bad_request:api",
      "Invalid chat completions payload",
    ).toResponse();
  }

  // Step 1: try the HTTP openai-compatible provider. Preserve the
  // passthrough / streaming semantics.
  const httpConfig = await resolveHttpProviderConfig(session?.user?.id);

  if (httpConfig) {
    const providerBody = {
      ...body,
      model: resolveModel(body, httpConfig.model),
    };
    try {
      const response = await fetch(
        buildChatCompletionsUrl(httpConfig.baseUrl),
        {
          method: "POST",
          headers: buildProviderHeaders(httpConfig),
          body: JSON.stringify(providerBody),
          signal: AbortSignal.timeout(120_000),
        },
      );
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: copyResponseHeaders(response),
      });
    } catch (error) {
      console.error("[AI Proxy] Chat completions request failed", error);
      return new AppError(
        "bad_request:api",
        error instanceof Error
          ? error.message
          : "Chat completions request failed",
      ).toResponse();
    }
  }

  // Step 2: fall back to the agent runtime. Buffer the CLI output and wrap
  // it in Chat Completions shape.
  const provider = await resolveLlmProvider({
    userId: session?.user?.id,
    prefer: "chat_completions",
  });

  if (!provider) {
    return new AppError(
      "bad_request:api",
      "OpenAI-compatible provider is not configured and no agent runtime is available. Save one in /api/preferences/ai, or set OPENLOOMI_AGENT_PROVIDER.",
    ).toResponse();
  }

  if (provider.flavor === "anthropic_http") {
    return new AppError(
      "bad_request:api",
      "Resolved an Anthropic provider when a Chat-Completions-shaped request was expected.",
    ).toResponse();
  }

  const { system, text, images } = extractMessages(body.messages);
  // The caller's body.model is an OpenAI-shaped identifier; only forward it
  // when we're actually using the OpenAI HTTP transport. For the agent
  // runtime, the model lives in `OPENLOOMI_AGENT_<RUNTIME>_MODEL` and a
  // mismatched name (e.g. `gpt-5` against Codex CLI's own model catalog)
  // is fatal.
  const model =
    provider.flavor === "agent_runtime"
      ? undefined
      : typeof body.model === "string" &&
          body.model.trim() &&
          body.model !== "default" &&
          body.model !== "chat-model"
        ? body.model
        : provider.model;

  try {
    const response = await provider.complete({
      system,
      userContent: text,
      images: images.length > 0 ? images : undefined,
      model,
      timeoutMs: 120_000,
    });

    return new Response(
      JSON.stringify(
        buildChatCompletionResponse(
          response.text,
          response.model,
          response.usage,
        ),
      ),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    console.error(
      "[AI Proxy] Agent runtime chat completions request failed",
      error,
    );
    return new AppError(
      "bad_request:api",
      error instanceof Error
        ? error.message
        : "Agent runtime chat completions request failed",
    ).toResponse();
  }
}
