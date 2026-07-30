# @openloomi/mcp

Stdio MCP server for using local OpenLoomi Desktop from MCP-capable agent
runtimes.

## MCP Configuration

After `@openloomi/mcp` is published, add this server to WorkBuddy or any other
MCP-capable runtime:

```json
{
  "mcpServers": {
    "openloomi": {
      "command": "npx",
      "args": ["-y", "@openloomi/mcp"]
    }
  }
}
```

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
