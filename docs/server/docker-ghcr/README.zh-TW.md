# Docker 映像 (GHCR)

[English](README.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Русский](README.ru.md) | [Français](README.fr.md)

Open Flow 在 GitHub Packages 容器登錄庫 (GHCR) 發布預先建置的 Server 映像，不需要 clone 儲存庫或自行建置即可執行。映像名稱為:

```text
ghcr.io/oomol-lab/open-flow
```

映像內容與[容器交付參考](../container-delivery.md)描述的一致: 一個 Server 程序，包含 Workbench、Control API、Run runtime、Trigger runtime 和
SQLite migration。設定、健康檢查、持久化和備份在該文件中說明，這裡不再重複。

## 選擇 Tag

| Tag             | 指向                                            | 適用情境                         |
| --------------- | ----------------------------------------------- | -------------------------------- |
| `latest`        | 最新的穩定 Release                              | 需要目前穩定版 Server            |
| `<release-tag>` | 某個特定 Release，例如 `v0.1.0-beta.1` (不可變) | 生產部署，需要固定且可重現的建置 |
| `tip`           | `main` 分支最新 commit                          | 想試用尚未發布的變更             |
| `<short-sha>`   | `main` 分支某個特定 commit (不可變)             | 需要固定到某個精確的預發布建置   |

每個 GitHub Release 都會發布其 tag。穩定 Release 會同時移動 `latest`；pre-release 不會，因此 `latest` 不會指向 beta。每次推送到 `main`
都會發布 `tip` 和短 commit hash。同名 tag 會被較新的建置覆蓋，所以 `latest` 和 `tip` 會移動，而 Release tag 和 commit hash 固定不變。

Open Flow 目前處於 beta 階段: `latest` 會隨首個穩定 Release 出現，在此之前請使用 `tip` 或 beta Release tag，例如 `v0.1.0-beta.1`。生產環境請固定到 Release tag，不要使用 `latest`。

## 拉取

映像是公開的，不需要登入:

```bash
docker pull ghcr.io/oomol-lab/open-flow:tip
```

如果遇到 `unauthorized` 或 `denied` 錯誤，用具有 `read:packages` scope 的 GitHub token 登入:

```bash
echo "$GITHUB_TOKEN" | docker login ghcr.io -u <github-username> --password-stdin
```

映像是多架構的 (`linux/amd64` + `linux/arm64`)。每個架構都在原生機器上建置，Docker 會自動拉取與本機相符的版本，包括 Apple Silicon 和
AWS Graviton，不需要 `--platform` 參數。

## 執行

映像監聽 `3000` 連接埠，綁定 `0.0.0.0`，SQLite 儲存在 `/data/open-flow`。請在該路徑掛載 volume，讓資料在重新啟動後保留。

Server 可以從環境變數讀取 operator token。產生一個至少 32 位元組的 token 並妥善保存。它用於登入 Workbench，也可作為 Control API 的 Bearer token:

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

開啟 [http://127.0.0.1:3000](http://127.0.0.1:3000)，用該 token 登入。如果省略 `OPEN_FLOW_TOKEN`，首次啟動會在日誌中輸出一次性 setup code，
Workbench 會先要求輸入該 code 再設定 token；認領流程請參閱[啟動](../container-delivery.md#3-启动)。

要接入 Connector 或 LLM 服務，依[設定表](../container-delivery.md#4-配置)加入對應變數。
[自架組合指南](../self-hosted-stack/README.zh-TW.md)示範了如何用 OpenConnector 和 oo CLI 執行 Open Flow。

### Docker Compose

儲存庫根目錄提供 `docker-compose.yml`，以相同的連接埠和 volume 執行已發布的映像。其中列出的變數從你的 shell 讀取，未設定的會被省略，從而使用映像預設值:

```bash
export OPEN_FLOW_TOKEN="$(openssl rand -hex 32)"
docker compose up -d
docker compose logs -f open-flow
```

要執行指定 tag，在每次執行 compose 指令 (包括下面的升級指令) 之前先在 shell 中 export `OPEN_FLOW_IMAGE_TAG`，否則固定的 Release 會退回到 `tip`: `export OPEN_FLOW_IMAGE_TAG=v0.1.0-beta.1`。

### 從原始碼建置

如果要自行建置映像而不是拉取，加上 build overlay。它會建置 `apps/server/Dockerfile`，並用 `docker-compose.yml` 中相同的名稱打 tag:

```bash
docker compose -f docker-compose.yml -f docker-compose.build.yml up --build
```

## 升級

拉取新 tag，然後用同一個 volume 重新建立容器。Server 啟動時會執行待執行的 SQLite migration；停止時會在 30 秒期限內讓進行中的 Run 結束:

```bash
docker compose pull
docker compose up -d
```

同一時間只能有一個 Server 容器寫入資料卷。不要在舊容器仍在使用同一 volume 時啟動新容器；升級生產環境前先做
[quiesced backup](../container-delivery.md#6-持久化与恢复)。
