import type { HookCallback, Options } from "@anthropic-ai/claude-agent-sdk";
import type {
  AgentSupplementalInput,
  AgentSupplementalInputSource,
} from "@openloomi/ai/agent/types";

import type { ClaudeRuntimeLogger } from "../skills";
import type {
  ClaudeRuntimeToolOutcome,
  ClaudeRuntimeToolStart,
} from "./event-observer";

export interface ClaudeRuntimeToolHookObserver {
  captureToolStart(
    input: Omit<ClaudeRuntimeToolStart, "runEpoch">,
  ): Promise<void>;
  observeToolOutcome(
    input: Omit<ClaudeRuntimeToolOutcome, "runEpoch">,
  ): Promise<void>;
}

/** Adds PostToolBatch input delivery plus per-tool evidence observation. */
export function createClaudeSupplementalInputHooks({
  supplementalInput,
  toolObserver,
  sessionId,
  logger,
}: {
  supplementalInput?: AgentSupplementalInputSource;
  toolObserver?: ClaudeRuntimeToolHookObserver;
  sessionId: string;
  logger: ClaudeRuntimeLogger;
}): Options["hooks"] | undefined {
  if (!supplementalInput?.takePendingInform && !toolObserver) return undefined;

  const hooks: NonNullable<Options["hooks"]> = {};

  const postToolBatch: HookCallback = async () => {
    try {
      const inputs = supplementalInput?.takePendingInform?.() ?? [];
      if (inputs.length === 0) return {};
      return {
        hookSpecificOutput: {
          hookEventName: "PostToolBatch",
          additionalContext: formatSupplementalInputContext(inputs),
        },
      };
    } catch (error) {
      logger.warn(
        `[Claude ${sessionId}] Failed to consume supplemental input at a tool boundary`,
        error,
      );
      return {};
    }
  };

  if (supplementalInput?.takePendingInform) {
    hooks.PostToolBatch = [{ hooks: [postToolBatch] }];
  }

  if (toolObserver) {
    const preToolUse: HookCallback = async (input, toolUseId) => {
      if (input.hook_event_name !== "PreToolUse") return {};
      try {
        await toolObserver.captureToolStart({
          toolUseId: input.tool_use_id ?? toolUseId ?? "",
          toolName: input.tool_name,
          providerSessionId: input.session_id,
        });
      } catch (error) {
        logger.warn(
          `[Claude ${sessionId}] Failed to capture Goal context for tool ${input.tool_name}`,
          error,
        );
      }
      return {};
    };
    const postToolUse: HookCallback = async (input, toolUseId) => {
      if (input.hook_event_name !== "PostToolUse") return {};
      await observeToolHookSafely({
        observer: toolObserver,
        logger,
        sessionId,
        outcome: {
          toolUseId: input.tool_use_id ?? toolUseId ?? "",
          toolName: input.tool_name,
          outcome: "succeeded",
          toolInput: input.tool_input,
          toolResponse: input.tool_response,
          providerSessionId: input.session_id,
          ...(input.duration_ms === undefined
            ? {}
            : { durationMs: input.duration_ms }),
        },
      });
      return {};
    };
    const postToolUseFailure: HookCallback = async (input, toolUseId) => {
      if (input.hook_event_name !== "PostToolUseFailure") return {};
      await observeToolHookSafely({
        observer: toolObserver,
        logger,
        sessionId,
        outcome: {
          toolUseId: input.tool_use_id ?? toolUseId ?? "",
          toolName: input.tool_name,
          outcome: "failed",
          toolInput: input.tool_input,
          error: input.error,
          providerSessionId: input.session_id,
          ...(input.duration_ms === undefined
            ? {}
            : { durationMs: input.duration_ms }),
        },
      });
      return {};
    };
    const permissionDenied: HookCallback = async (input, toolUseId) => {
      if (input.hook_event_name !== "PermissionDenied") return {};
      const resolvedToolUseId = input.tool_use_id ?? toolUseId ?? "";
      try {
        await toolObserver.captureToolStart({
          toolUseId: resolvedToolUseId,
          toolName: input.tool_name,
          providerSessionId: input.session_id,
        });
      } catch (error) {
        logger.warn(
          `[Claude ${sessionId}] Failed to capture Goal context for denied tool ${input.tool_name}`,
          error,
        );
      }
      await observeToolHookSafely({
        observer: toolObserver,
        logger,
        sessionId,
        outcome: {
          toolUseId: resolvedToolUseId,
          toolName: input.tool_name,
          outcome: "failed",
          toolInput: input.tool_input,
          error: input.reason,
          providerSessionId: input.session_id,
        },
      });
      return {};
    };
    hooks.PreToolUse = [{ hooks: [preToolUse] }];
    hooks.PostToolUse = [{ hooks: [postToolUse] }];
    hooks.PostToolUseFailure = [{ hooks: [postToolUseFailure] }];
    hooks.PermissionDenied = [{ hooks: [permissionDenied] }];
  }

  return hooks;
}

async function observeToolHookSafely({
  observer,
  logger,
  sessionId,
  outcome,
}: {
  observer: ClaudeRuntimeToolHookObserver;
  logger: ClaudeRuntimeLogger;
  sessionId: string;
  outcome: Omit<ClaudeRuntimeToolOutcome, "runEpoch">;
}): Promise<void> {
  try {
    await observer.observeToolOutcome(outcome);
  } catch (error) {
    logger.warn(
      `[Claude ${sessionId}] Failed to record Goal evidence for tool ${outcome.toolName}`,
      error,
    );
  }
}

function formatSupplementalInputContext(
  inputs: AgentSupplementalInput[],
): string {
  const blocks = inputs.map((input, index) =>
    [
      `OpenLoomi supplemental input ${index + 1}:`,
      `Metadata: ${JSON.stringify({
        id: input.id,
        createdAt: input.createdAt,
        runEpoch: input.runEpoch,
      })}`,
      input.content,
    ].join("\n"),
  );
  return [
    "OpenLoomi received the following non-urgent inputs while tools were running. Apply them before choosing the next action.",
    ...blocks,
  ].join("\n\n");
}
