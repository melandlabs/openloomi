<div align="center">
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="apps/web/public/images/logo-text-dark.png">
  <img src="apps/web/public/images/logo-text.png" alt="OpenLoomi Logo" width="400">
</picture>

<p align="center">
<a href="./README.md">English</a> | <a href="./README-zh.md">简体中文</a> | <a href="./README-ja.md">日本語</a>
</p>

**开源 AI 伙伴，由注意力代理驱动**

[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-4B4B4B?logo=linux&logoColor=white)](https://openloomi.ai)
[![License](https://img.shields.io/badge/License-Apache%202.0-F8D52A?logo=apache)](https://www.apache.org/licenses/LICENSE-2.0)
[![Discord](https://img.shields.io/badge/Discord-Join-5865F2?logo=discord&logoColor=white)](https://discord.com/invite/xkJaJyWcsv)
[![X](https://img.shields.io/badge/X-Follow-000000?logo=x&logoColor=white)](https://x.com/AlloomiAI)
[![Downloads](https://img.shields.io/github/downloads/melandlabs/openloomi/total?logo=github)](https://github.com/melandlabs/openloomi/releases)

</div>

<div align="center">

⭐ **如果觉得 OpenLoomi 有用，欢迎在 GitHub 上给我们点个 star！** 这能帮助更多人发现这个项目，也是我们持续开发的动力。🙏

[![GitHub Repo stars](https://img.shields.io/github/stars/melandlabs/openloomi?style=social&label=Star)](https://github.com/melandlabs/openloomi)

</div>

---

## 什么是 OpenLoomi？

OpenLoomi 是一个开源 AI 伙伴。它以桌面**注意力代理**为核心，连接你授权的工作工具和屏幕内容，为你的人、项目和决策构建一个**全域上下文**，并告诉你发生了什么、为什么重要、下一步建议做什么以及每日总结，帮助你节省注意力。

<p align="center">
  <img src="screenshots/app/main-with-loomi.png" alt="OpenLoomi 主窗口与 Loomi" width="100%">
</p>

## 它能做什么？

桌面常驻的 **注意力代理** —— 友好的桌面伙伴 Loomi —— 帮你盯着门外，把一天里散落在各处的信号整理成可以一键批准的决策卡。可以单独使用，也支持把任意 Agent 框架接入同一个常驻桌面：Claude Code、Codex、OpenCode、Hermes、OpenClaw 都可以。

- **再也不会忘工作琐事。** 拖延未回的消息、临近截止的任务、"周五再跟进"——Loomi 会在合适的时刻用一个小气泡轻轻提醒你，并且你可以轻松自定义它监测哪些信号、输出哪些决策。
- **一秒找回工作记忆。** "上季度定价我最后怎么定的？""Acorn 设计是谁？""我休假前在干嘛？"——记忆跨工具、跨渠道，不必再翻 Slack、Gmail、Notion。
- **早 9 点待办、晚 6 点回顾。** 每天 9 点把今天的待办送到你眼前，每天 6 点把今天完成的事项汇总好——关键信息一次看完，不必来回切换十几个应用。
- **在常用的聊天 App 里直接让 AI 帮忙。** 起草回复、总结长 thread、安排 follow-up——Telegram、WhatsApp、iMessage、QQ、飞书都行。

→ 想深入了解这位常驻伙伴，可以看 [注意力代理文档](https://openloomi.ai/docs/attention-agent) 和 [使用场景](https://openloomi.ai/docs/use-cases)。

## 功能特性

|     | 功能模块                                                                  | 功能说明                                                                                                                                                                                                                                                                                                                 |
| --- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 🐾  | **[注意力代理](https://openloomi.ai/docs/attention-agent)**               | 桌面常驻伙伴 Loomi，用气泡提醒已决策的事项——早 9 点待办、晚 6 点回顾、超时未回——不打断专注。                                                                                                                                                                                                                             |
| 🧠  | **[全域上下文](https://openloomi.ai/docs/memory)**                        | 短→中→长期记忆，记忆会自己"长出来"——完全可见、可审计，始终记住你数月前的人、项目、决策                                                                                                                                                                                                                                   |
| 🔌  | **[平台连接器](https://openloomi.ai/docs/connectors)**                    | **[自动获取](https://openloomi.ai/docs/what-is-openloomi#a-complete-intelligence-loop-from-perception-to-action)** 后台同步循环主动拉取代码提交、工单、邮件和文档并存入图谱。**[消息应用](https://openloomi.ai/docs/messaging-apps)** — Telegram、WhatsApp、iMessage、QQ、飞书/Feishu — 让您直接在现有对话中与 AI 聊天。 |
| ⏰  | **[主动任务](https://openloomi.ai/docs/automation)**                      | 定时自动执行重复工作——每日摘要、每周报告、提醒——在桌面端按计划运行。                                                                                                                                                                                                                                                     |
| 🖥️  | **[安全便捷](https://openloomi.ai/docs/privacy-security)**                | Windows、macOS、Linux 原生桌面应用 — **开箱即用**，安装几分钟就能开始工作，不需要折腾配置；本地优先存储，AES-256 加密，数据不离开你的设备，访问日志可审计                                                                                                                                                                |
| 🧩  | **[任意 Agent 集成](https://openloomi.ai/docs/reference/agent-runtimes)** | OpenLoomi 的上下文、记忆、连接器、注意力代理与 Loop 工作引擎都以开源 [技能](https://openloomi.ai/docs/skills) 和[插件](https://openloomi.ai/docs/plugins) 形式交付。可以直接用 OpenLoomi Desktop, 也可以接入现有 Agent — Claude、Codex、OpenCode、Hermes 或 OpenClaw                                                     |

## 快速开始

**直接下载**（面向终端用户）：

| macOS Apple Silicon                                                                                        | macOS Intel                                                                                              | Linux AMD64                                                                                                                                                                                                         | Linux ARM64                                                                                                                                                                                                             | Windows                                                                                                    |
| ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| [.dmg](https://github.com/melandlabs/openloomi/releases/download/v0.8.6/openloomi_0.8.6_macOS_aarch64.dmg) | [.dmg](https://github.com/melandlabs/openloomi/releases/download/v0.8.6/openloomi_0.8.6_macOS_amd64.dmg) | [.deb](https://github.com/melandlabs/openloomi/releases/download/v0.8.6/openloomi_0.8.6_linux_amd64.deb) / [.rpm](https://github.com/melandlabs/openloomi/releases/download/v0.8.6/openloomi_0.8.6_linux_amd64.rpm) | [.deb](https://github.com/melandlabs/openloomi/releases/download/v0.8.6/openloomi_0.8.6_linux_aarch64.deb) / [.rpm](https://github.com/melandlabs/openloomi/releases/download/v0.8.6/openloomi_0.8.6_linux_aarch64.rpm) | [.exe](https://github.com/melandlabs/openloomi/releases/download/v0.8.6/openloomi_0.8.6_windows_amd64.exe) |

完整文档请访问 [openloomi.ai/docs](https://openloomi.ai/docs)。

**作为 Agent 插件使用**（面向 Claude Code / Codex 用户）：

OpenLoomi 提供了官方 marketplace 插件，可以把现有的 agent 接入本地 OpenLoomi runtime。插件本身很薄——所有副作用都打到你的本地桌面应用——所以你照常用你的 agent。

| Agent       | 安装                                                                                      | 首次启动                          |
| ----------- | ----------------------------------------------------------------------------------------- | --------------------------------- |
| Claude Code | `/plugin marketplace add melandlabs/plugins`<br>`/plugin install openloomi`               | `/openloomi:setup`                |
| Codex CLI   | `codex plugin marketplace add melandlabs/plugins && codex plugin add openloomi@openloomi` | `@OpenLoomi Run first-use setup.` |

精简版公共 marketplace 仓库是 [`melandlabs/plugins`](https://github.com/melandlabs/plugins)，只拉取插件本身需要的文件。完整文档见插件文档：[`plugins/claude`](https://openloomi.ai/docs/plugins/claude) · [`plugins/codex`](https://openloomi.ai/docs/plugins/codex)。

**本地开发**（面向开发者）：

```bash
git clone https://github.com/melandlabs/openloomi.git
cd openloomi

pnpm install
pnpm tauri:dev
```

需要 Node.js 22+、pnpm 9+ 和 Rust 1.75+，Windows 还需要 Visual Studio Build Tools with C++ workload。更多平台特定设置要求请参见 [CONTRIBUTING.md](./CONTRIBUTING.md)。

## 它有何不同

**OpenLoomi 是开源且中立的。** 它不会把你锁定在某一家厂商的 Agent 上，而是可以与任意 Agent Runtime 集成——Claude Code、Codex、OpenCode、Hermes、OpenClaw——并为它们带来一个共享的跨 Agent 层：常驻桌面的**注意力代理**、**全局上下文记忆**、**平台连接器**和**主动式任务**。无论你运行哪个 Agent，OpenLoomi 都替你守着门、记住真正重要的事，并只把值得你花时间的决策呈现出来——让你把注意力留给工作本身，而不是追着工作跑。

| 与…相比                | OpenLoomi 的优势                                                                   |
| ---------------------- | ---------------------------------------------------------------------------------- |
| Claude Cowork 类 Agent | 开源的、本地优先的 AI 伙伴与工作空间，支持来源证据和审批                           |
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
