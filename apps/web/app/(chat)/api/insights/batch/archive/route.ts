import { auth } from "@/app/(auth)/auth";
import { db } from "@/lib/db/queries";
import { insight } from "@/lib/db/schema";
import { AppError } from "@openloomi/shared/errors";
import { eq, inArray } from "drizzle-orm";
import type { InsightTaskItem } from "@/lib/ai/subagents/insights";

/**
 * Helper function to mark all tasks in a bucket as completed
 */
function markTasksAsCompleted(
  tasks: InsightTaskItem[] | null | string,
): InsightTaskItem[] {
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
  if (parsedTasks.length === 0) return [];

  return parsedTasks.map((task) => ({
    ...task,
    status: "completed" as const,
  }));
}

/**
 * Batch archive Insights
 * POST /api/insights/batch/archive
 * Body: { ids: string[], archived: boolean }
 */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return new AppError("unauthorized:insight").toResponse();
  }

  try {
    const body = await request.json();
    const { ids, archived } = body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return new AppError(
        "bad_request:insight",
        "ids must be a non-empty array",
      ).toResponse();
    }

    if (typeof archived !== "boolean") {
      return new AppError(
        "bad_request:insight",
        "archived must be a boolean",
      ).toResponse();
    }

    const now = new Date();

    if (archived) {
      // Get all Insights to update associated action items
      const insights = await db
        .select()
        .from(insight)
        .where(inArray(insight.id, ids));

      // Process each insight
      for (const insightRecord of insights) {
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
            myTasks: JSON.stringify(processedMyTasks),
            waitingForMe: JSON.stringify(processedWaitingForMe),
            waitingForOthers: JSON.stringify(processedWaitingForOthers),
          })
          .where(eq(insight.id, insightRecord.id));
      }

      return Response.json(
        {
          success: true,
          message: `${ids.length} insights archived successfully`,
          data: {
            ids,
            isArchived: true,
            archivedAt: now.toISOString(),
          },
        },
        { status: 200 },
      );
    }
    // Batch unarchive
    await db
      .update(insight)
      .set({
        isArchived: false,
        archivedAt: null,
        updatedAt: now,
      })
      .where(inArray(insight.id, ids));

    return Response.json(
      {
        success: true,
        message: `${ids.length} insights unarchived successfully`,
        data: {
          ids,
          isArchived: false,
          archivedAt: null,
        },
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("[Insights] Batch archive failed:", error);

    if (error instanceof AppError) {
      return error.toResponse();
    }

    return new AppError("bad_request:database", String(error)).toResponse();
  }
}
