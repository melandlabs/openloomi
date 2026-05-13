import { auth } from "@/app/(auth)/auth";
import {
  createInsightFilterForUser,
  listInsightFilters,
} from "@/lib/db/queries";
import { AppError } from "@openloomi/shared/errors";
import {
  insightFilterCreateSchema,
  sanitizeColorToken,
} from "@/lib/insights/filter-schema";
import { toInsightFilterResponse } from "@/lib/insights/filter-utils";
import { NextResponse } from "next/server";
import { z } from "zod";

const querySchema = z.object({
  includeArchived: z
    .string()
    .optional()
    .transform((value) => value === "true"),
});

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return new AppError("unauthorized:insight").toResponse();
  }

  const url = new URL(request.url);
  const query = querySchema.safeParse({
    includeArchived: url.searchParams.get("includeArchived") ?? undefined,
  });

  if (!query.success) {
    return new AppError(
      "bad_request:insight",
      query.error.message,
    ).toResponse();
  }

  try {
    const filters = await listInsightFilters({
      userId: session.user.id,
      includeArchived: query.data.includeArchived,
    });
    return NextResponse.json({
      filters: filters.map(toInsightFilterResponse),
    });
  } catch (error) {
    console.error("[InsightFilters] List failed", error);
    if (error instanceof AppError) {
      return error.toResponse();
    }
    return new AppError(
      "bad_request:insight",
      "Unable to load filters",
    ).toResponse();
  }
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return new AppError("unauthorized:insight").toResponse();
  }

  const rawBody = await request.json().catch((error) => {
    console.error("[InsightFilters] Invalid payload", error);
    return null;
  });
  if (!rawBody) {
    return new AppError(
      "bad_request:insight",
      "Invalid filter payload",
    ).toResponse();
  }

  const parsed = insightFilterCreateSchema.safeParse(rawBody);
  if (!parsed.success) {
    return new AppError(
      "bad_request:insight",
      parsed.error.issues[0]?.message ?? "Invalid filter payload",
    ).toResponse();
  }

  const normalizedColor =
    parsed.data.color && sanitizeColorToken(parsed.data.color);
  const payload = {
    ...parsed.data,
    color: normalizedColor ?? undefined,
  };

  try {
    const record = await createInsightFilterForUser({
      userId: session.user.id,
      payload,
    });
    return NextResponse.json(toInsightFilterResponse(record), { status: 201 });
  } catch (error) {
    console.error("[InsightFilters] Create failed", error);
    if (error instanceof AppError) {
      return error.toResponse();
    }
    return new AppError(
      "bad_request:insight",
      "Unable to create filter",
    ).toResponse();
  }
}
