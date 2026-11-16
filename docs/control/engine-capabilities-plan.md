# Engine 能力与 Model 特性解耦设计

状态：第一阶段开源仓库部分（第 1、2、4 步）已实施，Cloud（第 3 步）待接入。2026-11-13 基于 `main`（`53efb3fa`，
npm `next` `0.1.0-beta.93`）和 Cloud 仓库 `cea33ef6` 起草，并按同日评审修订；2026-11-16 基线更新为 npm `next`
`0.1.0-beta.94`（`f933d812`，Model v15 / Engine v12）。本文是计划，不是契约；落地后，契约内容进入
[兼容与版本演进](contracts/compatibility.md) 和 [Control API](contracts/control-api.md)。

## 目标

`engineContract` 只表示执行语义，包括 guest 可见接口。新增节点或配置这类由 Flow 内容显式启用的能力，由
`packages/open-flow` 中同一份推导函数判定，不再分配新的 Engine 修订。

Flow Model 版本只表示文档结构。新增节点类型、执行器或配置字段，由文档声明的特性列表判定，不再分配新的
Model 版本。旧客户端可以继续读写不使用新特性的 Flow。

Engine 能力和 Model 特性共用一个 Flow 特性注册表：新增一个功能，只在一处登记名称和推导规则。

分两个阶段：

- **第一阶段**：建立 Flow 特性注册表；统一能力推导与判定，冻结 `engineContract`；分配最后一次按功能升级的
  Model v16，此后文档携带特性列表；补齐 Cloud 发布路径的能力检查。能力集合完全由 contract 决定，部署不能
  收窄。
- **第二阶段**（可选）：允许 Cloud 执行发布声明自己支持的能力子集，见[第二阶段：部署收窄](#第二阶段部署收窄)。

不做：

- 不改变已发布 v6–v12 的含义、Run 身份或 runtime digest。
- 不在 Publication 和 Run 中持久化能力集合，不做数据库迁移。
- 不改写任何历史 Revision 的字节或 digest。
- 不为旧客户端提供只读打开含未知特性 Flow 的能力。
- 不让 guest Code 在运行时探测能力。

## 现状

### 线性版本承担了三件事

Engine 在 2026-10-20 到 2026-11-13 之间从 v6 升到 v12。每一版都是在上一版基础上打开一个开关：

| 版本 | 新增开关                                                 | 提交 |
| ---- | -------------------------------------------------------- | ---- |
| v6   | 节点重试与错误处理（语义变化）                           | #153 |
| v7   | `webhookResponses`、`waitAutoContinue`                   | #157 |
| v8   | `workflowTools`、`httpRequests`                          | #162 |
| v9   | `codeFetch`；guest `context.egress` 改为 `context.fetch` | #166 |
| v10  | `flowState`                                              | #167 |
| v11  | `connectorProxy`                                         | #181 |
| v12  | `delays`                                                 | #190 |

按 [版本规则](contracts/compatibility.md#release-baselines-and-contract-versioning)，需要“明确的能力拒绝边界”
时就要分配新修订。npm 几乎每天发布，未发布修订很少能复用，所以每加一个节点就升一版。同一个版本号同时承担了
三件事：

1. **执行语义**：同一份内容的执行结果和 guest 可见接口，例如重试、join、Wait 规则、`context.state`。
2. **能力拒绝**：旧 Engine 不能执行它不认识的节点。
3. **客户端与部署锁步**：客户端把包内的 `currentEngineContract` 发给 Server，本地 Server 要求它等于当前版本。

### 开关分为两类

现有 8 个布尔开关的读取方不同：

- `flowState`、`workflowTools`、`codeFetch` 决定 guest 接口：`context.state` 和 `context.dedupe`、
  `context.workflows`、`context.fetch` 或 `context.egress`。读取方有 Server
  `apps/server/node/runtime/isolated-vm-executor.ts`、`apps/server/node/application/run.ts`，Cloud
  `apps/executor/src/quickjs.ts`、`apps/cloud/src/runs/flow-state.ts`。即使 Flow 中没有对应节点，Code 也可以调用
  这些接口。
- `webhookResponses`、`waitAutoContinue`、`httpRequests`、`connectorProxy`、`delays` 只在
  `packages/open-flow/src/flow/common/semantics.ts` 的 `prepareFlow` 中读取，用来拒绝含对应节点或配置的 Flow。

前三个开关在 `prepareFlow` 中也有内容判定：带 `tool` 的 workflow 引用、Code 声明 `http` Capability、
`skip-duplicates` 执行器。

### 判定散落且不完整

- `prepareFlow` 用 8 段 `if` 判定，`validateFlow` 不做这些检查。
- 前五段在按 Trigger 裁剪子图之前检查，后三段（`webhookResponses`、`waitAutoContinue`、`delays`）在裁剪之后
  检查。
- Cloud 发布路径 `loadFlowValidation`（`apps/cloud/src/runs/validation-load.ts`）在没有 `triggerId` 时只调用
  `validateFlow`。部署门禁对保留 Publication 的复查（`apps/cloud/src/execution/compatibility.ts`）也只调用
  `validateFlow`。两处都不检查能力，能力不足要到执行准备阶段才会暴露。

### Model 版本让旧客户端打不开任何新保存的 Flow

Model 版本在同一时期从 v8 升到 v15，几乎和 Engine 同步，每加一个节点升一版。它的锁步比 Engine 更严重：

- **每次写入都升到当前版本。** Server 应用 Draft 变更时调用 `upgradeRevisionContent`
  （`apps/server/node/application/draft-control.ts`），把 `modelVersion` 改成包内的 `currentFlowModelVersion`。
  Cloud 的 Draft 写入同样如此。
- **旧客户端拒绝更新的版本。** Revision 解码只接受已知版本的字面量（`changeSchema.ts` 的 `revision` schema），
  Control API 响应解码失败时返回 `invalidResponse`。

结果是 Server 升级后，任何 Flow 只要被编辑保存过一次，旧 Workbench、CLI 和 MCP 就无法打开，不管它是否用了
新节点。

Model 版本实际承担了三件事：

1. **结构迁移**：`modelVersion < 6` 升级 Task 节点、`1`/`2` 升级旧文档、`manual` 改为 `start` 等。
2. **新特性门禁**：`checkModelVersion` 拒绝声明旧版本却含新节点的文档，例如 `modelVersion < 15` 不允许
   `delay`。
3. **保护未知内容**：`repairRevisionEnvelope` 会丢弃无法解码的集合条目，`modelVersion` 大于本包时直接拒绝，
   避免旧包把不认识的节点当作损坏数据删掉。

只有第 1 件需要线性版本。第 2、3 件可以改由特性列表承担。

## 第一阶段设计

### 语义与能力的区分

| 类别 | 判定标准                                                                                                | 处理                                             |
| ---- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| 语义 | 同一份 Revision 内容在新旧 Engine 上的执行结果不同，或 guest 可见接口不同（无论 Flow 是否使用对应节点） | 分配新的 `engineContract` 修订，沿用现有版本规则 |
| 能力 | 只有 Flow 内容显式使用（节点类型、执行器、配置字段、声明的 Capability）时才生效；不用时无影响           | 新增能力名，不改 `engineContract`                |

能力只增不减。已发布能力的名称和含义固定；要改变已发布能力的含义，属于语义变化。

按此标准回看：v7、v11、v12 只新增能力；v6 是语义变化；v8、v9、v10 两者都有，既新增了节点或配置，也改变了
guest 接口。以后新增能力若同时需要新的 guest 接口，仍然要分配新的语义修订。

### Guest 接口保留为语义

`EngineContract` 上的 `flowState`、`workflowTools`、`codeFetch` 原样保留，含义改为“该 contract 提供的 guest
接口”，随 contract 固定。Server、Cloud Executor 和宿主端 State 操作继续读取它们，不需要迁移。

`builtinModules`（`/nodejs-compat-v1`）和 `platformSource` 同样属于语义，保持不变。

### 能力名

能力名使用稳定的 kebab-case 字符串：

| 能力                 | Flow 内容中的触发条件                                                         | 引入版本 | 取代的开关                 |
| -------------------- | ----------------------------------------------------------------------------- | -------- | -------------------------- |
| `webhook-response`   | `webhook-response` 节点，或 Webhook `responseBody.kind == 'webhook-response'` | v7       | `webhookResponses`         |
| `wait-auto-continue` | Wait 节点设置了 `autoContinue`                                                | v7       | `waitAutoContinue`         |
| `workflow-tools`     | 节点引用中带 `tool` 的 workflow 引用                                          | v8       | `workflowTools` 的内容判定 |
| `http-request`       | `http-request` 执行器                                                         | v8       | `httpRequests`             |
| `code-http`          | Code Task 声明 `http` Capability                                              | v9       | `codeFetch` 的内容判定     |
| `skip-duplicates`    | `skip-duplicates` 执行器                                                      | v10      | `flowState` 的内容判定     |
| `connector-proxy`    | `connector-proxy` 执行器                                                      | v11      | `connectorProxy`           |
| `delay`              | `delay` 节点                                                                  | v12      | `delays`                   |

每个 contract 的能力集合是“引入版本不晚于它”的全部能力；`/nodejs-compat-v1` 变体与对应基础版本相同。这和现有
布尔开关的取值逐一等价。

### `packages/open-flow`：唯一所有者

在 `src/runtime/common/engineContract.ts` 和 `src/flow/common/semantics.ts` 中：

```ts
export interface EngineContract {
  readonly capabilities: ReadonlySet<EngineCapability>
  readonly flowState?: boolean
  readonly workflowTools?: boolean
  readonly codeFetch?: boolean
  readonly builtinModules?: ReadonlySet<string>
  readonly platformExports: ReadonlySet<string>
  readonly platformModule: string
  readonly platformSource: string
}

/** 从 Revision 内容推导所需能力。纯函数，结果排序且去重。 */
export function requiredEngineCapabilities(revision: RevisionContent): readonly EngineCapability[]

/** 返回 Revision 需要而 contract 不提供的能力。 */
export function missingEngineCapabilities(revision: RevisionContent, engine: EngineContract): readonly EngineCapability[]
```

- 删除 `webhookResponses`、`waitAutoContinue`、`httpRequests`、`connectorProxy`、`delays` 五个字段，由
  `capabilities` 取代。在 Server 和 Cloud 中，除 `semantics.ts` 外没有读取方。
- `prepareFlow` 删除 8 段 `if`，改为调用 `missingEngineCapabilities`。缺失时返回 `engine-unsupported`，并带上
  缺失的能力名。
- `validateFlow` 同样调用它。缺失时增加诊断 `engine.capability-unsupported`，`values.capabilities` 列出缺失的
  能力名，`valid` 为 `false`。Workbench 可以据此本地化提示；遇到未知诊断码时按现有规则回退到 `message`。
- **判定统一在 Trigger 裁剪之后进行。** 这是有意的行为变化：现在前五类能力在裁剪前检查，Trigger 运行时，
  所选 Trigger 不可达的分支如果使用了 contract 不支持的能力，也会阻断运行；修改后不再阻断。不带 Trigger 的
  发布和校验仍然检查整个图。
- `currentEngineContract` 保持 `open-flow-engine/v12`。以后不涉及 guest 接口的新增能力只加入 v12 的能力集合；
  下一次语义变化才分配 v13。
- 导出 `EngineCapability` 类型和上述函数，供 Server 和 Cloud 使用。

能力不持久化：Revision 内容不可变，推导结果确定。Publication、Run、发布操作表都不新增列。

### Flow 特性注册表

`packages/open-flow` 维护唯一的 Flow 特性注册表。每个条目包含：

- `name`：稳定的 kebab-case 名称，与 Engine 能力同名；
- `detect(revision)`：判断 Revision 是否使用该特性；
- `engine`：该特性是否需要 Engine 支持，以及从哪个 contract 起提供；
- `model`：是否属于 Model v16 基线。基线内的特性所有 v16 读者都认识，不写入文档的特性列表。

上文的 8 个 Engine 能力都是注册表条目，且都属于 Model v16 基线。`requiredEngineCapabilities` 从注册表推导，
不单独维护。

以后新增节点类型、执行器、Capability 种类或节点配置字段时，只在注册表登记一个条目：

- 需要 Engine 执行支持的，标记 `engine`；
- 只影响文档或编辑器的，例如纯展示字段，只作为 Model 特性。

**推导规则只增不改。** 新特性的 `detect` 只能匹配之前所有包都会拒绝的内容：新的节点 `kind`、执行器 `kind`、
Capability `kind`，或已有节点上的新字段。已发布特性的名称和 `detect` 不能修改。否则，新特性出现之前写入的
v16 文档会推导出它从未声明的特性，被解码规则第 3 条拒绝；同一份内容重新编码后的字节和 digest 也会改变。
Engine 能力“推导结果确定”同样依赖这条规则。

现有的 `checkModelVersion` 规则保留，用于读取 v11–v15 的历史文档，不再新增条目。

### Model v16：最后一次按功能升版

Model v16 是 v15 之后唯一一次 Model 修订，引入文档特性列表：

- **序列化形式增加 `features`。** Revision 信封字节、Control API 返回的 `content`、workflow 文件和 bundle 中的
  `content`，在 `modelVersion >= 16` 时必须带 `features: string[]`，可以为空数组。值是注册表推导出的、不在
  v16 基线中的特性名，排序且去重。
- **v15 及更早的编码逐字节不变。** 只有 `modelVersion >= 16` 的内容输出 `features`。Cloud 存储 Draft 时会用
  `encodeRevision(previous)` 重新编码上一版内容（`apps/cloud/src/control/drafts.ts`），Server 计算 digest 也依赖
  重新编码得到相同字节，历史内容的编码不能变化。
- **内存中的 `RevisionContent` 不带 `features`。** 解码器校验后丢弃，序列化时重新推导，避免同一份内容有两个
  来源。公共包提供唯一的序列化函数，`canonicalRevision` 和其他出口都使用它。
- **序列化出口由 conformance 用例约束。** Server 的 `revisionContent`（`apps/server/node/application/control-views.ts`）
  目前把解码后的对象直接放进响应，Cloud 的 API 响应也需要逐个核对。`controlConformanceCases` 增加一条用例：
  所有返回 Revision 内容的响应，在 `modelVersion >= 16` 时都带正确的 `features`。Server 和 Cloud 都运行这套用例，
  漏改的出口会直接失败。
- **解码规则：**
  1. `modelVersion` 大于本包：拒绝，行为不变。
  2. `features` 中有本包不认识的名称：拒绝，错误中列出这些名称；`revisionRepairKind` 返回 `undefined`，不提供
     修复。
  3. `modelVersion >= 16` 时，正常解码后推导出的特性必须是声明特性的子集，否则拒绝。这取代
     `checkModelVersion` 对新功能的作用。
  4. `modelVersion >= 16` 却缺少 `features`：接受。实现时发现，公共包、Server 和 Cloud 大量把内存中的内容和 workflow
     文件重新交给同一组解码器做规范化，要求必填会让这些路径全部失败。序列化出口是否带 `features` 改由
     `controlConformanceCases` 约束。
  5. `modelVersion <= 15` 的文档没有 `features`，继续由 `checkModelVersion` 检查。
- **修复流程不删除未知内容。** `repairRevisionEnvelope` 遇到上面第 2 条时直接拒绝。此外，遇到本包不认识的
  节点 `kind`、执行器 `kind` 或 Capability `kind` 时也拒绝，不当作损坏条目丢弃。这一条作为特性列表之外的
  兜底。
- **已退役的 kind 照旧丢弃。** 公共包维护已退役 kind 清单，例如被 `skip-duplicates` 原位替换、不提供迁移的
  `dedupe` 执行器。`repairGraph` 遇到清单内的 kind 时仍按损坏条目丢弃，保持现有的恢复路径；只有清单外的未知
  kind 才拒绝。以后退役一个 kind，需要同时把它加入清单。
- **之后的版本规则。** 只有需要迁移文档结构时才分配 Model v17，例如重命名字段、改变已有节点的数据形状。新增
  特性只登记注册表。
- **Control API 客户端的错误。** 解码器遇到未知特性时，返回携带特性名的明确错误，而不是 `invalidResponse`。
  Workbench、CLI 和 MCP 据此提示“此 Flow 使用了当前版本不支持的功能”，并给出特性名。
- **变更操作。** 旧 Server 收到新客户端的未知变更操作，`decodeChangeOperations` 已经会拒绝，行为不变。

Model v16 本身的特性基线与 v15 相同，只是信封增加 `features`。beta.94 及更早的包会以“模型比本包新”拒绝 v16
文档，这是最后一次 Model 锁步。

### 本地 Server（`apps/server`）

- 发布和草稿运行继续要求 `engineContract == currentEngineContract`（见[决策](#决策)第 1 条）。
  `currentEngineContract` 此后只随语义变化改变，新增能力不再导致客户端锁步。
- 通过检查后，由 `prepareFlow` 判定能力，check、发布和运行的错误响应带上缺失的能力名。
- 读取 `flowState`、`codeFetch` 的代码不变。
- `supportsIsolatedVmEngine` 的 contract × digest 白名单不变。runtime digest 继续标识隔离运行时实现；只有实现
  或环境变化时才新增 digest。

### Cloud（`~/oomol/open-flow`）

- 升级公共包依赖后，`validateFlow` 自动包含能力诊断，下列路径随之补齐检查：
  - 发布：`loadFlowValidation` 的无 Trigger 分支。遇到 `engine.capability-unsupported` 诊断时返回
    `engineUnsupported`，与 Trigger 分支和 Server 保持一致。
  - 草稿校验：`control/drafts.ts`。
  - 部署门禁对保留 Publication 的复查：`execution/compatibility.ts` 的 `check`。
- 带 Trigger 的分支和执行准备（`execution/revision-run.ts`）已经调用 `prepareFlow`，不需要修改。
- Executor（`apps/executor/src/quickjs.ts`）和 `runs/flow-state.ts` 读取的 guest 字段保留，不需要迁移。
- 新发布接受哪些 contract 维持现状：`selectEngine` 继续接受目录中 active 和 deprecated 的 contract。收窄到当前
  语义修订会拒绝目前仍可用的旧客户端，不在本计划内做；旧 contract 通过现有退役流程逐步移出目录。
- `requireDelayLimit` 这类 Cloud 自己的准入规则保持独立，不并入能力。

### 契约文档

- `docs/control/contracts/compatibility.md`：在“Release baselines and contract versioning”中加入语义与能力的
  判定标准，以及“已发布能力名和含义固定”的规则；新增一节记录本次变更，以 beta.94 为基线，写明删除的五个
  公共字段、新增的导出、裁剪后判定的行为变化。
- `docs/control/contracts/control-api.md`：check、发布和运行在能力缺失时的诊断与错误形状；更新仍写着
  `open-flow-engine/v8` 的示例。
- `docs/control/contracts/compatibility.md` 同时记录 Model v16：`features` 字段、解码与修复规则、此后只有结构
  迁移才升 Model 版本。
- `docs/control/contracts/control-api.md`：Revision `content` 中的 `features` 字段，以及未知特性的错误形状。
- `docs/authoring/node-authoring.md`：新增节点或配置时在特性注册表登记名称和推导规则；只有同时改变 guest 接口
  时才分配 Engine 修订，只有迁移文档结构时才分配 Model 修订。写明推导规则只增不改；退役 kind 时加入已退役
  清单。

## 兼容性

以 npm `next` `0.1.0-beta.94`（Model v15 / Engine v12）为基线：

| 场景                                                | 结果                                                                           |
| --------------------------------------------------- | ------------------------------------------------------------------------------ |
| 已发布 v6–v12 的 Publication、Run、checkpoint       | 能力集合与原开关等价，guest 接口和 digest 不变                                 |
| 已发布 v6–v11 的 Trigger Run                        | 所选 Trigger 不可达的分支不再因能力不足阻断运行                                |
| 发送 v12 的客户端连新 Server                        | 可用；Flow 需要 Server 不支持的能力时拒绝并说明缺失能力                        |
| 发送 v11 及更早的客户端连新 Server                  | 与现在相同：本地 Server 拒绝新发布和草稿运行；Cloud 按目录接受，直到该版本退役 |
| beta.94 及更早的客户端读取 v16 文档                 | 以“模型比本包新”拒绝。这是最后一次 Model 锁步                                  |
| v16 客户端读取不含新特性的 v16 文档                 | 可用，包括被更新的 Server 编辑保存过的文档                                     |
| v16 客户端读取含未知特性的文档                      | 拒绝并列出未知特性名，不会修复或删除内容                                       |
| 新客户端连旧 Server，Flow 含旧 Server 不认识的特性  | 旧 Server 解码时拒绝，不会误执行或删除内容                                     |
| 新客户端连旧 Server，Flow 不含新特性                | 可用，前提是两端都不低于 Model v16 和 Engine v12                               |
| 历史 Revision 字节（v15 及更早）                    | 不改写，重新编码逐字节不变；下次编辑保存时升级为 v16 并带上 `features`         |
| 含已退役 kind（如 `dedupe`）的 Flow                 | 修复流程照旧丢弃这些节点，恢复路径不变                                         |
| workflow 文件和 bundle                              | 文件 `version` 保持 1；beta.94 及更早的包因内含 `modelVersion: 16` 拒绝导入    |
| guest 读取 `open-flow:platform` 的 `engineContract` | 保持 `open-flow-engine/v12`，此后只随语义变化改变                              |

本计划去掉的是“新增功能带来的客户端锁步”，不是所有锁步：

- 下一次语义变化分配 Engine v13 后，本地 Server 只接受 v13 的新发布和草稿运行，发送 v12 的客户端需要升级。
- 下一次结构迁移分配 Model v17 后，v16 客户端无法读取 v17 文档。
- 新增功能仍然要求先升级 Server 和 Cloud，再使用该功能；Flow 用到新功能后，旧客户端无法打开它。

公共包删除 `EngineContract` 的五个布尔字段，是公共类型的不兼容变更，需要在兼容记录中写明。本变更不改变任何
已发布 contract 的执行含义，不需要新的 Engine 修订。Model v16 是新的 Model 修订：beta.94 已发布 v15，v16 在
发布前可以继续容纳本计划内的其他文档变化。

## 落地步骤

1. **公共包**：
   - 建立 Flow 特性注册表；增加 `EngineCapability`、`capabilities` 集合、`requiredEngineCapabilities` 和
     `missingEngineCapabilities`；重构 `prepareFlow` 与 `validateFlow`；删除五个内容开关。
   - 分配 Model v16；增加 `features` 的序列化、解码和修复规则；Control API 解码器返回未知特性错误；Workbench
     显示该错误。
   - 更新契约文档。

   验证：
   - 现有 `bun run test`；
   - v6–v12 及 `/nodejs-compat-v1` 每个 contract 的能力集合与原开关等价；
   - 每种触发条件的推导；
   - 所选 Trigger 的子图使用缺失能力时拒绝，只有不可达分支使用时允许；
   - `validateFlow` 的能力诊断；
   - v15 及更早文档读取后内容不变，编辑后升级为 v16 并带上正确的 `features`；
   - v15 及更早的内容重新编码后逐字节不变；
   - 用原始信封模拟“新包写入、旧包读取”，不为测试注入注册表：`features` 含未知名称、节点含未知 `kind` 时拒绝
     并列出名称，`revisionRepairKind` 返回 `undefined`，修复流程不删除内容；
   - 含已退役 `dedupe` 执行器的文档仍可修复，节点被丢弃；
   - v16 文档声明特性少于推导特性时拒绝；
   - workflow 文件和 bundle 的导出带 `features`；
   - `controlConformanceCases` 新增的 `features` 用例；
   - `bun run --filter @oomol-lab/open-flow test:package`。

2. **本地 Server**：错误响应带上缺失能力名；Revision 和 Draft 响应经由公共包的序列化函数输出。
   验证：缺失能力时 check、发布和运行被拒绝并列出能力名；v11 Publication 的 Run 仍可执行和恢复；v15 Draft
   编辑后为 v16；`controlConformanceCases` 通过；`apps/server` 测试全部通过。
3. **Cloud**：升级公共包依赖；发布无 Trigger 分支映射能力诊断为 `engineUnsupported`；Revision 写入 R2 和 API
   响应经由公共包的序列化函数。`model_version` 列和各处 `modelVersion` 相等检查不变。
   验证：Cloud 和 Executor 单元测试；发布含 contract 不支持能力的 Flow 时在发布阶段被拒绝；v15 Revision 的
   保留复查通过，Draft 增量存储的上一版字节不变；`controlConformanceCases` 通过；`release-smoke`；
   `verify-retained`。
4. **新增功能流程**：更新 `node-authoring.md`。

第 1 步发布后，第 2、3 步可以分别进行。Server 和 Cloud 升级后开始写入 v16 文档，此时 beta.94 及更早的客户端
打开被编辑过的 Flow 会被拒绝。这是最后一次 Model 锁步，发布说明需要提示客户端同步升级。

## 第二阶段：部署收窄

第一阶段不解决“Cloud 已升级公共包，但还没接入某个新节点”的情况。现在的做法是 Cloud 在准备好之前不升级
公共包依赖；部署门禁要求控制面和执行端 `packageVersion` 一致，这个做法是安全的。只有需要在升级依赖的同时
暂缓某个能力时，才实施第二阶段。

设计要点：

- **可收窄的范围。** 只有宿主实现与 guest 接口无关的能力可以收窄：`webhook-response`、`wait-auto-continue`、
  `http-request`、`connector-proxy`、`delay`。`workflow-tools`、`code-http`、`skip-duplicates` 与 guest 接口共用
  宿主实现，关闭它们会改变同一 contract 下已发布的 guest 接口，不允许收窄。
- **能力写入执行发布元数据。** `ExecutionRelease`（`apps/cloud/src/protocol/execution-releases.ts`）按 contract
  记录支持的能力。历史发布没有这个字段时，按该 contract 的完整能力集处理：按旧规则，声明支持某个 contract
  就意味着完全支持，补全不会丢失信息。
- **按最终选中的发布判定。** `runs/admission.ts` 现在只用选中发布的 `engineContracts` 重建
  `EngineImplementation`，需要带上该发布的能力集合；执行发布切换导致 CAS 重试时，每次都重新判定。
- **两条验证路径都接收支持集合。** `loadFlowValidation` 的有 Trigger 和无 Trigger 分支都要接收有效支持集合，并
  对所选子图判定。验证缓存的 key 需要包含支持集合，或者把部署能力判定放在缓存结果之外。
- **部署门禁。** `executionInputContract()` 和 `ExecutionCompatibility.identity()` 增加按 contract 分组的能力集合；
  控制面每个 contract 的能力必须是执行端对应能力的子集。
- **公共包。** `missingEngineCapabilities` 增加可选参数 `supported`，`prepareFlow` 和 `validateFlow` 透传。

验证需要覆盖：选中分支使用被收窄的能力时在准入阶段拒绝；只有未选中分支使用时允许；执行发布切换后按新发布
重新判定；历史发布元数据缺少能力字段时按完整集合处理。

## 决策

2026-11-13 确定：

1. **新发布只使用当前语义修订。** v6–v11 只为已有 Publication 和 Run 保留，新发布没有理由选择旧语义。客户端
   固定发送当前语义修订；`currentEngineContract` 不再随新增能力变化，所以本地 Server 保留现有的
   `== currentEngineContract` 检查即可。语义修订升级后，旧客户端的新发布会被拒绝。另一个选择是接受所有已知
   且未退役的 contract，未采用。Cloud 目前接受目录中的所有 contract，本计划不收窄，以免拒绝仍在使用的旧
   客户端；收窄交给现有退役流程。
2. **请求中的 `engineContract` 保持必填。** 不改为由部署选择的可选字段，请求形状不变。
3. **第一阶段不做部署收窄。** 能力集合完全由 contract 决定。部署收窄放在第二阶段，能力写入执行发布元数据，
   不写在 `engine.ts` 代码中。
4. **Guest 接口属于语义。** `flowState`、`workflowTools`、`codeFetch` 保留为 contract 的语义字段，不能通过能力
   集合关闭。

5. **Model 版本一并处理。** 分配 Model v16，引入文档特性列表；此后只有结构迁移才升 Model 版本。Engine 能力和
   Model 特性共用一个注册表。
6. **特性列表只存在于序列化形式。** 内存中的 `RevisionContent` 不带 `features`，解码校验后丢弃，序列化时重新
   推导。Publication、Run 和数据库都不新增字段。序列化出口由 `controlConformanceCases` 约束，不把派生字段放进
   `RevisionContent` 类型。
7. **特性推导只增不改，已退役 kind 单独登记。** 新特性只能匹配旧包会拒绝的内容；修复流程只对已退役清单内的
   kind 保持丢弃，其余未知 kind 一律拒绝。
