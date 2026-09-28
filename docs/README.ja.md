<div align="center">

# Open Flow

**見える、書ける、動かせる、そして自分のものにできるワークフローを構築する。**

[English](../README.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Русский](README.ru.md) | [Français](README.fr.md)

[![CI](https://github.com/oomol-lab/open-flow/actions/workflows/ci.yaml/badge.svg)](https://github.com/oomol-lab/open-flow/actions/workflows/ci.yaml)
[![npm](https://img.shields.io/npm/v/%40oomol-lab%2Fopen-flow/next?label=%40oomol-lab%2Fopen-flow)](https://www.npmjs.com/package/@oomol-lab/open-flow)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](../LICENSE)
![Node.js 26](https://img.shields.io/badge/Node.js-26-339933)
![Bun 1.4](https://img.shields.io/badge/Bun-1.4-000000)

</div>

**AI エージェントと自動化をつくる。実行する内容を、自分の目で確かめる。**

Open Flow は、AI による構築の速さと、視覚的なワークフローのわかりやすさを両立するオープンソースのワークフロープラットフォームです。Codex、Claude Code などのエージェントに Flow の作成を依頼し、Workbench で開いて、同じワークフローを一緒に改善できます。

JavaScript、アプリ連携、AI、条件分岐、人による承認を一つのキャンバスで組み合わせます。入力を確認し、実行を追跡し、どのバージョンを本番で動かすかを決められます。OOMOL Hosted でも、自分で管理するインフラでも実行できます。

[インタラクティブデモを試す](https://openflow.run) · [OOMOL Hosted を使う](https://oomol.com) · [Docker でセルフホストする](#自分に合った実行環境を選ぶ)

![現在の Open Flow Workbench で表示した顧客オンボーディングフロー。顧客データ、JavaScript、承認、サブフローを明示](assets/readme-workbench.png)

> [!IMPORTANT]
> Open Flow はベータ版です。製品とバージョン管理された契約は、引き続き進化しています。

## エージェントが構築し、あなたが判断する

必要な仕事を伝えてください。

> 「新しいサポートメールを読み、問い合わせを分類して返信を下書きし、送信前に私の承認を求めてください。」

ターミナルを使えるエージェントは、[`oo flow`](https://github.com/oomol-lab/oo-cli) を通じて連携先を調べ、ノードを作成・編集し、ドラフトを検証・実行して結果を確認し、指示に応じて公開できます。変更は、あなたがグラフの確認やコードの編集に使う同じ Workbench に反映されます。AI が生成した別のプロジェクトを変換したり、同期したりする必要はありません。

Server は、対応クライアント向けの [MCP 編集・実行ツール](server/mcp.md) も提供します。どちらのインターフェースも、選択したデプロイ環境に保存された Flow、リビジョン、実行記録を操作します。

繰り返しの接続作業はエージェントに任せ、重要な判断は見える場所に残しましょう。

## すべてのステップを確認できる形に

ワークフローを作ったときの会話がなくても、その仕組みを理解できることが大切です。

- **正確な処理は JavaScript で。** Code Task でデータ変換、メッセージ整形、独自ロジックを記述できます。入力と出力には名前と型があります。
- **入力元を明示。** 値の出所をプロパティパネルで確認できます。制御接続は次に何を実行するかを、入力マッピングは各ステップがどのデータを受け取るかを決めます。
- **条件分岐と再利用できるサブフロー。** 条件に応じて処理を振り分け、繰り返し使うロジックに明確なインターフェースを設けられます。
- **処理のそばに説明を。** 判断の理由をキャンバスに直接書き残し、次に触れる人に意図を伝えられます。

![現在の Code Task プロパティパネル。JavaScript、顧客入力の参照元、型付きのメッセージ出力を表示](assets/readme-code.png)

## AI の仕事と範囲を決める

分類、抽出、要約には LLM Task を使い、複数のツール呼び出しが必要な仕事には Agent Task を使えます。予測可能な動作が必要な部分には、通常のコード、条件、承認を組み合わせます。

Agent Task には、設定済みのモデル、明示されたツール、実行上限があります。ツール設定によって、モデルが利用できる操作、アカウント、承認ポリシーが決まります。ツール呼び出しに人の承認を必須としたり、ワークフローに Approval ノードを置いて後続処理を承認待ちにしたりできます。

Approval と Wait ノードは待機状態を永続化します。判断が下された後は、その実行ですでに完了したステップをやり直さずに続行できます。

## 実行を確かめ、公開するバージョンを選ぶ

選択したトリガーからドラフトをテストし、Workbench で実行を追跡できます。最後のメッセージだけから処理を推測することなく、ノードの結果、ログ、エラー、承認待ちを確認できます。実行履歴には、実行とその元になったリビジョンの関係が残ります。

![Open Flow Workbench で人の承認を待っている顧客オンボーディングのテスト実行](assets/readme-approval.png)

公開すると、Live の自動化で使うバージョン付きスナップショットが作成されます。公開済みのバージョンを動かしながらドラフトを編集し、過去の Publication を確認し、必要に応じてロールバックできます。

手動、スケジュール、Webhook、対応サービスのイベントやポーリングから処理を開始できます。同じデプロイ環境が、ワークフロー、Live バージョン、実行状態を管理します。

## 認証情報をグラフに入れずにアプリを接続

Open Flow は [OpenConnector](https://github.com/oomol-lab/open-connector) などの Connector ランタイムを使い、Gmail、Slack、GitHub、Notion などの操作を検索・実行します。アカウントの認証情報は Connector が保持し、ワークフローは Connection の識別子を参照します。

OOMOL Hosted は、対応する連携向けにマネージド OAuth アプリを提供します。セルフホストでは、Connector の配置先を選び、必要なサービス設定とアカウント認可を管理します。ワークフローのロジックとアカウントへのアクセスは、それぞれ独立しています。

アカウントの認可から最初の Flow の作成までの設定手順は、[OpenConnector と oo CLI で Open Flow を使う](server/self-hosted-stack/README.ja.md)を参照してください。

## 自分に合った実行環境を選ぶ

| 選択肢           | 自分で管理するもの                                                                     | はじめる                                     |
| ---------------- | -------------------------------------------------------------------------------------- | -------------------------------------------- |
| **OOMOL Hosted** | ワークフローと接続アカウント。デプロイ環境は OOMOL が運用します。                      | [OOMOL を開く](https://oomol.com)            |
| **Docker**       | デプロイ、ストレージ、バックアップ、アップグレード、連携。                             | 下記のコマンド                               |
| **Fly.io**       | Fly のインフラ上のアプリ、永続ボリューム、シークレット、バックアップ、アップグレード。 | [デプロイガイド](server/fly-io/README.ja.md) |

ローカルでセルフホストするには、Docker と OpenSSL をインストールして実行します。

```bash
git clone https://github.com/oomol-lab/open-flow.git
cd open-flow

export OPEN_FLOW_TOKEN="$(openssl rand -hex 32)"
docker build --file apps/server/Dockerfile --tag open-flow-server:dev .
docker run --rm \
  --publish 3000:3000 \
  --env OPEN_FLOW_TOKEN="$OPEN_FLOW_TOKEN" \
  --volume open-flow-data:/data/open-flow \
  open-flow-server:dev
```

[http://127.0.0.1:3000](http://127.0.0.1:3000) を開き、`OPEN_FLOW_TOKEN` でサインインします。Flow と実行履歴は Docker ボリュームに保存されます。同じ管理者トークンを CLI と API の認証にも使います。

ビルド済みイメージを使う場合は、[GHCR イメージガイド](server/docker-ghcr/README.ja.md)に従い、ベータ期間中は明示的なリリースタグを選んでください。`latest` タグは安定版用です。

Connector の操作や LLM Task には、対応するサービスの設定が必要です。Server が別のプロバイダーへ黙って切り替えることはありません。インターネットに公開する前に、[デプロイガイド](server/container-delivery.md)と[セキュリティ強化チェックリスト](../SECURITY.md#hardening-your-deployment)を確認してください。

## Open Flow を基盤に開発する

Open Flow は Apache-2.0 ライセンスで公開されています。このリポジトリには、ワークフローの契約とランタイム、Workbench、CLI コマンドパッケージ、セルフホスト用 Server が含まれます。バージョン管理された Control API により、クライアントはデプロイ環境のストレージや実行の実装に依存しません。

`.bun-version` と `.node-version` に固定された Bun と Node.js のバージョンを使ってください。

```bash
bun install --frozen-lockfile
bun run dev
```

開発用 Workbench は [http://localhost:5174](http://localhost:5174) で開けます。初回起動時に `apps/server/.open-flow-dev/operator-token` に管理者トークンが作成されます。設定、チェック、コンポーネント Lab については [CONTRIBUTING.md](../CONTRIBUTING.md) を参照してください。

| 詳しく知る                                 | 参考資料                                                                                                                  |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| 製品モデルとランタイムの境界               | [アーキテクチャ](architecture.md)                                                                                         |
| 独自クライアントの連携                     | [Control API](control/contracts/control-api.md) · [MCP](server/mcp.md)                                                    |
| デプロイと運用                             | [Server](server/container-delivery.md) · [Docker](server/docker-ghcr/README.ja.md) · [Fly.io](server/fly-io/README.ja.md) |
| アプリと AI コーディングエージェントの接続 | [OpenConnector + oo CLI](server/self-hosted-stack/README.ja.md)                                                           |
| すべてのドキュメント                       | [ドキュメント索引](README.md)                                                                                             |

## 関連プロジェクト

- [OpenConnector](https://github.com/oomol-lab/open-connector)：Connector を利用するノードの背後で Provider カタログ、認証情報、Action の実行を提供する
  オープンソースの Connector ゲートウェイ。
- [oo CLI](https://github.com/oomol-lab/oo-cli)：このリポジトリからビルドされる `oo flow` コマンドをホストするローカル Agent ツールキット。

## コントリビューション

Issue と Pull Request を歓迎します。開発環境のセットアップ、リポジトリのルール、Pull Request を作成する前に実行すべきチェックについては
[CONTRIBUTING.md](../CONTRIBUTING.md) を参照してください。このプロジェクトへの参加は [CODE_OF_CONDUCT.md](../CODE_OF_CONDUCT.md) に従います。

## セキュリティ

脆弱性は公開 Issue ではなく、[GitHub のプライベート脆弱性報告](https://github.com/oomol-lab/open-flow/security/advisories/new)を通じて非公開で報告してください。
[SECURITY.md](../SECURITY.md) には、サポート対象のバージョン、開示プロセス、報告の範囲、セルフホストデプロイメントの強化方法が記載されています。

## ライセンス

[Apache-2.0](../LICENSE)。同梱アセットに関するサードパーティの通知は [NOTICE](../NOTICE) に記載されています。

## コントリビューター

Open Flow の開発にご協力いただいたすべての皆さまに感謝します。参加方法については
[コントリビューションガイド](../CONTRIBUTING.md) をご覧ください。

[![Open Flow コントリビューター](https://contrib.rocks/image?repo=oomol-lab/open-flow)](https://github.com/oomol-lab/open-flow/graphs/contributors)

## Star 履歴

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../assets/star-history/star-history-dark.svg">
  <img alt="Star history" src="../assets/star-history/star-history-light.svg">
</picture>
