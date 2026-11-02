# Flow State 与 Skip Duplicates

本文件记录当前产品边界。精确接口以 [Node authoring](../authoring/node-authoring.md)、
[运行时契约](contracts/nodejs-runtime.md) 和 [Control API](contracts/control-api.md) 为准。

## Code 的显式状态

`context.state` 保存少量业务 KV；`context.dedupe` 提供 Flow 共享空间的集合检查与插入。
两者均立即持久化，失败和取消不会回滚已经完成的显式写入。调试和正式运行的数据相互隔离。

## Skip Duplicates

节点解决反复获取列表时，只放行此前成功 Run 尚未记录的条目这一任务。配置仅包含标识字段列表，
支持单字段和组合标识；空列表使用字符串或数字条目本身。节点无水位、共享范围或时间窗口选项。

标识包含排序后的字段定义和对应的有类型标量值，通过公共哈希实现计算。节点的待提交记录归属 Run
及具体调用，在节点失败时撤销本批。Run 内的后续调用可见自己的待提交记录，其他 Run 只比对已提交历史。
不同 Run 暂停重叠时可能处理相同条目，下游副作用也可能在失败重试后重复。

State Store 保存待提交记录及容量预占。RunStore 在同一个终态事务中提交成功 Run 的记录，或释放
其他终态的记录。暂停期间保留待提交状态，恢复后继续使用；重启后被判定为不确定的 Run 不自动重放。
业务历史仍属于 Flow/source/node，不归属于某个 Revision。改名、发布和回滚不清空记录。

## 配额与管理

每个 Flow/source 默认最多 1,000 个 KV、每值 64 KiB、10,000 个集合标识、100 个空间；
每 Run 最多尝试 1,000 次写入。待提交标识和空间参与额度计算，同一身份跨 Run 的预占只计算一次。
Code 写入遵守同一额度，成功终态提交不会再次消耗业务写入预算。

管理接口分别展示已提交和待提交数量，不返回原始标识或哈希。存在待提交记录的空间不能清空，
需要先结束或取消相关 Run。Workbench 默认操作调试数据，正式运行数据的重置需要确认。

## 交付边界

按产品负责人决定，直接替换旧节点，保留 Model v13 / Engine v10，不提供旧节点迁移或兼容执行器。
具体发布基线与同步升级要求见 [契约演进](contracts/compatibility.md)。本仓库实现公共包、Server、
CLI/MCP 和 Workbench；Cloud 在独立仓库实现同样的暂存、终态提交、额度与清理语义。
