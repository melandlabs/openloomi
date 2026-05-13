import { auth } from "@/app/(auth)/auth";
import { db } from "@/lib/db/queries";
import { insight, insightBriefCategories } from "@/lib/db/schema";
import { AppError } from "@openloomi/shared/errors";
import { eq, inArray, and } from "drizzle-orm";
import { isTauriMode } from "@/lib/env";
import type { InsightBriefCategory } from "@/lib/db/schema";

/**
 * Batch unpin Insights (remove from Brief panel)
 * DELETE /api/insights/batch/unpin
 * Body: { ids: string[] }
 */
export async function DELETE(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return new AppError("unauthorized:insight").toResponse();
  }

  try {
    const body = await request.json();
    const { ids } = body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return new AppError(
        "bad_request:insight",
        "ids must be a non-empty array",
      ).toResponse();
    }

    // Get all insights records
    const insights = await db
      .select()
      .from(insight)
      .where(inArray(insight.id, ids));

    // Get existing brief category records
    const existingCategories = await db
      .select()
      .from(insightBriefCategories)
      .where(
        and(
          eq(insightBriefCategories.userId, session.user.id),
          inArray(insightBriefCategories.insightId, ids),
        ),
      );

    const existingMap = new Map<string, InsightBriefCategory>(
      existingCategories.map((c: InsightBriefCategory) => [c.insightId, c]),
    );

    // Process each insight
    for (const insightRecord of insights) {
      const existing = existingMap.get(insightRecord.id);

      if (existing) {
        // Update record, mark as unpinned state
        await db
          .update(insightBriefCategories)
          .set({
            source: "unpinned",
            assignedAt: new Date(),
          })
          .where(eq(insightBriefCategories.id, existing.id));
      }

      // Remove "keep-focused" from categories
      const currentCategories = Array.isArray(insightRecord.categories)
        ? insightRecord.categories
        : typeof insightRecord.categories === "string"
          ? JSON.parse(insightRecord.categories || "[]")
          : [];
      const updatedCategories = currentCategories.filter(
        (c: string) => c !== "keep-focused",
      );

      if (isTauriMode()) {
        await db
          .update(insight)
          .set({
            categories: JSON.stringify(updatedCategories),
            updatedAt: new Date(),
          })
          .where(eq(insight.id, insightRecord.id));
      } else {
        await db
          .update(insight)
          .set({
            categories: updatedCategories,
            updatedAt: new Date(),
          })
          .where(eq(insight.id, insightRecord.id));
      }
    }

    return Response.json(
      {
        success: true,
        message: `${ids.length} insights unpinned from Brief panel successfully`,
        data: {
          ids,
          isPinned: false,
        },
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("[Insights] Batch unpin failed:", error);

    if (error instanceof AppError) {
      return error.toResponse();
    }

    return new AppError("bad_request:database", String(error)).toResponse();
  }
}
