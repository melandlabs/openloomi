---
name: openloomi-api
description: "openloomi API documentation and reference. Use when working with openloomi backend APIs, AI, authentication, characters, messages, files, integrations, billing, or any server-side functionality. Triggers: API endpoints, backend routes, authentication, cloud API, integrations"
metadata:
  version: 0.4.3
---

# openloomi API Documentation
## API Modules

### Module Overview

| Module | Base Path | Description |
|--------|-----------|-------------|
| **Auth** | `/api/auth/*`, `/api/remote-auth/*` | OAuth, login, register |
| **User** | `/api/user/*` | User identity and entitlements |
| **Chat** | `/api/chat/*` (app routes) | Chat/Character CRUD |
| **Messages** | `/api/messages/*` | Message sending and sync |
| **Files** | `/api/files/*` | File storage and upload |
| **Storage** | `/api/storage/*` | Session and disk management |
| **Integrations** | `/api/integrations/*`, `/api/*/callback` | Slack, Discord, X, etc. |
| **RAG** | `/api/rag/*` | Retrieval-augmented generation |
| **Workspace** | `/api/workspace/*` | Artifacts and skills |
| **Native** | `/api/native/*` | Native agent operations |
| **AI** | `/api/ai/*` | LLM, embeddings, images, audio |
| **Insights** | `/api/insights/*`, `/api/chat-insights/*` | Analytics and insights |
| **Billing** | `/api/billing/*` | Billing ledger |

---

## Endpoints Reference

### Auth Module (`/api/auth/*`, `/api/remote-auth/*`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/poll-[provider]` | Poll OAuth status |
| POST | `/api/auth/set-token` | Set auth token |
| POST | `/api/auth/clear-auth-cookie` | Clear session |
| POST | `/api/remote-auth/login` | Login with email/password |
| POST | `/api/remote-auth/register` | Register new user |
| POST | `/api/remote-auth/oauth/[provider]` | OAuth exchange |
| POST | `/api/remote-auth/oauth/[provider]/exchange` | OAuth code exchange |
| POST | `/api/remote-auth/refresh` | Refresh token |
| GET | `/api/remote-auth/user` | Get current user |
| PUT | `/api/remote-auth/user` | Update user info |
| GET | `/api/remote-auth/subscription` | Get subscription info |

#### Login Example

```bash
curl -X POST https://app.openloomi.ai/api/remote-auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"password123"}'
```

Response:
```json
{
  "user": { "id": "user_xxx", "email": "user@example.com", "name": "User" },
  "token": "eyJhbG..."
}
```

### User Module (`/api/user/*`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/user/identity` | Get user identity |
| PUT | `/api/user/identity` | Update identity |
| PUT | `/api/user/password` | Change password |
| GET | `/api/user/entitlements` | Get user entitlements |

### Messages Module (`/api/messages/*`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/messages` | List messages |
| POST | `/api/messages` | Send message |
| GET | `/api/messages/sync` | Sync messages |
| GET | `/api/messages/check` | Check message status |
| GET | `/api/messages/raw` | Get raw message |

### Files Module (`/api/files/*`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/files/list` | List files |
| GET | `/api/files/[id]` | Get file by ID |
| POST | `/api/files/upload` | Upload file |
| POST | `/api/files/save` | Save file |
| GET | `/api/files/usage` | Get storage usage |
| GET | `/api/files/insights/download` | Download insights file |
| POST | `/api/files/insights/save` | Save insights |

### Storage Module (`/api/storage/*`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/storage/disk-usage` | Get disk usage |
| POST | `/api/storage/cleanup` | Cleanup storage |
| GET | `/api/storage/sessions` | List sessions |
| GET | `/api/storage/sessions/[taskId]` | Get session by task ID |
| DELETE | `/api/storage/sessions/[taskId]` | Delete session |

### Integrations Module (`/api/integrations/*`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/integrations/accounts` | List connected accounts |
| GET | `/api/integrations/slack/oauth/start` | Start Slack OAuth |
| GET | `/api/integrations/slack/oauth/exchange` | Exchange Slack OAuth code |
| GET | `/api/integrations/discord/oauth/start` | Start Discord OAuth |
| GET | `/api/integrations/discord/oauth/exchange` | Exchange Discord OAuth code |
| GET | `/api/integrations/x/oauth/start` | Start X OAuth |

### OAuth Callbacks (Various Platforms)

| Method | Endpoint | Platform |
|--------|----------|----------|
| GET | `/api/slack/callback` | Slack |
| GET | `/api/discord/callback` | Discord |
| GET | `/api/auth/callback/github` | GitHub |
| GET | `/api/auth/callback/google` | Google |
| POST | `/api/feishu/listener/init` | Feishu |
| POST | `/api/dingtalk/listener/init` | DingTalk |
| POST | `/api/qqbot/listener/init` | QQ Bot |
| POST | `/api/weixin/listener/init` | WeChat |
| POST | `/api/telegram/user-listener/init` | Telegram |
| POST | `/api/whatsapp/register-socket` | WhatsApp |
| POST | `/api/imessage/init-self-listener` | iMessage |

### RAG Module (`/api/rag/*`)

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

### Workspace Module (`/api/workspace/*`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/workspace/artifacts` | List artifacts |
| GET | `/api/workspace/files` | List files |
| GET | `/api/workspace/file/[...path]` | Get file by path |
| GET | `/api/workspace/preview` | Preview artifact |
| GET | `/api/workspace/external-preview` | External preview |
| GET | `/api/workspace/skills` | List skills |
| GET | `/api/workspace/skills/[skillId]` | Get skill |
| POST | `/api/workspace/skills` | Create skill |
| PUT | `/api/workspace/skills/[skillId]` | Update skill |
| DELETE | `/api/workspace/skills/[skillId]` | Delete skill |
| POST | `/api/workspace/skills/toggle` | Toggle skill |
| POST | `/api/workspace/skills/upload` | Upload skill |
| GET | `/api/workspace/skills/metadata` | Get skill metadata |

### AI Module (`/api/ai/*`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/ai/chat` | Chat completions (streaming) |
| GET | `/api/ai/chat` | Check AI status |
| POST | `/api/ai/v1/chat/completions` | V1 chat completions |
| POST | `/api/ai/v1/embeddings` | Generate embeddings |
| POST | `/api/ai/v1/images/generations` | Generate images |
| POST | `/api/ai/v1/audio/speech` | Text-to-speech |
| POST | `/api/ai/v1/audio/transcriptions` | Speech-to-text |
| POST | `/api/ai/v1/messages/count_tokens` | Count tokens |
| POST | `/api/ai/v1/upload` | Upload file for AI |
| GET | `/api/ai/v1/models` | List available models |

#### Chat Example

```bash
curl -X POST https://app.openloomi.ai/api/ai/chat \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {"role": "system", "content": "You are a helpful assistant."},
      {"role": "user", "content": "Hello!"}
    ],
    "stream": true
  }'
```

### Insights Module (`/api/insights/*`, `/api/chat-insights/*`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/chat-insights` | Get chat insights |
| GET | `/api/insights/brief-categories` | List brief categories |
| POST | `/api/insights/brief-categories/sync` | Sync categories |
| POST | `/api/insights/brief-categories/overrides` | Override categories |
| POST | `/api/insights/brief-categories/pinned` | Pin categories |
| POST | `/api/insights/brief-categories/cleanup` | Cleanup categories |
| GET | `/api/insight-tabs` | List insight tabs |
| POST | `/api/insight-tabs` | Create insight tab |
| PUT | `/api/insight-tabs/[tabId]` | Update tab |
| POST | `/api/insight-tabs/reorder` | Reorder tabs |

### Billing Module (`/api/billing/*`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/billing/ledger` | Get billing ledger |

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

When running openloomi desktop app, the local API server runs on port **3415**:

| Environment | Base URL |
|-------------|----------|
| User Local Desktop | `http://localhost:3415` |

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
curl http://localhost:3415/api/ai/chat

# 2. Get current user info
TOKEN=$(cat ~/.openloomi/token | base64 -d)
curl http://localhost:3415/api/remote-auth/user \
  -H "Authorization: Bearer $TOKEN"

# 3. Get subscription info
TOKEN=$(cat ~/.openloomi/token | base64 -d)
curl http://localhost:3415/api/remote-auth/subscription \
  -H "Authorization: Bearer $TOKEN"

# 4. Chat with AI (streaming)
TOKEN=$(cat ~/.openloomi/token | base64 -d)
curl -X POST http://localhost:3415/api/ai/chat \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Hello!"}],"stream":true}'

# 5. Get chat insights (requires chatId)
TOKEN=$(cat ~/.openloomi/token | base64 -d)
curl "http://localhost:3415/api/chat-insights?chatId=xxx" \
  -H "Authorization: Bearer $TOKEN"

# 6. Search RAG documents
TOKEN=$(cat ~/.openloomi/token | base64 -d)
curl -X POST http://localhost:3415/api/rag/search \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query":"search term","limit":5}'

# 7. List workspace skills
TOKEN=$(cat ~/.openloomi/token | base64 -d)
curl http://localhost:3415/api/workspace/skills \
  -H "Authorization: Bearer $TOKEN"

# 8. Submit feedback
TOKEN=$(cat ~/.openloomi/token | base64 -d)
curl -X POST http://localhost:3415/api/remote-feedback \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"content":"Feedback message","email":"user@example.com"}'
```

### Production API Access

```bash
# Using production API
export TOKEN="your_production_token"
curl https://app.openloomi.ai/api/remote-auth/user \
  -H "Authorization: Bearer $TOKEN"
```

---

## Summary

- **129+ API endpoints** across 20+ functional modules
- **Dual authentication**: Session cookies (web) and Bearer tokens (Tauri)
- **RESTful JSON APIs** with Zod validation
- **CloudApiClient** for desktop/Tauri integration
- **SWR utilities** for client-side data fetching
- **OAuth support** for Google, GitHub, Slack, Discord, X
- **RAG** for document retrieval and search
- **AI** endpoints for chat, embeddings, images, audio
