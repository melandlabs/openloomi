import {
  composeLifestyleImagePrompt,
  type LifestyleReferenceImageInput,
} from "@/lib/ai/image-generation/lifestyle-composer";
import { generateImageForApi } from "@/lib/ai/image-generation/service";
import { recordImageGenerationUsage } from "@/lib/ai/image-generation/usage";
import { getAuthUser } from "@/lib/auth/dual-auth";
import type {
  ImageGenerationRequest,
  ImageGenerationResponse,
} from "@openloomi/ai/agent";

export const runtime = "nodejs";

type LifestyleGenerateBody = {
  chatId?: unknown;
  triggerPrompt?: unknown;
  provider?: unknown;
  model?: unknown;
  size?: unknown;
  aspectRatio?: unknown;
  quality?: unknown;
  outputFormat?: unknown;
  responseFormat?: unknown;
  imageCount?: unknown;
  n?: unknown;
  days?: unknown;
  recentInsightLimit?: unknown;
  chatMessageLimit?: unknown;
  passReferenceImagesToProvider?: unknown;
  referenceImages?: unknown;
};

export async function POST(request: Request) {
  const user = await getAuthUser(request).catch(() => null);
  if (!user?.id) {
    return Response.json(
      { error: "Unauthorized", code: "unauthorized:auth" },
      { status: 401 },
    );
  }

  const body = (await request
    .json()
    .catch(() => ({}))) as LifestyleGenerateBody | null;
  if (!body || typeof body !== "object") {
    return Response.json(
      {
        success: false,
        error: "Invalid lifestyle image generation payload",
        errorType: "validation_error",
      },
      { status: 400 },
    );
  }

  const imageCount = normalizeImageCount(body.imageCount ?? body.n);
  const composed = await composeLifestyleImagePrompt({
    userId: user.id,
    chatId: normalizeOptionalString(body.chatId),
    triggerPrompt: normalizeOptionalString(body.triggerPrompt),
    referenceImages: normalizeReferenceImages(body.referenceImages),
    days: normalizePositiveInteger(body.days),
    recentInsightLimit: normalizePositiveInteger(body.recentInsightLimit),
    chatMessageLimit: normalizePositiveInteger(body.chatMessageLimit),
    passReferenceImagesToProvider: body.passReferenceImagesToProvider === true,
    generation: {
      provider: normalizeOptionalString(body.provider),
      model: normalizeOptionalString(body.model),
      size: normalizeOptionalString(body.size),
      aspectRatio: normalizeOptionalString(body.aspectRatio),
      quality: normalizeQuality(body.quality),
      outputFormat: normalizeOutputFormat(body.outputFormat),
      responseFormat: normalizeResponseFormat(body.responseFormat),
      imageCount,
      n: imageCount,
    },
  });

  const imageResult = await generateImageForApi(
    composed.imageGenerationRequest,
  );
  await recordUsageSafely(user.id, imageResult);

  return Response.json(
    {
      success: imageResult.success,
      prompt: composed.prompt,
      sourceSummary: composed.sourceSummary,
      warnings: composed.warnings,
      imageGeneration: imageResult,
      usage: {
        provider: imageResult.provider,
        model: imageResult.model,
        imageCount: imageResult.imageCount,
        creditsUsed: imageResult.creditsUsed ?? 0,
        costMode: "estimated",
        quotaMode: "record_only",
      },
      images: imageResult.images,
      imageUrl: imageResult.imageUrl,
      b64Json: imageResult.b64Json,
      dataUrl: imageResult.dataUrl,
      mimeType: imageResult.mimeType,
      error: imageResult.error,
      errorType: imageResult.errorType,
    },
    {
      status: imageResult.success
        ? 200
        : statusFromErrorType(imageResult.errorType),
    },
  );
}

async function recordUsageSafely(
  userId: string | null,
  result: ImageGenerationResponse,
): Promise<void> {
  try {
    await recordImageGenerationUsage({
      userId,
      endpoint: "api/ai/v1/images/lifestyle/generate",
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
    console.warn("[lifestyle-image-generation] usage tracking failed", error);
  }
}

function normalizeReferenceImages(
  value: unknown,
): LifestyleReferenceImageInput[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const normalized = value
    .filter((item): item is Record<string, unknown> =>
      Boolean(item && typeof item === "object"),
    )
    .map((item) => ({
      fileId: normalizeOptionalString(item.fileId),
      url: normalizeOptionalString(item.url),
      dataUrl: normalizeOptionalString(item.dataUrl),
      b64Json: normalizeOptionalString(item.b64Json),
      mimeType: normalizeOptionalString(item.mimeType),
      role: normalizeReferenceRole(item.role),
      note: normalizeOptionalString(item.note),
    }));

  return normalized.length > 0 ? normalized : undefined;
}

function normalizeReferenceRole(
  value: unknown,
): LifestyleReferenceImageInput["role"] | undefined {
  return value === "style" || value === "subject" ? value : undefined;
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizePositiveInteger(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const normalized = Math.floor(value);
  return normalized > 0 ? normalized : undefined;
}

function normalizeImageCount(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.max(1, Math.min(4, Math.floor(value)));
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
