import { auth } from "@/app/(auth)/auth";
import { AppError } from "@openloomi/shared/errors";

/**
 * GET endpoint to check if there are any raw messages available
 * Returns statistics about stored raw messages
 */
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return new AppError("unauthorized:api").toResponse();
  }

  try {
    // This endpoint can be used to check if raw messages are available
    // The actual messages are stored in IndexedDB on the client side
    // This endpoint could potentially fetch from server-side storage if implemented

    return Response.json({
      success: true,
      message: "Raw messages are stored in client-side IndexedDB",
      info: "Please refresh insights to sync latest raw messages",
    });
  } catch (error) {
    console.error("[Raw Messages Check] Error:", error);
    return new AppError("bad_request:api", String(error)).toResponse();
  }
}
