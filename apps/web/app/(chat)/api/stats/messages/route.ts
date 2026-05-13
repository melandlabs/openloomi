import { auth } from "@/app/(auth)/auth";
import { getDailyMessageStatsByUserId } from "@/lib/db/queries";
import { AppError } from "@openloomi/shared/errors";

/**
 * Get user's message statistics from the past 24 hours
 * Includes total message count and list of involved platforms
 */
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return new AppError("unauthorized:chat").toResponse();
  }

  try {
    const stats = await getDailyMessageStatsByUserId({
      userId: session.user.id,
    });

    return Response.json(stats, { status: 200 });
  } catch (error) {
    console.error("[Stats] Failed to get message stats", error);
    return new AppError(
      "bad_request:database",
      error instanceof Error ? error.message : "Failed to load message stats",
    ).toResponse();
  }
}
