import type { AgentOptions } from "@openloomi/ai/agent/types";

const MAX_CONVERSATION_MESSAGES = 50;
const MAX_CONVERSATION_CHARS = 100_000;

/**
 * CLI runtimes do not automatically receive OpenLoomi's chat transcript.
 * Materialize a bounded transcript into the prompt until the runtime has a
 * durable provider-native session mapping.
 */
export function addConversationContext(
  prompt: string,
  options?: AgentOptions,
): string {
  const conversation = options?.conversation;
  if (!conversation?.length) return prompt;

  const messages = conversation.slice(-MAX_CONVERSATION_MESSAGES);
  if (
    messages.at(-1)?.role === "user" &&
    messages.at(-1)?.content.trim() === prompt.trim()
  ) {
    messages.pop();
  }
  if (messages.length === 0) return prompt;

  let remaining = MAX_CONVERSATION_CHARS;
  const history: string[] = [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || remaining <= 0) break;
    const content = message.content.slice(-remaining);
    remaining -= content.length;
    history.unshift(`[${message.role}]\n${content}`);
  }

  return `<openloomi_conversation_history>\n${history.join(
    "\n\n",
  )}\n</openloomi_conversation_history>\n\n[current_user_request]\n${prompt}`;
}
