import { auth } from "@/app/(auth)/auth";
import { generateImageForApi } from "@/lib/ai/image-generation/service";
import { recordImageGenerationUsage } from "@/lib/ai/image-generation/usage";
import { isTauriMode } from "@/lib/env/constants";
import type {
  ImageGenerationRequest,
  ImageGenerationResponse,
} from "@openloomi/ai/agent";

export const runtime = "nodejs";

type ImageGenerationBody = {
  prompt?: unknown;
  provider?: unknown;
  model?: unknown;
  size?: unknown;
  aspectRatio?: unknown;
  quality?: unknown;
  outputFormat?: unknown;
  responseFormat?: unknown;
  imageCount?: unknown;
  n?: unknown;
  referenceImageUrls?: unknown;
  referenceImages?: unknown;
};

export async function POST(request: Request) {
  const session = await auth().catch(() => null);
  if (!session?.user?.id && !isTauriMode()) {
    return Response.json(
      { error: "Unauthorized", code: "unauthorized:auth" },
      { status: 401 },
    );
  }

  const body = (await request
    .json()
    .catch(() => null)) as ImageGenerationBody | null;
  const normalized = normalizeImageGenerationBody(body);

  if (!normalized.ok) {
    return Response.json(
      {
        success: false,
        error: normalized.error,
        errorType: "validation_error",
      },
      { status: 400 },
    );
  }

  const result = await generateImageForApi(normalized.request);
  await recordUsageSafely(session?.user?.id ?? null, result);
  return Response.json(result, {
    status: result.success ? 200 : statusFromErrorType(result.errorType),
  });
}

async function recordUsageSafely(
  userId: string | null,
  result: ImageGenerationResponse,
): Promise<void> {
  try {
    await recordImageGenerationUsage({
      userId,
      endpoint: "api/ai/v1/images/generations",
      provider: result.provider,
      model: result.model,
      imageCount: result.imageCount,
      creditsUsed: result.creditsUsed ?? 0,
      status: result.success ? "success" : "failed",
      errorType: result.errorType,
      costMode: "estimated",
      quotaMode: "record_only",
      createdAt: new Date(),
    });
  } catch (error) {
    console.warn("[image-generation] usage tracking failed", error);
  }
}

function normalizeImageGenerationBody(
  body: ImageGenerationBody | null,
):
  | { ok: true; request: ImageGenerationRequest }
  | { ok: false; error: string } {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Invalid image generation payload" };
  }

  const prompt = normalizeRequiredString(body.prompt);
  if (!prompt) {
    return { ok: false, error: "prompt is required" };
  }

  const imageCount = normalizeImageCount(body.imageCount ?? body.n);
  return {
    ok: true,
    request: {
      prompt,
      provider: normalizeOptionalString(body.provider),
      model: normalizeOptionalString(body.model),
      size: normalizeOptionalString(body.size),
      aspectRatio: normalizeOptionalString(body.aspectRatio),
      quality: normalizeQuality(body.quality),
      outputFormat: normalizeOutputFormat(body.outputFormat),
      responseFormat: normalizeResponseFormat(body.responseFormat),
      imageCount,
      n: imageCount,
      referenceImageUrls: normalizeStringArray(body.referenceImageUrls),
      referenceImages: Array.isArray(body.referenceImages)
        ? (body.referenceImages as ImageGenerationRequest["referenceImages"])
        : undefined,
    },
  };
}

function statusFromErrorType(errorType?: string): number {
  switch (errorType) {
    case "configuration_error":
    case "validation_error":
    case "provider_not_found":
      return 400;
    case "rate_limit":
      return 429;
    case "timeout":
      return 504;
    case "provider_error":
      return 502;
    default:
      return 500;
  }
}

function normalizeRequiredString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeImageCount(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.max(1, Math.min(4, Math.floor(value)));
}

function normalizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const normalized = value
    .map((item) => normalizeOptionalString(item))
    .filter((item): item is string => Boolean(item));
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeQuality(
  value: unknown,
): ImageGenerationRequest["quality"] | undefined {
  const normalized = normalizeOptionalString(value);
  if (
    normalized === "auto" ||
    normalized === "low" ||
    normalized === "medium" ||
    normalized === "high" ||
    normalized === "standard" ||
    normalized === "hd"
  ) {
    return normalized;
  }
  return undefined;
}

function normalizeOutputFormat(
  value: unknown,
): ImageGenerationRequest["outputFormat"] | undefined {
  const normalized = normalizeOptionalString(value);
  if (normalized === "png" || normalized === "jpeg" || normalized === "webp") {
    return normalized;
  }
  return undefined;
}

function normalizeResponseFormat(
  value: unknown,
): ImageGenerationRequest["responseFormat"] | undefined {
  const normalized = normalizeOptionalString(value);
  if (
    normalized === "url" ||
    normalized === "b64_json" ||
    normalized === "data_url"
  ) {
    return normalized;
  }
  return undefined;
}
