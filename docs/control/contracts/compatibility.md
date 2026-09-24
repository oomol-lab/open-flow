# 公共契约与版本演进

公共入口、序列化格式、Control API 和运行语义分别拥有版本，不能互相替代。

| 版本              | 当前值                                              | 约束                                                             |
| ----------------- | --------------------------------------------------- | ---------------------------------------------------------------- |
| npm package       | package manifest 的精确版本                         | 固定实现、类型、Workbench 资产和一致性测试集。部署锁定同一版本。 |
| Revision envelope | `kind: open-flow-flow-revision`、`version: 1`       | 固定 UTF-8 JSON 信封字段和 canonical bytes 规则。                |
| Flow model        | `modelVersion: 4`                                   | 固定 document、modules、节点和端口的序列化结构。                 |
| Control API       | `/v1`、Run 创建请求 `version: 2`，其他 `version: 1` | 固定请求字段、响应、错误码、CAS 和幂等行为。                     |
| Engine Contract   | `open-flow-engine/v5`                               | 固定执行、Trigger、Task 返回、Wait 和取消语义。                  |
| MCP               | `2026-07-28`                                        | 固定 Streamable HTTP 协商；工具的产品语义复用 Control API。      |

这些数字相同或不同都不表示兼容。旧版本也可能曾使用 `modelVersion: 1`；不得仅凭版本字段接受其内容。完整结构解码必须先于语义验证和执行。
已有不符合当前结构的 Revision 不得在读取时改写或重新计算其原有 digest；必须拒绝执行，并通过独立、可审核的数据迁移或重建产生新 Revision。
升级部署前，应先完成或取消旧 Engine 的活动 Run，或明确保留能够执行固定旧 Engine 的恢复环境。新的公共解码器不提供隐式模型迁移。

## 解码边界

`@oomol-lab/open-flow/flow-encoding` 提供：

- `decodeFlowDocument(value)`：完整 Flow document 的结构解码。
- `decodeRevisionContent(value)`：解码 `{ modelVersion, document, modules }`。
- `decodeRevision(bytes)`：严格 UTF-8、JSON、信封和内容解码，与 `encodeRevision` 配对。

普通对象忽略并移除未声明字段；Wait 节点使用严格字段校验，拒绝旧内联 notification。三者，继续校验已知字段的类型、必填项和支持的版本，嵌套深度上限为 `maxJsonDepth`。JSON 数据值和 JSON Schema 内的自定义键保持不变。结构合法不意味着图可执行：引用、标题、环、端口和模块语义继续由 Flow validation 检查。
解码不填充缺失字段、不迁移旧节点、不规范化用户源代码。`encodeRevision(decodeRevision(bytes))` 产生 canonical bytes；只有输入不含未知字段且本来就是 canonical bytes 时才保证字节不变。

`@oomol-lab/open-flow/control-requests` 提供 `controlRequests` 解码函数和 `controlRequestSchema`，覆盖 Flow 创建、改名、Draft changes、Live 启停、Presentation、检查、发布、回滚、Draft/Live Run、Wait resolution、Variable 写入和仅版本请求。
部署把解码异常映射到相应的公共 invalid 错误。HTTP body 大小、身份、scope、权限、路由参数、分页 cursor 和存储事务仍由部署负责。

`@oomol-lab/open-flow/mcp` 提供工具参数、描述、annotations、协议版本与服务说明。部署通过 Standard Schema 注册 `mcpTools`，只实现操作调用、身份和错误映射。
不能在某个部署自行增加参数默认值、改变同名工具定义或放松请求校验。业务错误保留 Control 错误码，未确认的写操作结果必须要求原参数和原幂等键重试。

## 一致性验证

- Control API 基础用例包括同时创建、CAS 编辑、同键重放与丢失响应后的重试。创建重放固定 Flow identity，但可以返回 Flow 当前元数据；Draft change 重放固定已提交 Revision。
- `controlRecoveryConformanceCases` 要求额外的 `restart()` 驱动：关闭部署服务，丢弃进程内状态，保留持久存储并重新打开。重启后必须保留 Flow identity、Draft head 和变更 receipt。它不等价于杀进程后的未知执行恢复；后者还需部署运行时的故障注入测试。
- `mcpConformanceCases` 通过真实 `/v1/mcp` 请求核对发现结果、结构和 annotations，并验证 MCP 写入、重试、错误及 REST 读取的一致性。
- `verifyWorkbenchHost` 由部署提供连接、故障、通知和时间驱动，验证首次失败不能无限阻塞加载、恢复后重新读取、正常首次连接只完成 ready、停止后不再收事件及重复 stop。

部署通过全部适用用例才可声明符合该 package 的对应 profile。测试未执行、依赖替身缺失或跳过恢复驱动时，不能声称已经验证这些保证。身份隔离、远程网关和真实基础设施的故障恢复继续由部署集成测试负责。

新增可选响应字段可以在保持现有读语义时增量发布。删除、重命名、改变字段类型、收紧合法输入、改变默认值或执行结果属于兼容性变更；必须明确提升对应合同版本或在预发布版本说明中声明断点，并提供迁移与拒绝路径。不得只升级 npm 版本后沿用旧版本标识而静默接受不同含义的数据。

## Wait 局部执行升级

Wait 局部执行在此前 beta 同步升级公共包、Command、Server，当时 Engine 为 v3、checkpoint 为 version 3。Control API 保留 /v1 信封，详情改为必需 waits 数组，新增 wait.created，run.waiting 改为 waitIds；这些是本次 beta 的显式不兼容变更，客户端和部署须一起升级。
SQLite migration 18 分离 run_checkpoints 与 wait_receipts，将 Agent 通知 work 主键改为 runId/waitId。旧 checkpoint 保留原始字节供恢复校验，当前 Engine 不执行旧 checkpoint，标记 indeterminate；不得自动重放或改写旧 Revision。
发布前需完成或取消旧活动 Run，或者保留匹配的旧执行环境。当前工作只验证本地 fixture，未读取或升级任何已部署数据库。

## 执行语义与隔离运行时标识

`engineContract` 属于公共执行合同；`engineDigest` 字段保留现有名称，标识部署的隔离运行时与宿主能力。
Server 的 `isolatedVmEngineDigest` 由隔离执行器协议、isolated-vm／Node 版本、Web globals 和 Action host 能力版本构成，
不包含 Wait、分支汇合或输入来源等 Scheduler 规则。图规则变更不单独修改该 digest。
checkpoint 使用自己的格式版本和状态一致性校验，不能用隔离运行时 digest 代替这些检查。

此前 Engine v4 将执行调度与输入来源分离。节点仅因执行分支关闭而跳过；缺失输入及普通数据输出补 `null` 后按端口声明校验，实际 `null` 仍算一个可用来源。
当时直接替换 v3，不提供旧执行合同或旧运行迁移。公共包、Command、Server 和客户端同步升级；当时 checkpoint 结构为 version 4，恢复验证采用 v4 语义并要求完整的归一化输出。

此前移除 digest 中历史的图语义标签曾使隔离运行时标识变化一次。固定旧 digest 的 Run 沿用既有不匹配拒绝路径；
不重写历史 Run 的标识，也不增加旧标识别名。此后仅修改 Scheduler 规则不会再造成隔离运行时 digest 变化。

Trigger 输出协议使用有序 outputs 定义，Provider definitionVersion 和 Webhook revision 为 2；定义摘要协议版本为 2。该次升级的 Scheduler checkpoint 版本为 4；当前为 version 5，拒绝旧版本恢复。SQLite migration 19 只重命名输出存储列，不将旧内容转换成新契约。

## 未发布阶段的 Wait pending 修订

当前 Engine Contract 保持 `open-flow-engine/v5`，Scheduler checkpoint 保持 version 5。
Wait 的提前输出端口及等待记录中的输出字段直接由 `notification` 改为 `pending`，表示等待建立时触发一次并提供确认链接及相关数据。
本次是未发布阶段的合同修订，同版本号不保证兼容此前开发快照；不提供旧名称别名、隐式转换或兼容恢复。
旧 Wait 端口和数据引用由图语义校验拒绝，checkpoint 等待记录中的旧 `notification` 字段由严格解码拒绝，不静默丢弃或重放通知。
历史 Revision 和 Run 不改写；Flow model、Control API 信封和隔离运行时 digest 不变。Agent 的 notification 配置仍表示实际通知，不受此次端口改名影响。

## beta.39 MCP 与 CLI 读取合同升级

公共包与 Command 升至 `0.1.0-beta.39`，Server 升至 `0.1.0-beta.16`。本次 beta 包含显式不兼容的工具与命令调整，客户端脚本和部署需一起升级：

- MCP `flow_get` 和 CLI `inspect --json` 默认返回精简视图；完整数据使用 MCP `full: true` 或 CLI `--full`，修订内容统一位于 `draft.content`。原 CLI `--summary` 已移除。
- MCP `connector_list` 改为 `connector_providers`，`trigger_list` 改为支持可选 query 的 `trigger_search`；CLI `connector list` 改为 `connector providers`。旧名称不保留别名。
- Connector 搜索仅返回 Action 摘要，完整 Schema 使用 `connector_get` / `connector show`；Team 目录不再返回 Flow-Team 绑定清单。
- CLI `connector set --name` 不再接受，改用 `node set --name`。结果列表和结果读取的旧位置参数改为 `--after`、`--pointer`、`--offset` 等命名选项。
- MCP `flow_run` 在输入 Schema 中明确 Draft 与 Live 身份互斥，混用字段会在调用验证时拒绝。

具体参数与迁移后的用法见 [CLI 命令](../../authoring/flow-command.md) 和 [MCP 接口](../../server/mcp.md)。本次不改变 Flow 持久化模型、Engine Contract 或 Run checkpoint 格式。
