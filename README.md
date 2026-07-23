<div align="center">
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="apps/web/public/images/logo-text-dark.png">
  <img src="apps/web/public/images/logo-text.png" alt="OpenLoomi Logo" width="400">
</picture>

**Open-source AI coworker, built to protect your attention**

<p align="center">
<a href="./README.md">English</a> | <a href="./README-zh.md">简体中文</a> | <a href="./README-ja.md">日本語</a>
</p>

[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-4B4B4B?logo=linux&logoColor=white)](https://openloomi.ai)
[![License](https://img.shields.io/badge/License-Apache%202.0-F8D52A?logo=apache)](https://www.apache.org/licenses/LICENSE-2.0)
[![Discord](https://img.shields.io/badge/Discord-Join-5865F2?logo=discord&logoColor=white)](https://discord.com/invite/xkJaJyWcsv)
[![X](https://img.shields.io/badge/X-Follow-000000?logo=x&logoColor=white)](https://x.com/AlloomiAI)
[![Downloads](https://img.shields.io/github/downloads/melandlabs/openloomi/total?logo=github)](https://github.com/melandlabs/openloomi/releases)

</div>

<div align="center">

⭐ **If you find OpenLoomi useful, please consider giving us a star on GitHub!** It helps more people discover the project and motivates us to keep building. 🙏

[![GitHub Repo stars](https://img.shields.io/github/stars/melandlabs/openloomi?style=social&label=Star)](https://github.com/melandlabs/openloomi)

</div>

---

## What is OpenLoomi?

Your work is scattered across apps. OpenLoomi connects the tools you use and, with your permission, understands what’s on your screen. It brings together the context behind your people, projects, and decisions, then surfaces only what needs your decision or action.

**Focus on what matters. This is your Attention Agent.**

<p align="center">
  <img src="screenshots/app/main-with-loomi.png" alt="OpenLoomi main window with Loomi" width="100%">
</p>

## What is it for?

An always-on desktop **attention agent** — the friendly desk companion Loomi — watches the door so you don't have to, and turns the day's scattered signals into decision cards you can approve in one tap. Use it standalone, or plug any Agent framework into the same resident desktop: Claude Code, Codex, OpenCode, Hermes, and OpenClaw all work.

- **Stop dropping commitments.** Overdue replies, creeping deadlines, "I'll send that follow-up Friday" — Loomi nudges you with a small bubble at the right moment, and you can teach it the signals and decisions to watch for.
- **Find anything from your work life in seconds.** "What did I decide about pricing last quarter?", "Who owns design on Acorn?", "What was I working on before vacation?" — memory spans every tool and channel, no more digging through Slack, Gmail, or Notion.
- **Morning brief at 9 AM, end-of-day recap at 6 PM.** Today's to-do slides into view every morning, today's done ships every evening — the key info lives in one place instead of nine apps.
- **Ask AI for work help right inside your chat.** Draft a reply, summarize a long thread, schedule a follow-up — directly in Telegram, WhatsApp, iMessage, QQ, or Lark/Feishu.

→ Learn more about the always-on companion in the [Attention Agent docs](https://openloomi.ai/docs/attention-agent) and [Use cases](https://openloomi.ai/docs/use-cases).

## Features

|     | Capability                                                                      | What it does                                                                                                                                                                                                                                                                                                                                                                                              |
| --- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🐾  | **[Attention Agent](https://openloomi.ai/docs/attention-agent)**                | An always-on desktop companion (Loomi) that surfaces pre-decided reminders — 9 AM to-do, 6 PM recap, overdue replies — as small bubbles, without fighting for your focus.                                                                                                                                                                                                                                 |
| 🧠  | **[Holistic Context](https://openloomi.ai/docs/memory)**                        | Short → mid → long-term memory that grows on its own — visible, auditable, and always remembering your people, projects, and decisions across months                                                                                                                                                                                                                                                      |
| 🔌  | **[Platform Connectors](https://openloomi.ai/docs/connectors)**                 | **[Auto-fetch](https://openloomi.ai/docs/what-is-openloomi#a-complete-intelligence-loop-from-perception-to-action)** background sync loop pulls commits, issues, emails, and docs proactively into your context graph. **[Messaging apps](https://openloomi.ai/docs/messaging-apps)** — Telegram, WhatsApp, iMessage, QQ, Lark/Feishu — let you chat with AI directly inside your existing conversations. |
| ⏰  | **[Proactive Tasks](https://openloomi.ai/docs/automation)**                     | Schedule recurring work — daily digests, weekly reports, reminders — that run automatically on your desktop.                                                                                                                                                                                                                                                                                              |
| 🖥️  | **[Security & Ease of Use](https://openloomi.ai/docs/privacy-security)**        | Native app for Windows, macOS, Linux Desktop Apps — **works out of the box**, minutes to set up, no configuration wrestling; local-first storage, AES-256 encryption, no data leaves your machine, auditable access logs                                                                                                                                                                                  |
| 🧩  | **[Any Agent Integration](https://openloomi.ai/docs/reference/agent-runtimes)** | OpenLoomi's context, memory, connectors, attention agent, and Loop engine are all delivered as open-source [Skills](https://openloomi.ai/docs/skills) and [Plugins](https://openloomi.ai/docs/plugins). Use OpenLoomi Desktop directly, or plug into your existing Agent — Claude, Codex, OpenCode, Hermes, or OpenClaw.                                                                                  |

## Quick Start

**Download directly** (for end users):

| macOS Apple Silicon                                                                                        | macOS Intel                                                                                              | Linux AMD64                                                                                                                                                                                                         | Linux ARM64                                                                                                                                                                                                             | Windows                                                                                                    |
| ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| [.dmg](https://github.com/melandlabs/openloomi/releases/download/v0.8.7/openloomi_0.8.7_macOS_aarch64.dmg) | [.dmg](https://github.com/melandlabs/openloomi/releases/download/v0.8.7/openloomi_0.8.7_macOS_amd64.dmg) | [.deb](https://github.com/melandlabs/openloomi/releases/download/v0.8.7/openloomi_0.8.7_linux_amd64.deb) / [.rpm](https://github.com/melandlabs/openloomi/releases/download/v0.8.7/openloomi_0.8.7_linux_amd64.rpm) | [.deb](https://github.com/melandlabs/openloomi/releases/download/v0.8.7/openloomi_0.8.7_linux_aarch64.deb) / [.rpm](https://github.com/melandlabs/openloomi/releases/download/v0.8.7/openloomi_0.8.7_linux_aarch64.rpm) | [.exe](https://github.com/melandlabs/openloomi/releases/download/v0.8.7/openloomi_0.8.7_windows_amd64.exe) |

Full documentation: [openloomi.ai/docs](https://openloomi.ai/docs)

**Use as an Agent plugin** (for Claude Code / Codex users):

OpenLoomi ships official marketplace plugins that turn your existing agent into a front-end for the local OpenLoomi runtime.

| Agent       | Install                                                                                   | First-run setup                   |
| ----------- | ----------------------------------------------------------------------------------------- | --------------------------------- |
| Claude Code | `/plugin marketplace add melandlabs/plugins`<br>`/plugin install openloomi`               | `/openloomi:setup`                |
| Codex CLI   | `codex plugin marketplace add melandlabs/plugins && codex plugin add openloomi@openloomi` | `@OpenLoomi Run first-use setup.` |

The slim public marketplace lives at [`melandlabs/plugins`](https://github.com/melandlabs/plugins) so adding it only fetches the plugin payloads. See the plugin docs for full reference: [`plugins/claude`](https://openloomi.ai/docs/plugins/claude) · [`plugins/codex`](https://openloomi.ai/docs/plugins/codex).

**Develop locally** (for developers):

```bash
git clone https://github.com/melandlabs/openloomi.git
cd openloomi

pnpm install
pnpm tauri:dev
```

Requires Node.js 22+, pnpm 9+, Rust 1.75+, and on Windows: Visual Studio Build Tools with C++ workload. For more platform-specific setup requirements, see [CONTRIBUTING.md](./CONTRIBUTING.md).

## Why It Is Different

**OpenLoomi is open-source and neutral.** Instead of locking you into a single vendor's agent, it integrates with any Agent Runtime — Claude Code, Codex, OpenCode, Hermes, OpenClaw — and brings a shared, cross-agent layer to all of them: a resident desktop **attention agent**, **holistic context memory**, **platform connectors**, and **proactive tasks**. Whichever agent you run, OpenLoomi watches the door, remembers what matters, and surfaces only the decisions worth your time — so you spend your attention on the work, not on chasing it.

| Compared with...           | OpenLoomi adds                                                                                                    |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Claude Cowork-style agents | an open-source, local-first AI coworker and workspace with source evidence and approval                           |
| Codex / Claude Code        | workspace context beyond the repo: people, product decisions, launch context, issues, and follow-ups              |
| OpenClaw / Hermes          | context before and after the action: why it matters, what source was used, what changed, what remains open        |
| RAG / knowledge bases      | work state, not just document retrieval: what changed, what is still true, and what should affect the next action |

## App Screenshots

<table>
<tr>
<td><img src="screenshots/app/loomi-pet.gif" alt="Loomi Pet" width="100%"></td>
<td><img src="screenshots/app/loomi-proactive-task.gif" alt="Proactive Tasks" width="100%"></td>
</tr>
<tr>
<td><img src="screenshots/app/docx.gif" alt="Document preview" width="100%"></td>
<td><img src="screenshots/app/excel.gif" alt="Spreadsheet preview" width="100%"></td>
</tr>
<tr>
<td><img src="screenshots/app/automation.gif" alt="Automation" width="100%"></td>
<td><img src="screenshots/app/connectors.gif" alt="Connectors" width="100%"></td>
</tr>
</table>

## Feedback

This is early-stage software. We're looking for people who'll actually install it, connect their tools, and tell us what's broken.

- [GitHub Issues](https://github.com/melandlabs/openloomi/issues) — bugs, install problems, feature requests
- [Discord](https://discord.com/invite/xkJaJyWcsv) — discussion, questions, help
- [Email](mailto:developer@alloomi.ai) — anything else

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). Look for [`good first issue`](https://github.com/melandlabs/openloomi/labels/good%20first%20issue) labels.

## License

[Apache 2.0](./LICENSE)
