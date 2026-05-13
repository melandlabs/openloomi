import { customProvider } from "ai";
import type { LanguageModel } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { DEV_PORT, PROD_PORT } from "@openloomi/shared";

/**
 * User type - application-specific, defaults to "free" for package consumers.
 * Override by calling setUserTypeOverride() before initializing models.
 */
export type UserType =
  | "guest"
  | "regular"
  | "slack"
  | "discord"
  | "google"
  | "basic"
  | "pro"
  | "team"
  | "enterprise"
  | "free";

/**
 * User context for AI requests
 */
export interface AIUserContext {
  id: string;
  email: string | null | undefined;
  name: string | null | undefined;
  type: string; // User type string - any value is accepted
  token?: string; // Optional: use existing cloud auth token instead of generating new one
}

/**
 * Global user context for AI requests
 * Used in bot/background jobs
 */
let globalUserContext: AIUserContext | null = null;

/**
 * Module-level keepalive fetch instance for connection reuse.
 * Using a singleton pattern to ensure the same connection is reused across requests.
 */
let _keepaliveFetch: typeof fetch | null = null;

/**
 * Create a fetch function with keepalive enabled for connection reuse.
 * This reduces TTFT (Time To First Token) by maintaining persistent HTTP connections.
 */
function createKeepAliveFetch(): typeof fetch {
  if (_keepaliveFetch) return _keepaliveFetch;

  _keepaliveFetch = async (
    url: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const keepaliveInit: RequestInit = {
      ...init,
      keepalive: true, // Keep connection alive for subsequent requests
    };
    return fetch(url, keepaliveInit);
  };

  return _keepaliveFetch;
}

/**
 * Set the global user context for AI requests
 * Call this at the beginning of bot/background operations
 */
export function setAIUserContext(context: AIUserContext | null) {
  const previousContext = globalUserContext;
  globalUserContext = context;

  if (context) {
    const contextChanged =
      !previousContext ||
      previousContext.id !== context.id ||
      previousContext.token !== context.token;

    if (_initialized && contextChanged) {
      console.log(
        "[AI Provider] User context changed, reinitializing models...",
      );
      _initialized = false;
    }
  }
}

/**
 * Clear the global user context
 * Call this after bot/background operations complete
 */
export function clearAIUserContext() {
  globalUserContext = null;
}

/**
 * Get the current user context
 */
export function getAIUserContext(): AIUserContext | null {
  return globalUserContext;
}

/**
 * Create a custom fetch function that adds user JWT token
 * @param userContext - Optional user context for authentication
 * @param options - Options including keepalive for connection reuse
 */
function createFetchWithContext(
  userContext?: AIUserContext | null,
  options?: { keepalive?: boolean },
): typeof fetch {
  const baseFetch = options?.keepalive ? createKeepAliveFetch() : fetch;

  return async (url, init) => {
    const headers = new Headers(init?.headers);

    if (userContext) {
      if (!userContext.token) {
        const error = new Error(
          "[AI Provider] Cloud auth token is required but not provided. " +
            "Please ensure you are logged in with cloud authentication.",
        );
        console.error(error.message);
        throw error;
      }

      headers.set("Authorization", `Bearer ${userContext.token}`);
    }

    return baseFetch(url, {
      ...init,
      headers,
      keepalive: options?.keepalive ?? true, // Default to keepalive for connection reuse
    });
  };
}

/**
 * Get the appropriate base URL for LLM API
 * - Native: Use local proxy (/api/ai/v1)
 * - Web (cloud + local dev): Use external AI provider directly
 */
function getLLMBaseUrl(isNativeMode: boolean): string {
  if (isNativeMode) {
    const isDev = process.env.NODE_ENV !== "production";
    const localUrl =
      process.env.NEXT_PUBLIC_APP_URL ||
      (isDev
        ? `http://localhost:${DEV_PORT}`
        : `http://localhost:${PROD_PORT}`);
    const proxyPath = "/api/ai/v1";
    const fullLocalUrl = `${localUrl}${proxyPath}`;
    return fullLocalUrl;
  }

  const externalUrl = process.env.LLM_BASE_URL;
  if (!externalUrl) {
    throw new Error("LLM_BASE_URL environment variable is not set (web mode)");
  }
  console.log(
    "[LLM Provider] Using external AI provider (web mode):",
    externalUrl,
  );
  return externalUrl;
}

/**
 * Validate and get required environment variables
 * @returns Validated environment variables
 * @throws Error if any required environment variable is missing
 */
function getValidatedEnv(isNativeMode: boolean) {
  const baseUrl = getLLMBaseUrl(isNativeMode);

  const apiKey = isNativeMode
    ? "local-auth-via-jwt-token"
    : process.env.LLM_API_KEY;

  if (!isNativeMode && !apiKey) {
    throw new Error("LLM_API_KEY environment variable is not set (web mode)");
  }

  const modelName = process.env.LLM_MODEL;

  if (!modelName) {
    throw new Error("LLM_MODEL environment variable is not set");
  }

  return {
    baseUrl,
    apiKey,
    modelName,
    imageModelName: process.env.LLM_IMAGE_MODEL,
    vlmModelName: process.env.LLM_VISION_LANGUAGE_MODEL || modelName,
  };
}

/**
 * Lazy initialization of models
 * Only creates models when first accessed, not at module load time
 */
let _model: LanguageModel | null = null;
let _vlmModel: LanguageModel | null = null;
let _modelProvider: any = null;
let _initialized = false;

function initializeModels(isNativeMode: boolean) {
  if (_initialized) return;

  const env = getValidatedEnv(isNativeMode);
  const { baseUrl, apiKey, modelName, imageModelName, vlmModelName } = env;

  const userContext = globalUserContext;

  const shouldUseCustomFetch =
    userContext && (!isNativeMode || userContext.token);

  // Use keepalive fetch to reduce TTFT through connection reuse
  const customFetch = shouldUseCustomFetch
    ? createFetchWithContext(userContext, { keepalive: true })
    : createKeepAliveFetch();

  if (userContext && isNativeMode && !userContext.token) {
    console.warn(
      "[AI Provider] Bot operation in native environment without cloud token - may fail",
    );
  }

  _model = createOpenAICompatible({
    baseURL: baseUrl,
    name: "chat-model",
    apiKey: apiKey,
    fetch: customFetch,
  }).chatModel(modelName);

  _vlmModel = createOpenAICompatible({
    baseURL: baseUrl,
    name: "vlm-model",
    apiKey: apiKey,
    fetch: customFetch,
  }).chatModel(vlmModelName);

  const imageModels = imageModelName
    ? {
        "small-model": createOpenAICompatible({
          baseURL: baseUrl,
          name: "image-model",
          apiKey: apiKey,
          fetch: customFetch,
        }).imageModel(imageModelName),
      }
    : undefined;

  _modelProvider = customProvider({
    languageModels: {
      "chat-model": _model,
      "vlm-model": _vlmModel,
      "title-model": _model,
      "artifact-model": _model,
    },
    imageModels,
  });

  _initialized = true;
}

/**
 * Get the chat model
 * Lazily initializes models on first access
 */
export function getModel(isNativeMode: boolean): LanguageModel {
  if (!_initialized) {
    initializeModels(isNativeMode);
  }
  if (!_model) {
    throw new Error("Model not initialized");
  }
  return _model;
}

/**
 * Get the VLM (Vision Language Model)
 * Lazily initializes models on first access
 */
export function getVLMModel(isNativeMode: boolean): LanguageModel {
  if (!_initialized) {
    initializeModels(isNativeMode);
  }
  if (!_vlmModel) {
    throw new Error("VLM model not initialized");
  }
  return _vlmModel;
}

/**
 * Create a dynamic model with the specified model name
 * This allows using any model (e.g., from OpenRouter) at request time
 */
export function createDynamicModel(
  isNativeMode: boolean,
  modelName?: string,
): LanguageModel {
  if (!_initialized) {
    initializeModels(isNativeMode);
  }

  const env = getValidatedEnv(isNativeMode);
  const actualModelName = modelName || env.modelName;

  const userContext = globalUserContext;

  const shouldUseCustomFetch =
    userContext && (!isNativeMode || userContext.token);

  // Use keepalive fetch to reduce TTFT through connection reuse
  const customFetch = shouldUseCustomFetch
    ? createFetchWithContext(userContext, { keepalive: true })
    : createKeepAliveFetch();

  const debugFetch = customFetch
    ? async (url: RequestInfo | URL, init?: RequestInit) => {
        const urlStr =
          typeof url === "string"
            ? url
            : url instanceof URL
              ? url.toString()
              : url.url;
        if (urlStr.includes("openrouter.ai/api/v1/chat/completions")) {
          console.log(`[OpenRouter Request Debug] URL: ${urlStr}`);
          if (init?.body) {
            const bodyStr =
              typeof init.body === "string"
                ? init.body
                : JSON.stringify(init.body);
            try {
              const bodyObj = JSON.parse(bodyStr);
              console.log(`[OpenRouter Request Debug] Model: ${bodyObj.model}`);
              if (bodyObj.tools) {
                console.log(
                  `[OpenRouter Request Debug] Tools count: ${bodyObj.tools.length}`,
                );
                bodyObj.tools.forEach((tool: any, idx: number) => {
                  const toolName = tool.function?.name || tool.name;
                  console.log(
                    `[OpenRouter Request Debug] Tool[${idx}] name: "${toolName}"`,
                  );
                });
              }
            } catch (e) {
              console.log(
                "[OpenRouter Request Debug] Body (parse failed):",
                bodyStr,
              );
            }
          }
        }
        return customFetch(url, init);
      }
    : undefined;

  console.log(
    `[Dynamic Model] Creating model with name: ${actualModelName}, baseUrl: ${env.baseUrl}`,
  );

  return createOpenAICompatible({
    baseURL: env.baseUrl,
    name: "dynamic-model",
    apiKey: env.apiKey,
    fetch: debugFetch,
  }).chatModel(actualModelName);
}

/**
 * Get the model provider
 * Lazily initializes models on first access
 */
export function getModelProvider(isNativeMode: boolean): any {
  if (!_initialized) {
    initializeModels(isNativeMode);
  }
  if (!_modelProvider) {
    throw new Error("Model provider not initialized");
  }
  return _modelProvider;
}
