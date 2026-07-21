---
name: openloomi-connectors
description: "Manage OpenLoomi's native connector accounts: list platforms or accounts, check status, open a safe connection handoff, disconnect, query contacts, and send a reply. Trigger for native OpenLoomi connector/account questions; pair with Composio only when the user also asks about Composio-managed apps."
---

# OpenLoomi Connectors

Use OpenLoomi's host-side MCP tools for native connector work. They reach the
local Desktop API without asking a shell command inside Codex's sandbox to
cross the host loopback boundary.

## Execution order

1. Use the `openloomi` MCP server first:

   | Intent | Tool |
   | --- | --- |
   | List native platforms | `mcp__openloomi__list_platforms` |
   | List connected native accounts | `mcp__openloomi__list_accounts` |
   | Check one native platform | `mcp__openloomi__connector_status` |
   | Start a connection | `mcp__openloomi__connect` |
   | Disconnect an account | `mcp__openloomi__disconnect` |
   | Find contacts | `mcp__openloomi__query_contacts` |
   | Send a message | `mcp__openloomi__send_reply` |

2. Use the bundled CLI only when those MCP tools are unavailable. The CLI is a
   compatibility path, not the preferred Codex transport.
3. Report the structured result. Never infer "disconnected" from a transport
   error.

Do not ask for an out-of-sandbox retry. OpenLoomi launches Codex through
non-interactive `codex exec`, so an interactive escalation cannot be serviced.
The host-side MCP transport is the automatic path; it does not enable network
access for model-generated shell commands.

## Native platforms

This skill covers exactly seven native platforms:

| ID | Name | Aliases |
| --- | --- | --- |
| `telegram` | Telegram | `tg` |
| `whatsapp` | WhatsApp | — |
| `imessage` | iMessage | — |
| `feishu` | Lark/Feishu | `lark`, `飞书` |
| `dingtalk` | DingTalk | `钉钉` |
| `qqbot` | QQ | `qq`, `qq_bot` |
| `weixin` | WeChat | `wechat`, `微信`, `wechat_work`, `wecom`, `企业微信` |

Slack, Gmail, Outlook, GitHub, Notion, Linear, and other non-native apps are
handled by OpenLoomi Desktop or Composio. Do not pass those names to
`connector_status` and present an "unknown native platform" response as a
connection result.

When the user asks for every linked account across OpenLoomi and Composio, run
`list_accounts` here and the Composio connection listing in parallel, then
label and combine the two sources. A Composio success is not a substitute for
a failed native OpenLoomi lookup.

## Security and confirmation

- Never request, print, or place OAuth tokens, app passwords, client secrets,
  app secrets, iLink tokens, or the OpenLoomi bearer token in prompts or argv.
  If the user pastes a real credential, do not repeat it and recommend rotating
  it after redirecting setup to Desktop.
- `connect` accepts only a native platform name. It returns a local OpenLoomi
  Desktop URL; the user enters credentials or completes QR/OAuth interaction
  there.
- Call `disconnect` with `confirmed: true` only after the user has identified
  and approved the exact account.
- Call `send_reply` with `confirmed: true` only when the user has approved the
  exact sender bot, recipients, and message. A direct request containing all
  of those details counts as approval; otherwise show the draft first.
- Use the account `id` for disconnect. Use its separate `botId` for sending.

## Core workflows

### List or check status

- Use `list_accounts` for "what am I connected to?".
- Use `connector_status` for one of the native platform IDs or aliases.
- Treat an empty, successfully returned `accounts` array as "no native
  accounts". `connected: true` means at least one matching account is
  `active`; expired accounts remain visible but are not called connected. Do
  not treat an API error as an empty list.

### Connect

Call `connect` with only `platform`. Return its `handoffUrl` as a
clickable local link and explain that completion happens inside OpenLoomi.
After the user completes the UI flow, re-run `connector_status` to verify it.

### Disconnect

If the user gave only a platform name, call `list_accounts`, show matching
account IDs/display names, and ask which account to remove. Then call
`disconnect` once with the approved `accountId` and `confirmed: true`.

### Query contacts and send

Use `query_contacts` to resolve ambiguous recipients. Before sending, make
sure the selected account exposes a `botId`; pass the exact returned contact
`name` values as `recipients`. Do not automatically retry a send whose result
is reported as unknown. This tool set cannot query message delivery history,
so verify an unknown send in OpenLoomi Desktop or the target conversation.

## Structured failures

Handle client error codes as follows:

| Code | Response |
| --- | --- |
| `AUTH_TOKEN_MISSING`, `AUTH_TOKEN_INVALID`, `AUTH_FAILED` | Ask the user to sign in again in OpenLoomi Desktop. Do not expose token contents. |
| `LOCAL_API_UNREACHABLE` | Say the local API could not be verified; ask the user to start/restart OpenLoomi Desktop. Do not claim accounts are disconnected. |
| `SANDBOX_BLOCKED` | The CLI fallback was sandboxed. Retry with the MCP tool if present; do not promise an unavailable interactive escalation. |
| `REQUEST_OUTCOME_UNKNOWN` | Explain that a mutating request may have arrived and was deliberately not retried. Verify account/message state before any retry. |
| `API_OPERATION_FAILED` | OpenLoomi safely rejected the requested send/disconnect. Report failure; never claim the action completed. |
| `AUTH_TOKEN_UNREADABLE`, `INVALID_API_RESPONSE`, `API_HTTP_ERROR` | Report the safe message/code and the suggested local-app action. Never print raw token data. |

## CLI compatibility path

The script reads the base64-encoded local token internally. It supports
`OPENLOOMI_API_URL` or `OPENLOOMI_BASE_URL` for an explicit loopback origin and
otherwise probes ports 3414 and 3515.

```bash
node $SKILL_DIR/scripts/openloomi-connectors.cjs list-platforms
node $SKILL_DIR/scripts/openloomi-connectors.cjs list-accounts
node $SKILL_DIR/scripts/openloomi-connectors.cjs status telegram
node $SKILL_DIR/scripts/openloomi-connectors.cjs connect telegram
node $SKILL_DIR/scripts/openloomi-connectors.cjs disconnect int_xxx --confirmed=true
node $SKILL_DIR/scripts/openloomi-connectors.cjs query-contacts --name=John --page=1 --pageSize=10
node $SKILL_DIR/scripts/openloomi-connectors.cjs send-reply --botId=bot_xxx --recipients=John --message="Hello" --confirmed=true
```

Never append credential options to `connect`; the client rejects them by
design.
