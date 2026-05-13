import { auth } from "@/app/(auth)/auth";
import { db } from "@/lib/db/queries";
import { insight } from "@/lib/db/schema";
import { AppError } from "@openloomi/shared/errors";
import { inArray } from "drizzle-orm";

type Importance = "low" | "medium" | "high";

/**
 * Batch update Insight importance
 * POST /api/insights/batch/importance
 * Body: { ids: string[], importance: "low" | "medium" | "high" }
 */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return new AppError("unauthorized:insight").toResponse();
  }

  try {
    const body = await request.json();
    const { ids, importance } = body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return new AppError(
        "bad_request:insight",
        "ids must be a non-empty array",
      ).toResponse();
    }

    if (!["low", "medium", "high"].includes(importance)) {
      return new AppError(
        "bad_request:insight",
        "importance must be one of: low, medium, high",
      ).toResponse();
    }

    const now = new Date();

    // Batch update importance
    await db
      .update(insight)
      .set({
        importance: importance as Importance,
        updatedAt: now,
      })
      .where(inArray(insight.id, ids));

    return Response.json(
      {
        success: true,
        message: `${ids.length} insights importance updated to ${importance}`,
        data: {
          ids,
          importance,
        },
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("[Insights] Batch importance update failed:", error);

    if (error instanceof AppError) {
      return error.toResponse();
    }

    return new AppError("bad_request:database", String(error)).toResponse();
  }
}
