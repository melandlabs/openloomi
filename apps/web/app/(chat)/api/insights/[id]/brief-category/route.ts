import { auth } from "@/app/(auth)/auth";
import { db } from "@/lib/db/queries";
import { insight, insightBriefCategories } from "@/lib/db/schema";
import { AppError } from "@openloomi/shared/errors";
import { eq, and } from "drizzle-orm";

type Category = "urgent" | "important" | "monitor" | "archive";

/**
 * Update Insight category in Brief panel
 * POST /api/insights/[id]/brief-category
 * Body: { category: "urgent" | "important" | "monitor" | "archive" }
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

    // Parse request body
    const body = await request.json();
    const { category } = body;

    // Validate category value
    if (
      typeof category !== "string" ||
      !["urgent", "important", "monitor", "archive"].includes(category)
    ) {
      return new AppError(
        "bad_request:insight",
        "category must be one of: urgent, important, monitor, archive",
      ).toResponse();
    }

    // Get insight information for auto-matching
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

    // Upsert: Update if exists, otherwise insert
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
      // Update existing record
      await db
        .update(insightBriefCategories)
        .set({
          category: category as Category,
          assignedAt: new Date(),
        })
        .where(eq(insightBriefCategories.id, existing[0].id));
    } else {
      // Insert new record
      await db.insert(insightBriefCategories).values({
        userId: session.user.id,
        insightId: id,
        category: category as Category,
        dedupeKey: insightRecord.dedupeKey,
        title: insightRecord.title,
        source: "manual",
      });
    }

    return Response.json(
      {
        success: true,
        message: "Brief category updated successfully",
        data: {
          id,
          category: category as Category,
        },
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("[Insights] Brief category update failed:", error);

    if (error instanceof AppError) {
      return error.toResponse();
    }

    return new AppError("bad_request:database", String(error)).toResponse();
  }
}

/**
 * Get category information for specified insight
 * GET /api/insights/[id]/brief-category
 *
 * Returns the category of this insight in the brief panel (returns user-defined category if exists, otherwise null)
 */
export async function GET(
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

    // Check if user-defined category exists
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

    let category: Category | null = null;
    if (existing && existing.length > 0 && existing[0].source !== "unpinned") {
      category = existing[0].category as Category;
    }

    return Response.json(
      {
        success: true,
        data: {
          id,
          category,
        },
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("[Insights] Get brief category failed:", error);

    if (error instanceof AppError) {
      return error.toResponse();
    }

    return new AppError("bad_request:database", String(error)).toResponse();
  }
}
