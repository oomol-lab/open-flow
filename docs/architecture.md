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

### Flow 与 Revision

Flow 是部署生成的顶层产品资源和稳定 opaque identity，不从属于 Project。每个 Flow 独立拥有名称、生命周期、Draft head、Revision 历史、
Presentation、Publication、Live、Run 和 Trigger binding。

Flow 有一个可变 Draft head 和不可变的 Revision 历史。Revision 是该 Flow 的 graph、Subflow、Task、binding 和 CodeModule source 的完整事实来源；
语义修改必须以预期 Revision 为前提原子提交，不能静默覆盖 stale head。内部索引、缓存、增量记录和存储布局不能成为第二个事实来源。

Presentation 独立保存布局、viewport 和 Comment 等展示状态；Flow 的 overview 和 detail 模式分别拥有自己的布局和 viewport。Presentation
不进入 Revision digest，也不影响 validation、Run、Publication 或 Live。
Revision 不保存 credential、Run、Engine IR、Provider 状态或部署缓存。

### Deployment Variable

Variable 是 deployment scope 配置，不属于任何 Flow。Flow Revision 只保存大小写敏感的 Variable name binding，digest 包含 binding 与 name，
不包含 value。Variable 删除不修改 Revision；需要该 name 的首次 Publish、Rollback 或 Run admission 必须在资源创建的权威 operation boundary
内 fail closed，幂等重放必须先返回已经接受的资源。

Run 开始时从一个 deployment store snapshot 解析固定 closure 实际使用的 Variable，并把同一份值注入根图和每次 Subflow invocation。平台不能把
解析值隐式写入 Revision、Publication、持久化 Run input 或 `node.started`；Flow 代码显式返回、记录、发送或抛出该值时，它仍可进入用户数据流、
RunEvent、日志或外部系统。Variable 是 Operator 可读取的 deployment configuration，不是不可导出的 Secret Manager。

旧 Project schema、Project API 和 Project 数据不属于当前产品合同。部署发现旧的未发布 schema 时直接重建当前 Flow schema，不迁移或保留旧
Project、Flow、Publication、Run 或 authoring history。

### Scope、身份与通知

部署必须从认证 principal 确定稳定 scope。客户端选择的 scope、operator identity、workload authority 和 callback endpoint identity 不能互相替代。
切换 deployment scope 必须销毁旧 session、请求和实时订阅。

Workbench 使用两个彼此独立的实时通知通道：

- Flow catalog 通道只发送 `flows.changed`，用于重新读取顶层 Flow 列表；
- 当前 Flow 通道发送该 Flow 的 `draft.changed` 和 `run.created`。

CLI、Workbench 或其他客户端通过 Control API 创建、改名或删除 Flow 时，部署必须使 catalog 通道可观察到变化。两个通道必须能独立连接、
断线和重连；重连后客户端通过普通 Control API 恢复权威状态。通知只是 invalidation，不是 Revision、RunEvent、协作日志或消息队列。

### 生命周期与 retention

Flow 删除先进入 `retiring`，立即阻断新的 mutation、Run、Publish 和 Trigger admission，再由该部署唯一的 lifecycle owner 清理关联资源并物理删除。
完成后不保留可恢复 tombstone 或 authoring history；失败恢复只能继续同一个删除流程，不能形成第二条清理状态机。

RunEvent 明细可以按部署声明的 retention 到期，但唯一 terminal result 必须独立保留，直到所属 Flow 的物理删除流程清理该 Run。

## 2. 源码与模块所有权

本仓库是公共合同、可移植实现、Workbench runtime 和 Server 的唯一可编辑源码事实源。

- `packages/open-flow` 拥有公共类型、严格 decoder、Control API client、black-box conformance、Flow/Run/Trigger 的确定性语义、程序化
  authoring API、产品中立 Workbench runtime 和内层 UI。
- `packages/command` 拥有 CLI 行为、Command Host boundary、Command Artifact 协议、确定性 archive 构建和发布。它只通过
  `packages/open-flow` 的公开 package entry 消费产品合同。
- `apps/server` 拥有 Server application lifecycle、SQLite、HTTP adapter、本地调度、具体 `isolated-vm` host、同源 Workbench host 和 Docker 交付。
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

权威 validation 的输入是固定 Flow Revision、model version 和 Engine Contract。它必须确定性检查 graph、Module、Task 和 closure，不读取
credential value、Provider 当前状态、调用权限或部署资源。非确定性 eligibility 必须在 Run 或 Publish 的 operation boundary 重新检查。

Engine Contract、部署中立 Runtime invocation、Scheduler 图执行语义、RunEvent 投影和 conformance 属于 `packages/open-flow`。具体执行隔离、
Engine digest、资源限制和恢复属于部署实现；`isolated-vm` RuntimeHost 只属于 Server。

普通 Flow 数据通过声明的 input、output、edge 和 binding 传播，并在 Runtime invocation、Scheduler、Subflow、RunEvent 和 terminal result
边界保持可序列化。脚本 `context` 只提供取消、日志、进度、Artifact、网络、Connector 等宿主能力和只读运行身份，不提供跨节点的动态
Run store、Variable 查询或任意节点输出查询。部署可以为调度、调试和恢复私有保存 Run value，但不能把内部存储变成第二条用户数据通道。

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

用户代码只在隔离 realm 中获得目标 closure、固定 platform module 和当前 Task invocation 明确声明的窄 Capability。Capability host 必须校验当前
Flow、Run、Task、invocation、binding 和 Run 状态；Task 或 Run 结束后旧 Capability 必须 fail closed。

## 4. Publication、Connector 与 Trigger

Publication 是 Flow 在固定 Revision 上的不可变发布记录。每个 Flow 独立拥有 Publication 历史和最多一个 Live pointer。Publish 必须在一个权威
operation boundary 内完成 validation、binding、eligibility 和 Live 更新；Rollback 创建新 Publication，不修改历史记录。

Connector service 拥有 Provider 授权、credential、Connection lifecycle 和 proxy transport。Open Flow 只保存稳定的 opaque Connection identity，
不能把 credential、token 或 Connector 数据库复制进 Revision、Browser 或 RunEvent。Connector catalog 和 Connection 是 deployment scope 资源，
不从属于单个 Flow。

Trigger 是 Flow graph 中的 source node。Webhook、Cron、Poll 和 Integration 的确定性协议、Provider definitions、Registry 与 conformance 属于公共
package；subscription、checkpoint、调度持久化、endpoint routing 和 admission 事务属于部署实现。

一次有效 Trigger occurrence 只能准入普通 Flow Run，之后复用相同的 Run、执行、事件、取消和 terminal 语义。重投 occurrence 必须通过稳定 identity
和权威 store 约束为最多一个 Run。

Callback response 不能在承载 Workbench 或 Control API 的 origin 上成为 Flow 控制的可执行内容，也不能修改 cookie、跳转、CORS 或其他部署级
安全响应头。需要完整自定义 HTTP responder 时必须使用与管理面隔离的 origin。

## 5. 文档所有权

- 修改产品事实、跨模块 owner、安全边界或运行时不变量时更新本文。
- 修改 serialized model、HTTP、错误、分页或 conformance profile 时更新
  [Control API 技术参考](control/contracts/control-api.md)。
- Server 容器、环境变量、SQLite、备份和运维约束写入 [Server 容器交付](server/container-delivery.md)。
- 前端交互约束写入 [Workbench 与 Designer 前端注意事项](authoring/frontend-ui.md)。
- 实现步骤和采纳历史只保存在 Git 历史或阶段计划中，不属于当前架构合同。
