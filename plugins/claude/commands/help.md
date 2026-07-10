---
description: List all /openloomi:* commands
argument-hint: ""
---

# /openloomi:help

Static reference. Lists all slash commands in the `openloomi:` namespace.

| Command                                         | Purpose                                                    |
| ----------------------------------------------- | ---------------------------------------------------------- |
| `/openloomi:setup`                              | One-time setup wizard (discover → install → sync → status) |
| `/openloomi:status`                             | Stable JSON status                                         |
| `/openloomi:pet <state>`                        | Set the Loomi Pet state                                    |
| `/openloomi:usage`                              | Today's LLM usage summary                                  |
| `/openloomi:connect`                            | Walk through composio + screen memory (opt-in)             |
| `/openloomi:hooks [install\|uninstall\|status]` | Manage the optional hook bundle                            |
| `/openloomi:help`                               | This help                                                  |

None of these commands log, print, or send `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN`.
The plugin reads those env vars locally during `sync-claude-env` only.
