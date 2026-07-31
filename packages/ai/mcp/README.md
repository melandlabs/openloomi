# @openloomi/mcp

Stdio MCP server for using local OpenLoomi Desktop from MCP-capable agent
runtimes.

## Local Build

Build the MCP server from the OpenLoomi repository:

```bash
pnpm --filter @openloomi/mcp build
```

Then point the runtime at the built stdio entrypoint:

```json
{
  "mcpServers": {
    "openloomi-local": {
      "command": "node",
      "args": ["/path/to/openloomi/packages/ai/mcp/dist/cli.js"]
    }
  }
}
```

CLI clients can add the local server with:

```bash
codex mcp add openloomi-local -- node "/path/to/openloomi/packages/ai/mcp/dist/cli.js"
claude mcp add --transport stdio --scope user openloomi-local -- node "/path/to/openloomi/packages/ai/mcp/dist/cli.js"
```

On Windows, use an escaped path in JSON, such as
`C:\\path\\to\\openloomi\\packages\\ai\\mcp\\dist\\cli.js`.

## User Flow

1. Add the MCP server config in the agent runtime.
2. Reload or restart the runtime's MCP servers.
3. Run `openloomi_setup` or `openloomi_status` first.
4. Follow the returned setup guidance if OpenLoomi Desktop is not ready.
5. Use OpenLoomi memory, RAG, knowledge base, connector, and Loop tools.

## Tools

- `openloomi_setup`, `openloomi_status`
- `openloomi_memory_search`
- `openloomi_rag_search`
- `openloomi_kb_list_documents`, `openloomi_kb_get_document`,
  `openloomi_kb_stats`
- `openloomi_connectors_list_accounts`, `openloomi_connectors_status`
- `openloomi_loop_state`, `openloomi_loop_list_decisions`
