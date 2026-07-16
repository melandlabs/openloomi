<div align="center">
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="apps/web/public/images/logo-text-dark.png">
  <img src="apps/web/public/images/logo-text.png" alt="OpenLoomi Logo" width="400">
</picture>

**いつもあなたを覚えているAI。**

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

## OpenLoomiとは？

OpenLoomiは、デスクトップ上で動作するオープンソースのAIワークスペースです。すでに使っているツール（メッセージアプリ、メール、カレンダー、ドキュメント、プロジェクト管理ツールなど）と連携し、あなたの人間関係、プロジェクト、意思決定の**ホリスティック・コンテキスト・グラフ**を構築します。

<p align="center">
  <img src="screenshots/app/main-with-loomi.png" alt="OpenLoomi メインウィンドウと Loomi" width="100%">
</p>

## 機能

|     | 機能                                                                         | 内容                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🧠  | **[ホリスティック・コンテキスト・グラフ](https://openloomi.ai/docs/memory)** | 短期 → 中期 → 長期の記憶が自律的に成長します。可視化・監査が可能で、何カ月にもわたってあなたの人間関係、プロジェクト、意思決定を常に記憶し続けます                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 🔌  | **[プラットフォームコネクタ](https://openloomi.ai/docs/connectors)**         | **[自動フェッチ](https://openloomi.ai/docs/what-is-openloomi#a-complete-intelligence-loop-from-perception-to-action)** バックグラウンド同期ループがコミット、課題、メール、ドキュメントを能動的に取得しグラフに保存。**[メッセージングアプリ](https://openloomi.ai/docs/messaging-apps)** — Telegram、WhatsApp、iMessage、QQ、拉翅/Feishu — 既存の会話内で直接AIとチャット可能。全リスト：Telegram、WhatsApp、WeChat、DingTalk、Feishu、Gmail、Google Calendar、Outlook、Google Docs、X/Twitter、Instagram、LinkedIn、Facebook Messenger、Jira、HubSpot、Asana、iMessage、QQ、RSS |
| ⏰  | **[プロアクティブタスク](https://openloomi.ai/docs/automation)**             | デスクトップ注意エージェント。画面とワークフローを見守り、次の動きを先読みして、頼まれる前にそっと処理します                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 🖥️  | **[セキュリティと使いやすさ](https://openloomi.ai/docs/privacy-security)**   | Windows、macOS、Linux向けのネイティブデスクトップアプリ。**すぐに使えて**、セットアップは数分、設定で苦労することはありません。IndexedDB + SQLiteによるローカルファースト保存、AES-256暗号化、データが端末外に出ることはなく、監査可能なアクセスログを備えています                                                                                                                                                                                                                                                                                                                |
| 🔗  | **[オープンソース化されたスキル](https://openloomi.ai/docs/skills)**         | OpenLoomi Skillsはオープンソースで、あらゆるエージェントに組み込めます。Claude Code、Codex、OpenClaw、Hermesなどに対応しています。                                                                                                                                                                                                                                                                                                                                                                                                                                                |

<p align="center">
  <img src="screenshots/components.png" alt="アーキテクチャ" width="100%">
</p>

## クイックスタート

**直接ダウンロード**（エンドユーザー向け）:

| macOS Apple Silicon                                                                                        | macOS Intel                                                                                              | Linux AMD64                                                                                                                                                                                                         | Linux ARM64                                                                                                                                                                                                             | Windows                                                                                                    |
| ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| [.dmg](https://github.com/melandlabs/openloomi/releases/download/v0.7.8/openloomi_0.7.8_macOS_aarch64.dmg) | [.dmg](https://github.com/melandlabs/openloomi/releases/download/v0.7.8/openloomi_0.7.8_macOS_amd64.dmg) | [.deb](https://github.com/melandlabs/openloomi/releases/download/v0.7.8/openloomi_0.7.8_linux_amd64.deb) / [.rpm](https://github.com/melandlabs/openloomi/releases/download/v0.7.8/openloomi_0.7.8_linux_amd64.rpm) | [.deb](https://github.com/melandlabs/openloomi/releases/download/v0.7.8/openloomi_0.7.8_linux_aarch64.deb) / [.rpm](https://github.com/melandlabs/openloomi/releases/download/v0.7.8/openloomi_0.7.8_linux_aarch64.rpm) | [.exe](https://github.com/melandlabs/openloomi/releases/download/v0.7.8/openloomi_0.7.8_windows_amd64.exe) |

詳細なドキュメントは[こちら](https://openloomi.ai/docs)で確認できます。

**ローカルで開発**（開発者向け）:

```bash
git clone https://github.com/melandlabs/openloomi.git
cd openloomi

pnpm install
pnpm tauri:dev
```

Node.js 22以上、pnpm 9以上、Rust 1.75以上が必要です。Windows では Visual Studio Build Tools と C++ ワークロードが必要です。プラットフォーム固有のセットアップ要件の詳細については、[CONTRIBUTING.md](./CONTRIBUTING.md) を参照してください。

## 他のとは違う点

| 比較対象               | OpenLoomi が追加するもの                                                                                           |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Claude Cowork 型 Agent | オープンソースでローカルファーストのAI同僚とワークスペース。ソース証拠と承認を備えている                           |
| Codex / Claude Code    | リポジトリを超えたワークスペースコンテキスト：人物、製品の意思決定、リリースコンテキスト、課題、フォローアップ     |
| OpenClaw / Hermes      | アクションの前後：なぜ重要なのか、どのソースが使われたのか、何が変わったのか、何が残っているのか                   |
| RAG / ナレッジベース   | ワーク状態であり単なるドキュメント検索ではない：何が変わったのか、何がまだ有効なのか、次のアクションに何影響するか |

## アプリのスクリーンショット

<table>
<tr>
<td><img src="screenshots/app/loomi-pet.gif" alt="Loomi ペット" width="100%"></td>
<td><img src="screenshots/app/loomi-proactive-task.gif" alt="プロアクティブタスク" width="100%"></td>
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

## フィードバック

これは初期段階のソフトウェアです。実際にインストールしてツールを連携し、何が動かないかを教えてくれる方を募集しています。

- [GitHub Issues](https://github.com/melandlabs/openloomi/issues) — バグ、インストールの問題、機能リクエスト
- [Discord](https://discord.com/invite/xkJaJyWcsv) — ディスカッション、質問、サポート
- [メール](mailto:developer@alloomi.ai) — その他なんでも

## コントリビュート

[CONTRIBUTING.md](./CONTRIBUTING.md)をご覧ください。[`good first issue`](https://github.com/melandlabs/openloomi/labels/good%20first%20issue)ラベルを探してみてください。

## ライセンス

[Apache 2.0](./LICENSE)
