/**
 * iMessage platform adapter
 * Uses @photon-ai/imessage-kit library to implement macOS native iMessage integration
 * Note: This feature is only available on macOS systems
 */
import { MessagePlatformAdapter } from "@openloomi/integrations/channels";
import type {
  Messages,
  Message as openloomiMessage,
  Image,
  File as FileMessage,
} from "@openloomi/integrations/channels";
import type { MessageTarget } from "@openloomi/integrations/channels";
import type {
  ExtractedMessageInfo,
  DialogInfo,
} from "@openloomi/integrations/channels/sources/types";
import { timeBeforeHours } from "@openloomi/shared";
import { tmpdir, homedir } from "node:os";
import { writeFile, unlink, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { readFile as readFileAsync } from "node:fs/promises";

// Minimal contact metadata type - only what's needed by this package
export interface ContactMeta {
  platform?: string;
  [key: string]: unknown;
}

// iMessage contact metadata type
export interface IMessageContactMeta {
  platform: "imessage";
  phoneNumber?: string;
  email?: string;
  displayName?: string;
  chatId?: string;
  [key: string]: unknown;
}

// iMessage dialog info type
export interface IMessageDialogInfo {
  id: string;
  name: string;
  type: "private" | "group";
  participants?: string[];
}

const DEBUG = process.env.DEBUG_IMESSAGE === "true";

// Maximum dialog and message count limits
const MAX_DIALOG_COUNT = 100;
const MAX_MESSAGE_COUNT = 200;
const DEFAULT_MAX_MESSAGE_CHUNK_COUNT = 40;

/**
 * Check if current environment supports iMessage
 * iMessage is only available on macOS
 */
export function isIMessageAvailable(): boolean {
  return process.platform === "darwin";
}

// iMessage SDK type
type IMessageSDKType = InstanceType<
  typeof import("@photon-ai/imessage-kit").IMessageSDK
>;

/**
 * Check if running in Tauri mode
 */
function isTauriMode(): boolean {
  return process.env.TAURI_MODE === "tauri" || process.env.IS_TAURI === "true";
}

/**
 * Get Tauri storage path
 */
function getTauriStoragePath(): string {
  return process.env.TAURI_STORAGE_PATH ?? join(homedir(), "storage");
}

/**
 * iMessage platform adapter class
 * Implements message fetching and sending functionality
 */
export class IMessageAdapter extends MessagePlatformAdapter {
  botId: string;
  messages: Messages;
  name = "iMessage";

  private contactMetadata: Record<string, IMessageContactMeta> = {};
  private isInitialized = false;
  private sdk: IMessageSDKType | null = null;

  /**
   * Send text via AppleScript (compatible with newer macOS versions)
   */
  private async sendViaAppleScript(
    chatId: string,
    text: string,
  ): Promise<void> {
    const execAsync = promisify(exec);

    const coreId = chatId.replace(/^iMessage;[+-];?/i, "");
    const normalizedChatId = formatIMessageChatId(coreId);
    const escapedChatId = normalizedChatId
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"');
    const escapedText = text
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\n/g, "\\n");

    const script = `tell application "Messages"
    set targetChat to chat id "${escapedChatId}"
    send "${escapedText}" to targetChat
end tell`;

    const escaped = script.replace(/'/g, "'\\''");
    await execAsync(`osascript -e '${escaped}'`, {
      timeout: 30000,
    });
  }

  private asyncIteratorState = {
    chats: [] as IMessageDialogInfo[],
    currentChatIndex: 0,
    currentMessageIndex: 0,
    offsetDate: 0,
    isInitialized: false,
  };

  constructor(opts?: { botId?: string }) {
    super();
    this.botId = opts?.botId ?? "";
    this.messages = [];
  }

  /**
   * Initialize iMessage client
   */
  private async ensureInitialized(): Promise<void> {
    if (this.isInitialized && this.sdk) {
      return;
    }

    if (!isIMessageAvailable()) {
      throw new Error("iMessage is only available on macOS");
    }

    try {
      // Dynamically import @photon-ai/imessage-kit
      const { IMessageSDK } = await import("@photon-ai/imessage-kit");
      this.sdk = new IMessageSDK({
        debug: false,
      });
      this.isInitialized = true;
    } catch (error) {
      console.error(`[Bot ${this.botId}] [imessage] Failed:`, error);
      throw new Error(
        "Failed to initialize iMessage client. Please ensure @photon-ai/imessage-kit is installed and running on macOS with Full Disk Access permission granted.",
      );
    }
  }

  /**
   * Set contact metadata cache
   */
  primeContactMetadata(contactId: string, metadata?: ContactMeta | null): void {
    if (metadata && isIMessageContactMeta(metadata)) {
      this.contactMetadata[contactId] = metadata;
    }
  }

  /**
   * Get all dialog list
   */
  async getDialogs(): Promise<DialogInfo[]> {
    await this.ensureInitialized();

    try {
      const chats =
        (await this.sdk?.listChats({
          limit: MAX_DIALOG_COUNT,
          sortBy: "recent",
        })) ?? [];
      const dialogs: DialogInfo[] = [];

      for (const chat of chats) {
        const dialogInfo: DialogInfo = {
          id: chat.chatId,
          name: chat.displayName || chat.chatId || "Unknown chat",
          type: chat.isGroup ? "group" : "private",
        };
        dialogs.push(dialogInfo);
      }

      if (DEBUG)
        console.log(
          `[Bot ${this.botId}] [imessage] Retrieved ${dialogs.length} dialogs`,
        );
      return dialogs;
    } catch (error) {
      console.error(
        `[Bot ${this.botId}] [imessage] Failed to get dialog list:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Get chat messages by time
   * @param cutoffDate Unix timestamp (in seconds)
   */
  async getChatsByTime(cutoffDate: number): Promise<ExtractedMessageInfo[]> {
    await this.ensureInitialized();

    const extractedMessages: ExtractedMessageInfo[] = [];
    const cutoffDateObj = new Date(cutoffDate * 1000);

    try {
      // Use getMessages API to fetch messages
      const result = await this.sdk?.getMessages({
        since: cutoffDateObj,
        limit: MAX_MESSAGE_COUNT,
        excludeOwnMessages: false,
        excludeReactions: true,
      });

      if (!result) return extractedMessages;

      if (DEBUG)
        console.log(
          `[Bot ${this.botId}] [imessage] Retrieved ${result.messages.length} messages`,
        );

      for (const msg of result.messages) {
        const extractedInfo = this.extractMessageInfo(msg);
        if (extractedInfo && extractedInfo.text.trim().length > 0) {
          extractedMessages.push(extractedInfo);
        }
      }

      if (DEBUG)
        console.log(
          `[Bot ${this.botId}] [imessage] Extracted ${extractedMessages.length} valid messages`,
        );
      return extractedMessages;
    } catch (error) {
      console.error(
        `[Bot ${this.botId}] [imessage] Failed to get messages:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Get chat messages by number of days
   */
  async getChatsByDays(days = 1): Promise<ExtractedMessageInfo[]> {
    const cutoffDate = timeBeforeHours(days * 24);
    return this.getChatsByTime(cutoffDate);
  }

  /**
   * Get messages in chunks (for incremental sync)
   */
  async getChatsByChunk(
    since: number,
    chunkSize?: number,
  ): Promise<{ messages: ExtractedMessageInfo[]; hasMore: boolean }> {
    await this.ensureInitialized();

    const maxChunk = chunkSize ?? DEFAULT_MAX_MESSAGE_CHUNK_COUNT;
    const sinceDate = new Date(since * 1000);

    try {
      // Use getMessages API to fetch messages
      const result = await this.sdk?.getMessages({
        since: sinceDate,
        limit: maxChunk,
        excludeOwnMessages: false,
        excludeReactions: true,
      });

      if (!result) return { messages: [], hasMore: false };

      const extractedMessages: ExtractedMessageInfo[] = [];

      for (const msg of result.messages) {
        const extractedInfo = this.extractMessageInfo(msg);
        if (extractedInfo && extractedInfo.text.trim().length > 0) {
          extractedMessages.push(extractedInfo);
        }
      }

      // If returned message count equals the requested limit, there may be more messages
      const hasMore = result.messages.length >= maxChunk;

      return { messages: extractedMessages, hasMore };
    } catch (error) {
      console.error(
        `[Bot ${this.botId}] [imessage] Failed to get messages in chunks:`,
        error,
      );
      return { messages: [], hasMore: false };
    }
  }

  /**
   * Extract message information
   */
  private extractMessageInfo(msg: any): ExtractedMessageInfo | null {
    try {
      const chatName = msg.chatId || "Unknown chat";
      const sender = msg.isFromMe
        ? "Me"
        : msg.senderName || msg.sender || "Unknown sender";
      const text = msg.text || "";
      const timestamp = msg.date
        ? Math.floor(new Date(msg.date).getTime() / 1000)
        : Math.floor(Date.now() / 1000);

      return {
        id: msg.id || msg.guid, // Save iMessage message ID
        chatType: msg.isGroupChat ? "group" : "private",
        chatName,
        sender,
        text,
        timestamp,
        isOutgoing: msg.isFromMe,
        attachments: undefined, // TODO: Handle attachments
      };
    } catch (error) {
      console.error(
        `[Bot ${this.botId}] [imessage] Failed to extract message info:`,
        error,
      );
      return null;
    }
  }

  /**
   * Send messages
   * Supports text, images (URL/path/base64), and files (URL)
   */
  async sendMessages(
    target: MessageTarget,
    id: string,
    messages: Messages,
  ): Promise<void> {
    await this.ensureInitialized();

    // Collect temp files that need cleanup
    const tempFilesToCleanup: string[] = [];

    try {
      // Categorize messages: text, images, files
      const textMessages: string[] = [];
      const imagePaths: string[] = [];
      const filePaths: string[] = [];

      for (const message of messages) {
        if (typeof message === "string") {
          if (message.trim().length > 0) {
            textMessages.push(message);
          }
        } else if (this.isFileMessage(message)) {
          // File message: need to download URL to temp file
          const tempPath = await this.downloadToTempFile(
            message.url,
            message.name,
          );
          filePaths.push(tempPath);
          tempFilesToCleanup.push(tempPath);
        } else if (this.isImageMessage(message)) {
          // Image message: supports url, path, base64
          if (message.path) {
            // Local path use directly
            imagePaths.push(message.path);
          } else if (message.base64) {
            // base64 needs to be saved as temp file
            const tempPath = await this.base64ToTempFile(
              message.base64,
              message.contentType,
            );
            imagePaths.push(tempPath);
            tempFilesToCleanup.push(tempPath);
          } else if (message.url) {
            // Handle different URL types
            if (
              message.url.startsWith("http://") ||
              message.url.startsWith("https://")
            ) {
              // Full HTTP URL: download to temp file
              const tempPath = await this.downloadToTempFile(
                message.url,
                message.id,
              );
              imagePaths.push(tempPath);
              tempFilesToCleanup.push(tempPath);
            } else if (message.url.startsWith("/files/")) {
              // Local storage files (e.g., /files/...): read directly from local filesystem
              const tempPath = await this.resolveLocalStorageFile(
                message.url,
                message.id,
              );
              imagePaths.push(tempPath);
              tempFilesToCleanup.push(tempPath);
            } else if (message.url.startsWith("/")) {
              // Other relative paths: treat as local file path
              imagePaths.push(message.url);
            } else {
              // Other cases: treat as local file path
              imagePaths.push(message.url);
            }
          }
        }
      }

      // Send messages
      // Strategy: merge as much as possible to reduce API calls
      const hasText = textMessages.length > 0;
      const hasImages = imagePaths.length > 0;
      const hasFiles = filePaths.length > 0;

      if (hasText || hasImages || hasFiles) {
        // Merge all text into one message
        const combinedText = textMessages.join("\n");

        // Validate ID is not empty
        if (!id || id.trim() === "") {
          throw new Error("Target ID cannot be empty");
        }

        // Case 1: text only
        if (hasText && !hasImages && !hasFiles) {
          if (!combinedText || combinedText.trim() === "") {
            throw new Error("Message text cannot be empty");
          }
          try {
            await this.sdk?.send(id, combinedText);
            if (DEBUG)
              console.log(
                `[Bot ${this.botId}] [imessage] Successfully sent text message to ${id}`,
              );
          } catch (sdkError) {
            // Use AppleScript fallback when SDK fails
            console.warn(
              `[Bot ${this.botId}] [imessage] SDK send failed, trying AppleScript:`,
              sdkError,
            );
            await this.sendViaAppleScript(id, combinedText);
            if (DEBUG)
              console.log(
                `[Bot ${this.botId}] [imessage] AppleScript successfully sent text message to ${id}`,
              );
          }
        }
        // Case 2: images only
        else if (!hasText && hasImages && !hasFiles) {
          await this.sdk?.send(id, { images: imagePaths });
          if (DEBUG)
            console.log(
              `[Bot ${this.botId}] [imessage] Successfully sent ${imagePaths.length} images to ${id}`,
            );
        }
        // Case 3: files only
        else if (!hasText && !hasImages && hasFiles) {
          await this.sdk?.send(id, { files: filePaths });
          if (DEBUG)
            console.log(
              `[Bot ${this.botId}] [imessage] Successfully sent ${filePaths.length} files to ${id}`,
            );
        }
        // Case 4: text + images
        else if (hasText && hasImages && !hasFiles) {
          await this.sdk?.send(id, { text: combinedText, images: imagePaths });
          if (DEBUG)
            console.log(
              `[Bot ${this.botId}] [imessage] Successfully sent text and ${imagePaths.length} images to ${id}`,
            );
        }
        // Case 5: text + files
        else if (hasText && !hasImages && hasFiles) {
          await this.sdk?.send(id, { text: combinedText, files: filePaths });
          if (DEBUG)
            console.log(
              `[Bot ${this.botId}] [imessage] Successfully sent text and ${filePaths.length} files to ${id}`,
            );
        }
        // Case 6: images + files (sent separately)
        else if (!hasText && hasImages && hasFiles) {
          await this.sdk?.send(id, { images: imagePaths });
          if (DEBUG)
            console.log(
              `[Bot ${this.botId}] [imessage] Successfully sent ${imagePaths.length} images to ${id}`,
            );
          await this.sdk?.send(id, { files: filePaths });
          if (DEBUG)
            console.log(
              `[Bot ${this.botId}] [imessage] Successfully sent ${filePaths.length} files to ${id}`,
            );
        }
        // Case 7: text + images + files (send images and files separately)
        else if (hasText && hasImages && hasFiles) {
          await this.sdk?.send(id, { text: combinedText, images: imagePaths });
          if (DEBUG)
            console.log(
              `[Bot ${this.botId}] [imessage] Successfully sent text and ${imagePaths.length} images to ${id}`,
            );
          await this.sdk?.send(id, { files: filePaths });
          if (DEBUG)
            console.log(
              `[Bot ${this.botId}] [imessage] Successfully sent ${filePaths.length} files to ${id}`,
            );
        }
      }
    } catch (error) {
      console.error(
        `[Bot ${this.botId}] [imessage] Failed to send message to ${id}:`,
        error,
      );
      throw error;
    } finally {
      // Cleanup temp files
      if (tempFilesToCleanup.length > 0) {
        await this.cleanupTempFiles(tempFilesToCleanup);
      }
    }
  }

  /**
   * Send a single message
   */
  async sendMessage(
    target: MessageTarget,
    id: string,
    message: string,
  ): Promise<void> {
    await this.sendMessages(target, id, [message]);
  }

  /**
   * Check if message is an image message
   * Image messages have url or base64 property, but no name and size properties (distinguishes from file messages)
   */
  private isImageMessage(message: openloomiMessage): message is Image {
    if (typeof message !== "object" || message === null) return false;
    // Image messages have url or base64, but file messages have id, name, size, url
    // Distinguish files from images by checking for name and size
    if ("name" in message && "size" in message) return false;
    if (!("url" in message) && !("base64" in message)) return false;
    return true;
  }

  /**
   * Check if message is a file message
   * File messages have id, name, size, url properties
   */
  private isFileMessage(message: openloomiMessage): message is FileMessage {
    if (typeof message !== "object" || message === null) return false;
    return (
      "id" in message &&
      "name" in message &&
      "size" in message &&
      "url" in message
    );
  }

  /**
   * Get temp file directory path
   * Creates openloomi-imessage subdirectory for storing temp files
   */
  private async getTempDir(): Promise<string> {
    const tempDir = join(tmpdir(), "openloomi-imessage");
    try {
      await mkdir(tempDir, { recursive: true });
    } catch {
      // Directory may already exist, ignore error
    }
    return tempDir;
  }

  /**
   * Save base64 data as a temp file
   * @param base64Data base64-encoded data (may contain data:xxx;base64, prefix)
   * @param contentType content type, used to infer file extension
   * @returns Local path of the temp file
   */
  private async base64ToTempFile(
    base64Data: string,
    contentType?: string,
  ): Promise<string> {
    // Remove data:xxx;base64, prefix if present
    let pureBase64 = base64Data;
    let detectedContentType = contentType;

    const dataUrlMatch = base64Data.match(/^data:([^;]+);base64,(.+)$/);
    if (dataUrlMatch) {
      detectedContentType = detectedContentType || dataUrlMatch[1];
      pureBase64 = dataUrlMatch[2];
    }

    // Infer extension from content type
    const ext = this.getExtensionFromContentType(
      detectedContentType || "application/octet-stream",
    );

    const tempDir = await this.getTempDir();
    const tempPath = join(tempDir, `${randomUUID()}${ext}`);

    const buffer = Buffer.from(pureBase64, "base64");
    await writeFile(tempPath, buffer);

    if (DEBUG)
      console.log(
        `[Bot ${this.botId}] [imessage] base64 data saved to temp file: ${tempPath}`,
      );
    return tempPath;
  }

  /**
   * Download remote file to temp directory
   * @param url Remote file URL
   * @param filename Optional filename
   * @returns Local path of the temp file
   */
  private async downloadToTempFile(
    url: string,
    filename?: string,
  ): Promise<string> {
    const tempDir = await this.getTempDir();

    // Infer filename from URL or filename parameter
    let finalFilename = filename;
    if (!finalFilename) {
      try {
        const urlObj = new URL(url);
        const pathname = urlObj.pathname;
        const urlFilename = pathname.split("/").pop();
        if (urlFilename?.includes(".")) {
          finalFilename = urlFilename;
        }
      } catch {
        // URL parsing failed, use default filename
      }
    }

    // If still no filename, use UUID
    if (!finalFilename) {
      finalFilename = randomUUID();
    }

    const tempPath = join(tempDir, `${randomUUID()}-${finalFilename}`);

    if (DEBUG)
      console.log(
        `[Bot ${this.botId}] [imessage] Downloading remote file: ${url}`,
      );

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(
        `Failed to download file: ${response.status} ${response.statusText}`,
      );
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    await writeFile(tempPath, buffer);

    if (DEBUG)
      console.log(
        `[Bot ${this.botId}] [imessage] Remote file downloaded to: ${tempPath}`,
      );
    return tempPath;
  }

  /**
   * Get file extension from MIME type
   */
  private getExtensionFromContentType(contentType: string): string {
    const mimeToExt: Record<string, string> = {
      "image/jpeg": ".jpg",
      "image/jpg": ".jpg",
      "image/png": ".png",
      "image/gif": ".gif",
      "image/webp": ".webp",
      "image/heic": ".heic",
      "image/avif": ".avif",
      "application/pdf": ".pdf",
      "application/msword": ".doc",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
        ".docx",
      "application/vnd.ms-excel": ".xls",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
        ".xlsx",
      "text/plain": ".txt",
      "text/csv": ".csv",
      "application/json": ".json",
      "application/zip": ".zip",
      "video/mp4": ".mp4",
      "video/quicktime": ".mov",
      "audio/mpeg": ".mp3",
      "audio/mp4": ".m4a",
    };

    return mimeToExt[contentType.toLowerCase()] || "";
  }

  /**
   * Resolve local storage file path (/files/... format)
   * Read file from local storage and save to temp directory
   * @param virtualPath Virtual path, e.g. /files/xxx/yyy.png
   * @param filename Optional filename
   * @returns Local path of the temp file
   */
  private async resolveLocalStorageFile(
    virtualPath: string,
    filename?: string,
  ): Promise<string> {
    // Extract actual pathname from /files/xxx
    const pathname = virtualPath.replace(/^\/files\//, "");

    if (DEBUG)
      console.log(
        `[Bot ${this.botId}] [imessage] Reading file from local storage: ${pathname}`,
      );

    // Check if in Tauri mode
    if (!isTauriMode()) {
      throw new Error("Local file storage is only available in Tauri mode");
    }

    // Build full local file path
    const fullPath = join(getTauriStoragePath(), pathname);

    if (!existsSync(fullPath)) {
      throw new Error(`Local file not found: ${fullPath}`);
    }

    // Read file content
    const buffer = await readFileAsync(fullPath);

    // Save to temp directory
    const tempDir = await this.getTempDir();
    const finalFilename = filename || pathname.split("/").pop() || randomUUID();
    const tempPath = join(tempDir, `${randomUUID()}-${finalFilename}`);

    await writeFile(tempPath, buffer);

    if (DEBUG)
      console.log(
        `[Bot ${this.botId}] [imessage] Local file copied to temp directory: ${tempPath}`,
      );

    return tempPath;
  }

  /**
   * Cleanup temp files
   * @param paths Array of temp file paths to delete
   */
  private async cleanupTempFiles(paths: string[]): Promise<void> {
    for (const path of paths) {
      try {
        await unlink(path);
        if (DEBUG)
          console.log(
            `[Bot ${this.botId}] [imessage] Cleaned up temp file: ${path}`,
          );
      } catch (error) {
        console.warn(
          `[Bot ${this.botId}] [imessage] Failed to cleanup temp file: ${path}`,
          error,
        );
      }
    }
  }

  /**
   * Close adapter
   */
  async kill(): Promise<void> {
    if (this.sdk) {
      try {
        await this.sdk.close();
      } catch (error) {
        console.error(
          `[Bot ${this.botId}] [imessage] Failed to close SDK:`,
          error,
        );
      }
    }
    this.isInitialized = false;
    this.sdk = null;
    this.asyncIteratorState = {
      chats: [],
      currentChatIndex: 0,
      currentMessageIndex: 0,
      offsetDate: 0,
      isInitialized: false,
    };
    if (DEBUG) console.log(`[Bot ${this.botId}] [imessage] Adapter closed`);
  }

  /**
   * Validate iMessage connection availability
   *
   * Uses retry mechanism for transient errors like database locks
   */
  static async validateConnection(): Promise<{
    available: boolean;
    error?: string;
  }> {
    if (!isIMessageAvailable()) {
      return {
        available: false,
        error: "iMessage is only available on macOS",
      };
    }

    const MAX_RETRIES = 3;
    const RETRY_DELAY = 1000; // 1 second

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const { IMessageSDK } = await import("@photon-ai/imessage-kit");
        const sdk = new IMessageSDK({ debug: false });
        // Try to get chat list to validate permissions
        await sdk.listChats({ limit: 1 });
        await sdk.close();
        return { available: true };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);

        // Check if it's a database locked error (retryable)
        const isDatabaseLockedError =
          errorMessage.includes("database is locked") ||
          errorMessage.includes("SQLITE_BUSY") ||
          errorMessage.includes("database is being used by another process") ||
          errorMessage.includes("database is locked");

        // If database is locked and retries remaining, wait and retry
        if (isDatabaseLockedError && attempt < MAX_RETRIES) {
          console.warn(
            `[iMessage] Database locked, retrying (${attempt}/${MAX_RETRIES})...`,
          );
          await new Promise((resolve) =>
            setTimeout(resolve, RETRY_DELAY * attempt),
          );
          continue;
        }

        // Check if it's a permission error (chat.db is under ~/Library/Messages/, macOS requires Full Disk Access)
        const isPermissionError =
          errorMessage.includes("permission") ||
          errorMessage.includes("access") ||
          errorMessage.includes("Full Disk Access") ||
          errorMessage.includes("SQLITE_CANTOPEN") ||
          errorMessage.includes("unable to open database file");

        if (isPermissionError) {
          return {
            available: false,
            error:
              "Full Disk Access permission is required to read iMessage database. Please add the current running application process (such as Terminal, Node, or openloomi) in System Settings > Privacy & Security > Full Disk Access, then restart the app and try again.",
          };
        }

        // Other errors return detailed info
        return {
          available: false,
          error: `Unable to connect to iMessage: ${errorMessage}`,
        };
      }
    }

    // Should theoretically not reach here
    return {
      available: false,
      error: "Unable to connect to iMessage: Unknown error",
    };
  }
}

/**
 * Check if contact metadata is iMessage type
 */
export function isIMessageContactMeta(
  meta: ContactMeta | null | undefined,
): meta is IMessageContactMeta {
  if (!meta) return false;
  return (meta as IMessageContactMeta).platform === "imessage";
}

/**
 * Parse phone number or email from iMessage chatId
 * iMessage chatId format is typically:
 * - iMessage;-;+1234567890 (private chat phone number)
 * - iMessage;+;chat123456789 (group)
 * - iMessage;-;email@example.com (private chat email)
 * - +1234567890 (direct phone number)
 * @param chatId iMessage dialog ID
 * @returns Parsed phone number and email
 */
export function parseIMessageChatId(chatId: string): {
  phoneNumber?: string;
  email?: string;
} {
  if (!chatId) return {};

  // Handle standard iMessage format: iMessage;-;identifier or iMessage;+;identifier
  const iMessageMatch = chatId.match(/^iMessage;[+-];(.+)$/);
  const identifier = iMessageMatch ? iMessageMatch[1] : chatId;

  // Check if it's a phone number (starts with + or all digits)
  const phoneRegex = /^(\+?[0-9]{10,15})$/;
  if (phoneRegex.test(identifier.replace(/\s+/g, ""))) {
    return { phoneNumber: identifier.replace(/\s+/g, "") };
  }

  // Check if it's an email
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (emailRegex.test(identifier)) {
    return { email: identifier.toLowerCase() };
  }

  return {};
}

/**
 * Format chatId into format acceptable by iMessage SDK
 * Uniformly returns identifier starting with iMessage; (1-on-1 iMessage;-;, group iMessage;+;)
 * SMS; prefix will be replaced with iMessage;-;, plain phone/email will be completed to iMessage;-; format
 * @param identifier Identifier that may contain prefix:
 *   - SMS;+8615928069834 (SMS format in database)
 *   - iMessage;-;+8615928069834 (iMessage 1-on-1 format in database)
 *   - iMessage;+;chat123456 (group format)
 *   - +8615928069834 (plain phone number)
 *   - email@example.com (email)
 * @returns Complete identifier starting with iMessage;
 */
export function formatIMessageChatId(identifier: string): string {
  if (!identifier) return identifier;

  // Already in iMessage;-; or iMessage;+; format (case insensitive), return directly
  if (/^iMessage;[+-];.+$/i.test(identifier)) {
    // Normalize to uppercase iMessage
    return identifier.replace(/^iMessage;/i, "iMessage;");
  }

  // Handle malformed iMessage identifiers (e.g., imessage;xpf6677@163.com)
  // In this case, the actual identifier is after the second semicolon
  const malformedIMessageMatch = identifier.match(/^iMessage;(.+)$/i);
  if (malformedIMessageMatch) {
    const actualIdentifier = malformedIMessageMatch[1];
    // Recursively process actual identifier
    return formatIMessageChatId(actualIdentifier);
  }

  // SMS; format: replace with iMessage;-; 1-on-1 format
  // Example: SMS;+8615928069834 -> iMessage;-;+8615928069834
  if (identifier.startsWith("SMS;")) {
    return `iMessage;-;${identifier.slice(4)}`;
  }

  // Remove whitespace
  const normalized = identifier.replace(/\s+/g, "");

  // Phone number: complete to iMessage;-; format
  const phoneRegex = /^(\+?[0-9]{10,15})$/;
  if (phoneRegex.test(normalized)) {
    const phone = normalized.startsWith("+") ? normalized : `+${normalized}`;
    return `iMessage;-;${phone}`;
  }

  // Email: complete to iMessage;-; format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (emailRegex.test(normalized)) {
    return `iMessage;-;${normalized.toLowerCase()}`;
  }

  // Other formats (e.g., unknown group ID): uniformly add iMessage;-; prefix
  return `iMessage;-;${identifier}`;
}
