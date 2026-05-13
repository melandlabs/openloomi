import { auth } from "@/app/(auth)/auth";
import { db } from "@/lib/db/queries";
import { insight } from "@/lib/db/schema";
import { AppError } from "@openloomi/shared/errors";
import { eq } from "drizzle-orm";
import { applyFavoriteBoost } from "@/lib/insights/weight-adjustment";

/**
 * Favorite or unfavorite an Insight
 * POST /api/insights/[id]/favorite
 * Body: { favorited: boolean }
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  // Verify user identity
  const session = await auth();
  if (!session?.user) {
    return new AppError("unauthorized:insight").toResponse();
  }

  try {
    const { id } = await params;

    if (!id) {
      return new AppError(
        "bad_request:insight",
        "Insight ID is required",
      ).toResponse();
    }

    // Parse request body
    const body = await request.json();
    const { favorited } = body;

    if (typeof favorited !== "boolean") {
      return new AppError(
        "bad_request:insight",
        "favorited must be a boolean",
      ).toResponse();
    }

    // Update favorite status
    const now = new Date();
    await db
      .update(insight)
      .set({
        isFavorited: favorited,
        favoritedAt: favorited ? now : null,
        updatedAt: now,
      })
      .where(eq(insight.id, id));

    // Apply weight adjustment (increase weight when favoriting, restore default when unfavoriting)
    try {
      await applyFavoriteBoost(id, session.user.id, favorited, db);
    } catch (weightError) {
      // Weight adjustment failure does not affect favorite function, only log error
      console.error("[Insights] Failed to adjust weight:", weightError);
    }

    return Response.json(
      {
        success: true,
        message: favorited
          ? "Insight favorited successfully"
          : "Insight unfavorited successfully",
        data: {
          id,
          isFavorited: favorited,
          favoritedAt: favorited ? now.toISOString() : null,
        },
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("[Insights] Favorite failed:", error);

    if (error instanceof AppError) {
      return error.toResponse();
    }

    return new AppError("bad_request:database", String(error)).toResponse();
  }
}
