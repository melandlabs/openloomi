import { auth } from "@/app/(auth)/auth";
import { generateTitleFromUserMessage } from "@/app/(chat)/actions";
import { clearAIUserContext } from "@/lib/ai";
import { syncChatToFilesystem } from "@/lib/ai/memory/chat-sync";
import { setAIUserContextFromRequest } from "@/lib/ai/request-context";
import {
  CHAT_OWNER_SCOPE_CONFLICT,
  MESSAGE_ID_SCOPE_CONFLICT,
  getChatById,
  getMessageById,
  saveChat,
  saveMessages,
} from "@/lib/db/queries";
import { isTauriMode } from "@/lib/env";
import {
  type ChatMemoryWriteDiagnostics,
  buildPersistedChatMemoryMetadata,
  findChatMemoryRevisionConflict,
  writeSavedChatMessagesToMemory,
} from "@/lib/memory/chat-memory-write";
import { resolveMemoryGraphWritePolicy } from "@/lib/memory/memory-graph-write-policy";
import type { ChatMessage } from "@openloomi/shared";
import type { Attachment } from "@openloomi/shared";
import { NextResponse } from "next/server";

async function getPersistedMessagesByIds(messageIds: string[]) {
  return (
    await Promise.all(messageIds.map((id) => getMessageById({ id })))
  ).flat();
}

/**
 * Save Native Agent messages to database
 */
export async function POST(request: Request) {
  try {
    const session = await auth();

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check content length before parsing
    const contentLength = request.headers.get("content-length");
    const MAX_BODY_SIZE = 50 * 1024 * 1024; // 50MB limit

    if (contentLength && Number.parseInt(contentLength, 10) > MAX_BODY_SIZE) {
      console.error("[SaveMessages] Request body too large:", contentLength);
      return NextResponse.json(
        { error: "Request body too large" },
        { status: 413 },
      );
    }

    let body: {
      chatId: string | null;
      messages: unknown;
      skipSync?: boolean;
      token?: string;
    } | null = null;
    try {
      body = await request.json();
    } catch (jsonError) {
      const text = await request.text();
      console.error(
        "[SaveMessages] JSON parse error. Content length:",
        text.length,
        "First 500 chars:",
        text.slice(0, 500),
      );
      return NextResponse.json(
        { error: "Invalid JSON in request body" },
        { status: 400 },
      );
    }

    // Set AI user context for proper billing in proxy mode
    await setAIUserContextFromRequest({
      userId: session.user.id,
      email: session.user.email || "",
      name: session.user.name || null,
      userType: session.user.type,
      request,
      body,
    });

    const { chatId, messages, skipSync, token } = body ?? {
      chatId: null,
      messages: null,
      token: undefined,
    };

    if (!chatId) {
      clearAIUserContext();
      return NextResponse.json(
        { error: "chatId is required" },
        { status: 400 },
      );
    }

    if (!messages || !Array.isArray(messages)) {
      clearAIUserContext();
      return NextResponse.json(
        { error: "messages is required" },
        { status: 400 },
      );
    }

    // Check if chat exists, create if not
    let chat = await getChatById({ id: chatId });
    if (chat && chat.userId !== session.user.id) {
      clearAIUserContext();
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const requestMessageIds = [
      ...new Set(
        messages.flatMap((message) =>
          typeof message?.id === "string" ? [message.id] : [],
        ),
      ),
    ];
    const existingMessageRows =
      await getPersistedMessagesByIds(requestMessageIds);
    if (existingMessageRows.some((row) => row.chatId !== chatId)) {
      clearAIUserContext();
      return NextResponse.json(
        {
          error: "Message ID already belongs to another chat",
        },
        { status: 409 },
      );
    }
    const memoryRevisionConflict = await findChatMemoryRevisionConflict({
      userId: session.user.id,
      chatId,
      existingMessages: existingMessageRows,
      incomingMessages: messages,
    });
    if (memoryRevisionConflict) {
      clearAIUserContext();
      return NextResponse.json(
        {
          error: memoryRevisionConflict.retryable
            ? "Message memory evidence revision check is unavailable"
            : "Message memory evidence cannot be revised in place",
          code: memoryRevisionConflict.reasonCode,
          messageId: memoryRevisionConflict.messageId,
        },
        { status: memoryRevisionConflict.retryable ? 503 : 409 },
      );
    }

    if (!chat) {
      // Find first user message, use message content as temporary title
      const firstUserMessage = messages.find((msg) => msg.role === "user");
      let tempTitle = "New Chat";
      if (firstUserMessage) {
        // Extract message text content
        const content = firstUserMessage.content;
        if (typeof content === "string") {
          tempTitle = content.slice(0, 20).trim();
        } else if (Array.isArray(content)) {
          // If Part array, extract text parts
          const textPart = content.find(
            (part) => part.type === "text" && part.text,
          );
          if (textPart) {
            tempTitle = textPart.text.slice(0, 20).trim();
          }
        }
        // If extraction is empty, use default title
        if (!tempTitle) {
          tempTitle = "New Chat";
        }
      }

      await saveChat({
        id: chatId,
        userId: session.user.id,
        title: tempTitle,
      });

      // Re-fetch and verify ownership after the create/upsert race window.
      chat = await getChatById({ id: chatId });
      if (!chat || chat.userId !== session.user.id) {
        clearAIUserContext();
        return NextResponse.json(
          {
            error: "Chat ID already belongs to another user",
            code: "chat_owner_scope_conflict",
          },
          { status: 409 },
        );
      }

      // Generate a better title only after ownership is confirmed.
      if (firstUserMessage) {
        generateTitleFromUserMessage({ message: firstUserMessage })
          .then(async (title) => {
            await saveChat({
              id: chatId,
              userId: session.user.id,
              title,
            });
          })
          .catch((err) => {
            console.error("[SaveMessages] Failed to generate title:", err);
          });
      }
    }

    // Save messages to database
    // Filter out large attachment data to avoid JSON parsing failures
    // Images already uploaded via /api/files/upload, only save metadata here
    const MAX_ATTACHMENT_SIZE = 10 * 1024; // 10KB threshold for inline data

    // Skip empty message arrays to avoid Drizzle ORM errors
    if (messages.length === 0) {
      const graphPolicy = resolveMemoryGraphWritePolicy(session.user.id);
      const memoryWrite: ChatMemoryWriteDiagnostics = {
        status: "no-op",
        evidenceCount: 0,
        storedCount: 0,
        graphPolicy,
        retryable: false,
        reasonCodes: [
          ...graphPolicy.reasonCodes,
          "chat_memory_no_supported_evidence",
        ],
      };
      clearAIUserContext();
      return Response.json({
        success: true,
        message: "No messages to save",
        memoryWrite,
      });
    }

    try {
      await saveMessages({
        messages: messages.map(
          (
            msg: ChatMessage & {
              attachments?: Attachment[];
              createdAt?: string | Date;
            },
          ) => ({
            chatId,
            id: msg.id,
            role: msg.role,
            parts: msg.parts || [],
            attachments: (msg.attachments || []).map((att: Attachment) => {
              // If url is base64 and too large, clear it (keep other metadata)
              if (
                att.url &&
                att.url.length > MAX_ATTACHMENT_SIZE &&
                att.url.startsWith("data:")
              ) {
                return {
                  ...att,
                  url: "", // Clear large base64 data
                };
              }
              return att;
            }),
            createdAt: msg.createdAt ? new Date(msg.createdAt) : new Date(),
            metadata: buildPersistedChatMemoryMetadata({
              userId: session.user.id,
              chatId,
              message: msg,
              metadata: msg.metadata,
            }),
          }),
        ),
        expectedMessages: existingMessageRows.map((row) => ({
          id: row.id,
          chatId: row.chatId,
          parts: row.parts,
        })),
        expectedUserId: session.user.id,
      });
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === MESSAGE_ID_SCOPE_CONFLICT
      ) {
        clearAIUserContext();
        return NextResponse.json(
          {
            error: "Message ID already belongs to another chat",
            code: MESSAGE_ID_SCOPE_CONFLICT,
          },
          { status: 409 },
        );
      }
      if (
        error instanceof Error &&
        error.message === CHAT_OWNER_SCOPE_CONFLICT
      ) {
        clearAIUserContext();
        return NextResponse.json(
          {
            error: "Chat ID already belongs to another user",
            code: CHAT_OWNER_SCOPE_CONFLICT,
          },
          { status: 409 },
        );
      }
      throw error;
    }

    const persistedChat = await getChatById({ id: chatId });
    if (!persistedChat || persistedChat.userId !== session.user.id) {
      clearAIUserContext();
      return NextResponse.json(
        {
          error: "Chat ID already belongs to another user",
          code: CHAT_OWNER_SCOPE_CONFLICT,
        },
        { status: 409 },
      );
    }
    chat = persistedChat;

    let memoryWrite: ChatMemoryWriteDiagnostics;
    try {
      const persistedRequestMessages =
        await getPersistedMessagesByIds(requestMessageIds);
      if (persistedRequestMessages.some((row) => row.chatId !== chatId)) {
        clearAIUserContext();
        return NextResponse.json(
          {
            error: "Message ID already belongs to another chat",
          },
          { status: 409 },
        );
      }

      const persistedUserMessages = persistedRequestMessages
        .filter((row) => row.role === "user")
        .map(
          (row) =>
            ({
              id: row.id,
              role: "user",
              parts: Array.isArray(row.parts) ? row.parts : [],
              createdAt:
                row.createdAt instanceof Date
                  ? row.createdAt
                  : new Date(row.createdAt),
            }) as ChatMessage & { createdAt: Date },
        );
      memoryWrite = await writeSavedChatMessagesToMemory({
        userId: session.user.id,
        chatId,
        messages: persistedUserMessages,
      });
    } catch (memoryError) {
      const graphPolicy = resolveMemoryGraphWritePolicy(session.user.id);
      const error =
        memoryError instanceof Error
          ? { name: memoryError.name, message: memoryError.message }
          : { name: "Error", message: String(memoryError) };
      memoryWrite = {
        status: "partial-failure",
        evidenceCount: 0,
        storedCount: 0,
        graphPolicy,
        retryable: true,
        reasonCodes: [
          ...graphPolicy.reasonCodes,
          "chat_memory_write_unhandled_error",
        ],
        error,
      };
      console.error(
        "[SaveMessages] Memory write error (non-fatal):",
        memoryError,
      );
    }

    // Sync chat history to filesystem (skip during streaming to avoid per-chunk I/O)
    if (!skipSync) {
      const tauriMode = isTauriMode();

      try {
        if (chat && messages) {
          const chatHistory = {
            id: chat.id,
            title: chat.title,
            createdAt: chat.createdAt,
            messages: (
              messages as (ChatMessage & {
                attachments?: Attachment[];
                createdAt?: string | Date;
              })[]
            ).map((msg) => ({
              id: msg.id,
              chatId,
              role: msg.role as "user" | "assistant" | "system",
              parts: msg.parts || [],
              attachments: (msg.attachments || []).map((att: Attachment) => {
                // If url is base64 and too large, clear it (keep other metadata)
                if (
                  att.url &&
                  att.url.length > MAX_ATTACHMENT_SIZE &&
                  att.url.startsWith("data:")
                ) {
                  return {
                    ...att,
                    url: "",
                  };
                }
                return att;
              }),
              createdAt: msg.createdAt ? new Date(msg.createdAt) : new Date(),
              metadata: msg.metadata ?? null,
            })),
          };

          if (tauriMode) {
            await syncChatToFilesystem(chatHistory);
          }
        }
      } catch (syncError) {
        // Sync failure does not affect message saving
        console.error("[SaveMessages] Sync error (non-fatal):", syncError);
      }
    }
    clearAIUserContext();
    return Response.json({
      success: true,
      memoryWrite,
      chat: chat
        ? {
            id: chat.id,
            title: chat.title,
            createdAt: chat.createdAt,
          }
        : null,
    });
  } catch (error) {
    console.error("[SaveMessages] Error:", error);
    clearAIUserContext();
    return NextResponse.json(
      { error: "Failed to save messages" },
      { status: 500 },
    );
  }
}
