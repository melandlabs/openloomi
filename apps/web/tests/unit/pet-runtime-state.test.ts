import type { ChatMessage } from "@openloomi/shared";
import { describe, expect, it } from "vitest";

import {
  derivePetRuntimeState,
  derivePetSettleState,
  getLatestAssistantActivity,
  isMemoryRetrievalTool,
} from "@/components/pet/pet-runtime-state";

describe("derivePetRuntimeState", () => {
  it("stays idle when queued work exists but no agent is running", () => {
    expect(
      derivePetRuntimeState({
        isSending: false,
        activeChatRunning: false,
        runningChatCount: 0,
        executingToolCount: 0,
        executingMemoryRetrievalCount: 0,
        executingOtherToolCount: 0,
        hasAssistantOutput: false,
      }),
    ).toBe("idle");
  });

  it("uses thinking while a sent message is waiting for output", () => {
    expect(
      derivePetRuntimeState({
        isSending: true,
        activeChatRunning: false,
        runningChatCount: 0,
        executingToolCount: 0,
        executingMemoryRetrievalCount: 0,
        executingOtherToolCount: 0,
        hasAssistantOutput: false,
      }),
    ).toBe("thinking");
  });

  it("uses working for one executing tool", () => {
    expect(
      derivePetRuntimeState({
        isSending: false,
        activeChatRunning: true,
        runningChatCount: 1,
        executingToolCount: 1,
        executingMemoryRetrievalCount: 0,
        executingOtherToolCount: 1,
        hasAssistantOutput: false,
      }),
    ).toBe("working");
  });

  it("uses juggling only for actual concurrent work", () => {
    expect(
      derivePetRuntimeState({
        isSending: false,
        activeChatRunning: true,
        runningChatCount: 1,
        executingToolCount: 2,
        executingMemoryRetrievalCount: 1,
        executingOtherToolCount: 1,
        hasAssistantOutput: true,
      }),
    ).toBe("juggling");
  });

  it("uses juggling when two chats are actually running", () => {
    expect(
      derivePetRuntimeState({
        isSending: false,
        activeChatRunning: true,
        runningChatCount: 2,
        executingToolCount: 0,
        executingMemoryRetrievalCount: 0,
        executingOtherToolCount: 0,
        hasAssistantOutput: false,
      }),
    ).toBe("juggling");
  });

  it("uses thinking for one executing memory retrieval tool", () => {
    expect(
      derivePetRuntimeState({
        isSending: false,
        activeChatRunning: true,
        runningChatCount: 1,
        executingToolCount: 1,
        executingMemoryRetrievalCount: 1,
        executingOtherToolCount: 0,
        hasAssistantOutput: false,
      }),
    ).toBe("thinking");
  });

  it("uses juggling for two executing memory retrieval tools", () => {
    expect(
      derivePetRuntimeState({
        isSending: false,
        activeChatRunning: true,
        runningChatCount: 1,
        executingToolCount: 2,
        executingMemoryRetrievalCount: 2,
        executingOtherToolCount: 0,
        hasAssistantOutput: false,
      }),
    ).toBe("juggling");
  });
});

describe("isMemoryRetrievalTool", () => {
  it("recognizes every supported memory retrieval tool", () => {
    for (const toolName of [
      "searchUnifiedMemory",
      "searchMemoryPath",
      "getRawMessages",
      "searchRawMessages",
      "searchKnowledgeBase",
      "getFullDocumentContent",
    ]) {
      expect(isMemoryRetrievalTool(toolName)).toBe(true);
    }
  });

  it("normalizes MCP-prefixed memory retrieval tools", () => {
    expect(
      isMemoryRetrievalTool("mcp__business-tools__searchUnifiedMemory"),
    ).toBe(true);
  });

  it("rejects unknown and non-memory tools", () => {
    expect(isMemoryRetrievalTool("Bash")).toBe(false);
    expect(isMemoryRetrievalTool("futureUnknownTool")).toBe(false);
    expect(isMemoryRetrievalTool(undefined)).toBe(false);
  });
});

describe("derivePetSettleState", () => {
  it("shows a brief happy state when the result is visible", () => {
    expect(
      derivePetSettleState({ hasAssistantOutput: true, hasError: false }, true),
    ).toEqual({ state: "happy", monologue: "Done", durationMs: 3_000 });
  });

  it("presents a background result before returning to baseline", () => {
    expect(
      derivePetSettleState(
        { hasAssistantOutput: true, hasError: false },
        false,
      ),
    ).toEqual({
      state: "presenting",
      monologue: "Your result is ready",
      durationMs: 8_000,
    });
  });

  it("uses needsinput for an error", () => {
    expect(
      derivePetSettleState({ hasAssistantOutput: false, hasError: true }, true),
    ).toEqual({
      state: "needsinput",
      monologue: "Something needs your attention",
      durationMs: 8_000,
    });
  });
});

describe("getLatestAssistantActivity", () => {
  it("maps an executing memory tool stream to thinking end to end", () => {
    const activity = getLatestAssistantActivity([
      {
        id: "assistant-memory-thinking",
        role: "assistant",
        content: "",
        parts: [
          {
            type: "tool-native",
            toolName: "mcp__business-tools__searchUnifiedMemory",
            status: "executing",
            toolUseId: "memory",
          },
        ],
      } as unknown as ChatMessage,
    ]);

    expect(
      derivePetRuntimeState({
        isSending: false,
        activeChatRunning: true,
        runningChatCount: 1,
        executingToolCount: activity.executingToolCount,
        executingMemoryRetrievalCount: activity.executingMemoryRetrievalCount,
        executingOtherToolCount: activity.executingOtherToolCount,
        hasAssistantOutput: activity.hasAssistantOutput,
      }),
    ).toBe("thinking");
  });

  it("counts executing tools and detects output", () => {
    const activity = getLatestAssistantActivity([
      {
        id: "assistant-1",
        role: "assistant",
        content: "",
        parts: [
          { type: "tool-native", status: "executing", toolUseId: "a" },
          { type: "tool-native", status: "executing", toolUseId: "b" },
          { type: "text", text: "Working on it" },
        ],
      } as unknown as ChatMessage,
    ]);

    expect(activity).toEqual({
      executingToolCount: 2,
      executingMemoryRetrievalCount: 0,
      executingOtherToolCount: 2,
      hasAssistantOutput: true,
      hasError: false,
    });
  });

  it("separates memory retrieval from other executing tools", () => {
    const activity = getLatestAssistantActivity([
      {
        id: "assistant-memory",
        role: "assistant",
        content: "",
        parts: [
          {
            type: "tool-native",
            toolName: "mcp__business-tools__searchUnifiedMemory",
            status: "executing",
            toolUseId: "memory",
          },
          {
            type: "tool-native",
            toolName: "Bash",
            status: "executing",
            toolUseId: "shell",
          },
        ],
      } as unknown as ChatMessage,
    ]);

    expect(activity).toEqual({
      executingToolCount: 2,
      executingMemoryRetrievalCount: 1,
      executingOtherToolCount: 1,
      hasAssistantOutput: false,
      hasError: false,
    });
  });

  it("treats an unknown executing tool as other tool activity", () => {
    const activity = getLatestAssistantActivity([
      {
        id: "assistant-unknown",
        role: "assistant",
        content: "",
        parts: [
          {
            type: "tool-native",
            toolName: "futureUnknownTool",
            status: "executing",
            toolUseId: "unknown",
          },
        ],
      } as unknown as ChatMessage,
    ]);

    expect(activity.executingMemoryRetrievalCount).toBe(0);
    expect(activity.executingOtherToolCount).toBe(1);
  });

  it("keeps completed memory output and errors in settle activity", () => {
    const completed = getLatestAssistantActivity([
      {
        id: "assistant-completed-memory",
        role: "assistant",
        content: "",
        parts: [
          {
            type: "tool-native",
            toolName: "searchUnifiedMemory",
            status: "completed",
            toolOutput: { results: [] },
            toolUseId: "memory",
          },
        ],
      } as unknown as ChatMessage,
    ]);
    expect(completed).toEqual({
      executingToolCount: 0,
      executingMemoryRetrievalCount: 0,
      executingOtherToolCount: 0,
      hasAssistantOutput: true,
      hasError: false,
    });

    const failed = getLatestAssistantActivity([
      {
        id: "assistant-failed-memory",
        role: "assistant",
        content: "",
        parts: [
          {
            type: "tool-native",
            toolName: "searchUnifiedMemory",
            status: "error",
            isError: true,
            toolUseId: "memory",
          },
        ],
      } as unknown as ChatMessage,
    ]);
    expect(derivePetSettleState(failed, true).state).toBe("needsinput");
  });

  it("detects terminal assistant errors", () => {
    const activity = getLatestAssistantActivity([
      {
        id: "assistant-1",
        role: "assistant",
        content: "error",
        parts: [{ type: "error", content: "failed" }],
      } as unknown as ChatMessage,
    ]);
    expect(activity.hasError).toBe(true);
  });
});
