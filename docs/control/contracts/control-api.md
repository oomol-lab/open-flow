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
`nodeKind` 为 `condition / connector / javascript / llm / subflow / value / wait`。
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

## 6. 实时通知

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

## 7. Routes

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

## 8. 公开 Wait action hook

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

`POST` 服从与认证 resolve route 相同的 first-writer-wins 和幂等重放语义。capability、action、固定 Revision 或 active Wait 不匹配时返回
`404 wait-action.not-found`；其他方法返回 `405 wait-action.method-not-allowed` 并携带 `Allow: GET, HEAD, POST`。服务端只持久化
capability 摘要；完整 capability 是 bearer credential，消费端不得把它作为普通可公开 URL 记录或转发。

请求被限流时返回 `429 wait-action.rate-limited`，携带表示剩余等待秒数的 `Retry-After`；被限流的 `POST` 不提交决议。
`HEAD` 的限流响应同样没有 response body。

### Scheduler checkpoint 与节点事件

Scheduler checkpoint 的精确对象为：

```json
{
  "bindingValues": {},
  "inputs": {},
  "results": { "source": { "jobId": "job-1", "outputs": { "value": 42 } } },
  "skipped": [],
  "version": 1,
  "wait": { "jobId": "job-2", "nodeId": "approval", "value": 42, "waitId": "opaque-id" }
}
```

`inputs` 保存按 node ID 和 input handle 索引的启动输入，`bindingValues` 保存本次 Run 的 Variable binding 快照。
`results` 保存已完成节点的最终 output，`skipped` 保存已跳过节点。checkpoint 不包含队列、活跃 invocation 或重复消费位置，总 JSON 大小不得超过 16 MiB。
恢复必须验证精确字段、节点状态不冲突、结果符合声明、依赖完整且符合分支选择；当前 Wait 不能已经完成或跳过。

未进入执行路径的节点不创建 job 或 execution identity，也不产生节点事件；分支跳过状态只用于内部调度和 checkpoint 恢复。
`node.completed` 仅在节点完整 output 校验成功后产生，payload 的 `outputs` 是按 handle 索引的完整最终结果对象，无输出时为 `{}`。
每次节点 invocation 只产生一条完成事件，且先于下游节点的 `node.started`；不再产生逐 handle 的 `node.output`，也不支持运行中的中间 output。

Flow terminal result 使用 `{ kind: 'node-results', nodes }`，`nodes` 只保存已执行完成的图末端节点，按 node ID 排序。
每项为 `{ nodeId, status: 'completed', jobId, outputs }`，不包含未执行节点或重复执行的 jobs 数组；没有已执行完成的末端节点时为 `[]`。

## 9. Code Action 合同

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
`decodeChangeOperations()` 与该 schema 使用相同的字段定义，拒绝未知 kind、未知字段和不完整结构；Server 在 Draft change HTTP 边界调用它。
结构校验不替代操作顺序、before 值、图语义或 Revision 并发校验。

公共解码入口、版本兼容和部署一致性验证见[公共契约与版本演进](compatibility.md)。
