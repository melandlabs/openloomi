import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/app/(auth)/auth";
import {
  deleteUserEmbeddingSetting,
  getUserEmbeddingSetting,
  getUserEmbeddingSettingWithApiKey,
  upsertUserEmbeddingSetting,
} from "@/lib/db/queries";
import { getConfiguredEmbeddingProvider } from "@openloomi/rag";
import { AppError } from "@openloomi/shared/errors";

const embeddingSettingSchema = z.object({
  providerType: z.enum(["cloud", "local"]),
  apiKey: z.string().max(4096).nullable().optional(),
  baseUrl: z.string().max(2048).nullable().optional(),
  model: z.string().max(512).nullable().optional(),
  device: z.string().max(64).nullable().optional(),
  localFilesOnly: z.boolean().optional(),
  enabled: z.boolean().optional(),
});

const systemDefaults = {
  providerType:
    process.env.EMBEDDING_PROVIDER?.trim().toLowerCase() === "local"
      ? ("local" as const)
      : ("cloud" as const),
  cloud: {
    baseUrl:
      process.env.LLM_EMBEDDING_BASE_URL ?? "https://openrouter.ai/api/v1",
    model: process.env.LLM_EMBEDDING_MODEL ?? "text-embedding-3-small",
    hasApiKey: Boolean(
      process.env.OPENAI_EMBEDDINGS_API_KEY ||
      process.env.OPENROUTER_API_KEY ||
      process.env.LLM_API_KEY,
    ),
  },
  local: {
    model: process.env.LOCAL_EMBEDDING_MODEL ?? "Xenova/all-MiniLM-L6-v2",
    device: process.env.LOCAL_EMBEDDING_DEVICE ?? "cpu",
    localFilesOnly: process.env.LOCAL_EMBEDDING_LOCAL_ONLY === "true",
  },
};

function normalizeOptionalString(value: string | null | undefined) {
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function invalidPayloadResponse() {
  return new AppError(
    "bad_request:api",
    "Invalid embedding settings payload",
  ).toResponse();
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return new AppError("unauthorized:chat").toResponse();
  }

  try {
    const setting = await getUserEmbeddingSetting(session.user.id);
    return NextResponse.json({ setting, systemDefaults });
  } catch (error) {
    console.error("[Embedding Preferences] Failed to load settings", error);
    if (error instanceof AppError) return error.toResponse();
    return new AppError(
      "bad_request:database",
      "Unable to load embedding settings",
    ).toResponse();
  }
}

export async function PUT(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return new AppError("unauthorized:chat").toResponse();
  }

  const parsed = embeddingSettingSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    console.error(
      "[Embedding Preferences] Invalid payload",
      parsed.error.flatten(),
    );
    return invalidPayloadResponse();
  }

  try {
    const setting = await upsertUserEmbeddingSetting({
      userId: session.user.id,
      ...parsed.data,
    });
    return NextResponse.json({ setting });
  } catch (error) {
    console.error("[Embedding Preferences] Failed to save settings", error);
    if (error instanceof AppError) return error.toResponse();
    return new AppError(
      "bad_request:database",
      "Unable to save embedding settings",
    ).toResponse();
  }
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return new AppError("unauthorized:chat").toResponse();
  }

  const parsed = embeddingSettingSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) return invalidPayloadResponse();

  try {
    const saved = await getUserEmbeddingSettingWithApiKey(session.user.id);
    const savedForProvider =
      saved?.providerType === parsed.data.providerType ? saved : null;
    const model =
      normalizeOptionalString(parsed.data.model) ??
      savedForProvider?.model ??
      (parsed.data.providerType === "local"
        ? systemDefaults.local.model
        : systemDefaults.cloud.model);

    if (!model) {
      return NextResponse.json(
        { ok: false, error: "Missing embedding model." },
        { status: 400 },
      );
    }

    const provider =
      parsed.data.providerType === "local"
        ? getConfiguredEmbeddingProvider({
            providerType: "local",
            local: {
              modelName: model,
              device:
                normalizeOptionalString(parsed.data.device) ??
                savedForProvider?.device ??
                systemDefaults.local.device,
              localFilesOnly:
                parsed.data.localFilesOnly ??
                savedForProvider?.localFilesOnly ??
                systemDefaults.local.localFilesOnly,
            },
          })
        : getConfiguredEmbeddingProvider({
            providerType: "cloud",
            cloud: {
              apiKey:
                normalizeOptionalString(parsed.data.apiKey) ??
                saved?.apiKey ??
                undefined,
              baseURL:
                normalizeOptionalString(parsed.data.baseUrl) ??
                savedForProvider?.baseUrl ??
                systemDefaults.cloud.baseUrl,
              modelName: model,
            },
          });

    const embedding = await provider.embedQuery("OpenLoomi embedding test");
    if (!embedding.length || !embedding.every(Number.isFinite)) {
      throw new Error("Provider returned an invalid embedding vector.");
    }

    return NextResponse.json({
      ok: true,
      model: provider.getModelName(),
      dimensions: embedding.length,
    });
  } catch (error) {
    console.error("[Embedding Preferences] Provider test failed", error);
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error ? error.message : "Embedding test failed.",
      },
      { status: 400 },
    );
  }
}

export async function DELETE() {
  const session = await auth();
  if (!session?.user?.id) {
    return new AppError("unauthorized:chat").toResponse();
  }

  try {
    await deleteUserEmbeddingSetting(session.user.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[Embedding Preferences] Failed to reset settings", error);
    if (error instanceof AppError) return error.toResponse();
    return new AppError(
      "bad_request:database",
      "Unable to reset embedding settings",
    ).toResponse();
  }
}
