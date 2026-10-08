<div align="center">

<img src="../assets/logo/open-flow-wordmark-auto.svg" alt="Open Flow" width="280" height="64" />

**在画布上搭工作流，需要时直接写代码，最后部署到自己的环境。**

[English](../README.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Русский](README.ru.md) | [Français](README.fr.md)

[![CI](https://github.com/oomol-lab/open-flow/actions/workflows/ci.yaml/badge.svg)](https://github.com/oomol-lab/open-flow/actions/workflows/ci.yaml)
[![npm](https://img.shields.io/npm/v/%40oomol-lab%2Fopen-flow/next?label=%40oomol-lab%2Fopen-flow)](https://www.npmjs.com/package/@oomol-lab/open-flow)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](../LICENSE)
![Node.js 26](https://img.shields.io/badge/Node.js-26-339933)
![Bun 1.4](https://img.shields.io/badge/Bun-1.4-000000)

</div>

**和 AI Agent 一起搭建自动化，让每一步执行清晰可见。**

Open Flow 是一个开源工作流平台，把 AI 辅助构建的速度与可视化工作流的清晰结构结合起来。让 Codex、Claude Code 或其他 Agent 创建一个 Flow，在 Workbench 中打开它，然后继续一起完善同一个工作流。

在一张画布上组合 JavaScript、应用集成、AI、条件分支和人工审批。查看输入、跟踪执行，并决定哪个版本正式上线。可以使用 OOMOL Hosted，也可以部署到自己的基础设施。

[体验交互演示](https://openflow.run) · [使用 OOMOL Hosted](https://oomol.com) · [用 Docker 自部署](#选择适合你的运行方式)

![新版 Open Flow Workbench 中的客户入门流程，包含显式客户数据、JavaScript、审批和子流程](assets/readme-workbench.png)

> [!IMPORTANT]
> Open Flow 目前处于 Beta 阶段，产品及其版本化契约仍在持续演进。

## Agent 负责搭建，你来掌控

描述你需要完成的工作：

> “读取新的客服邮件，对请求分类，起草回复，并在发送前请我审批。”

终端 Agent 可以通过 [`oo flow`](https://github.com/oomol-lab/oo-cli) 发现集成、创建和编辑节点、检查草稿、运行流程、查看结果，并在你要求时发布。它的改动会出现在你用来查看流程图和编辑代码的同一个 Workbench 中，无需转换或同步另一套 AI 生成的项目。

Server 也为兼容的客户端提供 [MCP 编排和运行工具](server/mcp.md)。两种接口都操作所选部署中保存的 Flow、修订版本和运行记录。

把重复的连线工作交给 Agent，让重要的决策始终清晰可见。

## 每一步都能看清楚

即使创建工作流时的对话早已结束，工作流本身也应该容易理解。

- **用 JavaScript 完成精确的工作。** 在 Code Task 中转换数据、格式化消息或编写自定义逻辑，输入和输出都有明确的名称与类型。
- **显式声明输入来源。** 在属性面板中查看值从哪里来。控制连线决定接下来执行什么，输入映射决定每一步接收什么数据。
- **条件分支与可复用的子流程。** 通过条件分派工作，为重复使用的逻辑定义清晰的接口。
- **把说明留在工作旁边。** 直接在画布上解释某个决策，让接手的人理解意图。

![新版 Code Task 属性面板，展示 JavaScript、客户输入来源和带类型的消息输出](assets/readme-code.png)

## 给 AI 明确的任务和边界

用 LLM Task 完成分类、提取或摘要；需要多次工具调用时，使用 Agent Task。在需要可预测行为的地方，搭配普通代码、条件和审批。

Agent Task 使用已配置的模型、明确声明的工具和执行限制。工具配置规定模型可以使用哪些操作、账号和审批策略。你可以要求某次工具调用经过人工批准，也可以在工作流中加入 Approval 节点，让后续步骤等待审批。

Approval 和 Wait 节点会持久化等待状态。作出决定后，流程可以继续执行，无需重跑这次运行中已经完成的步骤。

## 看清执行过程，决定哪个版本上线

从选定的触发器测试草稿，在 Workbench 中跟踪执行。查看节点结果、日志、错误和待办审批，无需只凭最后一条消息猜测整个过程。运行历史保留执行记录与对应修订版本之间的关联。

![Open Flow Workbench 中等待人工审批的客户入门测试流程](assets/readme-approval.png)

发布会为 Live 自动化创建带版本的快照。已发布版本继续运行时，你可以继续编辑草稿、查看历史 Publication，并在需要时回滚。

手动启动流程，或通过定时计划、Webhook、支持的服务事件与轮询数据源触发。同一个部署管理工作流、Live 版本和执行状态。

## 连接应用，凭据不进入流程图

Open Flow 通过 [OpenConnector](https://github.com/oomol-lab/open-connector) 等 Connector 运行时发现和执行 Gmail、Slack、GitHub、Notion 等服务的操作。账号凭据由 Connector 保管，工作流只引用 Connection 标识。

OOMOL Hosted 为支持的集成提供托管 OAuth 应用。自部署时，你选择 Connector 的部署方式，并管理所需的服务配置和账号授权。工作流逻辑与账号访问权限各自独立。

完整配置步骤，包括授权账号和创建第一个 Flow，见[用 OpenConnector 和 oo CLI 运行 Open Flow](server/self-hosted-stack/README.zh-CN.md)。

## 选择适合你的运行方式

| 方式             | 你需要管理什么                                     | 开始使用                                  |
| ---------------- | -------------------------------------------------- | ----------------------------------------- |
| **OOMOL Hosted** | 工作流和已连接的账号；OOMOL 负责运行部署。         | [打开 OOMOL](https://oomol.com)           |
| **Docker**       | 部署、存储、备份、升级和集成。                     | 下方命令                                  |
| **Fly.io**       | Fly 基础设施上的应用、持久化卷、密钥、备份和升级。 | [部署指南](server/fly-io/README.zh-CN.md) |

要在本机自行部署，请安装 Docker 和 OpenSSL，然后运行：

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

打开 [http://127.0.0.1:3000](http://127.0.0.1:3000)，使用 `OPEN_FLOW_TOKEN` 登录。Flow 和运行历史保存在 Docker 卷中。这个管理员令牌也用于 CLI 和 API 认证。

希望使用预构建镜像？请参阅 [GHCR 镜像指南](server/docker-ghcr/README.zh-CN.md)，并在 Beta 阶段选择明确的发布标签。`latest` 标签留给稳定版本。

Connector 操作和 LLM Task 需要配置相应的服务。Server 不会悄悄切换到其他服务提供方。将部署开放到公网前，请遵循[部署指南](server/container-delivery.md)和[加固清单](../SECURITY.md#hardening-your-deployment)。

## 基于 Open Flow 开发

Open Flow 使用 Apache-2.0 许可证。仓库包含工作流契约与运行时、Workbench、CLI 命令包和可自行部署的 Server。版本化的 Control API 让客户端不依赖部署内部的存储和执行实现。

请使用 `.bun-version` 和 `.node-version` 中固定的 Bun 与 Node.js 版本：

```bash
bun install --frozen-lockfile
bun run dev
```

开发环境的 Workbench 位于 [http://localhost:5174](http://localhost:5174)。首次运行会在 `apps/server/.open-flow-dev/operator-token` 中生成管理员令牌。配置、检查和组件 Lab 的说明见 [CONTRIBUTING.md](../CONTRIBUTING.md)。

| 了解更多                 | 参考资料                                                                                                                        |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| 产品模型和运行时边界     | [架构](architecture.md)                                                                                                         |
| 集成自己的客户端         | [Control API](control/contracts/control-api.md) · [MCP](server/mcp.md)                                                          |
| 部署与运维               | [Server](server/container-delivery.md) · [Docker](server/docker-ghcr/README.zh-CN.md) · [Fly.io](server/fly-io/README.zh-CN.md) |
| 连接应用和 AI 编程 Agent | [OpenConnector + oo CLI](server/self-hosted-stack/README.zh-CN.md)                                                              |
| 浏览全部文档             | [文档索引](README.md)                                                                                                           |

## 相关项目

- [OpenConnector](https://github.com/oomol-lab/open-connector)：开源的 Connector 网关，为 Connector 节点提供 Provider 目录、凭据管理和
  Action 执行。
- [oo CLI](https://github.com/oomol-lab/oo-cli)：本地 Agent 工具集，承载由本仓库构建的 `oo flow` 命令。

## 参与贡献

欢迎提交 Issue 和 Pull Request。开发环境、仓库规则和提交前需要运行的检查见 [CONTRIBUTING.md](../CONTRIBUTING.md)。参与本项目需遵守
[CODE_OF_CONDUCT.md](../CODE_OF_CONDUCT.md)。

## 安全

请通过 [GitHub 私密漏洞报告](https://github.com/oomol-lab/open-flow/security/advisories/new) 报告安全问题，不要提交公开
Issue。[SECURITY.md](../SECURITY.md) 说明了受支持的版本、披露流程、报告范围以及自行部署时的加固建议。

## 许可证

[Apache-2.0](../LICENSE)。打包资源涉及的第三方声明见 [NOTICE](../NOTICE)。

## 贡献者

感谢每一位参与建设 Open Flow 的贡献者。欢迎查看 [贡献指南](../CONTRIBUTING.md)，加入我们。

[![Open Flow 贡献者](https://contrib.rocks/image?repo=oomol-lab/open-flow)](https://github.com/oomol-lab/open-flow/graphs/contributors)

## Star 历史

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../assets/star-history/star-history-dark.svg">
  <img alt="Star history" src="../assets/star-history/star-history-light.svg">
</picture>
