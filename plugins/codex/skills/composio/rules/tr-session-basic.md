---
title: Create Basic Tool Router Sessions
impact: HIGH
description: Essential pattern for initializing Tool Router sessions with proper user isolation
tags: [tool-router, session, initialization, agents]
---

# Create Basic Tool Router Sessions

Always create isolated Tool Router sessions per user to ensure proper data isolation and scoped tool access.

> 📖 **Before you begin:** Make sure you have set up your API keys. See [Setting Up API Keys](./setup-api-keys.md) for instructions.

> **⚠️ IMPORTANT:** Do NOT make up or guess toolkit names. Always verify toolkit slugs before using them:
> - Use `composio manage toolkits list` to discover and `composio manage toolkits info "..."` to view toolkit details (CLI)
> - Use `composio.toolkits.get()` to discover toolkits programmatically (SDK)
>
> See [Composio CLI Reference](./composio-cli.md) for discovery commands.

## ❌ Incorrect

```typescript
// DON'T: Using shared session for multiple users
const sharedSession = await composio.create('default', {
  toolkits: ['gmail']
});
// All users share the same session - security risk!
```

```python
# DON'T: Using shared session for multiple users
shared_session = composio.create(
    user_id="default",
    toolkits=["gmail"]
)
# All users share the same session - security risk!
```

## ✅ Correct

```typescript
// DO: Create per-user sessions for isolation
import { Composio } from '@composio/core';

const composio = new Composio();

// Each user gets their own isolated session
const session = await composio.create('user_123', {
  toolkits: ['gmail', 'slack']
});

console.log('Session ID:', session.sessionId);
console.log('MCP URL:', session.mcp.url);
```

```python
# DO: Create per-user sessions for isolation
from composio import Composio

composio = Composio()

# Each user gets their own isolated session
session = composio.create(
    user_id="user_123",
    toolkits=["gmail", "slack"]
)

print(f"Session ID: {session.session_id}")
print(f"MCP URL: {session.mcp.url}")
```

## Key Points

- **User Isolation**: Each user must have their own session
- **Toolkit Scoping**: Specify which toolkits the session can access
- **Session ID**: Store the session ID to retrieve it later
- **MCP URL**: Use this URL with any MCP-compatible AI framework

## Reference

- [Tool Router API Docs](https://docs.composio.dev/sdk/typescript/api/tool-router)
- [Creating Sessions](https://docs.composio.dev/sdk/typescript/api/tool-router#creating-sessions)
