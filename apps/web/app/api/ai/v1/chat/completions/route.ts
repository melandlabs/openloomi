import { auth } from "@/app/(auth)/auth";
import { getUserLlmProviderConfig } from "@/lib/ai/user-llm-api-settings";
import { isTauriMode } from "@/lib/env/constants";
import { AppError } from "@openloomi/shared/errors";

export const runtime = "nodejs";

type ChatCompletionsBody = {
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

function buildChatCompletionsUrl(baseUrl: string) {
  const normalized = baseUrl.replace(/\/+$/, "");
  if (normalized.endsWith("/v1")) {
    return `${normalized}/chat/completions`;
  }
  return `${normalized}/v1/chat/completions`;
}

function resolveEnvProviderConfig(): ProviderConfig | undefined {
  const apiKey = normalizeOptionalString(process.env.LLM_API_KEY);
  const baseUrl = normalizeOptionalString(process.env.LLM_BASE_URL);
  const model = normalizeOptionalString(process.env.LLM_MODEL);

  if (!apiKey || !baseUrl || !model) {
    return undefined;
  }

  return { apiKey, baseUrl, model };
}

async function resolveProviderConfig(userId?: string) {
  if (userId) {
    const userConfig = await getUserLlmProviderConfig({
      userId,
      providerType: "openai_compatible",
    });

    if (userConfig) {
      return userConfig;
    }
  }

  return resolveEnvProviderConfig();
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

  const providerConfig = await resolveProviderConfig(session?.user?.id);
  if (!providerConfig) {
    return new AppError(
      "bad_request:api",
      "OpenAI-compatible provider is not configured. Set LLM_API_KEY, LLM_BASE_URL, and LLM_MODEL, or save an AI provider in Preferences.",
    ).toResponse();
  }

  const providerBody = {
    ...body,
    model: resolveModel(body, providerConfig.model),
  };

  try {
    const response = await fetch(
      buildChatCompletionsUrl(providerConfig.baseUrl),
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
    console.error("[AI Proxy] Chat completions request failed", error);
    return new AppError(
      "bad_request:api",
      error instanceof Error
        ? error.message
        : "Chat completions request failed",
    ).toResponse();
  }
}
