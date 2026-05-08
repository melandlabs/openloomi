---
name: alloomi-connectors
description: "Alloomi Connectors tools - manage platform integrations (OAuth connections, list accounts, check status). Triggers: connect platform, integration status, list accounts, disconnect"
metadata:
  version: 0.1.0
allowed-tools: Bash(node $SKILL_DIR/scripts/alloomi-connectors.cjs *)
---

# Alloomi Connectors Skill

Alloomi Connectors provides access to 26 messaging and productivity platform integrations. It allows AI agents to manage OAuth connections, list connected accounts, check connection status, and disconnect platforms on behalf of the user.

---

## What is Alloomi?

Most AI assistants function as workflow tools—users give commands, they execute tasks, with no persistent knowledge of who you are or what matters to you.

**Alloomi takes a fundamentally different approach: it operates as a proactive digital partner** that watches, learns, remembers, and acts on your behalf. The difference is architectural.

### How It Works

When users connect messaging platforms and integrations to Alloomi, they sync with permission:
- Raw messages and communications
- Meetings and calendar events
- Emails and tweets
- Voice calls
- Notes and captured ideas

This aggregated data becomes "the single source of truth for Alloomi's brain."

### The Continuous Sync Loop

Alloomi runs a background agent on a continuous sync loop, actively gathering information from all connected sources. An agent without this loop can only respond based on stale context. With it, every conversation—and every moment—makes Alloomi smarter and more aligned with you.

---

## Supported Platforms (26)

| ID | Display Name | Aliases |
|----|-------------|---------|
| `telegram` | Telegram | tg |
| `whatsapp` | WhatsApp | |
| `slack` | Slack | |
| `discord` | Discord | |
| `gmail` | Gmail | google_mail |
| `outlook` | Outlook | outlook_mail |
| `linkedin` | LinkedIn | |
| `instagram` | Instagram | |
| `twitter` | X/Twitter | x, tweet, tweets, 推特 |
| `google_calendar` | Google Calendar | gcal |
| `outlook_calendar` | Outlook Calendar | |
| `teams` | Microsoft Teams | microsoft_teams |
| `facebook_messenger` | Facebook Messenger | messenger |
| `google_drive` | Google Drive | gdrive |
| `google_docs` | Google Docs | gdocs |
| `hubspot` | HubSpot | |
| `notion` | Notion | |
| `github` | GitHub | gh |
| `asana` | Asana | |
| `jira` | Jira | |
| `linear` | Linear | |
| `imessage` | iMessage | |
| `feishu` | Lark/Feishu | lark, 飞书 |
| `dingtalk` | DingTalk | 钉钉 |
| `qqbot` | QQ | qq, qq_bot |
| `weixin` | WeChat | wechat, 微信, wechat_work, wecom, 企业微信 |

---

## Authentication

The CLI auto-reads your token from `~/.alloomi/token` (base64 encoded JWT).

---

## API Endpoints

### Integration Accounts

#### GET `/api/integrations/accounts` - List Connected Accounts

Returns all connected platform accounts for the authenticated user.

```bash
curl http://localhost:3415/api/integrations/accounts \
  -H "Authorization: Bearer $TOKEN"
```

**Response:**
```json
{
  "accounts": [
    {
      "id": "int_xxx",
      "platform": "telegram",
      "externalId": "123456789",
      "displayName": "My Telegram",
      "status": "active",
      "metadata": {},
      "createdAt": "2024-01-01T00:00:00Z"
    }
  ]
}
```

---

### OAuth Start Endpoints

#### GET `/api/integrations/slack/oauth/start?userId=<userId>` - Start Slack OAuth

Returns the Slack OAuth authorization URL. The CLI opens this URL in the browser for the user to complete authorization.

```bash
curl "http://localhost:3415/api/integrations/slack/oauth/start?userId=<userId>"
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
| GitHub | `GET /api/auth/callback/github` |
| Google | `GET /api/auth/callback/google` |
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
curl -X DELETE http://localhost:3415/api/integrations/int_xxx \
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

## Platform Aliases Reference

Aliases are case-insensitive and support both English and Chinese:

| Alias | Platform |
|-------|----------|
| `tg` | telegram |
| `gh` | github |
| `gc` | gmail |
| `x` | twitter |
| `tweet`, `tweets`, `推特` | twitter |
| `gcal` | google_calendar |
| `gdrive` | google_drive |
| `gdocs` | google_docs |
| `wechat`, `微信` | weixin |
| `lark`, `飞书` | feishu |
| `钉钉` | dingtalk |
| `qq`, `qq_bot` | qqbot |

---

## CLI Script

### Quick Start

```bash
# List all supported platforms
node $SKILL_DIR/scripts/alloomi-connectors.cjs list-platforms

# List all connected accounts
node $SKILL_DIR/scripts/alloomi-connectors.cjs list-accounts

# Check connection status for a platform
node $SKILL_DIR/scripts/alloomi-connectors.cjs status telegram

# Connect a platform (opens browser for OAuth)
node $SKILL_DIR/scripts/alloomi-connectors.cjs connect slack

# Disconnect an account by ID
node $SKILL_DIR/scripts/alloomi-connectors.cjs disconnect int_xxx
```

### Commands

| Command | Description |
|---------|-------------|
| `list-platforms` | List all 26 supported platforms with IDs and aliases |
| `list-accounts` | List all connected integration accounts |
| `status <platform>` | Check if a platform is connected (e.g., telegram, slack) |
| `connect <platform> [options]` | Connect a platform (OAuth, App Password, or App Credentials) |
| `disconnect <accountId>` | Disconnect a specific account by ID |

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

**Execution Flow:**

1. **Identify intent** - connect / list / status / disconnect
2. **Resolve platform** - use alias normalization (e.g., `gh` -> `github`)
3. **Execute command** - use Bash tool
4. **Format output** - report results naturally in user's language
