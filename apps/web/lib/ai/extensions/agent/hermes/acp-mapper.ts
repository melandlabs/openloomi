import type { AgentMessage, AgentOptions } from "@openloomi/ai/agent/types";

export function convertHermesAcpNotification(params: unknown): AgentMessage[] {
  const record = asRecord(params);
  const update = asRecord(record?.update);
  if (!update) {
    return [];
  }

  const updateType = readString(update.sessionUpdate);
  switch (updateType) {
    case "agent_message_chunk": {
      const text = extractText(update.content);
      return text ? [{ type: "text", content: text }] : [];
    }
    case "agent_thought_chunk": {
      const text = extractText(update.content);
      return text ? [{ type: "reasoning", content: text }] : [];
    }
    case "tool_call":
      return [convertToolCall(update)];
    case "tool_call_update": {
      const toolResult = convertToolCallUpdate(update);
      return toolResult ? [toolResult] : [];
    }
    case "usage_update": {
      const usage = extractUsage(update.usage ?? update);
      return usage ? [{ type: "result", content: "usage_update", usage }] : [];
    }
    default:
      return [];
  }
}

export function convertHermesPromptResponse(result: unknown): AgentMessage[] {
  const record = asRecord(result);
  const stopReason = readString(record?.stopReason) ?? "end_turn";
  const usage = extractUsage(record?.usage);

  if (stopReason === "cancelled") {
    return [
      {
        type: "error",
        message: "Hermes ACP prompt was cancelled",
      },
    ];
  }

  return [
    {
      type: "result",
      content: stopReason,
      usage,
    },
  ];
}

export async function mapHermesPermissionRequest(
  params: unknown,
  options: AgentOptions | undefined,
  mode: "run" | "plan" | "execute",
) {
  const request = asRecord(params);
  const toolCall = asRecord(request?.toolCall);
  const permissionOptions = Array.isArray(request?.options)
    ? request.options.filter(isRecord)
    : [];

  if (mode === "plan") {
    return selectDenyOutcome(permissionOptions);
  }

  let behavior: "allow" | "deny" = "deny";
  if (options?.onPermissionRequest) {
    const decision = await options.onPermissionRequest({
      toolName: readString(toolCall?.title) ?? "Hermes tool",
      toolInput: asRecord(toolCall?.rawInput) ?? {},
      toolUseID: readString(toolCall?.toolCallId) ?? "hermes-tool",
    });
    behavior = decision.behavior;
  }

  if (behavior === "allow") {
    return selectAllowOutcome(permissionOptions);
  }

  return selectDenyOutcome(permissionOptions);
}

function convertToolCall(update: Record<string, unknown>): AgentMessage {
  return {
    type: "tool_use",
    id: readString(update.toolCallId),
    name: readString(update.title) || readString(update.kind) || "Hermes tool",
    input: asRecord(update.rawInput) ?? undefined,
  };
}

function convertToolCallUpdate(
  update: Record<string, unknown>,
): AgentMessage | undefined {
  const output =
    readString(update.rawOutput) ??
    extractText(update.rawOutput) ??
    extractText(update.content) ??
    stringifyUnknown(update.rawOutput);
  const status = readString(update.status);

  if (!output && !status) {
    return undefined;
  }

  return {
    type: "tool_result",
    toolUseId: readString(update.toolCallId),
    output: output ?? "",
    isError: status === "failed",
  };
}

function selectAllowOutcome(options: Record<string, unknown>[]) {
  const option =
    findPermissionOption(options, ["allow_once"]) ??
    findPermissionOption(options, ["allow_session"]) ??
    findPermissionOption(options, ["allow"], ["always"]);

  if (!option) {
    return selectDenyOutcome(options);
  }

  return {
    outcome: {
      outcome: "selected",
      optionId: option,
    },
  };
}

function selectDenyOutcome(options: Record<string, unknown>[]) {
  const option =
    findPermissionOption(options, ["reject_once"]) ??
    findPermissionOption(options, ["deny_once"]) ??
    findPermissionOption(options, ["reject", "deny"]);

  if (!option) {
    return {
      outcome: {
        outcome: "cancelled",
      },
    };
  }

  return {
    outcome: {
      outcome: "selected",
      optionId: option,
    },
  };
}

function findPermissionOption(
  options: Record<string, unknown>[],
  includes: string[],
  excludes: string[] = [],
) {
  for (const option of options) {
    const haystack = `${readString(option.kind) ?? ""} ${
      readString(option.name) ?? ""
    }`.toLowerCase();
    if (
      includes.some((value) => haystack.includes(value)) &&
      excludes.every((value) => !haystack.includes(value))
    ) {
      return readString(option.optionId);
    }
  }

  return undefined;
}

function extractText(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }

  const record = asRecord(value);
  if (record) {
    for (const key of ["text", "content", "message", "delta"]) {
      const direct = record[key];
      if (typeof direct === "string") {
        return direct;
      }
    }

    const nested = extractText(record.content);
    if (nested) {
      return nested;
    }
  }

  if (Array.isArray(value)) {
    const text = value
      .map((item) => extractText(item))
      .filter((item): item is string => Boolean(item))
      .join("");
    return text || undefined;
  }

  return undefined;
}

function extractUsage(value: unknown): AgentMessage["usage"] | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }

  const inputTokens = readNumber(record.inputTokens);
  const outputTokens = readNumber(record.outputTokens);
  if (inputTokens === undefined || outputTokens === undefined) {
    return undefined;
  }

  return {
    inputTokens,
    outputTokens,
  };
}

function stringifyUnknown(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  return typeof value === "string" ? value : JSON.stringify(value);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}
