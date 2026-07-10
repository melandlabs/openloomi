"use client";

import { useEffect, useMemo, useRef } from "react";

import { useChatContext } from "@/components/chat-context";
import { isTauri } from "@/lib/tauri";
import {
  derivePetSettleState,
  derivePetRuntimeState,
  getLatestAssistantActivity,
  type PetRuntimeState,
} from "./pet-runtime-state";

type RuntimePayloadState =
  | PetRuntimeState
  | "happy"
  | "presenting"
  | "needsinput";

async function emitRuntimeState(
  state: RuntimePayloadState,
  monologue?: string,
) {
  if (!isTauri()) return;
  const { emit } = await import("@tauri-apps/api/event");
  await emit("pet:runtime-state", { state, monologue });
}

export function PetRuntimeBridge() {
  const { messages, isSending, isAgentRunning, getChatSessionStates } =
    useChatContext();
  const previousBusyRef = useRef(false);
  const lastEmittedKeyRef = useRef<string | null>(null);
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activity = useMemo(
    () => getLatestAssistantActivity(messages),
    [messages],
  );
  const runningChatCount = Array.from(getChatSessionStates().values()).filter(
    (session) => session.isAgentRunning,
  ).length;
  const runtimeState = derivePetRuntimeState({
    isSending,
    activeChatRunning: isAgentRunning,
    runningChatCount,
    executingToolCount: activity.executingToolCount,
    hasAssistantOutput: activity.hasAssistantOutput,
  });

  useEffect(() => {
    const clearSettleTimer = () => {
      if (!settleTimerRef.current) return;
      clearTimeout(settleTimerRef.current);
      settleTimerRef.current = null;
    };
    const emitOnce = (state: RuntimePayloadState, monologue?: string) => {
      const key = `${state}\u0000${monologue ?? ""}`;
      if (lastEmittedKeyRef.current === key) return;
      lastEmittedKeyRef.current = key;
      void emitRuntimeState(state, monologue).catch((error) => {
        console.warn("[PetRuntimeBridge] state emit failed", error);
      });
    };

    clearSettleTimer();
    if (runtimeState !== "idle") {
      previousBusyRef.current = true;
      const monologue =
        runtimeState === "juggling"
          ? `${Math.max(runningChatCount, activity.executingToolCount)} tasks in progress`
          : undefined;
      emitOnce(runtimeState, monologue);
      return clearSettleTimer;
    }

    if (!previousBusyRef.current) {
      emitOnce("idle");
      return clearSettleTimer;
    }
    previousBusyRef.current = false;

    const resultIsVisible =
      document.visibilityState === "visible" && document.hasFocus();
    const settle = derivePetSettleState(activity, resultIsVisible);
    emitOnce(settle.state, settle.monologue);
    if (settle.durationMs > 0) {
      settleTimerRef.current = setTimeout(
        () => emitOnce("idle"),
        settle.durationMs,
      );
    }

    return clearSettleTimer;
  }, [
    activity.executingToolCount,
    activity.hasAssistantOutput,
    activity.hasError,
    runningChatCount,
    runtimeState,
  ]);

  useEffect(
    () => () => {
      if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
      void emitRuntimeState("idle").catch((error) => {
        console.warn("[PetRuntimeBridge] cleanup emit failed", error);
      });
    },
    [],
  );

  return null;
}
