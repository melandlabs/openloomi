<div align="center">
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="apps/web/public/images/logo-text-dark.png">
  <img src="apps/web/public/images/logo-text.png" alt="OpenLoomi Logo" width="400">
</picture>

<p align="center">
<a href="./README.md">English</a> | <a href="./README-zh.md">简体中文</a> | <a href="./README-ja.md">日本語</a>
</p>

**OpenLoomi 是一个能一直记住你的 AI。**

[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-4B4B4B?logo=linux&logoColor=white)](https://openloomi.ai)
[![License](https://img.shields.io/badge/License-Apache%202.0-F8D52A?logo=apache)](https://www.apache.org/licenses/LICENSE-2.0)
[![Discord](https://img.shields.io/badge/Discord-Join-5865F2?logo=discord&logoColor=white)](https://discord.com/invite/xkJaJyWcsv)
[![X](https://img.shields.io/badge/X-Follow-000000?logo=x&logoColor=white)](https://x.com/AlloomiAI)
[![Downloads](https://img.shields.io/github/downloads/melandlabs/openloomi/total?logo=github)](https://github.com/melandlabs/openloomi/releases)

</div>

---

## 什么是 OpenLoomi？

OpenLoomi 是一个开源的 AI 工作空间，运行在你的桌面上。它连接你已经在使用的工具和屏幕——消息应用、邮件、日历、文档、项目追踪器——并为你的人、项目和决策构建一个**全域上下文**。

<p align="center">
  <img src="screenshots/app/main-with-loomi.png" alt="OpenLoomi 主窗口与 Loomi" width="100%">
</p>

## 功能特性

|     | 功能模块                                                   | 功能说明                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🧠  | **[全域上下文](https://openloomi.ai/docs/memory)**         | 短→中→长期记忆，记忆会自己"长出来"——完全可见、可审计，始终记住你数月前的人、项目、决策                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 🔌  | **[平台连接器](https://openloomi.ai/docs/connectors)**     | **[自动获取](https://openloomi.ai/docs/what-is-openloomi#a-complete-intelligence-loop-from-perception-to-action)** 后台同步循环主动拉取代码提交、工单、邮件和文档并存入图谱。**[消息应用](https://openloomi.ai/docs/messaging-apps)** — Telegram、WhatsApp、iMessage、QQ、飞书/Feishu — 让您直接在现有对话中与 AI 聊天。完整列表：Telegram、WhatsApp、微信、钉钉、飞书、Gmail、Google Calendar、Outlook、Google Docs、X/Twitter、Instagram、LinkedIn、Facebook Messenger、Jira、HubSpot、Asana、iMessage、QQ、RSS |
| ⏰  | **[主动任务](https://openloomi.ai/docs/automation)**       | 桌面注意力代理，时刻观察你的屏幕和工作流——预判下一步，在你开口前就悄悄把事办好                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 🖥️  | **[安全便捷](https://openloomi.ai/docs/privacy-security)** | Windows、macOS、Linux 原生桌面应用 — **开箱即用**，安装几分钟就能开始工作，不需要折腾配置；本地优先存储（IndexedDB + SQLite），AES-256 加密，数据不离开你的设备，访问日志可审计                                                                                                                                                                                                                                                                                                                                   |
| 🔗  | **[开源 Skills](https://openloomi.ai/docs/skills)**        | OpenLoomi Skills 完全开源，可集成到任何 AI Agent — Claude Code、Codex、OpenClaw、Hermes 等                                                                                                                                                                                                                                                                                                                                                                                                                        |

<p align="center">
  <img src="screenshots/components.png" alt="Architecture" width="100%">
</p>

## 快速开始

**直接下载**（面向终端用户）：

| macOS Apple Silicon                                                                                        | macOS Intel                                                                                              | Linux AMD64                                                                                                                                                                                                         | Linux ARM64                                                                                                                                                                                                             | Windows                                                                                                    |
| ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| [.dmg](https://github.com/melandlabs/openloomi/releases/download/v0.7.8/openloomi_0.7.8_macOS_aarch64.dmg) | [.dmg](https://github.com/melandlabs/openloomi/releases/download/v0.7.8/openloomi_0.7.8_macOS_amd64.dmg) | [.deb](https://github.com/melandlabs/openloomi/releases/download/v0.7.8/openloomi_0.7.8_linux_amd64.deb) / [.rpm](https://github.com/melandlabs/openloomi/releases/download/v0.7.8/openloomi_0.7.8_linux_amd64.rpm) | [.deb](https://github.com/melandlabs/openloomi/releases/download/v0.7.8/openloomi_0.7.8_linux_aarch64.deb) / [.rpm](https://github.com/melandlabs/openloomi/releases/download/v0.7.8/openloomi_0.7.8_linux_aarch64.rpm) | [.exe](https://github.com/melandlabs/openloomi/releases/download/v0.7.8/openloomi_0.7.8_windows_amd64.exe) |

完整文档请访问[这里](https://openloomi.ai/docs)。

**本地开发**（面向开发者）：

```bash
git clone https://github.com/melandlabs/openloomi.git
cd openloomi

pnpm install
pnpm tauri:dev
```

需要 Node.js 22+、pnpm 9+ 和 Rust 1.75+，Windows 还需要 Visual Studio Build Tools with C++ workload。更多平台特定设置要求请参见 [CONTRIBUTING.md](./CONTRIBUTING.md)。

## 它有何不同

| 与…相比                | OpenLoomi 的优势                                                                   |
| ---------------------- | ---------------------------------------------------------------------------------- |
| Claude Cowork 类 Agent | 开源的、本地优先的 AI 同事与工作空间，支持来源证据和审批                           |
| Codex / Claude Code    | 超出仓库的工作空间上下文：人、产品决策、发布背景、问题和待跟进事项                 |
| OpenClaw / Hermes      | 操作前后的上下文：该操作为什么重要、使用了哪些来源、发生了什么改变、还有什么待解决 |
| RAG / 知识库           | 工作状态，而不仅仅是文档检索：发生了什么改变、什么仍然有效、下一步操作应该考虑什么 |

## 应用截图

<table>
<tr>
<td><img src="screenshots/app/loomi-pet.gif" alt="Loomi 宠物" width="100%"></td>
<td><img src="screenshots/app/loomi-proactive-task.gif" alt="主动任务" width="100%"></td>
</tr>
<tr>
<td><img src="screenshots/app/docx.gif" alt="文档预览" width="100%"></td>
<td><img src="screenshots/app/excel.gif" alt="表格预览" width="100%"></td>
</tr>
<tr>
<td><img src="screenshots/app/automation.gif" alt="自动化" width="100%"></td>
<td><img src="screenshots/app/connectors.gif" alt="连接器" width="100%"></td>
</tr>
</table>

## 反馈

这是早期阶段的软件。我们正在寻找愿意实际安装使用、连接工具并告诉我们问题所在的人。

- [GitHub Issues](https://github.com/melandlabs/openloomi/issues) — 报告 bug、安装问题、功能请求
- [Discord](https://discord.com/invite/xkJaJyWcsv) — 讨论、提问、帮助
- [Email](mailto:developer@alloomi.ai) — 其他事宜

## 贡献代码

参见 [CONTRIBUTING.md](./CONTRIBUTING.md)。可以关注 [`good first issue`](https://github.com/melandlabs/openloomi/labels/good%20first%20issue) 标签。

## 开源协议

[Apache 2.0](./LICENSE)
