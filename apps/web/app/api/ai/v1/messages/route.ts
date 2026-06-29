/**
 * Anthropic Messages API proxy — `app/api/ai/v1/messages`.
 *
 * Mirrors `app/api/ai/v1/chat/completions/route.ts` (the OpenAI-compatible
 * proxy) but for the Anthropic Messages shape. Resolves the user's
 * `anthropic_compatible` override from the DB first, then falls back to the
 * system default env vars (`ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN` /
 * `ANTHROPIC_MODEL`). The body is forwarded as-is — the caller is
 * responsible for emitting a valid Anthropic Messages request.
 *
 * Used by:
 *  - `app/api/chronicle/analyze/route.ts`           (vision analysis)
 *  - `app/api/chronicle/analyze-meeting/route.ts`   (meeting summarization)
 */
import { auth } from "@/app/(auth)/auth";
import { getUserLlmProviderConfig } from "@/lib/ai/user-llm-api-settings";
import { isTauriMode } from "@/lib/env/constants";
import { AppError } from "@openloomi/shared/errors";

export const runtime = "nodejs";

type MessagesBody = {
  model?: unknown;
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

/**
 * Build the upstream URL for the Anthropic Messages endpoint. Mirrors the
 * helper in `app/(chat)/api/preferences/ai/route.ts`: we expect the saved
 * base URL to NOT include a trailing `/v1` and we always append `/v1/messages`.
 * If the user (or a third-party proxy) has already included `/v1`, we still
 * do the naïve append, which is the existing convention in this codebase.
 */
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
  const model = normalizeOptionalString(
    process.env.ANTHROPIC_MODEL || process.env.LLM_MODEL,
  );

  if (!apiKey || !baseUrl || !model) return undefined;
  return { apiKey, baseUrl, model };
}

async function resolveProviderConfig(
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
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    // Anthropic-native auth. Some compatible proxies (LiteLLM, OpenRouter's
    // anthropic adapter, etc.) also accept `Authorization: Bearer` — we set
    // both so we work with either, and so users don't have to choose.
    "x-api-key": config.apiKey,
    Authorization: `Bearer ${config.apiKey}`,
    "anthropic-version": "2023-06-01",
  };
  return headers;
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

  const providerConfig = await resolveProviderConfig(session?.user?.id);
  if (!providerConfig) {
    return new AppError(
      "bad_request:api",
      "Anthropic-compatible provider is not configured. Save one in Preferences → API Settings, or set ANTHROPIC_BASE_URL, ANTHROPIC_AUTH_TOKEN, and ANTHROPIC_MODEL.",
    ).toResponse();
  }

  const providerBody = {
    ...body,
    model: resolveModel(body, providerConfig.model),
  };

  try {
    const response = await fetch(
      buildAnthropicMessagesUrl(providerConfig.baseUrl),
      {
        method: "POST",
        headers: buildProviderHeaders(providerConfig),
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
