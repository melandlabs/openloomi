import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { AgentMessage } from "@openloomi/ai/agent/types";

import { convertClaudeSdkMessage } from "../message-converter";

/** Maintains the per-session state required to map Claude SDK output once. */
export class ClaudeOutputMultiplexer {
  private readonly sentTextHashes = new Set<string>();
  private readonly sentToolIds = new Set<string>();
  private hasStreamedText = false;

  constructor(private readonly createMessageId: () => string) {}

  *convert(message: SDKMessage): Generator<AgentMessage> {
    let emittedStreamedText = false;
    for (const converted of convertClaudeSdkMessage({
      message,
      sentTextHashes: this.sentTextHashes,
      sentToolIds: this.sentToolIds,
      hasStreamedText: this.hasStreamedText,
      createMessageId: this.createMessageId,
    })) {
      if (message.type === "stream_event" && converted.type === "text") {
        emittedStreamedText = true;
      }
      yield converted;
    }

    if (emittedStreamedText) {
      this.hasStreamedText = true;
    } else if (message.type === "assistant") {
      this.hasStreamedText = false;
    }
  }
}
