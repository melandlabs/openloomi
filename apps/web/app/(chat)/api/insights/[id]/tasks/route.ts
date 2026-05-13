import { auth } from "@/app/(auth)/auth";
import { db } from "@/lib/db";
import { insight } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { AppError } from "@openloomi/shared/errors";
import type { InsightTaskItem } from "@/lib/ai/subagents/insights";
import { generateUUID } from "@/lib/utils";
import { deserializeJson, serializeJson } from "@/lib/db/queries";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return new AppError("unauthorized:insight").toResponse();
  }

  const { id } = await params;

  try {
    const body = await request.json();
    const { title, context, bucket, deadline, owner, priority } = body as {
      title: string;
      context?: string;
      bucket: "myTasks" | "waitingForMe" | "waitingForOthers";
      deadline?: string;
      owner?: string;
      priority?: "high" | "medium" | "low" | null;
    };

    if (!title || !bucket) {
      return new AppError(
        "bad_request:insight",
        "Missing required fields: title or bucket",
      ).toResponse();
    }

    const validBuckets = ["myTasks", "waitingForMe", "waitingForOthers"];
    if (!validBuckets.includes(bucket)) {
      return new AppError(
        "bad_request:insight",
        `Invalid bucket: ${bucket}. Valid buckets: ${validBuckets.join(", ")}`,
      ).toResponse();
    }

    // Get current insight
    const [currentInsight] = await db
      .select({
        myTasks: insight.myTasks,
        waitingForMe: insight.waitingForMe,
        waitingForOthers: insight.waitingForOthers,
      })
      .from(insight)
      .where(eq(insight.id, id))
      .limit(1);

    if (!currentInsight) {
      return new AppError(
        "not_found:insight",
        "Insight not found",
      ).toResponse();
    }

    // Create new task (use UUID instead of timestamp)
    const newTask: InsightTaskItem = {
      id: generateUUID(),
      title,
      context: context || null,
      status: "pending",
      deadline: deadline || null,
      owner: owner || null,
      priority: priority ?? null,
    };

    // Update corresponding bucket (need to handle SQLite JSON serialization)
    const currentTasks = deserializeJson(
      (currentInsight[bucket] as InsightTaskItem[] | null | undefined) ?? [],
    );
    const updatedTasks = [...currentTasks, newTask];

    await db
      .update(insight)
      .set({
        [bucket]: serializeJson(updatedTasks),
        updatedAt: new Date(),
      })
      .where(eq(insight.id, id));

    return Response.json(
      {
        success: true,
        task: newTask,
        bucket,
        storageKey: newTask.id,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("[InsightTask API] Create task failed:", error);
    if (error instanceof AppError) {
      return error.toResponse();
    }
    return new AppError("bad_request:database", String(error)).toResponse();
  }
}
