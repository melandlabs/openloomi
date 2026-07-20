import {
  query,
  type Options,
  type Query,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";

export interface ClaudeSdkQueryInput {
  prompt: string | AsyncIterable<SDKUserMessage>;
  options?: Options;
}

/** Injectable boundary used by ClaudeRuntimeSession and its fake SDK tests. */
export interface ClaudeSdkTransport {
  startQuery(input: ClaudeSdkQueryInput): Query;
}

export const claudeAgentSdkTransport: ClaudeSdkTransport = {
  startQuery: (input) => query(input),
};
