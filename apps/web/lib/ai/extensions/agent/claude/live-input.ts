import type {
  HookCallback,
  Options,
  Query,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type {
  AgentSupplementalInput,
  AgentSupplementalInputSource,
} from "@openloomi/ai/agent/types";

import type { ClaudeRuntimeLogger } from "./skills";

export type ClaudeQueryFactory = (input: {
  prompt: string | AsyncIterable<SDKUserMessage>;
  options?: Options;
}) => Query;

export interface ClaudeLiveQuery {
  readonly query: Query;
  /** Releases non-urgent inputs after Claude finishes a natural turn. */
  releaseBoundary(): number;
  /** Detaches provider controls and terminates the supplemental input stream. */
  dispose(): void;
}

/**
 * Starts a Claude query with a persistent input stream when supplemental input
 * is available. Without a source, the original prompt is passed through
 * unchanged so existing one-shot Claude runs retain their current lifecycle.
 */
export function startClaudeLiveQuery({
  queryFactory,
  initialPrompt,
  options,
  supplementalInput,
  sessionId,
  logger,
}: {
  queryFactory: ClaudeQueryFactory;
  initialPrompt: string | AsyncIterable<SDKUserMessage>;
  options?: Options;
  supplementalInput?: AgentSupplementalInputSource;
  sessionId: string;
  logger: ClaudeRuntimeLogger;
}): ClaudeLiveQuery {
  const prompt = supplementalInput
    ? createClaudeStreamingPrompt({
        initialPrompt,
        supplementalInput,
        sessionId,
      })
    : initialPrompt;

  let activeQuery: Query;
  try {
    activeQuery = queryFactory({ prompt, options });
  } catch (error) {
    safeCloseSupplementalInput(supplementalInput, sessionId, logger);
    throw error;
  }

  if (supplementalInput?.setInterruptHandler) {
    try {
      supplementalInput.setInterruptHandler(() => activeQuery.interrupt());
    } catch (error) {
      logger.warn(
        `[Claude ${sessionId}] Failed to attach the live-input interrupt handler`,
        error,
      );
    }
  }

  let disposed = false;
  return {
    query: activeQuery,
    releaseBoundary: () =>
      safeReleasePendingInform(supplementalInput, sessionId, logger),
    dispose: () => {
      if (disposed) return;
      disposed = true;

      if (supplementalInput?.setInterruptHandler) {
        try {
          supplementalInput.setInterruptHandler(null);
        } catch (error) {
          logger.warn(
            `[Claude ${sessionId}] Failed to detach the live-input interrupt handler`,
            error,
          );
        }
      }

      if (supplementalInput) {
        try {
          activeQuery.close();
        } catch (error) {
          logger.warn(
            `[Claude ${sessionId}] Failed to close the live Claude query`,
            error,
          );
        }
      }
      safeCloseSupplementalInput(supplementalInput, sessionId, logger);
    },
  };
}

/**
 * Installs a single batch-level hook so an `inform` input becomes additional
 * context exactly once after all tools in the current batch have completed.
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
      // A supplemental source must not hide or replace the actual tool result.
      logger.warn(
        `[Claude ${sessionId}] Failed to consume supplemental input at a tool boundary`,
        error,
      );
      return {};
    }
  };

  return {
    PostToolBatch: [{ hooks: [postToolBatch] }],
  };
}

/**
 * Combines the finite initial prompt with a live OpenLoomi input source. The
 * initial prompt always wins FIFO order, including media prompts represented
 * by more than one SDK message.
 */
export async function* createClaudeStreamingPrompt({
  initialPrompt,
  supplementalInput,
  sessionId,
}: {
  initialPrompt: string | AsyncIterable<SDKUserMessage>;
  supplementalInput: AgentSupplementalInputSource;
  sessionId: string;
}): AsyncGenerator<SDKUserMessage> {
  if (typeof initialPrompt === "string") {
    yield toClaudeUserMessage(initialPrompt, sessionId);
  } else {
    yield* initialPrompt;
  }

  for await (const input of supplementalInput) {
    yield toClaudeSupplementalMessage(input, sessionId);
  }
}

export function toClaudeSupplementalMessage(
  input: AgentSupplementalInput,
  sessionId: string,
): SDKUserMessage {
  return {
    ...toClaudeUserMessage(input.content, sessionId),
    priority: input.intent === "inform" ? "next" : "now",
    shouldQuery: true,
    timestamp: input.createdAt,
  };
}

function toClaudeUserMessage(
  content: string,
  sessionId: string,
): SDKUserMessage {
  return {
    type: "user",
    message: { role: "user", content },
    parent_tool_use_id: null,
    session_id: sessionId,
  };
}

function formatSupplementalInputContext(
  inputs: AgentSupplementalInput[],
): string {
  const blocks = inputs.map((input, index) =>
    [
      `OpenLoomi supplemental input ${index + 1}:`,
      `Metadata: ${JSON.stringify({ id: input.id, createdAt: input.createdAt })}`,
      input.content,
    ].join("\n"),
  );

  return [
    "OpenLoomi received the following non-urgent inputs while tools were running. Apply them before choosing the next action.",
    ...blocks,
  ].join("\n\n");
}

function safeReleasePendingInform(
  supplementalInput: AgentSupplementalInputSource | undefined,
  sessionId: string,
  logger: ClaudeRuntimeLogger,
): number {
  try {
    return supplementalInput?.releasePendingInform?.() ?? 0;
  } catch (error) {
    logger.warn(
      `[Claude ${sessionId}] Failed to release supplemental input at a turn boundary`,
      error,
    );
    return 0;
  }
}

function safeCloseSupplementalInput(
  supplementalInput: AgentSupplementalInputSource | undefined,
  sessionId: string,
  logger: ClaudeRuntimeLogger,
): void {
  try {
    supplementalInput?.close?.();
  } catch (error) {
    logger.warn(
      `[Claude ${sessionId}] Failed to close the supplemental input stream`,
      error,
    );
  }
}
