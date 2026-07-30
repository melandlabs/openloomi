import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import {
  OpenLoomiClient,
  type OpenLoomiClientOptions,
} from "./openloomi/client";
import {
  readOpenLoomiAuthToken,
  type OpenLoomiAuthToken,
} from "./openloomi/token";
import { registerOpenLoomiTools } from "./tools";

const DEFAULT_SERVER_NAME = "@openloomi/mcp";
const DEFAULT_SERVER_VERSION = "0.8.8";

export interface CreateOpenLoomiMcpServerOptions extends OpenLoomiClientOptions {
  name?: string;
  version?: string;
}

export async function createOpenLoomiMcpServer(
  options: CreateOpenLoomiMcpServerOptions = {},
): Promise<McpServer> {
  const tokenResult = options.token
    ? ({ token: options.token, source: "env" } satisfies OpenLoomiAuthToken)
    : await readOpenLoomiAuthToken();
  const client = new OpenLoomiClient({
    ...options,
    token: tokenResult.token ?? undefined,
  });
  const server = new McpServer({
    name: options.name ?? DEFAULT_SERVER_NAME,
    version: options.version ?? DEFAULT_SERVER_VERSION,
  });

  registerOpenLoomiTools(server, { client, authToken: tokenResult });

  return server;
}

export async function runOpenLoomiMcpStdioServer(
  options: CreateOpenLoomiMcpServerOptions = {},
): Promise<McpServer> {
  const server = await createOpenLoomiMcpServer(options);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  return server;
}
