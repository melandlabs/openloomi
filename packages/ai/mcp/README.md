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

Optional API override:

```json
{
  "env": {
    "OPENLOOMI_API_URL": "http://127.0.0.1:3414"
  }
}
```

Normally no auth environment variable is required. The MCP server uses the token
created by OpenLoomi Desktop. `OPENLOOMI_AUTH_TOKEN` is only for nonstandard
setups.

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

`openloomi_connectors_status` performs a live OpenLoomi connector check. If the
native check cannot complete, the tool returns the real failure or timeout
instead of cached status.

## WorkBuddy Test Flow

1. Open WorkBuddy MCP settings.
2. Add a server named `openloomi` with command `npx` and args `-y`,
   `@openloomi/mcp`.
3. Save the config and reload WorkBuddy MCP servers.
4. In WorkBuddy chat, ask it to run OpenLoomi setup/status.
5. Verify memory search, connected accounts, and pending Loop decisions return
   structured results.
6. Optionally run connector status and confirm it returns either live health or
   an explicit OpenLoomi error/timeout.

## Distribution Note

`npx skills add <github path>` works for skills because the skills CLI downloads
and installs skill folders. MCP runtimes need an executable stdio server, so the
supported distribution path is the published npm package:
`npx -y @openloomi/mcp`.
