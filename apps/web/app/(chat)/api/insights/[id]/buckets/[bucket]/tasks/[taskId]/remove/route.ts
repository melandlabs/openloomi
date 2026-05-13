// Remove specified task from Insight's bucket
import { auth } from "@/app/(auth)/auth";
import { removeInsightTask } from "@/lib/db/queries";
import { AppError } from "@openloomi/shared/errors";

export async function POST(
  _: Request,
  {
    params,
  }: { params: Promise<{ id: string; bucket: string; taskId: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return new AppError("unauthorized:insight").toResponse();
  }

  const { id, bucket, taskId } = await params;
  const validBuckets = ["myTasks", "waitingForMe", "waitingForOthers"];
  if (!validBuckets.includes(bucket)) {
    return new AppError(
      "bad_request:insight",
      `Invalid bucket: ${bucket}. Valid buckets: ${validBuckets.join(", ")}`,
    ).toResponse();
  }

  try {
    const result = await removeInsightTask({
      insightId: id,
      userId: session.user.id,
      taskId,
      bucket: bucket as "myTasks" | "waitingForMe" | "waitingForOthers",
    });
    return Response.json(result, { status: 200 });
  } catch (error) {
    if (error instanceof AppError) {
      return error.toResponse();
    }
    return new AppError("bad_request:insight", String(error)).toResponse();
  }
}
