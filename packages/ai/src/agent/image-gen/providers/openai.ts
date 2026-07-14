import { calculateImageCredits } from "../../billing/model-pricing";
import { ImageGenProvider } from "../base";
import type {
  GeneratedImage,
  ImageGenerationCapabilities,
  ImageGenerationOutputFormat,
  ImageGenerationQuality,
  ImageGenerationRequest,
  ImageGenerationResponse,
  ImageModelInfo,
} from "../types";

const OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_MODEL = "gpt-image-2";
const DEFAULT_SIZE = "1024x1024";

const OPENAI_IMAGE_MODELS: ImageModelInfo[] = [
  {
    id: "gpt-image-2",
    name: "gpt-image-2",
    displayName: "GPT-Image-2",
    supportedModality: ["text"],
    supportedSizes: ["1024x1024", "1024x1536", "1536x1024", "auto"],
    supportedQualities: ["auto", "low", "medium", "high"],
    supportedOutputFormats: ["png", "jpeg", "webp"],
  },
];

const OPENAI_CAPABILITIES: ImageGenerationCapabilities = {
  supportsTextToImage: true,
  supportsImageReference: false,
  supportsUrlOutput: false,
  supportsBase64Output: true,
  supportedSizes: ["1024x1024", "1024x1536", "1536x1024", "auto"],
  supportedQualities: ["auto", "low", "medium", "high"],
  supportedOutputFormats: ["png", "jpeg", "webp"],
};

type OpenAIImageGenProviderOptions = {
  apiKey?: string;
  baseUrl?: string;
  imageGenerationUrl?: string;
  defaultModel?: string;
  timeoutMs?: number;
};

type OpenAIImageResponse = {
  data?: Array<{
    b64_json?: string;
    url?: string;
    revised_prompt?: string;
  }>;
  error?: {
    message?: string;
    type?: string;
    code?: string;
  };
};

export class OpenAIImageGenProvider extends ImageGenProvider {
  private apiKey?: string;
  private baseUrl: string;
  private imageGenerationUrl?: string;
  private model: string;
  private timeoutMs: number;

  constructor(options: OpenAIImageGenProviderOptions = {}) {
    super();
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl || OPENAI_BASE_URL;
    this.imageGenerationUrl = options.imageGenerationUrl;
    this.model = options.defaultModel || DEFAULT_MODEL;
    this.timeoutMs = options.timeoutMs || 120_000;
  }

  get name(): string {
    return "openai";
  }

  get displayName(): string {
    return "OpenAI Images";
  }

  isAvailable(): boolean {
    return Boolean(this.apiKey?.trim());
  }

  listModels(): ImageModelInfo[] {
    return OPENAI_IMAGE_MODELS;
  }

  defaultModel(): string | null {
    return this.isAvailable() ? this.model : null;
  }

  capabilities(): ImageGenerationCapabilities {
    return OPENAI_CAPABILITIES;
  }

  async generate(
    request: ImageGenerationRequest,
  ): Promise<ImageGenerationResponse> {
    const model = request.model || this.model;
    const imageCount = normalizeImageCount(request.imageCount ?? request.n);
    const modality = this.routeModality(request);
    const creditsUsed = calculateImageCredits(
      model,
      imageCount,
      qualityForBilling(request.quality),
    );

    if (!this.apiKey?.trim()) {
      return failure({
        model,
        prompt: request.prompt,
        imageCount,
        modality,
        creditsUsed,
        error: "OPENAI_API_KEY is not configured",
        errorType: "configuration_error",
      });
    }

    if (modality === "image") {
      return failure({
        model,
        prompt: request.prompt,
        imageCount,
        modality,
        creditsUsed,
        error:
          "Reference images are not supported by the Day 1 OpenAI text-to-image provider.",
        errorType: "validation_error",
      });
    }

    try {
      const response = await fetch(
        buildImagesUrl(this.baseUrl, this.imageGenerationUrl),
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(buildPayload(request, model, imageCount)),
          signal: AbortSignal.timeout(this.timeoutMs),
        },
      );

      const text = await response.text();
      const parsed = parseJson<OpenAIImageResponse>(text);

      if (!response.ok) {
        return failure({
          model,
          prompt: request.prompt,
          imageCount,
          modality,
          creditsUsed,
          error:
            parsed?.error?.message ||
            `OpenAI image API error ${response.status}: ${text}`,
          errorType: mapStatusToErrorType(response.status, parsed?.error?.type),
        });
      }

      const images = normalizeImages(parsed, request.outputFormat);
      if (images.length === 0) {
        return failure({
          model,
          prompt: request.prompt,
          imageCount,
          modality,
          creditsUsed,
          error: "OpenAI image API returned no image data",
          errorType: "provider_error",
        });
      }

      const first = images[0];
      return {
        success: true,
        provider: this.name,
        model,
        prompt: request.prompt,
        modality,
        imageCount: images.length,
        images,
        imageUrl: first.imageUrl,
        b64Json: first.b64Json,
        dataUrl: first.dataUrl,
        mimeType: first.mimeType,
        creditsUsed,
      };
    } catch (error) {
      const isTimeout =
        error instanceof DOMException && error.name === "TimeoutError";
      return failure({
        model,
        prompt: request.prompt,
        imageCount,
        modality,
        creditsUsed,
        error:
          error instanceof Error
            ? error.message
            : "OpenAI image generation failed",
        errorType: isTimeout ? "timeout" : "unknown_error",
      });
    }
  }
}

function buildPayload(
  request: ImageGenerationRequest,
  model: string,
  imageCount: number,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    model,
    prompt: request.prompt,
    n: imageCount,
    size: request.size || DEFAULT_SIZE,
  };

  if (request.quality) {
    payload.quality = request.quality;
  }

  if (request.outputFormat) {
    payload.output_format = request.outputFormat;
  }

  if (usesLegacyImageResponseFormat(model) && request.responseFormat) {
    payload.response_format =
      request.responseFormat === "data_url"
        ? "b64_json"
        : request.responseFormat;
  }

  return payload;
}

function buildImagesUrl(baseUrl: string, imageGenerationUrl?: string): string {
  const direct = normalizeOptionalString(imageGenerationUrl);
  if (direct) return direct;

  const normalized = baseUrl.replace(/\/+$/, "");
  return normalized.endsWith("/v1")
    ? `${normalized}/images/generations`
    : `${normalized}/v1/images/generations`;
}

function usesLegacyImageResponseFormat(model: string): boolean {
  const normalized = model.toLowerCase();
  return normalized.startsWith("dall-e-");
}

function normalizeImages(
  result: OpenAIImageResponse | null,
  outputFormat?: ImageGenerationOutputFormat,
): GeneratedImage[] {
  const mimeType = mimeTypeForOutputFormat(outputFormat);
  return (result?.data || [])
    .map((item): GeneratedImage | null => {
      if (item.b64_json) {
        const b64Json = stripDataUrlPrefix(item.b64_json);
        return {
          b64Json,
          dataUrl: `data:${mimeType};base64,${b64Json}`,
          mimeType,
          revisedPrompt: item.revised_prompt,
        };
      }
      if (item.url) {
        return {
          imageUrl: item.url,
          mimeType,
          revisedPrompt: item.revised_prompt,
        };
      }
      return null;
    })
    .filter((image): image is GeneratedImage => image !== null);
}

function failure(args: {
  model: string;
  prompt: string;
  imageCount: number;
  modality: "text" | "image";
  creditsUsed: number;
  error: string;
  errorType: ImageGenerationResponse["errorType"];
}): ImageGenerationResponse {
  return {
    success: false,
    provider: "openai",
    model: args.model,
    prompt: args.prompt,
    modality: args.modality,
    imageCount: args.imageCount,
    creditsUsed: args.creditsUsed,
    error: args.error,
    errorType: args.errorType,
  };
}

function mapStatusToErrorType(
  status: number,
  providerType?: string,
): ImageGenerationResponse["errorType"] {
  if (status === 401 || status === 403) return "configuration_error";
  if (status === 429) return "rate_limit";
  if (providerType?.includes("safety")) return "safety_blocked";
  if (status >= 500) return "provider_error";
  return "provider_error";
}

function parseJson<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function normalizeOptionalString(
  value: string | null | undefined,
): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeImageCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 1;
  return Math.max(1, Math.min(4, Math.floor(value)));
}

function qualityForBilling(
  quality: ImageGenerationQuality | undefined,
): "standard" | "hd" {
  return quality === "high" || quality === "hd" ? "hd" : "standard";
}

function mimeTypeForOutputFormat(
  outputFormat?: ImageGenerationOutputFormat,
): string {
  switch (outputFormat) {
    case "jpeg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    default:
      return "image/png";
  }
}

function stripDataUrlPrefix(value: string): string {
  const marker = ";base64,";
  const trimmed = value.trim();
  const markerIndex = trimmed.indexOf(marker);
  return markerIndex >= 0
    ? trimmed.slice(markerIndex + marker.length)
    : trimmed;
}
