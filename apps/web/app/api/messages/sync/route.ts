import { auth } from "@/app/(auth)/auth";
import { getBotsByUserId } from "@/lib/db/queries";
import { AppError } from "@openloomi/shared/errors";

/**
 * POST endpoint to fetch and return raw messages for all bots
 * This endpoint is called after insights are refreshed to sync raw messages to
 * the active local raw-message backend.
 */
export async function POST() {
  const session = await auth();
  if (!session?.user) {
    return new AppError("unauthorized:api").toResponse();
  }

  try {
    const userId = session.user.id;

    // Get all bots for the user
    const bots = await getBotsByUserId({
      id: userId,
      limit: null,
      startingAfter: null,
      endingBefore: null,
      onlyEnable: false,
    });

    if (bots.bots.length === 0) {
      return Response.json({
        success: true,
        rawMessages: [],
      });
    }

    // Collect raw messages from all bots
    const allRawMessages: any[] = [];

    // Process bots in parallel for better performance
    const results = await Promise.allSettled(
      bots.bots.map(async (bot) => {
        // Only fetch from bots that support message extraction
        const supportedAdapters = [
          "slack",
          "discord",
          "telegram",
          "whatsapp",
          "gmail",
          "outlook",
          "teams",
          "linkedin",
          "instagram",
          "twitter",
        ];

        if (!supportedAdapters.includes(bot.adapter)) {
          return null;
        }

        // Get insights with raw messages from this bot
        // Note: We need to call getInsightsByBotId which includes rawMessages
        // But this would trigger insight generation again, which we don't want
        // Instead, we should store rawMessages during the refresh process

        // For now, return empty array - we'll implement proper storage later
        console.log(
          `[Raw Messages Sync] Bot ${bot.id} (${bot.adapter}): needs implementation`,
        );
        return null;
      }),
    );

    // Handle results
    results.forEach((result, index) => {
      const bot = bots.bots[index];
      if (result.status === "rejected") {
        console.error(
          `[Raw Messages Sync] Failed to get messages from bot ${bot.id}:`,
          result.reason,
        );
      } else if (result.value !== null) {
        allRawMessages.push(result.value);
      }
    });

    return Response.json({
      success: true,
      rawMessages: allRawMessages,
      count: allRawMessages.length,
    });
  } catch (error) {
    console.error("[Raw Messages Sync] Error:", error);
    return new AppError("bad_request:api", String(error)).toResponse();
  }
}
