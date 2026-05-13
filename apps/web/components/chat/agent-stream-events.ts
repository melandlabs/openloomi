"use client";

import type { ChatMessage } from "@openloomi/shared";
import type { SetStateAction } from "react";
import type { JobAgentStreamEvent } from "@/lib/cron/types";

type SetMessages = (
  updater: SetStateAction<ChatMessage[]>,
  chatId?: string | null,
) => void;

export async function readJobExecutionEventStream(
  response: Response,
  onEvent: (event: JobAgentStreamEvent) => void | Promise<void>,
) {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("No response body");
  }

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() || "";

    for (const chunk of chunks) {
      const dataLines = chunk
        .split("\n")
        .filter((line) => line.startsWith("data: "))
        .map((line) => line.slice(6));
      if (dataLines.length === 0) continue;

      const event = JSON.parse(dataLines.join("\n")) as JobAgentStreamEvent;
      await onEvent(event);
    }
  }
}

function getTargetMessageId(
  event: JobAgentStreamEvent,
  fallbackAssistantMessageId: string,
) {
  return "messageId" in event && event.messageId
    ? event.messageId
    : fallbackAssistantMessageId;
}

function ensureAssistantMessage(
  messages: ChatMessage[],
  messageId: string,
): ChatMessage[] {
  if (messages.some((message) => message.id === messageId)) return messages;
  return [
    ...messages,
    {
      id: messageId,
      role: "assistant",
      content: "",
      parts: [{ type: "text", text: "" }],
    } as ChatMessage,
  ];
}

export function appendManualExecutionMessages(params: {
  setMessages: SetMessages;
  chatId: string;
  userMessageId: string;
  assistantMessageId: string;
  message: string;
}) {
  const { setMessages, chatId, userMessageId, assistantMessageId, message } =
    params;
  setMessages((prev) => {
    const withoutDuplicates = prev.filter(
      (item) => item.id !== userMessageId && item.id !== assistantMessageId,
    );
    return [
      ...withoutDuplicates,
      {
        id: userMessageId,
        role: "user",
        content: message,
        parts: [{ type: "text", text: message }],
      } as ChatMessage,
      {
        id: assistantMessageId,
        role: "assistant",
        content: "",
        parts: [{ type: "text", text: "" }],
      } as ChatMessage,
    ];
  }, chatId);
}

export function applyAgentStreamEventToMessages(params: {
  event: JobAgentStreamEvent;
  assistantMessageId: string;
  setMessages: SetMessages;
  chatId: string;
}) {
  const { event, assistantMessageId, setMessages, chatId } = params;
  if (
    event.type !== "text" &&
    event.type !== "tool_use" &&
    event.type !== "tool_result" &&
    event.type !== "error"
  ) {
    return;
  }

  const targetMessageId =
    event.type === "error"
      ? assistantMessageId
      : getTargetMessageId(event, assistantMessageId);

  setMessages((prev) => {
    const messages = ensureAssistantMessage(prev, targetMessageId);
    return messages.map((message) => {
      if (message.id !== targetMessageId || message.role !== "assistant") {
        return message;
      }

      let parts: any[] = Array.isArray(message.parts) ? [...message.parts] : [];

      if (event.type === "text") {
        const textPartIndex = parts.findIndex(
          (part: any) => part?.type === "text",
        );
        if (textPartIndex >= 0) {
          parts[textPartIndex] = { type: "text", text: event.content };
        } else {
          parts.push({ type: "text", text: event.content });
        }
        return { ...message, content: event.content, parts } as ChatMessage;
      }

      if (event.type === "tool_use") {
        parts = parts.filter(
          (part: any) =>
            !(part?.type === "text" && String(part?.text ?? "").trim() === ""),
        );
        const existingIndex = parts.findIndex(
          (part: any) =>
            part?.type === "tool-native" && part?.toolUseId === event.id,
        );
        const toolPart = {
          type: "tool-native" as const,
          toolName: event.name || "unknown",
          toolInput: event.input,
          status: "executing" as const,
          toolUseId: event.id,
        };
        if (existingIndex >= 0) {
          parts[existingIndex] = { ...parts[existingIndex], ...toolPart };
        } else {
          parts.push(toolPart);
        }
        return { ...message, parts } as ChatMessage;
      }

      if (event.type === "tool_result") {
        const updatedParts: any[] = parts.map((part: any) => {
          if (
            part?.type === "tool-native" &&
            part?.toolUseId === event.toolUseId
          ) {
            return {
              ...part,
              status: event.isError ? "error" : "completed",
              toolOutput: event.output,
              isError: event.isError,
            };
          }
          return part;
        });
        return { ...message, parts: updatedParts } as ChatMessage;
      }

      parts.push({
        type: "error",
        content: event.content,
      });
      return { ...message, parts } as ChatMessage;
    });
  }, chatId);
}
