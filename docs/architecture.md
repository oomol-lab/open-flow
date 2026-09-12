# 产品与架构边界

本文只记录 Open Flow 必须长期成立的产品事实、模块所有权和运行时不变量。精确字段、路由、错误码和分页属于
[Control API 技术参考](control/contracts/control-api.md)；部署、存储和交付细节属于对应实现文档。

## 1. 产品边界

Open Flow 由一套公共产品合同和多个彼此独立的部署实现组成。Workbench 与 CLI 只通过版本化 Control API 操作当前选定的一个部署，
不拥有第二套持久化或执行模型，也不能在部署之间静默 fallback。

```text
Workbench ─┐
           ├── Control API protocol ── deployment implementation
CLI ───────┘
```

公共 package 拥有完整 Revision 解码、Control API 写请求和 MCP 工具定义；部署适配器复用这些契约，并运行对应的一致性测试。
Server 同时提供 MCP Streamable HTTP 入口。MCP adapter 与 Control API adapter 共享 Server application service；认证主体、
Flow 修改、幂等准入、持久化和执行语义由同一个部署负责，不能形成第二套 authoring 或 Run 状态机。

### Flow 与 Revision

Flow 是部署生成的顶层产品资源和稳定 opaque identity，不从属于 Project。每个 Flow 独立拥有名称、生命周期、Draft head、Revision 历史、
Presentation、Publication、Live、Run 和 Trigger binding。

每个 Flow 或 Subflow graph 内的 Node title 是非空且唯一的用户标识；`nodeId` 是稳定的内部 identity，继续用于连线、binding、运行事件和机器协议，
不能随 title 修改。Workbench 读取不满足约束的 Draft 后，必须通过正常的 Draft change 创建修正 Revision，不能在读取时改写既有 Revision。

Flow 有一个可变 Draft head 和不可变的 Revision 历史。Revision 是该 Flow 的 graph、Subflow、Task、binding 和 CodeModule source 的完整事实来源；
语义修改必须以预期 Revision 为前提并使用稳定 change identity 原子提交，不能静默覆盖 stale head；幂等重放必须先于 Draft head 比较返回已经接受的
Revision。Draft 同步只返回当前完整 Revision snapshot，不提供持久化 authoring operation history。内部索引、缓存、增量记录和存储布局不能成为第二个事实来源。

Presentation 独立保存布局、viewport 和 Comment 等展示状态；每个 Flow 或 Subflow 图只有一个画布和 viewport，节点配置由侧栏承载。Presentation
不进入 Revision digest，也不影响 validation、Run、Publication 或 Live。
Task 的端口分组随有序端口定义保存在 Revision 并参与 digest；分组不创建语义端口，也不参与连接、validation 或 Run。
Revision 不保存 credential、Run、Engine IR、Provider 状态或部署缓存。

### Deployment Variable

Variable 是 deployment scope 配置，不属于任何 Flow。Flow Revision 只保存大小写敏感的 Variable name binding，digest 包含 binding 与 name，
不包含 value。Variable 删除不修改 Revision；需要该 name 的首次 Publish、Rollback 或 Run admission 必须在资源创建的权威 operation boundary
内 fail closed，幂等重放必须先返回已经接受的资源。

普通 Run 开始时从一个 deployment store snapshot 解析固定 closure 实际使用的 Variable，并把同一份值注入根图和每次 Subflow invocation。平台不能把
解析值隐式写入 Revision、Publication、持久化 Run input 或 `node.started`；Flow 代码显式返回、记录、发送或抛出该值时，它仍可进入用户数据流、
RunEvent、日志或外部系统。Variable 是 Operator 可读取的 deployment configuration，不是不可导出的 Secret Manager。

旧 Project schema 与 Project API 不属于当前产品合同。升级必须保留已有数据，支持的 schema 通过显式迁移转换；发现尚无转换路径的旧 schema 时，
应停止升级并保留原始数据库，不得在启动过程中隐式重建或删除数据。

### Deployment capability settings

Connector runtime、Connector Console、显式 LLM 和 Integration callback 等部署能力配置不属于 Flow 或 Revision。Server 可以从启动环境或自己的 deployment store 解析每个完整配置块；启动环境
存在时锁定该配置块，不能与 store 按字段混合，也不能在外部服务不可用时静默 fallback。配置来源必须能由 Operator 区分为 environment、settings、derived
或 unconfigured。

Store-managed 配置原子提交并在保存后用于新的 capability operation；已经开始的 operation 继续使用开始时取得的固定配置快照。Secret value 不通过读取 API、
Workbench 或日志返回，但可恢复的外部 service credential 会进入 Server 数据卷、WAL 和备份的信任边界，不是不可导出的 Secret Manager。

包含 Agent 的 Run 在准入事务中固定其执行 closure 所使用的 Variable 值与模型部署配置，首次执行和审批恢复均使用同一快照。
模型 credential 属于部署私有持久化，不进入 Revision、公开 Run input 或运行事件。

### Scope、身份与通知

部署必须从认证 principal 确定稳定 scope。客户端选择的 scope、operator identity、workload authority 和 callback endpoint identity 不能互相替代。
切换 deployment scope 必须销毁旧 session、请求和实时订阅。

Server operator credential 可以由启动环境锁定，也可以在 deployment store 中持久化；启动环境存在时必须成为唯一 active auth source，不能与持久化
credential 混合验证。全新 Server 在两种来源都不存在时进入未认领状态，只能通过部署者从进程启动日志取得的一次性 setup authorization 建立首个持久化
credential。认领必须原子且最多成功一次，不能把第一个访问管理面的匿名请求直接提升为 Operator。Operator credential verification、Browser session
signing 和 callback endpoint identity 使用彼此独立的秘密与生命周期。

Workbench 使用两个彼此独立的实时通知通道：

- Flow catalog 通道只发送 `flows.changed`，用于重新读取顶层 Flow 列表；
- 当前 Flow 通道发送该 Flow 的 `draft.changed`、`run.created` 和 `run.changed`。

CLI、Workbench 或其他客户端通过 Control API 创建、改名、修改 Draft、发布、回滚、启停或删除 Flow 时，部署必须使 catalog 通道可观察到变化。两个通道必须能独立连接、
断线和重连。宿主显式报告首次订阅就绪，客户端随后读取初始状态，并保留读取期间收到的 invalidation；首次连接失败不能无限阻塞加载，
恢复连接或重连后客户端通过普通 Control API 恢复权威状态。通知只是 invalidation，不是 Revision、RunEvent、协作日志或消息队列。

### 生命周期与 retention

Flow 删除先进入 `retiring`，立即阻断新的 mutation、Run、Publish 和 Trigger admission，再由该部署唯一的 lifecycle owner 清理关联资源并物理删除。
完成后不保留可恢复 tombstone 或 authoring history；失败恢复只能继续同一个删除流程，不能形成第二条清理状态机。

RunEvent 明细可以按部署声明的 retention 到期，但唯一 terminal result 必须独立保留，直到所属 Flow 的物理删除流程清理该 Run。

Server 的 Run owner 统一处理 Wait 到期、事件清理、通知 work 领取及下一到期时间；发布等待不能阻断 Run 的到期维护。
维护调度统一提供下一工作时间，Supervisor 只据此启动维护，不另行解释 Wait 或通知的持久状态。

## 2. 源码与模块所有权

本仓库是公共合同、可移植实现、Workbench runtime 和 Server 的唯一可编辑源码事实源。

- `packages/open-flow` 拥有公共类型、严格 decoder、Control API client、black-box conformance、Flow/Run/Trigger 的确定性语义、程序化
  authoring API、产品中立 Workbench runtime 和内层 UI。
- `packages/command` 拥有 CLI 行为、Command Host boundary、Command Artifact 协议、确定性 archive 构建和发布。它只通过
  `packages/open-flow` 的公开 package entry 消费产品合同。
- `apps/server` 拥有 Server application lifecycle、SQLite、HTTP adapter、本地调度、具体 `isolated-vm` host、MCP adapter、同源 Workbench host 和 Docker 交付。
- 其他部署只拥有自己的基础设施接入、认证、application lifecycle、Capability mediation 和正式 Workbench 宿主。

部署必须消费精确版本的公开 package artifact 并运行其中的 conformance cases，不能通过源码复制、deep import 或同步脚本保留公共实现的第二份
可编辑副本。Workbench runtime、类型声明和样式只通过 `@oomol-lab/open-flow/workbench`、`workbench.css` 与 `theme.css` 同版本发布。
`theme.css` 是部署宿主与 Workbench 共用的产品语义主题合同；Canvas Content 的 Designer token 仍由 Designer 独立拥有，只有 Canvas Chrome
显式桥接产品主题。宿主操作通过公开 Workbench props 进入 Workbench 持有的共享 UI composition，部署宿主不能通过绝对定位或内部 selector
覆盖 Workbench Header。部署宿主的 pre-auth session 页面同样通过公开 Workbench composition 使用共享 shadcn primitive，宿主只持有认证请求和状态。

产品中立 Workbench 拥有 Flow authoring 所需的 Variable name selector，只接收 name projection。deployment Variable 的 value 管理面属于正式
Workbench 宿主：开源 Server 在自己的 Browser host 中提供，其他部署可以使用自己的既有管理面，不能为此复制或分叉公共 Workbench runtime。

Common 代码不能依赖 Browser 或 Node，Browser 代码不能依赖 Node。部署应用通过公开 subpath 消费 package，不 deep-import 另一个 workspace 的源码。

## 3. Validation 与执行

Flow Revision 和 change operation 在公共解码边界忽略并移除未声明的对象字段；已知字段、必填项和版本仍须满足合同，任意 JSON 数据内容保持不变。

权威 validation 的输入是固定 Flow Revision、model version 和 Engine Contract。它必须确定性检查 graph、Module、Task 和 closure，不读取
credential value、Provider 当前状态、调用权限或部署资源。非确定性 eligibility 必须在 Run 或 Publish 的 operation boundary 重新检查。
部署 Control check 可以在确定性 validation 之后追加静态 capability 配置缺失的 diagnostic，例如 Flow 使用 LLM Task 但 Server 没有 LLM host；
这类 diagnostic 不进入 Revision 或 digest，也不能通过探测外部服务状态产生。

草稿从指定 Trigger 测试运行时，只校验并准备该入口沿执行边可达的节点及其 Task、Module、Subflow 和 binding 依赖；无关分支的语义错误或部署能力缺失不阻断本次运行。
准入、队列执行和 Wait 恢复必须使用同一入口范围，固定完整 Revision 身份及本次执行 closure。全图 check 和 Publish 仍检查完整 Flow，Workbench 不得用全图诊断禁用草稿入口测试。

Engine Contract、部署中立 Runtime invocation、Scheduler 图执行语义、RunEvent 投影和 conformance 属于 `packages/open-flow`。具体执行隔离、
Engine digest、资源限制和恢复属于部署实现；`isolated-vm` RuntimeHost 只属于 Server。

Flow 与每次 Subflow invocation 使用无环执行图。连线表示节点之间的执行依赖，输入映射独立声明数据来源；保存或删除执行边不会隐式创建或删除输入映射。
每个节点在一次图调用内最多运行一次。节点等待全部直接前驱完成或跳过，在至少一条入边被选中时执行；Flow Run 必须固定一个 Trigger 起始节点，未连接入口的普通根节点跳过；Subflow 的普通根节点由调用启动，无依赖的分支可以并行。
Condition 只选择首个匹配分支或 default，Wait 只选择已决议的 action；未选中的分支传播跳过状态。Trigger occurrence 只选择对应 Trigger，其他 Trigger 分支跳过。
未执行节点的跳过状态仅属于内部调度和恢复，不创建节点执行身份、不产生公开节点事件，也不进入最终节点执行结果。

节点输入只能引用本图中经执行边可达、且在当前节点执行路径上保证已完成的祖先 output。多个 source 表示互斥分支的备选值，每次执行必须恰有一个可用值，
不能按值到达次数重复启动节点。Subflow 的输入和最终输出保持显式声明，不能越过图边界直接引用内部或外部节点。

Task 仅通过返回对象一次性提交最终 output，全部声明和可序列化性校验成功后才向下游提供结果。声明 output 的 Task 必须返回完整结果；无 output 的 Task 可以返回空对象或
`undefined`。普通 Flow 数据在 Runtime invocation、Scheduler、Subflow、RunEvent 和 terminal result 边界保持可序列化。
脚本 `context` 提供取消、日志、进度、Artifact、网络、Connector 等宿主能力、只读运行身份，以及与第一个参数相同的 `inputs`。
`context` 不提供运行中的 output 提交、跨节点的动态 Run store、Variable 查询或任意节点输出查询。部署可以为调度、调试和恢复私有保存 Run value，
但不能把内部存储变成第二条用户数据通道。节点最终结果与成功完成通过同一个完成事件发布，先于下游节点启动。

Server 将一次 Flow Run 作为一个逻辑 Runtime session 交给 Executor，Scheduler 和内联 Code Task 执行都在该 session 内；SQLite、RunEvent 投影、
外部 Task 和 Capability mediation 仍由 Host 持有。Executor process 可以承载多个并发 session，但每次 Code Task invocation 使用新的 isolate；process
与 isolate 的物理拓扑不是公共执行语义。

Scheduler 的事件和 Task callback 与 Run 处于同一个 Effect Fiber 生命周期。Run 取消、deadline 和 sibling failure 通过 Fiber interruption 传播；只有
连接 Promise 或 callback API 的部署边界可以把 interruption 转成 `AbortSignal`，内部执行合同不维护第二套取消状态。

Run admission 通过固定 Draft Revision path 或当前 Live Publication identity 固定 Flow、Revision、closure 和 Engine identity。接受后，`runId` 是部署
scope 内唯一资源 identity。用户代码开始执行后不能通过重试创建第二次执行；无法确认的恢复结果必须显式结束为不确定失败。取消与完成竞争时，
权威 Run store 中只能有一个 terminal。

部署必须限制并行 Run 数量和单个 Run 的总执行时间。同一 Flow 的 Run 串行 claim，不同 Flow 在全局并发上限内按最早可执行顺序推进，避免一个
Flow 的长 Run 阻塞其他 Flow。

Wait 是同一个 Run 内的持久化暂停点，不是新的 Run、子流程或长驻 Runtime session。Run 到达 Wait 时，部署必须原子保存 Scheduler checkpoint、
固定 Revision 身份、当前 Wait 和剩余执行预算，再把 Run 置为 `waiting`；暂停期间不持有 Executor session 或同 Flow 的执行槽。合法 action 只把
该 Run 重新排队，恢复时从 checkpoint 继续，并保持已完成节点的最终结果、跳过状态、启动输入、Variable 快照和同一 `runId`。
暂停前必须等待正在运行的并行节点结束，恢复时不能重跑已完成或已跳过的节点。进程恢复不能重跑已完成 segment，也不能重置
Run 的总执行预算。checkpoint 缺失、损坏或与固定 Wait 不一致时必须 fail closed，不能从 Flow 起点猜测性重放。

Approval 是 Wait 对 action 集合 `approve/reject` 的一种产品语义，不是独立执行节点或部署认证机制。部署内部的 Control API resolve 使用 Operator
认证；外部通知可以携带只绑定一个 Wait 的 opaque capability。公开 hook 只提供 JSON inspection 和显式 POST action，不拥有 HTML 页面或特定消费端
界面。一次 Wait 的所有 resolve 入口共享同一个 first-writer-wins 决议事实。
各等待保留独立决议事实，后续等待和 Run terminal 不覆盖旧决议；这些事实不受 RunEvent retention 影响，随 Flow 物理删除清理。

Agent 是根 Flow 中的 Managed Task，拥有显式输入、固定模型、Connector 工具与可选代码计算能力声明。模型不能改变工具 Action、Connection、固定参数或审批策略。
Agent 的工具批次串行处理，批准或拒绝只处理该次固定调用。框架 continuation 属于部署私有数据；Run owner 原子提交 continuation、Scheduler
状态、审批等待与通知 work，框架不拥有另一套 Run 状态机。并行分支的暂停统一收敛为单个可决议等待及其后续队列，恢复不重跑已完成节点。
Agent 节点超时累计各次实际执行段，审批与排队不消耗节点预算；Run 总预算独立保留。执行结果不明时终止为不确定失败，不能让模型自动重试。

Agent 临时代码属于此次 Run 的调用数据，不修改 Revision 或图结构。宿主只注入当前节点输入、明确值和当前 invocation 已取得的结果，
每次计算使用独立隔离 realm，不授予 Connector、网络或其他业务 Capability。代码成功结果沿用工具结果持久化与恢复边界，
不能通过重启或审批恢复重跑已完成计算；普通源码错误可由模型修正，取消、资源限制和宿主完整性失败仍终止 Agent。

Agent 工具的完整结果属于 Run，由部署独立持久化，不依赖日志保留期。模型消息、日志和框架 continuation 使用结果引用与有界预览，
不能通过复制完整正文传递恢复事实。宿主结果读取工具仅可访问当前 invocation 已取得的结果；Operator 通过同一 Run 读取权限查看和下载。
恢复必须验证引用与完整性，不能通过重新调用外部工具补回缺失结果。结果随所属 Flow 的物理删除清理。

Wait 通知复用固定 Revision 中显式选择的 Connector action。部署必须先持久化 `waiting` 和通知 work，再在事务外调用 Connector；外部调用至少一次，
稳定 invocation identity 由 Connector 幂等处理。通知发送失败不能自动批准、拒绝或结束 Run。通知正文中的 capability 只以不可逆摘要进入持久化存储，
完整 URL 属于 bearer credential；公开 origin 是部署 capability 配置，不进入 Flow Revision。

用户代码只在隔离 realm 中获得目标 closure、固定 platform module、所选 Engine Contract 声明的内置模块和当前 Task invocation 明确声明的窄 Capability。内置模块不授予宿主存储、身份或外部访问权限。
部署只声明自己实现的 Engine Contract；Node 兼容合同的内存文件系统属于单次 Task invocation，不在 Task 之间共享或持久化。Capability host 必须校验当前
Flow、Run、Task、invocation、binding 和 Run 状态；Task 或 Run 结束后旧 Capability 必须 fail closed。

Code Task 的 Action 声明属于 Revision，固定允许的 Action、Connection 集合和可选默认账号。分层属性与完整 Action ID 索引共享同一调用合同；
每次业务调用有独立身份，用于外部幂等处理，不复用 Task invocation identity。Action 调用仍属于当前节点的生命周期，不创建图节点或独立 Run。
普通调用错误可以被代码捕获，取消、deadline 和资源限制不能因用户捕获错误而失效。

## 4. Publication、Connector 与 Trigger

Flow 的线上启用状态独立于 Publication 和单个 Trigger 的暂停状态。停用阻断新的线上 Run 与所有生产 Trigger admission，保留已接受的 Run、发布版本与草稿测试能力；重新启用不能改写单个 Trigger 的暂停状态。首次发布默认启用，之后发布与回滚保留总开关状态。

Publication 是 Flow 在固定 Revision 上的不可变成功记录。每个 Flow 独立拥有 Publication 历史和最多一个 Live pointer。Publish 在同步接受前固定
Revision、closure、Engine、预期 Live 和必要 binding，并完成 validation 与非确定性 eligibility；之后由持久化 publish operation 表达
`pending | succeeded | failed`。同一个 Flow 最多有一个 pending publish operation，幂等重放返回同一个 operation。

只有需要外部或异步准备的 Trigger 才建立持久化 work。外部请求不进入本地事务；所有必需 work Ready 后，一个权威 transaction 才能创建
Publication、比较并移动 Live、安装 current Trigger binding 并把 operation 标为 succeeded。pending 或 failed operation 不创建 Publication、不移动
Live，旧 Live 继续作为 Run 和 Trigger admission 的事实来源。Rollback 创建新 Publication，不修改历史记录。

PublicationStore 拥有发布总事务；PollStore 与 IntegrationStore 各自拥有候选准备、binding 复用判断和安装，在该事务内重新检查激活条件。
候选准备成功或失败与对应 publish work 的状态在同一事务中提交。PublicationStore 从持久化 operation 与 work 推导下一次推进时间，
Maintenance 将它纳入调度；暂时无法激活的 operation 持久化重试时间，不阻塞其他 Flow，重启后仍按该时间与准备期限恢复。

current Trigger binding 与 Live pointer 共同构成 Trigger admission authority。候选 Integration callback、Poll baseline event 和旧 runtime claim 在激活前后
都不能绕过该 authority 创建 Run；Poll baseline checkpoint 只在激活 transaction 中安装。不能使用独立候选 endpoint 安全替换的 Integration 变更必须
fail closed，不能先修改 current provider resource 再依赖补偿恢复。

Connector service 拥有 Provider 授权、credential、Connection lifecycle 和 proxy transport。Open Flow 保存稳定的 opaque Connection identity，
不能把 credential、token 或 Connector 数据库复制进 Revision、Browser 或 RunEvent。Connector catalog 和 Connection 是 deployment scope 资源，
不从属于单个 Flow。

Code Action 可以将绑定时的 Connector alias 与稳定 ID 一起固定在 Revision；alias 只是当前 Action 允许集合内的选择名称，不能成为动态授权依据。
目录改名不修改旧 Revision。Publish 与 Run eligibility 检查完整执行 closure 的允许账号集合，具体调用仍由宿主检查当前外部授权状态。
Connector adapter 必须明确自己的执行身份保证；本地按 ID 解析到 alias 不等于上游按稳定 ID 原子执行。

Server 使用 OOMOL-hosted Connector 时，Operator 创建 Flow 必须选择一个具体 OOMOL Team，并由 Server 在同一个创建 operation boundary 内保存为
不可变的 Flow metadata；选择默认 Team 也必须固定其具体 identity，不能保存为随账户默认值漂移的动态选择。Node 不拥有或覆盖 Team，既有 Flow 也不能
原地切换 Team；需要另一个 Team 时创建新的 Flow。Connector catalog 与 Connection 查询按 Flow 解析 Team，Run admission 将 Team 固定为 Run snapshot，
Poll 与 Integration 使用所属 Flow 的 Team；运行时 Connector 请求必须显式携带该固定作用域，不能读取部署级可变 Team。产品中立 Workbench 不拥有这项
外部身份配置，由部署宿主扩展创建 Flow 的交互和 operation。自建或自定义 Connector 不显示 OOMOL Team 入口，也不能隐式请求 OOMOL membership 服务。

Server 可以显式配置独立的 LLM origin 和 token；未显式配置时，OOMOL-hosted Connector runtime 和对应 token 可以推导同一环境与授权的 OOMOL
LLM host。自建或自定义 Connector origin 不隐含模型能力，未配置的 Connector 或 LLM capability 必须分别 fail closed；Workbench 不能把外部服务
暂时不可用误报为部署尚未配置。

Trigger 是 Flow graph 中的 source node。每张图最多有一个 Manual Trigger，由用户显式启动，不建立外部订阅或调度 binding。Webhook、Cron、Poll 和 Integration 的确定性协议、Provider definitions、Registry 与 conformance 属于公共
package；subscription、checkpoint、调度持久化、endpoint routing 和 admission 事务属于部署实现。

一次有效 Trigger occurrence 只能准入普通 Flow Run，之后复用相同的 Run、执行、事件、取消和 terminal 语义。重投 occurrence 必须通过稳定 identity
和权威 store 约束为最多一个 Run。

Integration callback 的处理生命周期同时受请求取消、部署关闭和整次 delivery deadline 约束，并向 Provider 与 Connector 传播取消。
这些取消只能停止尚未完成的回调处理，不能撤销已准入的 Run；部署不能自动重试整段 callback，以免重放 Provider 的外部副作用。

具有 `listener` 能力的 Integration 定义将已验证通知转为持久唤醒；通知与定期扫描共用同一 cursor reader，
回调不能推进扫描游标。Server 在同一事务中提交页面准入、checkpoint 与工作完成，并保留领取后新增的通知。
扫描使用独立租约和健康状态；订阅故障不能单独撤销仍然可用的扫描准入资格。旧事件型 Integration 的 callback/payload 语义保持不变。

Server 的 Poll 读取与 Integration listener 扫描由同一个监听运行时调度，共用 Connector 作用域、取消与读取 deadline。
订阅准备、续期与事件型 callback 由 Integration owner 处理，不能持有扫描调度锁。已有 Poll 的调度配置、checkpoint 与事件级去重继续作为其权威持久状态，
运行时接管不改写历史 Revision 或重新建立基线；不同读取合同分别在自己的准入事务中提交结果。

监听配置与 Connection 未变的发布保留最新进度、待处理工作与身份作用域，并以 Live publication 拒绝旧 worker 的提交。
监听范围改变时先准备独立候选，再原子切换；切换终止旧范围尚未准入的扫描工作，新范围从自己的基线开始，不承接旧范围工作。
旧订阅继续作为持久清理任务处理。Google Drive `watch_changes` 首版以同一 change stream 的 cursor/page 身份准入，
不把对象 ID 当作变化 ID，不承诺还原上游未保留的所有状态转换。

Cron 不为同一 Flow 创建重叠的未终结 Run。已有未终结 Run 时保留当前到期位置并重试；前一个 Run terminal 后最多补入一个最早未处理
occurrence，再把计划推进到当前时间之后。手动 Run 和其他 Trigger 保留各自的 admission 与 backpressure 语义。

Callback response 不能在承载 Workbench 或 Control API 的 origin 上成为 Flow 控制的可执行内容，也不能修改 cookie、跳转、CORS 或其他部署级
安全响应头。需要完整自定义 HTTP responder 时必须使用与管理面隔离的 origin。

## 5. 文档所有权

- 修改产品事实、跨模块 owner、安全边界或运行时不变量时更新本文。
- 修改 serialized model、HTTP、错误、分页或 conformance profile 时更新
  [Control API 技术参考](control/contracts/control-api.md)。
- Server 容器、环境变量、SQLite、备份和运维约束写入 [Server 容器交付](server/container-delivery.md)。
- 前端交互约束写入 [Workbench 与 Designer 前端注意事项](../.agents/skills/frontend-ui/SKILL.md)。
- 实现步骤和采纳历史只保存在 Git 历史或阶段计划中，不属于当前架构合同。
