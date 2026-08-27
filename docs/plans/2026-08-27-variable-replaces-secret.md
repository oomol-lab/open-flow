# Variable 替代遗留 Secret 计划

## 1. 目标

删除 Open Flow 从旧产品继承但尚未接通的 Secret 模型，改用 deployment scope 的 Variable。
开源版 Server 实现 `/v1/variables`，其请求方式兼容 `console.oomol.com` 当前客户端，同时遵守
Open Flow Control API 的版本化响应合同。开源 Server browser host 提供 Variable 管理；公共 Workbench
只提供 Flow input binding 能力。

Variable value 是受 Operator authentication 保护的 deployment configuration，不是 Secret Manager 中不可
导出的 credential。FlowRevision 只保存 Variable name binding；平台解析 binding 时不隐式持久化 value，
但 Flow 显式传播、输出、记录或发送 value 时，它可以进入用户可见的数据流和外部系统。

本次不保留 Secret compatibility adapter，不把 Console 仓库作为运行时依赖。未实现的旧 Runtime 引用
schema 一并删除，不重命名为 `oomol/ref`，也不保留旧 token compatibility。

## 2. 已确认现状与正式采纳范围

### 2.1 Console 客户端现状

`console.oomol.com` 当前客户端使用：

- `GET /v1/variables`，消费 `{ variables: Variable[] }`；
- `GET /v1/variables/:name`，消费单条 Variable；
- `PUT /v1/variables/:name`，发送 `{ value: string }` 并消费保存后的 Variable；
- `DELETE /v1/variables/:name`，忽略成功 response body；
- Variable 的消费字段是 `{ name: string, value: string, updatedAt: string }`。

Console 页面本地使用 200 条上限、256 字符名称上限、`^[A-Za-z_][A-Za-z0-9_]*$` 和不区分
大小写的 `OO_` 保留前缀检查。这些只能证明当前客户端和 UI 的行为，不能证明 Console 后端的精确
status、error、排序、大小限制或缺失资源语义。

本计划把上述请求路径、请求字段和 UI 限制正式采纳为 Open Flow 合同，并在第 4 节独立固定完整 HTTP
行为。Open Flow response 可以增加 `version: 1`；Console 当前客户端会忽略额外字段。

### 2.2 Open Flow 的遗留 Secret

当前仓库有四组未闭环行为：

- `packages/open-flow/src/secret` 定义 Secret 数据、模板、引用和 Browser store，但没有公共 package
  subpath，也没有当前 Control API 和 Server 存储实现；
- Flow binding 允许 `kind: 'secret'`，但 Scheduler 不会向 binding source 投递值；
- Designer 暴露 `oomol/secret` schema 和旧 Secret literal selector；
- Executor realm 暴露 `capability.secret()`，而 Server Host 拒绝所有非 Connector capability。

这些行为尚未形成可用的公开产品合同。本次直接删除，不加 decoder、不做迁移、不保留 re-export 或转发层。

### 2.3 不保留 Runtime Ref

当前产品没有必须在普通脚本节点之间传递 live object identity 的用例，也没有实现 session-local object store
和引用解析。本次直接删除未发布的 Runtime Ref schema、Designer 连接规则、typing 和展示行为，不把它改名为
`oomol/ref`，也不预留另一种通用 pointer/reference token。

普通跨节点数据继续使用 `JsonValue`；文件和大对象使用 Artifact/File handle；宿主能力通过脚本 `context` 或
Connector 提供。引擎内部可以保存可序列化 Run value，但不向脚本暴露通用 `context.store`、动态 Variable 读取
或任意节点输出查询。

## 3. 产品、安全与所有权边界

### 3.1 资源所有权

Variable 是 deployment scope 资源，不属于任何 Flow。Flow 删除、retire 或数据库中的 Flow 数据重建都不能
删除 Variable。开源 Server 在自己的 SQLite 中持久化 Variable；其他部署用自己的存储实现同一 Control API。

FlowRevision 只保存显式 declaration：

```ts
{ kind: 'variable', target: 'OPENAI_API_KEY' }
```

`target` 是大小写敏感的 Variable name。Flow closure digest 包含实际使用的 binding declaration 和 name，
不包含 value。不新增 `${{OO_VAR:...}}` 字符串协议，也不把 value 写入 ChangeOperation 或 Draft UI state。

### 3.2 信任模型

`/v1/variables` 是 deployment configuration store，不是 Secret Manager：

- 同一 deployment scope 内具有 Control API Operator 权限的 client 可以枚举和读取全部 value；
- value 出现在 Variable API response、Workbench 管理页、浏览器内存、网络面板和开发者工具中；
- value 明文存在 SQLite 主文件、WAL、SHM 和备份中；
- 不提供 encryption at rest、per-variable ACL、独立审计、自动轮换、遮罩读取、KMS 或密钥托管；
- 把 API key 等敏感配置放入 Variable，是部署者在该信任模型下作出的选择。

Variable 管理页允许显示和编辑 value；Flow input selector 只接收 name projection，不接收或展示 value。
Server request logging 不记录 Variable PUT body。Variable API、binding eligibility、Run-start resolve 等平台生成的
错误，以及 validation diagnostic、Workbench notification 和 Server 自身日志，不包含 value。

### 3.3 平台可以保证的非隐式泄漏边界

平台不会因为 list、resolve 或 inject binding 而把 Variable value 隐式复制到：

- FlowRevision、revision digest 或 closure digest；
- Publication；
- 持久化 Run request/inputs 或恢复数据；
- `node.started` 等系统生成的 RunEvent 投影；
- validation diagnostic、Workbench notification 或 Server 自身日志。

Variable value 进入声明的节点输入后属于用户定义的数据流。Flow 可以显式传播或返回该值，Code Task 可以
记录、抛出或发送它，Connector 可以把它发往外部系统；这些行为可能使 value 进入 `node.output`、Run result、
节点日志、错误消息或外部系统。本次不增加 taint tracking 或自动 value redaction，不承诺阻止操作者主动回显。

## 4. `/v1/variables` 精确合同

### 4.1 公共类型与 response

用户已选定公共记录类型名 `Variable`：

```ts
interface Variable {
  readonly name: string
  readonly updatedAt: string
  readonly value: string
  readonly version: 1
}
```

列表 response 不新增单独的公共命名类型，直接使用：

```ts
{
  readonly variables: readonly Variable[]
  readonly version: 1
}
```

`updatedAt` 是 Server clock 生成的 UTC ISO 8601 字符串，不是逻辑版本号。Response decoder 严格检查字段、
`version` 和时间格式；`value` 允许空字符串，不能复用要求非空的通用 string decoder。

### 4.2 Route 行为

| Method   | Path                  | Request                  | Success                           | Missing                  |
| -------- | --------------------- | ------------------------ | --------------------------------- | ------------------------ |
| `GET`    | `/v1/variables`       | 无 body/query            | `200 { variables, version: 1 }`   | 不适用                   |
| `GET`    | `/v1/variables/:name` | 无 body/query            | `200 Variable`                    | `404 variable.not-found` |
| `PUT`    | `/v1/variables/:name` | 精确 `{ value: string }` | create/update 均为 `200 Variable` | 不适用                   |
| `DELETE` | `/v1/variables/:name` | 无 body/query            | `200 { version: 1 }`              | `404 variable.not-found` |

PUT 不要求 body 中再带 `version`，这是与 Console 当前客户端兼容的明确请求合同；所有 JSON response 仍满足
Control API 的 `version: 1` 不变量。Console DELETE client 忽略成功 body，因此可兼容
`200 { version: 1 }`。

所有 path name 使用 UTF-8 percent encoding。GET、PUT、DELETE 都按 exact case 寻址；`TOKEN`、`Token` 和
`token` 是三个不同 identity。列表按 ASCII/BINARY 升序返回；名称只允许 ASCII，因此不同 SQLite 实现不需要
locale collation。

### 4.3 名称、值和数量限制

- name 长度为 1 到 256 个 ASCII 字符；
- name 匹配 `^[A-Za-z_][A-Za-z0-9_]*$`；
- name 不能以不区分大小写的 `OO_` 开头；
- value 是字符串，空字符串、换行、NUL 和 Unicode 内容均可原样 round trip；
- value 的 UTF-8 编码最多 64 KiB；
- 每个 deployment 最多保存 200 个不同 name；
- 已达到 200 条时仍可更新已有 name；
- PUT 与现有 value 相同则返回现有记录，不刷新 `updatedAt`；
- PUT 改变 value 时写入当前 Server clock；同一毫秒内的更新可能得到相同 `updatedAt`；
- 并发写入按 SQLite commit 顺序 last-write-wins。

Route/Service 在外部输入边界执行名称、body shape 和 value UTF-8 大小校验。Store 是 catalog cardinality 的
唯一权威 owner，在 upsert 写 transaction 中判断现有 name、count 和 insert；Service 只把 Store 结果映射为
`variable.limit-reached`，不能在 transaction 外通过 list/count 重复判断。Store 内部调用方受信任，不重复
执行外部输入校验。现有 5 MiB Control request boundary 继续作为更外层限制。

### 4.4 稳定错误

| Code                     | HTTP  | 场景                                              |
| ------------------------ | ----- | ------------------------------------------------- |
| `variable.invalid`       | `400` | 非法 name、body、query、value 类型或 64 KiB 上限  |
| `variable.not-found`     | `404` | GET/DELETE 的 exact name 不存在                   |
| `variable.limit-reached` | `409` | 第 201 个不同 name                                |
| `binding.unresolved`     | `409` | 首次 Publish/手动 Run admission 缺少所需 Variable |

Run-start 缺少 Variable 使用 terminal error code `binding.unresolved`，不是 HTTP response。错误消息可以包含
Variable name 和 binding ID，但不能包含 value。

### 4.5 Authentication、Client 与 conformance

- `/variables` 和 `/variables/*` 必须加入 Control app authentication middleware pattern；
- raw `controlApiConformanceCases` 覆盖 authenticated HTTP method、path、status、精确 body、错误、限制、
  排序和大小写 identity；
- `control/common/api.test.ts` 单独覆盖 `ControlClient` path encoding、PUT/DELETE、严格 decoder、空 value、
  malformed response 和额外字段；
- 未认证 Variables route 由 Server HTTP adapter tests 覆盖，不扩张通用 conformance harness 的认证合同；
- Variables 是所有部署必须实现的基础 conformance，不是 Server 私有或可选 profile。

## 5. Flow binding 与确定性语义

### 5.1 模型

把 `FlowDocument.bindings` kind 从 `connection | secret` 改为 `connection | variable`。Variable declaration 的
target 是 name，Connection declaration 继续保存 opaque Connection identity。

Input 使用现有结构化 source：

```ts
{
  kind: 'sources',
  sources: [{ kind: 'binding', bindingId: 'binding-id' }]
}
```

BindingSource 用于节点 input 时必须指向 `kind: 'variable'`；Connection binding 只用于其现有 Trigger/Task
合同，不能作为普通节点输入值。

### 5.2 排他 source 规则

deployment Variable 是端口的排他 source：

- 一个 input mapping 最多包含一个 Variable BindingSource；
- Variable BindingSource 不能与 NodeSource、FlowSource、第二个 BindingSource 或 literal value 混用；
- 选择 Variable 时替换整个 input mapping，并断开该端口已有 edge/source；
- 连接 Node edge 到 Variable-bound input 时移除 Variable source；
- 切换到 literal、Flow source、Node source 或空值时移除 Variable source；
- deterministic validation 拒绝手写或外部提交的混合 mapping。

这避免 Scheduler 把 Variable 和上游 source 分别入队，导致同一节点执行多次。

### 5.3 Schema 兼容规则

本次采用保守规则：deployment Variable 只能绑定到“接受任意 JSON string”的普通 input schema。

- 使用现有 JSON Schema subset checker 判断 `{ type: 'string' }` 是否是目标 schema 的 subset；
- `{}`/any 和无额外限制的 string schema 可以接受；
- enum、const、pattern、format、长度限制或 checker 无法证明接受任意 string 的 schema 不提供 Variable binding；
- 显式非 string schema 拒绝；
- 带 `oomol/bin`、`oomol/artifact` 或其他特殊 `contentMediaType` 的 input 拒绝；
- nullable 不影响兼容性，因为 Variable value 永远是 string，不是 null。

因此 Run start 不需要根据当前 value 做第二套 schema validation。未来若扩展到受约束 string schema，需要另行
定义实际 value validation 合同，不在本计划中预留未使用行为。

### 5.4 Binding identity 与生命周期

Workbench 的端口级选择默认创建独立 binding ID，即使多个端口选择同一个 Variable name，也不隐式共享
declaration。Run resolve 可以按 name 去重读取。

对已有共享 binding 的编辑采用 copy-on-write：

- 只有当前 input 引用时，可以 `binding.replace`；
- 被多个 input 引用时，为当前 input 创建新 binding，并只重写该 input；
- 不能因为编辑一个端口而静默改变其他端口。

切换 source、删除节点、删除 Task port、替换节点、删除 Subflow 或其他操作移除引用后，authoring logic 必须
扫描根图和全部 Subflow graph；最后一个引用消失时删除 declaration。计划不再假设现有逻辑已经具备该能力。

Copy/paste 必须携带所选节点实际使用的 Variable declaration。Paste 为 declaration 生成新 binding ID，重写
全部 BindingSource；跨 Flow paste 不产生悬空 binding，同 Flow paste 也不意外共享旧 binding。

### 5.5 Closure 与 validation

`flowClosure` 继续只收集实际使用的 binding。确定性 validation 至少检查：

- Variable target 满足名称规则；
- BindingSource 引用存在；
- BindingSource 指向 Variable 而不是 Connection；
- 排他 source 和 schema 兼容规则；
- Trigger Connection binding 仍必须是 Connection。

Closure digest 包含实际使用 declaration/name，不包含 value。未使用 declaration 不触发 Run resolve。

## 6. Eligibility、Run start 与恢复

### 6.1 Idempotency 优先于 eligibility

Publish、Rollback、Draft Run、Live Run 和 Trigger occurrence 都先处理已有 idempotency/dedupe identity：

1. identity 已存在且 request digest/occurrence 一致，原样返回已有资源，不读取当前 Variable；
2. identity 已存在但请求不同，返回现有 conflict；
3. 只有真正首次创建、且该入口有 eligibility 的请求才执行后续检查。

已接受后删除 Variable，再用相同 identity 重试，必须返回原 Publication/Run，不能改成
`binding.unresolved`。

首次 Publish、Rollback、Draft Run 和 Live Run 的 Variable eligibility 必须与资源创建处于同一个权威 Store
写 transaction 中：

```text
BEGIN write transaction
  → 查询 idempotency identity
  → identity 已存在时返回 replay 或 conflict
  → 对固定 Revision closure 批量检查所需 Variable name
  → 创建 Publication 并更新 Live，或创建 Run
COMMIT
```

Service 可以在进入 Store 前做一次非权威预检查以提供快速反馈，但 Store transaction 必须重新检查。Variable
PUT/DELETE 使用同一个 SQLite writer 和写 transaction，与首次创建按 commit 顺序串行化。DELETE 与首次创建
并发时，合法结果只能是创建先提交并成功，或者删除先提交且首次创建返回 `binding.unresolved`；不能在检查与
创建之间留下 TOCTOU 窗口。Trigger occurrence 仍按第 6.2 节准入，不加入该 eligibility transaction。

### 6.2 Admission 行为

- 首次 Publish 和 Rollback 检查固定 Revision closure 所需 Variable 当前是否存在；
- 首次 Draft/Live 手动 Run admission 检查所需 Variable 当前是否存在；
- Store transaction 内的权威 admission 检查决定首次创建是否成立，但只检查存在性，不固定 value，也不保证
  排队后的可用性；Service 的可选预检查只用于快速反馈；
- Trigger occurrence 不做 Variable eligibility 预检查，继续按现有 webhook/cron/poll/integration 的
  admission、dedupe、checkpoint 和 retry 路径准入普通 Run；
- Trigger Run 与其他 Run 在统一 Run-start resolve point 失败，避免产生第二套 Trigger 状态机。

### 6.3 一致 snapshot 与 durable barrier

每个 Run 使用以下固定顺序：

```text
claim queued Run
  → durable status = starting
  → prepare fixed Revision/closure
  → 在一个 SQLite read transaction/snapshot 中批量解析实际使用的 Variable name
  → 按 name 去重，并投影为 bindingId -> string 内存映射
  → 原子提交 durable status = running + run.started
  → 把映射交给 Executor/Scheduler
  → 用户代码开始
```

- resolve point 是 `starting` 期间、durable `running` barrier 之前，不声称与 claim transaction 同时发生；
- resolve 失败使用 `failStarting`，terminal code 为 `binding.unresolved`，没有 `startedAt` 或
  `run.started`；
- barrier 前崩溃可以重新 claim，并从当前 Variable 目录重新解析；
- barrier 后崩溃不能重放用户代码，只能按现有恢复规则结束为 `indeterminate`；
- 取消与 resolve/start 竞争时，权威 Store 只能产生一个 terminal；
- Run 开始后的 PUT/DELETE 不改变当前内存 snapshot；
- 排队期间或 barrier 前更新，Run 使用实际 resolve point 看到的值；
- snapshot 不写入 Run row、inputs、event 或恢复数据，Run/Executor 结束后释放。

整个 Run 的根 graph 和所有递归 Subflow invocation 共享同一份 `bindingId -> string` 内存 snapshot。每次
`runGraph` invocation 启动时，Scheduler 按当前 graph 的 BindingSource 建立 target，并向每个 Variable-bound
input port 投递一次。同一个 Subflow 被调用 N 次时，它的 Variable-bound input 在每次 invocation 中各投递一次，
但 Store 仍按整个 Run closure 和 Variable name 去重解析，不因 Subflow invocation 重读数据库。

删除 `capability.secret()`，不增加 `capability.variable()`；Code Task 只能通过声明的 input 获得 value，不能
任意按 name 读取 deployment catalog。

## 7. Server 持久化

新增 `apps/server/migrations/0002_variables.sql`，不修改已执行的 `0001_flow.sql`：

```sql
CREATE TABLE variables (
  name TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL CHECK (updated_at >= 0)
) STRICT;
```

`migrationFiles` 加入 0002，`PRAGMA user_version` 从 1 推进到 2。新数据库依次执行 0001、0002；version 1
数据库升级时保留全部 Flow/Revision/Run 数据；重复 migrate 无副作用；高于 2 的 schema 继续拒绝。

Store 提供 list、get、upsert、delete 和批量 resolve。写 transaction 的固定顺序是：

1. exact name 已存在：相同 value 原样返回，不更新时间；不同 value 写入当前 Server clock；
2. name 不存在：在同一 `BEGIN IMMEDIATE` transaction 内 count；
3. count 为 200：返回 limit；
4. 否则 insert。

同一毫秒内两次不同 value 的 PUT 可以返回相同 `updatedAt`；测试用可控 clock 验证更新路径，不把时间戳当作
单调 revision。Catalog 数量只能在这个 Store transaction 中权威判断，Route/Service 不做事务外 count。

单个 Server/Store writer 下，199 条时并发创建两个不同 name 恰好一个成功；并发创建同一 name 最终只占一个
名额；满额时更新已有 name 成功、新建失败。Server 现有单 writer 部署不变量保持不变，本计划不扩张为多进程
SQLite writer 保证。

批量 resolve 在一个 read transaction/snapshot 中读取全部去重后的 name，不能逐名查询。Variable table 不建
Flow foreign key，不参与 Flow retirement；删除 Variable 不扫描或修改 Revision/Publication。

## 8. Workbench 与 Designer

### 8.1 宿主 Variables view

公共 Workbench 不新增 `WorkbenchView = 'variables'`，也不承担 deployment Variable value 管理。开源
`apps/server` 的 browser host 在 `/variables` 提供列表、搜索、刷新、创建、编辑和删除，展示
`count / 200`、name、value 和 updatedAt。name 创建后不可修改；删除前提示其他 Flow/client 可能停止工作。
`console.oomol.com` 保持使用自己的既有管理面，不因嵌入公共 Workbench 而出现第二套 Variables 管理页。

本次不新增 Variable realtime notification channel。Catalog 在以下时机 refresh：

- 进入开源 Server 的 `/variables` 页面；
- Variable selector 打开；
- 浏览器重新获得 focus；
- 当前 Workbench 完成 save/delete 后。

外部 CLI/client 修改后，已打开页面通过上述 refresh 点恢复权威状态。

### 8.2 Designer input contract

旧 Secret selector 是 literal value editor，不能直接替换成结构化 binding UI。实现必须扩展：

- Workbench 到 Designer 的 input view model，包含 source kind、binding ID、Variable name 和 missing 状态；
- input editor callback，表达选择 Variable 和切换回其他 source；
- Workbench projection，不能继续丢弃 BindingSource/FlowSource；
- authoring change 生成、copy-on-write、orphan cleanup 和 copy/paste；
- 目录加载完成后的 missing Variable warning。

开源 Server 管理页可以持有完整 Variable record；公共 Workbench catalog 必须先投影为 name-only 数据，
selector 不展示、复制或写入 value。

### 8.3 Runtime Ref 清理

删除未发布 Runtime Ref 的 schema、typing、连接限制、viewer special value 和 Designer 类型入口。deployment
Variable 不新增或复用 `contentMediaType`，脚本仍通过声明 input 接收 Variable value。

## 9. 遗留 Secret 清理范围

完整删除：

- `packages/open-flow/src/secret`；
- Secret model、template、reference parser、Browser store 和 Designer store wiring；
- `oomol/secret` schema、widget、handle kind、edge color、viewer special value 和相关 locale；
- `FlowDocument` 的 `secret` binding kind 及 fixture；
- Executor realm 的 `capability.secret()`。

必须保留：

- Operator cookie signing secret；
- Integration callback secret/verifier；
- Provider webhook signing secret；
- Connector credential redaction 和日志敏感字段清洗；
- Docker/Kubernetes secret 的通用部署含义；

不能按全文 `secret` 搜索结果机械删除。

## 10. 测试计划

### 10.1 Control API、Client 与 authentication

- 四条 route 的 method、path、query、status 和精确 JSON body；
- response `version: 1`，PUT request 精确 `{ value }`；
- name 1/256/257 边界、非法字符、数字开头、`OO_` 大小写变体；
- exact-case identity 和 ASCII/BINARY list order；
- 空 value、Unicode、换行、NUL、64 KiB/超限 UTF-8 round trip；
- GET/DELETE missing、额外 body 字段、错误 value 类型、malformed JSON；
- Variable decoder 接受空 value，拒绝非法时间、缺失/额外字段和错误 version；
- `/variables` 与 `/variables/*` 未认证请求被拒绝；
- raw conformance 与 `ControlClient` tests 分开覆盖。

### 10.2 Store、migration 与并发

- 新数据库依次应用 0001/0002，`user_version === 2`；
- version 1 数据库带真实 Flow/Revision 数据升级后完整保留；
- 重复 migrate 和 newer schema 拒绝；
- build artifact 包含 0002；
- 同值 PUT 保留时间；改值 PUT 使用可控 Server clock，跨毫秒时更新时间，同一毫秒允许相同；
- 第 200 条成功、第 201 条失败、满额更新成功；
- 199 条时并发创建不同 name 恰好一个成功；
- 并发创建同一 name 只占一个名额；
- 满额并发 update/create 分别成功/失败；
- 多 name batch resolve 使用一致 snapshot，重复 target 只读一次。

### 10.3 Flow、authoring 与 Runtime

- Variable binding 进入 Revision encoding/closure digest，value 不进入；
- missing、Connection-as-input、mixed sources、multiple bindings、非法 name 和不兼容 schema diagnostic；
- Variable 与 literal、Node source、Flow source 的双向排他切换；
- 共享 binding copy-on-write；
- source 切换、节点/port/Subflow 删除后的 orphan cleanup；
- copy/paste 复制 declaration、生成新 ID、重写 source；
- 一个 value 投递到一个/多个 input，未使用 declaration 不 resolve；
- Publish/Draft/Live 首次 admission eligibility 与 idempotency replay 优先级；
- Variable DELETE 与首次 Publish、Draft Run、Live Run 并发，只产生“创建先提交并成功”或“删除先提交且
  `binding.unresolved`”两种结果；
- Trigger 不预检查，仍准入普通 Run，并在统一 Run start 失败；
- resolve 前更新、resolve 后更新、批量 snapshot、missing start failure；
- Subflow 内直接绑定 Variable；同一 Subflow 多次 invocation 时每次投递；根图与 Subflow 共用同一 name 时
  Store 只 resolve 一次；
- durable barrier 前/后崩溃和取消竞争；
- 不回显 value 的消费任务不会因平台 resolve/inject 自动把 sentinel 写入 Revision、Publication、Run inputs、
  system-generated event、诊断、通知或 Server 日志；
- 显式输出 value 可以进入 node output/result，这是记录过的用户数据流语义；
- Runtime Ref schema、typing、special kind 和 Designer 入口已删除，不被改成字符串配置或通用 Store。

### 10.4 Workbench

- 开源 Server `/variables` location、进入/离开导航和 refresh 时机；
- 开源 Server 管理页的创建、同值保存、更新、删除和失败反馈；
- 公共 Workbench 不出现顶层 Variables 管理 view；
- selector 只接收 name projection；
- selector 创建结构化 binding/source，不写 inline value；
- 外部删除后 refresh 显示 missing warning；
- 只保留用户可见行为测试，不保留仅断言 class、markup 或组件 wiring 的低价值测试。

## 11. 文档与交付检查

实现时同步修改：

- `docs/architecture.md`：Variable deployment ownership、value 不进 Revision/持久化 Run input、首次
  Publish/手动 Run eligibility 与资源创建的权威事务、Run-start snapshot/barrier、Trigger 统一 Run-start
  failure；
- `docs/control/contracts/control-api.md`：精确 route、type、status、error、限制、排序和大小写；
- `docs/server/container-delivery.md`：Variable 明文存在主库、WAL/SHM 和备份；
- `SECURITY.md`：区分部署级真正 secret 与可由 Operator 读取的 Variable 敏感配置，删除“所有敏感配置都不进
  Workbench/API response”的绝对表述；
- Workbench 中英文 locale。

最终运行：

```bash
bun run check
bun run test
bun run build
bun run test:package
```

不启动或自动化浏览器。前端交互只用 repository tests、type checks 和 builds 验证。

## 12. 实施顺序

1. 固定公共 Variable type、错误、HTTP conformance 和 Client decoder tests；
2. 增加 0002 migration、Store CRUD/batch resolve 和 Server authenticated routes；
3. 修改 Flow binding、确定性 validation、排他 source 和 closure；
4. 接通 admission eligibility 的权威事务、idempotency order、Run-start snapshot、Subflow 注入和 durable
   barrier；
5. 扩展 Designer input contract、authoring lifecycle 和 copy/paste；
6. 增加开源 Server Variables 管理页、公共 Workbench catalog refresh 和 input Handle selector；
7. 删除 Secret 遗留代码和不可达样式、locale、fixture；
8. 补齐安全、并发、Trigger、恢复和 Workbench 行为测试；
9. 更新架构、Control API、安全和交付文档；
10. 运行全量检查，确认 public package exports、conformance 和静态 Workbench artifact。

每一步只修改直接依赖代码。实现中如果需要新增本计划未命名的 TypeScript type/interface，先让用户选择名称；
不能为绕过命名确认临时发明长类型名，也不能同时保留两套 Variable 或 Secret 行为。
