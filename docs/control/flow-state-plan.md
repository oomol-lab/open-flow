# Flow State 设计计划

状态：2026-10-30 跨 Run 边界已确认；本仓库 S1、S2、S3、S5 已实现，验证记录见交接文档。Cloud S4 待公共包发布后在 Cloud 仓库实施。实现交接见
[交接文档](flow-state-handoff.md)。

## Implementation baseline (2026-10-30)

`beta.76` is now published (gitHead `fd93811d8fdccc98be4511a43106bbc0fb7a6572`).
Its Model v12 / Engine v9 are fixed; Flow State uses Model v13 / Engine v10.
Increasing mode compares finite numbers numerically and valid RFC 3339 timestamps by epoch
milliseconds. Timestamps require seconds, explicit timezone and at most three fractional digits.
Mixed types within a batch or against the saved watermark fail atomically with `capability.invalid`.
All items compare to the initial watermark; duplicate batch values count once. Commit the maximum
after processing, preserving input order. Empty batches preserve existing watermarks unless the configured mode changes; a mode change resets the space atomically even with no items.
Code dedupe uses set mode: insert resets increasing spaces; has rejects them without mutation.

## 目标

为 Flow 提供跨 Run 持久的状态，首要用途是条目级去重：例如 Cron 每小时拉取一次 HTTP 列表，只处理新出现的条目。
同时为 Code 提供少量 Flow 级业务状态（游标、计数器、短期缓存）。Server 与 Cloud 实现同一份公共契约，同一 Flow
在两端行为一致。

不做：

- Trigger 事件去重与内部进度。Provider Trigger 的事件去重（`flow_trigger_event_dedupe`）、Poll checkpoint、
  Integration source checkpoint 与远端订阅 ID 已由部署分别持有，并与 Run 准入同事务提交；并入 State Store 会产生
  第二个事实来源。去重节点处理的是单个 Run 内的条目，不替代事件去重。
- 大对象与文件。使用 Run 范围的 Artifact。
- 跨 Flow 或 Team 级共享数据、条件查询、事务。
- 首期的历史淘汰（LRU、TTL、最近 N 项），见“历史保留”。
- Agent 代码工具与 Agent 工具调用访问 State Store。

## n8n 参照

| 方面     | n8n                                                                     | 本计划                                      |
| -------- | ----------------------------------------------------------------------- | ------------------------------------------- |
| 业务状态 | `$getWorkflowStaticData` 返回可变对象，执行结束时整体写回               | `context.state` 异步 KV，每次写入立即持久化 |
| 去重     | Remove Duplicates 节点按节点或 workflow 范围记录历史，独立于 staticData | 去重节点与 `context.dedupe`，独立于业务状态 |
| 测试执行 | 手动执行的 staticData 修改丢弃                                          | Draft 使用独立 scope（D-S1）                |
| 并发     | 并发执行时后写覆盖                                                      | 同一 Flow 的 Run 串行，去重批次原子提交     |
| 上限     | staticData 无上限                                                       | 业务状态按字节，去重按标识数，均有部署上限  |

n8n 的“执行结束时写回”不适用于 Open Flow：Run 可以在 Wait 或审批中挂起数天，并跨 Executor session 与 checkpoint
恢复。结束时写回要求把脏状态写进 checkpoint，Cloud 的 Workflow checkpoint 与内部执行协议都要改动。

## 现状依据

- **同一 Flow 的 Run 串行。** Server 的 `supervisor.ts` 用 `#runningFlows` 排除同 Flow 的 claim；Cloud 由 D1 调度
  事务保证，`waiting` 的 Run 同样阻止后续 Run 越过。Workflow 工具的子 Run 属于其他 Flow（递归被拒绝）。同一 Flow
  的状态没有并发写者，不需要 Durable Object 一类的协调存储。
- **Capability 模式已存在。** Artifact 由公共 guest helper（`runtime/common/runtime.ts`）加 Capability kind 实现，
  Server 宿主在 `application/run-artifacts.ts`，存储在迁移 56。Code 访问 State Store 复用同一结构。
- **Engine 与 Model 版本。** [Code 运行时对齐计划](code-runtime-alignment-plan.md) 已随 beta.76 发布为 Model v12 /
  Engine v9。Flow State 使用新的 Model v13 / Engine v10，保留已发布 v9 的运行时与 digest。

## 模型

State Store 是一个部署存储 owner，持有两类记录：

| 方面     | 业务状态（values）                       | 去重标识（identities）                                   |
| -------- | ---------------------------------------- | -------------------------------------------------------- |
| 内容     | key → JSON 值                            | 标识的截断哈希，无值                                     |
| 记录大小 | 可变                                     | 固定                                                     |
| 核心操作 | `get`、`set`、`insert`、`delete`、`list` | 整批检查并记录                                           |
| 访问     | Code 通过 `context.state`                | 节点空间仅限所属去重节点；Flow 空间通过 `context.dedupe` |
| 单项上限 | 单值字节数                               | 单空间标识数                                             |
| 淘汰     | 永不淘汰                                 | 首期不淘汰，后续 TTL 或最近 N 项                         |
| 清空入口 | Flow 状态面板                            | 节点菜单（节点空间）、Flow 状态面板（全部空间）          |

两类记录分表存储：主键形状不同，后续淘汰需要的 `recorded_at` 索引只属于去重标识，放在同一表会让每次业务状态
写入多付一行索引写入。

两类记录共享以下规则，由同一 State Store 模块实现：

- **Scope。** Run 按来源固定 scope：Live Run 使用 `live`，Draft 测试使用 `draft`（D-S1）。工作流调用产生的子 Run
  使用子 Flow 自己的状态与子 Run 的来源，不继承父 Flow。
- **生命周期。** 状态不进入 Revision、Publication 或 digest；Publish、Rollback 与 Draft 编辑都不改变状态。Flow
  删除时由既有 lifecycle owner 在同一清理流程中删除两类记录。
- **Flow 总配额。** 每个 `(flow, scope)` 的总字节数计入同一上限；去重标识按固定行大小计入。
- **Capability 宿主。** 同一宿主校验当前 Flow、Run、Task、invocation 与 Run 状态，并按调用身份控制空间访问；
  Task 或 Run 结束后调用 fail closed。
- **写入语义（D-S2）。** 每次写入在宿主确认后即持久化，是普通副作用，与 Connector 调用同等对待：不重放，结果
  无法确认时按既有规则成为 indeterminate（`INV-EXEC-NO-REPLAY`）。Task 写入后失败或 Run 取消都不回滚。Scheduler、
  checkpoint 与恢复逻辑不变。
- **可见性。** 状态读写不产生 RunEvent，值不写入日志；用户代码显式输出的值照常进入数据流。状态是 Flow 数据，
  不是 Secret，文档写明不应存放凭据。

## 去重

### 空间

- **节点空间** `node:<nodeId>`：去重节点默认使用，以稳定 node ID 区分，各节点历史互不影响。不向 Code 开放。
  复制节点得到新 node ID，历史从空开始；节点改名不影响历史。
- **Flow 空间** `flow`：`context.dedupe` 使用，供自定义或跨节点共享的去重。去重节点可配置为使用 Flow 空间。

### 标识

标识必须是字符串或有限数字。宿主对 `typeof` 标记加规范文本计算 SHA-256，截取前 16 字节存储；原值不入库。
节点运行结果展示本次的新条目与重复条目，不提供历史原值查询。

### 检查并记录

一批标识在一个存储事务内完成：

1. 批内先去重，批内重复的后续出现计为重复。
2. 查询已存在的标识；已存在的计为重复。
3. 若新标识数加现有数超过该 Flow/source 的标识总数上限，整批失败，不写入任何标识（D-S5）。全部已存在的批次在满额时仍然成功。
4. 写入新标识并原子更新空间计数。

空间计数随写入原子更新。Server 在事务内汇总当前 Flow/source 的空间计数检查标识配额，按主键前缀统计业务数据和空间条数。批次超过
D1 单语句绑定参数上限时分块，所有块在同一事务内提交。一个批次计为一次写入操作，不按条目计入单 Run 写入次数。

### 记录时机

标识在去重节点执行时记录。若下游节点失败，这些条目在后续 Run 中被视为已处理而跳过。节点说明必须写明这一点。
“Run 成功后才提交记录”需要把待记录标识写入 checkpoint 并改动 Cloud 执行路径，不在首期。

### 历史保留

首期不淘汰历史，避免旧条目因淘汰再次被当作新项。持续产生新标识的数据源最终会写满空间，因此首期提供：

- 用量达到 80% 时在节点运行结果与节点上提示。
- 水位模式（D-S4）：只保存已见过的最大值，严格大于水位的才是新条目，存储不随条目增长。

后续按需求增加 TTL（指定时间内不重复）与最近 N 项（按记录顺序淘汰），届时为去重标识表增加 `recorded_at` 索引。

### 去重节点

遵循 [Node authoring](../authoring/node-authoring.md)，随 Model v13 发布。由部署直接执行，不进入用户代码隔离环境。

- 业务配置：标识来源（条目字段路径）、模式（`new` 或 `increasing`，见 D-S4）、空间（默认节点空间，可选 Flow 空间）。
  上限由部署决定，不增加日常节点配置。
- 输入：条目数组。
- 输出：`items`（新条目，保持输入顺序）与 `duplicates`（重复条目）。
- 节点菜单提供“清空历史”。编辑器中默认只清空 `draft` scope；清空 `live` scope 是生产操作，需要单独确认。

## Code 契约

### Guest API

```ts
await context.state.get(key) // JsonValue | null
await context.state.set(key, value) // value: JsonValue，null 等同于 delete
await context.state.insert(key, value) // boolean，键不存在时写入并返回 true，已存在时不修改并返回 false
await context.state.delete(key)
await context.state.list() // string[]，按键排序

await context.dedupe.insert(ids) // boolean[]，与 ids 对齐，true 表示新标识并已记录
await context.dedupe.has(ids) // boolean[]，只读
```

- `key`：非空字符串，UTF-8 不超过 256 字节。读取返回值的独立副本，修改返回对象不会写回。
- `value`：JSON 值，在 guest 边界序列化并校验，非 JSON 值以 `capability.invalid` 拒绝。
- `state.insert` 是单键条件写入，适合一次性初始化、首次处理标记等需要“不存在才写入”的业务状态；`value` 不能为
  null。它按业务状态计量字节，不做哈希、批处理或淘汰。
- `context.dedupe` 只访问 Flow 空间，`insert` 与去重节点使用同一检查并记录实现与上限。大量条目去重使用
  `context.dedupe`，一次往返处理整批，并适用去重的标识数上限、水位模式与后续淘汰规则。

### Capability

| Kind            | Payload          | Response body  |
| --------------- | ---------------- | -------------- |
| `state.get`     | `{ key }`        | `{ value }`    |
| `state.set`     | `{ key, value }` | `null`         |
| `state.insert`  | `{ key, value }` | `{ inserted }` |
| `state.delete`  | `{ key }`        | `null`         |
| `state.list`    | `{}`             | `{ keys }`     |
| `dedupe.insert` | `{ ids }`        | `{ inserted }` |
| `dedupe.has`    | `{ ids }`        | `{ present }`  |

不需要节点声明：访问范围由 Run 固定的 Flow 与 scope 决定。参数错误为 `capability.invalid`；超过业务状态上限为
`limit-exceeded`，不可被 `onError` 处理；去重空间已满为 `dedupe.full`，可被 `onError` 处理（D-S5）。

## Control API、CLI 与 MCP

- `GET /flows/{flowId}/state?scope=`：业务状态键、大小与 `updatedAt`，可选读取值；去重空间列表（空间、模式、
  标识数、水位、更新时间）及 Flow 总用量。
- `DELETE /flows/{flowId}/state?scope=[&key=]`：清空业务状态或删除单键。
- `DELETE /flows/{flowId}/dedupe?scope=&space=`：清空一个去重空间。
- 权限与 Flow 编辑权限相同。CLI 与 MCP 使用同一部署服务，不另行实现。

## 存储

两端使用相同的逻辑结构：

```sql
CREATE TABLE flow_state_values (
  flow_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  key TEXT NOT NULL,
  value_json TEXT NOT NULL,
  size INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_run_id TEXT NOT NULL,
  PRIMARY KEY (flow_id, scope, key)
);

CREATE TABLE flow_dedupe_identities (
  flow_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  space TEXT NOT NULL,
  identity BLOB NOT NULL,
  recorded_at INTEGER NOT NULL,
  PRIMARY KEY (flow_id, scope, space, identity)
);

CREATE TABLE flow_dedupe_spaces (
  flow_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  space TEXT NOT NULL,
  mode TEXT NOT NULL,
  count INTEGER NOT NULL,
  watermark_json TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (flow_id, scope, space)
);


```

- 首期不建二级索引；按 Flow 列出与删除走主键前缀。
- 业务状态的计量字节为键、值与固定行开销之和；去重标识按固定行大小计。
- 去重节点的模式与空间记录的模式不一致时（节点改了模式），首次记录前在同一事务内重置该空间。
- 节点删除后遗留的节点空间首期不自动清理（D-S6），计入 Flow 配额，在 Flow 状态面板中标为遗留并可清空。
- Server：迁移 57，存于现有 SQLite。
- Cloud：tenant D1 迁移，随 Flow 所在分片。冻结执行宿主不绑定 D1；Code 的 Capability 与去重节点都通过控制面
  内部执行协议（`protocol/execution-requests.ts`）新增操作访问，请求绑定 tenant、Run、release 与执行 segment。

## 上限（初值，部署可配置）

| 项目                              | 初值   |
| --------------------------------- | ------ |
| 业务状态单个 value                | 64 KiB |
| 单 Flow 单 scope 业务数据条数     | 1,000  |
| 单 Flow 单 scope 去重空间数       | 100    |
| 单 Flow 单 scope 全部空间标识总数 | 10,000 |
| 单 Run 写入操作次数               | 1000   |

单 Run 写入次数沿用 Cloud 大输出“在 D1 原子预留写入次数”的做法，随 Workflow checkpoint 恢复，失败不返还；一次
`set`、`delete` 或去重批次各计一次。不再设独立总容量配额；key 与空间名最多 256 个 UTF-8 字节，水位模式只占空间名额。

## Cloud 成本

按 Workers Paid 的 D1 公开价估算，落地前复核：

- 写入：每百万行 1 美元，每月 5000 万行免费。一次 `set` 写 1 行值；一个去重批次写入新标识数加 1 行空间记录。一个 Flow 每天新增 1000 个标识，每月约 3 万行。
- 读取：每百万行 0.001 美元。去重批次读取行数约等于批大小，可忽略。
- 存储：约束是单个 D1 数据库 10 GB。分片容量规划按条数与单值上限估算：每个 scope 的普通 value 最多 62.5 MiB，另计 key、去重记录、索引及数据库开销。
- 延迟：Code 调用经 Executor → 执行宿主 → Service Binding → 控制面 → D1，每次约数十毫秒；去重节点由部署直接执行，
  每批一次往返。

未采用的存储：

- Workers KV：
  - 最终一致（约 60 秒）。相邻 Run 可能读不到上次记录的标识，导致重复处理；不同机房执行时更明显。
  - 没有事务与条件写入，无法原子完成整批检查并记录、满额整批失败和计数更新；单键每秒仅 1 次写入。
  - 没有按前缀删除与计数，配额统计和 Flow 删除需要逐键 list 与 delete，均按次计费。
  - 读取按次计费（每百万次 0.5 美元），去重每批逐个检查标识，规模增大后远高于 D1 按行计费的读取。
  - 原生 TTL 是唯一优势；后续 TTL 模式在 D1 中以 `recorded_at` 索引加写入时或低频清理实现。
- Durable Objects：强一致，但形成 D1 之外的第二个权威存储，需另行处理 Flow 删除、分片与保留；串行执行已消除并发需求。
- R2：单次写操作价格远高于 D1 单行，适合大对象。

## 所有者

| 所有者           | 持有的内容                                                                                                                          |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Open Flow 公共包 | 去重节点的 authoring 契约与确定性语义、Capability kind 与 payload、guest helper、编辑器类型、conformance、Control API 合同与 client |
| Open Flow Server | State Store 的 SQLite 存储与迁移、Capability 宿主、去重节点执行、上限、Control API 端点、Flow 删除清理、engine digest               |
| Open Flow Cloud  | State Store 的 tenant D1 存储与迁移、控制面内部执行操作、执行宿主转发、去重节点执行、上限、Flow 删除清理、engine digest             |

## 阶段与依赖

| 阶段 | 内容                               | 前置                 | 交付                                |
| ---- | ---------------------------------- | -------------------- | ----------------------------------- |
| S1   | 公共契约：去重节点、Code API、类型 | 无                   | 公共包，并入 Model v13 / Engine v10 |
| S2   | Server 实现                        | S1                   | Server                              |
| S3   | Control API、CLI、MCP              | S1                   | 公共包与 Server                     |
| S4   | Cloud 实现                         | S1、Cloud 升级公共包 | Cloud                               |
| S5   | Workbench 节点菜单与状态面板       | S3                   | 公共包 Workbench 与 Lab             |

### S1：公共契约

1. 去重节点的业务配置、输入输出、schema、示例、搜索与诊断，按 Node authoring 一并交付。
2. `runtime/common` 新增 `context.state` 与 `context.dedupe` 的 guest helper 与 Capability kind，参数在 guest 边界校验；
   `TaskContext` 与编辑器类型随对齐计划阶段 3 一起更新。
3. conformance：业务状态往返、`insert` 对已存在键不修改、跨 Task 与跨 Run 可见、非 JSON 值拒绝；去重批内重复、跨 Run 重复、满额整批失败、
   满额时全重复批次成功、水位模式；Task 结束后调用被拒绝。跨 Run 用例需要 harness 支持同一 Flow 的两次 Run。
4. [Node 运行时契约](contracts/nodejs-runtime.md) 新增 State 一节；[兼容记录](contracts/compatibility.md) 在
   Model v13 / Engine v10 条目中登记。

### S2：Server

1. 迁移 57 建表；State Store 模块提供带配额的原子写入、检查并记录与按 Flow 删除。
2. Capability 宿主与 `run-artifacts.ts` 并列，从 Run 固定 Flow 与 scope；去重节点由部署直接执行。
3. Flow 删除流程加入清理；engine digest 追加 `state/1`。

验证：`apps/server/test/isolated-vm.test.ts` 运行新 conformance；Flow 删除后状态清空；Draft 与 Live 互不可见；
CLI Lab 完成“Cron 定时拉取 HTTP 列表，只处理新条目”场景，并验证第二次运行无新条目。

### S3：Control API、CLI、MCP

公共 client 与 schema、Server 端点、CLI 命令与 MCP 工具，复用同一部署服务。

### S4：Cloud

1. tenant D1 迁移；State Store 存储模块接入 Flow 退役清理。
2. 控制面内部执行协议新增 state 与 dedupe 操作；执行宿主转发 Code Capability，并执行去重节点。
3. 单 Run 写入次数预留与 checkpoint 恢复；engine digest 追加 `state/1`。

验证：公共 conformance；退役 Flow 清理；跨 release 的 Run 在旧宿主上调用时明确拒绝而非静默成功。

### S5：Workbench

去重节点菜单的清空与用量提示；Flow 设置中按 scope 查看业务状态与去重空间（含遗留空间），支持删除与清空。Lab
增加对应 story。

## 架构文档变更

[架构](../architecture.md) 第 3 节需新增：State Store 保存用户显式写入的跨 Run 数据与去重标识，归属 Flow 与 Run
来源，不属于 Revision、Run 存储或 Trigger 进度；部署拥有存储、上限与清理。现有“Run 内部存储不能成为第二条数据
通道”的约束保持不变：State Store 只包含显式写入的值与标识哈希，不暴露节点结果。

## 决策（2026-10-30 已定）

- **D-S1**：Draft 与 Live 隔离。Draft 测试使用独立 `draft` scope，可在 Workbench 清空；生产状态不受调试影响。
  不采用 n8n 的“Draft 只读 Live 状态并丢弃写入”，因为调试时无法观察写入结果。
- **D-S2**：每次写入立即持久化。不采用“Task 成功时原子提交缓冲写入”：失败 Task 会推进状态，由文档提示规避；
  换来的是 Cloud 的 Task 结果提交路径与内部协议保持不变。
- **D-S3**：上限采用上表初值，部署可调整。业务状态只按字节限制，不限制键数，以免与去重标识数冲突。
- **D-S4**：首期提供水位模式。持续产生新标识的数据源在无淘汰时必然写满，水位模式对按递增 ID 或时间拉取的场景
  不随条目增长。集合模式继续依赖 80% 提示与手动清空。
- **D-S5**：去重空间已满为可被 `onError` 处理的业务失败 `dedupe.full`。满额是用户数据状态，不是资源失控，用户
  需要能降级处理。业务状态超限与单 Run 写入次数超限仍为 `limit-exceeded`。
- **D-S6**：节点删除后的空间首期不自动清理，计入配额并在面板标为遗留，可手动清空。Draft 删除的节点可能仍在
  Live 中使用，撤销删除会恢复同一 node ID。不采用 Publish 时自动清理。
- **存储**：Cloud 使用 tenant D1，不使用 Workers KV，理由见“Cloud 成本”。
