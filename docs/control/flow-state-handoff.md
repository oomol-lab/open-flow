# Flow State / Skip Duplicates 交接

当前方案见 [设计说明](flow-state-plan.md)，公共接口和执行语义以
[Node authoring](../authoring/node-authoring.md)、[运行时契约](contracts/nodejs-runtime.md) 及
[Control API](contracts/control-api.md) 为准。

## Server 与公共包

Skip Duplicates 的类型为 `skip-duplicates`，只配置 `fields`。公共层负责确定性组合标识，
Server State Store 负责待提交记录与容量预占，RunStore 在成功终态事务中提交历史。
失败、取消及不确定终态释放记录；Wait 保留记录直至恢复后的终态。Code KV 和 Code dedupe 立即保存。

Model v13 / Engine v10 保持不变，这是产品负责人明确选择的旧节点原地替换。旧节点与旧配置直接拒绝，
没有转换或兼容执行器。实现 digest 包含 `skip-duplicates/1`；数据库迁移 60 增加待提交表并移除水位字段。
Server 与客户端需要同步升级。

## Cloud 待办

Cloud 尚需在独立仓库实现：

- D1 中按 Run/调用保存待提交标识，统一计算已提交及预占的身份和空间额度。
- 新节点执行协议与公共标识计算，Run 内比对自己的待提交历史，跨 Run 只比对已提交历史。
- 与权威 Run 终态原子一致的提交、失败清理、Wait 恢复及不确定终态处理。
- 管理接口的待提交数量、清空冲突、Flow 删除清理与匹配的实现 digest。
- 公共 conformance 及成功、失败、取消、暂停恢复、额度和终态事务回滚验收。

公共包更新不代表 Cloud 已具备上述执行能力；完成部署支持后再升级其客户端。
