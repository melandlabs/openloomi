import type { DBMessage } from "@/lib/db/schema";
import { isTauriMode } from "@/lib/env";
import { writeFile, createDirectory, getMemoryFsPath } from "./fs-sync";

type Message = DBMessage & {
  role: "user" | "assistant" | "system";
};

/**
 * Get the user's timezone
 * Returns the timezone from Intl API (client-side timezone)
 */
function getUserTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/**
 * Format a date to YYYY-MM-DD format in the user's timezone
 */
function formatDateToDayString(date: Date, timezone: string): string {
  const year = date.toLocaleString("en-US", {
    timeZone: timezone,
    year: "numeric",
  });
  const month = date.toLocaleString("en-US", {
    timeZone: timezone,
    month: "2-digit",
  });
  const day = date.toLocaleString("en-US", {
    timeZone: timezone,
    day: "2-digit",
  });
  return `${year}-${month}-${day}`;
}

type ChatHistory = {
  id: string;
  title: string;
  createdAt: Date;
  messages: Message[];
};

/**
 * Convert chat history to Markdown format for memory storage
 */
export function chatHistoryToMarkdown(chat: ChatHistory): string {
  const lines: string[] = [];

  // Header
  lines.push(`# ${chat.title}\n`);
  lines.push(`> Chat ID: ${chat.id}\n`);
  lines.push(`> Created: ${chat.createdAt.toLocaleString("zh-CN")}\n`);

  // Messages
  if (chat.messages.length === 0) {
    lines.push("\n---\n\n*No Chat Messages*\n");
  } else {
    lines.push("\n---\n\n## Chat Messages\n\n");

    chat.messages.forEach((msg) => {
      const roleLabel =
        msg.role === "user"
          ? "👤 User"
          : msg.role === "assistant"
            ? "🤖 openloomi"
            : "📝 System";

      const timestamp = msg.createdAt.toLocaleString("zh-CN");

      // Extract text content from parts
      const parts = msg.parts as any[];
      const textParts =
        parts
          ?.filter(
            (part: any) =>
              part.type === "text" ||
              part.type === "reasoning" ||
              part.type === "browser",
          )
          .map((part: any) => part.text || "")
          .filter(Boolean) || [];

      const content = textParts.join("\n\n");

      if (content) {
        lines.push(`### ${roleLabel}\n`);
        lines.push(`*${timestamp}*\n\n`);
        lines.push(`${content}\n\n`);
        lines.push(`---\n\n`);
      }
    });

    lines.push(`\n**Total**: ${chat.messages.length} Messages\n`);
  }

  return lines.join("\n");
}

/**
 * Platform-specific filename byte limits (not characters, since UTF-8 multibyte chars count as multiple bytes)
 * macOS (APFS/HFS+): 255 bytes per filename component
 * Windows: 255 characters per filename component
 * Linux (ext4): 255 bytes per filename component
 * The safe value of 200 bytes leaves room for the ID suffix (9 bytes) + ".md" (3 bytes) = 212 bytes total
 */
const FILENAME_MAX_BYTES = 200;

/**
 * Truncate a string to fit within a byte limit, appending a suffix if truncated.
 * Uses byte length (UTF-8), not character count.
 */
function truncateToBytes(str: string, maxBytes: number): string {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(str);
  if (bytes.length <= maxBytes) return str;

  // Decode back to string, truncating at byte boundary
  // TextDecoder will stop at the last valid UTF-8 sequence before maxBytes
  const truncated = new Uint8Array(bytes.subarray(0, maxBytes));
  return new TextDecoder("utf-8", { fatal: false }).decode(truncated);
}

/**
 * Create a safe filename from a chat title, respecting OS filename length limits.
 */
function makeSafeFilename(chat: ChatHistory): string {
  const idSuffix = `-${chat.id.slice(0, 8)}.md`;
  const idSuffixBytes = new TextEncoder().encode(idSuffix).length;
  const maxTitleBytes = FILENAME_MAX_BYTES - idSuffixBytes;

  const safeTitle = chat.title
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/-+/g, "-")
    .trim();

  const truncatedTitle = truncateToBytes(safeTitle, maxTitleBytes);

  return `${truncatedTitle}${idSuffix}`;
}

/**
 * Sync chat directly to filesystem (Tauri mode only)
 * Bypasses the database and writes directly to data/memory/chats/
 */
export async function syncChatToFilesystem(
  chat: ChatHistory,
): Promise<{ success: boolean; error?: string }> {
  if (!isTauriMode()) {
    console.log("[ChatSyncFS] ❌ Not in Tauri mode");
    return { success: false, error: "Not in Tauri mode" };
  }

  try {
    // Get user timezone and format chat date to day string
    const timezone = getUserTimezone();
    const dayString = formatDateToDayString(chat.createdAt, timezone);

    // Get memory filesystem path
    const memoryPath = await getMemoryFsPath();

    // Build directory path: memoryPath/chats/YYYY-MM-DD/
    const chatsDir = `${memoryPath}/chats`;
    const dayDir = `${chatsDir}/${dayString}`;

    // Create directories if they don't exist
    await createDirectory(chatsDir);
    await createDirectory(dayDir);

    // Create a safe filename from chat title and ID
    const filename = makeSafeFilename(chat);
    const filePath = `${dayDir}/${filename}`;

    // Convert chat to markdown
    const markdown = chatHistoryToMarkdown(chat);

    // Write to filesystem
    await writeFile(filePath, markdown);
    return { success: true };
  } catch (error) {
    console.error("[ChatSyncFS] ❌ Error:", error);
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to sync chat to filesystem",
    };
  }
}
