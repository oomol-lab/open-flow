# Provider Access Binding 接入计划

状态：已完成独立安全与生命周期 review，可作为公共合同和部署实现的实施基线。

开源实现状态（2026-09-20）：公共 Control API、strict decoder、错误与通知、deployment host、OpenConnector implicit adapter、OOMOL-hosted selectable
adapter、聚合 access context、Publish/Rollback/Run/Wait/Trigger snapshot、Flow 删除钩子、Workbench 设置、宿主导航钩子、Lab states、Code 动态
Capability 和 implicit/selectable conformance 已实现。托管 adapter 用 OOMOL profile UID 校验当前用户可分配的 Team app-access，并在本地持久化 opaque
binding；Connector 的幂等 create/cleanup receipt/retire 协议仍属于闭源 Cloud 与 Connector 实现。

产品与架构边界以 [`architecture.md`](../architecture.md) 为准，精确 HTTP 与 serialized contract 以
[`control-api.md`](../control/contracts/control-api.md) 为准。本文只记录实施顺序、迁移范围和验收条件。

## 1. 结论

Flow 对 Connector 的授权统一改为 **Provider Access Binding**：每个 Flow 按 Provider 保存一组由部署侧 Connector
拥有的 opaque Connection access bindings。托管部署把每项实现为一个 Connection 及用户可分配给 Flow 的权限组；OpenConnector 首期把部署配置的 scoped runtime token
暴露为唯一的隐式 binding。

权限判断只发生在 Connector 所有的授权边界。Open Flow 不解析权限组规则，不保存 credential，不把 Connection ID、Action 声明或 Code
节点配置当作授权来源。

目标行为是：

- Code 节点默认可以动态调用 binding 当前允许的任意 Connector Action，不要求节点级开关或逐 Action/Connection 白名单；
- Connector 节点、Agent Tool、通知、Poll、Integration 和其他 Connector 消费者服从同一 binding；
- Connection ID 只表达“调用哪个账号或应用”，能否看到和使用该 Connection 由 binding 决定；
- 一个 Flow 对同一 Provider 可以保存多个 Connection binding；当前策略为每个 Connection 只返回操作者可分配的那一个候选权限组；
- 不创建 Flow service account，不把用户 token 或 workload token 持久化到 Flow；
- binding 缺失、失效、删除或与 Provider 不匹配时 fail closed，不回退到 Team 默认权限或部署 token。

## 2. 为什么不采用 Code 节点白名单

Code 节点级 `actions` 或 `connections` 白名单会与部署权限形成两个授权来源，产生三类问题：

1. Flow 作者需要重复维护同一权限，动态 Action 也无法自然表达；
2. Connector 节点、Agent、Trigger 与 Code 会得到不同的权限语义；
3. 白名单只能限制用户声明的 ID，不能替代 Connector 对 credential、Connection 状态和当前策略的校验。

因此，现有 `ConnectorCapability.connections` 只作为迁移输入，不能继续成为目标运行时的 Action/Connection 授权合同。所有 Code Task 默认获得
Connector API；`capabilities` 只保留非授权的 Action typing 与 alias/default Connection 提示。

## 3. 术语与所有权

### 3.1 Provider Access Binding

Provider Access Binding 是部署中立的 opaque 引用，由 `(providerId, accessBindingId)` 标识：

- `providerId` 使用 Connector 的稳定 Provider/Service identity；
- `accessBindingId` 只用于选择部署侧已有权限边界，不是 credential，也不能由浏览器自行声明即获得权限；
- 连接名称、权限组名称、状态和策略版本是展示投影，不成为授权事实；
- binding 的成员、Action、Connection、proxy 和 Provider-specific 规则完全由 Connector 拥有。

Workbench 只展示部署返回的候选项和有效状态。公共包不认识 OOMOL role、app access、Team token 或某一种 OpenConnector token schema。

### 3.2 两种部署能力

部署通过 Control API 明确返回一种 access mode：

| 模式         | 作者体验                                          | 部署行为                                                                                     |
| ------------ | ------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `selectable` | 为 Provider 选择一个或多个可用 Connection binding | 校验操作者有权把候选 binding 分配给该 Flow，并为后台 workload 按目标 Connection 解析 binding |
| `implicit`   | 不显示权限组选项，只显示权限由部署管理            | 所有调用使用部署已配置的 scoped Connector authority；`accessBindingId` 不进入 Flow 数据      |

OpenConnector 首期只实现 `implicit`。如果以后确有多个 token/profile 的需求，再让 OpenConnector 实现 `selectable`；本计划不预留 Flow
service account、任意 token 输入框或多 binding alias。

### 3.3 数据归属

- Revision 继续只保存可移植的 graph、Task、binding 和 Code source，不保存 Provider Access Binding；
- Flow 的 Draft access set 是 deployment-scoped authoring state；
- Publication 固定发布时的 Provider Connection binding set；
- Draft Run 在 admission 时固定当时的 Draft access set；Live Run 使用所属 Publication 的 set；
- Run 保存足够的不可变引用，使恢复、Wait、重试和审计继续使用 admission 时选定的 map；
- 权限组内容不做快照。Connector 当前策略的撤销与扩展对后续目录读取和能力调用立即生效。

这个模型固定“可以使用哪些 Connection 以及各自对应的权限组”，但不把权限组复制成 Flow 自己的 ACL。

## 4. 必须长期成立的不变量

1. Catalog、Connection picker、Publish/Rollback eligibility、Run admission、Action execution、proxy 和 Trigger maintenance
   必须携带同一个 provider access context。
2. 浏览器传入 `accessBindingId` 只能发起分配请求；部署必须用认证 principal、Flow scope、Provider 和 Connector 返回的候选资格重新校验。
3. 执行器不能接收 credential。Capability host 根据固定 Flow、Publication/Run、Task invocation 和 Provider binding 调用 Connector。
4. Code Task 默认获得动态 Connector API；每次调用仍必须由固定的 Provider binding 或 implicit Connector authority 授权。
5. Agent 只能调用其 Tool manifest 声明的工具；Provider binding 是 Connector 的第二层授权，不能扩大模型可见工具集合。
6. Connector 必须同时校验 Action 属于目标 Provider、Connection 属于该 Provider 且当前 binding 有权使用。
7. binding 状态变化不能被普通 metadata cache 隐藏。权限敏感缓存必须区分 Flow、操作者或 workload、binding、access snapshot 和策略版本。
8. Publish 成功只证明当时 eligible，不承诺未来一直可执行。每次有副作用的调用仍由 Connector 按当前策略授权。
9. Flow binding 更新只影响后续 Draft Run 和后续 Publication，不改写历史 Publication 或已接受 Run。
10. 删除或失效的 binding 不得自动替换成另一个 Connection 的候选项，也不得降级到 `implicit` 或 Provider 默认权限。
11. 远端资源删除使用创建时取得的窄 cleanup receipt，不能为了清理恢复普通 Action/proxy 权限。

## 5. 公共合同

### 5.1 Control API 投影

为当前 Flow 增加 deployment-scoped Connector access 资源，至少支持：

- 读取部署 access mode；
- 按 Provider 读取操作者可分配的 opaque binding 候选；
- 读取 Flow 当前 Draft access map 和每项状态；
- 以 expected version 或 ETag 原子增加/删除一个 Provider Connection binding；
- 返回 `active`、`missing`、`invalid`、`forbidden` 等可稳定处理的状态，但不返回原始权限规则；
- Connector catalog 请求在带 `flowId` 时按该 Flow 的 Draft binding 过滤；没有 `flowId` 的全局目录只表示操作者本人可见内容，不能用于执行准入。
- 返回规范 `providerAccessDigest`，让 Live 状态能识别只修改 binding、未修改 Revision 的未发布变化；
- binding 修改发送独立的 `access.changed` invalidation，使多会话刷新 access map、catalog 和 Live 状态。

最终字段和路由在实现第一阶段写入 Control API 技术参考。不要直接把某个部署的 permission-group API 透传为公共合同。

### 5.2 部署适配合同

部署侧 Connector adapter 需要接受一个聚合的 access context，而不是继续扩散可选的 `teamId`、`groupId`、`userId` 参数。该 context 至少能区分：

- 认证操作者的目录与 binding 分配操作；
- 固定 Flow/Publication/Run 的 workload 调用；
- Provider、opaque binding、调用目的和取消信号。

adapter 必须覆盖 provider/action/connection catalog、Action detail、Action execute、proxy、连接配置入口、eligibility resolve 和远端资源退役。
公共层只消费适配结果，不接触实际 token 或 permission rule。

权限敏感 projection cache 与不含权限的 Connector metadata cache 必须分开。operator projection key 至少包含 deployment scope、Flow、actor authorization
epoch、Provider、binding 和请求 identity；workload projection key 至少包含 Flow、Provider、binding、access snapshot identity、policy validator 和请求 identity。
`implicit` 模式还要包含 Connector configuration generation。Action execute、proxy 和 binding validity 不得用本地 allow cache 代替 Connector 当前授权；没有强
validator 或 invalidation 的权限敏感 projection 不缓存。

### 5.3 Workbench host 合同

产品中立 Workbench 负责 Flow 内的 Provider access 设置和继承状态展示。宿主只提供可选的“管理 Connector 权限”导航回调；宿主不把权限规则或 token
注入 Workbench。

## 6. Authoring 与 UI

新增 Flow 级“外部访问”设置面：

- 按 Provider 展示当前 Connection bindings、各自的权限组、状态和受部署管理的说明；
- `selectable` 模式从服务端候选列表分别增加或删除 Connection binding；
- `implicit` 模式不渲染伪造的单选项，只说明权限由部署 Connector 配置决定；
- 首次在节点选择某 Provider 的 Action 或 Connection 时，如果 `selectable` binding 缺失，引导用户先选择；
- 节点属性面板只展示“继承 Flow 的 Provider access”，不能覆盖为节点专属权限组；
- Connection picker 和 Action catalog 使用带 `flowId` 的过滤结果；不可见 ID 不靠前端隐藏来保证安全；
- binding 被撤销后保留原选择和错误状态，让作者显式修复，不静默选择其他组。

相关组件必须维护 Lab stories，覆盖 selectable、implicit、未绑定、已失效和无候选项状态。

## 7. Code 与其他消费者的目标语义

### 7.1 Code 节点

- Runtime Connector API 接受动态 `actionId`、输入以及可选 `connectionId`；
- 所有 Code Task 默认获得无节点级 Action/Connection 白名单的动态 Connector API；
- Runtime 同时提供显式 `call(actionId, input, options)` 和基于 `Proxy` 的动态属性访问，保留完整 Action ID 与 `actions.provider.action` 调用形态；
- Capability host 从 Action 解析 Provider，再查 Run 固定的 provider access map；
- `selectable` Provider 未绑定时拒绝；`implicit` 部署交给 scoped Connector authority 判断；
- Action 或 Connection 不在 binding 权限内时返回统一的 Connector authorization failure；
- 删除 Code 节点 per-Action/per-Connection runtime whitelist，不把 autocomplete、typing hint 或静态分析结果当授权。

如果 UI 为 autocomplete、schema 或 lint 保存最近使用 Action，它只能是编辑辅助数据，不能进入 Capability 的允许集合。旧声明中的 Connection alias 和默认
Connection 迁移为非授权的调用解析提示，以 Action ID 为 key；它们只把 alias/default 解析成 Connection ID，Connector 仍按 Provider binding 独立授权。

### 7.2 Connector 节点与 Agent

Connector Task 和 Agent Tool 保留 Action/Connection 业务选择，但执行时不获得超出 Provider binding 的权限。Agent 仍只能调用 Tool manifest 声明的工具；
Capability host 先校验 Tool call 属于 manifest，再让 Connector 按 provider binding 做最终授权。

### 7.3 Trigger 与后台维护

Poll、Integration、共享事件源、通知和订阅清理都从目标 Publication/operation 的固定 access map 取得 binding。后台工作不能依赖发布用户仍在线，
也不能改用更宽的部署 authority。候选资源准备、Live 切换、listener 扫描和恢复必须携带相同 binding identity。

创建远端订阅、webhook 或同类资源时，Connector 还必须返回 opaque cleanup receipt。receipt 只允许幂等退役绑定到 deployment scope、Flow、Provider、
Trigger、创建 operation 和远端资源的确切对象，不允许普通 Action 或 proxy；即使原 access binding 后来被删除，也能通过专用 retire 操作完成清理。部署持久化
receipt 直到 Connector 确认资源已删除或不存在，且不能把 receipt 暴露给浏览器、Revision 或 RunEvent。

远端创建与 receipt 持久化通过 creation intent 收敛：部署先持久化带稳定 idempotency key 的 intent，再调用 Connector。key 至少绑定 deployment scope、Flow、
Provider、Trigger binding、Publish operation 和逻辑资源。Connector create 按 key 幂等，重放必须返回同一 remote resource identity 和仍可使用的 receipt，或提供等价的
受管恢复读取。部署只有在密封持久化 receipt、resource identity 和 ownership 后才能把 staged work 标为 ready；任一中断由 reconciliation 使用同一 intent 恢复，
不能创建第二个资源。

cleanup receipt 是唯一允许持久化的 Connector bearer capability 例外，必须同时配合受管 workload transport 使用并按 credential 等级密封、轮换和审计。
receipt 校验失败或 Connector 不可用时，相关 Flow/Publication cleanup 保持非终态；只有 Connector 确认资源已删除或不存在后，lifecycle owner 才能删除
ownership 和 receipt。不得用“人工恢复”状态代替清理成功；若未来允许 Operator 放弃清理，必须另行定义显式、不可逆、可审计的产品操作。

## 8. Publication、Run 与策略变化

### 8.1 Publish 和 Rollback

Publish operation 接受时固定 Draft access map，并对完整 closure 使用到的 Provider 做 eligibility 检查。接受协议必须：

1. 读取规范 access snapshot 及单调 `accessRevision`；
2. 使用该 snapshot 做外部 eligibility；
3. 在同一个部署存储事务中保存刚验证的 snapshot，并 CAS `accessRevision` 仍等于读取值；
4. CAS 失败时返回稳定 conflict 或从第一步重新检查；
5. 幂等重放先返回已接受的 operation，不读取当前 Draft map。

外部 Trigger 的 staged work 只使用 operation snapshot。activation 前再次确认该 snapshot 中的 binding 仍有效；失效则 operation 明确失败，不能改读 Draft。

Rollback 创建新 Publication，并复制目标 Publication 的 provider access map。若其中任一 binding 当前不可用，Rollback 在创建新 Live 前失败，不能借用当前 Draft
binding 修补历史选择。

### 8.2 Run admission 与恢复

Draft Run 使用和 Publish 相同的 snapshot、外部 eligibility、`accessRevision` CAS 接受协议，并在 admission transaction 中同时保存 Run、snapshot 和调度工作。
Live/Trigger Run 固定 Publication map。Run 的 Wait 恢复、重试、Agent continuation 和 Trigger occurrence 不得重新读取当前 Draft map。

策略内容仍是 live policy：即使 Run 已接受，Connector 也可以因权限后来被撤销而拒绝下一次调用。RunEvent 记录 Provider、opaque binding 和可用的
policy revision/digest，不记录 credential 或原始规则。

## 9. 实施阶段

### 阶段 0：冻结合同与 Connector 前置能力

- [x] 在架构文档补充 Provider Access Binding 的所有权、不进入 Revision、Publication/Run 固定选择和 live policy 语义。
- [x] 在 Control API 技术参考确定 access mode、候选列表、Draft map、并发更新、错误码和 ETag 合同。
- [x] 明确 hosted adapter 的候选枚举、分配资格校验、binding 解析以及 binding-aware catalog/execute/proxy。
- [ ] 明确 Connector 侧 cleanup receipt 与专用 retire。
- [ ] 冻结远端资源 commit-to-recovery 合同：持久 creation intent、幂等 create、receipt 可重放恢复以及 receipt commit 后才能 ready。
- [x] 冻结 Code Runtime 合同：粗粒度 Capability、显式 `call`、动态属性访问以及 alias/default Connection 的非授权解析提示。
- [x] 明确 hosted selectable adapter 和 OpenConnector implicit adapter 的 conformance fixture。
- [ ] 用安全评审证明任意浏览器 `accessBindingId`、跨 Provider Connection ID、失效 binding 和 cleanup receipt 均不能提升权限。

出口条件：公共包可以描述 binding，但尚不改变现有执行行为；两个部署 fixture 能回答相同 conformance 场景。

### 阶段 1：公共 Control API 与部署存储

- [x] 增加 access mode、binding summary、candidate 和 Draft map 的公共类型与 decoder。
- [x] 增加 Flow access map 的读取、设置和清除请求，使用 expected version/ETag 防止覆盖并发编辑。
- [x] 增加部署存储接口，使 Flow 删除能清理 Draft map，Publication/Run 能固定不可变 map。
- [x] 把 access map 纳入 Publish operation、Publication、Draft Run admission 和 Live Run admission。
- [x] 增加 `accessRevision` CAS 接受协议、`providerAccessDigest`、binding-only 未发布状态和 `access.changed` invalidation。
- [x] 为缺失、失效、无权分配和 Connector 不可用建立稳定错误语义。

出口条件：不执行 Connector Action 也能完整验证 authoring、Publish、Rollback、Run snapshot 和删除生命周期。

### 阶段 2：Connector adapter 与全链路授权

- [x] 用聚合 access context 替换 `ConnectorHost`/deployment adapter 上零散 scope 参数。
- [x] 让 Provider、Action、Connection catalog 和详情读取使用 Flow Draft binding。
- [x] 让 Publish eligibility、Action execute、proxy、Agent、通知、Poll、Integration 和维护任务使用固定 binding。
- [ ] 分离 metadata 与权限 projection cache，按 Flow、actor/workload、snapshot、binding、policy validator 和 implicit config generation 隔离。
- [ ] 让远端资源创建保存 cleanup receipt，退役使用专用 retire，不依赖已删除 binding。
- [ ] 让 Trigger reconciliation 从稳定 creation intent 恢复 create/receipt/ready 的任意中断，不产生 orphan 或重复资源。
- [x] OpenConnector 实现 `implicit`：继续使用已配置的 scoped runtime token，但通过同一公共调用链和错误语义。

出口条件：同一 Action/Connection 在目录、Publish 和 Run 三处得到一致允许或拒绝结果。

### 阶段 3：Workbench

- [x] 实现 Flow 外部访问设置、Provider binding selector 和失效修复状态。
- [x] Action/Connection picker 全部传递当前 `flowId`，首次使用时引导 binding。
- [x] 节点面板显示继承关系，不提供节点级权限组覆盖。
- [x] 接入宿主的 Connector 权限管理导航回调。
- [x] 增加 Lab stories、键盘操作、加载/错误/空状态和并发冲突测试。

出口条件：作者不需要理解 credential 或节点白名单，也能明确看到 Flow 对每个 Provider 使用的权限边界。

### 阶段 4：移除 Code Action/Connection 白名单

- [x] 更新 Runtime contract：所有 Code Task 都可动态调用，由 Capability host 解析 Provider 并授权。
- [x] 删除 `ConnectorCapability.connections` 及 per-Action allowlist 的运行时 gate和编辑器开关。
- [x] 增加 version-aware decoder：旧声明保留按 Action 的 alias/default Connection 解析提示，丢弃其余 allowlist 含义。
- [x] 让旧完整 Action ID 属性、分层属性和新 `call` 都进入同一个动态 payload validator 与 Capability host；不要静态重写用户 source。
- [x] 既有有效旧 Revision、Publication 和 Run 通过确定性 decoder 使用新授权路径且不改 digest；损坏或无法解码的数据按既有 storage conflict/migration required 语义失败。
- [x] 更新 [`code-actions.md`](code-actions.md) 状态，标明其白名单部分已由本计划取代。
- [x] 删除仅服务于双重授权的测试、类型和 UI，不保留 compatibility shim。

出口条件：Code 调用一个未预声明但被 Provider binding 允许的 Action 成功；旧声明中存在但 binding 不允许的 Action 失败。

### 阶段 5：发布与清理

- [ ] 先发布包含新公共合同和 conformance 的 package，再升级各部署的精确版本。
- [ ] 在 selectable 部署完成 binding 数据迁移和真实 Connector 冒烟后，最后启用 Workbench selector。
- [ ] 对历史 Flow 建立显式 migration 状态；不要自动授予 Team 默认组。
- [ ] 部署 cutover 前阻断新的 Connector-bearing admission，处理所有没有 access snapshot 的非终态 Run、operation、Trigger work 和 outbox。
- [ ] 观察 denied、binding missing/invalid、policy changed 和 Connector unavailable 指标。
- [ ] 删除旧执行路径、旧缓存 key 和旧权限说明。

## 10. 历史 Flow 迁移

### selectable 部署

历史 Flow 没有可证明的 permission-group 选择，因此迁移后保持 `unbound`。作者必须选择 binding 后才能重新 Publish 或运行涉及该 Provider 的 Draft。
已有 Live Publication 不自动扩大权限；部署若无法从历史运行 authority 确定一个等价 binding，应暂停其新 Trigger admission 并要求显式修复。

禁止把“当前用户能看到的第一个组”“Team 默认权限”或旧 Code 白名单自动转换成 binding。

selectable 部署在切换到新授权路径前必须执行 cutover audit：先阻断新的 Connector-bearing Run、Publish 和 Trigger admission；等待正在执行的 segment
结束；对未开始的 queued Run、pending Publish operation、candidate work 和已接受 occurrence 明确取消或失败；对无法证明等价 binding 的持久 waiting Run、
Agent continuation 和 notification outbox 明确终结，不能借当前 Draft binding 恢复。

升级前已经创建的远端资源没有 cleanup receipt。部署必须在旧 authority 仍有效且新 admission 已关闭时，用旧路径退役全部历史远端资源；任一清理失败都阻断
cutover，不提供 receipt 补发或 Team-default 长期 fallback。修复后的 Flow 重新 Publish 时再按新合同创建资源和 receipt。只有历史远端资源已清零，且旧 schema
下所有非终态工作已 drain、终结或显式迁移，才能删除 Team-default fallback。

### implicit 部署

历史 Flow 不需要写入 binding 记录。升级后统一使用当前部署配置的 scoped runtime token，行为受该 token 已有 `allowedActions`、
`blockedActions`、`allowedConnections` 和 proxy scope 限制。

## 11. Conformance 与验收矩阵

公共 black-box conformance 必须对 `selectable` 和 `implicit` 两套 fixture 运行相同核心场景：

| 场景                                     | selectable               | implicit                         |
| ---------------------------------------- | ------------------------ | -------------------------------- |
| 允许的 Action + Connection               | 成功                     | 成功                             |
| 未允许的 Action                          | Connector 拒绝           | scoped token 拒绝                |
| 跨 Provider Connection ID                | 拒绝                     | 拒绝                             |
| Code 动态调用未预声明 Action             | binding 允许则成功       | token 允许则成功                 |
| 缺失 binding                             | 拒绝                     | 不适用，不创建假 binding         |
| binding 被删除/禁用                      | 下一次调用拒绝           | token 失效时拒绝                 |
| Draft binding 修改后运行历史 Publication | 仍用 Publication binding | 仍用部署 implicit authority      |
| Wait 后修改 Draft binding 再恢复         | 仍用原 Run binding       | 仍用部署 implicit authority      |
| policy 撤权后恢复                        | 当前策略拒绝             | 当前 token 策略拒绝              |
| 浏览器提交无权 accessBindingId           | 设置请求拒绝             | 设置请求不支持                   |
| Rollback 到不可用 binding                | 激活前失败               | 正常按 implicit eligibility 检查 |

另需覆盖：

- Provider/Action/Connection catalog 不泄露 binding 外实体；
- Publish operation 的接受、重放、失败恢复和 activation 不改变 access map；
- Trigger candidate、current binding、listener、Poll baseline 和 cleanup 不发生 authority 漂移；
- access snapshot 外部校验与 admission CAS 收敛，并发 binding 更新不能让校验对象与持久对象不同；
- 同 Team/同 binding 的不同 Flow、同 Flow 的不同操作者、策略版本变化、implicit token rotation 和晚到请求不会串用缓存；
- binding-only 改动形成未发布变化、通知其他会话，并能发布相同 Revision/不同 access snapshot；
- 删除权限组后，已有远端资源仍能凭窄 cleanup receipt 幂等退役，但不能执行其他操作；
- cleanup receipt 无效时 Flow lifecycle 保持 retiring，修复 Connector 后继续同一个清理流程；
- 在远端 create commit 后、receipt 返回后、receipt 持久化后和 ready transition 前分别中断，恢复后只能存在一个远端资源且一定能退役；
- 从旧 schema 带 queued/running/waiting Run、pending operation、Trigger work 和 outbox 升级时按 cutover matrix 收敛；
- 旧 Code 完整 ID、分层属性、显式 Connection ID、Connection alias、默认 Connection 和 immutable Revision 均经 version-aware decoder 保持调用语义；
- RunEvent 与日志不含 token、credential、原始 permission rule；
- Flow 删除清理 deployment-scoped Draft map，但不删除 Connector 拥有的权限组；
- catalog cache 不会跨 Flow、binding 或部署 scope 复用授权结果。

## 12. 首个纵向切片

先选一个同时有 Action、Connection 和 proxy/Trigger 使用场景的 Provider，完成以下最小闭环：

1. selectable fixture 为同一 Provider 提供两个 Connection binding；
2. Workbench 可以分别增加或删除两个 binding；
3. Catalog 只显示所选 binding 允许的 Connection，并显示这些权限组允许 Action 的并集；
4. Publish 固定该 binding；
5. Code 动态 Action、普通 Connector Task 和一个 Trigger path 使用同一 binding；
6. 运行中撤销权限后，下一次调用 fail closed；
7. 删除权限组后，远端资源通过 cleanup receipt 成功退役；
8. 同一 conformance 在 OpenConnector implicit fixture 通过。

这个切片通过后再扩展到 Agent、通知和其他 Trigger，避免先完成 UI、后发现后台 workload 无法安全解析权限组。

## 13. 明确不做

- 不创建 Flow service account；
- 不把 token、credential 或原始 permission rules 保存进 Flow、Revision、Publication 或 RunEvent；
- 不允许节点选择自己的权限组；
- 不允许运行时绕过 Flow 已保存的 Connection binding 切换权限组；
- 不把 Team 默认权限作为缺失 binding 的 fallback；
- 不在公共包解析 OOMOL Console 的 role/app-access 数据；
- 不保留 Code Task 的 Connector 开关或 Action/Connection 白名单作为“额外安全层”；
- 不在第一版实现权限规则快照或“发布时权限与当前权限取交集”。

## 14. 验证命令

实现各阶段时按受影响边界运行：

```bash
cd packages/open-flow
bun run test

cd ../..
bun run check
bun run test
bun run build
```

提交前必须从仓库根目录重新运行 `bun run check`。浏览器交互以 Lab 和产品宿主的真实 Flow 场景补充验证。
