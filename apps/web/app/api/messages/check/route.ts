import { auth } from "@/app/(auth)/auth";
import {
  getSQLiteRawMessageManager,
  isSQLiteRawMessageStorageAvailable,
} from "@/lib/memory/sqlite-raw-message-store";
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
    if (isSQLiteRawMessageStorageAvailable()) {
      const manager = await getSQLiteRawMessageManager();
      return Response.json({
        success: true,
        storage: "sqlite",
        stats: await manager.getStats(),
      });
    }

    return Response.json({
      success: true,
      storage: "browser",
      message: "Raw messages are stored in client-side browser storage",
      info: "Please refresh insights to sync latest raw messages",
    });
  } catch (error) {
    console.error("[Raw Messages Check] Error:", error);
    return new AppError("bad_request:api", String(error)).toResponse();
  }
}
