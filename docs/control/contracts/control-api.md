# Control API 技术参考

本文记录 Open Flow Control API 跨部署成立的 HTTP 合同。数据库、认证 provider、事务实现、调度器和部署资源不属于本文。
公共 black-box cases 由 `@oomol-lab/open-flow/control-api-conformance` 导出。

部署应运行适用的完整 profile，而不仅导入公共类型或测试自身客户端 mock。cases 使用真实 HTTP transport，
并复用公共 `ControlClient` 的响应 decoder；fixtures 只准备确定性数据和外部能力，不替代被测路由。

| Profile                                                                                                    | 部署 fixture 要求                                                                                                                                              |
| ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `controlApiConformanceCases`、`publicationControlApiConformanceCases`、`triggerControlApiConformanceCases` | 每个 case 使用隔离的数据；支持 Flow、发布、Trigger 目录与 Webhook，标记 `runtime` 的 case 启动执行器                                                           |
| `connectorControlApiConformanceCases`                                                                      | 无 scope 和新建 Flow 中均提供至少一个 Provider、Action；支持按名称搜索、授权页和条件读取；implicit access                                                      |
| `selectableConnectorAccessControlApiConformanceCases(fixture)`                                             | selectable access；提供可添加的 Provider 和有效账号授权候选，初始 Flow 无服务选择或授权                                                                        |
| `connectorScopeControlApiConformanceCases(fixture)`                                                        | 两个已存在 Flow，账号列表不同；提供每个 Flow 的精确 Connection 列表，至少一份非空                                                                              |
| `eventSourceControlApiConformanceCases(fixture)`                                                           | 可创建事件源的 active `feishu_app_bot` Connection，含可信 `providerAccountId`，以及所属 `teamId` 和预期授权页 `connectionPageUrl`；该应用尚无事件源            |
| `pollControlApiConformanceCases(fixture)`                                                                  | 已注册的 Poll definition、Connection、有效配置、动态选项及确定性 preview；发布后 baseline 就绪，preview 不推进 checkpoint；测试期间不自动调度                  |
| `runResultControlApiConformanceCases(fixture)`                                                             | 一个 Run 保存恰好 51 项结果；另一 Run 无结果。指定一项正文为 `{ rows: number[] }` 的结果，至少两行，完整 JSON 不超过默认 15,000 bytes；提供各结果真实 metadata |
| `draftRepairControlApiConformanceCases(fixture)`                                                           | 已存在的不可读或需升级 Draft，提供其 Flow、Revision identity 和修复后预期 content；保留可恢复条目                                                              |

每个 factory 返回的 cases 都必须执行；不要因为部署缺少接口而跳过对应验证。Connector scope、事件源、Poll 和结果 profile
分别由支持这些能力的部署准备数据。已有基础 profile 不会自动执行需要 fixture 的 factory。
部署可以通过存储层准备历史损坏 Revision 或已保存的工具结果，但验证过程只走公共 HTTP；不要调用外部生产服务生成测试数据。

## 1. Transport

- 路径以 `/v1` 开头；resource identity 放入 path segment 时使用 UTF-8 percent encoding。
- 带 JSON body 的请求使用 `Content-Type: application/json`。
- JSON response 顶层或资源对象包含 `version: 1`。
- 创建 Flow、提交 Draft change、创建 Publication 和 Run 的请求要求非空、受限长度的 `Idempotency-Key`。
- 相同 key 与相同 logical operation 返回原资源；相同 key 与不同 operation 返回对应 conflict。
- 认证与 deployment scope 由 adapter 提供，公共合同不指定 Team header、Cookie 或 token 格式。

错误 response：

```json
{
  "error": {
    "code": "flow.revision-conflict",
    "message": "The Draft changed."
  },
  "version": 1
}
```

客户端只按稳定 `code` 分支。当前错误域包括 `authentication.*`、`authorization.*`、`flow.*`、`live.*`、`publication.*`、`run.*`、
`trigger.*`、`trigger-key.*`、`connector.*`、`event-source.*`、`variable.*`、`binding.*`、`engine.*`、`page.*` 和 `route.*`；精确 code 集合由
`@oomol-lab/open-flow/control-api` 的 `controlErrorCode` 导出。`message` 用于展示和排查，应在已知时说明请求被拒绝的直接原因，但不是稳定的机器合同，
也不能包含 credential、请求 payload 或其他敏感值。

## 2. Variable

Variable 是 deployment scope 配置，不属于 Flow：

```ts
interface Variable {
  name: string
  updatedAt: string
  value: string
  version: 1
}
```

| Method   | Path                  | Request             | Success                                     | Missing                  |
| -------- | --------------------- | ------------------- | ------------------------------------------- | ------------------------ |
| `GET`    | `/v1/variables`       | 无 body/query       | `200 { variables: Variable[], version: 1 }` | 不适用                   |
| `GET`    | `/v1/variables/:name` | 无 body/query       | `200 Variable`                              | `404 variable.not-found` |
| `PUT`    | `/v1/variables/:name` | `{ value: string }` | `200 Variable`                              | 不适用                   |
| `DELETE` | `/v1/variables/:name` | 无 body/query       | `200 { version: 1 }`                        | `404 variable.not-found` |

name 大小写敏感，只允许 1–256 个 ASCII 字符并匹配 `^[A-Za-z_][A-Za-z0-9_]*$`；不区分大小写的 `OO_` 前缀保留。
列表按 name 的 ASCII/BINARY 升序返回。value 允许空字符串、NUL、换行和 Unicode，经 UTF-8 编码后最多 64 KiB；每个 deployment
最多有 200 个不同 name，达到上限后仍可更新已有记录。相同 value 的 PUT 不改变 `updatedAt`。非法请求返回 `variable.invalid`，
第 201 个 name 返回 `variable.limit-reached`。

Control API Operator 可以枚举并读取所有 value。Variable 是可导出的 deployment configuration，不提供 Secret Manager 的不可导出值、
per-variable ACL、KMS、轮换或独立审计语义。

## 3. Flow、Revision 与 Presentation

Flow 是顶层资源：

```ts
interface Flow {
  live?: { enabled: boolean; publicationId: string; revisionId: string }
  createdAt: string
  draftRevisionId: string
  flowId: string
  name: string
  status: 'active' | 'retiring'
  updatedAt: string
  version: 1
}

interface FlowPage {
  flows: readonly Flow[]
  nextCursor?: string
  total?: number
  version: 1
}
```

`flowId` 由部署生成。删除请求把 Flow 推进到 `retiring`，此后 Draft mutation、Run、Publish、Rollback 和 Trigger admission fail closed。
`total` 只在 `includeTotal=true` 时要求返回。

Flow 的 `live` 在未发布时省略，存在时表示当前发布版本与总开关。列表与单个 Flow 返回相同投影；`revisionId` 与 `draftRevisionId` 可用于区分草稿版本是否更新。
`PUT /v1/flows/:flowId/enabled` 接受 `{ enabled: boolean, expectedPublicationId: string, version: 1 }`，不接受其他字段或 query，成功返回 `200 Flow`。
Flow 不存在返回 `404 flow.not-found`；未发布、Publication 已变化或 Flow 已进入 retiring 返回 `409 flow.conflict`。
首次发布默认 enabled=true；发布与回滚保留 enabled。enabled=false 时 Live status 为 suspended，新的 Live Run 返回 `412 live.conflict`；草稿测试不受影响。

```ts
interface RevisionMetadata {
  actorId: string
  createdAt: string
  digest: string
  flowId: string
  modelVersion: number
  parentRevisionId: string | null
  revisionId: string
  version: 1
}

interface Draft extends RevisionMetadata {
  content: RevisionContent
}

interface DraftChange {
  revision: RevisionMetadata
  version: 1
}

interface DraftSync {
  draft: Draft
  kind: 'snapshot'
  version: 1
}
```

`RevisionContent`、顶层 `FlowDocument` 和 `ChangeOperation` 由 `@oomol-lab/open-flow/flow-change` 定义。顶层 graph target 固定为
`{ kind: 'flow' }`；Subflow target 为 `{ kind: 'subflow', id }`。不存在嵌套 Flow map 或 Flow create/delete operation。

Revision 是完整 immutable snapshot。Draft change 使用 `expectedRevisionId` 做 CAS；stale head 返回 `flow.revision-conflict`。每个 change batch
要求 `Idempotency-Key`；相同 key 与相同 batch 返回第一次提交的 Revision，相同 key 与不同 batch 返回 `flow.conflict`。幂等重放先于 Draft head CAS。
Draft sync 始终返回当前完整 snapshot，不接受 revision cursor，也不返回 authoring operation history。

Server 保留当前 Draft、Publication、待处理 Publish operation、未结束 Run 和每个 Flow 最近 50 条 Draft Run 引用的完整 Revision。
其他旧 Revision 内容可由维护任务清理；`GET /v1/flows/:flowId/revisions/:revisionId` 对已清理的内容返回 404。
Run 记录、终态结果与 Draft change 的幂等元数据仍保留。同一 Revision 被多次运行时，按 Run 条数计算最近 50 条。

无法按当前模型读取但可以宽容恢复的 Draft 分别返回 `flow.upgrade-required` 或 `flow.repair-required`。客户端可以调用
`POST /v1/flows/{flowId}/draft/repair`，body 为 `{ expectedRevisionId, version: 1 }` 并提供 `Idempotency-Key`。修复逐项保留
当前模型可读取的资源，丢弃无法读取的 collection entry，并以旧 Draft 为 parent 创建新 Revision；原 Revision、Live、Publication、Run 和
Presentation 不变。无法恢复任何内容时，显式 repair 创建空白子 Revision；普通读取仍按原错误返回，不会隐式修复。

Draft 请求的 operations 使用 `@oomol-lab/open-flow/control-requests` 的 `DraftOperation`：包含完整 ChangeOperation，以及 `graph.trigger.create`。
后者接受 `nodeId`、`bindingId`、Provider `key`、`config` 和可选的 `connectionId`、`name`、`schedule`。仅在根 Flow 创建 Poll/Integration；schedule 仅供 Poll 使用，默认每五分钟。
提供 connectionId 时创建 Connection binding，否则引用已有 bindingId。服务端在提交时解析 Provider 定义，转换为完整 ChangeOperation 并保存定义快照；持久化 Revision 格式不变。
幂等请求摘要按原始 DraftOperation 计算，已提交请求在解析目录之前重放，目录变更不改变重试结果。未知 key 或批次后续操作失败时，不提交部分变更。
CLI `schema`、MCP `flow_schema` 与 REST Draft decoder 使用同一个输入合同；底层离线 `applyFlowChanges` 仍只接受已解析的 ChangeOperation。

Presentation 独立于 Draft head：

```ts
interface Presentation {
  revision: number
  updatedAt: string
  value: Readonly<Record<string, JsonValue>>
  version: 1
}
```

更新 body 为 `{ expectedRevision, value, version: 1 }`，stale CAS 返回 `flow.presentation-conflict`。

`GET /v1/flows/{flowId}/editor` 聚合编辑器首次加载所需的数据：

```ts
{
  flow: Flow
  draft: Draft
  live: Live
  presentation: Presentation
  version: 1
}
```

各字段复用对应资源读取的合同。`flow.flowId`、`draft.flowId` 和 `live.flowId` 必须匹配请求的 Flow，
`flow.draftRevisionId` 必须等于 `draft.revisionId`；Live 的 `hasUnpublishedChanges` 对应该 Draft。
该操作只读，不创建 Revision、不改变 Presentation revision，也不执行 check；不存在的 Flow 返回 `flow.not-found`。
各资源的独立读取与修改接口继续有效。客户端忽略 editor 响应顶层与 Presentation 响应中的额外字段，
但仍校验必需字段、字段类型、版本及上述资源一致性。

### 执行图与输入来源

Revision 的根图和每个 Subflow graph 必须包含 `nodes` 和 `edges`；没有执行边时显式保存 `edges: []`。
为兼容旧 Draft，解码时将缺失的 `edges` 补为 `[]`；显式提供的 `edges` 仍须通过数组及边结构校验。
Value Node 没有数据输入端口。解码时将其 `inputs` 统一归一化为 `{}`，忽略缺失或任意旧输入数据；执行入边保持不变，仍决定节点何时执行。根图和 Subflow graph 均适用。
执行边使用 `{ source: nodeId, target: nodeId, sourceHandle?: branch }`。普通节点不得设置 `sourceHandle`；Condition 和 Wait 必须指定已声明的分支或 action。
边不含目标 input handle。重复边、缺失端点和指向 Trigger 的边不能通过 validation；允许自连接和回边。边集合按规范顺序参与 Revision digest。

`inputs[handle]` 使用 `{ kind: 'value', value }` 或 `{ kind: 'sources', sources }`。Node source 使用
`{ kind: 'node', nodeId, output, field?: string }`；省略 `field` 选择整个输出，提供时选择输出对象 schema 声明的一级属性，字段名按原始 key 处理（包括空字符串、点号和斜杠），不支持多级路径或数组下标。字段选择统一用于 Inputs、Condition 操作数和 Subflow 输出映射。候选字段来自对象 schema 的直接 `properties`，不解析 `$ref`，不展开 `allOf`、`anyOf`、`oneOf` 分支；无法直接列出字段时仍可选择整个输出。父对象为 null 或自身属性缺失视为无可用来源，显式字段 null 仍是可用来源。Flow input 与 Variable binding 的 source 形式保持不变。Node source 必须指向经执行边可达的祖先，
不要求覆盖目标的每一条执行路径。每条被选中的执行入边分别启动一次 invocation，不等待其他前驱。输入只读取这次到达路径上的结果快照，多个 source 不能在该快照同时提供值；并行前驱的结果分别传给各自触发的 invocation。
所有可执行节点支持可选正整数 `maxExecutions`，默认 1000；按一次 Flow Run 累计，同一 Subflow 节点跨调用共享计数。下一次到达会超过上限时，Run 报错终止。Wait/Agent 决议恢复不增加次数。
调度仅依据执行连线及分支状态；输入来源缺失不导致跳过。零个可用来源补 `null`，一个来源取其值，多个来源报错；实际输出 `null` 仍算一个已提供的值。收集后按端口声明校验，失败则报错。
Subflow 的最终输出采用相同规则，来源可以不覆盖所有返回路径。
`graph.edge.connect` 与 `graph.edge.disconnect` 只修改执行边，`graph.node.input.set` 独立修改数据映射。节点不保存 `concurrency`。

CLI 分开设置执行顺序与输入来源：

```sh
oo flow connect <flow> <source> <target-node> [branch]
oo flow disconnect <flow> <source> <target-node> [branch]
oo flow node input <flow> <node> <input> <source> <output> [<source> <output>...]
```

`oo flow apply` 的 `edges` 同样使用 `source`、`target` 和可选 `sourceHandle`。
不提供旧数据流边、节点 concurrency 或旧 checkpoint 的兼容转换。

## 4. Validation、Publication 与 Live

```ts
interface FlowCheck {
  closureDigest: string
  diagnostics: readonly {
    code: string
    column: number
    line: number
    message: string
    path: string
    values?: Readonly<Record<string, string | number>>
  }[]
  engineContract: string
  flowId: string
  modelVersion: number
  revisionDigest: string
  revisionId: string
  valid: boolean
  version: 1
}
```

Check body 是 `{ engineContract: 'open-flow-engine/v5', version: 1 }`，始终验证 path 中固定的 Flow Revision。
`message` 是稳定的 canonical English fallback；Workbench 可以使用 `code`、可选 `values.variant` 和其余 `values` 显示本地化文案，未知 code 或 variant
必须回退到 `message`。

```ts
interface Publication {
  actorId: string
  closureDigest: string
  createdAt: string
  engineContract: string
  flowId: string
  modelVersion: number
  operation: 'publish' | 'rollback'
  publicationId: string
  providerAccessDigest: string
  revisionDigest: string
  revisionId: string
  sourcePublicationId?: string
  version: 1
}

type PublishOperation =
  | {
      createdAt: string
      flowId: string
      operationId: string
      revisionId: string
      status: 'pending'
      updatedAt: string
      version: 1
    }
  | {
      createdAt: string
      flowId: string
      operationId: string
      publicationId: string
      revisionId: string
      status: 'succeeded'
      updatedAt: string
      version: 1
    }
  | {
      createdAt: string
      flowId: string
      issue: { code: string; message: string; nodeId?: string }
      operationId: string
      revisionId: string
      status: 'failed'
      updatedAt: string
      version: 1
    }

interface Live {
  flowId: string
  hasUnpublishedChanges: boolean
  publication: Publication | null
  revision: number
  status: 'not-published' | 'runnable' | 'suspended'
  version: 1
}
```

Publish body 是 `{ engineContract, expectedLivePublicationId, version: 1 }`。接受与幂等重放都返回 `202` 和同一 `PublishOperation`。客户端通过
`GET /v1/flows/{flowId}/publish-operations/{operationId}` 读取其状态。pending 时不创建
Publication、不移动 Live；succeeded 后可以用 `publicationId` 读取 Publication 与 Live；failed 只返回安全 issue。

新的 Integration subscription 与新建或变更 Poll 的 baseline 都在 pending operation 内准备。Poll baseline 返回的事件不会创建 Run，最终 checkpoint
只在 operation 激活时安装。完全未变化且健康的 Integration/Poll 运行状态可以复用；已有 Integration 不能安全 staged replacement 时，Publish 在建立
operation 前返回 `publication.unsupported`，旧 Live 与现有 subscription 保持不变。

Rollback body 是 `{ expectedLivePublicationId, version: 1 }`，使用 Live CAS。首次提交返回 `201`，幂等重放返回 `200`。Rollback 创建新
Publication 并设置 `sourcePublicationId`，不修改历史和 Draft head。
首次 Publish 或 Rollback 必须在创建 Publication 的权威 transaction 中确认固定 closure 使用的 Variable 均存在；缺失时返回
`binding.unresolved`。相同 operation identity 的幂等重放先返回原 Publication，不因 Variable 后续被删除而改变结果。

Publication list 按 `createdAt`、`publicationId` 逆序稳定分页：

```ts
interface PublicationPage {
  publications: readonly Publication[]
  nextCursor?: string
  total?: number
  version: 1
}
```

## 5. Run

```ts
interface Run {
  createdAt: string
  finishedAt?: string
  flowId: string
  revisionId: string
  runId: string
  source: 'draft' | 'live' | 'trigger'
  startedAt?: string
  status: RunStatus
  version: 1
}
```

Run detail 增加固定的 `closureDigest`、`engineContract`、`engineDigest`、`modelVersion`、`providerAccessDigest` 和 `revisionDigest`。Live Run 增加
`publicationId`；Trigger Run 增加 `publicationId`、`occurrenceId` 和 `triggerNodeId`。

`RunStatus` 包含 `queued | starting | running | waiting | canceled | completed | failed | indeterminate`。所有 Run detail 必须返回待决议集合：

```ts
waits: readonly {
  actions: readonly ['continue'] | readonly ['approve', 'reject']
  expiresAt: string
  nodeId: string
  prompt: string
  waitId: string
  waitingSince: string
}[]
```

集合只包含未决议等待，按登记时间和 waitId 排序。running、waiting、queued、starting 都可能包含多个等待；终态返回空集合。
客户端用 nodeId 定位、用 waitId 决议。waiting 状态要求集合非空，旧单个 waiting 字段不再接受。历史由 RunEvent 表达。

Draft Run body 是 `{ engineContract, inputs, trigger, version: 2 }`。Live Run body 是 `{ publicationId, inputs, trigger, version: 2 }`。首次接受返回 `202`，
幂等重放返回 `200`。Run 接受后不受后续 Draft change、Publish 或 Rollback 影响。

`trigger` 必填，形如 `{ nodeId: string, outputs: Record<string, JsonValue> }`，固定本次运行的起始 Trigger 和完整输出。缺少入口、入口不是固定 Revision 中的 Trigger，或 outputs 缺失、包含额外端口或不符合各端口 schema 时返回 `run.invalid`。nullable 允许端口值为 null，不允许缺失端口。入口及完整 outputs 参与 Control API 幂等 request digest，并随 Run 持久化；不会自动选择入口或退回整图运行。

Draft Run 只对选中 Trigger 沿执行边可达的节点及其依赖进行语义校验、能力检查和 Variable 准入检查。其他分支的未配置 Trigger、无效代码和缺失资源仍出现在全图 check 中，但不阻断此次测试。
共享下游输入的多来源映射忽略本次不可达的已有节点来源；剩余来源缺失时补 `null` 并校验，不影响执行边调度；不能同时提供多个值。缺失节点引用、选中分支内的环、无效代码及实际使用的 Subflow 错误仍返回 `flow.invalid`。
Draft Run 的 `revisionDigest` 标识完整 Revision，`closureDigest` 标识本次入口的执行 closure，可以与全图 check 的 `closureDigest` 不同。读取和恢复 Run 不修改原 Revision。
Publish 和 Live Run 保持完整 Flow 校验。

Manual Trigger 的节点结构为 `{ kind: "manual", name: string, description?: string, icon?: string }`，无输入和调度配置。其执行出口沿普通执行边连接下游，不提供数据输出字段，运行请求中的 `trigger.outputs` 和执行结果均为 `{}`。Cron 直接声明 `scheduledAt` 字符串端口；Poll 和 Integration 通过各自定义声明输出端口。其他 Trigger 可通过显式 outputs 模拟执行，仍保留 Draft/Live Run source，不伪造外部 occurrence。

Webhook 声明四个必需输出，顺序为 `headers`、`query`、`body`、`webhookUrl`。headers 为小写名称的字符串映射；query 单值为字符串，重复值为有序字符串数组；body 是由 `bodyFields` 定义的严格 JSON 对象；webhookUrl 是服务端 Request URL 去除 query 和 fragment 后的绝对地址。空请求体按 `{}` 校验，不填充字段默认值。请求头完整保存，不在 Trigger 层脱敏。

Webhook HTTP 准入的幂等规则独立于 Control API：没有 `Idempotency-Key` 时每次创建 Run；有 key 时在 endpoint 和运行版本范围内查重。摘要包含固定目标身份、协议版本及规范化后的 method、query、body，排除 headers 和 webhookUrl。相同 key 与摘要重放原 Run，摘要不同返回 409。重试不覆盖首次保存的 outputs；并发准入由数据库事务和唯一约束协调。通过请求头区分业务事件的调用方必须使用不同的 key。

首次 Run admission 在创建 Run 的权威 transaction 中确认固定 closure 使用的 Variable 均存在；缺失返回 `binding.unresolved`。幂等重放先于
该 eligibility 检查。Run 真正开始时再在一个读取 snapshot 中解析所有 Variable value，所以排队期间的更新会用于本次执行；开始后的更新不影响
该 Run。Variable value 不进入持久化 Run request，也不由平台写入 `node.started` 的 inputs 投影。

```ts
interface RunPage {
  flowId: string
  runs: readonly Run[]
  nextCursor?: string
  version: 1
}

interface RunEvents {
  done: boolean
  events: readonly RunEvent[]
  eventsExpiresAt?: string
  historyComplete: boolean
  nextAfter: number
  runId: string
  version: 1
}
```

Run list 按 `createdAt`、`runId` 逆序稳定分页。查询可按单个 `status`、`source`、精确 `runId`、`createdFrom`（包含）和 `createdBefore`（不包含）组合筛选；时间参数使用 RFC 3339，范围必须递增。`status=waiting` 只查询已冻结 Run；`pendingWait=true` 查询所有有待决议项的非终态 Run，包含运行中和排队中，`false` 查询其补集。后续页面继续传同一组筛选参数；cursor 只表达 Flow 范围和分页位置。

`after` 是已观察的最后 sequence，只返回更大的事件。terminal Run 最多有一个 terminal event。非 terminal Run 的 result 返回
`run.not-terminal`；取消成功与重复取消分别返回 `cancelAccepted: true` 和 `false`。

公共 `RunEvent` 按 `kind` 区分 payload；`decodeRunEvent` 与 Control client 复用同一 decoder，拒绝缺失或类型错误的必需字段。
事件 envelope 为 `{ createdAt, kind, payload, sequence }`，`sequence` 是非负安全整数；不提供独立的 source sequence。
平台字段按下表投影，用户 `outputs` 和 terminal `result` 内部保持自由 JSON。

| kind                                                            | payload                                                                                 |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `run.queued`                                                    | `{}`                                                                                    |
| `run.started`                                                   | `{ flowId, scopeId, parentScopeId? }`                                                   |
| `run.progress`                                                  | `{ flowId, scopeId, progress }`                                                         |
| `run.completed / run.canceled / run.failed / run.indeterminate` | `{ result: JsonValue }`                                                                 |
| `run.events-truncated`                                          | JSON object；保留给事件明细截断通知。                                                   |
| `node.started`                                                  | Node context，加可选的 `nodeKind`、`nodeTitle`、`operation`。                           |
| `node.completed`                                                | Node context，加 `outputs: Record<string, JsonValue>`。                                 |
| `node.failed`                                                   | Node context，加 `error: { code, message }`。                                           |
| `node.log`                                                      | Node context，加 `level: 'debug' / 'info' / 'warn' / 'error'` 和 `message`。            |
| `node.progress`                                                 | Node context，加 `progress`。                                                           |
| `node.artifact`                                                 | Node context，加 `artifact: { kind: 'artifact', id, name, size, digest, mediaType? }`。 |

Node context 固定为 `{ flowId, scopeId, nodeId, executionId }`，各 identity 为非空字符串。
`progress` 为 0–100 的有限数值；Artifact `size` 为非负安全整数，`digest` 为 `sha256:` 加 64 位小写十六进制。
`nodeKind` 为 `agent / condition / connector / javascript / llm / subflow / value / wait`。
Runtime projector 不接受旧的 `node.cache-hit`、`node.preview` 或 `run.output` 事件。

等待登记、整图冻结和决议分别追加事件：

- `wait.created` payload 为 `{ expiresAt, nodeId, waitId, waitingSince }`；
- `run.waiting` payload 为 `{ waitIds }`，仅在完整 checkpoint 提交时产生；
- `run.resolved` payload 为 `{ action, resolvedAt, waitId }`。

已认证客户端通过 `POST /v1/runs/:runId/waits/:waitId/resolve` 决议当前 Wait，body 固定为
`{ action: 'continue' | 'approve' | 'reject', version: 1 }`。Action 必须属于固定 Revision 中该 Wait 的 `actions`。响应为：

```ts
{
  action: 'continue' | 'approve' | 'reject' | null
  resolutionAccepted: boolean
  resolvedAt: string | null
  runId: string
  status: RunStatus
  version: 1
  waitId: string
}
```

同一 waitId 接受第一个合法、未过期的决议；running 中唤醒原 session，waiting 进入 queued，queued/starting 保持状态并由执行者读取最新决议。同一 action 重放返回
`resolutionAccepted: true`，竞争的另一 action 返回 `false`，两者都返回已经提交的 `action` 和 `resolvedAt`。不存在的 Wait 返回
`run.wait-not-found`，不属于该 Wait 的 action 返回 `run.invalid`。Wait 到期后 Run 以 `run.wait-expired` 失败，不产生新的 Run。

### Run lifecycle conformance

`run-lifecycle` 的状态模型包含 `fail-start` 与 `fail-resume`：两者仅能在 `starting` 提交，分别产生 `failed` 与
`indeterminate`。普通 `commit` 在 `running` 接受 terminal，在任意非 terminal 状态接受取消，并在任意非 terminal 状态接受失败。
已经提交的 terminal 不可覆盖。部署的 lifecycle conformance 必须操作真实权威 store，覆盖首次启动、Wait 恢复、启动失败、
恢复失败、幂等准入与 terminal 竞争；不能以另一套测试专用持久化实现代替部署实现。

公共 Scheduler 的 `RunLaunch` 为首次启动与 Wait 恢复的互斥联合。首次启动必须包含 `trigger`，可包含 `inputs` 和
`bindingValues`；恢复只能包含 `resume: { checkpoint }`，不能重新提供这三项启动数据。决议通过 WaitHost 的权威读取接口取得。Run list 摘要不包含等待详情。

## 6. Trigger 与 Connector

Trigger Key catalog 是 deployment scope 资源：

```ts
{ keys: readonly TriggerKeySummary[]; version: 1 }
{
  definitions: readonly TriggerKeySnapshot[]
  display: Readonly<
    Record<
      string,
      {
        configInputs: Readonly<Record<string, string>>
        displayName: string
        description: string
        outputs: Readonly<Record<string, string>>
      }
    >
  >
  locale: 'en' | 'zh-CN' | 'zh-TW' | 'ja' | 'ko' | 'ru' | 'fr'
  version: 2
}
{ definition: TriggerKeySnapshot; version: 1 }
```

`GET /v1/trigger-keys` 与 `GET /v1/trigger-keys/catalog` 接受可选 `locale` query；query 优先于
`Accept-Language`，缺省与不支持的语言回退英文，非法 BCP 47 query 返回 400。语言映射复用公共 localization
契约。摘要返回翻译后的名称与描述；完整 catalog 的 `display` 按 Trigger key 保存触发器以及配置、输出字段的展示文案，
`definitions` 始终保留原始英文定义。单条 definition、CLI 与持久化的 Flow definition 不因界面语言改变。

公共 `provider-triggers` entry 的 `localizeTrigger(definition, locale)` 返回 `Promise<TriggerDisplay>`，调用方需等待
本地化结果。非英文翻译按语言延迟加载并缓存；英文使用原始定义，不加载翻译资源。

这两个接口返回 `Content-Language`、`Vary: Accept-Language`、`Cache-Control: private, no-cache` 与根据最终响应
生成的 `ETag`。匹配 `If-None-Match` 时返回无 body 的 304，并保留语言与缓存响应头。翻译更新也会使 ETag 失效。

WorkbenchHost 可通过 `triggerCatalogCache: { namespace, storage? }` 启用持久化 catalog 缓存。namespace 必须标识
部署；可选 storage 实现 `getItem` / `setItem`，缺省使用 localStorage，所有存储 key 都带缓存版本、部署和语言。
未提供配置的宿主仅使用内存。列表先显示有效缓存，再用 ETag 刷新；后台失败保留缓存并显示重试提示。

成功 Publication 为 Flow graph 中每个 Trigger node 提交 Live binding：

Trigger 节点的 `name`、`description`、`icon` 只影响呈现。仅修改这些字段的发布保留已有 Poll / Integration 进度、订阅和去重状态；配置、定义、调度与 Connection 仍参与运行语义判断。历史 Revision 和 digest 不改写。

具备统一监听能力的 binding 通过 `listener` 返回独立的变化读取状态。顶层 `health` 仍表示订阅状态；订阅失败且 `listener.health` 为 `healthy` 时，定期读取继续工作。暂停和退役优先于两种健康状态。

```ts
interface TriggerBinding {
  currentPublicationId?: string
  currentRevisionId?: string
  endpointUrl?: string
  flowId: string
  health: 'failed' | 'healthy' | 'initializing' | 'needs_reauth' | 'suspended'
  kind: 'cron' | 'integration' | 'poll' | 'webhook'
  lastErrorCode?: string
  listener?: { health: 'healthy' | 'failed' | 'needs_reauth'; lastErrorCode?: string }
  operatorState: 'active' | 'paused'
  runtimeVersion: number
  triggerNodeId: string
  updatedAt: string
  version: 1
}
```

列表 response 是 `{ bindings, flowId, version: 1 }`。pause/resume body 固定为 `{ version: 1 }`。状态改变递增 `runtimeVersion`，使旧版本
occurrence 无法通过最终 admission guard。Poll test 不推进 checkpoint、不写 dedupe、不创建 Run。

Connector credential 不进入响应、Revision 或 RunEvent。
`ConnectorAction.authenticated` 是必需的 boolean；`false` 表示 Action 可以不绑定 Connection 直接执行，客户端不得显示账号连接要求，
执行请求也不得为了该 Action 合成 Connection identity。`true` 表示执行需要有效 Connection。
部署没有配置 Connector 时，catalog、Connection 请求和 Connector Task 运行失败返回 `connector.unconfigured`；已经配置但上游不可用或响应无效时返回
`connector.unavailable`，客户端不能把两者合并为同一配置提示。

### 事件源管理

事件源是部署资源，当前创建接口支持 `feishu_app_bot` 应用。管理接口复用 Control API 认证；响应不包含 Verification Token 或 Encrypt Key。
`teamId` 是显式 Connector Team identity；无 Team 的部署传 `null`。Flow scope 用 `flowId` 表达，不能用 Team identity 替代。

| Method   | 路由                            | 请求                               | 成功响应                                                 |
| -------- | ------------------------------- | ---------------------------------- | -------------------------------------------------------- |
| `GET`    | `/v1/event-sources`             | 可选 `flowId` query                | `200 { version: 1, sources: EventSource[], teamId? }`    |
| `GET`    | `/v1/event-sources/connections` | 可选 `teamId` query                | `200 { version: 1, connections: ConnectorConnection[] }` |
| `POST`   | `/v1/event-sources`             | `CreateEventSource`                | `201 EventSource`                                        |
| `PUT`    | `/v1/event-sources/:sourceId`   | `UpdateEventSource`                | `200 EventSource`                                        |
| `DELETE` | `/v1/event-sources/:sourceId`   | `{ version: 1, expectedRevision }` | `200 { version: 1 }`                                     |

`CreateEventSource` 为 `{ version: 1, name, connectionId, teamId: string | null, verificationToken, encryptKey, eventTypes: string[], manageSubscriptions: boolean }`。
`UpdateEventSource` 为 `{ version: 1, expectedRevision, name, enabled: boolean, eventTypes: string[], verificationToken?, encryptKey? }`；省略 secret 时保留原值。
更新不能修改 Connection、Team 或应用身份。创建不接受调用方传入 `appId` 或 `provider`，应用身份来自所选 active Connection。

请求不接受额外字段。`name` trim 后为 1–128 字符；Connection / Team ID 为 1–256 字符；secret 为 1–256 字符。
`eventTypes` 包含 1–200 个互不重复的值，各值匹配 `^[a-z][a-z0-9_.]{0,127}$`；`expectedRevision` 为正整数。
非法请求返回 `400 event-source.invalid`；无法获取可信应用身份返回 `409 event-source.identity-unavailable`。

`EventSource` 为 `{ version: 1, sourceId, revision, name, provider, appId, connectionId, teamId, enabled, eventTypes, manageSubscriptions,
verificationTokenConfigured, encryptKeyConfigured, endpointUrl, verifiedAt, lastReceivedAt, updatedAt, consumers }`。
`provider` 为 `feishu` 或 `feishu_app_bot`；`endpointUrl`、`verifiedAt`、`lastReceivedAt` 可为 `null`。
`consumers` 为 `{ flowId, flowName, triggerNodeId }[]`。secret 只通过两个 `*Configured` boolean 投影，不回传原文。

带 `flowId` 的列表先检查 Flow 存在，仅返回该 Flow 所属 Team 的事件源，并始终包含 `teamId`（可为 `null`）；
不存在的 Flow 返回 `404 flow.not-found`。省略 `flowId` 时返回当前管理身份可见的事件源。
连接列表使用显式 Team scope；需要选择 Team 时不能静默采用不同 Team。

更新成功后递增 `revision`；过期的更新或删除返回 `409 event-source.conflict`，不得修改原状态。
应用已有事件源、资源上限、删除仍被发布中或已发布 Trigger 使用的事件源，以及删除这些 Trigger 仍需要的事件类型，也返回该 conflict。
不存在的事件源返回 `404 event-source.not-found`。这些管理接口不使用 `Idempotency-Key`，并发控制由 `expectedRevision` 负责。

### Provider Access Binding

Binding 和 candidate 都携带 `connectionId`、`providerId`、`accessBindingId` 和显式 `source`：
`{ kind: 'admin-delegation' }` 为管理员委托；`{ kind: 'policy', ruleId: null }` 为团队默认 grant；
`{ kind: 'policy', ruleId: string }` 为具名规则。`null` 不表示未知或尚未配置。普通规则 ID 可以为 `team-admin`、`team-default` 等任意非空字符串。
公共 `providerAccessBindingId` 按 canonical JSON 对 `['provider-access', 2, teamId, connectionId, providerId, source]` 求 SHA-256，返回 `sha256:<hex>`。
规则名称、内容和 policy revision 不参与身份。解析时校验身份与其来源及 Connection 一致，再直接解析指定来源；规则删除、Connection 失效或身份不匹配必须拒绝，不能回退其他授权。
客户端写入仍只提交候选 ID 和 CAS revision；部署验证候选可分配性后保存完整身份，并将其复制到 Publication、Run 和后台工作快照。不得信任客户端自报的来源。
旧的无类型 binding ID 不能用于执行。读取已保存的列表时，单条不符合当前协议但仍有合法 `accessBindingId` 和 `providerId` 的记录投影为
`status: 'invalid', connectionId: null, source: null`，保留可用展示名称，提示重新授权；不能据此恢复或推断任何 grant。
无法识别的条目被跳过，响应通过可选的 `discardedBindingCount` 提示需要重新配置。合法记录继续显示；响应 envelope 不合法仍报错。
候选列表继续严格校验，不能把损坏的候选转成可选授权。后台执行也必须拒绝缺少身份的引用。升级与远端资源清理仍按运行手册进行。

Code 的共享 Provider access 是 deployment-owned Flow 状态，不进入 Revision。Connector、Agent 固定工具、Trigger 和通知在 Revision 中显式选择连接，不需要添加 Code 使用。公共 API 支持两种模式：`implicit` 使用部署已配置的 scoped Connector authority；
`selectable` 由部署按 Provider 返回并保存 opaque access binding。公共合同和 Workbench 不解析权限组内容、不接收 credential，也不创建 Flow service account；
具体 deployment adapter 负责把外部权限组投影成 opaque candidate 和 binding。

```ts
type ConnectorAccessMode = 'implicit' | 'selectable'
type ProviderAccessBindingStatus = 'active' | 'forbidden' | 'invalid' | 'missing'

interface ConnectorAccess {
  accessRevision: number
  bindings: readonly {
    accessBindingId: string
    connectionId: string
    source: { kind: 'admin-delegation' } | { kind: 'policy'; ruleId: string | null }
    connectionDisplayName: string
    permissionGroupName: string | null
    policyRevision?: string
    providerId: string
    status: ProviderAccessBindingStatus
  }[]
  // Present in new immutable snapshots: node use, separate from shared Code bindings.
  nodeBindings?: ConnectorAccess['bindings']
  mode: ConnectorAccessMode
  providerAccessDigest: string
  version: 1
}
```

| Method   | Path                                                  | Body                                                      |
| -------- | ----------------------------------------------------- | --------------------------------------------------------- |
| `GET`    | `/v1/flows/:flowId/connector-access`                  | 无                                                        |
| `POST`   | `/v1/flows/:flowId/connector-access/candidates/query` | `{ providerIds: string[], version: 1 }`                   |
| `PUT`    | `/v1/flows/:flowId/connector-access/:providerId`      | `{ accessBindingId, expectedAccessRevision, version: 1 }` |
| `DELETE` | `/v1/flows/:flowId/connector-access/:providerId`      | `{ accessBindingId, expectedAccessRevision, version: 1 }` |

`bindings` 是整个 Flow（含 Subflow）的 Code 共享允许列表。`nodeBindings` 在新 Publication / Run 快照中固定节点使用；缺失该字段的历史快照沿用旧共享列表语义，空数组则表示没有节点连接。
`GET /v1/flows/:flowId/connector-access?publicationId=...` 读取归属此 Flow 的已发布快照，只读；不带参数读取 Draft Code 配置。

`POST /v1/flows/:flowId/connection-usage/remove` 接收 `{ version: 1, connectionId, expectedRevisionId, expectedAccessRevision }`，
通过标准 `Idempotency-Key` 固定请求身份，返回 `DraftChange`。部署在单个事务中检查两个版本并清除该账号的所有节点选择和 Code 使用。
保留节点、代码、输入与连线，不改上游授权、Publication 或已接受 Run。发生任一冲突时全部失败；成功发送 `draft.changed` 与 `access.changed`。
重试同一幂等请求返回原结果；不同请求不得复用 key。移除之后可以保存待配置 Draft，不能靠默认连接自动恢复使用。

MCP 提供 `flow_code_connections`、`flow_connection_candidates`、`flow_code_connection_set` 和 `flow_connection_usage_remove`，复用上述业务操作。
CLI 对应 `oo flow connector code-access <flow>`、`candidates <flow> <provider>`、`code-allow|code-remove <flow> <provider> <binding> <access-revision>`，
以及 `remove-usage <flow> <connection> <access-revision>`（沿用编辑命令的 Revision 和幂等参数）。所有修改仅作用于 Draft。

候选查询按需批量提交非空、无重复的 `providerIds`（单个 ID 长度不超过 256）。响应为 `{ results, version: 1 }`，每个请求的 Provider 恰好对应一个结果：
成功项为 `{ candidates, mode, providerId, version: 1 }`，失败项为 `{ providerId, error: { code, message } }`。共享的团队身份、账号目录或权限策略读取失败时，整次请求按常规错误契约失败；某个 Provider 的候选计算失败不影响其他结果。
多 Provider 查询共用团队成员身份、操作者身份、团队账号目录和权限策略；单 Provider 查询只读取对应服务账号。Workbench 首次展开时批量加载缺失项，新增服务只补查新增项，缓存命中和正在加载的项不重复请求；失败项通过显式重试重新加载，切换 Flow 时取消旧查询。

candidate 使用 `connectionDisplayName`、可为空的 `permissionGroupName` 和可选的 `isDefault`
分别投影连接、权限组名称与部署的默认连接，但不包含 credential 或原始权限规则。`permissionGroupName` 仅用于展示，不决定权限来源。candidate 可提供只读的
`permissions: { actionIds, allActions, configured, proxy }` 摘要供 Workbench 展示和筛选；`actionIds` 使用完整 Action ID，`configured` 只表示权限组包含托管访问配置，
不得投影配置内容。该摘要不是授权依据，也不得写入 Flow binding。Workbench 添加 Connector Action 时先排除摘要明确不允许该 Action 的 candidate，再优先分配
`isDefault: true` 的 candidate；兼容未提供摘要、或未提供 `isDefault` 但只有一个可用 candidate 的部署。多个 candidate 没有明确默认项时不自动分配。
同一 Provider 可以保存多个 binding，
每个 binding 授权一个 Connection 及该操作者可分配给 Flow 的权限组；`PUT` 增加一个 binding，`DELETE` 删除 body 指定的 binding。更新成功返回完整
`ConnectorAccess` snapshot。
`expectedAccessRevision` 使用单调 revision 防止覆盖并发修改；冲突返回 `connector.access-conflict`。缺失、无权分配、失效和部署不支持写入分别使用
`connector.access-required`、`connector.access-invalid` 和 `connector.access-unsupported`。并发冲突使用 HTTP `412`。access 改变通过 `{ kind: 'access.changed', flowId,
accessRevision, version: 1 }` 通知客户端失效缓存。

开源 Server 根据 Connector endpoint 选择模式：OpenConnector 使用 `implicit`，snapshot 固定为 revision `0`、空 bindings 和 digest `implicit`，候选列表为空，
PUT/DELETE 返回 `connector.access-unsupported`；`connector.oomol.com` 和 `connector.oomol.dev` 使用 `selectable`。托管模式用配置的 OOMOL 用户 token 从
`api.oomol.{com|dev}/v1/users/profile` 取得当前用户 UID，从 relation-control 读取 Flow Team 的 app-access，校验该用户可分配的 candidate，并只保存 opaque
binding。app-access 投影缓存五分钟；Action、Connection、catalog、execute 和 proxy 都按同一 binding fail closed。
开源 Server 以用户 token 调用托管 Connector，因此不会伪造只允许 Team token 携带的 `accessGrant`；包含 `appAccessConfig` 的 binding 必须由具备 Team token
transport 的托管 Flow runtime 执行，开源 Server 对这类执行返回 `connector.access-invalid`。

Workbench 的 `onManageConnectorAccess(flowId)` 是可选宿主导航钩子，只负责打开部署自己的权限管理界面；权限规则和 token 不进入 Workbench props。

### Connector 原样透传

以下 GET 接口独立于 Flow catalog 接口实现，直接访问部署配置的 Connector：

| Flow 接口                       | 上游接口        |
| ------------------------------- | --------------- |
| `/v1/connector/proxy/providers` | `/v1/providers` |
| `/v1/connector/proxy/actions`   | `/v1/actions`   |
| `/v1/connector/proxy/apps`      | `/v1/apps`      |

三个接口均要求 Flow 认证。可选 `flowId` 必须非空且只提供一次，由 Flow 校验并解析团队范围，不传给上游。
其余查询参数（包括重复项）原样透传，由上游解释和校验；不转换 `locale`、`q`，也不按服务展开目录。
使用部署的 Connector token 和解析后的 `x-oo-team-id`，不接受客户端覆盖凭据或团队。
请求头 `Accept-Language`、`If-None-Match` 透传。

参数和响应结构遵循当前部署的 oomol-connector 或 open-connector 对应非 proxy 接口：Provider、Action、App 的原始字段及
`success` / `data` 等上游封装保持不变，不转换成 Flow 的 `ConnectorProvider`、`ConnectorAction`、`ConnectorConnection`，不添加 `version`。
`apps` 对应运行时账号发现，不对应上游连接管理接口 `/v1/connections`。

上游 HTTP 状态码、响应体和 `ETag` 原样返回，错误响应也不改写；304 保持空响应体。
不使用 Flow catalog 缓存或生成本地 ETag，也不覆盖上游 `Cache-Control`、`Vary`、`Content-Language`。
过滤逐跳响应头及 fetch 解压后的 `Content-Encoding`、`Content-Length`；重定向原样返回，不自动跟随。
请求超时为 30 秒，覆盖响应体读取，并支持客户端取消。响应体直接流式转发，保留背压和下游取消传播，
不全量缓冲、不设置响应体总大小限制。返回响应头之前的传输失败使用 Flow 错误格式；响应开始后的读取失败或超时中断响应流，不能再改写状态码。
本地未配置、Flow 校验与传输失败仍使用 Flow 错误格式；其中返回响应头之前的传输失败或超时返回 `connector.unavailable`。

## 7. 实时通知

公共 Workbench Host 合同包含两个独立 subscriber：

```ts
subscribeFlowCatalog(listener: (event?: FlowCatalogEvent) => void): { ready: Promise<void>; stop(): void }
subscribeFlow(flowId: string, listener: (event?: FlowChangeEvent) => void): { ready: Promise<void>; stop(): void }

type FlowCatalogEvent =
  | { kind: 'flows.changed'; version: 1 }
  | { kind: 'flow.created'; flowId: string; version: 1 }

type FlowChangeEvent =
  | { flowId: string; kind: 'draft.changed'; revisionId: string; version: 1 }
  | { flowId: string; kind: 'run.created'; runId: string; version: 1 }
  | { flowId: string; kind: 'run.changed'; runId: string; version: 1 }
```

`ready` 在首次订阅连接建立后 resolve，客户端在此之后读取初始状态；首次成功连接不再额外调用 `listener(undefined)`。
首次连接失败或等待超时时，宿主也必须 resolve `ready`，允许客户端继续加载；取消订阅时同样必须 settle `ready`。
`stop()` 关闭连接、取消重试，并停止后续回调。
`undefined` 表示首次等待结束后连接重新建立，包含失败或超时后的第一次成功连接，客户端必须 refetch。
在初始 snapshot 读取期间收到的 invalidation 不能丢弃；Draft revision 与 snapshot 相同时无需重复同步，否则读取当前 Draft。
事件不携带资源快照，客户端仍通过读取 API 获取内容。`flow.created` 仅在新 Flow 首次创建成功时发送，幂等重放不重复发送。
Workbench 已完成初始化并停留在 Flows 列表时，收到该事件自动打开新 Flow；已经打开详情、正在本地创建或已开始自动导航时不抢占当前操作。
初次列表加载、普通 `flows.changed` 和重连 invalidation 只刷新列表，不推断新建并跳转。Server 的首次连接等待上限为 5 秒，之后继续尝试连接。Server 同源宿主使用两个独立 SSE 请求：

- `GET /v1/flows/notifications`
- `GET /v1/flows/:flowId/notifications`

两者返回 `text/event-stream`，要求 operator 认证，并在 session 失效或 Server shutdown 时结束。其他部署可以使用不同实时 transport，但必须维持
相同的两个独立逻辑通道和事件合同。

## 8. Routes

| Method    | Path                                                       | 成功状态 | 说明                                              |
| --------- | ---------------------------------------------------------- | -------: | ------------------------------------------------- |
| `GET`     | `/v1/flows`                                                |      200 | `cursor`、`limit`、`includeTotal`                 |
| `POST`    | `/v1/flows`                                                |  201/200 | `{ name, teamId?, version: 1 }`                   |
| `GET`     | `/v1/flows/:flowId`                                        |      200 | Flow 与 Draft head                                |
| `PATCH`   | `/v1/flows/:flowId`                                        |      200 | `{ name, version: 1 }`                            |
| `DELETE`  | `/v1/flows/:flowId`                                        |      202 | 进入 `retiring`                                   |
| `GET`     | `/v1/flows/:flowId/editor`                                 |      200 | Flow、Draft、Live 与 Presentation 聚合读取        |
| `GET`     | `/v1/flows/:flowId/draft`                                  |      200 | 当前 Draft snapshot                               |
| `GET`     | `/v1/flows/:flowId/draft/sync`                             |      200 | 当前完整 snapshot                                 |
| `POST`    | `/v1/flows/:flowId/draft/changes`                          |      200 | `Idempotency-Key` 与 change batch                 |
| `POST`    | `/v1/flows/:flowId/draft/repair`                           |      200 | 宽容修复并创建新的 Draft Revision                 |
| `GET`     | `/v1/flows/:flowId/revisions/:revisionId`                  |      200 | immutable Revision                                |
| `GET/PUT` | `/v1/flows/:flowId/presentation`                           |      200 | Presentation CAS                                  |
| `POST`    | `/v1/flows/:flowId/revisions/:revisionId/check`            |      200 | 固定 Revision validation                          |
| `GET`     | `/v1/flows/:flowId/live`                                   |      200 | Live projection                                   |
| `GET`     | `/v1/flows/:flowId/publications`                           |      200 | Publication page                                  |
| `POST`    | `/v1/flows/:flowId/revisions/:revisionId/publications`     |      202 | Publish operation                                 |
| `GET`     | `/v1/flows/:flowId/publish-operations/:operationId`        |      200 | Publish operation                                 |
| `POST`    | `/v1/flows/:flowId/publications/:publicationId/rollback`   |  201/200 | Rollback                                          |
| `POST`    | `/v1/flows/:flowId/revisions/:revisionId/runs`             |  202/200 | Draft Run                                         |
| `POST`    | `/v1/runs`                                                 |  202/200 | Live Run                                          |
| `GET`     | `/v1/flows/:flowId/runs`                                   |      200 | Run page filters                                  |
| `GET`     | `/v1/runs/:runId`                                          |      200 | Run detail                                        |
| `GET`     | `/v1/runs/:runId/events`                                   |      200 | `after`、`limit`                                  |
| `GET`     | `/v1/runs/:runId/result`                                   |      200 | terminal result                                   |
| `POST`    | `/v1/runs/:runId/cancel`                                   |      200 | `{ version: 1 }`                                  |
| `POST`    | `/v1/runs/:runId/waits/:waitId/resolve`                    |      200 | `{ action, version: 1 }`                          |
| `GET`     | `/v1/trigger-keys`                                         |      200 | Trigger summaries                                 |
| `GET`     | `/v1/trigger-keys/catalog`                                 | 200, 304 | definitions, display, locale                      |
| `GET`     | `/v1/trigger-keys/:key`                                    |      200 | definition detail                                 |
| `GET`     | `/v1/flows/:flowId/triggers`                               |      200 | Trigger bindings                                  |
| `GET`     | `/v1/flows/:flowId/triggers/:triggerNodeId`                |      200 | binding detail                                    |
| `GET`     | `/v1/flows/:flowId/triggers/:triggerNodeId/activities`     |      200 | Activity page                                     |
| `POST`    | `/v1/flows/:flowId/triggers/:triggerNodeId/pause`          |      200 | pause                                             |
| `POST`    | `/v1/flows/:flowId/triggers/:triggerNodeId/resume`         |      200 | resume                                            |
| `POST`    | `/v1/flows/:flowId/triggers/:triggerNodeId/test`           |      200 | Poll test                                         |
| `GET`     | `/v1/connector/teams`                                      |      200 | 可用 Team 目录：enabled、teams、version           |
| `GET`     | `/v1/connector/providers`                                  |      200 | Provider catalog；可选 `flowId`                   |
| `GET`     | `/v1/connector/actions`                                    |      200 | `service` 或 `q`；可选 `flowId`                   |
| `GET`     | `/v1/connector/actions/:actionId`                          |      200 | Action detail；可选 `flowId`                      |
| `GET`     | `/v1/flows/:flowId/triggers/:triggerNodeId/options/:field` |      200 | 草稿 Trigger 的动态配置选项；由已保存连接限定范围 |
| `GET`     | `/v1/connector/connections`                                |      200 | 当前 scope 的全部 Connections；可选 `flowId`      |
| `GET`     | `/v1/connector/connections/:serviceId`                     |      200 | Connections；可选 `flowId`                        |
| `POST`    | `/v1/connector/connections/:serviceId/page`                |      200 | 外部授权页 URL；可选 `flowId` 或 `teamId`         |

Connector route 的 `flowId` 是 opaque Flow identity。提供时部署必须先确认 Flow 存在，并在该 Flow 的 Connector scope 内解析 Provider、Action 与
Connection；客户端不能改用 Team ID、Connection owner 或其他外部 identity 代替 Flow scope。省略时使用部署的未限定 Connector catalog。

授权页接口例外：`POST /v1/connector/connections/:serviceId/page` 接受可选的 `flowId` 或 `teamId`，两者不能同时提供。
`teamId` 供独立事件源表单使用，必须对应当前 Connector 身份可访问的团队；不会修改已有 Flow 的团队。
对于 OOMOL 托管 Connector，Server 查询团队名称并生成 `https://console.oomol.com/team/:teamName/connections/:serviceId`（开发环境使用 `.dev`）；
省略两者时选择当前身份的默认团队。托管入口从受支持的 runtime 域名推导，不使用自部署 Console 配置。
自部署 Connector 使用显式配置的 Console origin 和 `/providers/:serviceId` 路径。未配置 Console origin 时返回
`503 connector.console-unconfigured`；它与 Connector 请求失败的 `connector.unavailable` 分开，客户端应提示配置授权控制台地址。

`POST /v1/event-sources` 创建飞书事件源时，从所选 active Connection 获取应用身份；
缺少可信的 App ID 时返回 `409 event-source.identity-unavailable`。事件源以应用为边界，不绑定企业，
不查询企业信息，也不要求 `tenant:tenant:readonly` 权限。事件源响应不含 `tenantKey`。
接收事件时校验加密内容、Verification Token、签名和 App ID；事件自身的 `tenant_key` 作为触发器输出保留，不用于企业匹配。

`GET /v1/connector/connections` 返回 `{ version: 1, connections: ConnectorConnection[] }`，与按服务读取的接口使用相同的 Flow scope 校验。
Provider 列表接受可选 `locale`，省略时按 `Accept-Language` 解析默认语言；响应携带 `Content-Language` 和 `Vary: Accept-Language`。
Workbench 将界面语言写入 Provider 请求 URL，按语言分别持久化响应及 ETag；部署将相同语言传递至上游，Action 中的应用名称也采用该语言。
Provider 仅描述应用目录；面板独立加载 Connections，并根据 active Connection 在展示层计算应用排序。

Connector Provider、Action（列表、搜索和详情）及 Connection GET 响应使用 `Cache-Control: private, no-cache` 和内容生成的
`ETag`。服务端在完成当前身份、Flow scope 校验及数据读取后比较 `If-None-Match`；匹配时返回无 body 的 304。

WorkbenchHost 可通过 `connectorCache: { namespace, localStorage?, sessionStorage? }` 配置持久化；namespace 标识部署。
Providers 和 Actions 使用 localStorage，Connections 使用 sessionStorage；Triggers 通过 `triggerCatalogCache` 使用 localStorage。
各数据 Store 持有稳定的 `ReadonlyVal<{ data, refreshing, error }>`，底层请求仅负责传输和解码，不保存缓存。
存储键包含版本、部署及业务标识：Providers 为 Flow scope 和语言，Actions 为 Flow scope、service 和语言，
Connections 为 Flow scope，服务列表从同一份响应派生，Triggers 为语言。使用新版本键，不读取旧 URL 缓存。

Actions 按 Flow scope、service 和语言缓存并持久化完整的 provider 列表响应。画布、节点面板与代码节点所需的单个 Action 从同一份列表派生，不再发起独立详情请求。浏览器 proxy 列表按团队范围读取，不按 Flow 已选授权过滤；成功加载完整列表后才能判断 Action 不存在。默认连接与当前连接状态从独立的 Connections Store 组合。
Action metadata 保留上游可选的 `operationType` 字段（`read`、`write`、`destructive`）；缺失或未知值在节点面板显示为其他接口。

元数据接口 `/v1/connector/action-metadata`（可选 `service` 或 `q`）及其 `/:actionId` 详情接口继续可用；浏览器仅在搜索时使用 `q` 入口。它们接受 `flowId` 和 `locale`，
遵循相同鉴权、语言协商及条件请求规则。响应分别为 `{ version: 1, actions: ConnectorActionMetadata[] }` 和 `{ version: 1, action: ConnectorActionMetadata }`，
不包含 `defaultConnection`，读取时不查询 Connections。Action 持久化键升级为 v3，避免复用旧组合响应的 ETag。
Workbench 使用独立的 `ConnectorActionView` 表示组合后的展示数据。
CLI 和 MCP 继续使用原 `/v1/connector/actions` 对应的组合接口；它们在响应时选择 active 默认账号或唯一 active 账号，
保留 `ConnectorAction.defaultConnection`。这些组合响应的 ETag 仍随账号变化，浏览器不使用它们作为 Action 缓存。
全局搜索使用独立的临时查询状态，不持久化，也不写入 service 列表。Connections Store 读取 `/v1/connector/connections`：带 `flowId` 时返回其固定 Team 下当前用户有权选择的账号（不受 Code 共享列表限制），不带时返回团队账号；同一 scope 的全量与按服务视图共享完整响应。账号缓存使用独立键，不复用原始 proxy Apps 缓存。
画布按 provider 读取 Action 列表并派生所需详情；应用排序使用全量 Connections，账号选择使用对应服务的 Connections。

业务访问 Store 接口时检查刷新间隔：Providers、Triggers 为 5 分钟，Actions、Connections 为 30 秒。
没有定时轮询或额外的聚焦刷新；授权完成和手动重试按业务需要强制刷新。普通读取合并同一条目的进行中请求，由 Store 管理取消。
强制刷新遇到进行中的旧请求时，等待旧请求结束后重新读取；旧结果不写入缓存，刷新状态保持到新请求完成。新请求开始前的多次强制刷新合并。
恢复持久化数据时校验结构，首次访问立即重验证。刷新期间保留数据，失败保留数据并发布 error，自动重试延后 30 秒。
ETag 与数据共同持有；304 保留数据并采用返回的新 ETag，200 没有 ETag 时清除旧验证器。
未配置持久化、存储损坏或不可用时以内存运行。浏览器业务禁止绕过数据 Store 调用这四类底层请求，由边界检查约束。

部署的 Connector 客户端每次直接读取上游 Providers、Actions（列表、搜索、详情）及 Apps（全量、按服务）的完整响应，
不保存响应体或 ETag，不发送上游条件请求；失败时不复用历史数据。Action 目录的单响应和总响应大小限制仍然生效。
三个浏览器 proxy 接口独立透传上游缓存协议，不经过此客户端。
Open Flow 对转换后的响应生成自己的 ETag，不直接透传上游 ETag。

分页 cursor 是 opaque、scope-bound token。跨 Flow、Trigger 或资源类型使用 cursor 返回 `page.invalid-cursor`。

## 9. 公开 Wait action hook

配置了公开 origin 的部署可以把一次 Wait 的 opaque capability URL 放进 Connector 通知。该路由不使用 Operator session 或 bearer token：

```text
/v1/wait-actions/:capability/:action
```

`action` 固定为 `continue | approve | reject`，并且必须属于 capability 绑定的 Wait。响应始终是 JSON，不返回 HTML、不跳转、不设置 cookie，
并带 `Cache-Control: no-store`：

- `GET` 只检查 action，成功时返回 `{ action, expiresAt, prompt, state: 'waiting' | 'resolved', version: 1 }`；
- `HEAD` 与 `GET` 使用相同检查和状态码，但没有 response body；
- `POST` 才提交 action，成功时返回
  `{ action, resolutionAccepted, resolvedAt, state: 'waiting' | 'resolved' | 'unavailable', version: 1 }`。

`POST` 服从与认证 resolve route 相同的 first-writer-wins 和幂等重放语义。capability、action 或原等待记录不匹配，以及 capability 已到期时返回
`404 wait-action.not-found`；其他方法返回 `405 wait-action.method-not-allowed` 并携带 `Allow: GET, HEAD, POST`。服务端只持久化
capability 摘要；完整 capability 是 bearer credential，消费端不得把它作为普通可公开 URL 记录或转发。

请求被限流时返回 `429 wait-action.rate-limited`，携带表示剩余等待秒数的 `Retry-After`；被限流的 `POST` 不提交决议。
`HEAD` 的限流响应同样没有 response body。

已决议等待的独立 receipt 随 Flow 删除清理，不受事件 retention 影响。进入下一个等待或 Run terminal 后，原 waitId
仍返回胜出 action 与原 resolvedAt；相同决议 `resolutionAccepted: true`，相反决议为 `false`，均不再排队执行。
未决议的取消或到期等待不生成决议事实。外部 capability 到期后不能因 receipt 保留而继续授权。

### Wait 局部执行与冻结

Wait 移除内联 notification 配置，声明固定 pending 出口，在等待建立时触发一次。该输出为 `{ value, prompt, actions: [{ action, url }], expiresAt }`，actions 使用节点固定操作集合，value 保持输入 schema。
通知边和所选 action 边可同时执行，不互斥；approve/reject 互斥。通知后续按普通节点执行，决议不取消通知，没有通知专属时限。
图静止且尚有等待时保留 session 120,000 ms，期间不序列化或保存完整 checkpoint、不扣执行预算。再次静止重新计时，无效唤醒不续期。
到期重新读取决议再提交 checkpoint，竞争中的已决议 Run 重新排队。Wait 记录及决议立即持久化；原地批准无需保存 checkpoint。
Scheduler WaitHost 提供 `create(WaitRequest)`、`resolutions(waitIds, block)`；部署保证固定输入、权限、持久化与唤醒。恢复时读取最新决议，不依赖 claim 时快照。

### Scheduler checkpoint 与节点事件

Scheduler checkpoint 的精确对象为：

```json
{
  "bindingValues": {},
  "inputs": {},
  "results": { "start": { "jobId": "start", "outputs": {} }, "source": { "jobId": "job-1", "outputs": { "value": 42 } } },
  "counts": { "": { "source": 1, "approval": 1 } },
  "frames": { "job-2": { "start": {}, "source": { "value": 42 } } },
  "version": 5,
  "agents": {},
  "waits": [{ "jobId": "job-2", "nodeId": "approval", "value": 42, "waitId": "opaque-id" }]
}
```

`inputs` 保存按 node ID 和 input handle 索引的启动输入，`bindingValues` 保存本次 Run 的 Variable binding 快照。
`results` 保存各节点最后一次完成的 output。`counts` 按 graph scope 和 node ID 保存累计执行次数，根 Flow 的 scope 为 `""`，Subflow 的 scope 为 subflow ID。
`frames` 按等待 job ID 保存其到达时的节点结果快照。`waits` 保存所有待应用决议的等待，允许同一 node ID 的多个不同 job；已释放 pending 时每项还保存完整 `pending` 输出。`agents` 按 job ID 保存
`{ invocationId, input, remainingMs?, checkpoint }`，其中 checkpoint 是 Agent continuation 合同。配置了节点 timeoutMs 时，
remainingMs 必须为正且不得超过原上限。总 JSON 大小不得超过 16 MiB。
恢复必须验证精确字段、job/wait identity 唯一、计数符合节点上限、结果符合声明、等待输入与保存路径一致，以及 Agent continuation 的输入和剩余预算。旧版检查点不能按 v5 恢复。

未进入执行路径的节点不创建 job 或 execution identity，也不产生节点事件。每次到达创建独立 identity，暂停恢复保持原 identity。
普通 Task 已声明但缺失或为 `undefined` 的 output 补为 `null`；整个返回值为 `undefined` 时按空对象处理，显式非对象返回值仍非法。端口内部的数据不递归归一化，Condition、Wait 未选中的分支端口保持缺失。
Runtime 在 JSON 传输前校验并复制返回数据；仅允许整个返回值及顶层端口的 `undefined`，拒绝函数、Symbol、BigInt、非有限数字、循环引用、非普通对象及端口内部的 `undefined` 或稀疏数组。传输不调用返回对象的 `toJSON`，不依赖 JSON 序列化静默丢弃或转换非法值。
`node.completed` 仅在节点完整 output 校验成功后产生，payload 的 `outputs` 是按 handle 索引的完整最终结果对象，无输出时为 `{}`。
每次节点 invocation 只产生一条完成事件，且先于其完成阶段释放的下游节点的 `node.started`；不再产生逐 handle 的 `node.output`，普通 Task 不支持运行中的中间 output。Wait 的 pending 出口在登记后可用，Wait 本身仍只在决议后完成一次。

Flow terminal result 使用 `{ kind: 'node-results', nodes }`，`nodes` 只保存已执行完成的图末端节点的最后一次完成结果，按 node ID 排序；每次 invocation 的完整输出保存在运行事件中。
每项为 `{ nodeId, status: 'completed', jobId, outputs }`，不包含未执行节点或重复执行的 jobs 数组；没有已执行完成的末端节点时为 `[]`。

## 10. Code Action 合同

当前脚本合同为 `open-flow-engine/v5`，执行调度采用每条入边到达分别执行和每节点累计次数限制；v4 及更早的 Publication / Run 不能按此合同执行，需要重新发布或新建 Run。它用 `context.actions` 替代 v1 的 `context.connector`，不提供旧名转发；
固定为 v1 的 Publication / Run 必须由相应 Engine 执行，当前 Server 对 v1 明确返回不支持。
Code Connector 授权由 Provider Access Binding 或部署的 implicit Connector authority 管理，不增加节点级开关或白名单。

### Revision 与编辑 operation

Inline Task 的 `capabilities` 可省略或为空数组。Workbench 只在需要保存非授权的 Action/Connection 编辑提示时写入声明：

```json
{
  "kind": "connector"
}
```

声明是否存在不控制 Connector API；所有 Code Task 都可动态调用当前 Flow 可访问的 Action。严格 decoder 仍读取旧 immutable Revision 的
`action`、`connections` 和 `connectionId` 结构，但这些字段不再授权，alias/default 仅转换为按 Action 查找的调用提示。
新的可选 `actionHints` 只保存 Action ID 以恢复 schema typing，`connectionHints` 只保存 alias/default 解析提示；两者都不是允许集合，也不参与 Provider 授权。所有对象拒绝未知字段。

通过既有 Draft changes 提交：

```ts
{
  kind: 'graph.node.task.capabilities.set',
  target: { kind: 'flow' }, // Subflow 使用 { kind: 'subflow', id }。
  nodeId: 'code-node',
  before: previousCapabilities, // 原声明不存在时省略。
  value: nextCapabilities, // 省略时删除整个 capabilities 属性。
}
```

operation 检查目标是 inline Code Task，并精确比较 `before`，沿既有 expected Revision 和 change identity 提交。
公开 `setCodeActions(content, target, nodeId, capabilities)` 生成该 operation；`createCodeTask` 的端口配置参数也接受 `capabilities`。
CLI 的 `flow apply` JSON 中，`kind: "code"` 节点直接接受同一 `capabilities` 数组，无需独立命令或另一套配置格式。
普通源码、端口修改和复制保留声明。

### 脚本 API

```js
export default async (inputs, context) => {
  // 动态 Provider 方法。
  const user = await context.actions.github.get_current_user({})

  // 完整 ID 与显式 call 进入同一个 validator 和 Capability host。
  const getUser = context.actions['github.get_current_user']
  const work = await getUser({}, { connectionId: 'connection-work' })
  const message = await context.actions.call('slack.send_message', { text: inputs.text }, { connectionId: 'connection-work' })
  return { user, work, message }
}
```

非 JavaScript 标识符名称使用方括号，如 `context.actions['google-drive'].list_files({})`；剩余动作名含点时也只占第二级键。
根表和 provider 表使用空原型并冻结，通过 Proxy 动态构造稳定的方法引用。

省略第一个参数或传入 `undefined` 等价于传入 `{}`，必填字段仍由 Action schema 校验。业务参数必须是 JSON 对象，保留字段中的显式 `null`，不套用图端口的 null/default 归一化。循环引用、`undefined` 属性、非有限数字、函数、BigInt、
Date 等非 JSON 值在进入 transport 前失败。方法返回 Connector Action data，直接 `await` 取得；失败抛出含稳定 `code` 的 Error。

第二参数可以省略，或恰为 `{ connectionId: string }` / `{ connectionAlias: string }`，两个字段互斥。空对象、空字符串、null 和未知字段返回
`capability.invalid`。显式 `connectionId` 不经过 Revision 白名单；Connector 按固定 Provider access 独立授权。未知 alias 返回
`capability.denied`。authenticated Action 未提供 Connection 时返回 `connector.connection-required`；伪造桥接请求仍由宿主拒绝。

旧 alias/default 提示按 Revision 内的原值精确匹配并解析为固定 ID。Connector 目录中的改名、默认变更或 alias 重用不改变这份映射；
它们不能扩大 Provider binding 的权限。每次调用都可以选择不同账号，允许循环和并发。

公开 `TaskContext<Actions>` 和 `Task<Inputs, Outputs, Actions>` 接受节点对应的 Action 方法表类型；默认表为空。
Workbench 对新声明提供动态 `call(actionId, input, options)` 类型与动态属性访问；旧声明继续使用目录 schema 提供精确迁移期提示。
节点面板直接提供 Action 插入和有效连接查看入口，不显示 Connector Capability 开关，也不编辑 Action/Connection 白名单。

### 调用身份、生命周期与目录投影

`RuntimeInvocation.capabilities` 固定直接程序的声明，Flow 执行从固定 Inline Task 取得声明。
每个 `RuntimeCapabilityCall` 都携带独立 `callId`，`invocationId` 继续标识 Task。Server 从可信桥接请求身份构造 call ID，
将它作为 Connector 幂等键；不同业务调用互不去重，同一传输请求保留身份。宿主日志记录 Action、Connection ID 和两种调用身份，不记录业务参数。

用户可以捕获普通 Connector 错误并返回成功，之后抛出的其他错误不会被已捕获的旧错误覆盖。能力数量或响应大小超限导致节点失败，捕获不能将其变成成功。
Run 取消、deadline、兄弟节点失败和节点退出沿既有执行生命周期终止能力；未等待的请求也会清理。取消请求不承诺撤销已发生的外部副作用。

`ConnectorProvider` 可选 `noSetup` 表示 Provider 仅支持 `no_auth`，不包含 Connection 状态。`ConnectorConnection` 可选 `builtInAccount` 表示上游账号包含 `marketplace` 元数据；`connectionId` 的 `no_auth:` 前缀标识免配置虚拟账号。节点面板按有效普通账号、有效内置账号、免配置、未配置排序，组合独立获取的 Provider 和 Connection 数据。

`ConnectorConnection` 额外投影可选 `alias`，缺省时仍可按 ID 绑定；`ConnectorAction` 额外投影可选 `inputSchema` / `outputSchema` 原始 JSON Schema。
旧的 `inputs` / `outputs` 仍是图端口 projection。schema 的暂时缺失不移除声明，也不扩大运行权限。

### 当前 Server 的上游身份限制

当前 Connector adapter 先按稳定 ID 查询账号，再用 `x-oo-connector-alias` 执行。上游需要 transport alias；账号缺少它时明确失败。
查询和 POST 之间 alias 被重新分配的竞态尚未消除，本次实现不声称具备端到端的稳定 ID 原子执行保证。
要完成该项验收，上游必须支持按 Connection ID 原子解析并执行，或在同一次执行请求中校验 ID 与 alias / 版本条件；重复查询 alias 不能代替该保证。

### Draft 操作结构发现

公开 `flow-change` 的 `changeOperationsSchema()` 返回 ChangeOperation 数组的 JSON Schema，传入 operation kind 时返回单个操作的独立 schema。
`decodeChangeOperations()` 与该 schema 使用相同的字段定义，忽略并移除未知字段，拒绝未知 kind、已知字段类型错误和不完整结构；Server 在 Draft change HTTP 边界调用它。
结构校验不替代操作顺序、before 值、图语义或 Revision 并发校验。

公共解码入口、版本兼容和部署一致性验证见[公共契约与版本演进](compatibility.md)。

## 11. Agent Task

Agent 使用 Managed Task：`executor.kind: "agent"`，只能由根 Flow 的 Task node 引用。Subflow 引用产生
`agent.subflow-unsupported`；其他确定性配置错误产生 `agent.config-invalid`。

```json
{
  "name": "Reply to customer",
  "inputs": [{ "handle": "email", "nullable": false, "jsonSchema": { "type": "string" } }],
  "outputs": [{ "handle": "output", "nullable": false, "jsonSchema": { "type": "string" } }],
  "executor": {
    "kind": "agent",
    "model": "deepseek-v4-flash",
    "system": "Help the customer. Report rejected calls accurately.",
    "prompt": { "kind": "value", "value": "Write a reply to this customer." },
    "maxRounds": 10,
    "tools": [
      {
        "id": "send",
        "name": "send_mail",
        "description": "Send a reply to the customer.",
        "action": "mail.send",
        "connectionId": "work",
        "approval": true,
        "inputs": [
          { "handle": "to", "nullable": false, "jsonSchema": { "type": "string" }, "source": { "kind": "input", "input": "email" } },
          { "handle": "body", "nullable": false, "jsonSchema": { "type": "string" }, "source": { "kind": "model" } }
        ]
      }
    ]
  }
}
```

`model` 为部署模型网关的模型 ID；无 fallback。`maxRounds` 是 1–100 的整数，Connector 工具数最多 64；至少声明一个工具或启用 `code: true`。
工具 `id` 非空且在 Task 内唯一；`name` 在 Task 内唯一并匹配 `[A-Za-z][A-Za-z0-9_-]{0,63}`。
`read_result` 与 `run_code` 为保留名称。可选 `executor.code` 默认为 false，随 Revision 固定。
Action 与 Connection 固定在 Revision；无需认证的 Action 可以省略 `connectionId`。工具输入不能再声明端口 `value`，
只能通过 `source` 声明 `{ kind: "value", value }`、`{ kind: "input", input }` 或 `{ kind: "model" }`。
`prompt` 只接受前两种来源，解析结果必须是字符串。

工具输入与最终输出接受布尔 schema，以及下列 JSON Schema 写法：

- 基础类型与取值：单个或数组形式的 `type`、`enum`、`const`。
- 组合与条件：`allOf`、`anyOf`、`oneOf`、`not`、`if/then/else`。
- 字符串与数值：`minLength/maxLength`、`pattern`、已知的 `format`、`minimum/maximum`、
  `exclusiveMinimum/exclusiveMaximum`、`multipleOf`。
- 对象：`properties`、`required`、schema 形式的 `additionalProperties`、`patternProperties`、
  `propertyNames`、`minProperties/maxProperties`、`dependentRequired`、`dependentSchemas`、
  `dependencies`、`unevaluatedProperties`。
- 数组：schema 或元组形式的 `items`、`prefixItems`、`additionalItems`、`minItems/maxItems`、
  `uniqueItems`、`contains`、`minContains/maxContains`、`unevaluatedItems`。
- 引用：`$defs`、`definitions` 与当前参数 schema 内的 JSON Pointer `$ref`。支持声明 Draft 7、2019-09、
  2020-12；未声明时按 2019-09 校验。Draft 7 的 `$ref` 忽略同级约束，较新版本保留同级约束。

原始定义还接受 `description`、`title`、`default`、`examples`、`readOnly`、`writeOnly`、`deprecated`、
`$comment`，并完整保留在 Revision 中。生成模型工具 schema 时保留 `description`、移除其他说明性元数据，
展开本地引用并移除定义表和 dialect 声明；不会把 `default` 注入模型参数或覆盖固定值。
展开限制为 4096 个 schema 节点、64 层深度。模型参数的递归引用、外部引用和 anchor 引用明确拒绝；
固定参数及最终输出允许可解析的本地递归引用。未知关键词、未知 `format`、非法正则和不可解析的引用均报告配置错误，
工具输入诊断包含具体原因及可用的嵌套路径。模型 provider 仍须接受生成的工具 schema，宿主不会删除验证约束来迎合 provider。

只将模型生成字段暴露给 provider，全部字段必填；nullable 字段允许显式 null。
合并参数后按原始 schema 校验，包括组合、格式和引用约束；未知字段或覆盖固定字段在实际调用前拒绝。
校验不修改 Revision 中的 schema 或实际参数。

最终输出恰为一个非 nullable 的 `output`。`type: "string"` 使用最终文本；其他 schema 要求最终文本可解码为 JSON，
并验证整体输出后才提交节点完成。Agent 工具结果独立保存，模型只取得有界预览；框架与 Scheduler 的完整 checkpoint 上限为 16 MiB。

可选 `executor.notification` 为 `{ taskId, messageHandle, inputs }`。`taskId` 引用 Connector Task；通知输入的 source
只能是固定值或此次节点输入，消息字段由宿主填写。通知 Task 属于 closure，独立进行 Action、Connection 和公共通知 origin 检查。
待审批的完整调用以 JSON 展示在 `RunDetails.waits[].prompt`，包含 `callId`、`toolId`、Action、可选 Connection 和完整 `input`。
通知消息追加原等待的到期时间和决议链接。

修改 Agent 使用 change operation `{ kind: "task.agent.set", taskId, before, value }`。
`before` 与 `value` 是完整 Managed Task；前者必须与当前定义相等，后者必须仍为 Agent。
语义无效配置可保存在 Draft，但 Run 与 Publish 必须通过 validation。

### 执行与恢复

Task callback 的 Agent 返回值为 `{ kind: "completed", output }` 或
`{ kind: "suspended", checkpoint: { version: 1, callId, toolId, input, rounds, state } }`。
`state` 是部署私有 JSON continuation，不能出现在 Revision 或公开事件中。恢复 Task invocation 携带
`agent: { action: "approve" | "reject", checkpoint }`，保持原 `invocationId`、`jobId` 和 `runId`。

Server 的首个 adapter 固定使用 Mastra 1.64.0，私有 continuation 带 `framework: "mastra/1.64.0"` 、结果引用 `{ resultId, digest }[]` 与全部 workflow snapshots。
快照直接包含在 Run store 的同一等待事务中，不依赖另一个持久化框架数据库。工具调用身份由 invocation、模型轮数和
provider tool-call ID 共同组成；相同参数不会合并。

工具按当前模型批次中的次序串行执行，全部结果或拒绝事实齐全后才请求下一轮模型。节点 `timeoutMs` 累计所有 active segment，
在 checkpoint 的节点记录中保存剩余预算；审批等待、队列等待与其他节点执行不消耗该节点预算。Run 总预算独立累计。
超过模型轮数、超时、取消或资源限制不会作为可恢复工具错误交回模型。

Connector 明确返回 `success: false` 和 `errorCode: "invalid_input"` 时记录为 `connector.input-invalid`，按参数拒绝处理并可交回模型。
该分类不依赖 `data` 的形状：Schema 校验错误数组中的诊断会保留，Provider 错误对象、空值或缺失详情使用通用参数错误提示。
仅有 HTTP 400 而没有上述错误标识时，不视为可恢复参数错误。
请求发出后无法确认执行结果时记录 `connector.indeterminate`，Run 以 `indeterminate` 和 `execution.terminal-unknown` 结束。
节点错误保留请求超时、传输失败、响应格式或大小异常、上游失败等原因，以及已收到的 HTTP 状态；不透传上游原始响应正文。
Agent 工具失败事件包含 `code` 和 `message`；`executed` 为 `true` 表示已确认返回成功结果，为 `false` 表示已确认拒绝执行，
为 `null` 表示无法确认执行结果。
已确认返回的工具结果在 JSON 校验、大小检查或记录阶段失败时终止 Agent，不能继续同批其他工具或再次请求模型。

过程记录复用 `node.log`，`message` 为 JSON：模型记录 `{ kind: "model", round }`；工具记录包含
`kind: "tool"`、`callId`、`toolId`、`status`（`started/completed/failed/approval/approved/rejected`），
并按状态包含完整 input、output 或错误 code。失败记录的 `executed` 表示实际调用是否已成功返回。
这些记录仅供观察，不能用于恢复或重放。

### Agent 保存的工具结果

Agent 保留的每份结果属于一个 Run 和一个 invocation。`resultId` 是 opaque identity，不是访问 capability。
所有下列路由复用 Run 的认证和资源读取边界，结果与 Run 不匹配时返回 not-found。结果不随日志过期，随所属 Flow 物理删除清理。

- `GET /v1/runs/:runId/results?after=<resultId>` 返回 `{ version: 1, runId, results, nextAfter? }`。
  每页最多 50 项，按 resultId 升序；运行中新增结果后可从第一页刷新列表。
- `GET /v1/runs/:runId/results/:resultId?pointer=&offset=0&limit=20&maxBytes=15000` 返回 `{ version: 1, runId, result, page }`。
  `pointer` 是最长 4096 字符的 JSON Pointer，默认根；`offset` 是非负整数；`limit` 是 1–100 的整数，用于对象或数组成员分页。
  `maxBytes` 是 1–1,048,576 的整数，默认 15,000，限制 UTF-8 编码后的完整 `page` JSON，外层 result 元数据另计。
  字符串按 Unicode code point 偏移分页，片段随页面预算变化，不再另设 8192 bytes 上限；预算无法容纳元数据与一个字符或成员时拒绝。
  模型 `read_result` 只允许申请最多 65,536 bytes，默认仍为 15,000。
  无效 pointer、越界 offset 或非法参数返回 `run.invalid`。
- `GET /v1/runs/:runId/results/:resultId/content` 返回完整 JSON，使用 `application/json`、附件下载和 `no-store` 响应头。

结果描述为 `{ resultId, callId, toolId, source, bytes, digest, createdAt }`。
`source` 为 `{ kind: "connector", action }` 或 `{ kind: "code" }`，不通过工具名称推断来源。`bytes` 为保存的 JSON UTF-8 字节数，
`digest` 为保存正文的 SHA-256 十六进制摘要，`createdAt` 为 ISO 时间戳。

页面为 `{ pointer, type, complete, value?, length?, offset, nextOffset?, entries? }`。
`type` 为 JSON 类型；小值以完整 `value` 返回。较大对象或数组返回 `entries`，每项包含
`{ pointer, type, complete, value?, length? }`；未提供 value 的成员可通过它的 pointer 继续读取。
字符串的 offset/nextOffset 按 Unicode code point 计数，value 为当前连续片段，单页文本按编码后大小限制。
`complete: false` 表示不能把当前 value 或 entries 当作原始完整 JSON；nextOffset 存在时可以继续翻页。

模型业务工具输出统一为 `{ kind: "stored-result", result, page }`。宿主预留工具名 `read_result`，输入为
`{ resultId, pointer?, offset?, limit?, maxBytes? }`，输出相同 envelope；只允许访问当前 invocation 已取得的结果。
读取不执行外部 Action，不要求业务审批，仍消耗正常模型轮数和运行预算。
模型历史预览被压缩时返回 `{ kind: "stored-result", result, previewOmitted: true }`，结果仍可读取。

Server 动作响应保护上限为 32 MiB，单 Run 工具结果正文配额为 128 MiB；目录与 Proxy 限制独立。
读取页默认最多 15,000 bytes，显式 `maxBytes` 可调整；预算内的值完整返回，不设单项 2 KiB 限制。对象和数组按页预算返回完整成员，
放不下的成员留到下一页；单个成员超过页预算时只提供元信息，可通过其 pointer 继续读取。
页面的 `complete: false` 不影响其中 `complete: true` 成员的完整性，无需逐项重读这些成员。
模型历史和框架快照中保留的预览使用 128 KiB 总量预算，
优先保留较新的预览，保留旧调用配对和结果引用。该字节预算不等于模型 tokenizer 或精确上下文窗口。
成功结果必须先持久化再交给模型；存储或完整性失败不能作为可修正工具错误重试外部调用。

### Agent 代码计算

`executor.code: true` 注册内置工具 `run_code`，输入为 `{ code, inputs }`。
`code` 是 default export 函数的 JavaScript ES module；函数只接收解析后的输入对象，返回 JSON 或 Promise<JSON>。
`inputs` 的每个值为严格来源声明之一：`{ kind: "value", value }`、`{ kind: "input", input }` 或 `{ kind: "result", resultId }`。
input 必须是当前 invocation 已有的节点输入；resultId 必须位于当前 invocation 的引用集合，且存储归属与 digest 校验通过。
宿主读取完整数据后注入执行器，不经过模型消息。输出先持久化，再以 stored-result envelope 返回，并可作为后续计算的输入。

每次执行使用独立 isolate，无节点 context、Connector 或网络权限，不允许第三方或其他 Flow 模块导入。
输入总量与结果上限分别为 32 MiB，源码为 64 KiB，内存为 256 MiB，V8 执行调用 timeout 为 1 秒、单次墙钟为 5 秒，
同时服从节点和 Run 的剩余预算。无效 JSON 输出（含 undefined、BigInt、非有限数、循环引用及非普通对象）返回明确错误。
语法和普通执行错误可交回模型，修正提交计为新调用；取消、资源限制、执行器崩溃、结果丢失、完整性或存储失败终止 Agent。

代码调用沿用 tool 日志结构，并包含 `source: { kind: "code" }`；输入保留源码和来源声明，输出保留结果引用。
调用身份、成功结果复用与恢复沿用普通 Agent 工具语义。代码工具无需逐次审批，也不依赖部署 Connector；
Agent 声明的业务工具和审批通知仍独立执行能力检查。

### Trigger 动态配置选项

`GET /v1/flows/:flowId/triggers/:triggerNodeId/options/:field` 返回
`{ version: 1, options: [{ value: string, label: string, color?: string }] }`。
`value` 是保存到配置中的稳定 ID，`label` 是当前显示名称，`color` 若存在则为六位十六进制颜色。
一次成功响应包含完整选项，最多 1000 项；上游失败或超出限制必须报错，不能把截断列表伪装成完整结果。

服务端从当前 Draft 解析 Trigger、Connection binding 和 Provider 配置，按 Flow 固定的 Connector Team scope 查询。
接口只允许 Provider 声明的配置字段，不接收任意外部 URL、GraphQL 或凭据，不创建 Run、订阅或生产 binding。
目前 Linear 提供 `teamId` 和依赖已保存 Team 的 `stateIds` 两组选择。

Workbench 切换连接时原子清除 Linear 的 `teamId` 与 `stateIds`；切换 Team 时原子清除 `stateIds`。
失效的已选项必须保留并明确提示，不能自动替换或清空而扩大筛选范围。

Flow 服务列表与账号授权分别保存。`ConnectorAccess.providerIds` 保存显式添加的服务，允许服务尚无账号或尚未勾选授权；旧快照没有此字段时按空列表处理，已有 bindings 仍提供其所属服务。Code 配置合并显式添加服务和 Code binding 所属服务，不混入节点引用服务；总览从节点配置与 Code binding 派生使用关系。新增服务不授予账号权限，也不改变仅由授权绑定计算的 `providerAccessDigest`。

`PUT /v1/flows/:flowId/connector-access/:providerId/service` 添加服务；`DELETE` 同一路径原子移除服务及其全部授权绑定。请求为 `{ version: 1, expectedAccessRevision }`，返回更新后的 `ConnectorAccess`，沿用访问版本冲突和 `access.changed` 通知。添加前校验服务存在且需要授权；服务配置持久化到 Flow，刷新或重新打开后保留。

开源 Server 的 OOMOL selectable 模式在列举及保存候选时实时验证 `/v1/me/teams` 的成员身份。正常且未删除的团队中，`creator` 和 `admin` 可为有效账号创建 `admin-delegation`，无需 app-access policy；`member` 继续按 UID 对应的 policy 权限生成候选。成员身份缺失、失效或无法验证时拒绝授权。保存后的管理员委托使用固定身份校验当前账号有效性，不重新查询成员角色或 app-access；上游 Connector 仍按部署配置的用户 token 执行最终授权，Server 不伪造 Team token 或绕过上游限制。

### CLI/MCP Team 选择

`POST /v1/flows` 的创建请求接受 `{ name, teamId?: string, version: 1 }`；teamId 必须是非空字符串，并由部署验证可访问性。省略时保留部署的默认 Team 选择规则。相同 Idempotency-Key 对不同 Team 的创建请求返回冲突。

Server 提供认证后的 `GET /v1/connector/teams`，返回 `{ enabled: boolean, teams: { id: string, name: string, systemCreated: boolean }[], version: 1 }`。不支持 Team 的部署返回 enabled=false 和空 teams。此目录不返回 Flow-Team 绑定列表。公共 ControlClient 通过 listConnectorTeams 读取，并通过 createFlow 的可选第三参数传入 teamId。
