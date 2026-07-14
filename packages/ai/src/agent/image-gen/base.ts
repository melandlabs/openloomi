import type {
  ImageGenerationCapabilities,
  ImageGenerationModality,
  ImageGenerationRequest,
  ImageGenerationResponse,
  ImageModelInfo,
} from "./types";

export abstract class ImageGenProvider {
  abstract get name(): string;
  abstract get displayName(): string;

  abstract isAvailable(): boolean;
  abstract listModels(): ImageModelInfo[];
  abstract defaultModel(): string | null;
  abstract capabilities(): ImageGenerationCapabilities;

  abstract generate(
    request: ImageGenerationRequest,
  ): Promise<ImageGenerationResponse>;

  protected routeModality(
    request: Pick<
      ImageGenerationRequest,
      "referenceImageUrls" | "referenceImages"
    >,
  ): ImageGenerationModality {
    return request.referenceImageUrls?.length || request.referenceImages?.length
      ? "image"
      : "text";
  }

  protected dataUrlFromBase64(base64: string, mimeType = "image/png"): string {
    const stripped = this.stripDataUrlPrefix(base64);
    return `data:${mimeType};base64,${stripped}`;
  }

  protected stripDataUrlPrefix(value: string): string {
    const trimmed = value.trim();
    const marker = ";base64,";
    const markerIndex = trimmed.indexOf(marker);
    return markerIndex >= 0
      ? trimmed.slice(markerIndex + marker.length)
      : trimmed;
  }

  protected async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
