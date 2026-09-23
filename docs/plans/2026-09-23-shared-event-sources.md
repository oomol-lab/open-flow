# 共享事件源与 GitHub webhook 迁移计划

日期：2026-09-23。状态：待实施。

本文是实施计划，不修改当前产品合同。实施时同步更新[架构边界](../architecture.md)与
[Control API 技术参考](../control/contracts/control-api.md)；现有飞书接入背景见[飞书 Trigger 计划](2026-09-14-feishu-triggers.md)。

## 1. 问题与目标

当前飞书事件源独立于 Flow，但其公开类型、创建请求、数据库列及 Server 接收和分发代码包含飞书专有字段与协议。
GitHub `on_repo_event` 和 `watch_pull_request` 则各自创建仓库 webhook；同一仓库的多个 Flow 重复占用 GitHub
每种事件类型最多 20 个仓库 webhook 的名额。数量限制和仓库管理权限分别见
[GitHub webhook 排障文档](https://docs.github.com/en/webhooks/testing-and-troubleshooting-webhooks/troubleshooting-webhooks#cannot-have-more-than-20-webhooks)与
[创建文档](https://docs.github.com/en/webhooks/using-webhooks/creating-webhooks)。

目标：事件源成为独立的部署资源，拥有一个上游事件入口、外部注册及接收状态；Flow Trigger 只引用并筛选事件源。
同一 Team、同一 GitHub 仓库的 Flow 复用一个受当前部署管理的 webhook，且不跨 Team 共享接收权限。
飞书应用回调和 GitHub 仓库 webhook 是首批两种真实形态；新增下一种来源不应再增加公共存储列或在通用接收、分发路径写提供方分支。

本次不迁移其他 Provider Trigger，不建立通用消息总线、动态插件系统或独立秘密管理服务。
事件源无消费者时仍存在，外部资源是否保留由事件源的启停和删除操作决定，不由最后一个 Flow 的生命周期隐式决定。

## 2. 对象与所有权

### 2.1 事件源身份与公开合同

- 公共字段：`sourceId`、`kind`、`name`、`teamId`、`connectionId`、`enabled`、`status`、`revision`、`endpointUrl`、`lastReceivedAt` 和派生的 `consumers`。
  `sourceId` 与回调 URL 稳定，不从 Flow ID、仓库路径或 Connection 显示名推导。
- `kind` 是稳定的来源类型，如 `feishu.application`、`github.repository`；对应 Connector provider 由类型定义，不让调用方另传一个可能冲突的 provider。
  创建、更新和读取使用按 `kind` 区分的严格配置类型。公开读取只返回非秘密配置与秘密是否已配置，不返回密钥或外部 webhook secret。
- 外部身份由可信 Connection 或 Provider API 确认，不接受调用方自报：飞书使用 App ID，GitHub 使用仓库的稳定 ID，并另存当前 `owner/repo` 供 API 请求。
  对同一上游入口强制唯一管理者；GitHub 在一个 Team 内不能仅通过换 Connection 重复创建同仓库来源，冲突时应提示复用已有来源及其管理 Connection。
  使用它的 Trigger 必须满足该 Team、Provider、Connection 及来源身份约束。跨 Team 不自动共享来源。
- 来源的 `eventTypes` 是上游接收范围，Trigger 选择其子集及自己的业务过滤条件。移除仍被当前或准备中的 Trigger 使用的事件类型应冲突；
  分别记录期望与已生效的接收范围。增加事件类型期间，已有 Flow 继续使用已生效范围；新类型须等上游订阅更新成功才能发布。
  更换应用或仓库身份要创建新来源，不把旧 `sourceId` 指向另一资源。
- `status` 表示待配置、就绪、需要处理或删除中等来源级状态，`enabled` 单独表示管理员是否允许接收。
  飞书的回调验证与 GitHub 的远端 webhook 核对分别产生就绪证据，不能把 `verifiedAt` 当作所有来源通用的就绪条件。

### 2.2 通用核心与提供方定义

`packages/open-flow` 拥有来源的严格公开类型和 Provider 协议逻辑；`apps/server` 拥有数据库、Connector 调用权限、外部操作调度、回调路由、持久收件、
目标固定、重试和 Run 准入。以现有两种来源所需的最小定义注册表连接两者，不做运行时加载插件。每个来源类型提供：

1. 创建参数校验和可信外部身份解析。
2. 原始回调认证、握手响应与业务事件解析，产出稳定事件 ID、类型和 Provider 负载。
3. 对固定 Trigger 配置进行无外部 I/O 的事件匹配；Trigger 定义继续负责自身完整输出或 listener 唤醒。
4. 将来源期望配置与上游实际状态协调，包括仅该来源拥有的注册、更新、删除及可恢复诊断。

公共接收层按来源类型执行大小和内容类型策略，提供统一的部署上限；不能把当前飞书的 64 KiB 限制直接用于 GitHub。
认证在解析和入库前完成。通用 store 只处理已验证事件的去重、匹配目标快照和投递，移出当前的飞书解析、输出构造与 `matchesFeishuEvent` 调用。
`source_subscriptions` 一类按 Flow 需求共享的远端资源订阅只在实际需要它的来源中使用；GitHub 的仓库 webhook 属于来源本身，
不伪装成某个 Flow 的订阅需求。

## 3. 生命周期与一致性

1. 创建来源先固定 `sourceId`、作用域、可信外部身份和期望配置，再执行外部操作。GitHub 注册失败或请求超时后保留可重试来源状态；
   重试通过精确的本来源回调 URL 和已记录的 webhook ID 核对远端，不能接管或删除其他 webhook。
   飞书继续由管理员配置应用回调，通过真实 challenge 确认就绪。
2. 来源级更新使用 `expectedRevision`。外部请求在数据库事务外执行，完成时核对来源版本；并发编辑、停用、连接失效和重启后迟到结果不能覆盖新期望状态。
   暂时失败保留诊断并重试，结果不确定时先查询上游实际状态，不能盲目重复创建。
3. 回调先验证来源状态、请求签名和外部资源身份，再在一个事务内写入 `(sourceId, eventId)` 去重事实及当时有效的目标 binding。
   重投不重新扩展目标；成功持久化后才确认上游。后续按固定 Publication/Runtime 身份重试准入，仍由 Live 和 binding 检查拦截失效目标。
4. Publish 候选验证来源已生效的事件覆盖、Team、Connection 和实时授权；准备失败不移动 Live。停用来源立即停止本地新目标准入，
   并协调停用 GitHub 远端 hook；恢复沿用去重记录。删除先检查当前及准备中的消费者，再阻止新接收、删除当前部署拥有的外部资源，
   确认清理后才删本地记录；外部清理失败保持可重试状态。

## 4. 两种来源的落地规则

### 飞书应用

迁移现有来源记录到区分类型的配置与内部状态，保留 `sourceId`、回调 URL、验证事实、待投递事件和资源订阅需求。
应用 ID 仍来自 Connection 的可信 `providerAccountId`；Verification Token、Encrypt Key 只写入和脱敏读取。
手动配置回调及可选的按资源共享订阅保持飞书实现负责。迁移前后相同回调重投只能形成同一组目标。

### GitHub 仓库

创建时通过选定 Connection 查询仓库并确认管理 webhook 的权限，按稳定 repository ID 检查 Team 内唯一来源。
来源持有固定回调 URL、签名密钥、仓库身份、事件类型和实际 webhook ID；自动创建或更新一个仓库 webhook。
接收时验证 `X-Hub-Signature-256`、`X-GitHub-Delivery`、事件头与负载中的仓库身份；`ping` 只作为握手，不创建 Run。
普通仓库事件 Trigger 按事件类型过滤，PR listener 再按 PR 编号过滤并保留已有周期检查语义。
仓库改名只更新来源记录与上游请求路径，不改变 `sourceId`；远端 webhook 被删除、权限撤销或配额耗尽时给出可恢复且可定位的状态。

## 5. 管理入口与存量迁移

- Control API 提供按来源类型区分的创建、读取、更新、删除及状态合同；`list` 列独立资源，`consumers` 只表示实际使用关系。
  现有 `flowId` 查询如继续保留，只解释为按 Flow 的 Team 筛选可选来源，不表示来源属于该 Flow。CLI/MCP 列表不隐式绑定当前 Flow。
- CLI 和 MCP 通过同一 Control API 完成来源创建、查询状态、更新和删除。创建 GitHub 来源不要求打开 Workbench；飞书创建后返回需配置的回调地址和验证状态。
  密钥只作为写入参数，不在列表、日志或工具响应中回显。Workbench 保留来源列表与提供方专属配置表单，不建立填满可选字段的通用表单。
- 新的 GitHub Trigger 配置引用 `sourceId`。现有 `github.on_repo_event` 与 `github.watch_pull_request` 的 v2 快照已持久化在 Revision/Publication 中，
  不能原地改变其字段语义。计划使用同一公开 key 的新定义版本供新编辑与发布；运行时按 `(key, definitionVersion)` 解析，
  仅向新建节点展示最新版，旧版只服务已有持久化实例。相应更新当前只接受版本 2 的 Schema、decoder、Integration 和 listener 查找路径。
- 先创建并核对共享来源，再逐 Flow 将旧 Trigger 配置迁到新版本并正常发布。新 Live 生效前旧 hook 继续接收；旧 binding 退役后清理其 hook。
  切换窗口验证同一 GitHub delivery 不会触发重复 Run 或丢失可接收事件。旧定义与清理代码只有在历史 Publication 的回滚和执行合同不再需要时才能删除。

## 6. 实施顺序与退出条件

### 阶段一：公共合同和飞书等价迁移

先更新类型、严格校验、存储迁移、来源状态与提供方注册边界，再把飞书协议逻辑从通用 Server store/runtime 移到飞书实现。
保留现有飞书回调入口、CLI/MCP 列表和已发布 Flow 的行为；以旧数据库升级、握手、共享投递、资源订阅清理及重启测试作为退出条件。

### 阶段二：GitHub 共享来源闭环

接入仓库身份验证、来源级 webhook 协调、验签、事件匹配和两个 source-backed Trigger 版本。
用模拟 Connector 验证创建、重复创建冲突、超时后恢复、远端删除后重建、限额/权限错误、PR 筛选、同仓库多 Flow、跨 Team 隔离和来源删除。
退出条件是两个 Flow 只使用一个真实来源记录和一个 GitHub webhook，任一 Flow 退役都不会删除共享 hook。

### 阶段三：管理体验与存量切换

补齐 Control API conformance、CLI/MCP 的 CRUD 和状态查询，以及 Workbench 的来源创建、选择、状态与受影响 Flow 展示。
依照仓库前端约定更新相关 Lab stories 和本地化。迁移已有 GitHub Trigger，并验证发布失败保留旧 Live、回滚、重复投递及旧 hook 清理。
更新架构、Control API、CLI/MCP 和用户接入文档。退出条件是用户可仅凭 CLI 或 MCP 创建 GitHub 来源、绑定 Trigger、发布并确认接收，
飞书既有流程不回退。

## 7. 验收与验证

- 独立性：删除或停用一个 Flow 不改变来源身份；零消费者来源仍可查询，删除来源才清理其外部 webhook。
- 共享性：同一 Team 与仓库的两个 Flow 接收同一事件时仅有一个 GitHub hook；不同事件筛选和 PR 编号互不串流。
- 隔离性：伪造签名、错误仓库、其他 Team/Connection、失效 Connection、候选或旧 Publication 均不能越权准入。
- 可靠性：重复回调、入库失败、积压、并发更新、创建超时、重启恢复、远端资源丢失和删除失败均有确定结果；成功确认后事件不会因服务重启丢失。
- 兼容性：旧飞书来源与旧 GitHub v2 Publication 可继续执行；新版本切换不改写历史 Revision，也不产生双重 Run。
- 扩展性：新增来源所需的协议和配置落在新类型定义及提供方实现中；通用数据库、接收与分发流程不因第三个 Provider 再增加专有列或分支。

各阶段先跑能证伪对应行为的聚焦测试。完成公共合同与 Server 改造后，运行 `packages/open-flow` 的 `bun run test`、
受影响的 Server/CLI 测试和仓库根目录 `bun run check`，检查完整 diff 与 `git diff --check`。
真实 GitHub/飞书联调只使用明确授权的测试资源，记录创建和清理的外部 webhook；未完成的联调不能用模拟测试代替声称通过。
