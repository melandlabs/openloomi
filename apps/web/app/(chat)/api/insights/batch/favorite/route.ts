import { auth } from "@/app/(auth)/auth";
import { db } from "@/lib/db/queries";
import { insight } from "@/lib/db/schema";
import { AppError } from "@openloomi/shared/errors";
import { inArray } from "drizzle-orm";
import { applyFavoriteBoost } from "@/lib/insights/weight-adjustment";

/**
 * Batch favorite/unfavorite Insights
 * POST /api/insights/batch/favorite
 * Body: { ids: string[], favorited: boolean }
 */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return new AppError("unauthorized:insight").toResponse();
  }

  try {
    const body = await request.json();
    const { ids, favorited } = body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return new AppError(
        "bad_request:insight",
        "ids must be a non-empty array",
      ).toResponse();
    }

    if (typeof favorited !== "boolean") {
      return new AppError(
        "bad_request:insight",
        "favorited must be a boolean",
      ).toResponse();
    }

    const now = new Date();

    // Batch update favorite status
    await db
      .update(insight)
      .set({
        isFavorited: favorited,
        favoritedAt: favorited ? now : null,
        updatedAt: now,
      })
      .where(inArray(insight.id, ids));

    // Apply weight adjustment
    for (const id of ids) {
      try {
        await applyFavoriteBoost(id, session.user.id, favorited, db);
      } catch (weightError) {
        console.error("[Insights] Failed to adjust weight:", weightError);
      }
    }

    return Response.json(
      {
        success: true,
        message: favorited
          ? `${ids.length} insights favorited successfully`
          : `${ids.length} insights unfavorited successfully`,
        data: {
          ids,
          isFavorited: favorited,
          favoritedAt: favorited ? now.toISOString() : null,
        },
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("[Insights] Batch favorite failed:", error);

    if (error instanceof AppError) {
      return error.toResponse();
    }

    return new AppError("bad_request:database", String(error)).toResponse();
  }
}
