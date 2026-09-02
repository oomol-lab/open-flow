# 即时协作编辑重构计划

本文记录 Flow authoring 从受控快照同步迁移到即时、多作者编辑模型的完整设计和实施顺序。它是重构计划，不是当前已经完成的协议合同；稳定后的产品边界应回写到 `docs/architecture.md`，精确 change schema 应写入对应技术参考。

## 产品目标

Human 在 Workbench 中的修改立即反映到本地画布并自动保存。短时间完成的保存不显示状态；较慢的保存显示 `saving`，完成后自动消失。远端 Revision 不得用旧 snapshot 覆盖仍有效的本地修改，也不向用户暴露 Git 式冲突处理。

Agent 通过 Command 编辑 Flow 时使用严格 compare-and-swap。Agent 必须基于刚读取的完整 Draft 提交 `expectedRevisionId`；如果期间已有其他作者提交，Server 返回 revision conflict，Agent 重新读取完整 Draft、重新理解状态并生成新的修改。Server 不替 Agent 自动 rebase。

Human 和 Agent 使用同一个 change batch、reducer、validation 和 CAS endpoint。两者只在客户端的 revision conflict 恢复策略上不同。

## 权威状态

Server 的线性 immutable Revision snapshot 是唯一持久化事实来源。Server 不保存 authoring operation log，也不提供 changes chain：

```text
server: immutable Revision snapshots + mutable Draft head
workbench session: committed snapshot + pending change batches = visible Draft
command invocation: one fetched snapshot + one CAS change batch
```

Workbench pending 只存在于当前页面 session，不写入浏览器存储，刷新页面后不恢复。该模型不承诺离线编辑或跨刷新 durability。

Realtime channel 继续只发送 invalidation。Draft sync 始终返回当前完整 snapshot；`fromRevisionId` 和 changes-chain response 不属于协议。

## Change batch

一次用户语义动作形成一个原子 change batch：

- `changeId` 是 deployment scope 内稳定的 opaque identity，用于网络重试幂等。它不承担 Lamport 排序；提交顺序只由 Server Revision 决定。
- `expectedRevisionId` 是 batch 的 CAS 前提。
- `actorId` 由认证 principal 决定，不由请求 body 声明。
- batch 内 operations 按顺序执行，任意 operation 失效时整个 batch 失败，不产生 Revision。
- batch 内 operation 不再拥有单独 identity；错误和本地依赖使用 batch 内顺序定位。
- 一个 Edge 拖动若同时创建 additional input，port change 与 connect 必须进入同一 batch。

Server 必须以 `(flowId, changeId)` 幂等接受 change。相同 identity 与相同请求返回第一次提交的 Revision；相同 identity 与不同请求失败。幂等检查先于 expected Revision 检查，因此客户端在响应丢失后可以安全重试。

## Semantic operations

现有 `ChangeOperation` 直接演进为唯一的公开 authoring change 合同，不新增第二套 intent 协议。Create、delete、connect 和 disconnect 已表达局部语义，可以保留。会覆盖较大投影的 `graph.node.replace`、`task.replace`、`binding.replace` 和 `subflow.definition.replace` 必须迁移为针对实际编辑目标的 operation。

所有可更新 operation 携带它所观察到的 `before` 和期望的 `value`。Reducer 只有在目标仍存在且当前值等于 `before` 时应用；否则 batch 失效。`undefined` 表示字段不存在，是可比较的前置状态，不使用“字段缺失等同任意值”的规则。

Operation 粒度以真实用户动作和独立冲突边界为准：

- node metadata 的单个字段分别修改；
- 单个 input mapping 分别设置或清除；
- Connector connection、Trigger config 的单个字段分别修改；
- schedule、Webhook options、Condition definition、Value outputs、Task port definitions 和 Subflow definition使用各自编辑器一次确认的完整值；
- additional input editor 的一次修改只替换 additional input definitions，不替换 node input mappings；rename 或 remove 对 mapping 和关联 Edge 的调整作为同一 batch 中的显式 operations；
- module name 与 source 保持独立；
- delete 清理引用仍由确定性 reducer 原子完成。

不为 port 增加额外持久化 identity。Handle 是当前 serialized model 的稳定语义引用；rename 由同一个本地 batch 显式改写引用。远端已重命名同一 handle 时，本地 batch 前提失效并遵循 Server-wins。

## Workbench 恢复规则

本地 change 先进入 pending queue，再更新 visible Draft。网络提交保持串行，每个 batch 总是以当前 committed Revision 为 expected Revision。

收到 revision conflict 或 realtime invalidation 时，Workbench 拉取最新 snapshot，并依次在它上面验证 pending batches：

1. 能完整应用的 batch 保留并继续提交。
2. 任意 operation 前提失效的 batch 整体丢弃。
3. 后续 batch 在新的投影上继续独立验证；只有其自身前提失效时才丢弃。
4. 最终 visible Draft 由最新 committed snapshot 加剩余 pending 确定性重建。

失效 batch 采用 Server-wins，不显示通知、不进入 conflict mode，也不阻止继续编辑。这里有意接受同一语义目标的本地修改被远端状态覆盖；目标是低摩擦协作，不是保留分叉历史。

结构操作立即排队提交。连续文本和数值输入若修改同一目标，且先前 batch 尚未开始提交，只保留最新 batch；不把不同用户动作合并为同一个 `changeId`。

`saving` 只表达存在已开始或等待提交的 pending batch。UI 延迟约 200 ms 后显示；在延迟前全部确认则完全不显示，确认后立即隐藏。

## Designer 所有权

Workbench 是 editable Draft 的唯一 owner。Designer 只消费 visible Draft，并将交互转换为 `ChangeOperation` batch。Designer 可以持有 hover、selection、展开状态和正在输入但尚未形成 change 的控件状态，不能维护第二份 Flow、node、port 或 Edge 语义投影。

删除通过 `syncingPorts`、`syncingInput`、`syncingMetadata` 等标记猜测 host echo 的路径。Incoming snapshot 只替换 committed base，再由 pending queue 产生 visible Draft，不能直接覆盖 Designer 当前语义状态。

## 瀑布流实施顺序

1. 用纯 reducer 单测固定每一种 operation 的成功、错误前提、atomic batch 和确定性结果。
2. 迁移公共 authoring helpers 和 validation，删除 whole-node、whole-task 和 whole-binding replacement。
3. 为 Server Revision commit 增加 `changeId` 幂等记录和 request digest；保持严格 expected Revision CAS。
4. 将 Draft sync 合同简化为 snapshot-only，并增加 Control API conformance。
5. 重写 Workbench pending queue：投影、串行提交、snapshot 恢复、batch 筛选和相同目标的未开始 change 合并。
6. 迁移 Designer 所有交互，只发送 semantic batch；additional input 创建和连接必须使用单个 atomic batch。
7. 为 Workbench 增加延迟 `saving` 状态，删除 conflict notice 和 echo-suppression flags。
8. 验证 Command 始终暴露 CAS conflict 和 outcome-unknown，不执行自动 rebase。
9. 增加双客户端测试，覆盖独立修改、相同目标 Server-wins、删除与编辑、additional input 与 connect、断线重试、响应丢失和 realtime invalidation。

## 完成标准

- 任意 visible Draft 都能由 committed snapshot 和当前 session pending batches 确定性重建。
- 旧 host snapshot 不会覆盖仍满足前提的本地修改。
- 同一语义目标冲突时最终无提示地采用 Server 状态；独立 pending 修改继续保存。
- 一个 change batch 最多生成一个 Revision，重试不会重复提交。
- additional input 创建及其 Edge 是一个可验证、可重试的 atomic batch。
- Human 与 Agent 没有不同的 mutation、reducer 或 validation 路径。
- Agent 使用 stale `expectedRevisionId` 时必定收到 conflict，并在重新读取前不能假定修改已生效。
- Draft sync、Revision persistence 和 realtime notification 不形成 operation log 或第二个事实来源。
