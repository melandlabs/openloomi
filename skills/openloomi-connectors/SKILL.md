---
name: openloomi-connectors
description: "openloomi Connectors tools - manage the native 7 messaging integrations and pair with the composio skill for the 1000+ apps OAuth layer (Slack, Discord, X, Gmail, Outlook, Google Calendar/Drive/Docs, GitHub, Notion, Linear, HubSpot, LinkedIn, Jira, Asana). Triggers: connect platform, integration status, list accounts, disconnect, list-accounts, status, connect, send-reply, native vs composio, 1000+ apps, list connections."
metadata:
  version: 0.8.8
allowed-tools: Bash(node $SKILL_DIR/scripts/openloomi-connectors.cjs *)
---

> **Note:** If OpenLoomi readiness is unknown, use `openloomi-setup` first. If OpenLoomi Desktop is not installed, follow [Getting Started](https://openloomi.ai/docs/getting-started).

# OpenLoomi Connectors Skill

OpenLoomi Connectors handle two directions: **pulling Signals in** from your authorized platforms and **pushing approved Actions back out** through the same channel. OpenLoomi ships them through two layers:

- **Native (this skill)** — 7 messaging-platform bots maintained directly by OpenLoomi: Telegram, WhatsApp, iMessage, Lark/Feishu, DingTalk, QQ, and WeChat. The `openloomi-connectors` CLI covers OAuth / app-credential / QR / interactive setup, list, status, disconnect, contact query, and message send for these.
- **Composio (paired `composio` skill)** — a hosted OAuth broker that authorizes ~1000+ apps including Slack, Discord, X, Gmail, Outlook, Google Calendar/Drive/Docs, GitHub, Notion, Linear, HubSpot, LinkedIn, Jira, Asana. Composio handles **"is this user authorised?"** and stores the tokens; OpenLoomi's Loop channels consume the events as Signals (see [Glossary — Composio / Loop channel](https://openloomi.ai/docs/glossary)).

When the user asks "what am I connected to?" or "list my accounts", run **both** — `list-accounts` here **and** the composio connection listing — and present the union. Keep auth, OAuth, and disconnect flows native to each skill.

This skill does **not** manage Loop channels, custom decision types, or classifier rules — those are `openloomi-loop`'s job.

---

## What is openloomi?

OpenLoomi is an **open-source AI coworker, driven by an attention agent** — a desktop app (Loomi) that connects your authorized tools, builds a local knowledge graph of people / projects / decisions, and surfaces the day's decisions as one-tap bubbles you Approve. It runs locally (local-first, AES-256), supports Skills + Plugins so any Agent Runtime (Claude Code, Codex, OpenCode, Hermes, OpenClaw) can plug into the same resident desktop. See `openloomi-feature-guide` for the full picture.

### Continuous sync

Connectors are the **per-platform input** that Loop reads on every tick. When you authorize a platform, OpenLoomi continuously syncs (with your permission):

- Raw messages and communications
- Meetings and calendar events
- Emails and tweets
- Voice calls
- Notes, screen captures, and captured ideas

The aggregated stream feeds OpenLoomi's Memory and the Signals Loop polls on every tick — so an unprompted reminder, a contextual reply draft, or a Decision Card arrives with full historical grounding instead of starting from scratch.

---

## Supported Platforms (7)

The CLI `list-platforms` returns these 7 platforms. Other connectable
platforms (Slack, Discord, X, Gmail, Outlook, LinkedIn, Google Calendar,
Google Drive, Google Docs, HubSpot, Notion, etc.) are managed via the
desktop UI or the `composio` skill — see "Platform Connection Methods"
below for details.

| ID | Display Name | Aliases |
|----|-------------|---------|
| `telegram` | Telegram | tg |
| `whatsapp` | WhatsApp | |
| `imessage` | iMessage | |
| `feishu` | Lark/Feishu | lark, 飞书 |
| `dingtalk` | DingTalk | 钉钉 |
| `qqbot` | QQ | qq, qq_bot |
| `weixin` | WeChat | wechat, 微信, wechat_work, wecom, 企业微信 |

---

## Authentication

The CLI auto-reads your token from `~/.openloomi/token` (base64 encoded JWT).

### Local API Access

The local API server runs on port **3414** (fallback: **3515**). If 3414 is unavailable, try 3515.

---

## API Endpoints

### Integration Accounts

#### GET `/api/integrations/accounts` - List Connected Accounts

Returns all connected platform accounts for the authenticated user.

```bash
curl http://localhost:3414/api/integrations/accounts \
  -H "Authorization: Bearer $TOKEN"
```

**Response:**
```json
{
  "accounts": [
    {
      "id": "int_xxx",
      "platform": "gmail",
      "externalId": "user@gmail.com",
      "displayName": "My Gmail",
      "status": "active",
      "metadata": {},
      "createdAt": "2024-01-01T00:00:00Z",
      "botId": "bot_xxx"
    }
  ]
}
```

**Note:** Each account includes a `botId` field which is used for `send-reply` and other bot operations.

---

### OAuth Start Endpoints

#### GET `/api/integrations/slack/oauth/start?userId=<userId>` - Start Slack OAuth

Returns the Slack OAuth authorization URL. The CLI opens this URL in the browser for the user to complete authorization.

```bash
curl "http://localhost:3414/api/integrations/slack/oauth/start?userId=<userId>"
```

**Response:**
```json
{
  "authorizationUrl": "https://slack.com/oauth/v2/authorize?...",
  "state": "userId:uuid"
}
```

#### GET `/api/integrations/discord/oauth/start?userId=<userId>` - Start Discord OAuth

Returns the Discord OAuth authorization URL.

#### GET `/api/integrations/x/oauth/start?userId=<userId>` - Start X OAuth

Returns the X/Twitter OAuth authorization URL.

---

### OAuth Exchange Endpoints

#### GET `/api/integrations/slack/oauth/exchange?code=<code>&state=<state>` - Exchange Slack Code

Exchange OAuth code for Slack access.

#### GET `/api/integrations/discord/oauth/exchange?code=<code>&state=<state>` - Exchange Discord Code

Exchange OAuth code for Discord access.

---

### OAuth Callbacks

| Platform | Endpoint |
|----------|----------|
| Feishu | `POST /api/feishu/listener/init` |
| DingTalk | `POST /api/dingtalk/listener/init` |
| QQ Bot | `POST /api/qqbot/listener/init` |
| WeChat | `POST /api/weixin/listener/init` |
| Telegram | `POST /api/telegram/user-listener/init` |
| WhatsApp | `POST /api/whatsapp/register-socket` |
| iMessage | `POST /api/imessage/init-self-listener` |

---

### DELETE `/api/integrations/:id` - Disconnect Account

Delete a connected integration account.

```bash
curl -X DELETE http://localhost:3414/api/integrations/int_xxx \
  -H "Authorization: Bearer $TOKEN"
```

**Response:**
```json
{
  "success": true,
  "deletedAccountId": "int_xxx",
  "deletedBotIds": ["bot_xxx"]
}
```

---

### GET `/api/contacts` - Query Contacts

Query user contacts with optional filtering and pagination.

```bash
curl "http://localhost:3414/api/contacts?name=John&page=1&pageSize=10" \
  -H "Authorization: Bearer $TOKEN"
```

**Parameters:**
- `name` (string, optional) - Filter contacts by name (partial match)
- `page` (number, default 1) - Page number
- `pageSize` (number, default 10) - Items per page (max 100)

**Response:**
```json
{
  "success": true,
  "contacts": [
    {
      "id": "contact_xxx",
      "name": "John Doe",
      "type": "email",
      "botId": "bot_xxx",
      "platform": "gmail"
    }
  ],
  "pagination": {
    "page": 1,
    "pageSize": 10,
    "totalCount": 50,
    "totalPages": 5,
    "hasMore": true,
    "hasPrevious": false
  }
}
```

---

### POST `/api/messages` - Send Message

Send a message via a connected platform bot.

```bash
curl -X POST http://localhost:3414/api/messages \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "botId": "bot_xxx",
    "recipients": ["John"],
    "message": "Hello!",
    "subject": "Optional subject"
  }'
```

**Parameters:**
- `botId` (string, required) - The bot ID to send from
- `recipients` (array, required) - List of recipient names
- `message` (string, required) - Message content
- `subject` (string, optional) - Email subject line
- `cc` (array, optional) - CC recipients
- `bcc` (array, optional) - BCC recipients

**Note:** `botId` is returned by `list-accounts` in the `botId` field (different from account `id`).

---

## Platform Aliases Reference

Aliases are case-insensitive and support both English and Chinese:

| Alias | Platform |
|-------|----------|
| `tg` | telegram |
| `wechat`, `微信` | weixin |
| `lark`, `飞书` | feishu |
| `钉钉` | dingtalk |
| `qq`, `qq_bot` | qqbot |

---

## Desktop UI

Users can also authorize accounts directly through the openloomi desktop application without using CLI commands.

### Adding Account Authorization via Desktop UI

1. **Open openloomi desktop app** on your computer
2. **Navigate to Settings** (gear icon in the sidebar or top-right menu)
3. **Go to Integrations** tab/section
4. **Click on the platform** you want to connect (e.g., Telegram, Slack, Discord, Gmail, etc.)
5. **Follow the platform-specific authorization flow:**
   - **OAuth platforms** (Slack, Discord, X/Twitter): Click "Connect" → you'll be redirected to the platform's authorization page in your browser → Approve the permissions → you'll be redirected back
   - **App Password platforms** (Gmail, Outlook): Enter your email and app password
   - **App Credentials platforms** (DingTalk, Feishu, QQ): Enter your appId and appSecret
   - **QR/Interactive platforms** (WhatsApp, Telegram, iMessage): Scan the QR code or follow the in-app instructions

6. **Verify connection** — once authorized, the platform will show as "Connected" with a green checkmark

### Managing Connected Accounts

- **List connected accounts**: Settings → Integrations → shows all connected platforms with status
- **Disconnect account**: Settings → Integrations → click on connected platform → "Disconnect" or remove
- **Check status**: Connected platforms show green "Active" badge; expired/disconnected shows red "Inactive" badge

---

## CLI Script

### Quick Start

```bash
# List all supported platforms
node $SKILL_DIR/scripts/openloomi-connectors.cjs list-platforms

# List all connected accounts (includes botId for send-reply)
node $SKILL_DIR/scripts/openloomi-connectors.cjs list-accounts

# Cross-source audit: openloomi-native + composio-linked accounts (run together, present union)
node $SKILL_DIR/scripts/openloomi-connectors.cjs list-accounts
# In parallel, invoke the `composio` skill (e.g. `composio list-connections` via composio-cli,
# or `mcp__composio__COMPOSIO_MANAGE_CONNECTIONS` with action: "list")

# Check connection status for a platform
node $SKILL_DIR/scripts/openloomi-connectors.cjs status telegram

# Connect a platform (opens browser for OAuth)
node $SKILL_DIR/scripts/openloomi-connectors.cjs connect slack

# Disconnect an account by ID
node $SKILL_DIR/scripts/openloomi-connectors.cjs disconnect int_xxx

# Query contacts
node $SKILL_DIR/scripts/openloomi-connectors.cjs query-contacts --name=John --page=1 --pageSize=10

# Send a message (requires botId from list-accounts)
node $SKILL_DIR/scripts/openloomi-connectors.cjs send-reply --botId=bot_xxx --recipients=John --message="Hello!"
```

### Commands

| Command | Description |
|---------|-------------|
| `list-platforms` | List all 7 supported platforms with IDs and aliases |
| `list-accounts` | List all connected integration accounts (includes `botId`) |
| `status <platform>` | Check if a platform is connected (e.g., telegram, slack) |
| `connect <platform> [options]` | Connect a platform (OAuth, App Password, or App Credentials) |
| `disconnect <accountId>` | Disconnect a specific account by ID |
| `query-contacts [options]` | Query contacts (--name=, --page=, --pageSize=) |
| `send-reply --botId= --recipients= --message=` | Send a message via REST API |

### Platform Connection Methods

| Method | Platforms |
|--------|-----------|
| OAuth (auto-opens browser) | `slack`, `discord`, `x` |
| App Password | `gmail --email=x --password=xxxx`, `outlook --email=x --password=xxxx` |
| App Credentials | `dingtalk --clientId=x --clientSecret=x`, `feishu --appId=x --appSecret=x`, `qq --appId=x --appSecret=x` |
| iLink Token | `wechat --token=x` |
| Browser Required (QR/interactive) | `whatsapp`, `telegram`, `imessage` |

---

## AI Agent Workflow

**Triggered when the user asks about:**

1. Connecting a platform - "connect telegram", "link my slack"
2. Listing integrations - "show my connected accounts", "what platforms am I connected to"
3. Checking status - "is my github connected?", "telegram status"
4. Disconnecting - "disconnect my discord", "remove whatsapp"
5. Querying contacts - "show my contacts", "find John in contacts"
6. Sending messages - "send email to John", "reply to that message"
7. Cross-source account audit - "show everything I'm connected to (openloomi + composio)", "list all linked accounts across both" → run `list-accounts` here **and** the `composio` skill in parallel, then present the union

**Execution Flow:**

1. **Identify intent** - connect / list / status / disconnect / query-contacts / send-reply
2. **Resolve platform** - use alias normalization (e.g., `gh` -> `github`)
3. **Execute command** - use Bash tool
4. **Format output** - report results naturally in user's language

**Note on send-reply:** The `botId` is returned by `list-accounts` in the `botId` field.
