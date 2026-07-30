# @openloomi/mcp

Stdio MCP server for using local OpenLoomi Desktop from MCP-capable agent
runtimes.

## Requirements

- OpenLoomi Desktop is installed, running, and initialized.
- Node.js/npm is available to the agent runtime.

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

1. Start OpenLoomi Desktop and complete first-use setup.
2. Add the MCP server config in the agent runtime.
3. Reload or restart the runtime's MCP servers.
4. Run `openloomi_setup` or `openloomi_status` first.
5. Use OpenLoomi memory, RAG, knowledge base, connector, and Loop tools.

## Tools

- `openloomi_setup`, `openloomi_status`
- `openloomi_memory_search`
- `openloomi_rag_search`
- `openloomi_kb_list_documents`, `openloomi_kb_get_document`,
  `openloomi_kb_stats`
- `openloomi_connectors_list_accounts`, `openloomi_connectors_status`
- `openloomi_loop_state`, `openloomi_loop_list_decisions`
