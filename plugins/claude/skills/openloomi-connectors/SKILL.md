---
name: openloomi-connectors
description: "Manage OpenLoomi's native connector accounts: list platforms or accounts, check status, open a safe connection handoff, disconnect, query contacts, and send a reply. Trigger for native connector/account requests; pair with Composio only for Composio-managed apps."
allowed-tools: Bash(node $SKILL_DIR/scripts/openloomi-connectors.cjs *)
---

# OpenLoomi Connectors

Use the bundled client for OpenLoomi's seven native connectors. It reads the
local bearer token internally, performs a best-effort expected-response check
before sending that token, and returns structured JSON.

## Native platforms

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
handled by OpenLoomi Desktop or Composio. For an all-sources account audit,
run `list-accounts` here and the Composio connection listing in parallel,
then label and combine the results.

## Security

- Never request, print, or put connector credentials or the OpenLoomi bearer
  token in prompts or command arguments.
- If the user pastes a real credential, do not repeat it and recommend
  rotating it after redirecting setup to Desktop.
- `connect` accepts only a native platform and returns a local OpenLoomi
  Desktop handoff URL. The user completes credentials, QR, or OAuth there.
- Get explicit approval for the exact account before disconnecting.
- Get approval for the exact bot, recipients, and message before sending.
- Use account `id` for disconnect and its separate `botId` for sending.

## Commands

```bash
node $SKILL_DIR/scripts/openloomi-connectors.cjs list-platforms
node $SKILL_DIR/scripts/openloomi-connectors.cjs list-accounts
node $SKILL_DIR/scripts/openloomi-connectors.cjs status telegram
node $SKILL_DIR/scripts/openloomi-connectors.cjs connect telegram
node $SKILL_DIR/scripts/openloomi-connectors.cjs disconnect int_xxx --confirmed=true
node $SKILL_DIR/scripts/openloomi-connectors.cjs query-contacts --name=John --page=1 --pageSize=10
node $SKILL_DIR/scripts/openloomi-connectors.cjs send-reply --botId=bot_xxx --recipients=John --message="Hello" --confirmed=true
```

Never add `--password`, `--clientSecret`, `--appSecret`, or `--token`
to `connect`; secret-bearing options are rejected by design.

The client honors `OPENLOOMI_API_URL` or `OPENLOOMI_BASE_URL` when set to
an explicit loopback origin. Otherwise it probes ports 3414 and 3515.

## Workflow

- Use `list-accounts` for “what am I connected to?”
- Use `status <platform>` only for a native ID or alias.
- Use `connect <platform>`, return its `handoffUrl`, and verify with
  `status` after the user completes the Desktop flow.
- If only a platform is given for disconnect, list matching accounts and ask
  which exact account ID to remove.
- Query contacts before sending when the recipient is ambiguous; pass exact
  returned contact `name` values as recipients.
- Call a platform connected only when it has at least one `active` account.
  Expired accounts may still be listed but are not connected.
- Treat an empty, successful account list as empty. Never translate a
  transport or authentication failure into “disconnected.”

## Structured failures

| Code | Response |
| --- | --- |
| `AUTH_TOKEN_MISSING`, `AUTH_TOKEN_INVALID`, `AUTH_FAILED` | Ask the user to sign in again in OpenLoomi Desktop. |
| `LOCAL_API_UNREACHABLE` | Ask the user to start/restart OpenLoomi Desktop; do not claim connector state. |
| `SANDBOX_BLOCKED` | Report that loopback was blocked in this execution environment; use a host-side connector tool if one is available. |
| `REQUEST_OUTCOME_UNKNOWN` | A mutation may have arrived and was not retried. Verify state before retrying. |
| `API_OPERATION_FAILED` | OpenLoomi rejected the requested mutation. Report failure; do not claim it completed. |
| `INVALID_API_RESPONSE`, `API_HTTP_ERROR` | Report the safe code/message without printing token or raw secrets. |

This client can verify an unknown disconnect through a fresh account listing.
It cannot query message delivery history, so verify an unknown send in
OpenLoomi Desktop or the target conversation before retrying.
