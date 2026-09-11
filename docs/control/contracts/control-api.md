# Control API 技术参考

本文记录 Open Flow Control API 跨部署成立的 HTTP 合同。数据库、认证 provider、事务实现、调度器和部署资源不属于本文。
公共 black-box cases 由 `@oomol-lab/open-flow/control-api-conformance` 导出。

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
`trigger.*`、`trigger-key.*`、`connector.*`、`variable.*`、`binding.*`、`engine.*`、`page.*` 和 `route.*`；精确 code 集合由
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
各资源的独立读取与修改接口继续有效。

### 执行图与输入来源

Revision 的根图和每个 Subflow graph 必须包含 `nodes` 和 `edges`；没有执行边时显式保存 `edges: []`。
为兼容旧 Draft，解码时将缺失的 `edges` 补为 `[]`；显式提供的 `edges` 仍须通过数组及边结构校验。
Value Node 没有数据输入端口。解码时将其 `inputs` 统一归一化为 `{}`，忽略缺失或任意旧输入数据；执行入边保持不变，仍决定节点何时执行。根图和 Subflow graph 均适用。
执行边使用 `{ source: nodeId, target: nodeId, sourceHandle?: branch }`。普通节点不得设置 `sourceHandle`；Condition 和 Wait 必须指定已声明的分支或 action。
边不含目标 input handle。重复边、缺失端点、指向 Trigger 的边和环不能通过 validation。边集合按规范顺序参与 Revision digest。

`inputs[handle]` 使用 `{ kind: 'value', value }` 或 `{ kind: 'sources', sources }`。Node source 使用
`{ kind: 'node', nodeId, output }`；Flow input 与 Variable binding 的 source 形式保持不变。Node source 必须指向经执行边可达的祖先，
并在目标的每一条可执行路径上保证可用。多个 source 必须互斥且完整覆盖目标路径，每次执行恰好选择一个；并行前驱的两个结果不能合并到同一个 input。
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

Check body 是 `{ engineContract: 'open-flow-engine/v2', version: 1 }`，始终验证 path 中固定的 Flow Revision。
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

Run detail 增加固定的 `closureDigest`、`engineContract`、`engineDigest`、`modelVersion` 和 `revisionDigest`。Live Run 增加
`publicationId`；Trigger Run 增加 `publicationId`、`occurrenceId` 和 `triggerNodeId`。

`RunStatus` 包含 `queued | starting | running | waiting | canceled | completed | failed | indeterminate`。处于 `waiting` 的 Run detail
还包含当前暂停点：

```ts
waiting: {
  actions: readonly['continue'] | readonly[('approve', 'reject')]
  expiresAt: string
  nodeId: string
  prompt: string
  waitId: string
  waitingSince: string
}
```

这是当前 active Wait 的投影，不是历史列表。客户端用 `nodeId` 定位 Flow 中的 Wait node，用 `waitId` 提交一次固定暂停的决议。
Run 离开 `waiting` 后不再返回该投影；历史由 RunEvent 表达。

Draft Run body 是 `{ engineContract, inputs, trigger, version: 1 }`。Live Run body 是 `{ publicationId, inputs, trigger, version: 1 }`。首次接受返回 `202`，
幂等重放返回 `200`。Run 接受后不受后续 Draft change、Publish 或 Rollback 影响。

`trigger` 必填，形如 `{ nodeId: string, payload: JsonValue }`，固定本次运行的起始 Trigger 和输入。缺少入口、入口不是固定 Revision 中的 Trigger，或 payload 不符合其 schema 时返回 `run.invalid`。入口及 payload 参与幂等 request digest，并随 Run 持久化；不会自动选择入口或退回整图运行。

Draft Run 只对选中 Trigger 沿执行边可达的节点及其依赖进行语义校验、能力检查和 Variable 准入检查。其他分支的未配置 Trigger、无效代码和缺失资源仍出现在全图 check 中，但不阻断此次测试。
共享下游输入的多来源映射忽略本次不可达的已有节点来源；剩余来源仍须在每条执行路径上恰好提供一个值。缺失节点引用、选中分支内的环、无效代码及实际使用的 Subflow 错误仍返回 `flow.invalid`。
Draft Run 的 `revisionDigest` 标识完整 Revision，`closureDigest` 标识本次入口的执行 closure，可以与全图 check 的 `closureDigest` 不同。读取和恢复 Run 不修改原 Revision。
Publish 和 Live Run 保持完整 Flow 校验。

Manual Trigger 的节点结构为 `{ kind: "manual", name: string, description?: string, icon?: string }`，无输入和调度配置，`payload` 固定为空对象 `{}`。其执行出口沿普通执行边连接下游，数据输出 `payload` 的 schema 为 `{ type: "object", additionalProperties: false }`。其他 Trigger 可通过显式 payload 模拟执行，仍保留 Draft/Live Run source，不伪造外部 occurrence。

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

Run list 按 `createdAt`、`runId` 逆序稳定分页，`status=waiting` 可以只查询当前暂停的 Run。

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

Wait 进入和离开暂停状态分别追加事件：

- `run.waiting` payload 为 `{ expiresAt, nodeId, waitId, waitingSince }`；
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

同一 `waitId` 只有第一个合法、未过期的决议能把 Run 从 `waiting` 推进到 `queued`。同一 action 重放返回
`resolutionAccepted: true`，竞争的另一 action 返回 `false`，两者都返回已经提交的 `action` 和 `resolvedAt`。不存在的 Wait 返回
`run.wait-not-found`，不属于该 Wait 的 action 返回 `run.invalid`。Wait 到期后 Run 以 `run.wait-expired` 失败，不产生新的 Run。

### Run lifecycle conformance

`run-lifecycle` 的状态模型包含 `fail-start` 与 `fail-resume`：两者仅能在 `starting` 提交，分别产生 `failed` 与
`indeterminate`。普通 `commit` 在 `running` 接受 terminal，在任意非 terminal 状态接受取消，并在 `waiting` 接受失败。
已经提交的 terminal 不可覆盖。部署的 lifecycle conformance 必须操作真实权威 store，覆盖首次启动、Wait 恢复、启动失败、
恢复失败、幂等准入与 terminal 竞争；不能以另一套测试专用持久化实现代替部署实现。

公共 Scheduler 的 `RunLaunch` 为首次启动与 Wait 恢复的互斥联合。首次启动必须包含 `trigger`，可包含 `inputs` 和
`bindingValues`；恢复只能包含 `resume: { action, checkpoint }`，不能重新提供这三项启动数据。`RunDetails` 在
`status: 'waiting'` 时必须包含 `waiting`，其他状态不包含该字段；Run list 的摘要不包含等待详情。

## 6. Trigger 与 Connector

Trigger Key catalog 是 deployment scope 资源：

```ts
{ keys: readonly TriggerKeySummary[]; version: 1 }
{ definitions: readonly TriggerKeySnapshot[]; version: 1 }
{ definition: TriggerKeySnapshot; version: 1 }
```

成功 Publication 为 Flow graph 中每个 Trigger node 提交 Live binding：

```ts
interface TriggerBinding {
  currentPublicationId?: string
  currentRevisionId?: string
  endpointUrl?: string
  flowId: string
  health: 'failed' | 'healthy' | 'initializing' | 'needs_reauth' | 'suspended'
  kind: 'cron' | 'integration' | 'poll' | 'webhook'
  lastErrorCode?: string
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

## 7. 实时通知

公共 Workbench Host 合同包含两个独立 subscriber：

```ts
subscribeFlowCatalog(listener: (event?: FlowCatalogEvent) => void): { ready: Promise<void>; stop(): void }
subscribeFlow(flowId: string, listener: (event?: FlowChangeEvent) => void): { ready: Promise<void>; stop(): void }

interface FlowCatalogEvent {
  kind: 'flows.changed'
  version: 1
}

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
事件只做 invalidation。Server 的首次连接等待上限为 5 秒，之后继续尝试连接。Server 同源宿主使用两个独立 SSE 请求：

- `GET /v1/flows/notifications`
- `GET /v1/flows/:flowId/notifications`

两者返回 `text/event-stream`，要求 operator 认证，并在 session 失效或 Server shutdown 时结束。其他部署可以使用不同实时 transport，但必须维持
相同的两个独立逻辑通道和事件合同。

## 8. Routes

| Method    | Path                                                     | 成功状态 | 说明                                       |
| --------- | -------------------------------------------------------- | -------: | ------------------------------------------ |
| `GET`     | `/v1/flows`                                              |      200 | `cursor`、`limit`、`includeTotal`          |
| `POST`    | `/v1/flows`                                              |  201/200 | `{ name, version: 1 }`                     |
| `GET`     | `/v1/flows/:flowId`                                      |      200 | Flow 与 Draft head                         |
| `PATCH`   | `/v1/flows/:flowId`                                      |      200 | `{ name, version: 1 }`                     |
| `DELETE`  | `/v1/flows/:flowId`                                      |      202 | 进入 `retiring`                            |
| `GET`     | `/v1/flows/:flowId/editor`                               |      200 | Flow、Draft、Live 与 Presentation 聚合读取 |
| `GET`     | `/v1/flows/:flowId/draft`                                |      200 | 当前 Draft snapshot                        |
| `GET`     | `/v1/flows/:flowId/draft/sync`                           |      200 | 当前完整 snapshot                          |
| `POST`    | `/v1/flows/:flowId/draft/changes`                        |      200 | `Idempotency-Key` 与 change batch          |
| `GET`     | `/v1/flows/:flowId/revisions/:revisionId`                |      200 | immutable Revision                         |
| `GET/PUT` | `/v1/flows/:flowId/presentation`                         |      200 | Presentation CAS                           |
| `POST`    | `/v1/flows/:flowId/revisions/:revisionId/check`          |      200 | 固定 Revision validation                   |
| `GET`     | `/v1/flows/:flowId/live`                                 |      200 | Live projection                            |
| `GET`     | `/v1/flows/:flowId/publications`                         |      200 | Publication page                           |
| `POST`    | `/v1/flows/:flowId/revisions/:revisionId/publications`   |      202 | Publish operation                          |
| `GET`     | `/v1/flows/:flowId/publish-operations/:operationId`      |      200 | Publish operation                          |
| `POST`    | `/v1/flows/:flowId/publications/:publicationId/rollback` |  201/200 | Rollback                                   |
| `POST`    | `/v1/flows/:flowId/revisions/:revisionId/runs`           |  202/200 | Draft Run                                  |
| `POST`    | `/v1/runs`                                               |  202/200 | Live Run                                   |
| `GET`     | `/v1/flows/:flowId/runs`                                 |      200 | `cursor`、`limit`、`status`                |
| `GET`     | `/v1/runs/:runId`                                        |      200 | Run detail                                 |
| `GET`     | `/v1/runs/:runId/events`                                 |      200 | `after`、`limit`                           |
| `GET`     | `/v1/runs/:runId/result`                                 |      200 | terminal result                            |
| `POST`    | `/v1/runs/:runId/cancel`                                 |      200 | `{ version: 1 }`                           |
| `POST`    | `/v1/runs/:runId/waits/:waitId/resolve`                  |      200 | `{ action, version: 1 }`                   |
| `GET`     | `/v1/trigger-keys`                                       |      200 | Trigger summaries                          |
| `GET`     | `/v1/trigger-keys/catalog`                               |      200 | definitions                                |
| `GET`     | `/v1/trigger-keys/:key`                                  |      200 | definition detail                          |
| `GET`     | `/v1/flows/:flowId/triggers`                             |      200 | Trigger bindings                           |
| `GET`     | `/v1/flows/:flowId/triggers/:triggerNodeId`              |      200 | binding detail                             |
| `GET`     | `/v1/flows/:flowId/triggers/:triggerNodeId/activities`   |      200 | Activity page                              |
| `POST`    | `/v1/flows/:flowId/triggers/:triggerNodeId/pause`        |      200 | pause                                      |
| `POST`    | `/v1/flows/:flowId/triggers/:triggerNodeId/resume`       |      200 | resume                                     |
| `POST`    | `/v1/flows/:flowId/triggers/:triggerNodeId/test`         |      200 | Poll test                                  |
| `GET`     | `/v1/connector/providers`                                |      200 | Provider catalog；可选 `flowId`            |
| `GET`     | `/v1/connector/actions`                                  |      200 | `service` 或 `q`；可选 `flowId`            |
| `GET`     | `/v1/connector/actions/:actionId`                        |      200 | Action detail；可选 `flowId`               |
| `GET`     | `/v1/connector/connections/:serviceId`                   |      200 | Connections；可选 `flowId`                 |
| `POST`    | `/v1/connector/connections/:serviceId/page`              |      200 | 外部授权页 URL；可选 `flowId`              |

Connector route 的 `flowId` 是 opaque Flow identity。提供时部署必须先确认 Flow 存在，并在该 Flow 的 Connector scope 内解析 Provider、Action 与
Connection；客户端不能改用 Team ID、Connection owner 或其他外部 identity 代替 Flow scope。省略时使用部署的未限定 Connector catalog。

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

### Scheduler checkpoint 与节点事件

Scheduler checkpoint 的精确对象为：

```json
{
  "bindingValues": {},
  "inputs": {},
  "results": { "source": { "jobId": "job-1", "outputs": { "value": 42 } } },
  "skipped": [],
  "version": 2,
  "agents": {},
  "queue": [],
  "wait": { "jobId": "job-2", "nodeId": "approval", "value": 42, "waitId": "opaque-id" }
}
```

`inputs` 保存按 node ID 和 input handle 索引的启动输入，`bindingValues` 保存本次 Run 的 Variable binding 快照。
`results` 保存已完成节点的最终 output，`skipped` 保存已跳过节点。`wait` 是当前等待；`queue` 保存尚未激活的等待，字段与 `wait` 相同。`agents` 按 node ID 保存
`{ invocationId, input, remainingMs?, checkpoint }`，其中 checkpoint 是 Agent continuation 合同。配置了节点 timeoutMs 时，
remainingMs 必须为正且不得超过原上限。总 JSON 大小不得超过 16 MiB。
恢复必须验证精确字段、节点状态不冲突、结果符合声明、依赖完整且符合分支选择；当前 Wait 不能已经完成或跳过。

未进入执行路径的节点不创建 job 或 execution identity，也不产生节点事件；分支跳过状态只用于内部调度和 checkpoint 恢复。
`node.completed` 仅在节点完整 output 校验成功后产生，payload 的 `outputs` 是按 handle 索引的完整最终结果对象，无输出时为 `{}`。
每次节点 invocation 只产生一条完成事件，且先于下游节点的 `node.started`；不再产生逐 handle 的 `node.output`，也不支持运行中的中间 output。

Flow terminal result 使用 `{ kind: 'node-results', nodes }`，`nodes` 只保存已执行完成的图末端节点，按 node ID 排序。
每项为 `{ nodeId, status: 'completed', jobId, outputs }`，不包含未执行节点或重复执行的 jobs 数组；没有已执行完成的末端节点时为 `[]`。

## 10. Code Action 合同

当前脚本合同为 `open-flow-engine/v2`。它用 `context.actions` 替代 v1 的 `context.connector`，不提供旧名转发；
固定为 v1 的 Publication / Run 必须由相应 Engine 执行，当前 Server 对 v1 明确返回不支持。
升级已有 Code Task 时，将单账号 capability 改为以下允许集合，并更新源码后创建 v2 Publication。

### Revision 与编辑 operation

Inline Task 的 `capabilities` 可省略或为空数组；每个元素使用现有 `ConnectorCapability`：

```json
{
  "kind": "connector",
  "action": "github.get_current_user",
  "connections": [
    { "connectionId": "connection-work", "alias": "work" },
    { "connectionId": "connection-personal", "alias": "personal" }
  ],
  "connectionId": "connection-work"
}
```

`action` 必须是目录原始完整 ID，匹配 `^[A-Za-z0-9_-]+\.[A-Za-z0-9_.-]+$`。以第一个 `.` 分成 provider 与剩余动作名；
provider 不含 `.`，所以两种入口在根表没有键冲突。每个 Task 中 Action 不重复；每个 Action 的 Connection ID 和已保存 alias 分别唯一。
ID 和 alias 是非空、大小写敏感的字符串，不把 displayName 当 alias。所有对象拒绝未知字段。

`connections` 必需，可为空；可选的顶层 `connectionId` 是固定默认，存在时必须属于允许集合。authenticated Action 在 Draft 中可暂不绑账号，
Publish 和 Run admission 要求其至少有一个 active Connection，并检查全部允许账号的 service、状态和固定 scope。无需默认项也可以发布。
无认证 Action 允许空集合。绑定、alias 和默认值均进入 canonical Revision 与 semantic closure digest；schema 和目录缓存不进入声明。

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
  // 省略账号选项时使用声明中的固定默认。
  const user = await context.actions.github.get_current_user({})

  // 完整 ID 索引与分层方法是同一个函数，支持解构后调用。
  const getUser = context.actions['github.get_current_user']
  const [work, personal] = await Promise.all([getUser({}, { connectionId: 'connection-work' }), getUser({}, { connectionAlias: 'personal' })])
  return { user, work, personal }
}
```

非 JavaScript 标识符名称使用方括号，如 `context.actions['google-drive'].list_files({})`；剩余动作名含点时也只占第二级键。
根表和 provider 表使用空原型并冻结，仅暴露当前节点声明的方法。

省略第一个参数或传入 `undefined` 等价于传入 `{}`，必填字段仍由 Action schema 校验。业务参数必须是 JSON 对象，保留字段中的显式 `null`，不套用图端口的 null/default 归一化。循环引用、`undefined` 属性、非有限数字、函数、BigInt、
Date 等非 JSON 值在进入 transport 前失败。方法返回 Connector Action data，直接 `await` 取得；失败抛出含稳定 `code` 的 Error。

第二参数可以省略，或恰为 `{ connectionId: string }` / `{ connectionAlias: string }`，两个字段互斥。空对象、空字符串、null 和未知字段返回
`capability.invalid`；未授权 Action、ID 或 alias 返回 `capability.denied`。需选账号而未设置默认、也未显式选择时返回
`connector.connection-required`，不按目录默认或集合顺序回退。访问不存在的方法得到普通 JavaScript TypeError；伪造桥接请求仍由宿主拒绝。

alias 按 Revision 内的原值精确匹配并解析为固定 ID。Connector 目录中的改名、默认变更或 alias 重用不改变这份映射；
Workbench 的显式刷新绑定生成新 Revision 才会采纳新 alias。每次调用都可以选择不同账号，允许循环和并发。

公开 `TaskContext<Actions>` 和 `Task<Inputs, Outputs, Actions>` 接受节点对应的 Action 方法表类型；默认表为空。
Workbench 由当前声明和目录的原始 schema 生成局部精确类型，包含两种入口、允许的 ID / alias、必需的账号选项与返回值。
普通 `string` 必须先收窄为已声明 ID；不同方法参数的联合也需要相应收窄。取不到 schema 时参数为 `Record<string, unknown>`、结果为 `unknown`。

Workbench 的调用示例以只读预览展示，支持分层写法与完整 ID 写法切换，并复制当前预览。预览按当前声明生成账号选择；不直接修改源码、光标或代码保存状态。

### 调用身份、生命周期与目录投影

`RuntimeInvocation.capabilities` 固定直接程序的声明，Flow 执行从固定 Inline Task 取得声明。
每个 `RuntimeCapabilityCall` 都携带独立 `callId`，`invocationId` 继续标识 Task。Server 从可信桥接请求身份构造 call ID，
将它作为 Connector 幂等键；不同业务调用互不去重，同一传输请求保留身份。宿主日志记录 Action、Connection ID 和两种调用身份，不记录业务参数。

用户可以捕获普通 Connector 错误并返回成功，之后抛出的其他错误不会被已捕获的旧错误覆盖。能力数量或响应大小超限导致节点失败，捕获不能将其变成成功。
Run 取消、deadline、兄弟节点失败和节点退出沿既有执行生命周期终止能力；未等待的请求也会清理。取消请求不承诺撤销已发生的外部副作用。

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
待审批的完整调用以 JSON 展示在 `RunDetails.waiting.prompt`，包含 `callId`、`toolId`、Action、可选 Connection 和完整 `input`。
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
