<div align="center">
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="apps/web/public/images/logo-text-dark.png">
  <img src="apps/web/public/images/logo-text.png" alt="OpenLoomi Logo" width="400">
</picture>

**An AI That Always Remembers You.**

<p align="center">
<a href="./README.md">English</a> | <a href="./README-zh.md">简体中文</a>
</p>

[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-4B4B4B?logo=linux&logoColor=white)](https://openloomi.ai)
[![License](https://img.shields.io/badge/License-Apache%202.0-F8D52A?logo=apache)](https://www.apache.org/licenses/LICENSE-2.0)
[![Discord](https://img.shields.io/badge/Discord-Join-5865F2?logo=discord&logoColor=white)](https://discord.com/invite/xkJaJyWcsv)
[![X](https://img.shields.io/badge/X-Follow-000000?logo=x&logoColor=white)](https://x.com/AlloomiAI)

</div>

---

## What is OpenLoomi?

OpenLoomi is an open-source AI workspace that runs on your desktop. It connects to the tools you already use — messaging apps, email, calendar, documents, project trackers — and builds a **Holistic Context Graph** of your people, projects, and decisions.

## Features

|     | Capability                                                               | What it does                                                                                                                                                                                                                                                                     |
| --- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🧠  | **[Holistic Context Graph](https://openloomi.ai/docs/memory)**           | Short → mid → long-term memory that grows on its own — visible, auditable, and always remembering your people, projects, and decisions across months                                                                                                                             |
| 🔌  | **[Platform Connectors](https://openloomi.ai/docs/connectors)**          | Telegram, WhatsApp, WeChat, DingTalk, Feishu, Gmail, Google Calendar, Outlook, Google Docs, X/Twitter, Instagram, LinkedIn, Facebook Messenger, Jira, HubSpot, Asana, iMessage, QQ, RSS — messages, emails, calendar events, documents, and project updates flow in continuously |
| ⏰  | **[Proactive Tasks](https://openloomi.ai/docs/automation)**              | Intelligent task execution that anticipates your needs — not just scheduled automation, but context-aware actions that happen at the right moment                                                                                                                                |
| 🖥️  | **[Security & Ease of Use](https://openloomi.ai/docs/privacy-security)** | Native app for Windows, macOS, Linux Desktop Apps — **works out of the box**, minutes to set up, no configuration wrestling; local-first storage with IndexedDB + SQLite, AES-256 encryption, no data leaves your machine, auditable access logs                                 |
| 🔗  | **[Open Sourced Skills](https://openloomi.ai/docs/skills)**              | OpenLoomi Skills are open-source and can be integrated into any Agent — Claude Code, Codex, OpenClaw, Hermes, and more.                                                                                                                                                          |

<p align="center">
  <img src="screenshots/components.png" alt="Architecture" width="100%">
</p>

## Benchmarks

OpenLoomi's memory system is rigorously evaluated against academic and industry benchmarks:

| Benchmark                                                                                   | Metric              | Result    |
| ------------------------------------------------------------------------------------------- | ------------------- | --------- |
| [LoCoMo](https://github.com/melandlabs/openloomi/tree/main/benchmark/locomo)                | End-to-end accuracy | **96.3%** |
| [LongMemEval-S500](https://github.com/melandlabs/openloomi/tree/main/benchmark/longmemeval) | End-to-end accuracy | **97.6%** |

Full benchmark details: [https://openloomi.ai/docs/benchmark](https://openloomi.ai/docs/benchmark)

## Quick Start

**Download directly** (for end users):

| macOS Apple Silicon                                                                                        | macOS Intel                                                                                              | Linux AMD64                                                                                              | Linux ARM64                                                                                                | Windows                                                                                                    |
| ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| [.dmg](https://github.com/melandlabs/openloomi/releases/download/v0.5.0/openloomi_0.5.0_macOS_aarch64.dmg) | [.dmg](https://github.com/melandlabs/openloomi/releases/download/v0.5.0/openloomi_0.5.0_macOS_amd64.dmg) | [.deb](https://github.com/melandlabs/openloomi/releases/download/v0.5.0/openloomi_0.5.0_linux_amd64.deb) | [.deb](https://github.com/melandlabs/openloomi/releases/download/v0.5.0/openloomi_0.5.0_linux_aarch64.deb) | [.exe](https://github.com/melandlabs/openloomi/releases/download/v0.5.0/openloomi_0.5.0_windows_amd64.exe) |

Full documentation is available at [here](https://openloomi.ai/docs).

**Develop locally** (for developers):

```bash
git clone https://github.com/melandlabs/openloomi.git
cd openloomi

cp apps/web/.env.example apps/web/.env

# Set your AI provider keys in .env:
#   ANTHROPIC_API_KEY=sk-ant-...
#   LLM_API_KEY=sk-...

pnpm install
pnpm tauri:dev
```

Requires Node.js 22+, pnpm 9+, and Rust 1.75+.

For local Transformers.js embeddings and configurable `sqlite-vec` or ChromaDB
storage, see [Local Embeddings and Vector Backends](./docs/vector-backends.md).

## App Screenshots

<table>
<tr>
<td><img src="screenshots/app/docx.gif" alt="Document preview" width="100%"></td>
<td><img src="screenshots/app/excel.gif" alt="Spreadsheet preview" width="100%"></td>
</tr>
<tr>
<td><img src="screenshots/app/automation.gif" alt="Automation" width="100%"></td>
<td><img src="screenshots/app/connectors.gif" alt="Connectors" width="100%"></td>
</tr>
</table>

## Security

- **Local-first**: works offline, no data sent to external servers
- **Auditable**: you can see and audit exactly when and why data is accessed
- **AES-256 encryption** for stored data
- **Hardware-isolated processing, no public gateways**

## Feedback

This is early-stage software. We're looking for people who'll actually install it, connect their tools, and tell us what's broken.

- [GitHub Issues](https://github.com/melandlabs/openloomi/issues) — bugs, install problems, feature requests
- [Discord](https://discord.com/invite/xkJaJyWcsv) — discussion, questions, help
- [Email](mailto:developer@alloomi.ai) — anything else

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). Look for [`good first issue`](https://github.com/melandlabs/openloomi/labels/good%20first%20issue) labels.

## License

[Apache 2.0](./LICENSE)
