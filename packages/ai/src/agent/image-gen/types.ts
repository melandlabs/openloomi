export type ImageGenerationProviderName = "openai" | "nano-banana" | string;

export type ImageGenerationQuality =
  | "auto"
  | "low"
  | "medium"
  | "high"
  | "standard"
  | "hd";

export type ImageGenerationOutputFormat = "png" | "jpeg" | "webp";

export type ImageGenerationResponseFormat = "url" | "b64_json" | "data_url";

export type ImageGenerationModality = "text" | "image";

export type ImageGenerationErrorType =
  | "configuration_error"
  | "validation_error"
  | "provider_not_found"
  | "provider_error"
  | "rate_limit"
  | "safety_blocked"
  | "timeout"
  | "unknown_error";

export interface ImageReference {
  url?: string;
  b64Json?: string;
  dataUrl?: string;
  mimeType?: string;
}

export interface ImageGenerationRequest {
  provider?: ImageGenerationProviderName;
  model?: string;
  prompt: string;
  size?: string;
  aspectRatio?: string;
  quality?: ImageGenerationQuality;
  outputFormat?: ImageGenerationOutputFormat;
  responseFormat?: ImageGenerationResponseFormat;
  imageCount?: number;
  n?: number;
  referenceImageUrls?: string[];
  referenceImages?: ImageReference[];
  metadata?: Record<string, unknown>;
}

export interface GeneratedImage {
  imageUrl?: string;
  b64Json?: string;
  dataUrl?: string;
  mimeType: string;
  revisedPrompt?: string;
}

export interface ImageGenerationResponse {
  success: boolean;
  provider: string;
  model: string;
  prompt: string;
  modality: ImageGenerationModality;
  imageCount: number;
  images?: GeneratedImage[];
  imageUrl?: string;
  b64Json?: string;
  dataUrl?: string;
  mimeType?: string;
  creditsUsed?: number;
  error?: string;
  errorType?: ImageGenerationErrorType;
}

export interface ImageModelInfo {
  id: string;
  name: string;
  displayName: string;
  supportedModality: ImageGenerationModality[];
  supportedSizes: string[];
  supportedQualities: ImageGenerationQuality[];
  supportedOutputFormats: ImageGenerationOutputFormat[];
}

export interface ImageGenerationCapabilities {
  supportsTextToImage: boolean;
  supportsImageReference: boolean;
  supportsUrlOutput: boolean;
  supportsBase64Output: boolean;
  supportedSizes: string[];
  supportedQualities: ImageGenerationQuality[];
  supportedOutputFormats: ImageGenerationOutputFormat[];
}
