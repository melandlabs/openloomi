---
title: Using Composio with Mastra Framework
impact: HIGH
description: Use Tool Router for native tool integration and MCP for multi-tenant scenarios with Mastra agents
tags: [tool-router, mastra, framework, native-tools, mcp, integration]
---

# Using Composio with Mastra Framework

Composio integrates with Mastra using **Tool Router sessions**. Use **native tools** (recommended) via `session.tools()`, or **MCP tools** when MCP protocol compliance is required.

## Installation

```bash
npm install @mastra/core@latest @ai-sdk/openai @composio/core@latest @composio/mastra@latest

# For MCP (optional)
npm install @mastra/mcp@latest
```

## ✅ Correct - Native Tools (Recommended)

```typescript
import { Agent } from '@mastra/core/agent';
import { openai } from '@ai-sdk/openai';
import { Composio } from '@composio/core';
import { MastraProvider } from '@composio/mastra';

const composio = new Composio({
  apiKey: process.env.COMPOSIO_API_KEY,
  provider: new MastraProvider()
});

async function createAgent(userId: string, message: string) {
  // Create Tool Router session
  const session = await composio.create(userId, {
    toolkits: ['gmail', 'slack'],
    manageConnections: true
  });

  const tools = await session.tools();

  const agent = new Agent({
    id: 'composio-agent',
    name: 'Assistant',
    instructions: `You have access to Gmail and Slack tools to assist the user with their query`,
    model: openai('gpt-5.2'),
    tools: tools
  });

  return await agent.generate([{ role: 'user', content: message }]);
}
```

**Key Points:**
- Create new sessions per request/conversation
- Use `session.tools()` for native Mastra tools
- Import `Composio` from `@composio/core` and `MastraProvider` from `@composio/mastra`
- Use `openai('gpt-5.2')` from `@ai-sdk/openai`

## ✅ Correct - MCP Tools

When MCP protocol compliance is required, expose Tool Router sessions as MCP servers:

```typescript
import { Agent } from '@mastra/core/agent';
import { openai } from '@ai-sdk/openai';
import { MCPClient } from '@mastra/mcp';
import { Composio } from '@composio/core';
import { MastraProvider } from '@composio/mastra';

const composio = new Composio({
  apiKey: process.env.COMPOSIO_API_KEY,
  provider: new MastraProvider()
});

async function createAgentWithMcp(userId: string, message: string) {
  // 1. Create Tool Router session
  const session = await composio.create(userId, {
    toolkits: ['gmail', 'slack'],
    manageConnections: true
  });

  // 2. Create MCP client with session URL and headers
  const mcpClient = new MCPClient({
    id: `composio-${session.sessionId}`,
    servers: {
      composio: {
        url: session.mcp.url,
        requestInit: {
          headers: session.mcp.headers
        }
      }
    }
  });

  // 3. Get tools via MCPClient
  const tools = await mcpClient.listTools();

  const agent = new Agent({
    id: 'mcp-agent',
    name: 'MCP Assistant',
    instructions: 'You have access to Composio tools via MCP.',
    model: openai('gpt-5.2'),
    tools: tools
  });

  return await agent.generate([{ role: 'user', content: message }]);
}
```

**For dynamic toolsets (multi-tenant):**
```typescript
// Create agent without tools in constructor
const agent = new Agent({
  id: 'dynamic-agent',
  model: openai('gpt-5.2'),
  instructions: 'You help users with tasks.'
});

// Pass toolsets per request
const toolsets = await mcpClient.listToolsets();
const response = await agent.generate(message, { toolsets });
```

## ❌ Incorrect Patterns

```typescript
// ❌ Don't bypass Tool Router sessions
const mcpClient = new MCPClient({
  servers: { composio: { url: 'https://mcp.composio.dev' } }
});

// ❌ Don't use non-existent methods
const tools = await session.mcpTools(); // Doesn't exist
const url = session.getMcpServerUrl(); // Doesn't exist

// ❌ Don't cache tools across users
const cachedTools = await session.tools();
// Reusing for different users...

// ❌ Don't forget MastraProvider
const composio = new Composio({ apiKey: key }); // Missing provider

// ❌ Don't use string format for model
model: 'openai/gpt-5.2' // Wrong - use openai('gpt-5.2')
```

## Key Principles

**Native Tools:**
- Use `session.tools()` - best performance, type-safe
- Recommended for most use cases

**MCP Tools:**
- Use `session.mcp.url` + `MCPClient` + `listTools()`/`listToolsets()`
- Only when MCP protocol compliance is required
- Still uses Tool Router sessions

**Session Management:**
- Always create sessions via `composio.create()`
- Create new sessions per request/conversation
- Don't cache tools or sessions across users
- Use `manageConnections: true`

**Setup:**
- Import `Composio` from `@composio/core`
- Import `MastraProvider` from `@composio/mastra`
- Use `openai('gpt-5.2')` from `@ai-sdk/openai`
- Mention tools in agent instructions

## When to Use

| Use Case | Approach | Method |
|----------|----------|--------|
| Most scenarios | Native Tools | `session.tools()` |
| MCP protocol required | MCP Tools | MCP client + `listTools()` |
| Multi-tenant dynamic auth | MCP Tools | MCP client + `listToolsets()` |

## Reference

- [Mastra Agents](https://mastra.ai/docs/agents/overview)
- [Mastra MCP](https://mastra.ai/docs/mcp/overview)
- [Composio Tool Router](https://docs.composio.dev/sdk/typescript/api/tool-router)
- [Tool Router Sessions](tr-session-lifecycle.md)
