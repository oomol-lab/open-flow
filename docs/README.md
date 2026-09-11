# Open Flow 文档

Open Flow 提供公共产品合同、Workbench runtime、CLI runtime 与完整 Server 实现。产品边界、所有权与运行时不变量只以
[产品与架构边界](architecture.md)为准；Workbench 和 CLI 在一个 session 中只连接一个 Control API deployment，不能把本地
旧 Project、YAML、DeploymentPackage、provider carrier 或另一部署实现当作 fallback。

## 当前产品与合同

- [产品与架构边界](architecture.md)
- [Control API 技术参考](control/contracts/control-api.md)
- [公共契约与版本演进](control/contracts/compatibility.md)
- [Node compatibility runtime contract](control/contracts/nodejs-runtime.md)
- [Command Artifact v2 分发合同](distribution/command-artifact.md)
- [Flow 命令调用合同](authoring/flow-command.md)
- [Workbench 与 Designer 前端注意事项](../.agents/skills/frontend-ui/SKILL.md)

## Server 实施参考

- [Server 容器交付参考](server/container-delivery.md)
- [MCP 入口](server/mcp.md)
- [Docker 镜像 (GHCR)](server/docker-ghcr/README.zh-CN.md) ([English](server/docker-ghcr/README.md))
- [Fly.io 部署](server/fly-io/README.zh-CN.md) ([English](server/fly-io/README.md))
- [用 OpenConnector 和 oo CLI 运行 Open Flow](server/self-hosted-stack/README.zh-CN.md) ([English](server/self-hosted-stack/README.md))

## 历史记录

- [阶段计划索引](plans/README.md)
