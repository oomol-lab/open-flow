# Flow 鉴权模型

Flow 保存连接的使用方式，部署解析并固定授权身份，Connector 管理账号凭据并执行上游权限检查。
节点选择一个 `connectionId`，只说明它要使用哪个账号；是否允许调用，还取决于该消费者的声明范围、固定的授权身份和当前上游权限。

本文说明当前模型的数据关系、调用范围和生命周期。产品边界以 [架构文档](../architecture.md) 为准，字段、HTTP 接口、错误码与并发协议以
[Control API 契约](contracts/control-api.md#provider-access-binding) 为准。`docs/plans/` 中的接入计划记录历史演进，不代表当前合同。
这里讨论 Flow 使用 Connector 的授权，不涉及 Server 登录、Operator session 或公开 Wait URL 的认证机制。

## 1. 三层数据

| 层级         | 数据                                                                   | 所有者与用途                                        | 是否随 Revision 保存     |
| ------------ | ---------------------------------------------------------------------- | --------------------------------------------------- | ------------------------ |
| 连接使用声明 | 节点或 Task 的 `connectionId`，Code 的共享／独立模式及独立 Action 清单 | Flow 作者声明哪些消费者使用哪些账号和操作           | 是                       |
| 共享访问配置 | `ConnectorAccess`，其中 `bindings` 是共享 Code 的允许列表              | 部署维护可编辑的 Flow 共享选择与配置版本            | 否                       |
| 执行授权快照 | `ConnectorAccessSnapshot`，包含 `sharedBindings` 和 `selectedBindings` | 发布或 Run 准入时固定授权身份，供执行和后台恢复使用 | 否，随对应执行记录持久化 |

同一账号可以同时出现在共享配置和节点声明中，两种使用关系彼此独立。
普通节点选中了一个账号，不会让共享 Code 获得该账号；从共享列表移除账号，也不等于清除普通节点的账号选择。

### 连接使用声明

Connector Task executor、Agent 固定工具、Trigger 和独立 Code Action 在各自声明中直接保存 `connectionId`。
Agent 内联通知通过其引用的 Connector Task 取得固定 Action 和账号。Trigger 不再通过 Flow binding 表间接查找账号。

`FlowDocument.bindings` 只保存 Variable 引用，例如变量名 `TOKEN`，不保存账号授权或变量值。
它与下文的 Provider Access Binding 是不同概念。

新建 Code Task 默认使用共享模式；独立模式在 capability 中保存 Action 清单及每个 Action 的账号。
这些声明限制脚本能够发起的调用，但不能替代 Connector 的授权。具体序列化格式见 [Code Action 合同](contracts/control-api.md#10-code-action-合同)。

### 共享访问配置：ConnectorAccess

`ConnectorAccess` 是可编辑配置，当前结构版本为 `1`：

- `bindings`：整个 Flow（包括 Subflow）中共享 Code 可使用的授权选择。
- `accessRevision`：共享配置的并发修改版本；写入提交 `expectedAccessRevision`，防止覆盖其他修改。
- `sharedAccessDigest`：共享选择的确定性摘要，用于变更检测、发布状态与请求身份。
- `providerIds`：显式添加的服务，允许服务尚未选择任何账号；添加服务本身不授予权限。
- `mode`：部署采用 `implicit` 或 `selectable` 授权模式。

配置条目可以携带名称、状态及 `policyRevision` 等信息。损坏的历史条目可能被投影为 `invalid`，或通过 `discardedBindingCount` 提示需要重新配置；
保留展示信息不意味着该条目仍可执行。

`sharedAccessDigest` 只计算排序后的 `[providerId, accessBindingId]` 共享选择，不包含节点账号、服务展示列表、名称或上游即时权限。
因此，“摘要相同”只说明共享选择相同，不能证明两个 Flow 的完整执行权限相同，也不能证明上游权限没有变化。

### 执行快照：ConnectorAccessSnapshot

快照当前结构版本为 `2`，固定 `mode`、`sharedAccessDigest` 和两个必填的授权集合：

| 字段               | 来源                                         | 用途                                                       |
| ------------------ | -------------------------------------------- | ---------------------------------------------------------- |
| `sharedBindings`   | 准入时共享配置中的 active 授权身份           | 共享 Code 调用                                             |
| `selectedBindings` | 从固定图的显式账号使用解析出可分配的授权身份 | 普通节点、独立 Code、Agent 工具、通知与 Trigger 的调用检查 |

集合中的 `ConnectorAccessGrant` 保存账号、Provider、授权身份、来源以及用于历史展示的名称；不保存 credential、原始权限规则、配置版本或即时状态。
`accessRevision`、`providerIds`、`status` 和 `policyRevision` 不属于执行快照。

`selectedBindings` 按授权身份去重，不按 nodeId 建表。多个节点可以引用同一个授权身份；哪个节点可以调用哪个 Action，由固定声明和调用上下文限制。
两个集合都必须显式存在。运行时不会把缺少 `selectedBindings` 的对象解释成“允许使用共享列表”，也不会把可编辑配置当成执行快照。

## 2. 授权身份与部署模式

### Provider Access Binding 指向什么

授权身份包含 `accessBindingId`、`connectionId`、`providerId` 和明确的 `source`：

| source                               | 含义           |
| ------------------------------------ | -------------- |
| `{ kind: 'admin-delegation' }`       | 管理员委托     |
| `{ kind: 'policy', ruleId: null }`   | 团队默认 grant |
| `{ kind: 'policy', ruleId: string }` | 指定的具名规则 |

`ruleId: null` 是明确选择默认 grant，不表示未知来源。具名规则被删除后，不能改用默认 grant，也不能换到其他授权来源。
身份编码包含 Team、账号、Provider 与来源，规则名称、规则内容和 policy revision 不参与身份编码；精确编码规则由公共契约定义。

客户端提交候选 ID，部署验证候选是否可分配后保存完整身份。Workbench 不解析权限规则，不接收账号凭据，也不能通过自报 source 获得授权。
“用户现在可以把一个授权分配给 Flow”和“一个已固定授权现在仍能执行”是不同检查；不能假定保存后的授权会在每次调用时重新经过候选分配流程。

### implicit 与 selectable

| 模式         | 授权来源                              | 快照表现                                         |
| ------------ | ------------------------------------- | ------------------------------------------------ |
| `implicit`   | 部署配置的 scoped Connector authority | 两个授权集合为空，不伪造 Provider Access Binding |
| `selectable` | 部署提供的可分配账号授权候选          | 固定所选身份，执行时按身份解析当前可用权限       |

当前开源 Server 对 OpenConnector 使用 `implicit`，对支持的 OOMOL Connector endpoint 使用 `selectable`。
`implicit` 的空集合不表示拒绝所有操作，也不表示无限权限：调用仍受消费者声明、账号有效性和部署 Connector 身份权限限制。
部署模式由宿主确定，Flow 或脚本不能自行切换。

Connector 明确声明无需账号授权的 Action 可以不携带账号 grant，仍须满足对应调用范围和部署要求的平台身份。
普通需要账号的 Action 不能借此省略连接配置或借用其他节点的账号。

### OOMOL Team 作用域

Server 使用 OOMOL-hosted Connector 时，Operator 创建 Flow 必须选择一个具体 Team；Server 在创建操作中将其保存为不可变的 Flow metadata。
即使选择默认 Team，也要固定当时的具体身份，不能跟随账户默认值变化。节点不能覆盖 Team，既有 Flow 不能原地换 Team；需要另一 Team 时创建新的 Flow。

目录和账号查询按 Flow 解析 Team；Run 准入将其固定到运行记录，Poll 与 Integration 使用所属 Flow 的 Team。
运行时 Connector 请求显式携带该作用域，不读取部署级可变 Team。
Team 选择由部署宿主扩展 Flow 创建交互，产品中立 Workbench 不拥有这项外部身份配置；自建或自定义 Connector 不显示 OOMOL Team 入口，也不隐式请求 OOMOL membership 服务。

Connector adapter 必须说明上游如何固定执行身份。本地将稳定 ID 解析为 alias，不等于上游保证按稳定 ID 原子执行；alias 不能成为授权依据，目录改名不修改旧 Revision。

## 3. 单次调用如何收窄权限

宿主从固定 Revision 的声明建立 `ConnectorAccessContext`，脚本不能自行构造或扩大该上下文。

| 消费者／阶段                                    | scope      | 授权与范围                                                               |
| ----------------------------------------------- | ---------- | ------------------------------------------------------------------------ |
| 编辑期目录、候选和配置查询                      | `catalog`  | 操作者的配置上下文；不作为 Run 执行授权快照                              |
| 发布／Run 的显式连接资格检查                    | `selected` | 检查固定的显式选择集合；该 scope 本身不能执行 Action 或运行期 proxy      |
| 共享 Code                                       | `shared`   | 使用 `sharedBindings` 中账号当前允许的 Actions，不保存节点级 Action 清单 |
| Connector 节点、Agent 固定工具、通知、独立 Code | `action`   | 固定本次 Action 和 Connection，再从 `selectedBindings` 中解析匹配授权    |
| Poll／Integration 等运行期 Connector proxy      | `proxy`    | 固定本次 Provider 和 Connection，并检查对应 proxy 权限                   |

共享 Code 在其允许账号中调用；省略账号时按共享调用的单账号或默认账号规则解析，不能从 `selectedBindings` 借用账号。
独立 Code 必须先通过自己的 Action 清单校验，再使用清单中的固定账号。普通节点同样不能因为快照中存在另一个账号就切换过去。
旧式 Code capability 中的 alias、默认账号或 typing hints 不能当作授权清单；其兼容语义见 Code Action 合同。

运行期检查可按以下顺序理解：

1. 宿主确认调用属于当前声明和 invocation，例如 Action 与 Connection 是否匹配。
2. `selectable` 模式在对应集合中解析固定身份，校验身份、Provider、账号和来源一致。
3. 检查账号状态及当前 Action 或 proxy 权限，再由 Connector 使用实际部署身份执行请求。

固定快照只固定“接受哪一个授权身份”，不冻结外部权限。上游撤权、规则删除或账号失效仍可使已发布 Flow 或已接受 Run 的后续调用失败。
权限解析可能使用部署的缓存和刷新规则，不应将“当前权限检查”理解为每次调用都绕过缓存实时读取所有上游数据。

编辑期读取目录不以 Flow 已选授权过滤。能看到 Action 定义、连接展示信息或候选权限摘要，不等于执行时获得权限。
Trigger 配置选项查询可在受部署约束的 `catalog` 上下文中使用 proxy；不能将这个编辑期入口交给运行期脚本。

### 示例：两个账号互不借权

一个 Flow 的普通邮件节点声明使用账号 A；共享 Code 的配置只选择账号 B。
发布快照会分别将 A 的授权放入 `selectedBindings`，将 B 的授权放入 `sharedBindings`。

- 邮件节点只能按自己的声明使用 A 执行指定 Action，不能改用 B。
- 共享 Code 可以使用 B 当前授权的 Actions，不能因为 A 出现在同一 Flow 中就使用 A。
- 新增独立 Code 并声明某个 Action 使用 A，需要在准入时确认 A 的授权适用于该操作；执行时仍不能换用其他 Action 或账号。

## 4. 编辑、发布与恢复

| 操作                     | 如何取得授权                                                           | 对已有记录的影响                               |
| ------------------------ | ---------------------------------------------------------------------- | ---------------------------------------------- |
| 编辑节点账号或 Code 模式 | 修改 Draft Revision 的声明                                             | 不修改已有 Publication 或 Run                  |
| 编辑共享访问配置         | 更新部署保存的 `ConnectorAccess`                                       | 不改写 Revision，也不替换已有执行快照          |
| 草稿测试 Run             | 从固定草稿执行图和共享配置捕获快照，并完成准入检查                     | 接受后保存自己的固定快照                       |
| 发布                     | 固定 Revision、共享选择和解析出的授权身份，随 publish operation 持久化 | 成功后由 Publication 保存快照；失败不切换 Live |
| Live／Trigger Run        | 使用对应已发布版本的快照                                               | 不读取当前 Draft 的共享配置来扩大权限          |
| 回滚                     | 复制来源 Publication 的授权快照，并走发布检查                          | 创建新 Publication，不修改来源记录             |
| Run 或后台工作恢复       | 从所属记录读取已固定的快照                                             | 不重新选择当前默认账号，不重新捕获 Draft 授权  |
| 上游撤权或连接失效       | 由部署与 Connector 在权限检查中处理                                    | 可使既有快照引用的授权失效                     |

Run、Publication、发布准备工作与订阅状态分别由其生命周期所有者持久化所需快照；通知恢复使用所属 Run 的固定上下文。
不要为后台工作建立第二套“当前 Flow 权限”来源。

从“连接使用”总览移除一个账号，是跨两层的 Draft 操作：同一事务检查图 Revision 和 `accessRevision`，清除节点账号选择以及共享配置中的该账号。
独立 Code 保留 Action、清除账号；节点、代码、输入与连线保留。该操作不删除上游账号、不撤销 OAuth、不修改其他 Flow 或已接受的执行记录。
移除后允许保留待配置 Draft，但不会因为账号还是默认连接而自动选回。

“连接使用”总览按账号汇总节点、独立 Code Action 与共享 Code 的使用来源。新建节点时可以选择适用于该 Action 的默认连接；
这与移除后的重新配置不同，刷新不能自动回填已清除的选择。缺少连接不阻断 Draft 编辑，发布、Run 准入和实际调用仍检查使用资格。
Flow 物理删除前，部署的访问配置所有者须清理对应的共享配置记录。

## 5. 持久化与旧数据升级

Flow model、共享配置版本、执行快照版本和 SQLite schema version 是不同的版本轴，不能互相替代。
当前 Flow model 为 `4`，`ConnectorAccess.version` 为 `1`，`ConnectorAccessSnapshot.version` 为 `2`。

此前的迁移 0027 仅一次性清空旧 Draft `flow_provider_access`，保留图、Publication、Run 和后台快照；重新启动不会再次清空新配置。

Server 的结构迁移 0030 在启动事务中完成旧摘要列重命名、权限快照转换和默认值更新，支持旧结构库以及已用新结构重建的开发库。
转换失败时回滚，不保留半升级结构。不要通过修改已执行的历史 SQL 文件或重置版本号升级已有数据库。

旧快照迁移规则如下：

- `bindings` 中 active 条目转换为 `sharedBindings`；`nodeBindings` 中 active 条目转换为 `selectedBindings`。
- 更早期没有 `nodeBindings` 的快照，将其原先共享候选的 active 条目固定为显式选择集合。这只发生在迁移入口，不是新运行时的缺省授权规则。
- 转换后的 grant 必须通过新快照解码校验；不会为损坏的 active 身份猜测来源。
- `implicit` 快照的两个集合均为空；已经是新结构的快照仍按新合同校验。

结构迁移不改写历史 Revision 正文、摘要或引用。旧模型草稿通过现有“升级”操作生成新的 Revision：
将 Trigger 的 connection binding 解析为直接 `connectionId`，保留 Variable 引用，再重新检查和发布。
无法解析的旧账号引用不会被替换为默认账号，需要重新配置。

历史发布和运行记录保留，不代表新模型可以恢复旧模型执行。升级部署前应处理旧模型活动 Run 和外部订阅，不能依赖结构迁移继续运行旧任务。
历史计划中出现的 `nodeBindings` 和 Trigger `bindingId` 应按此升级关系理解，不应重新加入新模型。

## 6. 修改代码时从哪里开始

| 责任                             | 代码入口                                                                                                                                                                                      |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 配置、候选、grant 与快照公共类型 | [control/common/api.ts](../../packages/open-flow/src/control/common/api.ts)                                                                                                                   |
| 配置与快照解码                   | [connectorDecoders.ts](../../packages/open-flow/src/control/common/connectorDecoders.ts)                                                                                                      |
| 从声明收集连接使用               | [connectionUsage.ts](../../packages/open-flow/src/flow/common/connectionUsage.ts)                                                                                                             |
| 共享配置存取、准入快照捕获       | [connector-access.ts](../../apps/server/node/deployment/connector-access.ts)                                                                                                                  |
| 调用 scope、Action／proxy 校验   | [connector.ts](../../apps/server/node/deployment/connector.ts)                                                                                                                                |
| 候选和上游授权身份解析           | [provider-access.ts](../../apps/server/node/deployment/provider-access.ts)                                                                                                                    |
| 发布、草稿 Run 和执行时上下文    | [publication.ts](../../apps/server/node/application/publication.ts)、[run-control.ts](../../apps/server/node/application/run-control.ts)、[run.ts](../../apps/server/node/application/run.ts) |
| 旧库结构迁移                     | [migrate-connector-access.ts](../../apps/server/node/storage/migrate-connector-access.ts)                                                                                                     |
| 旧草稿升级                       | [changeSchema.ts](../../packages/open-flow/src/flow/common/changeSchema.ts)                                                                                                                   |

新增连接消费者时，应在自己的声明中保存账号选择，将其纳入连接使用收集与准入检查，并由宿主创建合适的单次调用 scope。
不要直接把整图 `selectedBindings` 暴露为可执行权限，也不要让客户端或脚本指定可信授权来源。
