import { describe, expect, it } from "vitest";

import {
  derivePetSettleState,
  derivePetRuntimeState,
  getLatestAssistantActivity,
} from "@/components/pet/pet-runtime-state";

describe("derivePetRuntimeState", () => {
  it("stays idle when queued work exists but no agent is running", () => {
    expect(
      derivePetRuntimeState({
        isSending: false,
        activeChatRunning: false,
        runningChatCount: 0,
        executingToolCount: 0,
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
        hasAssistantOutput: false,
      }),
    ).toBe("juggling");
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
      } as any,
    ]);

    expect(activity).toEqual({
      executingToolCount: 2,
      hasAssistantOutput: true,
      hasError: false,
    });
  });

  it("detects terminal assistant errors", () => {
    const activity = getLatestAssistantActivity([
      {
        id: "assistant-1",
        role: "assistant",
        content: "error",
        parts: [{ type: "error", content: "failed" }],
      } as any,
    ]);
    expect(activity.hasError).toBe(true);
  });
});
