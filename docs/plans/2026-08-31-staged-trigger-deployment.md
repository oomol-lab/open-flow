# Trigger Publish Operation 与发布成功语义 Spec

## 1. 决策

Open Flow 将 authoring completeness 与 publish readiness 分开：Integration Trigger 和 Connector-backed
Task 默认都可以进入图、保存到 Draft；没有 Connection 时，Designer 在节点上显示诊断并引导用户连接。

Publish 必须 fail closed。需要创建或准备的 Trigger 资源没有全部成功时，本次 Publish 不能创建
Publication、不能移动 Live，旧 Live 必须继续工作。Publication 只表示一次已经完整成功的发布，不承载
`pending` 或 `failed` 状态。

为支持外部系统的异步调用，Publish 由一个持久化的 publish operation 表达。只有真正需要异步或外部准备的
节点才创建内部 Trigger work；当前 Trigger binding 继续作为 Live 和 Run admission 的权威状态。首版不建立
通用 Deployment 平台，也不把所有 Trigger 统一建模为 candidate/current/retired generation。

本文使用“publish operation”和“Trigger work”描述产品概念，不预先确定导出的 TypeScript 类型名。实现若要新增
类型或接口，需按仓库规则先确认名称。

## 2. 不可妥协的语义

- 未连接节点可以进入图、编辑和保存 Draft。
- Connection 缺失或失效时，Publish validation 必须失败并定位到具体节点。
- 拖入节点、编辑节点和保存 Draft 都不能创建第三方 Trigger 资源。
- 必需 Trigger 资源只在 Publish 或受支持的 Rollback 边界准备。
- 必需资源未 Ready 时，不创建 Publication、不移动 Live、不开放候选事件的 Run admission。
- Publish 失败时，旧 Live 不变；已经创建的候选外部资源进入异步清理。
- Publish 成功后的 provider outage 或 Connection 失效只影响 Live health，不修改历史 Publication。
- 外部请求不进入本地数据库事务。最终成功由持久化 operation、幂等 work 和 Live compare-and-swap 共同保证。

## 3. 目标与非目标

### 3.1 目标

- 节点目录不再依赖用户当前已有的 Connection。
- Designer 对未连接节点提供稳定诊断，不产生重复请求或 React 更新循环。
- Publish 请求在跨请求、进程重启和短暂 provider 故障后仍可恢复。
- 同一请求重试返回同一个 operation；不同 Publish 不会意外覆盖彼此。
- 新 Integration subscription 和 Poll baseline 可以在切换 Live 前完成。
- 候选 callback、Cron claim 或 Poll claim 在 Live 激活前不能创建 Run。
- 用户能看到 Publishing、Published 或 Failed，并知道失败节点和下一步操作。
- 不支持安全 staged update 的 Integration 变更明确失败，不静默修改当前 Live 资源。

### 3.2 非目标

- 不新增通用工作流引擎、队列或跨产品 deployment framework。
- 不为所有 Trigger 建立统一 generation、target 或 ingress capability 模型。
- 不要求首次业务事件、首次正常 Poll occurrence 或首次 Run 成功后才算 Ready。
- 不把第三方 provider 与本地 store 包装成分布式事务。
- 不在首版实现 provider 通用补偿、任意 Integration 热替换或完整 Rollback 能力矩阵。
- 不新增发布历史产品页、逐节点时间线或清理进度 UI。
- 不用 Error Boundary 掩盖 Designer 的 maximum update depth；更新循环必须按真实根因修复。
- 不顺手重构无关 Connector、Store、Workbench 或 scheduler 代码。

## 4. Authoring 与 Connection

### 4.1 节点目录

节点目录以 Connector 或 Integration definition 为事实来源，不以当前 Connection 列表为事实来源。
Connection 是节点配置，不是 definition 的存在条件。

拖入 Connector-backed 节点时：

- 保存完整 definition snapshot；
- Connection binding 可以缺失；
- 缺失 binding 是合法 Draft state，并进入 Revision 内容；
- Connection picker 成功后创建或替换 binding，不能假设它已存在；
- Connection 被撤销或删除后保留节点和 snapshot，只恢复诊断状态。

### 4.2 诊断与发布校验

| 状态                        | Designer        | 保存 Draft | Publish               |
| --------------------------- | --------------- | ---------- | --------------------- |
| 未选择 Connection           | Warning，可连接 | 允许       | validation 失败       |
| Connection 已选择但授权失效 | Warning，可重连 | 允许       | eligibility 失败      |
| Connection 与配置有效       | Ready           | 允许       | 继续 Publish          |
| 发布后 Connection 失效      | Live degraded   | 不修改历史 | 后续 Publish 重新校验 |

普通 Connector Task 不在 Publish 时创建长期第三方资源。它只需要通过 definition、binding、Connection 和
capability 校验；实际业务请求仍在 Run 中执行，并承担运行期失败。

Designer 必须覆盖以下回归行为：Connection 查询返回 404/503 或节点没有 Connection 时，只产生一次稳定状态变化，
不能形成重复网络请求、重复 store 写入或 maximum update depth。

## 5. 最小产品模型

### 5.1 Publication 与 Live

Publication 仍是固定 Revision 的不可变成功记录。它只在 publish operation 最终激活事务内创建。

operation 处于 pending 时：

- 首次发布的 Flow 仍没有 Live；
- 更新发布的 Flow 继续运行旧 Publication；
- Workbench 可以展示正在发布，但不能把目标 Revision 展示为 Live；
- 后续 Draft 修改不改变本次已经固定的 Revision 和 closure。

### 5.2 Publish operation

一条 operation 只保存完成这次 Publish 所需的权威信息：

- operation identity；
- Flow、Revision、Revision digest、closure digest 和 engine contract；
- 请求时的预期 Live Publication identity；
- idempotency key 和 request digest；
- `pending | succeeded | failed`；
- 成功后的 Publication identity，或失败后的安全 issue；
- 创建、更新时间和幂等保留期限。

validation 在接受 operation 前完成。operation 一旦建立，异步 runner 只处理固定输入，不重新读取可变 Draft。

用户可见失败 issue 首版只需要：

- node identity；
- 稳定错误码；
- 可安全展示的消息。

原始 provider response、credential、内部堆栈和 retry 细节不进入公共结果。

### 5.3 Trigger work

只有需要跨事务、可重试准备的动作才创建 work，例如：

- 为新的 Integration Trigger 创建 subscription；
- 为 Poll Trigger 建立初始 checkpoint；
- 在 provider 创建 subscription 前准备一个新的 callback endpoint；
- Publish 成功或失败后删除不再需要的外部资源。

work 固定 operation、node、action、Trigger kind、Connection、配置和必要 endpoint，状态保持为
`pending | ready | failed`，并可保存 provider state、checkpoint、`nextAt` 和安全错误。

不要为以下动作创建抽象 work 或 generation：

- 单纯的同步 validation；
- Webhook/Cron 的普通本地配置写入；
- 可以从权威 store 重建的 scheduler 派生索引；
- 与当前 Live 完全相同、可直接复用的 Integration subscription。

### 5.4 当前 binding

当前 Trigger binding 继续拥有 Live 运行所需的权威状态，包括当前 Publication、固定 snapshot、Connection、
endpoint/verifier、provider state、checkpoint 和 runtime version。

endpoint 由 binding 拥有，不是独立资源类型。built-in Webhook endpoint 保持稳定；Integration 在远端资源未替换时复用
现有 endpoint。provider-specific staged replacement 可以使用新的候选 endpoint，并在 activation 时把它安装为 current；
因此 Integration endpoint 不是跨所有 Publication 永不变化的 identity。无论是否轮换 endpoint，同一 endpoint 上的两份
provider subscription 都不会自动变得可区分。

激活事务把 Ready work 的结果安装到当前 binding，并同时开放新 Publication 的 admission。旧外部资源的删除在事务后异步执行。

## 6. Publish 流程

### 6.1 接受请求

同步入口执行：

1. 先按 client/idempotency identity 查找已有 operation；匹配的重放直接返回已有结果。
2. 固定 Revision、完整 closure 和 engine contract，并计算 request digest；同 key 对应不同输入时返回 conflict。
3. 运行结构、Connection binding 和 eligibility validation。
4. 创建 operation 和必要 work。
5. 返回 operation identity 和当前状态。

未连接、Connection 不可用或 snapshot 不完整时直接返回 validation issue，不建立会永远失败的 operation。

### 6.2 幂等与并发

同一个 Flow 首版最多有一个 pending publish operation：

- 相同 idempotency key 且 request digest 相同，返回原 operation；
- 相同 key 但 digest 不同，返回 idempotency conflict；
- 不同 key 但已有 pending operation，返回 busy/conflict；
- 已结束 operation 在有限幂等窗口内保持可查询和可重放结果。

即使限制为一个 pending operation，最终激活仍必须比较预期 Live identity。Rollback、Flow retirement 或其他权威写入仍可能在
operation 执行期间改变 Live。

### 6.3 规划 work

runner 根据固定 Revision 和当前 binding 得到最小动作：

| 变化                                                  | 首版动作                                                     |
| ----------------------------------------------------- | ------------------------------------------------------------ |
| 新 Integration Trigger                                | 准备 endpoint（若需要），创建 subscription work              |
| Integration snapshot、Connection 和远端 spec 完全未变 | 复用当前 subscription，不创建 prepare work                   |
| 已有 Integration 的远端 spec 变化                     | 只有 provider 明确支持独立候选 endpoint 时才可准备；否则失败 |
| 新 Poll Trigger                                       | 执行 baseline work                                           |
| Poll 配置或 Connection 变化                           | 重新执行 baseline work                                       |
| Webhook/Cron 本地配置变化                             | validation 后在激活事务提交                                  |
| 删除 Trigger                                          | 激活后异步清理旧外部资源                                     |

“完全未变”由现有固定 snapshot、Connection 和 endpoint spec 的精确比较决定。首版不新增 provider equivalence hook 或通用 fingerprint。

### 6.4 准备资源

runner 只领取到期的 pending work，并以 operation/node/action 为幂等边界调用 provider。

每次尝试必须满足：

- 已经 Ready 的 work 不重复创建资源；
- transient failure 更新 `nextAt` 后重试；
- permanent failure 把 work 和 operation 标为 failed；
- provider create 成功但本地确认失败时，下次通过固定 idempotency/adoption identity 找回同一资源；
- operation 已 failed、Flow 已退休或输入不再允许激活时，不继续创建资源，并安排已有候选资源清理。

### 6.5 激活

所有必需 work Ready 后，执行一个本地事务：

1. 确认 operation 仍为 pending。
2. 确认 Flow 未退休，预期 Live identity 仍匹配。
3. 创建唯一 Publication。
4. 更新 Live pointer。
5. 将 Ready work 的 provider state、endpoint 或 checkpoint 安装到当前 binding。
6. 更新所有当前 binding 的 Publication/runtime version/admission 状态，并保留 operator pause。
7. 将 operation 标为 succeeded 并记录 Publication。
8. 写入旧外部资源的 cleanup work。

事务外不调用 provider。事务失败时不产生部分激活；CAS 冲突使 operation failed，旧 Live 保持权威。

### 6.6 失败与清理

任一必需 work permanent failure 或超过期限时：

- operation 变为 failed；
- 不创建 Publication、不移动 Live；
- 当前 binding 不变；
- 已创建的候选资源进入 cleanup work；
- cleanup 失败只进入内部重试和运维观测，不改变 operation 的最终结果。

cleanup 也必须幂等。删除结果为 not found 应视为完成；清理不得根据可变 Draft 推断目标。

## 7. Trigger 类型规则

### 7.1 Integration Trigger

现有 Integration 合同已经提供两类必要控制：

- reconcile 的 `active` 控制外部资源建立或删除；
- receive 的 `admit` 与 `current` 控制 callback 是否可以创建 Run。

首版复用这些合同。候选准备可使用固定的候选 state/endpoint 调用 `reconcile(active: true)`；激活是本地 binding/admission 切换；
旧资源清理使用旧 state/endpoint 调用 `reconcile(active: false)`。不增加 `prepare/activate/retire` 公共生命周期。

候选 callback 即使通过网络到达，也必须在 admission boundary 返回成功或安全拒绝，但绝不能创建 Run。

#### 稳定 endpoint 限制

稳定 endpoint 只能证明路由 identity 稳定，不能证明 callback 属于当前 subscription 还是候选 subscription。因而首版禁止假设
“同一个稳定 endpoint 上 current 和 candidate 可以并行且可区分”。

首版支持矩阵：

| 场景                                                        | 行为                                       |
| ----------------------------------------------------------- | ------------------------------------------ |
| 新 Integration 节点                                         | 使用新的/唯一候选 endpoint，准备成功后激活 |
| snapshot、Connection、远端 spec 未变                        | 复用当前 subscription                      |
| Provider 支持独立候选 endpoint 且 callback 可明确路由到候选 | 可按 provider 能力实现 staged update       |
| Provider 只支持 singleton 或同一稳定 endpoint               | 拒绝该更新，旧 Live 不变                   |

不得通过先修改当前 provider resource、失败后再“尽量补偿”的方式实现 Publish。

### 7.2 Poll Trigger

新 Poll 或 Poll 配置/Connection 变化时，在候选 work 中调用现有 poll 合同并传入空的候选 checkpoint：

1. 执行 baseline poll，并把每一页返回的 continuation checkpoint 持久化到 work。
2. `hasMore` 为 true 时，使用同一固定 snapshot、Connection 和候选 checkpoint 继续下一页；崩溃后从已保存 checkpoint 继续。
3. 每一页都丢弃返回事件，不创建 Run、不写 dedupe。
4. 只有最终 `hasMore != true` 时 work 才能 Ready。
5. 激活事务将最终 checkpoint 安装到当前 binding。
6. 激活后的正常 Poll 才允许创建 Run。

baseline failure 阻止 Publish。首版不新增公共 `requiresBaseline` phase；除非未来某个 definition 有明确相反语义，所有新建或变更的 Poll
都走相同 baseline。

### 7.3 Cron 与 scheduler

Cron 的权威 schedule 在激活事务写入当前 binding。scheduler index 是可重建的派生状态，不作为 Publish readiness gate。

激活后由现有 reconciliation 更新派生索引。旧 scheduler claim 通过当前 Publication/runtime version/admission 校验 fail closed。
首版不预装 candidate schedule，也不引入多 generation scheduler。

### 7.4 Webhook 与 endpoint

如果 provider 在创建 subscription 前必须获得 callback endpoint，新的 endpoint route 必须先可解析到候选 binding，并且默认不准入 Run。
这属于对应 Integration work 的准备步骤，不建立独立 ingress capability 生命周期。

已有 endpoint 被复用时，仍受 Integration 支持矩阵约束；路由可达不等于 current/candidate callback 可区分。provider-specific
replacement 轮换 endpoint 时，activation 必须同步关闭 old endpoint 的 admission；即使旧 subscription 尚未删除，延迟 callback
也必须 fail closed，且不能按新 current config 解释。

## 8. API 与 Workbench

### 8.1 最小公共能力

公共 API 只需要：

- 发起 Publish，接受 idempotency key；
- 读取 operation；
- 在 operation succeeded 后读取 Publication/Live；
- 在 operation failed 后返回一个安全 issue。

概念返回值包含：

- operation identity；
- `pending | succeeded | failed`；
- 成功时的 Publication identity；
- 失败时的 node/code/message。

具体路由、字段名、状态码和序列化合同在实现时写入相应技术参考，不由本计划提前冻结。

### 8.2 Workbench 行为

- Publish 接受后显示 Publishing，并轮询或订阅 operation 状态。
- pending 期间继续明确展示旧 Live；首次发布则明确显示尚未上线。
- failed 显示失败节点、可理解原因和连接/重试入口，不显示 provider 原始错误。
- succeeded 刷新 Publication、Live 和节点状态。
- 刷新页面后能用 operation identity 恢复当前结果。

首版不展示逐 Trigger 百分比、retry 时间线、cleanup 状态或长期失败历史页。

## 9. Rollback 与 Flow retirement

Rollback 最终也不能绕过 readiness，但首版只承诺安全子集：

- 不需要新外部资源、能够直接复用现有可验证资源时，可以复用 publish operation；
- 需要重新创建或替换 Integration subscription、且 provider staged 能力尚未证明时，返回 unsupported/conflict；
- 不实现 provider 通用回滚补偿或 checkpoint 迁移。

Flow retirement 期间：

- pending operation 不得激活；
- operation 变为 failed；
- 候选外部资源进入 cleanup；
- 当前 Live 按现有 Flow retirement 语义处理。

首版不增加复杂 cancel 状态机或逐阶段 retirement 矩阵。

## 10. 可观测性与保留

operation 和 work 必须有结构化内部日志与指标，至少覆盖：

- pending operation 数量与年龄；
- work attempt、ready、permanent failure 和 retry；
- provider create/adoption/delete 结果；
- Live CAS conflict；
- 被 admission fence 拒绝的 callback/claim；
- cleanup backlog。

operation 在有限幂等窗口内保留，使客户端重试能得到确定结果。窗口结束后可以停止公共查询，但只要仍有未完成 work，
operation 及删除所需的固定 state 就不能物理清理。所有 work terminal 后才可按现有数据保留机制清理；这不是发布历史产品。

日志不能记录 token、provider secret、完整 callback payload 或原始敏感错误。

## 11. 验证边界

公共包的黑盒 conformance 只验证用户可观察语义：

- 未连接节点可进入 Draft、可保存，但 Publish validation 失败。
- Connection 查询失败不会引发无限 render 或请求循环。
- pending operation 不创建 Publication、不移动 Live。
- permanent resource failure 保留旧 Live。
- successful operation 只创建一个 Publication。
- 相同 idempotency 请求返回同一 operation 和结果。
- candidate callback 不创建 Run。
- 激活后的 callback 固定到新 Publication。
- 对已启用 staged replacement 的 provider，old endpoint 在激活后不创建 Run，也不按新 current config 解释。
- Poll baseline 丢弃事件并把 checkpoint 安装到激活后的 binding。
- 不支持安全 staged update 的 Integration 变更 fail closed。

具体部署实现负责白盒验证 authority store、runner recovery、workload identity、scheduler 重建、cleanup recovery 和运维告警。

## 12. 实施切片

### Slice 1：Authoring

- 节点目录与 Connection 解耦。
- 未连接节点可以拖入、保存和重新连接。
- 完成 Designer 诊断及 maximum update depth 回归测试。
- Publish validation 对缺失/失效 Connection fail closed。

### Slice 2：最小异步 Publish

- 增加持久化 operation 与最小 API。
- 支持一个合成异步 work，证明 pending 不移动 Live、失败保留旧 Live、成功只创建一个 Publication。
- Workbench 展示 Publishing/Failed/Published。

### Slice 3：Integration 最小闭环

- Provider 能力 spike 先确认 endpoint、create idempotency、adoption 和 delete 行为。
- 支持新 Integration subscription。
- 支持完全未变资源的复用。
- 对不安全的已有 Integration 变更 fail closed。
- 验证候选 callback admission fence 和 cleanup recovery。

### Slice 4：Poll baseline

- 新建/变更 Poll 执行 baseline。
- 丢弃 baseline events，激活时安装 checkpoint。
- 覆盖 crash retry、permanent failure 和 old Live 保留。

### Slice 5：Provider-by-provider 扩展

- 只为实际支持独立候选 endpoint 的 provider 增加 Integration republish。
- 用测试证明 callback 可以明确归属候选后才开放。
- 验证 activation 同步关闭 old endpoint admission，remote cleanup 延迟时 old callback 仍 fail closed。
- 根据真实需求扩展安全 Rollback；不预建通用能力矩阵。

## 13. 完成条件

- Integration Trigger 和 Connector-backed Task 无 Connection 时仍可见、可拖入、可保存。
- 未连接和 Connection 请求失败不会导致 React 更新循环。
- Publish 失败前后都没有错误的 Publication 或 Live 移动。
- 新 Integration 资源创建失败时，operation failed，旧 Live 继续工作。
- Poll baseline 失败时 Publish failed，baseline event 永不创建 Run。
- 幂等重试、进程崩溃恢复和 Live CAS 有确定结果。
- 候选 callback、旧 runtime claim 和失效 scheduler claim 都不能误建 Run。
- 清理可以最终恢复，但不改变已经确定的 Publish 结果。
- 不支持安全 staged update 的 provider 被明确拒绝，而不是修改当前 Live。
- 公共文档不暴露部署实现的私有基础设施。

## 14. 明确删除的设计

首版不实现或不承诺：

- 通用 Deployment resource 和多阶段顶层状态；
- 所有 Trigger 的 candidate/current/retired target；
- 独立 stable ingress capability resource；
- 通用 `prepare/activate/retire` Integration API；
- 同一稳定 endpoint 上的 current/candidate 并行 subscription；
- 多个并发候选 Publish 及 CAS loser 补偿；
- candidate scheduler index 和多 generation scheduler；
- provider equivalence hook、通用 fingerprint 或补偿框架；
- Publication 前的逐节点进度产品、失败历史页和 cleanup UI；
- 为未来可能性预建的 Workflow、队列或状态机。

这些能力只有在真实 provider 合同或运行数据证明最小模型不足时，才单独提出并设计。
