import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { OpenLoomiClient } from "../openloomi/client";

export interface OpenLoomiToolContext {
  client: OpenLoomiClient;
}

export function registerOpenLoomiTools(
  _server: McpServer,
  _context: OpenLoomiToolContext,
): void {
  // Phase 1 only wires the publishable MCP server shell.
  // Concrete setup/status and capability tools are registered in later phases.
}
