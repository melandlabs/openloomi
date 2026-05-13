import { auth } from "@/app/(auth)/auth";
import { db } from "@/lib/db/queries";
import { insight } from "@/lib/db/schema";
import { AppError } from "@openloomi/shared/errors";
import { eq } from "drizzle-orm";
import type { InsightTaskItem } from "@/lib/ai/subagents/insights";

/**
 * Helper function to mark all tasks in a bucket as completed
 */
function markTasksAsCompleted(
  tasks: InsightTaskItem[] | null | string,
): InsightTaskItem[] {
  // Handle null or undefined
  if (!tasks) return [];

  // If tasks is a string, try to parse it as JSON
  let parsedTasks = tasks;
  if (typeof tasks === "string") {
    try {
      parsedTasks = JSON.parse(tasks);
    } catch {
      // If parsing fails, return empty array
      return [];
    }
  }

  // Ensure tasks is an array
  if (!Array.isArray(parsedTasks)) {
    return [];
  }

  // Handle empty array
  if (parsedTasks.length === 0) return [];

  return parsedTasks.map((task) => ({
    ...task,
    status: "completed" as const,
  }));
}

/**
 * Archive or unarchive an Insight
 * POST /api/insights/[id]/archive
 * Body: { archived: boolean }
 *
 * When archiving an Insight, simultaneously mark all associated action items (myTasks, waitingForMe, waitingForOthers) as completed
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
    const { archived } = body;

    if (typeof archived !== "boolean") {
      return new AppError(
        "bad_request:insight",
        "archived must be a boolean",
      ).toResponse();
    }

    const now = new Date();

    // If this is an archive operation, need to get Insight first to update its associated action items
    if (archived) {
      // Get Insight details
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

      // Helper to safely get tasks array
      const getTasksArray = (tasks: any): InsightTaskItem[] => {
        if (!tasks) return [];
        let parsedTasks = tasks;
        if (typeof tasks === "string") {
          try {
            parsedTasks = JSON.parse(tasks);
          } catch {
            return [];
          }
        }
        if (!Array.isArray(parsedTasks)) return [];
        return parsedTasks;
      };

      // Calculate the number of tasks that will be marked as completed
      const allTasks = [
        ...getTasksArray(insightRecord.myTasks),
        ...getTasksArray(insightRecord.waitingForMe),
        ...getTasksArray(insightRecord.waitingForOthers),
      ].filter((task) => task.status !== "completed"); // Only count incomplete tasks

      const completedCount = allTasks.length;

      // Update archive status, and mark all action items as completed
      // Process and serialize tasks for SQLite (requires JSON strings)
      const processedMyTasks = markTasksAsCompleted(
        insightRecord.myTasks as InsightTaskItem[] | null,
      );
      const processedWaitingForMe = markTasksAsCompleted(
        insightRecord.waitingForMe as InsightTaskItem[] | null,
      );
      const processedWaitingForOthers = markTasksAsCompleted(
        insightRecord.waitingForOthers as InsightTaskItem[] | null,
      );

      await db
        .update(insight)
        .set({
          isArchived: true,
          archivedAt: now,
          updatedAt: now,
          // Mark all action items as completed
          myTasks: JSON.stringify(processedMyTasks),
          waitingForMe: JSON.stringify(processedWaitingForMe),
          waitingForOthers: JSON.stringify(processedWaitingForOthers),
        })
        .where(eq(insight.id, id));

      return Response.json(
        {
          success: true,
          message: `Insight archived successfully, ${completedCount} associated action items marked as completed`,
          data: {
            id,
            isArchived: true,
            archivedAt: now.toISOString(),
            tasksCompleted: true,
            completedCount,
          },
        },
        { status: 200 },
      );
    } else {
      // Unarchive operation: only update archive status, do not restore action item status
      // Action items remain completed because user may have indeed completed these tasks
      await db
        .update(insight)
        .set({
          isArchived: false,
          archivedAt: null,
          updatedAt: now,
        })
        .where(eq(insight.id, id));

      return Response.json(
        {
          success: true,
          message: "Insight unarchived successfully",
          data: {
            id,
            isArchived: false,
            archivedAt: null,
          },
        },
        { status: 200 },
      );
    }
  } catch (error) {
    console.error("[Insights] Archive failed:", error);

    if (error instanceof AppError) {
      return error.toResponse();
    }

    return new AppError("bad_request:database", String(error)).toResponse();
  }
}
