# Trigger 改造发布基线

核实日期：2026 年 10 月 26 日。发布记录与本地 checkout 分开记录；以下发布版本不代表当前线上实例版本。

| 项目            | 已核实发布记录                                                                                | 本次实施 checkout                                                       |
| --------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Open Flow       | npm `next` 为 `0.1.0-beta.70`，registry gitHead 为 `45f7f5660295fc6280ca0ecaf474356eee60f929` | `376a92717d76d6bf484f1a87109143c24cb60e23`                              |
| connect         | npm `1.9.3`；GitHub `v1.9.3` 发布目标为 `c7149e45f89d0534353b581a9e28707a54eda538`            | `ac7d4d877e968d9e4d02177aa6cffa6fbf52c45e`                              |
| oomol-connector | GitHub `v0.0.447` 发布目标为 `3469c01d017b17aad8ea558b097780b6a4707aad`                       | `69bfca136f728dd19c22d65c3a4ef2113f83f7ef`，提交标题为 release v0.0.445 |

通过 npm registry 下载并校验了两个公开 tarball 的 SHA-512 integrity：

- [Open Flow beta.70](https://registry.npmjs.org/@oomol-lab/open-flow/-/open-flow-0.1.0-beta.70.tgz)：`sha512-f7KnVRZs90TTQzw9czdXVvjq+4DYX7rh0Sb4dX7Hmo7IcKSSfJA2TrEJDfBgPf4dGfNRLrVsl0t5uQL8mY0pHg==`。实际产物的 runtime-contract 与声明文件包含 Engine v7；不能再把 v7 视为尚未发布的可自由复用边界。
- [OpenConnector 1.9.3](https://registry.npmjs.org/@oomol-lab/open-connector/-/open-connector-1.9.3.tgz)：`sha512-jA203jyblaGBfJV6yNb1aSUdZLokHUCLjGrBd7WFLSYWToMBwWQfP+5zc1Emk+hjzZdrdBg8Mn1KmJewiEaNrA==`。实际产物含注册 Trigger 操作与 Source operation；npm 元数据未提供 gitHead，GitHub 发布目标不能被当成已经验证的 tarball 源码映射。

GitHub 记录见 [OpenConnector v1.9.3](https://github.com/oomol-lab/open-connector/releases/tag/v1.9.3) 与 [托管 Connector v0.0.447](https://github.com/oomol/oomol-connector/releases/tag/v0.0.447)。托管镜像 digest、已部署实例版本及其数据库迁移状态尚未核实；本地 checkout 落后于最新发布目标，不修改或切换用户分支来掩盖该差异。

## 首批变更的兼容结论

本批次增加共同协议验收、后端适配与目录比较，并修复托管 Connector 对已生成 callback nonce 缺少校验的问题。没有改变 Open Flow 节点输出、Flow model、Engine 或 checkpoint 格式，因此不分配新的 Open Flow 契约版本。

nonce 校验收紧了托管 Connector 的回调接收：通过正常创建得到的 URL 已含 `connector_subscription`，Open Flow 现有适配会转发它；遗漏或不匹配的回调被拒绝。部署前需确认现有入口和中间代理保留此 query，不能通过重建已有远端订阅来修复代理丢参数。

## 后续破坏性改动的前置证据

正式 Source 管理和单事件 Run 上线前，重新核实届时最新发布产物，并取得目标部署的镜像/包版本、数据库迁移状态和活动 Publication/Run 的契约分布。对比最新发布目标与工作分支中受影响的 Trigger 实现；当前源码验收通过不证明未检查的已发布托管镜像行为相同。

根据 [contract evolution](../control/contracts/compatibility.md#release-baselines-and-contract-versioning) 分别决定协议、模型、Engine 与存储的兼容或拒绝边界。不能沿用旧文档中的 beta.69 基线，也不能因为本批次不改版本，就认为后续可在已发布 v7 中改变 Run 语义。

## Production Source 存量核验

核验时间：2026-10-27 10:31（Asia/Shanghai）。使用 Cloud 部署仓库的 production Wrangler 配置和 `oomol` profile，直接对远端 D1 执行只读计数查询。Directory 返回全部 tenant shards 为 `01`、`02`，分别对应 `open-flow-cloud-tenant-01`、`open-flow-cloud-tenant-02`，两个分片均已检查。

| 数据                                                       | 分片 01 | 分片 02 |
| ---------------------------------------------------------- | ------: | ------: |
| `event_sources`，包含软删除记录                            |       0 |       0 |
| `source_events`                                            |       0 |       0 |
| `source_deliveries`                                        |       0 |       0 |
| `source_subscriptions`                                     |       0 |       0 |
| `source_preparations`                                      |       0 |       0 |
| `source_event_versions`                                    |       0 |       0 |
| `flow_trigger_bindings` 中配置引用 `sourceId.value` 的记录 |       0 |       0 |
| 其中 `current_publication_id` 非空的记录                   |       0 |       0 |

查询返回 `rows_written: 0`、`changed_db: false`。未读取秘密或事件正文，未执行生产迁移。此结论针对 Source 事件源，不代表线上没有其他 Trigger，也不证明其他自托管或开发环境没有 Source 数据。

据此移除尚未发布的 Source 导入暂存表、存储接口、专属测试和文档。正式 Source 管理直接面向新建数据实现；发布前复查上述存量即可。若届时出现数据，再按实际需求处理，不预建迁移系统。批量 Poll Flow 的显式语义升级属于另一项兼容义务，不因 Source 为空而取消。

## Slack 正式引用操作批次

两个 Connector 新增 `sourceReference` 操作，直接持久化应用共享状态及 Source 集合。connect 新增 `0019_trigger_sources.sql`（SQLite／D1、PostgreSQL），托管 Connector 新增 `0023_trigger_sources.sql`；均为新表，不转换或删除既有 Source 数据，也没有导入暂存表。托管 schema snapshot 保留历史 Trigger 表，迁移 SQL 不包含无关删除。

现有 `source` 请求和目录声明保持兼容，新操作在旧后端应明确拒绝。Open Flow 消费端、公共包、Engine 和 Run 契约本批未切换；正式客户端接入与上线验证仍待完成。自定义 Connector TriggerStore 实现需要补齐应用状态读取和 revision 条件写入接口；内置数据库适配器已接入并验证。此批尚未提交或部署，不能将本地测试通过当作生产已经支持引用操作。

## Slack Open Flow 引用接入批次

Open Flow Server 的 Slack Source 已使用 `sourceReference`，公共包新增引用操作与响应校验契约；现有 Control API 请求字段、Flow model、Engine、节点输出和 Run 语义不变，不分配新的模型或 Engine 版本。Server schema 升到 54，新增部署命名空间及 Source 引用／未完成操作字段。它明确拒绝有旧 Slack Source 的数据库，拒绝时保留数据和原 schema version；其他 Provider 的存储继续保留。

先部署支持创建、修改、引用回调和无凭据删除（包括按创建请求身份删除并拒绝迟到创建）的 Connector，再升级 Open Flow Server 与公共包。升级前停旧 Server、备份 SQLite（含 WAL）并复查 Slack Source 存量；若不为空，停止升级并根据真实数据决定处理方式。迁移后的数据库不能交给旧 Server。新建 Source 后，回滚也必须处理 Connector 上的正式引用，不能只回滚本地数据库或二进制。此批没有执行生产迁移或部署。

## Full Provider delivery and Poll scope correction (2026-10-27)

本轮统一覆盖全部 7 个 Source。迁移 54 尚未发布，复用该迁移并将空存量前置条件扩大到全部 Source；不再保留旧 Source 的 Open Flow 执行分支。Connector 继续支持已发布的无状态 `source` wire 操作，正式 Open Flow 客户端只用 `sourceReference`。新增 Source 后不得把数据库交回旧 Server；回滚必须同时考虑远端引用和托管资源。

Poll delivery remains definitionVersion 2 with `events[]` and batch Runs. The proposed v3
single-event contract, compatibility snapshots and explicit Trigger refresh upgrade are withdrawn.
Flow model 10, Engine v7 and checkpoint formats remain unchanged.

At correction time, Open Flow PR #160 is unmerged. Connector changes have merged and need follow-up
fixes restoring batch definitions. The latest verified formal releases predate those changes;
main-branch images may already contain the changed catalog. Deploy a version containing the batch
restoration before upgrading Open Flow. Existing Poll Publications need no output remapping.

Source deployment still requires the reference/resource/routing protocol and an empty legacy Source
store before migration 54. Real-account acceptance remains manual; no production deployment was run.
