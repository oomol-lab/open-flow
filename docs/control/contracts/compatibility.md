# 公共契约与版本演进

公共入口、序列化格式、Control API 和运行语义分别拥有版本，不能互相替代。

| 版本              | 当前值                                        | 约束                                                             |
| ----------------- | --------------------------------------------- | ---------------------------------------------------------------- |
| npm package       | package manifest 的精确版本                   | 固定实现、类型、Workbench 资产和一致性测试集。部署锁定同一版本。 |
| Revision envelope | `kind: open-flow-flow-revision`、`version: 1` | 固定 UTF-8 JSON 信封字段和 canonical bytes 规则。                |
| Flow model        | `modelVersion: 1`                             | 固定 document、modules、节点和端口的序列化结构。                 |
| Control API       | `/v1`、JSON `version: 1`                      | 固定请求字段、响应、错误码、CAS 和幂等行为。                     |
| Engine Contract   | `open-flow-engine/v2`                         | 固定执行、Trigger、Task 返回、Wait 和取消语义。                  |
| MCP               | `2026-07-28`                                  | 固定 Streamable HTTP 协商；工具的产品语义复用 Control API。      |

这些数字相同或不同都不表示兼容。旧版本也可能曾使用 `modelVersion: 1`；不得仅凭版本字段接受其内容。完整结构解码必须先于语义验证和执行。
已有不符合当前结构的 Revision 不得在读取时改写或重新计算其原有 digest；必须拒绝执行，并通过独立、可审核的数据迁移或重建产生新 Revision。
升级部署前，应先完成或取消旧 Engine 的活动 Run，或明确保留能够执行固定旧 Engine 的恢复环境。新的公共解码器不提供隐式模型迁移。

## 解码边界

`@oomol-lab/open-flow/flow-encoding` 提供：

- `decodeFlowDocument(value)`：完整 Flow document 的结构解码。
- `decodeRevisionContent(value)`：解码 `{ modelVersion, document, modules }`。
- `decodeRevision(bytes)`：严格 UTF-8、JSON、信封和内容解码，与 `encodeRevision` 配对。

三者拒绝未知字段和不支持的版本，嵌套深度上限为 `maxJsonDepth`。结构合法不意味着图可执行：引用、标题、环、端口和模块语义继续由 Flow validation 检查。
解码不填充缺失字段、不迁移旧节点、不规范化用户源代码。`encodeRevision(decodeRevision(bytes))` 产生 canonical bytes；只有输入本来就是 canonical bytes 时才保证字节不变。

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
