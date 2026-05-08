import type { AssistantModelMessage, ToolModelMessage, UIMessage } from "ai";
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import type { ChatMessage } from "./types";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function generateUUID(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

type ResponseMessageWithoutId = ToolModelMessage | AssistantModelMessage;
type ResponseMessage = ResponseMessageWithoutId & { id: string };

export function getMostRecentUserMessage(messages: Array<UIMessage>) {
  const userMessages = messages.filter((message) => message.role === "user");
  return userMessages.at(-1);
}

export function getTrailingMessageId({
  messages,
}: {
  messages: Array<ResponseMessage>;
}): string | null {
  const trailingMessage = messages.at(-1);

  if (!trailingMessage) return null;

  return trailingMessage.id;
}

export function sanitizeText(text: string) {
  return text.replace("<has_function_call>", "");
}

export function getTextFromMessage(message: ChatMessage): string {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
}

export function getCurrentTimestamp() {
  return Math.floor(Date.now() / 1000);
}

/**
 * Normalize timestamp to millisecond precision
 * Auto-detects timestamp format: if less than 10000000000 (April 1970), treat as second-level timestamp and convert to milliseconds
 * @param timestamp - Timestamp (can be second-level or millisecond-level)
 * @returns Normalized millisecond-level timestamp
 */
export function normalizeTimestamp(
  timestamp: number | string | null | undefined,
): number {
  if (!timestamp) return Date.now();

  const numTimestamp =
    typeof timestamp === "string" ? Number.parseInt(timestamp, 10) : timestamp;

  if (Number.isNaN(numTimestamp)) return Date.now();

  // If timestamp is less than 10000000000 (April 1970), treat as second-level and convert to milliseconds
  return numTimestamp < 10000000000 ? numTimestamp * 1000 : numTimestamp;
}

export const formatToLocalTime = (time: string | number | Date): string => {
  const date = new Date(time);
  return date.toLocaleString();
};

export function getCurrentYearMonth(): { year: number; month: number } {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  return { year, month };
}

export function formatBytes(bytes: number, decimals = 1): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return "0 B";
  }

  if (bytes === 0) {
    return "0 B";
  }

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["B", "KB", "MB", "GB", "TB"];

  const index = Math.min(
    Math.floor(Math.log(bytes) / Math.log(k)),
    sizes.length - 1,
  );
  const formatted = Number.parseFloat(
    (bytes / Math.pow(k, index)).toFixed(dm),
  ).toString();

  return `${formatted} ${sizes[index]}`;
}

// Time utilities
export function coerceDate(input: unknown): Date {
  if (input instanceof Date) return input;
  if (typeof input === "number") {
    return new Date(input * (input > 1e12 ? 1 : 1000));
  }
  if (typeof input === "string") {
    const numeric = Number(input);
    if (!Number.isNaN(numeric)) {
      return new Date(numeric * (numeric > 1e12 ? 1 : 1000));
    }
    const parsed = new Date(input);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }
  return new Date();
}

export function timeBeforeHours(
  hours: number,
  now: number = Date.now(),
): number {
  return Math.floor((now - hours * 60 * 60 * 1000) / 1000);
}

export function timeBeforeHoursMs(
  hours: number,
  now: number = Date.now(),
): number {
  return now - hours * 60 * 60 * 1000;
}

export function timeBeforeMinutes(
  minutes: number,
  now: number = Date.now(),
): number {
  return Math.floor((now - minutes * 60 * 1000) / 1000);
}

export const delay = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

// ============ Tool Call Text Processing ============

/**
 * Regex to match Claude XML tool call format output as plain text.
 * This catches malformed tool calls where the model outputs XML format instead of JSON.
 *
 * The tool name can contain various characters including spaces, hyphens, underscores.
 * We use [^"'>]+ to match any characters except quotes and angle brackets.
 */
const MALFORMED_TOOL_CALL_REGEX =
  /<invoke name=("[^"]*"|'[^']*'|[^\s>]+)\s*>[\s\S]*?<\/invoke>/gi;

/**
 * Regex to match incomplete/malformed tool call opening tags
 */
const MALFORMED_TOOL_CALL_START_REGEX =
  /<invoke name=("[^"]*"|'[^']*'|[^\s>]+)\s*>(?![\s\S]*?<\/invoke>)/gi;

/**
 * Detect if text contains a malformed tool call (Claude XML format output as text).
 * This happens when some models output tool calls in XML format instead of using the JSON API.
 */
export function containsMalformedToolCall(text: string): boolean {
  if (!text) return false;
  // Reset regex state
  MALFORMED_TOOL_CALL_REGEX.lastIndex = 0;
  return MALFORMED_TOOL_CALL_REGEX.test(text);
}

/**
 * Extract malformed tool calls from text for potential reprocessing.
 * Returns an array of { toolName, fullMatch } objects.
 */
export function extractMalformedToolCalls(
  text: string,
): Array<{ toolName: string; fullMatch: string }> {
  if (!text) return [];

  const results: Array<{ toolName: string; fullMatch: string }> = [];

  // Match complete tool call blocks using matchAll
  const matches = text.matchAll(MALFORMED_TOOL_CALL_REGEX);
  for (const match of matches) {
    results.push({
      toolName: (match[2] as string) || "unknown",
      fullMatch: match[0],
    });
  }

  return results;
}

/**
 * Remove malformed tool calls from text.
 * Use this to clean up text that accidentally contains XML tool call format.
 */
export function stripMalformedToolCalls(text: string): string {
  if (!text) return text;

  // First, replace complete tool call blocks
  MALFORMED_TOOL_CALL_REGEX.lastIndex = 0;
  let result = text.replace(MALFORMED_TOOL_CALL_REGEX, "");

  // Also remove any leftover opening tags that weren't closed
  MALFORMED_TOOL_CALL_START_REGEX.lastIndex = 0;
  result = result.replace(MALFORMED_TOOL_CALL_START_REGEX, "");

  // Clean up any remaining XML-like tags that look like tool calls
  result = result.replace(/<invoke[^>]*>[\s\S]*?<\/invoke>/gi, "");

  // Clean up chat output prefix if followed by a tool call
  result = result.replace(/^chat output:\s*/gim, "");

  // Clean up excessive whitespace left behind
  result = result.replace(/\n{3,}/g, "\n\n").trim();

  return result;
}

/**
 * Filter out tool call text from output.
 * Removes [TOOL_USE] and [TOOL_RESULT] blocks and their associated
 * JSON parameters that are generated during compaction preprocessing.
 * Also removes malformed XML tool calls (e.g., <invoke name="...">...</invoke>)
 * that some models like MiniMax occasionally output as text instead of JSON.
 */
export function filterToolCallText(text: string): string {
  if (!text) return text;

  // First, strip any malformed XML tool calls (e.g., <invoke name="...">...</invoke>)
  const cleanedText = stripMalformedToolCalls(text);

  const lines = cleanedText.split("\n");
  const result: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip lines that start with [TOOL_USE N/N] or [TOOL_RESULT N/N] (with optional space after TOOL_)
    if (/^\[TOOL_\s?(USE|RESULT)\s+\d+\/\d+\]/.test(trimmed)) {
      // Check if this is a single-line tool result (marker + JSON on same line)
      // If so, skip the entire line
      const afterMarker = trimmed.replace(
        /^\[TOOL_\s?(USE|RESULT)\s+\d+\/\d+\]\s*/,
        "",
      );
      if (afterMarker.startsWith("{")) {
        i++;
        continue;
      }
      i++;
      // Skip following lines that are clearly part of the tool call block:
      // - Lines with only { or [ (opening JSON)
      // - Lines with only } or ] (closing JSON)
      // - Lines starting with mcp__ or known tool names
      while (i < lines.length) {
        const nextTrimmed = lines[i].trim();
        // Stop if this line is clearly content (has meaningful text that's not JSON/padding)
        if (
          nextTrimmed === "" ||
          nextTrimmed === "}" ||
          nextTrimmed === "]" ||
          nextTrimmed === "{" ||
          /^{[\s]*}$/.test(nextTrimmed) ||
          /^[\s]*\}[;\s]*$/.test(nextTrimmed)
        ) {
          i++;
          continue;
        }
        // Stop if this looks like tool parameters (key: value pairs)
        if (
          /^"command"\s*:/.test(nextTrimmed) ||
          /^"description"\s*:/.test(nextTrimmed) ||
          /^"input"\s*:/.test(nextTrimmed) ||
          /^"output"\s*:/.test(nextTrimmed) ||
          /^"status"\s*:/.test(nextTrimmed) ||
          /^"result"\s*:/.test(nextTrimmed) ||
          /^"name"\s*:/.test(nextTrimmed)
        ) {
          i++;
          continue;
        }
        // Stop if this is a known tool name or mcp tool
        if (
          /^mcp__/.test(nextTrimmed) ||
          /^(Bash|queryIntegrations|Sh|Node|RunCommand)\b/.test(nextTrimmed)
        ) {
          i++;
          continue;
        }
        // Stop if this is another tool call marker
        if (
          /^\[TOOL_\s?(USE|RESULT)\s+\d+\/\d+\]/.test(nextTrimmed) ||
          /^\[TOOL_(USE|RESULT)\]/.test(nextTrimmed)
        ) {
          i++;
          continue;
        }
        // This line is content, stop skipping
        break;
      }
      continue;
    }

    // Skip lines that are [TOOL_USE] or [TOOL_RESULT] without N/N
    if (/^\[TOOL_(USE|RESULT)\]/.test(trimmed)) {
      i++;
      continue;
    }

    // Handle lines that contain (but don't start with) tool markers, like "Assistant:[TOOL_RESULT 1/4]"
    // This catches malformed output where a prefix precedes the tool marker on the same line
    if (/\[TOOL_\s?(USE|RESULT)\s+\d+\/\d+\]/.test(trimmed)) {
      // Check if line is just the tool marker prefixed content (skip it)
      if (/^Assistant:\[TOOL_\s?RESULT\s+\d+\/\d+\]$/.test(trimmed)) {
        i++;
        continue;
      }
      // Check if the content after the tool marker is JSON - if so, skip entirely
      const afterToolMarker = trimmed.replace(
        /^(?:Assistant:)?\[TOOL_\s?(USE|RESULT)\s+\d+\/\d+\]\s*/g,
        "",
      );
      if (afterToolMarker.startsWith("{")) {
        i++;
        continue;
      }
      // Line has content after the tool marker - remove the tool portion and keep the content
      const cleanedLine = trimmed
        .replace(/Assistant:\[TOOL_\s?RESULT\s+\d+\/\d+\]/g, "")
        .trim();
      if (cleanedLine) {
        result.push(
          lines[i].replace(/Assistant:\[TOOL_\s?RESULT\s+\d+\/\d+\]/g, ""),
        );
      }
      i++;
      continue;
    }

    // Skip lines that are only closing braces (leftover from tool call JSON blocks)
    if (trimmed === "}" || trimmed === "]") {
      i++;
      continue;
    }

    // Skip lines that look like they start with JSON key-value pairs from tool calls
    if (
      /^"command"\s*:/.test(trimmed) ||
      /^"description"\s*:/.test(trimmed) ||
      /^"input"\s*:/.test(trimmed) ||
      /^"output"\s*:/.test(trimmed) ||
      /^"status"\s*:/.test(trimmed) ||
      /^"result"\s*:/.test(trimmed) ||
      /^"name"\s*:/.test(trimmed)
    ) {
      i++;
      continue;
    }

    // Skip lines that look like corrupted inline JSON (e.g., "I\"type\"text\"text\"...\"success\" true...")
    // These are malformed JSON fragments that got concatenated with other text
    if (
      (trimmed.includes('"success"') || trimmed.includes('"error"')) &&
      /[a-zA-Z]"[^"]+"[a-zA-Z]/.test(trimmed)
    ) {
      i++;
      continue;
    }

    // Skip lines that are clearly corrupted JSON with garbled text between quotes
    // Pattern: starts with letter, contains multiple quoted strings with single letters between them
    if (
      /^.[^"]*"[a-zA-Z]"[^"]*"[^"]*"[^"]*$/.test(trimmed) &&
      (trimmed.includes('"type"') ||
        trimmed.includes('"text"') ||
        trimmed.includes('"success"'))
    ) {
      i++;
      continue;
    }

    result.push(line);
    i++;
  }

  // Final cleanup: remove any remaining orphaned closing braces
  const cleaned = result
    .join("\n")
    .replace(/^\s*}\s*$/gm, "")
    .trim();

  return cleaned;
}

// ============ Navigation URL Builder ============

/**
 * Navigation URL build options
 */
export interface BuildNavigationUrlOptions {
  /** Current path (required to ensure it works in desktop environments like Tauri) */
  pathname: string;
  /** Current query parameters (string or URLSearchParams object) */
  searchParams?: string | URLSearchParams | null;
  /** Optional: new chatId (will change path to /chat/{chatId} or / when chatId is null) */
  chatId?: string | null;
  /** Query parameters to add/update/delete (setting to null or undefined deletes the parameter) */
  paramsToUpdate?: Record<string, string | null | undefined>;
}

/**
 * Build navigation URL, preserving current path and query parameters
 *
 * **Note**: This function requires explicit `pathname` to ensure it works in all environments including Web and Tauri desktop.
 */
export function buildNavigationUrl(options: BuildNavigationUrlOptions): string {
  const { pathname, searchParams, chatId, paramsToUpdate = {} } = options;

  const params = new URLSearchParams(searchParams?.toString() || "");

  Object.entries(paramsToUpdate).forEach(([key, value]) => {
    if (value === null || value === undefined) {
      params.delete(key);
    } else {
      params.set(key, value);
    }
  });

  const queryString = params.toString();

  if (chatId !== undefined) {
    const newPath = chatId ? `/chat/${chatId}` : "/";
    return queryString ? `${newPath}?${queryString}` : newPath;
  }

  return queryString ? `${pathname}?${queryString}` : pathname;
}
