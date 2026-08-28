# Fly.io 部署

[English](README.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Русский](README.ru.md) | [Français](README.fr.md)

Open Flow Server 可以作為 Node Docker runtime 部署到 Fly.io。本部署使用儲存庫的 `apps/server/Dockerfile`、儲存庫根目錄的
Fly app 設定檔 `fly.toml`，以及掛載到 `/data/open-flow` 的 Fly volume。Fly 負責 TLS 終止、遠端 Docker 建置、健康檢查、
滾動部署和選用的自訂網域。

部署邊界與[容器交付參考](../container-delivery.md)相同：單一 Server machine、單一 SQLite writer。machine 數量不可超過 1。

## 前提條件

- Fly.io 帳號。
- 已安裝 `flyctl`，並透過 `fly auth login` 完成登入。
- 本機可用的 Docker，或使用 Fly remote builder。`apps/server/Dockerfile` 使用 BuildKit 語法，remote builder 支援該語法。

## 建立 App

先建立 Fly app，暫不部署：

```bash
fly apps create my-open-flow
```

Fly app 名稱全域唯一。如果選用其他名稱，部署前請更新 `fly.toml` 中的 `app` 欄位：

```toml
app = "my-open-flow"
```

## 建立持久化儲存

映像檔把 SQLite 保存在 `/data/open-flow`。建立與 `fly.toml` 中 source 同名的 Fly volume：

```bash
fly volumes create open_flow_data \
  --region iad \
  --size 1 \
  --app my-open-flow
```

Run 歷史和 RunEvent 會隨時間持續增長。預期 Run 數量較多時請加大 `--size`，或之後用 `fly volumes extend` 擴充 volume。

## 設定 secret

operator token 至少要包含 32 個 UTF-8 bytes。請把它儲存為 Fly secret，不要提交到 `fly.toml` 中：

```bash
OPEN_FLOW_TOKEN="$(openssl rand -hex 32)"

fly secrets set \
  OPEN_FLOW_TOKEN="$OPEN_FLOW_TOKEN" \
  --app my-open-flow
```

請把 `OPEN_FLOW_TOKEN` 保存在密碼管理器中。同一個值既用於登入 Workbench，也作為 Control API 的 Bearer token。

`fly.toml` 已把 `OPEN_FLOW_SESSION_COOKIE_SECURE` 設為 `true`：`force_https` 會重新導向明文 HTTP 請求，因此瀏覽器只會透過
TLS 存取 Server。

需要 Connector 時再設定 Connector secret：

```bash
fly secrets set \
  OPEN_FLOW_CONNECTOR_ORIGIN="https://connector.example.com" \
  OPEN_FLOW_CONNECTOR_TOKEN="replace-with-a-scoped-runtime-token" \
  OPEN_FLOW_CONNECTOR_CONSOLE_ORIGIN="https://connector.example.com" \
  --app my-open-flow
```

OpenConnector 執行在同一個 Fly organization 時，runtime origin 可以使用 Fly 私有網路，例如
`http://my-open-connector.internal:3000`。console origin 仍然必須是使用者瀏覽器可以開啟的公開 HTTPS origin。

需要 Provider Integration 時再設定 callback origin 和 key：

```bash
fly secrets set \
  OPEN_FLOW_INTEGRATION_PUBLIC_ORIGIN="https://my-open-flow.fly.dev" \
  OPEN_FLOW_INTEGRATION_CALLBACK_KEY="$(openssl rand -hex 32)" \
  --app my-open-flow
```

`fly secrets set` 會重新部署 machine。完整的環境變數清單和各 origin 的限制請參閱
[容器交付參考](../container-delivery.md#4-配置)。

## 部署

從儲存庫根目錄部署：

```bash
fly deploy --config fly.toml --remote-only --ha=false
```

`--ha=false` 可阻止 Fly 為新 app 建立第二台 machine。Server 只允許一個 SQLite writer，而每台 machine 各自掛載獨立的 volume，
因此兩台 machine 會持有兩份互不相關的狀態。之後每次部署都要保持 machine 數量為 1，也不要用 `fly scale count` 提高數量。

Fly 設定使用：

- `apps/server/Dockerfile` 建置映像檔，建置上下文為儲存庫根目錄。
- `internal_port = 3000`，即映像檔的預設連接埠。
- `GET /readyz` 作為 HTTP 健康檢查。Server 啟動中、背景處理已停止或設定的 Connector 無法連線時，它會回傳 503；Fly 隨即停止把流量
  轉發到該 machine，並讓部署失敗。只需要存活檢查時，可把路徑改為 `/healthz`。
- `kill_signal = "SIGTERM"` 和 `kill_timeout = "45s"`。Server 最多等待 30 秒完成 Run drain 並關閉 SQLite，因此寬限期必須超過
  30 秒。
- `auto_stop_machines = "off"` 和 `min_machines_running = 1`。Cron 和 Poll Trigger 只在 machine 執行期間觸發。

## 驗證執行環境

```bash
curl https://my-open-flow.fly.dev/healthz
curl https://my-open-flow.fly.dev/readyz
```

預期回應分別為 `{"status":"ok"}` 和 `{"status":"ready"}`。開啟 `https://my-open-flow.fly.dev`，用 `OPEN_FLOW_TOKEN` 登入
Workbench。

診斷部署或啟動問題時查看日誌：

```bash
fly logs --app my-open-flow
```

## 自訂網域

向 Fly 註冊網域：

```bash
fly certs add flow.example.com --app my-open-flow
```

Fly 會列出需要建立的 DNS 記錄。DNS 就緒後，檢查憑證狀態：

```bash
fly certs check flow.example.com --app my-open-flow
```

若已設定 Integration callback，請把 `OPEN_FLOW_INTEGRATION_PUBLIC_ORIGIN` 指向新網域：

```bash
fly secrets set \
  OPEN_FLOW_INTEGRATION_PUBLIC_ORIGIN="https://flow.example.com" \
  --app my-open-flow
```

## 更新

```bash
git pull
fly deploy --config fly.toml --remote-only
```

volume 會保留 `open-flow.sqlite` 及其 WAL 和 SHM 檔案。SQLite migration 會在 Server 啟動時依序執行，不需要額外步驟。

## 備份

Fly 會自動建立 volume snapshot，但 Server 只承諾 quiesced backup。需要一致的備份時，請先停止 machine，再建立 snapshot：

```bash
fly machine stop <machine-id> --app my-open-flow
fly volumes snapshots create <volume-id> --app my-open-flow
fly volumes snapshots list <volume-id> --app my-open-flow
fly machine start <machine-id> --app my-open-flow
```

snapshot 會非同步建立。請保持 machine 停止，直到 `fly volumes snapshots list` 顯示新 snapshot 的狀態為 `created`，再啟動 machine。

id 可透過 `fly machine list` 和 `fly volumes list` 取得。

## 擴縮容與閒置 machine

- 保持 machine 數量為 1。需要更多容量時，修改 `fly.toml` 中 `[[vm]]` 下的 `size` 和 `memory`，然後重新部署。
- 預設為 `memory = "1gb"`。每個 Run 的 Isolated VM 預設上限為 128 MB，`OPEN_FLOW_MAX_CONCURRENT_RUNS` 預設為 4，Node 程序本身也
  需要記憶體。提高並行上限時請一併提高記憶體。
- 如果只使用手動 Run 和 Webhook，而且可以接受冷啟動，可設定 `auto_stop_machines = "suspend"` 和 `min_machines_running = 0`。
  machine 暫停期間 Cron 和 Poll Trigger 不會觸發，首個 Webhook 請求要等待 machine 喚醒。
