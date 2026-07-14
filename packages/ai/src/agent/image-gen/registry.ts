import type { ImageGenProvider } from "./base";
import type {
  ImageGenerationCapabilities,
  ImageGenerationRequest,
  ImageGenerationResponse,
} from "./types";

const providers = new Map<string, ImageGenProvider>();

export function registerImageGenProvider(provider: ImageGenProvider): void {
  providers.set(provider.name, provider);
}

export function getImageGenProvider(
  name: string,
): ImageGenProvider | undefined {
  return providers.get(name);
}

export function getAllImageGenProviders(): ImageGenProvider[] {
  return Array.from(providers.values());
}

export function getDefaultImageGenProvider(): ImageGenProvider | undefined {
  for (const provider of providers.values()) {
    if (provider.isAvailable()) {
      return provider;
    }
  }
  return undefined;
}

export async function generateImage(
  request: ImageGenerationRequest,
): Promise<ImageGenerationResponse> {
  const requestedProvider = normalizeProviderName(request.provider);
  const provider = requestedProvider
    ? getImageGenProvider(requestedProvider)
    : getDefaultImageGenProvider();
  const model = request.model || "unknown";
  const imageCount = normalizeImageCount(request.imageCount ?? request.n);

  if (!provider) {
    return {
      success: false,
      provider: requestedProvider || "unknown",
      model,
      prompt: request.prompt,
      modality:
        request.referenceImageUrls?.length || request.referenceImages?.length
          ? "image"
          : "text",
      imageCount,
      error: requestedProvider
        ? `Image generation provider not registered: ${requestedProvider}`
        : "No image generation provider available",
      errorType: "provider_not_found",
    };
  }

  return provider.generate({
    ...request,
    provider: provider.name,
    imageCount,
  });
}

export function getImageGenProviderCapabilities(
  name: string,
): ImageGenerationCapabilities | null {
  const provider = getImageGenProvider(name);
  return provider ? provider.capabilities() : null;
}

export function __resetImageGenProvidersForTests(): void {
  providers.clear();
}

function normalizeProviderName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeImageCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 1;
  return Math.max(1, Math.min(4, Math.floor(value)));
}
