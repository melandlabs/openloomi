import { auth } from "@/app/(auth)/auth";
import { AppError } from "@openloomi/shared/errors";
import type { NextRequest } from "next/server";

/**
 * POST endpoint to store raw messages from insight generation
 * This endpoint receives raw messages during insight generation and stores them
 * so they can be queried later by AI tools
 */
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return new AppError("unauthorized:api").toResponse();
  }

  try {
    const body = await request.json();

    const { messages } = body as {
      messages: Array<{
        messageId: string;
        platform: string;
        botId: string;
        channel?: string;
        person?: string;
        timestamp: number;
        content: string;
        attachments?: Array<{
          name: string;
          url: string;
          contentType?: string;
          sizeBytes?: number;
        }>;
        metadata?: Record<string, any>;
      }>;
    };

    if (!Array.isArray(messages) || messages.length === 0) {
      return new AppError(
        "bad_request:api",
        "messages array is required and must not be empty",
      ).toResponse();
    }

    // Validate each message
    for (const message of messages) {
      if (!message.messageId || !message.platform || !message.botId) {
        return new AppError(
          "bad_request:api",
          "Each message must have messageId, platform, and botId",
        ).toResponse();
      }
    }

    // Add userId to each message
    const messagesWithUserId = messages.map((message) => ({
      ...message,
      userId: session.user.id,
    }));

    // Return messages to client for IndexedDB storage
    // Note: We're returning the data because IndexedDB operations must happen on the client side
    return Response.json({
      success: true,
      message: "Messages prepared for client-side storage",
      data: messagesWithUserId,
      count: messagesWithUserId.length,
    });
  } catch (error) {
    console.error("[Raw Messages API] Error:", error);
    return new AppError("bad_request:api", String(error)).toResponse();
  }
}

/**
 * GET endpoint to retrieve raw messages for a user
 * This is mainly for debugging purposes
 */
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return new AppError("unauthorized:api").toResponse();
  }

  const { searchParams } = request.nextUrl;
  const botId = searchParams.get("botId");
  const platform = searchParams.get("platform");

  // This endpoint returns configuration for querying
  return Response.json({
    userId: session.user.id,
    botId: botId || undefined,
    platform: platform || undefined,
    message:
      "Use client-side IndexedDB to query raw messages. Check browser console for stats.",
  });
}
