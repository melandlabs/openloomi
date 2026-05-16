import { auth } from "@/app/(auth)/auth";
import {
  getRawMessageManager,
  getRawMessageStorageBackend,
} from "@/lib/memory/raw-message-store";
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
      createdAt: Math.floor(Date.now() / 1000),
    }));

    const manager = await getRawMessageManager();
    const storage = getRawMessageStorageBackend();
    const ids = await manager.storeMessages(messagesWithUserId as any);
    return Response.json({
      success: true,
      message: `Messages stored in ${storage}`,
      storage,
      stored: ids.length,
      count: ids.length,
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

  const manager = await getRawMessageManager();
  const storage = getRawMessageStorageBackend();
  return Response.json({
    userId: session.user.id,
    botId: botId || undefined,
    platform: platform || undefined,
    storage,
    stats: await manager.getStats(),
  });
}
