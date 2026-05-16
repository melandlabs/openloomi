import { auth } from "@/app/(auth)/auth";
import {
  getRawMessageManager,
  getRawMessageStorageBackend,
} from "@/lib/memory/raw-message-store";
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
    const manager = await getRawMessageManager();
    return Response.json({
      success: true,
      storage: getRawMessageStorageBackend(),
      stats: await manager.getStats(),
    });
  } catch (error) {
    console.error("[Raw Messages Check] Error:", error);
    return new AppError("bad_request:api", String(error)).toResponse();
  }
}
