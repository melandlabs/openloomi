import type { ChatMessage } from "@openloomi/shared";
import { getAuthToken } from "@/lib/auth/token-manager";

export interface SaveMessagesResponse {
  success: boolean;
  chat?: {
    id: string;
    title: string;
    createdAt: Date | string;
  } | null;
}

export interface SaveOptions {
  immediate?: boolean;
  skipSync?: boolean;
}

const pendingSaves = new Map<
  string,
  {
    timer: ReturnType<typeof setTimeout> | null;
    messages: ChatMessage[];
    options: SaveOptions;
  }
>();

async function doSave(
  messages: ChatMessage[],
  chatId: string,
  options: SaveOptions,
): Promise<SaveMessagesResponse | null> {
  try {
    const headers: HeadersInit = {
      "Content-Type": "application/json",
    };
    let cloudAuthToken: string | null = null;
    try {
      cloudAuthToken = getAuthToken();
      if (cloudAuthToken) {
        headers.Authorization = `Bearer ${cloudAuthToken}`;
      }
    } catch (error) {
      console.error(
        "[saveMessagesToDatabase] Failed to read cloud_auth_token:",
        error,
      );
    }

    const response = await fetch("/api/chat/save-messages", {
      method: "POST",
      headers,
      body: JSON.stringify({
        chatId,
        messages,
        skipSync: options.skipSync ?? false,
        token: cloudAuthToken,
      }),
    });
    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        "[saveMessagesToDatabase] Failed to save messages:",
        response.status,
        response.statusText,
        errorText,
      );
      return null;
    }
    return await response.json();
  } catch (error) {
    console.error("[saveMessagesToDatabase] Error saving messages:", error);
    return null;
  }
}

// Helper function to save messages to database
export async function saveMessagesToDatabase(
  messages: ChatMessage[],
  chatId: string,
  options?: SaveOptions,
): Promise<SaveMessagesResponse | null> {
  const opts = options ?? {};

  if (opts.immediate) {
    const existing = pendingSaves.get(chatId);
    if (existing?.timer) {
      clearTimeout(existing.timer);
      pendingSaves.delete(chatId);
    }
    return doSave(messages, chatId, opts);
  }

  const existing = pendingSaves.get(chatId);
  if (existing?.timer) {
    clearTimeout(existing.timer);
  }

  // Capture the latest messages in closure so the timer fires with the most recent data
  const latestMessages = messages;
  const latestOptions = opts;

  pendingSaves.set(chatId, {
    timer: setTimeout(async () => {
      pendingSaves.delete(chatId);
      await doSave(latestMessages, chatId, latestOptions);
    }, 500),
    messages: latestMessages,
    options: latestOptions,
  });

  return null;
}
