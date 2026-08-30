<div align="center">

# Open Flow

**在畫布上建立工作流程，需要時直接寫程式碼，最後部署到自己的環境。**

[English](../README.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Русский](README.ru.md) | [Français](README.fr.md)

[![CI](https://github.com/oomol-lab/open-flow/actions/workflows/ci.yaml/badge.svg)](https://github.com/oomol-lab/open-flow/actions/workflows/ci.yaml)
[![npm](https://img.shields.io/npm/v/%40oomol-lab%2Fopen-flow/next?label=%40oomol-lab%2Fopen-flow)](https://www.npmjs.com/package/@oomol-lab/open-flow)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](../LICENSE)
![Node.js 26](https://img.shields.io/badge/Node.js-26-339933)
![Bun 1.4](https://img.shields.io/badge/Bun-1.4-000000)

</div>

Open Flow 是一個開源工作流程自動化平台，AI Agent 和人可以在其中共同建立同一個 Flow。讓 Codex、Claude Code 或其他終端
Agent 透過 [`oo flow`](https://github.com/oomol-lab/oo-cli) 建立、檢查、執行和發布類型化工作流程，然後在 Workbench 中以視覺化方式檢視並繼續編輯同一個 Flow。

使用類型化節點定義結構，將自訂邏輯保留為 JavaScript，並在 OOMOL Hosted 或自己掌控的基礎設施上執行最終的自動化流程。流程圖始終容易理解，程式碼始終是程式碼，部署也始終由你掌控。

<p align="center">
  <a href="https://www.youtube.com/watch?v=CIF5I11VpLM">
    <img alt="觀看 Codex 使用 Open Flow 建立並執行 Gmail 到飛書工作流程的示範" src="assets/open-flow-demo-video.jpg" width="100%">
  </a>
</p>

<p align="center">
  <a href="https://www.youtube.com/watch?v=CIF5I11VpLM"><strong>▶ 觀看 1 分鐘 Open Flow 示範</strong></a>
</p>

> [!IMPORTANT]
> Open Flow 目前處於 Beta 階段。公開協定有版本管理，但產品尚未發布第一個穩定版本。

## 使用 AI Agent 建立工作流程

`oo flow` 將完整的創作生命週期開放為有版本、機器可讀的命令。能夠使用終端的 Agent 可以：

- 探索準確的 Connector Action 和 Provider Trigger；
- 建立和編輯類型化 Node、Edge、Code Task 和 Trigger binding；
- 檢查 Draft、執行它並讀取結果；
- 在你明確要求時發布到 Live，或在 Workbench 中開啟同一個 Flow。

> **範例請求：**「建立一個工作流程，讀取未讀 Gmail 郵件，整理格式後傳送到飛書。」

Agent 建立的是所選 Open Flow 部署中的真實 Draft，而不是用完即棄的本機設定。CLI 和 Workbench 使用同一個 Control API，因此 AI 建立的變更會立即出現在同一個視覺化流程圖中，並且人和 Agent 都可以繼續編輯。

<p align="center">
  <img alt="在 Open Flow Workbench 中成功執行的 Gmail 到飛書工作流程" src="assets/workbench-overview.png">
</p>

[安裝 `oo` CLI](https://github.com/oomol-lab/oo-cli)，即可透過 Codex、Claude Code 或其他終端 Agent 創作 Open Flow。

使用自己部署的 Open Flow 時，請在執行 Agent 的 shell 中設定 `OO_OPEN_FLOW_URL` 和 `OO_OPEN_FLOW_TOKEN`，見
[用 OpenConnector 和 oo CLI 執行 Open Flow](server/self-hosted-stack/README.zh-TW.md)。

## 選擇 Open Flow 的執行方式

三種支援的方式使用同一套 Open Flow 產品和 Workbench。

<table>
  <tr>
    <td width="33%" align="center"><strong>☁️ OOMOL Hosted</strong></td>
    <td width="33%" align="center"><strong>🐳 Docker Self-hosted</strong></td>
    <td width="33%" align="center"><strong>Fly.io Self-hosted</strong></td>
  </tr>
  <tr>
    <td width="33%" valign="top">無需準備、更新或監控伺服器，開啟即可使用。OOMOL 負責執行部署，並為支援的整合提供託管 OAuth App，省去固定伺服器成本和另外設定 OAuth App 的工作。</td>
    <td width="33%" valign="top">使用內建 Docker 映像檔在自己的基礎設施中執行。部署、儲存、備份、升級、網路以及 Connector 或 OAuth App 設定均由你管理。</td>
    <td width="33%" valign="top">在 Fly.io 上執行同一個 Docker 映像檔，無需自己維護伺服器。Fly 負責建置映像檔、終止 TLS 並把 SQLite 保存在持久化 volume 上；secret、備份、升級以及 Connector 或 OAuth App 設定均由你管理。</td>
  </tr>
  <tr>
    <td width="33%" align="center">🚀 <a href="https://oomol.com"><strong>使用 OOMOL Hosted</strong></a></td>
    <td width="33%" align="center"><a href="#快速開始"><strong>使用 Docker 自行部署</strong></a></td>
    <td width="33%" align="center"><a href="server/fly-io/README.zh-TW.md"><strong>部署到 Fly.io</strong></a></td>
  </tr>
</table>

## 為什麼選擇 Open Flow

- **使用 AI Agent 建立。** 在 Codex、Claude Code 或其他終端 Agent 中使用 `oo flow`，建立、檢查、執行和發布 Workbench 中的同一個 Flow。
- **明確呈現資料相依關係。** 每個 Task 都宣告具名、類型化的輸入和輸出。每條邊將一個特定輸出值綁定到一個特定輸入，因此流程圖就是執行階段使用的資料相依模型。
- **視覺化設計，需要時加入程式碼。** 在畫布上組合類型化節點，並使用 Code Task 撰寫自訂 JavaScript。程式碼始終清晰可見，不會隱藏在表單欄位中。
- **執行和偵錯在同一處。** 執行前檢查輸入和 Flow 結構，執行時查看每個節點的進度、輸出和完整事件記錄。
- **發布為長期執行的自動化。** Flow 可以手動啟動，也可以由 Cron、Webhook、輪詢資料來源或 Provider Event 觸發。
- **執行狀態集中管理。** Project、不可變的 Revision、Publication、Live 版本、Run 和 Trigger 狀態都由目前的部署管理，不會散落在本機檔案和隱藏服務中。
- **安全地執行使用者程式碼。** Server 在常駐的 Executor 程序中為每次程式碼 Task 呼叫建立全新的 V8 isolate，只開放該 Task 明確宣告的 Capability。
- **自由選擇執行環境。** 可以直接使用 OOMOL Hosted，也可以透過 Docker 在自己的基礎設施上執行儲存庫內建的 Server。

Open Flow 適合已經超出簡單無程式碼原型，但又不想變成一堆腳本和基礎設施的工作流程。

## 流程圖就是執行階段契約

每個 Task 都宣告具名、類型化的輸入和輸出。每條邊將一個特定輸出值傳遞給一個特定輸入；當節點的輸入就緒時，執行階段才會啟動該節點。

流程圖呈現的正是執行階段實際使用的資料相依關係：一般 Flow 資料不能透過隱藏的執行階段儲存空間從任意節點讀取。彼此獨立的分支可以並行執行，節點在畫布上的位置永遠不會改變執行行為。

### 類型化視覺編排

詳細檢視會在畫布上明確顯示每個輸入、輸出、類型、可為空限制和連接關係。

<p align="center">
  <img src="assets/typed-node-details.jpg" alt="Typed input and output handles in the Open Flow Workbench detailed view">
</p>

### 在合適的位置撰寫程式碼

Code Task 將自訂 JavaScript 直接放在流程圖中，並保留類型化的輸入和輸出。

<p align="center">
  <img src="assets/code-task-editor.jpg" alt="Editing a custom Code Task in the Open Flow Workbench">
</p>

## 運作方式

```mermaid
flowchart LR
  Workbench["Workbench"] -->|"Control API"| Server["Open Flow"]
  CLI["oo flow CLI"] -->|"Control API"| Server
  Server -. "選用" .-> Connector["Connector 執行環境"]
  Connector --> Providers["第三方 Provider"]
  Server --> Store["SQLite：Project、Revision、Publication、Run"]
  Server --> Triggers["Trigger 排程：Cron、Webhook、Poll、Integration"]
  Server --> Runtime["隔離的 JavaScript 執行環境"]
```

Workbench 和 CLI 只透過有版本的 Control API 與目前選定的一個部署通訊。部署端負責 validation、執行、持久化和 Trigger 准入。Provider
憑證不會進入 Open Flow：Connector Action、Provider Trigger 和 proxy 都經由
[OpenConnector](https://github.com/oomol-lab/open-connector) 這類 Connector 執行環境完成，Open Flow 只保存不透明的 Connection 識別。

## 快速開始

準備好 [Docker](https://docs.docker.com/get-docker/) 和 OpenSSL，然後複製儲存庫、產生管理員 Token 並啟動 Server：

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

開啟 [http://127.0.0.1:3000](http://127.0.0.1:3000)，使用 `OPEN_FLOW_TOKEN` 的值登入。同一個值也可以作為 Control API 的 Bearer Token
供機器用戶端使用。Project 和 Run 歷史會儲存在 `open-flow-data` Docker volume 中。

不接外部服務時，Server 仍然可以獨立使用。Connector Action、Provider Trigger 和 LLM Task 在沒有設定對應 Host Capability
時會拒絕執行，不會退回到來源不明的服務。

正式環境所需的設定、TLS、健康檢查、資料持久化、備份和資源限制，請參閱
[Server 部署文件](server/container-delivery.md) 和 [SECURITY.md](../SECURITY.md#hardening-your-deployment) 中的強化清單。

## 部署到 Fly.io

同一個映像也可以部署到 Fly.io。儲存庫內建的 `fly.toml` 使用 `apps/server/Dockerfile` 建置映像，保持一台 machine 常駐以執行 Cron 和 Poll
Trigger，並把 SQLite 持久化到 Fly volume。Fly app 建立、volume、secret、部署、自訂網域和擴縮容限制請參閱 [Fly.io 部署](server/fly-io/README.zh-TW.md)。

## 接入 Connector

要對 GitHub、Gmail、Slack、Notion 等服務執行 Action 和 Provider Trigger，需要把 Server 指向一個 Connector 執行環境。自行部署的
[OpenConnector](https://github.com/oomol-lab/open-connector) 和 OOMOL 託管的 Connector 都提供所需的執行環境 API。

<p align="center">
  <img src="assets/connector-actions.jpg" alt="Browsing Gmail Provider Triggers and Actions in the Open Flow Workbench">
</p>

```dotenv
OPEN_FLOW_CONNECTOR_ORIGIN=http://open-connector:3000
OPEN_FLOW_CONNECTOR_TOKEN=replace-with-a-scoped-runtime-token
OPEN_FLOW_CONNECTOR_CONSOLE_ORIGIN=https://connector.example.com
```

runtime origin 是 Server 存取 Connector 的位址，console origin 是使用者瀏覽器開啟 Connector Console 授權帳號的位址。Provider Trigger
定義隨 Open Flow 內建，不需要額外註冊。Integration callback 的設定和各 origin 的限制請參閱
[設定說明](server/container-delivery.md#4-配置)。

要同時啟動 OpenConnector 和 Open Flow、建立 runtime token、授權帳號並用 `oo flow` 建立第一個 Flow，見
[用 OpenConnector 和 oo CLI 執行 Open Flow](server/self-hosted-stack/README.zh-TW.md)。

## 一套產品，多種部署

Workbench 和 CLI 透過有版本的 Control API 運作，不依賴特定資料庫或雲端執行環境。部署端負責執行和持久化；用戶端不會建立第二套本機
Project 格式，也不會在請求失敗時暗中切換後端。

儲存庫主要包含：

- [`packages/open-flow`](../packages/open-flow)：公開的 `@oomol-lab/open-flow` npm 套件，提供 Authoring、Execution、Trigger、Control
  API、Conformance 和 Workbench Runtime 進入點；
- [`packages/command`](../packages/command)：`oo flow` 命令執行環境和交付給 [oo CLI](https://github.com/oomol-lab/oo-cli) 的不可變
  Command Artifact；
- [`apps/server`](../apps/server)：可自行部署的 Workbench、Control API、SQLite 儲存、Trigger Scheduler 和隔離的 JavaScript Runtime。

長期成立的產品模型記錄在[產品與架構邊界](architecture.md)中，HTTP 介面定義請參閱
[Control API 文件](control/contracts/control-api.md)。

## 從原始碼開發

Open Flow 的工作區使用 [Bun](https://bun.sh/)，Server 執行在 Node.js 上。請使用 `.bun-version` 和 `.node-version` 中固定的版本。

```bash
bun install --frozen-lockfile
bun run dev
```

開發環境的 Workbench 位於 [http://127.0.0.1:5173](http://127.0.0.1:5173)，API 請求會代理到
`http://127.0.0.1:3000` 上的 Server。

第一次啟動開發環境時，Server 會把管理員 Token 寫入 `apps/server/.open-flow-dev/operator-token`，後續啟動繼續使用同一個
Token，因此重新啟動開發服務不會讓目前的 Workbench 登入狀態失效。如果需要指定 Token，可以設定 `OPEN_FLOW_TOKEN`。

提交程式碼前請執行：

```bash
bun run check
bun run test
bun run build
```

修改發布套件或 CLI 時加跑 `bun run test:package`；本機有 Docker 時執行 `bun run test:docker`，檢查發布映像檔、隔離執行環境、Workbench、正常結束和
SQLite volume 復原。不要在儲存庫根目錄直接執行 `bun test`，它會繞過各工作區的測試腳本。完整的開發規則請參閱 [CONTRIBUTING.md](../CONTRIBUTING.md)。

## 文件

可以從[文件索引](README.md)開始，常用內容包括：

- [產品與架構邊界](architecture.md)
- [Control API](control/contracts/control-api.md)
- [Command Artifact 發布合約](distribution/command-artifact.md)
- [Workbench 與 Designer 前端注意事項](authoring/frontend-ui.md)
- [Server 部署](server/container-delivery.md)
- [Fly.io 部署](server/fly-io/README.zh-TW.md)
- [用 OpenConnector 和 oo CLI 執行 Open Flow](server/self-hosted-stack/README.zh-TW.md)
- [參與貢獻](../CONTRIBUTING.md)
- [行為準則](../CODE_OF_CONDUCT.md)
- [安全政策](../SECURITY.md)

## 相關專案

- [OpenConnector](https://github.com/oomol-lab/open-connector)：開源的 Connector 閘道，為 Connector 節點提供 Provider 目錄、憑證管理和
  Action 執行。
- [oo CLI](https://github.com/oomol-lab/oo-cli)：本機 Agent 工具組，承載由本儲存庫建置的 `oo flow` 命令。

## 參與貢獻

歡迎提交 Issue 和 Pull Request。開發環境、儲存庫規則和提交前需要執行的檢查請參閱 [CONTRIBUTING.md](../CONTRIBUTING.md)。參與本專案需遵守
[CODE_OF_CONDUCT.md](../CODE_OF_CONDUCT.md)。

## 安全

請透過 [GitHub 私密漏洞回報](https://github.com/oomol-lab/open-flow/security/advisories/new) 回報安全問題，不要提交公開
Issue。[SECURITY.md](../SECURITY.md) 說明了受支援的版本、揭露流程、回報範圍以及自行部署時的強化建議。

## 授權條款

[Apache-2.0](../LICENSE)。打包資源涉及的第三方聲明請參閱 [NOTICE](../NOTICE)。

## 貢獻者

感謝每一位參與建設 Open Flow 的貢獻者。歡迎參閱 [貢獻指南](../CONTRIBUTING.md)，加入我們。

[![Open Flow 貢獻者](https://contrib.rocks/image?repo=oomol-lab/open-flow)](https://github.com/oomol-lab/open-flow/graphs/contributors)

## Star 歷史

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../assets/star-history/star-history-dark.svg">
  <img alt="Star history" src="../assets/star-history/star-history-light.svg">
</picture>
