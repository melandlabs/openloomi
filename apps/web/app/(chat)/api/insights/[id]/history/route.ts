import { auth } from "@/app/(auth)/auth";
import { AppError } from "@openloomi/shared/errors";
import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { message, chat, chatInsights, type Chat } from "@/lib/db/schema";
import { eq, and, sql, inArray, desc, count } from "drizzle-orm";
import type { ChatHistoryResponse } from "@/lib/ai/chat/api";
import { isTauriMode } from "@/lib/env";

/**
 * Get chat history containing a specific insight
 * 1. Query via chat_insights relation table
 * 2. Query via focusedInsightIds in message metadata (backward compatible)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return new AppError("unauthorized:insight").toResponse();
  }

  const { id: insightId } = await params;

  if (!insightId) {
    return new AppError(
      "bad_request:api",
      "Insight id is missing",
    ).toResponse();
  }

  try {
    // Method 1: Query associated chats from chat_insights relation table
    const chatsFromRelation = await db
      .select({ chatId: chatInsights.chatId })
      .from(chatInsights)
      .where(eq(chatInsights.insightId, insightId));

    // Method 2: Query messages containing this insight ID (backward compatible)
    // focusedInsightIds in metadata is a string array
    // Use different query methods based on database type
    let messagesWithInsight: { chatId: string }[] = [];

    if (isTauriMode()) {
      // SQLite: use JSON functions
      // metadata is stored as JSON string, need to use json_extract and json_each
      messagesWithInsight = await db
        .select({ chatId: message.chatId })
        .from(message)
        .where(
          sql`EXISTS (
            SELECT 1
            FROM json_each(json_extract(${message.metadata}, '$.focusedInsightIds'))
            WHERE json_each.value = ${insightId}
          )`,
        );
    } else {
      // PostgreSQL: use JSONB @> operator
      messagesWithInsight = await db
        .select({ chatId: message.chatId })
        .from(message)
        .where(
          sql`${message.metadata}->'focusedInsightIds' @> ${JSON.stringify([insightId])}::jsonb`,
        );
    }

    // Merge and deduplicate results from both methods
    const chatIdsFromRelation = chatsFromRelation.map(
      (r: { chatId: string }) => r.chatId,
    );
    const chatIdsFromMessages = messagesWithInsight.map(
      (m: { chatId: string }) => m.chatId,
    );
    const chatIds: string[] = Array.from(
      new Set([...chatIdsFromRelation, ...chatIdsFromMessages]),
    );

    if (chatIds.length === 0) {
      return Response.json({
        chats: [],
        hasMore: false,
      } as ChatHistoryResponse);
    }

    // Get detailed information for these chats
    const chats = await db
      .select()
      .from(chat)
      .where(and(eq(chat.userId, session.user.id), inArray(chat.id, chatIds)))
      .orderBy(desc(chat.createdAt))
      .limit(50);

    // Get latest message and message count for each chat
    const chatsWithExtendedInfo = await Promise.all(
      chats.map(async (chatItem: Chat) => {
        // Get latest message
        const latestMessages = await db
          .select()
          .from(message)
          .where(eq(message.chatId, chatItem.id))
          .orderBy(desc(message.createdAt))
          .limit(1);

        // Get total message count
        const [messageCountResult] = await db
          .select({ count: count(message.id) })
          .from(message)
          .where(eq(message.chatId, chatItem.id));

        // Extract text content from latest message
        let latestMessageContent = null;
        if (latestMessages.length > 0) {
          const latestMessage = latestMessages[0];
          type MessagePart = {
            type?: string;
            text?: string;
          };
          const parts = Array.isArray(latestMessage.parts)
            ? (latestMessage.parts as MessagePart[])
            : [];
          if (parts.length > 0) {
            const textParts = parts
              .filter(
                (
                  part,
                ): part is Required<Pick<MessagePart, "text">> & MessagePart =>
                  part?.type === "text" && typeof part.text === "string",
              )
              .map((part) => part.text);
            latestMessageContent = textParts.join("");
          }
        }

        return {
          ...chatItem,
          latestMessageTime:
            latestMessages.length > 0 ? latestMessages[0].createdAt : null,
          latestMessageContent,
          messageCount: messageCountResult?.count ?? 0,
        };
      }),
    );

    return Response.json({
      chats: chatsWithExtendedInfo,
      hasMore: false,
    } as ChatHistoryResponse);
  } catch (error) {
    console.error("Failed to get insight history:", error);
    return new AppError(
      "bad_request:api",
      `Failed to get insight history: ${error instanceof Error ? error.message : String(error)}`,
    ).toResponse();
  }
}
