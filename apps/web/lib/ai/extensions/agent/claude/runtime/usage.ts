import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { RuntimeUsageDelta } from "@/lib/ai/runtime-instructions/runtime-observation";

interface ClaudeResultUsage {
  input_tokens: unknown;
  output_tokens: unknown;
  cache_creation_input_tokens: unknown;
  cache_read_input_tokens: unknown;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

/** Normalizes Claude's finalized result roll-up into a Goal Run delta. */
export function extractClaudeResultUsage(
  message: SDKMessage,
): RuntimeUsageDelta | undefined {
  if (message.type !== "result") return undefined;
  if (message.usage === null || typeof message.usage !== "object") {
    return undefined;
  }

  const usage = message.usage as ClaudeResultUsage;
  const inputTokens = usage.input_tokens;
  const outputTokens = usage.output_tokens;
  const cacheCreationTokens = usage.cache_creation_input_tokens;
  const cacheReadTokens = usage.cache_read_input_tokens;
  const turnsUsed = message.num_turns;
  if (
    !isNonNegativeSafeInteger(inputTokens) ||
    !isNonNegativeSafeInteger(outputTokens) ||
    !isNonNegativeSafeInteger(cacheCreationTokens) ||
    !isNonNegativeSafeInteger(cacheReadTokens) ||
    !isNonNegativeSafeInteger(turnsUsed)
  ) {
    return undefined;
  }

  const tokensUsed =
    inputTokens + outputTokens + cacheCreationTokens + cacheReadTokens;
  if (!Number.isSafeInteger(tokensUsed)) return undefined;

  return { tokensUsed, turnsUsed };
}
