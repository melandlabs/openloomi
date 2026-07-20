import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type {
  AgentSupplementalInput,
  AgentSupplementalInputSource,
} from "@openloomi/ai/agent/types";

/**
 * Converts the initial request and the live OpenLoomi input channel into the
 * single ordered stream expected by the Claude Agent SDK.
 */
export class ClaudeInputMultiplexer {
  constructor(
    private readonly initialPrompt: string | AsyncIterable<SDKUserMessage>,
    private readonly sessionId: string,
    private readonly supplementalInput: AgentSupplementalInputSource,
  ) {}

  toSdkPrompt(): AsyncIterable<SDKUserMessage> {
    return this.stream();
  }

  private async *stream(): AsyncGenerator<SDKUserMessage> {
    if (typeof this.initialPrompt === "string") {
      yield toClaudeUserMessage(this.initialPrompt, this.sessionId);
    } else {
      yield* this.initialPrompt;
    }

    for await (const input of this.supplementalInput) {
      yield toClaudeSupplementalMessage(input, this.sessionId);
    }
  }
}

function toClaudeSupplementalMessage(
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
