import {
  __resetImageGenProvidersForTests,
  generateImage,
  NanoBananaImageGenProvider,
  OpenAIImageGenProvider,
  OpenRouterImageGenProvider,
  registerImageGenProvider,
  type ImageGenerationRequest,
  type ImageGenerationResponse,
} from "@openloomi/ai/agent";

let providersRegistered = false;

export async function generateImageForApi(
  request: ImageGenerationRequest,
): Promise<ImageGenerationResponse> {
  ensureImageGenerationProvidersRegistered();
  return generateImage({
    ...request,
    provider:
      normalizeOptionalString(request.provider) ||
      normalizeOptionalString(process.env.IMAGE_GENERATION_PROVIDER),
  });
}

export function ensureImageGenerationProvidersRegistered(): void {
  if (providersRegistered) return;

  registerImageGenProvider(
    new OpenAIImageGenProvider({
      apiKey: normalizeOptionalString(process.env.OPENAI_API_KEY),
      baseUrl: normalizeOptionalString(process.env.OPENAI_IMAGE_BASE_URL),
      imageGenerationUrl: normalizeOptionalString(
        process.env.OPENAI_IMAGE_GENERATION_URL,
      ),
      defaultModel: normalizeOptionalString(process.env.OPENAI_IMAGE_MODEL),
      timeoutMs: normalizePositiveInteger(
        process.env.OPENAI_IMAGE_TIMEOUT_MS ||
          process.env.IMAGE_GENERATION_TIMEOUT_MS,
      ),
    }),
  );

  registerImageGenProvider(
    new OpenRouterImageGenProvider({
      apiKey: normalizeOptionalString(process.env.OPENROUTER_API_KEY),
      baseUrl: normalizeOptionalString(process.env.OPENROUTER_IMAGE_BASE_URL),
      imageGenerationUrl: normalizeOptionalString(
        process.env.OPENROUTER_IMAGE_GENERATION_URL,
      ),
      defaultModel: normalizeOptionalString(process.env.OPENROUTER_IMAGE_MODEL),
      timeoutMs: normalizePositiveInteger(
        process.env.OPENROUTER_IMAGE_TIMEOUT_MS ||
          process.env.IMAGE_GENERATION_TIMEOUT_MS,
      ),
      referer: normalizeOptionalString(process.env.NEXT_PUBLIC_APP_URL),
      title: "OpenLoomi",
    }),
  );

  registerImageGenProvider(
    new NanoBananaImageGenProvider({
      apiKey: normalizeOptionalString(process.env.NANO_BANANA_API_KEY),
      baseUrl: normalizeOptionalString(process.env.NANO_BANANA_BASE_URL),
      imageGenerationUrl: normalizeOptionalString(
        process.env.NANO_BANANA_IMAGE_GENERATION_URL,
      ),
      defaultModel: normalizeOptionalString(process.env.NANO_BANANA_MODEL),
      timeoutMs: normalizePositiveInteger(
        process.env.NANO_BANANA_TIMEOUT_MS ||
          process.env.IMAGE_GENERATION_TIMEOUT_MS,
      ),
    }),
  );

  providersRegistered = true;
}

export function __resetImageGenerationServiceForTests(): void {
  providersRegistered = false;
  __resetImageGenProvidersForTests();
}

function normalizeOptionalString(
  value: string | null | undefined,
): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizePositiveInteger(
  value: string | null | undefined,
): number | undefined {
  const normalized = normalizeOptionalString(value);
  if (!normalized) return undefined;
  const parsed = Number.parseInt(normalized, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}
