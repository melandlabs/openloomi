import { auth } from "@/app/(auth)/auth";
import { botExists } from "@/lib/db/queries";
import {
  isReservedChatMemoryEvidenceId,
  resolveUntrustedRawMemoryGraphWritePolicy,
  sanitizeUntrustedMemoryMetadata,
} from "@/lib/memory/memory-graph-write-policy";
import {
  getRawMessageManager,
  getRawMessageStorageBackend,
} from "@/lib/memory/raw-message-store";
import {
  type RawMessage,
  storeRawMessagesWithGraphEvolution,
} from "@openloomi/indexeddb";
import { AppError } from "@openloomi/shared/errors";
import type { NextRequest } from "next/server";

/**
 * POST endpoint to store raw messages from insight generation
 * This endpoint receives raw messages during insight generation and stores them
 * so they can be queried later by AI tools
 */
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
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
        metadata?: Record<string, unknown>;
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
      if (
        typeof message.messageId !== "string" ||
        message.messageId.trim().length === 0 ||
        typeof message.platform !== "string" ||
        message.platform.trim().length === 0 ||
        typeof message.botId !== "string" ||
        message.botId.trim().length === 0
      ) {
        return new AppError(
          "bad_request:api",
          "Each message must have messageId, platform, and botId",
        ).toResponse();
      }
      if (isReservedChatMemoryEvidenceId(message.messageId)) {
        return Response.json(
          { success: false, reason: "raw_message_reserved_id" },
          { status: 409 },
        );
      }
    }

    const userId = session.user.id;
    const botIds = [...new Set(messages.map((message) => message.botId))];
    const ownedBots = await Promise.all(
      botIds.map((id) => botExists({ id, userId })),
    );
    if (ownedBots.some((ownedBot) => !ownedBot)) {
      return new AppError(
        "forbidden:api",
        "Raw messages may only reference bots owned by the current user",
      ).toResponse();
    }

    const manager = await getRawMessageManager();
    const existingMessages = await Promise.all(
      [...new Set(messages.map((message) => message.messageId))].map(
        (messageId) => manager.getMessageById(messageId),
      ),
    );
    if (
      existingMessages.some(
        (existing) => existing !== null && existing.userId !== userId,
      )
    ) {
      return Response.json(
        { success: false, reason: "raw_message_scope_conflict" },
        { status: 409 },
      );
    }

    // Trust only the authenticated owner; graph-driving metadata is server-only.
    const messagesWithUserId = messages.map(({ metadata, ...message }) => ({
      ...message,
      metadata: sanitizeUntrustedMemoryMetadata(metadata),
      userId,
      createdAt: Math.floor(Date.now() / 1000),
    })) as RawMessage[];

    const graphPolicy = resolveUntrustedRawMemoryGraphWritePolicy();
    const storage = getRawMessageStorageBackend();
    const stored = await storeRawMessagesWithGraphEvolution({
      storage: manager,
      messages: messagesWithUserId,
      graphEvolution: { enabled: graphPolicy.enabled },
    });
    return Response.json({
      success: true,
      message: `Messages stored in ${storage}`,
      storage,
      stored: stored.ids.length,
      count: stored.ids.length,
      graphEvolution: stored.graphEvolution,
      graphPolicy,
      graphLifecycle: {
        status: "disabled",
        reasonCodes: ["memory_graph_lifecycle_untrusted_raw_baseline_only"],
      },
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
