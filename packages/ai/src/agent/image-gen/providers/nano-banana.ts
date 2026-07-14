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

const DEFAULT_MODEL = "nano-banana";
const DEFAULT_SIZE = "1024x1024";

const NANO_BANANA_MODELS: ImageModelInfo[] = [
  {
    id: "nano-banana",
    name: "nano-banana",
    displayName: "Nano Banana",
    supportedModality: ["text"],
    supportedSizes: ["1024x1024", "1024x1536", "1536x1024", "auto"],
    supportedQualities: ["auto", "low", "medium", "high"],
    supportedOutputFormats: ["png", "jpeg", "webp"],
  },
];

const NANO_BANANA_CAPABILITIES: ImageGenerationCapabilities = {
  supportsTextToImage: true,
  supportsImageReference: false,
  supportsUrlOutput: true,
  supportsBase64Output: true,
  supportedSizes: ["1024x1024", "1024x1536", "1536x1024", "auto"],
  supportedQualities: ["auto", "low", "medium", "high"],
  supportedOutputFormats: ["png", "jpeg", "webp"],
};

type NanoBananaImageGenProviderOptions = {
  apiKey?: string;
  baseUrl?: string;
  imageGenerationUrl?: string;
  defaultModel?: string;
  timeoutMs?: number;
};

type ProviderImageCandidate = {
  url?: unknown;
  image_url?: unknown;
  b64_json?: unknown;
  base64?: unknown;
  data_url?: unknown;
  image?: unknown;
  revised_prompt?: unknown;
};

export class NanoBananaImageGenProvider extends ImageGenProvider {
  private apiKey?: string;
  private baseUrl?: string;
  private imageGenerationUrl?: string;
  private model: string;
  private timeoutMs: number;

  constructor(options: NanoBananaImageGenProviderOptions = {}) {
    super();
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl;
    this.imageGenerationUrl = options.imageGenerationUrl;
    this.model = options.defaultModel || DEFAULT_MODEL;
    this.timeoutMs = options.timeoutMs || 120_000;
  }

  get name(): string {
    return "nano-banana";
  }

  get displayName(): string {
    return "Nano Banana";
  }

  isAvailable(): boolean {
    return Boolean(this.apiKey?.trim() && this.resolveEndpoint());
  }

  listModels(): ImageModelInfo[] {
    return NANO_BANANA_MODELS;
  }

  defaultModel(): string | null {
    return this.isAvailable() ? this.model : null;
  }

  capabilities(): ImageGenerationCapabilities {
    return NANO_BANANA_CAPABILITIES;
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
    const endpoint = this.resolveEndpoint();

    if (!this.apiKey?.trim() || !endpoint) {
      return failure({
        model,
        prompt: request.prompt,
        imageCount,
        modality,
        creditsUsed,
        error:
          "Nano Banana provider is not configured. Set NANO_BANANA_API_KEY and NANO_BANANA_IMAGE_GENERATION_URL or NANO_BANANA_BASE_URL.",
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
          "Reference images are not supported by the Day 1 Nano Banana text-to-image provider.",
        errorType: "validation_error",
      });
    }

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "x-api-key": this.apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(buildPayload(request, model, imageCount)),
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      const text = await response.text();
      const parsed = parseJson<Record<string, unknown>>(text);

      if (!response.ok) {
        return failure({
          model,
          prompt: request.prompt,
          imageCount,
          modality,
          creditsUsed,
          error:
            extractErrorMessage(parsed) ||
            `Nano Banana API error ${response.status}: ${text}`,
          errorType: mapStatusToErrorType(response.status),
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
          error: "Nano Banana API returned no image data",
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
            : "Nano Banana image generation failed",
        errorType: isTimeout ? "timeout" : "unknown_error",
      });
    }
  }

  private resolveEndpoint(): string | undefined {
    const direct = normalizeOptionalString(this.imageGenerationUrl);
    if (direct) return direct;

    const base = normalizeOptionalString(this.baseUrl);
    if (!base) return undefined;
    const normalized = base.replace(/\/+$/, "");
    if (normalized.endsWith("/images/generations")) return normalized;
    if (normalized.endsWith("/v1")) return `${normalized}/images/generations`;
    return `${normalized}/v1/images/generations`;
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

  if (request.quality) payload.quality = request.quality;
  if (request.outputFormat) payload.output_format = request.outputFormat;
  if (request.responseFormat) {
    payload.response_format =
      request.responseFormat === "data_url"
        ? "b64_json"
        : request.responseFormat;
  }

  return payload;
}

function normalizeImages(
  result: Record<string, unknown> | null,
  outputFormat?: ImageGenerationOutputFormat,
): GeneratedImage[] {
  const candidates = collectCandidates(result);
  const mimeType = mimeTypeForOutputFormat(outputFormat);
  return candidates
    .map((candidate): GeneratedImage | null => {
      const revisedPrompt =
        typeof candidate.revised_prompt === "string"
          ? candidate.revised_prompt
          : undefined;
      const url = firstString(candidate.url, candidate.image_url);
      if (url) {
        return isDataUrl(url)
          ? dataUrlImage(url, revisedPrompt)
          : { imageUrl: url, mimeType, revisedPrompt };
      }

      const dataUrl = firstString(candidate.data_url);
      if (dataUrl) return dataUrlImage(dataUrl, revisedPrompt);

      const encoded = firstString(candidate.b64_json, candidate.base64);
      if (encoded) return base64Image(encoded, mimeType, revisedPrompt);

      if (typeof candidate.image === "string") {
        if (isDataUrl(candidate.image)) {
          return dataUrlImage(candidate.image, revisedPrompt);
        }
        if (isHttpUrl(candidate.image)) {
          return {
            imageUrl: candidate.image,
            mimeType,
            revisedPrompt,
          };
        }
        return base64Image(candidate.image, mimeType, revisedPrompt);
      }

      return null;
    })
    .filter((image): image is GeneratedImage => image !== null);
}

function collectCandidates(
  result: Record<string, unknown> | null,
): ProviderImageCandidate[] {
  if (!result) return [];
  const candidates: ProviderImageCandidate[] = [];
  for (const key of ["data", "images", "output", "result"]) {
    const value = result[key];
    if (Array.isArray(value)) {
      candidates.push(...(value as ProviderImageCandidate[]));
    } else if (value && typeof value === "object") {
      candidates.push(value as ProviderImageCandidate);
    }
  }
  candidates.push(result as ProviderImageCandidate);
  return candidates;
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
    provider: "nano-banana",
    model: args.model,
    prompt: args.prompt,
    modality: args.modality,
    imageCount: args.imageCount,
    creditsUsed: args.creditsUsed,
    error: args.error,
    errorType: args.errorType,
  };
}

function dataUrlImage(dataUrl: string, revisedPrompt?: string): GeneratedImage {
  const mimeType = dataUrl.slice(5, dataUrl.indexOf(";base64,")) || "image/png";
  return {
    b64Json: stripDataUrlPrefix(dataUrl),
    dataUrl,
    mimeType,
    revisedPrompt,
  };
}

function base64Image(
  base64: string,
  mimeType: string,
  revisedPrompt?: string,
): GeneratedImage {
  const b64Json = stripDataUrlPrefix(base64);
  return {
    b64Json,
    dataUrl: `data:${mimeType};base64,${b64Json}`,
    mimeType,
    revisedPrompt,
  };
}

function mapStatusToErrorType(
  status: number,
): ImageGenerationResponse["errorType"] {
  if (status === 401 || status === 403) return "configuration_error";
  if (status === 429) return "rate_limit";
  if (status >= 500) return "provider_error";
  return "provider_error";
}

function extractErrorMessage(
  result: Record<string, unknown> | null,
): string | undefined {
  const error = result?.error;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  const message = result?.message;
  return typeof message === "string" ? message : undefined;
}

function parseJson<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
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

function isDataUrl(value: string): boolean {
  return /^data:image\/[a-z0-9.+-]+;base64,/i.test(value);
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}
