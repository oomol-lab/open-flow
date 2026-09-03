# Docker イメージ (GHCR)

[English](README.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Русский](README.ru.md) | [Français](README.fr.md)

Open Flow は GitHub Packages コンテナレジストリ (GHCR) にビルド済みの Server イメージを公開しています。リポジトリを clone したりビルドしたりせずに
実行できます。イメージ名は次のとおりです:

```text
ghcr.io/oomol-lab/open-flow
```

イメージの内容は[コンテナ配布リファレンス](../container-delivery.md)の説明と同じです: Workbench、Control API、Run runtime、Trigger runtime、
SQLite migration を含む 1 つの Server プロセスです。設定、ヘルスチェック、永続化、バックアップはそちらに記載しており、ここでは繰り返しません。

## Tag の選び方

| Tag             | 指す先                                        | 使いどころ                                           |
| --------------- | --------------------------------------------- | ---------------------------------------------------- |
| `latest`        | 最新の安定 Release                            | 現在の安定版 Server を使いたい                       |
| `<release-tag>` | `v0.1.0-beta.1` のような特定の Release (不変) | 本番にデプロイし、固定された再現可能なビルドが欲しい |
| `tip`           | `main` の最新コミット                         | まだリリースされていない変更を試したい               |
| `<short-sha>`   | `main` の特定のコミット (不変)                | 特定のプレリリースビルドに固定したい                 |

GitHub Release を公開するたびにその tag が発行されます。安定 Release は `latest` も更新しますが、pre-release は更新しないため、`latest` が beta を
指すことはありません。`main` への push のたびに `tip` と短いコミットハッシュが発行されます。同名の tag は新しいビルドで置き換わるため、`latest` と
`tip` は移動し、Release tag とコミットハッシュは固定されたままです。

Open Flow は beta 段階です。`latest` は最初の安定 Release と同時に現れるため、それまでは `tip` か `v0.1.0-beta.1` のような beta Release tag を使ってください。本番環境では `latest` ではなく Release tag に固定してください。

## Pull

イメージは公開されているため、サインインは不要です:

```bash
docker pull ghcr.io/oomol-lab/open-flow:tip
```

`unauthorized` や `denied` エラーが出る場合は、`read:packages` scope を持つ GitHub token でサインインしてください:

```bash
echo "$GITHUB_TOKEN" | docker login ghcr.io -u <github-username> --password-stdin
```

イメージはマルチアーキテクチャ (`linux/amd64` + `linux/arm64`) です。各アーキテクチャはネイティブにビルドされるため、Apple Silicon や
AWS Graviton を含め、Docker が `--platform` フラグなしでマシンに合った版を pull します。

## 実行

イメージはポート `3000` で待ち受け、`0.0.0.0` にバインドし、SQLite を `/data/open-flow` に保存します。再起動後もデータが残るよう、そこに
volume をマウントしてください。

Server は環境変数から operator token を受け取れます。32 バイト以上の token を生成し、安全な場所に保管してください。Workbench へのサインインに使い、
Control API の Bearer token としても機能します:

```bash
export OPEN_FLOW_TOKEN="$(openssl rand -hex 32)"

docker run -d \
  --name open-flow \
  --stop-timeout 45 \
  -p 3000:3000 \
  -v open-flow-data:/data/open-flow \
  -e OPEN_FLOW_TOKEN="$OPEN_FLOW_TOKEN" \
  ghcr.io/oomol-lab/open-flow:tip
```

[http://127.0.0.1:3000](http://127.0.0.1:3000) を開き、その token でサインインします。`OPEN_FLOW_TOKEN` を省略した場合、初回起動時にログへ
ワンタイムの setup code が出力され、Workbench は token を設定する前にその code を求めます。クレームの流れは[起動](../container-delivery.md#3-启动)を
参照してください。

Connector や LLM サービスに接続するには、[設定表](../container-delivery.md#4-配置)の変数を追加します。
[セルフホストスタックガイド](../self-hosted-stack/README.ja.md)では、OpenConnector と oo CLI で Open Flow を動かす手順を説明しています。

### Docker Compose

リポジトリのルートには、公開イメージを同じポートと volume で実行する `docker-compose.yml` があります。そこに列挙された変数はシェルから読み取られ、
未設定のものは省略されるため、イメージのデフォルトが適用されます:

```bash
export OPEN_FLOW_TOKEN="$(openssl rand -hex 32)"
docker compose up -d
docker compose logs -f open-flow
```

特定の tag を実行するには、下記のアップグレードコマンドを含むすべての compose コマンドの前にシェルで `OPEN_FLOW_IMAGE_TAG` を export してください。そうしないと固定した Release が `tip` に戻ります。例: `export OPEN_FLOW_IMAGE_TAG=v0.1.0-beta.1`。

### ソースからビルド

pull せずに自分でイメージをビルドするには、build overlay を追加します。`apps/server/Dockerfile` をビルドし、`docker-compose.yml` と同じ名前で
tag を付けます:

```bash
docker compose -f docker-compose.yml -f docker-compose.build.yml up --build
```

## アップグレード

新しい tag を pull し、同じ volume でコンテナを再作成します。Server は起動時に未適用の SQLite migration を実行し、停止時には 30 秒の期限内で
進行中の Run を完了させます:

```bash
docker compose pull
docker compose up -d
```

データ volume に書き込める Server コンテナは同時に 1 つだけです。古いコンテナが同じ volume を使っている間に新しいコンテナを起動しないでください。
本番をアップグレードする前に [quiesced backup](../container-delivery.md#6-持久化与恢复) を取ってください。
