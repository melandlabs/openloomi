---
name: openloomi-api
description: "openloomi HTTP API reference (local-first, served from the OpenLoomi Desktop app at http://localhost:3414). Use when working with openloomi backend routes — auth, AI, files, integrations, RAG, memory, Loop, pet, workspace, platform callbacks. Triggers: API endpoints, backend routes, /api/*, local API, port 3414, integrations REST, OAuth start, RAG search, loop state, memory search, pet state, audit logs"
---

> **Note:** If OpenLoomi readiness is unknown, use `openloomi-setup` first. If OpenLoomi Desktop is not installed, follow [Getting Started](https://openloomi.ai/docs/getting-started).

# OpenLoomi API Documentation

## API Modules

OpenLoomi ships a **local-first** HTTP API served from the desktop app (port `3414`, fallback `3515`). All auth, Memory, AI, RAG, Loop, and Audit data live in a local SQLite database — your data stays on your machine and the OpenLoomi app is the source of truth. The only externally-routed auth path is the **Composio OAuth broker** that backs the Slack, GitHub, Google, Notion, Linear, HubSpot, LinkedIn, Jira, and Asana Connectors (see `openloomi-connectors`).

The `remote-auth` prefix is historical — those routes once proxied to a cloud server; today they are the canonical local endpoints, and the Claude/Codex plugin bridge uses `/api/remote-auth/user` as a port-discovery + auth-handshake probe.

This reference covers **131 route handlers** under 36 top-level `/api/*` modules. Pair it with `openloomi-loop` (Loop state, decisions, channels, classifier rules, brief/wrap) and `openloomi-memory` (Memory search, KB, insights, entities, living connections) for the runtime surfaces used by Chat and Loop.

### Functional Modules

| Module | Base Path | Routes | Description |
|--------|-----------|--------|-------------|
| **Auth** | `/api/auth/*`, `/api/remote-auth/*`, `/api/remote-feedback/*` | 6 | Guest session, token, user probe, feedback |
| **AI** | `/api/ai/*` | 5 | Chat, images, audio, embeddings |
| **Audit** | `/api/audit/*` | 1 | Audit log retrieval |
| **Chat Insights** | `/api/chat-insights/*` | 1 | Per-chat insight records |
| **Chronicle** | `/api/chronicle/*` | 7 | Meeting detection, analysis, memories |
| **Contacts** | `/api/contacts/*` | 1 | Contact query |
| **DB Init** | `/api/db/*` | 1 | Bootstrap database |
| **Files** | `/api/files/*` | 8 | File storage, upload, download |
| **Insight Tabs** | `/api/insight-tabs/*` | 3 | Tab CRUD + reorder |
| **Integrations** | `/api/integrations/*` | 9 | OAuth + connected accounts |
| **Listeners** | `/api/listeners/*` | 1 | Listener cleanup |
| **LLM Usage** | `/api/llm/*` | 1 | Usage summary |
| **Loop** | `/api/loop/*` | 24 | Attention loop, decisions, channels, classifier rules |
| **Markmap** | `/api/markmap/*` | 1 | Markmap generation |
| **Memory** | `/api/memory/*` | 2 | Memory search, raw messages |
| **Messages** | `/api/messages/*` | 4 | Send, sync, status, raw |
| **Native** | `/api/native/*` | 5 | Native agent operations, providers, skills |
| **Pet** | `/api/pet/*` | 1 | Pet state mirror |
| **Proxy** | `/api/proxy/*` | 2 | CSS/JS proxy |
| **RAG** | `/api/rag/*` | 11 | Document upload, search, stats |
| **Storage** | `/api/storage/*` | 4 | Disk usage, sessions, cleanup |
| **Workspace** | `/api/workspace/*` | 11 | Artifacts, files, skills, previews |

### Platform Callback Modules

Each integration platform has its own `/api/<platform>/*` module:

| Platform | Base Path | Routes |
|----------|-----------|--------|
| **Slack** | `/api/slack/*` | 2 |
| **Discord** | `/api/discord/*` | 2 |
| **Feishu (Lark)** | `/api/feishu/*` | 1 |
| **DingTalk** | `/api/dingtalk/*` | 1 |
| **QQ Bot** | `/api/qqbot/*` | 1 |
| **Weixin (WeChat)** | `/api/weixin/*` | 4 |
| **Telegram** | `/api/telegram/*` | 4 |
| **WhatsApp** | `/api/whatsapp/*` | 2 |
| **iMessage** | `/api/imessage/*` | 2 |
| **HubSpot** | `/api/hubspot/*` | 1 |
| **LinkedIn** | `/api/linkedin/*` | 1 |
| **Notion** | `/api/notion/*` | 1 |

---

## Endpoints Reference

### Auth Module

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/set-token` | Set auth token |
| POST | `/api/auth/clear-auth-cookie` | Clear session |
| POST | `/api/auth/token` | Issue session token |
| POST | `/api/remote-auth/guest` | Create anonymous guest session |
| GET | `/api/remote-auth/user` | Get current user (also used by plugin probe) |
| PUT | `/api/remote-auth/user` | Update user info |
| POST | `/api/remote-feedback` | Submit feedback |

### Messages Module

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/messages` | List messages |
| POST | `/api/messages` | Send message |
| GET | `/api/messages/sync` | Sync messages |
| GET | `/api/messages/check` | Check message status |
| GET | `/api/messages/raw` | Get raw message |

### Files Module

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/files/list` | List files |
| GET | `/api/files/[id]` | Get file by ID |
| GET | `/api/files/download` | Download file |
| POST | `/api/files/upload` | Upload file |
| POST | `/api/files/save` | Save file |
| GET | `/api/files/usage` | Get storage usage |
| GET | `/api/files/insights/download` | Download insights file |
| POST | `/api/files/insights/save` | Save insights |

### Storage Module

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/storage/disk-usage` | Get disk usage |
| POST | `/api/storage/cleanup` | Cleanup storage |
| GET | `/api/storage/sessions` | List sessions |
| GET | `/api/storage/sessions/[taskId]` | Get session by task ID |
| DELETE | `/api/storage/sessions/[taskId]` | Delete session |

### Integrations Module

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/integrations/accounts` | List connected accounts |
| GET | `/api/integrations/slack/oauth/start` | Start Slack OAuth |
| GET | `/api/integrations/slack/oauth/exchange` | Exchange Slack OAuth code |
| GET | `/api/integrations/discord/oauth/start` | Start Discord OAuth |
| GET | `/api/integrations/discord/oauth/exchange` | Exchange Discord OAuth code |
| GET | `/api/integrations/x/oauth/start` | Start X OAuth |
| GET | `/api/integrations/hubspot/oauth/start` | Start HubSpot OAuth |
| GET | `/api/integrations/linkedin/oauth/start` | Start LinkedIn OAuth |
| GET | `/api/integrations/notion/oauth/start` | Start Notion OAuth |

### Platform Callbacks

| Platform | Module | Sample Endpoint |
|----------|--------|-----------------|
| Slack | `/api/slack/*` | OAuth + listener endpoints under the module |
| Discord | `/api/discord/*` | OAuth + listener endpoints under the module |
| Feishu | `/api/feishu/*` | `POST /api/feishu/listener/init` |
| DingTalk | `/api/dingtalk/*` | `POST /api/dingtalk/listener/init` |
| QQ Bot | `/api/qqbot/*` | `POST /api/qqbot/listener/init` |
| Weixin (WeChat) | `/api/weixin/*` | `POST /api/weixin/listener/init` |
| Telegram | `/api/telegram/*` | `POST /api/telegram/user-listener/init` |
| WhatsApp | `/api/whatsapp/*` | `POST /api/whatsapp/register-socket` |
| iMessage | `/api/imessage/*` | `POST /api/imessage/init-self-listener` |
| HubSpot | `/api/hubspot/*` | OAuth start under `/api/hubspot/...` |
| LinkedIn | `/api/linkedin/*` | OAuth start under `/api/linkedin/...` |
| Notion | `/api/notion/*` | OAuth start under `/api/notion/...` |

### RAG Module

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/rag/search` | Search documents |
| GET | `/api/rag/stats` | Get RAG statistics |
| GET | `/api/rag/documents` | List documents |
| GET | `/api/rag/documents/[documentId]` | Get document |
| GET | `/api/rag/documents/[documentId]/binary` | Get document binary |
| DELETE | `/api/rag/documents/[documentId]` | Delete document |
| POST | `/api/rag/upload` | Upload document |
| POST | `/api/rag/upload/init` | Initialize upload |
| POST | `/api/rag/upload/chunk` | Upload chunk |
| POST | `/api/rag/upload/complete` | Complete upload |
| POST | `/api/rag/upload/async` | Async upload |
| GET | `/api/rag/upload/async/status` | Check async upload status |

### Workspace Module

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/workspace/artifacts` | List artifacts |
| GET | `/api/workspace/files` | List files |
| GET | `/api/workspace/file/[...path]` | Get file by path |
| GET | `/api/workspace/preview` | Preview artifact |
| GET | `/api/workspace/external-preview` | External preview |
| GET | `/api/workspace/pptx-preview/[taskId]/[...path]` | Preview PPTX artifact |
| GET | `/api/workspace/skills` | List skills |
| GET | `/api/workspace/skills/[skillId]` | Get skill |
| POST | `/api/workspace/skills` | Create skill |
| PUT | `/api/workspace/skills/[skillId]` | Update skill |
| DELETE | `/api/workspace/skills/[skillId]` | Delete skill |
| POST | `/api/workspace/skills/toggle` | Toggle skill |
| POST | `/api/workspace/skills/upload` | Upload skill |
| GET | `/api/workspace/skills/metadata` | Get skill metadata |

### AI Module

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/ai/v1/chat/completions` | Chat completions (streaming) |
| POST | `/api/ai/v1/messages` | Messages API |
| POST | `/api/ai/v1/images/generations` | Generate images |
| POST | `/api/ai/v1/images/lifestyle/generate` | Lifestyle image generate |
| POST | `/api/ai/v1/images/lifestyle/compose` | Lifestyle image compose |

### Chronicle Module

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/chronicle/analyze` | Run chronicle analysis |
| GET | `/api/chronicle/memories` | List memories |
| GET | `/api/chronicle/memories/[memoryId]` | Get a memory |
| DELETE | `/api/chronicle/memories/[memoryId]` | Delete a memory |

### Insight Tabs Module

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/insight-tabs` | List insight tabs |
| POST | `/api/insight-tabs` | Create insight tab |
| PUT | `/api/insight-tabs/[tabId]` | Update tab |
| POST | `/api/insight-tabs/reorder` | Reorder tabs |

### Chat Insights Module

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/chat-insights` | Get chat insights |

### Memory Module

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/memory/search` | Search memory |
| GET | `/api/memory/raw-messages` | Get raw messages |

### Native Module

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/native/providers` | List native providers |
| GET | `/api/native/skills` | List native skills |
| POST | `/api/native/agent` | Agent invocation |
| POST | `/api/native/agent/password` | Agent password |
| POST | `/api/native/agent/permission` | Agent permission |

### Pet Module

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/pet/state` | Read pet state |
| POST | `/api/pet/state` | Write pet state |

### Loop Module (highlights)

24 routes total. Top-level surfaces:

| Endpoint | Description |
|----------|-------------|
| `GET /api/loop/connectors` | Connector status |
| `GET /api/loop/state` | Loop state |
| `POST /api/loop/tick` | Advance loop tick |
| `POST /api/loop/activation` | Trigger activation |
| `GET /api/loop/preferences` | Loop preferences |
| `GET /api/loop/brief` / `GET /api/loop/brief/content` | Brief delivery |
| `GET /api/loop/wrap` / `GET /api/loop/wrap/content` | Wrap delivery |
| `GET /api/loop/channels` / `GET /api/loop/channels/[id]` | Channels |
| `GET /api/loop/types` / `GET /api/loop/types/[id]` | Loop types |
| `GET /api/loop/decisions` / `GET /api/loop/decision/[id]` | Decisions |
| `POST /api/loop/action/schedule` / `GET /api/loop/action/[id]` | Actions |
| `GET /api/loop/action/by-decision/[id]` | Actions by decision |
| `GET /api/loop/classifier-rules[/...]` | Classifier rules + dry-run |
| `GET /api/loop/card/[id]` | Card |
| `POST /api/loop/dev/reset` / `GET /api/loop/dev/scene` | Dev tooling |

### Other Modules (single-route or paired)

| Module | Endpoints |
|--------|-----------|
| **Audit** | `GET /api/audit/logs` |
| **Contacts** | `GET /api/contacts` |
| **DB** | `POST /api/db/init` |
| **Listeners** | `POST /api/listeners/cleanup` |
| **LLM Usage** | `GET /api/llm/usage/summary` |
| **Markmap** | `POST /api/markmap` |
| **Proxy** | `GET /api/proxy/css`, `GET /api/proxy/js` |

---

## Error Handling

### Error Response Format

```typescript
// API errors return standard HTTP status codes
{
  error: string;      // Error message
  code?: string;       // Error code for programmatic handling
  cause?: string;      // Additional context
}
```

### Common Status Codes

| Code | Meaning |
|------|---------|
| 200 | Success |
| 400 | Bad Request - Invalid input |
| 401 | Unauthorized - Not authenticated |
| 403 | Forbidden - Insufficient permissions |
| 404 | Not Found |
| 429 | Too Many Requests |
| 500 | Internal Server Error |

---

## AI/Agent Usage

### Local API Access

When running openloomi desktop app, the local API server runs on port **3414** (fallback: **3515**):

| Environment | Base URL |
|-------------|----------|
| User Local Desktop | `http://localhost:3414` |
| User Local Desktop (fallback) | `http://localhost:3515` |

### Authentication Token

The auth token is stored at `~/.openloomi/token` (base64 encoded JWT). You **must decode it** before use:

```bash
# Decode base64 to get JWT token
TOKEN=$(cat ~/.openloomi/token | base64 -d)

# Verify token contents (decodes JWT payload)
echo "$TOKEN" | cut -d'.' -f2 | base64 -d 2>/dev/null | python3 -m json.tool
```

### curl Examples

**Important**: All authenticated requests require the token to be base64 decoded first.

```bash
# Helper: Get decoded token
TOKEN=$(cat ~/.openloomi/token | base64 -d)

# 1. Check AI API status (no auth required)
curl http://localhost:3414/api/ai/chat

# 2. Get current user info (also used by Claude/Codex plugin as a port-discovery probe)
TOKEN=$(cat ~/.openloomi/token | base64 -d)
curl http://localhost:3414/api/remote-auth/user \
  -H "Authorization: Bearer $TOKEN"

# 3. Create an anonymous guest session (no credentials)
curl -X POST http://localhost:3414/api/remote-auth/guest \
  -H "Content-Type: application/json" \
  -d '{}'

# 4. Chat with AI (streaming)
TOKEN=$(cat ~/.openloomi/token | base64 -d)
curl -X POST http://localhost:3414/api/ai/chat \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Hello!"}],"stream":true}'

# 5. Get chat insights (requires chatId)
TOKEN=$(cat ~/.openloomi/token | base64 -d)
curl "http://localhost:3414/api/chat-insights?chatId=xxx" \
  -H "Authorization: Bearer $TOKEN"

# 6. Search RAG documents
TOKEN=$(cat ~/.openloomi/token | base64 -d)
curl -X POST http://localhost:3414/api/rag/search \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query":"search term","limit":5}'

# 7. List workspace skills
TOKEN=$(cat ~/.openloomi/token | base64 -d)
curl http://localhost:3414/api/workspace/skills \
  -H "Authorization: Bearer $TOKEN"

# 8. Submit feedback
TOKEN=$(cat ~/.openloomi/token | base64 -d)
curl -X POST http://localhost:3414/api/remote-feedback \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"content":"Feedback message","email":"user@example.com"}'
```

---

## Summary

- **131 route handlers** across 22 functional modules + 12 platform callback modules + 2 cross-cutting modules (`proxy`, `db`)
- **Local-first**: auth, Memory, AI, RAG, Loop, and Audit data live in a local SQLite database; the only externally-routed path is the Composio OAuth broker
- **Dual authentication**: Session cookies (web) and Bearer tokens (Tauri / CLI)
- **RESTful JSON APIs** with Zod validation
- **SWR utilities** for client-side data fetching
- **OAuth support** for Slack, Discord, X, HubSpot, LinkedIn, Notion
- **RAG** for Knowledge Base document upload + retrieval (`openloomi-memory` owns the user-facing surface)
- **AI** endpoints for chat, images, audio
- **Loop** for the proactive judgement engine — signals, decisions, cards, channels, classifier rules (see `openloomi-loop`)
- **Memory** search + raw-message access (full surface in `openloomi-memory`)
- **Pet** state mirror (read/write `/api/pet/state`)
