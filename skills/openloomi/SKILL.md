---
name: openloomi
description: "OpenLoomi entrypoint for skill-only agent runtimes without a plugin mechanism. Use when the user mentions OpenLoomi or Loomi, wants first-use setup guidance, wants to use local OpenLoomi memory, connectors, Loop, knowledge base, RAG search, or asks how to install OpenLoomi skills in runtimes such as WorkBuddy or other skill-capable agents."
---

# OpenLoomi Skills Entrypoint

Use this skill as the front door for OpenLoomi in agents that can load
skills but do not support OpenLoomi plugins.

OpenLoomi remains the runtime owner. The desktop app owns memory storage,
connector credentials, Loop execution, model/provider settings, local API
routes, and secret handling. Skills only explain how to route work into that
local runtime.

## First Step

When readiness is unknown, start with `openloomi-setup`. It guides the user
through installing or opening OpenLoomi Desktop, confirming the local API, and
finishing the session/token setup. Do not ask the user to paste API keys,
OAuth tokens, connector secrets, or OpenLoomi auth tokens into chat.

## Route Requests

Use the narrow OpenLoomi skill that matches the task:

| User intent | Use |
| --- | --- |
| First-use setup, install guidance, readiness checks | `openloomi-setup` |
| Search memory, knowledge base, documents, insights | `openloomi-memory` |
| Connect platforms, list accounts, check connector status, send replies | `openloomi-connectors` |
| Use third-party OAuth apps such as Slack, Gmail, GitHub, Notion, Linear, or Jira | `composio`, paired with `openloomi-connectors` |
| Inspect Loop state, run a tick, manage decisions, preferences, channels, or rules | `openloomi-loop` |
| Answer backend route, local API, auth, RAG, integrations, or workspace questions | `openloomi-api` |
| Explain OpenLoomi concepts, product capabilities, or user workflows | `openloomi-feature-guide` |

## Common Flows

Use these examples to route common requests without reimplementing OpenLoomi
logic in the agent:

- Search memory: start with `openloomi-setup` if readiness is unknown, then
  use `openloomi-memory` to search memory, knowledge base documents, or
  insights.
- Post to Slack: start with `openloomi-setup`, use `openloomi-connectors` to
  check connector/account readiness, then use `composio` for the
  OAuth-backed Slack action when the user asks to send or post.
- Draft an email: start with `openloomi-setup`, use `openloomi-memory` for
  relevant context, then use `composio` or connector guidance for the mail
  surface the user has authorized.
- Summarize a Notion page: start with `openloomi-setup`, use `composio` for
  the authorized Notion access path, then hand useful context to
  `openloomi-memory` or `openloomi-api` when the user wants it saved,
  searched, or grounded in the local knowledge base.

## Boundaries

- Do not depend on Codex or Claude plugin files.
- Do not call plugin bridge scripts such as `loomi-bridge.mjs`.
- Do not duplicate OpenLoomi business logic inside the agent.
- Do not invent connector behavior. Use the connector and Composio skills for
  platform-specific flows.
- If OpenLoomi Desktop is missing or the local API is unavailable, use
  `openloomi-setup` to provide official installation and recovery guidance.
