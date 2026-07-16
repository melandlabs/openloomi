<div align="center">
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="apps/web/public/images/logo-text-dark.png">
  <img src="apps/web/public/images/logo-text.png" alt="OpenLoomi Logo" width="400">
</picture>

**Open-source AI coworker and workspace with a Holistic Context**

<p align="center">
<a href="./README.md">English</a> | <a href="./README-zh.md">简体中文</a> | <a href="./README-ja.md">日本語</a>
</p>

[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-4B4B4B?logo=linux&logoColor=white)](https://openloomi.ai)
[![License](https://img.shields.io/badge/License-Apache%202.0-F8D52A?logo=apache)](https://www.apache.org/licenses/LICENSE-2.0)
[![Discord](https://img.shields.io/badge/Discord-Join-5865F2?logo=discord&logoColor=white)](https://discord.com/invite/xkJaJyWcsv)
[![X](https://img.shields.io/badge/X-Follow-000000?logo=x&logoColor=white)](https://x.com/AlloomiAI)
[![Downloads](https://img.shields.io/github/downloads/melandlabs/openloomi/total?logo=github)](https://github.com/melandlabs/openloomi/releases)

</div>

---

## What is OpenLoomi?

OpenLoomi is an open-source AI coworker and workspace for builders who want local-first work memory around their AI agents. It connects your work tools and screen so AI can understand people, projects, decisions, and follow-ups before it acts with human approval.

<p align="center">
  <img src="screenshots/app/main-with-loomi.png" alt="OpenLoomi main window with Loomi" width="100%">
</p>

## Quick Start

**Download directly** (for end users):

| macOS Apple Silicon                                                                                        | macOS Intel                                                                                              | Linux AMD64                                                                                                                                                                                                         | Linux ARM64                                                                                                                                                                                                             | Windows                                                                                                    |
| ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| [.dmg](https://github.com/melandlabs/openloomi/releases/download/v0.7.8/openloomi_0.7.8_macOS_aarch64.dmg) | [.dmg](https://github.com/melandlabs/openloomi/releases/download/v0.7.8/openloomi_0.7.8_macOS_amd64.dmg) | [.deb](https://github.com/melandlabs/openloomi/releases/download/v0.7.8/openloomi_0.7.8_linux_amd64.deb) / [.rpm](https://github.com/melandlabs/openloomi/releases/download/v0.7.8/openloomi_0.7.8_linux_amd64.rpm) | [.deb](https://github.com/melandlabs/openloomi/releases/download/v0.7.8/openloomi_0.7.8_linux_aarch64.deb) / [.rpm](https://github.com/melandlabs/openloomi/releases/download/v0.7.8/openloomi_0.7.8_linux_aarch64.rpm) | [.exe](https://github.com/melandlabs/openloomi/releases/download/v0.7.8/openloomi_0.7.8_windows_amd64.exe) |

The desktop installers include `openloomi-ctl` for scripted one-shot usage from the installed app resources. See [OpenLoomi CLI](https://openloomi.ai/docs/openloomi-ctl) for bundled CLI paths, CI/CD, and `--one-shot --json` usage.

Full documentation is available at [here](https://openloomi.ai/docs).

**Develop locally** (for developers):

```bash
git clone https://github.com/melandlabs/openloomi.git
cd openloomi

pnpm install
pnpm tauri:dev
```

Requires Node.js 22+, pnpm 9+, Rust 1.75+, and on Windows: Visual Studio Build Tools with C++ workload. For more platform-specific setup requirements, see [CONTRIBUTING.md](./CONTRIBUTING.md).

## Features

|     | Capability                                                               | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 🧠  | **[Holistic Context](https://openloomi.ai/docs/memory)**                 | Short → mid → long-term memory that grows on its own — visible, auditable, and always remembering your people, projects, and decisions across months                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 🔌  | **[Platform Connectors](https://openloomi.ai/docs/connectors)**          | **[Auto-fetch](https://openloomi.ai/docs/what-is-openloomi#a-complete-intelligence-loop-from-perception-to-action)** background sync loop pulls commits, issues, emails, and docs proactively into your context graph. **[Messaging apps](https://openloomi.ai/docs/messaging-apps)** — Telegram, WhatsApp, iMessage, QQ, Lark/Feishu — let you chat with AI directly inside your existing conversations. Full list: Telegram, WhatsApp, WeChat, DingTalk, Feishu, Gmail, Google Calendar, Outlook, Google Docs, X/Twitter, Instagram, LinkedIn, Facebook Messenger, Jira, HubSpot, Asana, iMessage, QQ, RSS |
| ⏰  | **[Proactive Tasks](https://openloomi.ai/docs/automation)**              | A desktop attention agent that watches your screen and workflow — anticipates what's next, then quietly does it before you have to ask                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 🖥️  | **[Security & Ease of Use](https://openloomi.ai/docs/privacy-security)** | Native app for Windows, macOS, Linux Desktop Apps — **works out of the box**, minutes to set up, no configuration wrestling; local-first storage with IndexedDB + SQLite, AES-256 encryption, no data leaves your machine, auditable access logs                                                                                                                                                                                                                                                                                                                                                             |
| 🔗  | **[Open Sourced Skills](https://openloomi.ai/docs/skills)**              | OpenLoomi Skills are open-source and can be integrated into any Agent — Claude Code, Codex, OpenClaw, Hermes, and more.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

<p align="center">
  <img src="screenshots/components.png" alt="Architecture" width="100%">
</p>

## Why It Is Different

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
