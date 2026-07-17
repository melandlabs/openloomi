/**
 * Anthropic Messages API proxy — `app/api/ai/v1/messages`.
 *
 * Mirrors `app/api/ai/v1/chat/completions/route.ts` (the OpenAI-compatible
 * proxy) but for the Anthropic Messages shape.
 *
 * Resolution uses {@link resolveLlmProvider}, so the call site automatically
 * falls back to the configured agent runtime (Codex / OpenCode / Hermes /
 * Openclaw) when the user has no `anthropic_compatible` row saved. For
 * HTTP transports we still forward the upstream body as-is so SSE
 * streaming is preserved; for the agent runtime we buffer the CLI output
 * and wrap it in Anthropic Messages shape.
 *
 * Used by:
 *  - `app/api/chronicle/analyze/route.ts`           (vision analysis)
 *  - `app/api/chronicle/analyze-meeting/route.ts`   (meeting summarization)
 */
import { randomUUID } from "node:crypto";

import { auth } from "@/app/(auth)/auth";
import { isTauriMode } from "@/lib/env/constants";
import { resolveLlmProvider } from "@/lib/ai/provider-resolver";
import type { LlmImage, LlmUsage } from "@/lib/ai/provider";
import { getUserLlmProviderConfig } from "@/lib/ai/user-llm-api-settings";
import { AppError } from "@openloomi/shared/errors";

export const runtime = "nodejs";

type MessagesBody = {
  model?: unknown;
  system?: unknown;
  messages?: unknown;
  max_tokens?: unknown;
  [key: string]: unknown;
};

type ProviderConfig = {
  apiKey: string;
  baseUrl: string;
  model: string;
};

function normalizeOptionalString(value: string | null | undefined) {
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function buildAnthropicMessagesUrl(baseUrl: string) {
  return `${baseUrl.replace(/\/+$/, "")}/v1/messages`;
}

function resolveEnvProviderConfig(): ProviderConfig | undefined {
  const apiKey = normalizeOptionalString(
    process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_API_KEY,
  );
  const baseUrl = normalizeOptionalString(
    process.env.ANTHROPIC_BASE_URL || process.env.ANTHROPIC_DEFAULT_BASE_URL,
  );
  const model = normalizeOptionalString(process.env.ANTHROPIC_MODEL);

  if (!apiKey || !baseUrl || !model) return undefined;
  return { apiKey, baseUrl, model };
}

/**
 * Returns an HTTP-only config (user DB → env). The agent runtime fallback
 * is handled separately via {@link resolveLlmProvider} so HTTP transports
 * keep their passthrough / streaming semantics.
 */
async function resolveHttpProviderConfig(
  userId?: string,
): Promise<ProviderConfig | undefined> {
  if (userId) {
    const userConfig = await getUserLlmProviderConfig({
      userId,
      providerType: "anthropic_compatible",
    });
    if (userConfig) return userConfig;
  }
  return resolveEnvProviderConfig();
}

function resolveModel(body: MessagesBody, fallbackModel: string) {
  return typeof body.model === "string" && body.model.trim()
    ? body.model
    : fallbackModel;
}

function buildProviderHeaders(config: ProviderConfig) {
  return {
    "Content-Type": "application/json",
    // Anthropic-native auth. Some compatible proxies (LiteLLM, OpenRouter's
    // anthropic adapter, etc.) also accept `Authorization: Bearer` — we set
    // both so we work with either, and so users don't have to choose.
    "x-api-key": config.apiKey,
    Authorization: `Bearer ${config.apiKey}`,
    "anthropic-version": "2023-06-01",
  };
}

function copyResponseHeaders(response: Response) {
  const headers = new Headers();
  for (const [key, value] of response.headers.entries()) {
    const lowerKey = key.toLowerCase();
    if (
      lowerKey === "content-type" ||
      lowerKey === "cache-control" ||
      lowerKey === "x-request-id" ||
      lowerKey === "anthropic-request-id" ||
      lowerKey === "retry-after"
    ) {
      headers.set(key, value);
    }
  }
  return headers;
}

// =============================================================================
// Agent runtime → Anthropic Messages translation
// =============================================================================

interface AnthropicMessage {
  role?: string;
  content?: unknown;
}

function flattenSystem(system: unknown): string | undefined {
  if (typeof system === "string") return system;
  if (Array.isArray(system)) {
    const out: string[] = [];
    for (const block of system) {
      if (
        block &&
        typeof block === "object" &&
        "text" in block &&
        typeof (block as { text: unknown }).text === "string"
      ) {
        out.push((block as { text: string }).text);
      }
    }
    return out.length > 0 ? out.join("\n") : undefined;
  }
  return undefined;
}

function extractLastUserContent(messages: unknown): {
  text: string;
  images: LlmImage[];
} {
  if (!Array.isArray(messages) || messages.length === 0) {
    return { text: "", images: [] };
  }
  // Walk back to the last user message. Agent CLIs only support single-shot
  // prompts so we cannot preserve multi-turn turn structure; we collapse the
  // history into a single string with role tags.
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as AnthropicMessage | undefined;
    if (!m || m.role !== "user") continue;
    return flattenMessageContent(m.content);
  }
  return { text: "", images: [] };
}

function flattenMessageContent(content: unknown): {
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
    const b = block as { type?: string; text?: unknown; source?: unknown };
    if (b.type === "text" && typeof b.text === "string") {
      textParts.push(b.text);
    } else if (b.type === "image" && b.source && typeof b.source === "object") {
      const src = b.source as {
        type?: string;
        media_type?: unknown;
        data?: unknown;
      };
      if (
        src.type === "base64" &&
        typeof src.data === "string" &&
        typeof src.media_type === "string"
      ) {
        images.push({ base64: src.data, mediaType: src.media_type });
      }
    }
  }
  return { text: textParts.join("\n"), images };
}

function buildAnthropicMessagesResponse(
  text: string,
  model: string,
  usage: LlmUsage | undefined,
): Record<string, unknown> {
  return {
    id: `msg_${randomUUID()}`,
    type: "message",
    role: "assistant",
    content: [{ type: "text", text }],
    model,
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: usage
      ? {
          input_tokens: usage.inputTokens,
          output_tokens: usage.outputTokens,
        }
      : { input_tokens: 0, output_tokens: 0 },
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
    console.error("[AI Proxy] Invalid messages payload", error);
    return null;
  })) as MessagesBody | null;

  if (!body) {
    return new AppError(
      "bad_request:api",
      "Invalid Anthropic messages payload",
    ).toResponse();
  }

  // Step 1: try the HTTP anthropic-compatible provider. Preserve the
  // passthrough / streaming semantics for chat-style callers.
  const httpConfig = await resolveHttpProviderConfig(session?.user?.id);

  if (httpConfig) {
    const providerBody = {
      ...body,
      model: resolveModel(body, httpConfig.model),
    };
    try {
      const response = await fetch(
        buildAnthropicMessagesUrl(httpConfig.baseUrl),
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
      console.error("[AI Proxy] Anthropic messages request failed", error);
      return new AppError(
        "bad_request:api",
        error instanceof Error
          ? error.message
          : "Anthropic messages request failed",
      ).toResponse();
    }
  }

  // Step 2: fall back to the agent runtime. Buffer the CLI output and wrap
  // it in Anthropic Messages shape so the existing Chronicle / meeting
  // parsers keep working.
  const provider = await resolveLlmProvider({
    userId: session?.user?.id,
    prefer: "anthropic_messages",
  });

  if (!provider) {
    return new AppError(
      "bad_request:api",
      "Anthropic-compatible provider is not configured and no agent runtime is available. Save one in Preferences → API Settings, or set OPENLOOMI_AGENT_PROVIDER.",
    ).toResponse();
  }

  if (provider.flavor === "openai_http") {
    // Should not happen for `prefer: "anthropic_messages"`, but guard anyway.
    return new AppError(
      "bad_request:api",
      "Resolved an OpenAI provider when an Anthropic-shaped request was expected.",
    ).toResponse();
  }

  const system = flattenSystem(body.system);
  const { text, images } = extractLastUserContent(body.messages);
  // The caller's body.model is an Anthropic-shaped identifier; only forward
  // it when we're actually using the Anthropic HTTP transport. For the
  // agent runtime, the model lives in `OPENLOOMI_AGENT_<RUNTIME>_MODEL` and
  // a mismatched name (e.g. `claude-sonnet-5` against Codex) is fatal.
  const model =
    provider.flavor === "agent_runtime"
      ? undefined
      : typeof body.model === "string" && body.model.trim()
        ? body.model
        : provider.model;
  const maxTokens =
    typeof body.max_tokens === "number" ? body.max_tokens : undefined;

  try {
    const response = await provider.complete({
      system,
      userContent: text,
      images: images.length > 0 ? images : undefined,
      model,
      maxTokens,
      timeoutMs: 120_000,
    });

    return new Response(
      JSON.stringify(
        buildAnthropicMessagesResponse(
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
    console.error("[AI Proxy] Agent runtime messages request failed", error);
    return new AppError(
      "bad_request:api",
      error instanceof Error
        ? error.message
        : "Agent runtime messages request failed",
    ).toResponse();
  }
}
