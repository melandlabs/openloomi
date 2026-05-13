import { auth } from "@/app/(auth)/auth";
import {
  getInsightFilterById,
  removeInsightFilterForUser,
  updateInsightFilterForUser,
} from "@/lib/db/queries";
import { AppError } from "@openloomi/shared/errors";
import {
  insightFilterUpdateSchema,
  sanitizeColorToken,
} from "@/lib/insights/filter-schema";
import { toInsightFilterResponse } from "@/lib/insights/filter-utils";
import { NextResponse } from "next/server";
import { z } from "zod";

const paramsSchema = z.object({
  filterId: z.uuid(),
});

const deleteQuerySchema = z.object({
  hard: z
    .string()
    .optional()
    .transform((value) => value === "true"),
});

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ filterId: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return new AppError("unauthorized:insight").toResponse();
  }
  const data = await params;
  const parsedParams = paramsSchema.safeParse(data);
  if (!parsedParams.success) {
    return new AppError(
      "bad_request:insight",
      `Invalid filter id ${data.filterId}`,
    ).toResponse();
  }

  const record = await getInsightFilterById({
    userId: session.user.id,
    filterId: parsedParams.data.filterId,
  });

  if (!record) {
    return new AppError("not_found:insight", "Filter not found").toResponse();
  }

  return NextResponse.json(toInsightFilterResponse(record));
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ filterId: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return new AppError("unauthorized:insight").toResponse();
  }
  const data = await params;

  const parsedParams = paramsSchema.safeParse(data);
  if (!parsedParams.success) {
    return new AppError(
      "bad_request:insight",
      `Invalid filter id ${data.filterId}`,
    ).toResponse();
  }

  const rawBody = await request.json().catch((error) => {
    console.error("[InsightFilters] Invalid update payload", error);
    return null;
  });
  if (!rawBody) {
    return new AppError(
      "bad_request:insight",
      "Invalid update payload",
    ).toResponse();
  }

  const parsed = insightFilterUpdateSchema.safeParse(rawBody);
  if (!parsed.success) {
    return new AppError(
      "bad_request:insight",
      parsed.error.issues[0]?.message ?? "Invalid update payload",
    ).toResponse();
  }

  const payload = {
    ...parsed.data,
    color:
      typeof parsed.data.color === "string"
        ? sanitizeColorToken(parsed.data.color)
        : parsed.data.color === null
          ? null
          : undefined,
  };

  try {
    const record = await updateInsightFilterForUser({
      userId: session.user.id,
      filterId: parsedParams.data.filterId,
      payload,
    });

    if (!record) {
      return new AppError("not_found:insight", "Filter not found").toResponse();
    }

    return NextResponse.json(toInsightFilterResponse(record));
  } catch (error) {
    console.error("[InsightFilters] Update failed", error);
    if (error instanceof AppError) {
      return error.toResponse();
    }
    return new AppError(
      "bad_request:insight",
      "Unable to update filter",
    ).toResponse();
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ filterId: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return new AppError("unauthorized:insight").toResponse();
  }
  const data = await params;

  const parsedParams = paramsSchema.safeParse(data);
  if (!parsedParams.success) {
    return new AppError(
      "bad_request:insight",
      `Invalid filter id ${data.filterId}`,
    ).toResponse();
  }

  const url = new URL(request.url);
  const query = deleteQuerySchema.safeParse({
    hard: url.searchParams.get("hard") ?? undefined,
  });
  if (!query.success) {
    return new AppError(
      "bad_request:insight",
      "Invalid delete params",
    ).toResponse();
  }

  const removed = await removeInsightFilterForUser({
    userId: session.user.id,
    filterId: parsedParams.data.filterId,
    hardDelete: query.data.hard,
  });

  if (!removed) {
    return new AppError("not_found:insight", "Filter not found").toResponse();
  }

  return NextResponse.json({ success: true });
}
