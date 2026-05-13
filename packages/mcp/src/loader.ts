/**
 * MCP Config Loader
 *
 * Loads MCP server configuration from ~/.openloomi/mcp.json
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export interface McpStdioServerConfig {
  type?: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface McpHttpServerConfig {
  type: "http";
  url: string;
  headers?: Record<string, string>;
}

export interface McpSSEServerConfig {
  type: "sse";
  url: string;
  headers?: Record<string, string>;
}

export type McpServerConfig =
  | McpStdioServerConfig
  | McpHttpServerConfig
  | McpSSEServerConfig;

/**
 * Get the MCP config path (default: ~/.openloomi/mcp.json)
 * Override by setting openloomi_MCP_CONFIG_PATH environment variable.
 */
export function getMcpConfigPath(): string {
  if (process.env.openloomi_MCP_CONFIG_PATH) {
    return process.env.openloomi_MCP_CONFIG_PATH;
  }
  return path.join(os.homedir(), ".openloomi", "mcp.json");
}

/**
 * Load MCP servers from a single config file
 */
async function loadMcpServersFromFile(
  configPath: string,
  sourceName: string,
): Promise<Record<string, McpServerConfig>> {
  try {
    await fs.access(configPath);
    const content = await fs.readFile(configPath, "utf-8");
    const config = JSON.parse(content);

    const mcpServers = config.mcpServers || config;

    if (!mcpServers || typeof mcpServers !== "object") {
      return {};
    }

    const servers: Record<string, McpServerConfig> = {};

    for (const [name, serverConfig] of Object.entries(mcpServers)) {
      const cfg = serverConfig as Record<string, unknown>;
      if (cfg.url) {
        const urlType = (cfg.type as string) || "http";
        if (urlType === "sse") {
          servers[name] = {
            type: "sse",
            url: cfg.url as string,
            headers: cfg.headers as Record<string, string>,
          };
          console.log(`[MCP] Loaded SSE server from ${sourceName}: ${name}`);
        } else {
          servers[name] = {
            type: "http",
            url: cfg.url as string,
            headers: cfg.headers as Record<string, string>,
          };
          console.log(`[MCP] Loaded HTTP server from ${sourceName}: ${name}`);
        }
      } else if (cfg.command) {
        servers[name] = {
          type: "stdio",
          command: cfg.command as string,
          args: cfg.args as string[],
          env: cfg.env as Record<string, string>,
        };
        console.log(`[MCP] Loaded stdio server from ${sourceName}: ${name}`);
      }
    }

    return servers;
  } catch {
    return {};
  }
}

/**
 * MCP configuration interface
 */
export interface McpConfig {
  enabled: boolean;
}

/**
 * Load MCP servers configuration from ~/.openloomi/mcp.json
 *
 * @param mcpConfig Optional config to control loading
 * @returns Record of server name to config
 */
export async function loadMcpServers(
  mcpConfig?: McpConfig,
): Promise<Record<string, McpServerConfig>> {
  if (mcpConfig && !mcpConfig.enabled) {
    return {};
  }

  const configPath = getMcpConfigPath();
  const servers = await loadMcpServersFromFile(configPath, "openloomi");
  return servers;
}
