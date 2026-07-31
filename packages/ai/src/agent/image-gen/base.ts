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

  protected referenceImageDataUrls(request: ImageGenerationRequest): string[] {
    const urls = request.referenceImageUrls
      ?.map((url) => url.trim())
      .filter(Boolean);
    const images = request.referenceImages
      ?.map((image) => this.referenceImageToDataUrl(image))
      .filter((image): image is string => Boolean(image));
    return [...(urls ?? []), ...(images ?? [])];
  }

  protected referenceImageFiles(request: ImageGenerationRequest): Array<{
    blob: Blob;
    filename: string;
  }> {
    return this.referenceImageDataUrls(request)
      .map((value, index) => this.dataUrlToFile(value, index))
      .filter(
        (file): file is { blob: Blob; filename: string } => file !== null,
      );
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

  private referenceImageToDataUrl(
    image: NonNullable<ImageGenerationRequest["referenceImages"]>[number],
  ): string | null {
    if (image.dataUrl?.trim()) return image.dataUrl.trim();
    const encoded = image.b64Json?.trim();
    if (!encoded) return null;
    return this.dataUrlFromBase64(encoded, image.mimeType || "image/png");
  }

  private dataUrlToFile(
    value: string,
    index: number,
  ): { blob: Blob; filename: string } | null {
    const parsed = parseDataUrl(value);
    if (!parsed) return null;
    const bytes = Buffer.from(parsed.b64Json, "base64");
    return {
      blob: new Blob([bytes], { type: parsed.mimeType }),
      filename: `reference-${index + 1}.${extensionForMimeType(
        parsed.mimeType,
      )}`,
    };
  }
}

function parseDataUrl(
  value: string,
): { mimeType: string; b64Json: string } | null {
  const match = value.trim().match(/^data:([^;,]+);base64,(.+)$/i);
  if (!match) return null;
  return {
    mimeType: match[1].toLowerCase(),
    b64Json: match[2],
  };
}

function extensionForMimeType(mimeType: string): string {
  switch (mimeType.toLowerCase()) {
    case "image/jpeg":
      return "jpg";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    default:
      return "png";
  }
}
