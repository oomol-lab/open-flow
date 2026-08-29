# Open Flow 文档

Open Flow 提供公共产品合同、Workbench runtime、CLI runtime 与完整 Server 实现。产品边界、所有权与运行时不变量只以
[产品与架构边界](architecture.md)为准；Workbench 和 CLI 在一个 session 中只连接一个 Control API deployment，不能把本地
旧 Project、YAML、DeploymentPackage、provider carrier 或另一部署实现当作 fallback。

## 当前产品与合同

- [产品与架构边界](architecture.md)
- [Control API P0 / P1 / P2 / P3 合同](control/contracts/control-api.md)
- [Command Artifact v2 分发合同](distribution/command-artifact.md)
- [Workbench 与 Designer 前端注意事项](authoring/frontend-ui.md)

## Server 实施参考

- [Server 容器交付参考](server/container-delivery.md)
- [Fly.io 部署](server/fly-io/README.zh-CN.md) ([English](server/fly-io/README.md))
- [用 OpenConnector 和 oo CLI 运行 Open Flow](server/self-hosted-stack/README.zh-CN.md) ([English](server/self-hosted-stack/README.md))
