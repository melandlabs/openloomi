import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/app/(auth)/auth";
import {
  deleteUserLlmApiSetting,
  getUserLlmApiSettings,
  upsertUserLlmApiSetting,
} from "@/lib/db/queries";
import { AppError } from "@openloomi/shared/errors";

const providerTypeSchema = z.enum([
  "openai_compatible",
  "anthropic_compatible",
]);

const llmApiSettingSchema = z.object({
  providerType: providerTypeSchema,
  apiKey: z.string().max(4096).nullable().optional(),
  baseUrl: z.string().max(2048).nullable().optional(),
  model: z.string().max(256).nullable().optional(),
  enabled: z.boolean().optional(),
});

const systemDefaults = {
  openai_compatible: {
    baseUrl: process.env.LLM_BASE_URL ?? null,
    model: process.env.LLM_MODEL ?? null,
    hasApiKey: Boolean(process.env.LLM_API_KEY),
  },
  anthropic_compatible: {
    baseUrl: process.env.ANTHROPIC_BASE_URL ?? null,
    model: process.env.ANTHROPIC_MODEL ?? process.env.LLM_MODEL ?? null,
    hasApiKey: Boolean(
      process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_API_KEY,
    ),
  },
} as const;

function invalidPayloadResponse() {
  return new AppError(
    "bad_request:api",
    "Invalid AI API settings payload",
  ).toResponse();
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return new AppError("unauthorized:chat").toResponse();
  }

  try {
    const settings = await getUserLlmApiSettings(session.user.id);
    return NextResponse.json({
      settings,
      systemDefaults,
    });
  } catch (error) {
    console.error("[AI Preferences] Failed to load settings", error);
    if (error instanceof AppError) {
      return error.toResponse();
    }
    return new AppError(
      "bad_request:database",
      "Unable to load AI API settings",
    ).toResponse();
  }
}

export async function PUT(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return new AppError("unauthorized:chat").toResponse();
  }

  const rawPayload = await request.json().catch((error) => {
    console.error("[AI Preferences] Invalid JSON", error);
    return null;
  });

  if (!rawPayload) {
    return invalidPayloadResponse();
  }

  const parsed = llmApiSettingSchema.safeParse(rawPayload);
  if (!parsed.success) {
    console.error("[AI Preferences] Invalid payload", parsed.error.flatten());
    return invalidPayloadResponse();
  }

  try {
    const setting = await upsertUserLlmApiSetting({
      userId: session.user.id,
      ...parsed.data,
    });

    return NextResponse.json({ setting });
  } catch (error) {
    console.error("[AI Preferences] Failed to save settings", error);
    if (error instanceof AppError) {
      return error.toResponse();
    }
    return new AppError(
      "bad_request:database",
      "Unable to save AI API settings",
    ).toResponse();
  }
}

export async function DELETE(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return new AppError("unauthorized:chat").toResponse();
  }

  const { searchParams } = new URL(request.url);
  const parsedProviderType = providerTypeSchema.safeParse(
    searchParams.get("providerType"),
  );

  if (!parsedProviderType.success) {
    return invalidPayloadResponse();
  }

  try {
    await deleteUserLlmApiSetting({
      userId: session.user.id,
      providerType: parsedProviderType.data,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[AI Preferences] Failed to delete settings", error);
    if (error instanceof AppError) {
      return error.toResponse();
    }
    return new AppError(
      "bad_request:database",
      "Unable to delete AI API settings",
    ).toResponse();
  }
}
