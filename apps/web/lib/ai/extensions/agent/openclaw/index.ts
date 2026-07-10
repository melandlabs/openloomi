import { defineAgentPlugin } from "@openloomi/ai/agent";
import type { AgentPlugin } from "@openloomi/ai/agent/plugin";
import type { AgentConfig } from "@openloomi/ai/agent/types";

import { AcpAgent, type AcpRuntimeDefinition } from "../acp/agent";
import {
  buildOpenClawAcpCommand,
  normalizeOpenClawProviderConfig,
} from "./command";
import { OPENCLAW_METADATA } from "./metadata";

const OPENCLAW_ACP_RUNTIME: AcpRuntimeDefinition = {
  provider: "openclaw",
  displayName: "OpenClaw",
  buildCommand: buildOpenClawAcpCommand,
  normalizeProviderConfig: normalizeOpenClawProviderConfig,
};

export class OpenClawAgent extends AcpAgent {
  constructor(config: AgentConfig) {
    super(config, OPENCLAW_ACP_RUNTIME);
  }
}

export function createOpenClawAgent(config: AgentConfig): OpenClawAgent {
  return new OpenClawAgent(config);
}

export const openclawPlugin: AgentPlugin = defineAgentPlugin({
  metadata: OPENCLAW_METADATA,
  factory: createOpenClawAgent,
});
