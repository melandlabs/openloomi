import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { OpenLoomiClient } from "../openloomi/client";
import type { OpenLoomiAuthToken } from "../openloomi/token";
import { registerConnectorTools } from "./connectors";
import { registerLoopTools } from "./loop";
import { registerMemoryTools } from "./memory";
import { registerStatusTools } from "./status";

export interface OpenLoomiToolContext {
  client: OpenLoomiClient;
  authToken: OpenLoomiAuthToken;
}

export function registerOpenLoomiTools(
  server: McpServer,
  context: OpenLoomiToolContext,
): void {
  registerStatusTools(server, context);
  registerMemoryTools(server, context);
  registerConnectorTools(server, context);
  registerLoopTools(server, context);
}
