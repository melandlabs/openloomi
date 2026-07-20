<div align="center">
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="apps/web/public/images/logo-text-dark.png">
  <img src="apps/web/public/images/logo-text.png" alt="OpenLoomi Logo" width="400">
</picture>

**注意エージェントが動かすオープンソースのAIパートナー。**

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

⭐ **OpenLoomi が役に立ったなら、GitHub で star をいただけると嬉しいです！** より多くの人にプロジェクトを知ってもらい、開発を続ける励みになります。🙏

[![GitHub Repo stars](https://img.shields.io/github/stars/melandlabs/openloomi?style=social&label=Star)](https://github.com/melandlabs/openloomi)

</div>

---

## OpenLoomiとは？

OpenLoomiは、オープンソースのAIパートナーです。デスクトップ常駐の**注意エージェント**を中心に、認可した業務ツールと画面コンテンツをつなぎ、あなたの人間関係、プロジェクト、意思決定の**ホリスティック・コンテキスト**を構築。何が起きたのか、なぜ重要なのか、次に何をすべきか、日々のサマリーまで教えてくれるので、本当に大切なことに注意を向けられます。

<p align="center">
  <img src="screenshots/app/main-with-loomi.png" alt="OpenLoomi メインウィンドウと Loomi" width="100%">
</p>

## 何に使える？

デスクトップ常駐の **注意エージェント**——頼れるデスクパートナー Loomi——が代わりに入口を監視し、一日に散らばったシグナルを 1 タップで承認できる意思決定カードに変えます。単独利用も、任意のエージェントフレームワークを同じ常駐デスクトップに組み込むこともできます。Claude Code、Codex、OpenCode、Hermes、OpenClaw すべて対応。

- **約束事を忘れない。** 未返信メッセージ、迫る締め切り、「金曜に follow-up を送る」——Loomi がちょうどいいタイミングで小さなバブルでさりげなく促し、監視するシグナルと意思決定は自分で拡張できます。
- **仕事のことを一瞬で引き出す。** 「先四半期の価格、結局どう決めた？」「Acorn のデザイン担当は誰？」「休暇前、何やってたっけ？」——ツールとチャネルを横断して記憶。Slack / Gmail / Notion を探さなくていい。
- **9 時の ToDo、18 時の振り返り。** 9 時に今日の ToDo をあなたの目に、18 時に今日の完了サマリーをお届け——重要な情報は一カ所に、9 個のアプリを開く日々は終わり。
- **いつものチャットアプリ内で AI に仕事を手伝わせる。** 返信の下書き、長文スレッドの要約、follow-up の予約まで Telegram / WhatsApp / iMessage / QQ / Feishu で直接。

→ いつもそばにいる相棒について詳しくは[注意エージェントのドキュメント](https://openloomi.ai/docs/attention-agent)と[ユースケース](https://openloomi.ai/docs/use-cases)をご覧ください。

## 機能

|     | 機能                                                                             | 内容                                                                                                                                                                                                                                                                                                                                                                             |
| --- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🐾  | **[注意エージェント](https://openloomi.ai/docs/attention-agent)**                | デスクトップ常駐の相棒 Loomi が、9 時の ToDo、18 時の振り返り、未返信のリマインダーなど、決裁済みのリマインダーを小さなバブルでお知らせ。集中を妨げません。                                                                                                                                                                                                                      |
| 🧠  | **[ホリスティック・コンテキスト](https://openloomi.ai/docs/memory)**             | 短期 → 中期 → 長期の記憶が自律的に成長します。可視化・監査が可能で、何カ月にもわたってあなたの人間関係、プロジェクト、意思決定を常に記憶し続けます                                                                                                                                                                                                                               |
| 🔌  | **[プラットフォームコネクタ](https://openloomi.ai/docs/connectors)**             | **[自動フェッチ](https://openloomi.ai/docs/what-is-openloomi#a-complete-intelligence-loop-from-perception-to-action)** バックグラウンド同期ループがコミット、課題、メール、ドキュメントを能動的に取得しグラフに保存。**[メッセージングアプリ](https://openloomi.ai/docs/messaging-apps)** — Telegram、WhatsApp、iMessage、QQ、Feishu/拉翅 — 既存の会話内で直接AIとチャット可能。 |
| ⏰  | **[プロアクティブタスク](https://openloomi.ai/docs/automation)**                 | 繰り返しの作業——日次ダイジェスト、週次レポート、リマインダー——をデスクトップで自動実行。                                                                                                                                                                                                                                                                                         |
| 🖥️  | **[セキュリティと使いやすさ](https://openloomi.ai/docs/privacy-security)**       | Windows、macOS、Linux向けのネイティブデスクトップアプリ。**すぐに使えて**、セットアップは数分、設定で苦労することはありません。ローカルファースト保存、AES-256暗号化、データが端末外に出ることはなく、監査可能なアクセスログを備えています                                                                                                                                       |
| 🧩  | **[任意のエージェント統合](https://openloomi.ai/docs/reference/agent-runtimes)** | OpenLoomi のコンテキスト、メモリ、コネクタ、注意エージェント、Loop エンジンはいずれもオープンソースの[スキル](https://openloomi.ai/docs/skills)および[プラグイン](https://openloomi.ai/docs/plugins)として提供されています。OpenLoomi Desktop をそのまま使うことも、既存のエージェント — Claude、Codex、OpenCode、Hermes、OpenClaw — に組み込むこともできます。                  |

## クイックスタート

**直接ダウンロード**（エンドユーザー向け）:

| macOS Apple Silicon                                                                                        | macOS Intel                                                                                              | Linux AMD64                                                                                                                                                                                                         | Linux ARM64                                                                                                                                                                                                             | Windows                                                                                                    |
| ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| [.dmg](https://github.com/melandlabs/openloomi/releases/download/v0.8.4/openloomi_0.8.4_macOS_aarch64.dmg) | [.dmg](https://github.com/melandlabs/openloomi/releases/download/v0.8.4/openloomi_0.8.4_macOS_amd64.dmg) | [.deb](https://github.com/melandlabs/openloomi/releases/download/v0.8.4/openloomi_0.8.4_linux_amd64.deb) / [.rpm](https://github.com/melandlabs/openloomi/releases/download/v0.8.4/openloomi_0.8.4_linux_amd64.rpm) | [.deb](https://github.com/melandlabs/openloomi/releases/download/v0.8.4/openloomi_0.8.4_linux_aarch64.deb) / [.rpm](https://github.com/melandlabs/openloomi/releases/download/v0.8.4/openloomi_0.8.4_linux_aarch64.rpm) | [.exe](https://github.com/melandlabs/openloomi/releases/download/v0.8.4/openloomi_0.8.4_windows_amd64.exe) |

詳細なドキュメントは[こちら](https://openloomi.ai/docs)で確認できます。

**Agent プラグインとして使う**（Claude Code / Codex ユーザー向け）:

OpenLoomi は公式の marketplace プラグインを提供しており、既存のエージェントをローカル OpenLoomi runtime へのフロントエンドにできます。

| Agent       | インストール                                                                              | 初回セットアップ                  |
| ----------- | ----------------------------------------------------------------------------------------- | --------------------------------- |
| Claude Code | `/plugin marketplace add melandlabs/plugins`<br>`/plugin install openloomi`               | `/openloomi:setup`                |
| Codex CLI   | `codex plugin marketplace add melandlabs/plugins && codex plugin add openloomi@openloomi` | `@OpenLoomi Run first-use setup.` |

スリム版マーケットプレースは [`melandlabs/plugins`](https://github.com/melandlabs/plugins) にあり、追加時にプラグインパッケージのみを取得します。詳細は各プラグインのドキュメントを参照: [`plugins/claude`](https://openloomi.ai/docs/plugins/claude) · [`plugins/codex`](https://openloomi.ai/docs/plugins/codex)。

**ローカルで開発**（開発者向け）:

```bash
git clone https://github.com/melandlabs/openloomi.git
cd openloomi

pnpm install
pnpm tauri:dev
```

Node.js 22以上、pnpm 9以上、Rust 1.75以上が必要です。Windows では Visual Studio Build Tools と C++ ワークロードが必要です。プラットフォーム固有のセットアップ要件の詳細については、[CONTRIBUTING.md](./CONTRIBUTING.md) を参照してください。

## 他のとは違う点

**OpenLoomi はオープンソースで中立です。** 特定ベンダーの Agent に縛られることなく、あらゆる Agent Runtime——Claude Code、Codex、OpenCode、Hermes、OpenClaw——と統合し、それらすべてに共有のクロス Agent レイヤーをもたらします：常駐型デスクトップの**アテンションエージェント**、**包括的なコンテキストメモリ**、**プラットフォームコネクタ**、そして**プロアクティブなタスク**。どの Agent を使っていても、OpenLoomi があなたの代わりに入口を見張り、本当に重要なことを記憶し、時間を割く価値のある意思決定だけを提示します——追いかけるためではなく、仕事そのものにあなたの注意を使えるように。

| 比較対象               | OpenLoomi が追加するもの                                                                                           |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Claude Cowork 型 Agent | オープンソースでローカルファーストのAIパートナーとワークスペース。ソース証拠と承認を備えている                     |
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
