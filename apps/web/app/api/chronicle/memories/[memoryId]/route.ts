import { auth } from "@/app/(auth)/auth";
import { AppError } from "@openloomi/shared/errors";
import { NextResponse } from "next/server";

/**
 * DELETE /api/chronicle/memories/[memoryId]
 * Delete a screen memory (insight with taskLabel = "chronicle_screen")
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ memoryId: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return new AppError("unauthorized:api").toResponse();
  }

  try {
    const { memoryId } = await params;
    const userId = session.user.id;

    const { db } = await import("@/lib/db");
    const { eq, and } = await import("drizzle-orm");
    const { insight } = await import("@/lib/db/schema");

    // Verify ownership and that it's a chronicle memory before deleting
    const rows = await db
      .select({ id: insight.id })
      .from(insight)
      .where(
        and(
          eq(insight.id, memoryId),
          eq(insight.taskLabel, "chronicle_screen"),
        ),
      )
      .limit(1);

    if (rows.length === 0) {
      return new AppError("not_found:api", "Memory not found").toResponse();
    }

    // Check ownership via bot relation (insight.botId -> bot.userId)
    const { bot } = await import("@/lib/db/schema");
    const insightRow = await db
      .select({ botId: insight.botId })
      .from(insight)
      .where(eq(insight.id, memoryId))
      .limit(1);

    if (insightRow.length === 0) {
      return new AppError("not_found:api", "Memory not found").toResponse();
    }

    const botRows = await db
      .select({ userId: bot.userId })
      .from(bot)
      .where(eq(bot.id, insightRow[0].botId))
      .limit(1);

    if (botRows.length === 0 || botRows[0].userId !== userId) {
      return new AppError("not_found:api", "Memory not found").toResponse();
    }

    await db.delete(insight).where(eq(insight.id, memoryId));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[Chronicle] Failed to delete memory:", error);
    return new AppError(
      "bad_request:api",
      "Failed to delete memory",
    ).toResponse();
  }
}
