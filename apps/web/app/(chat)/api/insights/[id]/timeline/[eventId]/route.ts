import { auth } from "@/app/(auth)/auth";
import { AppError } from "@openloomi/shared/errors";
import type { NextRequest } from "next/server";
import { timelineHistoryService } from "@/lib/insights/timeline-history";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { insight } from "@/lib/db/schema";

/**
 * GET /api/insights/:id/timeline/:eventId/history
 *
 * Get the version history of a specific timeline event
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; eventId: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return new AppError("unauthorized:insight").toResponse();
  }

  const { id: insightId, eventId } = await params;

  if (!insightId || !eventId) {
    return new AppError(
      "bad_request:api",
      "Insight id and event id are required",
    ).toResponse();
  }

  try {
    // Verify that the insight belongs to the user
    const insights = await db
      .select()
      .from(insight)
      .where(eq(insight.id, insightId))
      .limit(1);

    if (insights.length === 0) {
      return new AppError("not_found:insight").toResponse();
    }

    const insightRecord = insights[0];

    // Verify ownership through the bot
    const { getBotById } = await import("@/lib/db/queries");
    const bot = await getBotById({ id: insightRecord.botId });
    if (!bot || bot.userId !== session.user.id) {
      return new AppError("forbidden:insight").toResponse();
    }

    // Get timeline event history
    const history = await timelineHistoryService.getEventHistory(eventId);

    return Response.json({
      eventId,
      history,
    });
  } catch (error) {
    console.error("Failed to get timeline event history:", error);
    return new AppError(
      "bad_request:api",
      `Failed to get timeline event history: ${error instanceof Error ? error.message : String(error)}`,
    ).toResponse();
  }
}
