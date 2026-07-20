import type { HookCallback, Options } from "@anthropic-ai/claude-agent-sdk";
import type {
  AgentSupplementalInput,
  AgentSupplementalInputSource,
} from "@openloomi/ai/agent/types";

import type { ClaudeRuntimeLogger } from "../skills";

/**
 * Adds non-urgent input once after all tools in the current batch complete.
 * PostToolBatch is intentionally used instead of concurrent per-tool hooks.
 */
export function createClaudeSupplementalInputHooks({
  supplementalInput,
  sessionId,
  logger,
}: {
  supplementalInput?: AgentSupplementalInputSource;
  sessionId: string;
  logger: ClaudeRuntimeLogger;
}): Options["hooks"] | undefined {
  if (!supplementalInput?.takePendingInform) return undefined;

  const postToolBatch: HookCallback = async () => {
    try {
      const inputs = supplementalInput.takePendingInform?.() ?? [];
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

  return { PostToolBatch: [{ hooks: [postToolBatch] }] };
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
