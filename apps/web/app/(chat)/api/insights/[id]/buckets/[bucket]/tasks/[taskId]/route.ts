// app/api/insights/[insightId]/buckets/[bucket]/tasks/[taskId]/route.ts
import { auth } from "@/app/(auth)/auth";
import {
  updateInsightEmbeddedTaskStatus,
  updateInsightTaskContext,
  updateInsightTask,
} from "@/lib/db/queries";
import { AppError } from "@openloomi/shared/errors";

export async function PUT(
  _: Request,
  {
    params,
  }: { params: Promise<{ id: string; bucket: string; taskId: string }> },
) {
  return updateTaskStatus(params, true);
}

export async function DELETE(
  _: Request,
  {
    params,
  }: { params: Promise<{ id: string; bucket: string; taskId: string }> },
) {
  return updateTaskStatus(params, false);
}

export async function PATCH(
  request: Request,
  {
    params,
  }: { params: Promise<{ id: string; bucket: string; taskId: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return new AppError("unauthorized:insight").toResponse();
  }

  const { id, bucket, taskId } = await params;

  const validBuckets = ["myTasks", "waitingForMe", "waitingForOthers"];
  if (!validBuckets.includes(bucket)) {
    const error = `Invalid bucket: "${bucket}". Valid buckets: ${validBuckets.join(", ")}`;
    console.error(`[InsightTask API PATCH] ${error}`);
    return new AppError("bad_request:insight", error).toResponse();
  }

  try {
    const body = await request.json();

    // If only updating context (backward compatibility)
    if (body.context !== undefined && Object.keys(body).length === 1) {
      if (typeof body.context !== "string") {
        return new AppError(
          "bad_request:insight",
          "Context must be a string",
        ).toResponse();
      }

      const result = await updateInsightTaskContext({
        insightId: id,
        userId: session.user.id,
        taskId,
        bucket: bucket as "myTasks" | "waitingForMe" | "waitingForOthers",
        context: body.context,
      });

      return Response.json(result, { status: 200 });
    }

    // Update all fields
    const { title, context, deadline, owner, requester, newBucket, priority } =
      body;

    // Validate newBucket (if provided)
    if (newBucket && !validBuckets.includes(newBucket)) {
      return new AppError(
        "bad_request:insight",
        `Invalid newBucket: ${newBucket}. Valid buckets: ${validBuckets.join(", ")}`,
      ).toResponse();
    }

    const updates: {
      title?: string;
      context?: string;
      deadline?: string | null;
      owner?: string | null;
      requester?: string | null;
      newBucket?: "myTasks" | "waitingForMe" | "waitingForOthers";
      priority?: string | null;
    } = {};

    if (title !== undefined) {
      if (typeof title !== "string") {
        return new AppError(
          "bad_request:insight",
          "Title must be a string",
        ).toResponse();
      }
      updates.title = title;
    }

    if (context !== undefined) {
      if (typeof context !== "string") {
        return new AppError(
          "bad_request:insight",
          "Context must be a string",
        ).toResponse();
      }
      updates.context = context;
    }

    if (deadline !== undefined) {
      if (deadline !== null && typeof deadline !== "string") {
        return new AppError(
          "bad_request:insight",
          "Deadline must be a string or null",
        ).toResponse();
      }
      updates.deadline = deadline;
    }

    if (owner !== undefined) {
      if (owner !== null && typeof owner !== "string") {
        return new AppError(
          "bad_request:insight",
          "Owner must be a string or null",
        ).toResponse();
      }
      updates.owner = owner;
    }

    if (requester !== undefined) {
      if (requester !== null && typeof requester !== "string") {
        return new AppError(
          "bad_request:insight",
          "Requester must be a string or null",
        ).toResponse();
      }
      updates.requester = requester;
    }

    if (newBucket) {
      updates.newBucket = newBucket as
        | "myTasks"
        | "waitingForMe"
        | "waitingForOthers";
    }

    if (priority !== undefined) {
      if (priority !== null && typeof priority !== "string") {
        return new AppError(
          "bad_request:insight",
          "Priority must be a string or null",
        ).toResponse();
      }
      updates.priority = priority;
    }

    const result = await updateInsightTask({
      insightId: id,
      userId: session.user.id,
      taskId,
      bucket: bucket as "myTasks" | "waitingForMe" | "waitingForOthers",
      updates,
    });

    return Response.json(result, { status: 200 });
  } catch (error) {
    console.error(`[InsightTask API] Update task failed:`, error);
    if (error instanceof AppError) {
      return error.toResponse();
    }
    return new AppError("bad_request:database", String(error)).toResponse();
  }
}

async function updateTaskStatus(
  paramsPromise: Promise<{ id: string; bucket: string; taskId: string }>,
  isCompleted: boolean,
) {
  const session = await auth();
  if (!session?.user) {
    return new AppError("unauthorized:insight").toResponse();
  }

  const { id, bucket, taskId } = await paramsPromise;

  const validBuckets = ["myTasks", "waitingForMe", "waitingForOthers"];
  if (!validBuckets.includes(bucket)) {
    const error = `Invalid bucket: "${bucket}". Valid buckets: ${validBuckets.join(", ")}`;
    console.error(
      `[InsightTask API ${isCompleted ? "PUT" : "DELETE"}] ${error}`,
    );
    return new AppError("bad_request:insight", error).toResponse();
  }

  try {
    const result = await updateInsightEmbeddedTaskStatus({
      insightId: id,
      userId: session.user.id,
      taskId,
      bucket: bucket as "myTasks" | "waitingForMe" | "waitingForOthers",
      isCompleted,
    });

    return Response.json(result, { status: 200 });
  } catch (error) {
    console.error(
      `[InsightTask API] ${isCompleted ? "Mark" : "Unmark"} task failed:`,
      error,
    );
    if (error instanceof AppError) {
      return error.toResponse();
    }
    return new AppError("bad_request:database", String(error)).toResponse();
  }
}
