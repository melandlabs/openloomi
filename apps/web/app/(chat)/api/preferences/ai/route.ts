import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/app/(auth)/auth";
import {
  deleteUserLlmApiSetting,
  getUserLlmApiSettingWithApiKey,
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

const llmApiTestSchema = llmApiSettingSchema.pick({
  providerType: true,
  apiKey: true,
  baseUrl: true,
  model: true,
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

function normalizeOptionalString(value: string | null | undefined) {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function buildVersionedUrl(baseUrl: string, pathAfterV1: string) {
  const normalized = baseUrl.replace(/\/+$/, "");
  if (normalized.endsWith("/v1")) {
    return `${normalized}${pathAfterV1}`;
  }
  return `${normalized}/v1${pathAfterV1}`;
}

async function readProviderError(response: Response) {
  const text = await response.text().catch(() => "");
  return text.trim().slice(0, 400);
}

async function testOpenAiCompatibleProvider({
  baseUrl,
  apiKey,
  model,
}: {
  baseUrl: string;
  apiKey: string;
  model: string;
}) {
  const response = await fetch(
    buildVersionedUrl(baseUrl, "/chat/completions"),
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 1,
        stream: false,
      }),
      signal: AbortSignal.timeout(15_000),
    },
  );

  if (!response.ok) {
    const detail = await readProviderError(response);
    throw new Error(
      detail || `Provider returned HTTP ${response.status.toString()}`,
    );
  }
}

async function testAnthropicCompatibleProvider({
  baseUrl,
  apiKey,
  model,
}: {
  baseUrl: string;
  apiKey: string;
  model: string;
}) {
  const response = await fetch(buildVersionedUrl(baseUrl, "/messages"), {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 1,
      messages: [{ role: "user", content: "ping" }],
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    const detail = await readProviderError(response);
    throw new Error(
      detail || `Provider returned HTTP ${response.status.toString()}`,
    );
  }
}

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

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return new AppError("unauthorized:chat").toResponse();
  }

  const rawPayload = await request.json().catch((error) => {
    console.error("[AI Preferences] Invalid test JSON", error);
    return null;
  });

  if (!rawPayload) {
    return invalidPayloadResponse();
  }

  const parsed = llmApiTestSchema.safeParse(rawPayload);
  if (!parsed.success) {
    console.error(
      "[AI Preferences] Invalid test payload",
      parsed.error.flatten(),
    );
    return invalidPayloadResponse();
  }

  try {
    const { providerType } = parsed.data;
    const saved = await getUserLlmApiSettingWithApiKey({
      userId: session.user.id,
      providerType,
    });
    const apiKey = normalizeOptionalString(parsed.data.apiKey) ?? saved?.apiKey;
    const baseUrl =
      normalizeOptionalString(parsed.data.baseUrl) ?? saved?.baseUrl;
    const model = normalizeOptionalString(parsed.data.model) ?? saved?.model;

    if (!apiKey || !baseUrl || !model) {
      return NextResponse.json(
        {
          ok: false,
          error: "Missing API key, base URL, or model.",
        },
        { status: 400 },
      );
    }

    if (providerType === "anthropic_compatible") {
      await testAnthropicCompatibleProvider({ baseUrl, apiKey, model });
    } else {
      await testOpenAiCompatibleProvider({ baseUrl, apiKey, model });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[AI Preferences] Provider test failed", error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Provider test failed.",
      },
      { status: 400 },
    );
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
