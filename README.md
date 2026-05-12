<div align="center">
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="apps/web/public/images/logo-dark-light.svg">
  <img src="apps/web/public/images/logo-full-light.svg" alt="Alloomi Logo" width="400">
</picture>

<br>

**Your AI Mates that Remembers All Work Details.**

<br>

[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-4B4B4B?logo=linux&logoColor=white)](https://alloomi.ai)
[![License](https://img.shields.io/badge/License-Apache%202.0-F8D52A?logo=apache)](https://www.apache.org/licenses/LICENSE-2.0)
[![Discord](https://img.shields.io/badge/Discord-Join-5865F2?logo=discord&logoColor=white)](https://discord.com/invite/xkJaJyWcsv)
[![X](https://img.shields.io/badge/X-Follow-000000?logo=x&logoColor=white)](https://x.com/AlloomiAI)

</div>

---

## What is Alloomi?

Alloomi is an open-source AI workspace that runs on your desktop. It connects to the tools you already use — messaging apps, email, calendar, documents, project trackers — and builds a working memory of your people, projects, and decisions.

### Download to Try

 <a href="https://github.com/melandlabs/release">
    <img src="https://img.shields.io/github/v/tag/melandlabs/release?logo=github&label=Download&color=24C8D5" alt="Download" height="30" style="transform:scale(1);">
  </a>

## Features

|     | Capability                 | What it does                                                                                                                                                                                                                                                                     |
| --- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🔌  | **18 Platform Connectors** | Telegram, WhatsApp, WeChat, DingTalk, Feishu, Gmail, Google Calendar, Outlook, Google Docs, X/Twitter, Instagram, LinkedIn, Facebook Messenger, Jira, HubSpot, Asana, iMessage, QQ, RSS — messages, emails, calendar events, documents, and project updates flow in continuously |
| 🧠  | **Working Memory**         | Short → mid → long-term memory with a progressive forgetting engine — scores by access frequency, recency, and importance, summarizes and archives over time, recalls context from months ago                                                                                    |
| 📄  | **Document Skills**        | Create and edit DOCX, XLSX, PPTX, PDF — with formulas, formatting, tracked changes, OCR, and merge/split                                                                                                                                                                         |
| ⏰  | **Automation**             | Scheduled jobs with cron expressions, intervals, or one-time triggers — agent-driven execution with timeout recovery and history                                                                                                                                                 |
| 🖥️  | **Desktop App**            | Native app for Windows, macOS, Linux via Tauri — local-first storage with IndexedDB + SQLite, AES-256 encryption, no data leaves your machine                                                                                                                                    |

<p align="center">
  <img src="screenshots/components.png" alt="Architecture" width="100%">
</p>

## Quick Start

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

Requires Node.js 22+ and pnpm 9+.

## Project Structure

```
alloomi/
├── apps/web/          # Desktop app (Tauri + Next.js)
├── packages/
│   ├── ai/            # Agent, memory, RAG, model routing
│   ├── integrations/  # 18 platform connectors
│   ├── insights/      # EventRank scoring, focus classification
│   ├── agent/         # Multi-provider agent SDK
│   ├── storage/       # Local + cloud storage
│   └── search/        # Brave Search integration
└── skills/            # PDF, DOCX, XLSX, PPTX, browser automation, web search
```

## Screenshots

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

- Local-first: data stored on your machine via IndexedDB + SQLite
- AES-256 encryption for stored data
- No training on your data — ever
- Hardware-isolated processing, no public gateways

## Feedback

This is early-stage software. We're looking for people who'll actually install it, connect their tools, and tell us what's broken.

- [GitHub Issues](https://github.com/melandlabs/openloomi/issues) — bugs, install problems, feature requests
- [Discord](https://discord.com/invite/xkJaJyWcsv) — discussion, questions, help
- [Email](mailto:developer@alloomi.ai) — anything else

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). Look for [`good first issue`](https://github.com/melandlabs/openloomi/labels/good%20first%20issue) labels.

## License

[Apache 2.0](./LICENSE)
