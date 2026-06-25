import type { AgentMessage } from "@openloomi/ai/agent/types";

export interface ClaudeSdkMessageConversionOptions {
  message: unknown;
  // Tracks finalized assistant text blocks so replayed SDK messages do not
  // duplicate content already emitted to the UI/API stream.
  sentTextHashes: Set<string>;
  // Claude can surface tool calls in both stream events and final assistant
  // messages, so tool IDs are the stable de-dupe key across both paths.
  sentToolIds: Set<string>;
  // Once text deltas have streamed, the later assistant message is treated as
  // a replay summary; only tool calls still need to be recovered from it.
  hasStreamedText: boolean;
  createMessageId: () => string;
}

/**
 * Sanitize text content to remove internal implementation details that should
 * not be exposed to users.
 */
export function sanitizeClaudeAgentText(text: string): string {
  let sanitized = text;

  // Only match explicit authentication errors. Generic process failures can
  // include similar words, so keep crash/timeout detection separate.
  const apiKeyErrorPatterns = [
    /Invalid API key/i,
    /invalid_api_key/i,
    /API key.*invalid/i,
    /authentication failed/i,
    /Unauthorized/i,
    /AUTH_KEY_UNREGISTERED/,
    /AUTH_BYTES_INVALID/,
  ];

  const hasProcessCrash = /killed|OOM|SIGKILL|code 137/i.test(sanitized);
  const hasTimeout = /timeout|TIMEDOUT|ETIMEDOUT/i.test(sanitized);
  const hasProcessExit = /Process|exited with code/i.test(sanitized);
  const hasApiKeyError =
    !hasProcessCrash &&
    !hasTimeout &&
    !hasProcessExit &&
    apiKeyErrorPatterns.some((pattern) => pattern.test(sanitized));

  sanitized = sanitized.replace(
    /Claude Code process exited with code \d+/gi,
    "__AGENT_PROCESS_ERROR__",
  );

  sanitized = sanitized.replace(/\s*[·•\-–—]\s*Please run \/login\.?/gi, "");
  sanitized = sanitized.replace(/Please run \/login\.?/gi, "");

  if (hasApiKeyError) {
    return "__API_KEY_ERROR__";
  }

  return sanitized;
}

/**
 * Convert raw Claude Code SDK messages into OpenLoomi's AgentMessage stream.
 */
export function* convertClaudeSdkMessage({
  message,
  sentTextHashes,
  sentToolIds,
  hasStreamedText,
  createMessageId,
}: ClaudeSdkMessageConversionOptions): Generator<AgentMessage> {
  const msg = message as {
    type: string;
    message?: { content?: unknown[] };
    subtype?: string;
    total_cost_usd?: number;
    duration_ms?: number;
    event?: {
      type: string;
      delta?: { type?: string; text?: string; thinking?: string };
      content_block?: Record<string, unknown>;
    };
  };

  let currentHasStreamedText = hasStreamedText;

  if (msg.type === "stream_event" && msg.event) {
    const event = msg.event;

    // Prefer streaming text deltas when available so CLI/API consumers can see
    // incremental output instead of waiting for the final assistant message.
    if (
      event.type === "content_block_delta" &&
      event.delta &&
      event.delta.type === "text_delta" &&
      event.delta.text
    ) {
      const textDelta = event.delta.text;
      if (textDelta) {
        currentHasStreamedText = true;
        yield {
          type: "text",
          content: textDelta,
          messageId: createMessageId(),
        };
      }
    }

    // Claude Code exposes thinking separately from user-visible answer text.
    // Keep it as reasoning so downstream consumers can decide how to display it.
    if (
      event.type === "content_block_delta" &&
      event.delta?.type === "thinking_delta" &&
      event.delta.thinking
    ) {
      yield {
        type: "reasoning",
        content: event.delta.thinking,
        messageId: createMessageId(),
      };
    }

    // Tool calls can start before the final assistant message arrives. Emit them
    // early, then de-dupe by ID when the final message repeats the same call.
    if (event.type === "content_block_start" && event.content_block) {
      const block = event.content_block;
      if ("name" in block && "id" in block) {
        const toolId = block.id as string;
        const toolName = block.name as string;
        if (!sentToolIds.has(toolId)) {
          sentToolIds.add(toolId);
          yield {
            type: "tool_use",
            id: toolId,
            name: toolName,
            input: block.input,
            messageId: createMessageId(),
          };
        }
      }
    }
  }

  if (msg.type === "assistant" && msg.message?.content) {
    // After streaming text, the assistant message usually repeats content that
    // has already been emitted. Still scan it for tool calls because some calls
    // only appear in the finalized message.
    if (currentHasStreamedText) {
      for (const block of msg.message.content as Record<string, unknown>[]) {
        if ("name" in block && "id" in block) {
          const toolId = block.id as string;
          const toolName = block.name as string;
          if (!sentToolIds.has(toolId)) {
            sentToolIds.add(toolId);
            yield {
              type: "tool_use",
              id: toolId,
              name: toolName,
              input: block.input,
              messageId: createMessageId(),
            };
          }
        }
      }
      return;
    }

    // Non-streaming runs only have the finalized assistant message, so convert
    // each text/tool block directly and protect against repeated SDK payloads.
    for (const block of msg.message.content as Record<string, unknown>[]) {
      if ("text" in block) {
        const sanitizedText = sanitizeClaudeAgentText(block.text as string);
        const textHash = sanitizedText.slice(0, 100);

        if (!sentTextHashes.has(textHash)) {
          sentTextHashes.add(textHash);
          yield {
            type: "text",
            content: sanitizedText,
            messageId: createMessageId(),
          };
        }
      } else if ("name" in block && "id" in block) {
        const toolId = block.id as string;
        const toolName = block.name as string;

        // AskUserQuestion is a first-class permission/input request in
        // OpenLoomi, not a generic tool call.
        if (toolName === "AskUserQuestion" && !sentToolIds.has(toolId)) {
          sentToolIds.add(toolId);
          const toolInput = block.input as {
            questions?: Array<{
              question: string;
              header: string;
              options: Array<{ label: string; description?: string }>;
              multiSelect?: boolean;
            }>;
          };

          if (toolInput.questions && toolInput.questions.length > 0) {
            yield {
              type: "question",
              question: {
                id: toolId,
                questions: toolInput.questions,
                status: "pending",
              },
              messageId: createMessageId(),
            };
          }
        } else if (!sentToolIds.has(toolId)) {
          sentToolIds.add(toolId);
          yield {
            type: "tool_use",
            id: toolId,
            name: toolName,
            input: block.input,
            messageId: createMessageId(),
          };
        }
      }
    }
  }

  if (msg.type === "user" && msg.message?.content) {
    for (const block of msg.message.content as Record<string, unknown>[]) {
      if ("type" in block && block.type === "tool_result") {
        // SDK/tool adapters have used both snake_case and camelCase keys over
        // time; support both so old and new tool results render consistently.
        const toolUseIdSnake = (block as { tool_use_id?: unknown }).tool_use_id;
        const toolUseIdCamel = (block as { toolUseId?: unknown }).toolUseId;
        const isErrorSnake = (block as { is_error?: unknown }).is_error;
        const isErrorCamel = (block as { isError?: unknown }).isError;
        const toolUseId = toolUseIdSnake ?? toolUseIdCamel;
        const rawIsError = isErrorSnake ?? isErrorCamel;
        const isError = typeof rawIsError === "boolean" ? rawIsError : false;

        yield {
          type: "tool_result",
          toolUseId: (toolUseId ?? "") as string,
          output:
            typeof block.content === "string"
              ? block.content
              : JSON.stringify(block.content),
          isError,
          messageId: createMessageId(),
        };
      }
    }
  }

  if (msg.type === "result") {
    // The result event is metadata-only: final status, cost, and duration.
    yield {
      type: "result",
      content: msg.subtype,
      cost: msg.total_cost_usd,
      duration: msg.duration_ms,
    };
  }
}
