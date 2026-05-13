import { auth } from "@/app/(auth)/auth";
import { getChatInsights } from "@/lib/db/queries";
import { AppError } from "@openloomi/shared/errors";

export const dynamic = "force-dynamic";

/**
 * GET endpoint to fetch insights associated with a chat
 * Query params:
 *  - chatId: The chat ID to get insights for
 */
export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return new AppError("unauthorized:api").toResponse();
  }

  const { searchParams } = new URL(request.url);
  const chatId = searchParams.get("chatId");

  if (!chatId) {
    return new AppError("bad_request:api", "chatId is required").toResponse();
  }

  try {
    const insights = await getChatInsights({ chatId });
    return Response.json({ insights });
  } catch (error) {
    console.error("[chat-insights] Error:", error);
    return new AppError(
      "bad_request:api",
      "Failed to fetch chat insights",
    ).toResponse();
  }
}
