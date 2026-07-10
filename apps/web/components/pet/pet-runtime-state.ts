import type { ChatMessage } from "@openloomi/shared";

export type PetRuntimeState = "idle" | "thinking" | "working" | "juggling";

export interface PetRuntimeSnapshot {
  isSending: boolean;
  activeChatRunning: boolean;
  runningChatCount: number;
  executingToolCount: number;
  hasAssistantOutput: boolean;
}

export interface AssistantActivity {
  executingToolCount: number;
  hasAssistantOutput: boolean;
  hasError: boolean;
}

export interface PetSettleState {
  state: "idle" | "happy" | "presenting" | "needsinput";
  monologue?: string;
  durationMs: number;
}

interface ActivityPart {
  type?: string;
  status?: string;
  toolOutput?: unknown;
  isError?: boolean;
  text?: unknown;
}

export function derivePetRuntimeState(
  snapshot: PetRuntimeSnapshot,
): PetRuntimeState {
  if (snapshot.runningChatCount >= 2 || snapshot.executingToolCount >= 2) {
    return "juggling";
  }

  const isBusy =
    snapshot.isSending ||
    snapshot.activeChatRunning ||
    snapshot.runningChatCount > 0;
  if (!isBusy) return "idle";

  if (
    snapshot.executingToolCount > 0 ||
    snapshot.hasAssistantOutput ||
    (snapshot.runningChatCount > 0 && !snapshot.activeChatRunning)
  ) {
    return "working";
  }

  return "thinking";
}

export function getLatestAssistantActivity(
  messages: ChatMessage[],
): AssistantActivity {
  const latest = [...messages]
    .reverse()
    .find((message) => message.role === "assistant");
  const parts = Array.isArray(latest?.parts) ? latest.parts : [];

  let executingToolCount = 0;
  let hasAssistantOutput = false;
  let hasError = false;

  for (const part of parts as ActivityPart[]) {
    if (part?.type === "tool-native") {
      if (part.status === "executing") executingToolCount += 1;
      if (part.status === "completed" || part.toolOutput) {
        hasAssistantOutput = true;
      }
      if (part.isError || part.status === "error") hasError = true;
      continue;
    }
    if (part?.type === "error") {
      hasError = true;
      continue;
    }
    if (part?.type === "text" && String(part.text || "").trim()) {
      hasAssistantOutput = true;
    }
  }

  return { executingToolCount, hasAssistantOutput, hasError };
}

export function derivePetSettleState(
  activity: Pick<AssistantActivity, "hasAssistantOutput" | "hasError">,
  resultIsVisible: boolean,
): PetSettleState {
  if (activity.hasError) {
    return {
      state: "needsinput",
      monologue: "Something needs your attention",
      durationMs: 8_000,
    };
  }
  if (!activity.hasAssistantOutput) {
    return { state: "idle", durationMs: 0 };
  }
  if (resultIsVisible) {
    return { state: "happy", monologue: "Done", durationMs: 3_000 };
  }
  return {
    state: "presenting",
    monologue: "Your result is ready",
    durationMs: 8_000,
  };
}
