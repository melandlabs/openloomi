---
title: Building Apps and Agents with Composio
impact: HIGH
description: SDK-based guide for building AI agents and applications that integrate with external tools via Composio
tags: [composio, sdk, agents, apps, typescript, python, frameworks]
---

# Building Apps and Agents with Composio

Use the Composio SDK to build AI agents, chat apps, and backend services that integrate with 200+ external tools.

## Project Setup

Run inside your project directory to initialize and store the API key:
```bash
composio init
```

## Install the SDK

**TypeScript**
```bash
pnpm install @composio/core@latest
```

Provider packages for agentic frameworks:
- `@composio/vercel` — Vercel AI SDK
- `@composio/openai-agents` — OpenAI Agents
- `@composio/langchain` — LangChain
- `@composio/mastra` — Mastra
- `@composio/claude-agent-sdk` — Claude Agent SDK

**Python**
```bash
pip install composio
```

Provider packages for agentic frameworks:
- `composio-openai-agents` — OpenAI Agents
- `composio-langchain` — LangChain
- `composio-langgraph` — LangGraph
- `composio-crewai` — CrewAI
- `composio-claude-agent-sdk` — Claude Agent SDK
- `composio-google-adk` — Google ADK

Pass the provider into the Composio constructor:
```typescript
import { Composio } from '@composio/core'
import { VercelProvider } from '@composio/vercel'

const composio = new Composio({ provider: new VercelProvider() })
```
```python
from composio import Composio
from composio_langchain import LangchainProvider

composio = Composio(provider=LangchainProvider())
```

---

## Building Agents

Use Tool Router to create isolated MCP sessions per user with scoped tool access and automatic auth management. Compatible with any AI framework.

### Session Management
- [User ID Best Practices](tr-userid-best-practices.md) — choose user IDs for security and isolation
- [Creating Basic Sessions](tr-session-basic.md) — initialize Tool Router sessions
- [Session Lifecycle](tr-session-lifecycle.md) — when to create vs reuse sessions
- [Session Configuration](tr-session-config.md) — configure toolkits, tools, and filters
- [Using Native Tools](tr-mcp-vs-native.md) — prefer native tools for performance and control

### Authentication Flows
- [Auto Authentication in Chat](tr-auth-auto.md) — enable in-chat auth flows
- [Manual Authorization](tr-auth-manual.md) — use `session.authorize()` for explicit flows
- [Connection Management](tr-auth-connections.md) — configure `manageConnections`, `waitForConnections`, and callback URLs

### Toolkit Querying & UI Building
- [Building Chat UIs](tr-building-chat-ui.md) — toolkit selection, connection management, and session handling
- [Query Toolkit States](tr-toolkit-query.md) — use `session.toolkits()` to check connections and build connection UIs

### Framework Integrations
- [Framework Integration](tr-framework-integration.md) — LangChain, OpenAI Agents, general patterns
- [Vercel AI SDK](tr-framework-ai-sdk.md) — native tools, MCP, and React
- [Mastra](tr-framework-mastra.md) — Mastra agents with native tools and MCP

### Event-Driven Agents (Triggers)
- [Creating Triggers](triggers-create.md) — set up trigger instances for real-time events
- [Subscribing to Events](triggers-subscribe.md) — listen to trigger events in real-time
- [Webhook Verification](triggers-webhook.md) — verify and process incoming webhook payloads
- [Managing Triggers](triggers-manage.md) — enable, disable, update, and list triggers

---

## Building Apps

Direct tool execution without agent frameworks — full control over auth, execution, and resource management. If building apps with agentic abilities, make sure the auth configs match the session's auth configs.

### Core Operations
- [Fetching Tools](app-fetch-tools.md) — get tools with filters and search
- [Direct Tool Execution](app-execute-tools.md) — execute tools manually with parameters
- [Tool Version Management](app-tool-versions.md) — version pinning strategies for stability

### Resource Management
- [Connected Accounts CRUD](app-connected-accounts.md) — create, read, update, delete connected accounts
- [Auth Config Management](app-auth-configs.md) — manage authentication configurations
- [Toolkit Management](app-toolkits.md) — query toolkits, categories, and auth requirements
- [Auth Popup UI](app-auth-popup-ui.md) — build popup-based OAuth flows

### Extensibility
- [Tool Modifiers](app-modifiers.md) — schema modification and execution hooks for logging and modifications

### User Context & Multi-Tenancy
- [User ID Patterns](app-user-context.md) — user vs organization IDs, shared vs isolated connections

### Event-Driven Applications
- [Creating Triggers](triggers-create.md) — set up trigger instances
- [Subscribing to Events](triggers-subscribe.md) — listen to events in real-time
- [Webhook Verification](triggers-webhook.md) — verify incoming webhooks
- [Managing Triggers](triggers-manage.md) — enable, disable, update triggers

---

## Verify Tool Slugs Before Use

Never guess toolkit, tool, or trigger names. Always verify:

```bash
composio search "send email"
composio manage tools info "GMAIL_SEND_EMAIL"
composio manage toolkits info "gmail"
```

Using incorrect slugs causes runtime errors.
