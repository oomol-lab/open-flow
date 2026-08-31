# Control API 技术参考

本文记录 Open Flow Control API 跨部署成立的 HTTP 合同。数据库、认证 provider、事务实现、调度器和部署资源不属于本文。
公共 black-box cases 由 `@oomol-lab/open-flow/control-api-conformance` 导出。

## 1. Transport

- 路径以 `/v1` 开头；resource identity 放入 path segment 时使用 UTF-8 percent encoding。
- 带 JSON body 的请求使用 `Content-Type: application/json`。
- JSON response 顶层或资源对象包含 `version: 1`。
- 创建 Flow、Publication 和 Run 的请求要求非空、受限长度的 `Idempotency-Key`。
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
`@oomol-lab/open-flow/control-api` 的 `controlErrorCode` 导出。

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

type DraftSync =
  | { kind: 'changes'; revisions: readonly { operations: readonly ChangeOperation[]; revision: RevisionMetadata }[]; version: 1 }
  | { draft: Draft; kind: 'snapshot'; version: 1 }
```

`RevisionContent`、顶层 `FlowDocument` 和 `ChangeOperation` 由 `@oomol-lab/open-flow/flow-change` 定义。顶层 graph target 固定为
`{ kind: 'flow' }`；Subflow target 为 `{ kind: 'subflow', id }`。不存在嵌套 Flow map 或 Flow create/delete operation。

Revision 是完整 immutable snapshot。Draft change 使用 `expectedRevisionId` 做 CAS；stale head 返回 `flow.revision-conflict`。未提供
`fromRevisionId` 时 Draft sync 返回 snapshot；部署无法提供连续 operation history 时也可以返回 snapshot。

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

Check body 是 `{ engineContract: 'open-flow-engine/v1', version: 1 }`，始终验证 path 中固定的 Flow Revision。
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

Draft Run body 是 `{ engineContract, inputs, version: 1 }`。Live Run body 是 `{ publicationId, inputs, version: 1 }`。首次接受返回 `202`，
幂等重放返回 `200`。Run 接受后不受后续 Draft change、Publish 或 Rollback 影响。

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

Run list 按 `createdAt`、`runId` 逆序稳定分页。

`after` 是已观察的最后 sequence，只返回更大的事件。terminal Run 最多有一个 terminal event。非 terminal Run 的 result 返回
`run.not-terminal`；取消成功与重复取消分别返回 `cancelAccepted: true` 和 `false`。

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
subscribeFlowCatalog(listener: (event?: FlowCatalogEvent) => void): () => void
subscribeFlow(flowId: string, listener: (event?: FlowChangeEvent) => void): () => void

interface FlowCatalogEvent {
  kind: 'flows.changed'
  version: 1
}

type FlowChangeEvent =
  | { flowId: string; kind: 'draft.changed'; revisionId: string; version: 1 }
  | { flowId: string; kind: 'run.created'; runId: string; version: 1 }
```

`undefined` 表示连接或重连已经建立，客户端必须 refetch。事件只做 invalidation。Server 同源宿主使用两个独立 SSE 请求：

- `GET /v1/flows/notifications`
- `GET /v1/flows/:flowId/notifications`

两者返回 `text/event-stream`，要求 operator 认证，并在 session 失效或 Server shutdown 时结束。其他部署可以使用不同实时 transport，但必须维持
相同的两个独立逻辑通道和事件合同。

## 7. Routes

| Method    | Path                                                     | 成功状态 | 说明                                             |
| --------- | -------------------------------------------------------- | -------: | ------------------------------------------------ |
| `GET`     | `/v1/flows`                                              |      200 | `cursor`、`limit`、`includeTotal`                |
| `POST`    | `/v1/flows`                                              |  201/200 | `{ name, version: 1 }`                           |
| `GET`     | `/v1/flows/:flowId`                                      |      200 | Flow 与 Draft head                               |
| `PATCH`   | `/v1/flows/:flowId`                                      |      200 | `{ name, version: 1 }`                           |
| `DELETE`  | `/v1/flows/:flowId`                                      |      202 | 进入 `retiring`                                  |
| `GET`     | `/v1/flows/:flowId/draft`                                |      200 | 当前 Draft snapshot                              |
| `GET`     | `/v1/flows/:flowId/draft/sync`                           |      200 | 可选 `fromRevisionId`                            |
| `POST`    | `/v1/flows/:flowId/draft/changes`                        |      200 | `{ expectedRevisionId, operations, version: 1 }` |
| `GET`     | `/v1/flows/:flowId/revisions/:revisionId`                |      200 | immutable Revision                               |
| `GET/PUT` | `/v1/flows/:flowId/presentation`                         |      200 | Presentation CAS                                 |
| `POST`    | `/v1/flows/:flowId/revisions/:revisionId/check`          |      200 | 固定 Revision validation                         |
| `GET`     | `/v1/flows/:flowId/live`                                 |      200 | Live projection                                  |
| `GET`     | `/v1/flows/:flowId/publications`                         |      200 | Publication page                                 |
| `POST`    | `/v1/flows/:flowId/revisions/:revisionId/publications`   |      202 | Publish operation                                |
| `GET`     | `/v1/flows/:flowId/publish-operations/:operationId`      |      200 | Publish operation                                |
| `POST`    | `/v1/flows/:flowId/publications/:publicationId/rollback` |  201/200 | Rollback                                         |
| `POST`    | `/v1/flows/:flowId/revisions/:revisionId/runs`           |  202/200 | Draft Run                                        |
| `POST`    | `/v1/runs`                                               |  202/200 | Live Run                                         |
| `GET`     | `/v1/flows/:flowId/runs`                                 |      200 | `cursor`、`limit`、`status`                      |
| `GET`     | `/v1/runs/:runId`                                        |      200 | Run detail                                       |
| `GET`     | `/v1/runs/:runId/events`                                 |      200 | `after`、`limit`                                 |
| `GET`     | `/v1/runs/:runId/result`                                 |      200 | terminal result                                  |
| `POST`    | `/v1/runs/:runId/cancel`                                 |      200 | `{ version: 1 }`                                 |
| `GET`     | `/v1/trigger-keys`                                       |      200 | Trigger summaries                                |
| `GET`     | `/v1/trigger-keys/catalog`                               |      200 | definitions                                      |
| `GET`     | `/v1/trigger-keys/:key`                                  |      200 | definition detail                                |
| `GET`     | `/v1/flows/:flowId/triggers`                             |      200 | Trigger bindings                                 |
| `GET`     | `/v1/flows/:flowId/triggers/:triggerNodeId`              |      200 | binding detail                                   |
| `GET`     | `/v1/flows/:flowId/triggers/:triggerNodeId/activities`   |      200 | Activity page                                    |
| `POST`    | `/v1/flows/:flowId/triggers/:triggerNodeId/pause`        |      200 | pause                                            |
| `POST`    | `/v1/flows/:flowId/triggers/:triggerNodeId/resume`       |      200 | resume                                           |
| `POST`    | `/v1/flows/:flowId/triggers/:triggerNodeId/test`         |      200 | Poll test                                        |
| `GET`     | `/v1/connector/providers`                                |      200 | Provider catalog；可选 `flowId`                  |
| `GET`     | `/v1/connector/actions`                                  |      200 | `service` 或 `q`；可选 `flowId`                  |
| `GET`     | `/v1/connector/actions/:actionId`                        |      200 | Action detail；可选 `flowId`                     |
| `GET`     | `/v1/connector/connections/:serviceId`                   |      200 | Connections；可选 `flowId`                       |
| `POST`    | `/v1/connector/connections/:serviceId/page`              |      200 | 外部授权页 URL；可选 `flowId`                    |

Connector route 的 `flowId` 是 opaque Flow identity。提供时部署必须先确认 Flow 存在，并在该 Flow 的 Connector scope 内解析 Provider、Action 与
Connection；客户端不能改用 Team ID、Connection owner 或其他外部 identity 代替 Flow scope。省略时使用部署的未限定 Connector catalog。

分页 cursor 是 opaque、scope-bound token。跨 Flow、Trigger 或资源类型使用 cursor 返回 `page.invalid-cursor`。
