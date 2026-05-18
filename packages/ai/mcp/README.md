# @openloomi/mcp

Model Context Protocol (MCP) server configuration types and loader.

## Installation

```sh
pnpm add @openloomi/mcp
```

## Usage

```ts
import { loadMcpServers, getMcpConfigPath } from "@openloomi/mcp";

// Load MCP servers from ~/.openloomi/mcp.json
const servers = await loadMcpServers();
```

## Configuration

By default, reads from `~/.openloomi/mcp.json`. Override with `OPENLOOMI_MCP_CONFIG_PATH` environment variable.
