import { auth } from "@/app/(auth)/auth";
import { db } from "@/lib/db/queries";
import { insight, insightBriefCategories } from "@/lib/db/schema";
import { AppError } from "@openloomi/shared/errors";
import { eq, and } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { sortInsightsByEventRankEnhanced } from "@/lib/insights/event-rank";
import { isTauriMode } from "@/lib/env";

type Category = "urgent" | "important" | "monitor" | "archive";

/**
 * Pin insight to Brief panel
 * POST /api/insights/[id]/pin
 *
 * Pins an insight to the Brief panel by:
 * 1. Running EventRank to determine the appropriate category
 * 2. Creating a brief category assignment
 * 3. Adding "keep-focused" to the insight's categories (for UI state)
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  // Verify user identity
  const session = await auth();
  if (!session?.user?.id) {
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

    // Get insight details
    const insights = await db
      .select()
      .from(insight)
      .where(eq(insight.id, id))
      .limit(1);

    if (!insights || insights.length === 0) {
      return new AppError(
        "not_found:insight",
        "Insight not found",
      ).toResponse();
    }

    const insightRecord = insights[0];

    // Run EventRank algorithm to determine category
    const eventRankResult = await sortInsightsByEventRankEnhanced(
      [insightRecord],
      {
        useLLMDependencies: false,
        maxInsightsForLLM: 100,
      },
    );

    // Get EventRank category
    const category = eventRankResult.categories.get(id) || "monitor";

    // Check if brief category assignment already exists
    const existing = await db
      .select()
      .from(insightBriefCategories)
      .where(
        and(
          eq(insightBriefCategories.userId, session.user.id),
          eq(insightBriefCategories.insightId, id),
        ),
      )
      .limit(1);

    // Determine final category:
    // - If it's a new record, use EventRank result
    // - If it exists and is unpinned, use EventRank again (instead of keeping potentially outdated archive category)
    // - If it exists and is not unpinned, keep original category
    let finalCategory: Category;
    if (existing && existing.length > 0 && existing[0].source !== "unpinned") {
      // Already exists and not unpinned, keep original category
      finalCategory = existing[0].category as Category;
    } else {
      // New record or re-pin, use EventRank result
      // For archive category, change to monitor (ensure displayed in brief panel)
      finalCategory =
        (category as Category) === "archive"
          ? "monitor"
          : (category as Category);
    }

    if (existing && existing.length > 0) {
      // Already exists, update (if unpinned status, restore to manual)
      await db
        .update(insightBriefCategories)
        .set({
          category: finalCategory,
          source:
            existing[0].source === "unpinned" ? "manual" : existing[0].source,
          assignedAt: new Date(),
        })
        .where(eq(insightBriefCategories.id, existing[0].id));
    } else {
      // Create new record
      await db.insert(insightBriefCategories).values({
        userId: session.user.id,
        insightId: id,
        category: category as Category,
        dedupeKey: insightRecord.dedupeKey,
        title: insightRecord.title,
        source: "manual",
      });
    }

    // Update insight's categories, add "keep-focused" (for UI state display)
    // First unify parsing of categories (SQLite is JSON string, PostgreSQL is array)
    const currentCategories = Array.isArray(insightRecord.categories)
      ? insightRecord.categories
      : typeof insightRecord.categories === "string"
        ? JSON.parse(insightRecord.categories || "[]")
        : [];
    if (!currentCategories.includes("keep-focused")) {
      if (isTauriMode()) {
        // SQLite mode: need to convert back to JSON string
        const updatedCategories = [...currentCategories, "keep-focused"];
        await db
          .update(insight)
          .set({
            categories: JSON.stringify(updatedCategories),
            updatedAt: new Date(),
          })
          .where(eq(insight.id, id));
      } else {
        // PostgreSQL mode: use native array functions
        await db
          .update(insight)
          .set({
            categories: sql`array_append(${insight.categories}, 'keep-focused')`,
            updatedAt: new Date(),
          })
          .where(eq(insight.id, id));
      }
    }

    return Response.json(
      {
        success: true,
        message: "Insight pinned to Brief panel successfully",
        data: {
          id,
          category: category as Category,
          isPinned: true,
        },
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("[Insights] Pin to Brief failed:", error);

    if (error instanceof AppError) {
      return error.toResponse();
    }

    return new AppError("bad_request:database", String(error)).toResponse();
  }
}

/**
 * Unpin insight from Brief panel
 * DELETE /api/insights/[id]/pin
 *
 * Removes the insight from Brief panel by:
 * 1. Deleting the brief category assignment
 * 2. Removing "keep-focused" from the insight's categories
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  // Verify user identity
  const session = await auth();
  if (!session?.user?.id) {
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

    // Get insight details
    const insights = await db
      .select()
      .from(insight)
      .where(eq(insight.id, id))
      .limit(1);

    if (!insights || insights.length === 0) {
      return new AppError(
        "not_found:insight",
        "Insight not found",
      ).toResponse();
    }

    const insightRecord = insights[0];

    // Check if brief category record already exists
    const existing = await db
      .select()
      .from(insightBriefCategories)
      .where(
        and(
          eq(insightBriefCategories.userId, session.user.id),
          eq(insightBriefCategories.insightId, id),
        ),
      )
      .limit(1);

    if (existing && existing.length > 0) {
      // Update record, mark as unpinned status
      await db
        .update(insightBriefCategories)
        .set({
          source: "unpinned",
          assignedAt: new Date(),
        })
        .where(eq(insightBriefCategories.id, existing[0].id));
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
      // SQLite mode: categories is stored as JSON string, need to parse as array first
      const raw = insightRecord.categories;
      const currentCategories = Array.isArray(raw)
        ? (raw as string[])
        : typeof raw === "string"
          ? (JSON.parse(raw || "[]") as string[])
          : [];
      const updatedCategories = currentCategories.filter(
        (c: string) => c !== "keep-focused",
      );
      await db
        .update(insight)
        .set({
          categories: JSON.stringify(updatedCategories),
          updatedAt: new Date(),
        })
        .where(eq(insight.id, id));
    } else {
      await db
        .update(insight)
        .set({
          categories: sql`array_remove(${insight.categories}, 'keep-focused')`,
          updatedAt: new Date(),
        })
        .where(eq(insight.id, id));
    }

    return Response.json(
      {
        success: true,
        message: "Insight unpinned from Brief panel successfully",
        data: {
          id,
          isPinned: false,
        },
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("[Insights] Unpin from Brief failed:", error);

    if (error instanceof AppError) {
      return error.toResponse();
    }

    return new AppError("bad_request:database", String(error)).toResponse();
  }
}
