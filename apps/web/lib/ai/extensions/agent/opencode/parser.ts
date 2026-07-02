import type { AgentMessage } from "@openloomi/ai/agent/types";

export function parseOpenCodeJsonLine(line: string): AgentMessage[] {
  const trimmed = line.trim();
  if (!trimmed) {
    return [];
  }

  let event: unknown;
  try {
    event = JSON.parse(trimmed);
  } catch {
    return [];
  }

  return convertOpenCodeEvent(event);
}

export function convertOpenCodeEvent(event: unknown): AgentMessage[] {
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    return [];
  }

  const record = event as Record<string, unknown>;
  const type = readString(record.type) || readString(record.event);
  const messages: AgentMessage[] = [];

  const isErrorEvent = type?.toLowerCase().includes("error") ?? false;
  const errorText = extractErrorText(record);
  if (errorText || isErrorEvent) {
    messages.push({
      type: "error",
      message: errorText || extractText(record) || "OpenCode event error",
    });
    return messages;
  }

  const toolMessage = extractToolMessage(record, type);
  if (toolMessage) {
    messages.push(toolMessage);
    return messages;
  }

  const text = extractText(record);
  if (text && shouldTreatAsText(type, record)) {
    messages.push({
      type: "text",
      content: text,
    });
    return messages;
  }

  if (type === "result" || type === "done" || type === "complete") {
    messages.push({
      type: "result",
      content: type,
      cost: readNumber(record.cost) ?? readNumber(record.total_cost_usd),
      duration: readNumber(record.duration) ?? readNumber(record.duration_ms),
    });
  }

  return messages;
}

function extractToolMessage(
  record: Record<string, unknown>,
  type: string | undefined,
): AgentMessage | undefined {
  const lowerType = type?.toLowerCase() ?? "";
  const tool =
    asRecord(record.tool) ||
    asRecord(record.toolCall) ||
    asRecord(record.tool_call) ||
    record;
  const toolName =
    readString(tool.name) ||
    readString(tool.toolName) ||
    readString(tool.tool_name);
  const toolId =
    readString(tool.id) ||
    readString(tool.toolUseId) ||
    readString(tool.tool_use_id);

  if (!lowerType.includes("tool") && !toolName) {
    return undefined;
  }

  const output =
    readString(tool.output) ||
    readString(tool.result) ||
    readString(tool.content);

  if (lowerType.includes("result") || output) {
    return {
      type: "tool_result",
      toolUseId: toolId,
      output: output ?? "",
      isError: readBoolean(tool.isError) ?? readBoolean(tool.is_error) ?? false,
    };
  }

  if (!toolName) {
    return undefined;
  }

  return {
    type: "tool_use",
    id: toolId,
    name: toolName,
    input:
      asRecord(tool.input) ||
      asRecord(tool.args) ||
      asRecord(tool.arguments) ||
      undefined,
  };
}

function shouldTreatAsText(
  type: string | undefined,
  record: Record<string, unknown>,
) {
  if (!type) {
    return true;
  }

  const lowerType = type.toLowerCase();
  if (
    lowerType.includes("text") ||
    lowerType.includes("message") ||
    lowerType.includes("assistant") ||
    lowerType.includes("content") ||
    lowerType.includes("delta")
  ) {
    return true;
  }

  return (
    typeof record.text === "string" ||
    typeof record.delta === "string" ||
    typeof record.message === "string"
  );
}

function extractText(record: Record<string, unknown>): string | undefined {
  for (const key of ["text", "content", "message", "delta"]) {
    const value = record[key];
    if (typeof value === "string") {
      return value;
    }
  }

  const message = asRecord(record.message);
  if (message) {
    const text = extractText(message);
    if (text) return text;
  }

  const part = asRecord(record.part) || asRecord(record.content_block);
  if (part) {
    const text = extractText(part);
    if (text) return text;
  }

  if (Array.isArray(record.content)) {
    const texts = record.content
      .map((item) => {
        const itemRecord = asRecord(item);
        return itemRecord ? extractText(itemRecord) : undefined;
      })
      .filter((item): item is string => typeof item === "string");
    if (texts.length > 0) {
      return texts.join("");
    }
  }

  return undefined;
}

function extractErrorText(record: Record<string, unknown>): string | undefined {
  if (typeof record.error === "string") {
    return record.error;
  }
  const error = asRecord(record.error);
  if (error) {
    return readString(error.message) || readString(error.name);
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}
