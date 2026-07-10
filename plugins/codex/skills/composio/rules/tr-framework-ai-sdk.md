---
title: Using Composio with Vercel AI SDK
impact: HIGH
description: Use Tool Router for native tool integration and MCP for protocol-compliant scenarios with Vercel AI SDK
tags: [tool-router, ai-sdk, vercel, framework, native-tools, mcp, integration]
---

# Using Composio with Vercel AI SDK

Composio integrates with Vercel AI SDK using **Tool Router sessions**. Use **native tools** (recommended) via `session.tools()` with `VercelProvider`, or **MCP tools** when MCP protocol compliance is required.

## Installation

```bash
npm install @composio/core @composio/vercel ai @ai-sdk/openai

# For MCP (optional)
npm install @ai-sdk/mcp
```

## ✅ Correct - Native Tools (Recommended)

```typescript
import { openai } from '@ai-sdk/openai';
import { generateText, streamText } from 'ai';
import { Composio } from '@composio/core';
import { VercelProvider } from '@composio/vercel';

const composio = new Composio({
  apiKey: process.env.COMPOSIO_API_KEY,
  provider: new VercelProvider()
});

async function runAgent(userId: string, prompt: string) {
  // Create Tool Router session
  const session = await composio.create(userId, {
    toolkits: ['gmail', 'slack'],
    manageConnections: true
  });

  const tools = await session.tools();

  // Use with generateText or streamText
  const result = await generateText({
    model: openai('gpt-5.2'),
    tools: tools,
    maxSteps: 5,
    prompt: prompt
  });

  return result.text;
}
```

**For streaming:**
```typescript
const stream = await streamText({
  model: openai('gpt-5.2'),
  tools: await session.tools(),
  maxSteps: 5,
  prompt: prompt
});

return stream.toDataStreamResponse();
```

**Key Points:**
- Create new sessions per request/conversation
- Use `session.tools()` with `VercelProvider`
- Always set `maxSteps` for multi-step tool calling
- Works with `generateText` and `streamText`

## ✅ Correct - MCP Tools

Use `createMCPClient` with Tool Router sessions for MCP protocol compliance:

```typescript
import { openai } from '@ai-sdk/openai';
import { generateText } from 'ai';
import { createMCPClient } from '@ai-sdk/mcp';
import { Composio } from '@composio/core';
import { VercelProvider } from '@composio/vercel';

const composio = new Composio({
  apiKey: process.env.COMPOSIO_API_KEY,
  provider: new VercelProvider()
});

async function runAgentWithMcp(userId: string, prompt: string) {
  // 1. Create Tool Router session
  const session = await composio.create(userId, {
    toolkits: ['gmail', 'slack'],
    manageConnections: true
  });

  // 2. Create MCP client with HTTP transport
  const client = await createMCPClient({
    transport: {
      type: 'http',
      url: session.mcp.url,
      headers: session.mcp.headers
    }
  });

  // 3. Get tools and use with generateText
  const tools = await client.getTools();

  const result = await generateText({
    model: openai('gpt-5.2'),
    tools: tools,
    maxSteps: 5,
    prompt: prompt
  });

  return result.text;
}
```

## ✅ Correct - React Integration

**API Route (app/api/chat/route.ts):**
```typescript
import { openai } from '@ai-sdk/openai';
import { streamText } from 'ai';
import { Composio } from '@composio/core';
import { VercelProvider } from '@composio/vercel';

const composio = new Composio({
  apiKey: process.env.COMPOSIO_API_KEY,
  provider: new VercelProvider()
});

export async function POST(req: Request) {
  const { messages, userId } = await req.json();

  const session = await composio.create(userId, {
    toolkits: ['gmail', 'slack'],
    manageConnections: true
  });

  const stream = await streamText({
    model: openai('gpt-5.2'),
    tools: await session.tools(),
    maxSteps: 5,
    messages: messages
  });

  return stream.toDataStreamResponse();
}
```

**Client Component:**
```typescript
'use client';
import { useChat } from 'ai/react';

export default function Chat({ userId }: { userId: string }) {
  const { messages, input, handleInputChange, handleSubmit } = useChat({
    api: '/api/chat',
    body: { userId }
  });

  return (
    <div>
      {messages.map(m => <div key={m.id}>{m.role}: {m.content}</div>)}
      <form onSubmit={handleSubmit}>
        <input value={input} onChange={handleInputChange} />
      </form>
    </div>
  );
}
```

## ❌ Incorrect Patterns

```typescript
// ❌ Don't forget VercelProvider
const composio = new Composio({ apiKey: key }); // Missing provider

// ❌ Don't bypass Tool Router for MCP
const client = await createMCPClient({
  transport: { type: 'http', url: 'https://mcp.composio.dev' }
});

// ❌ Don't use stdio transport in production
const client = await createMCPClient({
  transport: { type: 'stdio', command: 'npx', args: ['@composio/mcp'] }
});
// Use HTTP transport instead

// ❌ Don't forget maxSteps
await generateText({
  model: openai('gpt-5.2'),
  tools: tools
  // Missing maxSteps - stops after first tool call
});

// ❌ Don't cache tools across users
const cachedTools = await session.tools();
// Reusing for different users...
```

## Key Principles

**Native Tools:**
- Use `session.tools()` with `VercelProvider`
- Works with `generateText` and `streamText`
- Best for most use cases

**MCP Tools:**
- Use `createMCPClient` with HTTP transport
- Get tools via `client.getTools()`
- Use `session.mcp.url` and `session.mcp.headers`
- Only when MCP protocol compliance is required

**Session Management:**
- Always create sessions via `composio.create()`
- Create new sessions per request/conversation
- Don't cache tools or sessions across users

**Multi-Step Agents:**
- Always set `maxSteps` for multi-step tool calling
- Use `onStepFinish` callback to monitor execution

## When to Use

| Use Case | Approach | Method |
|----------|----------|--------|
| Most scenarios | Native Tools | `session.tools()` with VercelProvider |
| MCP protocol required | MCP Tools | `createMCPClient` + `getTools()` |
| React apps | Native Tools | `useChat` with API route |
| Type-safe MCP | MCP with schemas | Explicit tool definitions |

## Reference

- [Vercel AI SDK Docs](https://ai-sdk.dev/docs)
- [AI SDK Tool Calling](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling)
- [AI SDK MCP](https://ai-sdk.dev/docs/ai-sdk-core/mcp-tools)
- [Composio Vercel Provider](https://docs.composio.dev/docs/providers/vercel)
- [Tool Router Sessions](tr-session-lifecycle.md)
