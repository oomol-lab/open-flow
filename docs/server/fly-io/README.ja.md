# Fly.io へのデプロイ

[English](README.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Русский](README.ru.md) | [Français](README.fr.md)

Open Flow Server は、Node Docker ランタイムとして Fly.io 上で実行できます。このデプロイメントでは、リポジトリの
`apps/server/Dockerfile`、リポジトリのルートにある Fly app 設定 `fly.toml`、および `/data/open-flow` にマウントされる
Fly volume を使用します。Fly は TLS 終端、リモート Docker ビルド、ヘルスチェック、ローリングデプロイ、任意のカスタムドメインを
提供します。

デプロイメントの境界は[コンテナ配布リファレンス](../container-delivery.md)と同じです。Server の machine は 1 台、SQLite の
writer は 1 つです。machine を 2 台以上実行してはいけません。

## 前提条件

- Fly.io のアカウント。
- `flyctl` がインストールされ、`fly auth login` で認証済みであること。
- ローカルで Docker が利用できること、または Fly の remote builder。`apps/server/Dockerfile` は BuildKit 構文を使用しており、
  remote builder はこれをサポートしています。

## App を作成する

まだデプロイせずに Fly app を作成します。

```bash
fly apps create my-open-flow
```

Fly app の名前はグローバルに一意です。別の名前を選ぶ場合は、デプロイ前に `fly.toml` の `app` フィールドを更新してください。

```toml
app = "my-open-flow"
```

## 永続ストレージを作成する

イメージは SQLite を `/data/open-flow` に保存します。`fly.toml` と同じ source 名で Fly volume を作成します。

```bash
fly volumes create open_flow_data \
  --region iad \
  --size 1 \
  --app my-open-flow
```

Run の履歴と RunEvent は時間とともに増加します。多数の Run を見込む場合は `--size` を増やすか、後から `fly volumes extend` で
volume を拡張してください。

## Secret を設定する

operator token は 32 バイト以上の UTF-8 で構成されている必要があります。`fly.toml` にコミットするのではなく、Fly の secret
として保存してください。

```bash
OPEN_FLOW_TOKEN="$(openssl rand -hex 32)"

fly secrets set \
  OPEN_FLOW_TOKEN="$OPEN_FLOW_TOKEN" \
  --app my-open-flow
```

`OPEN_FLOW_TOKEN` はパスワードマネージャーに保管してください。同じ値で Workbench にサインインでき、Control API の
Bearer token としても使えます。

`fly.toml` はすでに `OPEN_FLOW_SESSION_COOKIE_SECURE` を `true` に設定しています。`force_https` が平文の HTTP リクエストを
リダイレクトするため、ブラウザは TLS 経由でのみ Server に到達します。

Connector が必要な場合は、Connector の secret を設定します。

```bash
fly secrets set \
  OPEN_FLOW_CONNECTOR_ORIGIN="https://connector.example.com" \
  OPEN_FLOW_CONNECTOR_TOKEN="replace-with-a-scoped-runtime-token" \
  OPEN_FLOW_CONNECTOR_CONSOLE_ORIGIN="https://connector.example.com" \
  --app my-open-flow
```

OpenConnector が同じ Fly organization で動作している場合、runtime origin には Fly のプライベートネットワーク、たとえば
`http://my-open-connector.internal:3000` を使用できます。console origin は引き続き、ユーザーのブラウザが開ける公開 HTTPS
origin でなければなりません。

Provider Integration が必要な場合は、callback origin と key を設定します。

```bash
fly secrets set \
  OPEN_FLOW_INTEGRATION_PUBLIC_ORIGIN="https://my-open-flow.fly.dev" \
  OPEN_FLOW_INTEGRATION_CALLBACK_KEY="$(openssl rand -hex 32)" \
  --app my-open-flow
```

`fly secrets set` は machine を再デプロイします。環境変数の完全な一覧と各 origin の制約については、
[コンテナ配布リファレンス](../container-delivery.md#4-配置) を参照してください。

## デプロイする

リポジトリのルートからデプロイします。

```bash
fly deploy --config fly.toml --remote-only --ha=false
```

`--ha=false` は、Fly が新しい app に 2 台目の machine を作成するのを防ぎます。Server が許可する SQLite の writer は 1 つで、
各 machine はそれぞれ独自の volume をマウントするため、machine が 2 台あると互いに無関係な 2 つの状態のコピーを保持することに
なります。以降のすべてのデプロイでも machine 数を 1 に保ち、`fly scale count` で増やさないでください。

Fly の設定では次を使用します。

- イメージのビルドに `apps/server/Dockerfile` を使用し、ビルドコンテキストはリポジトリのルートです。
- `internal_port = 3000`。イメージのデフォルトです。
- HTTP ヘルスチェックとして `GET /readyz`。Server の起動中、バックグラウンド処理が停止しているとき、または設定された
  Connector に到達できないときに 503 を返します。その場合 Fly はその machine へのトラフィックのルーティングを停止し、
  デプロイを失敗させます。liveness チェックだけで十分な場合はパスを `/healthz` に切り替えてください。
- `kill_signal = "SIGTERM"` と `kill_timeout = "45s"`。Server は Run のドレインと SQLite のクローズに最大 30 秒待機するため、
  猶予期間は 30 秒を超えている必要があります。
- `auto_stop_machines = "off"` と `min_machines_running = 1`。Cron と Poll Trigger は machine が動作している間だけ発火します。

## ランタイムを検証する

```bash
curl https://my-open-flow.fly.dev/healthz
curl https://my-open-flow.fly.dev/readyz
```

期待されるレスポンスは `{"status":"ok"}` と `{"status":"ready"}` です。`https://my-open-flow.fly.dev` を開き、
`OPEN_FLOW_TOKEN` で Workbench にサインインします。

デプロイや起動の問題を診断するときはログを確認します。

```bash
fly logs --app my-open-flow
```

## カスタムドメイン

Fly にドメインを登録します。

```bash
fly certs add flow.example.com --app my-open-flow
```

Fly は作成すべき DNS レコードを出力します。DNS の準備ができたら、証明書の状態を確認します。

```bash
fly certs check flow.example.com --app my-open-flow
```

Integration callback が設定されている場合は、`OPEN_FLOW_INTEGRATION_PUBLIC_ORIGIN` を新しいドメインに向けます。

```bash
fly secrets set \
  OPEN_FLOW_INTEGRATION_PUBLIC_ORIGIN="https://flow.example.com" \
  --app my-open-flow
```

## 更新する

```bash
git pull
fly deploy --config fly.toml --remote-only
```

volume には `open-flow.sqlite` とその WAL および SHM ファイルが保持されます。SQLite のマイグレーションは Server の起動時に
順番に実行されるため、追加の手順は不要です。

## バックアップ

Fly は volume のスナップショットを自動的に取得しますが、Server が保証するのは quiesced なバックアップだけです。一貫性のある
バックアップを取るには、スナップショットを作成する前に machine を停止してください。

```bash
fly machine stop <machine-id> --app my-open-flow
fly volumes snapshots create <volume-id> --app my-open-flow
fly volumes snapshots list <volume-id> --app my-open-flow
fly machine start <machine-id> --app my-open-flow
```

snapshot は非同期に作成されます。`fly volumes snapshots list` で新しい snapshot が `created` と表示されるまで machine を停止したままにし、
その後で machine を起動してください。

各 id は `fly machine list` と `fly volumes list` で確認できます。

## スケーリングとアイドル状態の machine

- machine 数は 1 に保ちます。より多くの容量が必要な場合は、`fly.toml` の `[[vm]]` 配下にある `size` と `memory` を変更して
  再デプロイしてください。
- デフォルトは `memory = "1gb"` です。各 Run の Isolated VM はデフォルトで 128 MB に制限され、`OPEN_FLOW_MAX_CONCURRENT_RUNS`
  のデフォルトは 4 で、Node プロセス自体にもメモリが必要です。メモリは同時実行数の上限と合わせて引き上げてください。
- 手動の Run と Webhook だけを使用し、コールドスタートを許容できる場合は、`auto_stop_machines = "suspend"` と
  `min_machines_running = 0` を設定します。machine がサスペンドされている間は Cron と Poll Trigger は発火せず、最初の Webhook
  リクエストは machine が起動するまで待機します。
