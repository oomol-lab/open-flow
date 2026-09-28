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

**和 AI Agent 一起建立自動化，讓每一步執行清楚可見。**

Open Flow 是一個開源工作流程平台，結合 AI 輔助建構的速度與視覺化工作流程的清晰結構。讓 Codex、Claude Code 或其他 Agent 建立一個 Flow，在 Workbench 中開啟，再一起持續完善同一個工作流程。

在一張畫布上組合 JavaScript、應用程式整合、AI、條件分支和人工核准。檢視輸入、追蹤執行，並決定哪個版本正式上線。可以使用 OOMOL Hosted，也可以部署到自己的基礎設施。

[體驗互動示範](https://openflow.run) · [使用 OOMOL Hosted](https://oomol.com) · [用 Docker 自行部署](#選擇適合你的執行方式)

![新版 Open Flow Workbench 中的客戶入門流程，包含明確的客戶資料、JavaScript、核准和子流程](assets/readme-workbench.png)

> [!IMPORTANT]
> Open Flow 目前處於 Beta 階段，產品及其版本化契約仍在持續演進。

## Agent 負責建構，由你掌控

描述你需要完成的工作：

> 「讀取新的客服郵件，將請求分類，草擬回覆，並在寄出前請我核准。」

終端機 Agent 可以透過 [`oo flow`](https://github.com/oomol-lab/oo-cli) 探索整合、建立和編輯節點、檢查草稿、執行流程、檢視結果，並在你要求時發佈。它的變更會出現在你用來檢視流程圖和編輯程式碼的同一個 Workbench 中，無須轉換或同步另一套 AI 產生的專案。

Server 也為相容的用戶端提供 [MCP 編排與執行工具](server/mcp.md)。兩種介面都操作所選部署中儲存的 Flow、修訂版本和執行紀錄。

把重複的連線工作交給 Agent，讓重要的決策始終清楚可見。

## 每一步都能看清楚

即使建立工作流程時的對話早已結束，工作流程本身也應該容易理解。

- **用 JavaScript 完成精確的工作。** 在 Code Task 中轉換資料、格式化訊息或撰寫自訂邏輯，輸入和輸出都有明確的名稱與型別。
- **明確宣告輸入來源。** 在屬性面板中檢視值從哪裡來。控制連線決定接下來執行什麼，輸入對應決定每一步接收什麼資料。
- **條件分支與可重用的子流程。** 透過條件分派工作，為重複使用的邏輯定義清楚的介面。
- **把說明留在工作旁邊。** 直接在畫布上解釋某個決策，讓接手的人理解意圖。

![新版 Code Task 屬性面板，展示 JavaScript、客戶輸入來源和帶型別的訊息輸出](assets/readme-code.png)

## 給 AI 明確的任務和邊界

用 LLM Task 完成分類、擷取或摘要；需要多次工具呼叫時，使用 Agent Task。在需要可預測行為的地方，搭配一般程式碼、條件和核准。

Agent Task 使用已設定的模型、明確宣告的工具和執行限制。工具設定規定模型可以使用哪些操作、帳號和核准政策。你可以要求某次工具呼叫經過人工核准，也可以在工作流程中加入 Approval 節點，讓後續步驟等待核准。

Approval 和 Wait 節點會持久化等待狀態。作出決定後，流程可以繼續執行，無須重跑這次執行中已完成的步驟。

## 看清執行過程，決定哪個版本上線

從選定的觸發器測試草稿，在 Workbench 中追蹤執行。檢視節點結果、記錄、錯誤和待核准項目，無須只憑最後一則訊息猜測整個過程。執行歷史保留執行紀錄與對應修訂版本之間的關聯。

![Open Flow Workbench 中等待人工核准的客戶入門測試流程](assets/readme-approval.png)

發佈會為 Live 自動化建立帶版本的快照。已發佈版本持續執行時，你可以繼續編輯草稿、檢視歷史 Publication，並在需要時回復先前版本。

手動啟動流程，或透過排程、Webhook、支援的服務事件與輪詢資料來源觸發。同一個部署管理工作流程、Live 版本和執行狀態。

## 連接應用程式，憑證不進入流程圖

Open Flow 透過 [OpenConnector](https://github.com/oomol-lab/open-connector) 等 Connector 執行環境探索和執行 Gmail、Slack、GitHub、Notion 等服務的操作。帳號憑證由 Connector 保管，工作流程只參照 Connection 識別碼。

OOMOL Hosted 為支援的整合提供託管 OAuth 應用程式。自行部署時，你選擇 Connector 的部署方式，並管理所需的服務設定和帳號授權。工作流程邏輯與帳號存取權限各自獨立。

完整設定步驟，包括授權帳號和建立第一個 Flow，請見[搭配 OpenConnector 和 oo CLI 使用 Open Flow](server/self-hosted-stack/README.zh-TW.md)。

## 選擇適合你的執行方式

| 方式             | 你需要管理什麼                                             | 開始使用                                  |
| ---------------- | ---------------------------------------------------------- | ----------------------------------------- |
| **OOMOL Hosted** | 工作流程和已連接的帳號；OOMOL 負責維運部署。               | [開啟 OOMOL](https://oomol.com)           |
| **Docker**       | 部署、儲存、備份、升級和整合。                             | 下方指令                                  |
| **Fly.io**       | Fly 基礎設施上的應用程式、持久化磁碟區、密鑰、備份和升級。 | [部署指南](server/fly-io/README.zh-TW.md) |

若要在本機自行部署，請安裝 Docker 和 OpenSSL，然後執行：

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

開啟 [http://127.0.0.1:3000](http://127.0.0.1:3000)，使用 `OPEN_FLOW_TOKEN` 登入。Flow 和執行歷史儲存在 Docker 磁碟區中。這個管理員權杖也用於 CLI 和 API 驗證。

想使用預先建置的映像檔？請參閱 [GHCR 映像檔指南](server/docker-ghcr/README.zh-TW.md)，並在 Beta 階段選擇明確的發佈標籤。`latest` 標籤保留給穩定版本。

Connector 操作和 LLM Task 需要設定對應的服務。Server 不會暗中切換到其他服務供應商。將部署開放至公網前，請遵循[部署指南](server/container-delivery.md)和[強化安全清單](../SECURITY.md#hardening-your-deployment)。

## 以 Open Flow 為基礎開發

Open Flow 採用 Apache-2.0 授權。儲存庫包含工作流程契約與執行環境、Workbench、CLI 指令套件和可自行部署的 Server。版本化的 Control API 讓用戶端不依賴部署內部的儲存和執行實作。

請使用 `.bun-version` 和 `.node-version` 中固定的 Bun 與 Node.js 版本：

```bash
bun install --frozen-lockfile
bun run dev
```

開發環境的 Workbench 位於 [http://localhost:5174](http://localhost:5174)。首次執行會在 `apps/server/.open-flow-dev/operator-token` 中產生管理員權杖。設定、檢查和元件 Lab 的說明請見 [CONTRIBUTING.md](../CONTRIBUTING.md)。

| 深入了解                         | 參考資料                                                                                                                        |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 產品模型與執行環境邊界           | [架構](architecture.md)                                                                                                         |
| 整合自己的用戶端                 | [Control API](control/contracts/control-api.md) · [MCP](server/mcp.md)                                                          |
| 部署與維運                       | [Server](server/container-delivery.md) · [Docker](server/docker-ghcr/README.zh-TW.md) · [Fly.io](server/fly-io/README.zh-TW.md) |
| 連接應用程式和 AI 程式設計 Agent | [OpenConnector + oo CLI](server/self-hosted-stack/README.zh-TW.md)                                                              |
| 瀏覽全部文件                     | [文件索引](README.md)                                                                                                           |

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
