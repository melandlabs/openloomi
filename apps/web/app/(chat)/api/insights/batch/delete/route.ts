import { auth } from "@/app/(auth)/auth";
import { deleteInsightsByIds } from "@/lib/db/queries";
import { AppError } from "@openloomi/shared/errors";

/**
 * Batch delete Insights
 * DELETE /api/insights/batch/delete
 * Body: { ids: string[] }
 */
export async function DELETE(request: Request) {
  const session = await auth();
  if (!session?.user) {
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

    // Call delete function
    await deleteInsightsByIds({ ids });

    return Response.json(
      {
        success: true,
        message: `${ids.length} insights deleted successfully`,
        data: { ids },
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("[Insights] Batch delete failed:", error);

    if (error instanceof AppError) {
      return error.toResponse();
    }

    return new AppError("bad_request:database", String(error)).toResponse();
  }
}
