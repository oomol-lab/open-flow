# Agent 代码计算工具

状态：已实施。

## 1. 目标与范围

Agent 可以临时生成 JavaScript，对当前节点输入和已取得的工具结果做筛选、排序、统计、转换，返回 JSON。
完整数据通过结果引用进入执行器，不要求模型先分页读取并把正文重新写入工具参数。

第一版不提供网络、Connector、文件系统、环境变量、依赖安装、Flow 编辑或跨调用变量环境。
生成的代码属于 Run 调用记录，不创建 CodeModule、不修改 Revision、不创建新的图节点或 Run。
业务动作继续通过已声明的 Connector 工具执行，保留原有账号、固定参数和审批语义。

## 2. 作者配置

Agent executor 增加可选 `code: boolean`，缺省为 false。它是 Revision 固定的执行能力声明，不是部署开关。
Workbench 在 Agent 的“更多设置”中提供“代码计算”开关，说明“允许 Agent 使用 JavaScript 处理输入和工具结果，不访问外部应用”。
不要求配置账号、代码正文或逐次审批。代码由模型在运行时生成。

启用后注册内置工具 `run_code`。无论是否启用，`run_code` 和 `read_result` 都是保留工具名，作者不能声明同名业务工具。
工具集合上限仍为 64 个 Connector 工具；允许 `tools: []`，但仅当 `code: true` 时有效。
只启用代码计算的 Agent 不要求部署 Connector；仍要求模型配置。审批通知如使用 Connector，独立保留其能力检查。

公共模型、严格 decoder、语义检查、变更编码和 Command authoring 必须同步支持该字段，不在 Workbench 中绕过底层校验。

## 3. 模型调用合同

`run_code` 输入：

```json
{
  "code": "export default function (inputs) { return inputs.mail.messages.map(m => ({ id: m.id, subject: m.subject })); }",
  "inputs": {
    "mail": { "kind": "result", "resultId": "..." },
    "options": { "kind": "input", "input": "options" },
    "count": { "kind": "value", "value": 5 }
  }
}
```

`code` 是单个 JavaScript ES module，必须 default export 一个函数。函数接收宿主解析后的 `inputs`，返回 JSON；允许 Promise 返回。
使用完整模块而非字符串拼接函数体，让现有 RuntimeProgram 模块编译负责解析和入口校验。
不支持 TypeScript、第三方 import 或导入其他 Flow 模块。

`inputs` 是名称到来源的映射，每个来源必须严格匹配以下之一：

- `value`：调用中明确给出的 JSON 值。
- `input`：当前 Agent invocation 中真实存在的输入接口名。
- `result`：当前 Agent invocation 已取得的结果 ID。

第一版引用完整结果，不增加另一个 JSON Pointer 选择协议。代码可自行访问所需字段。
宿主校验结果引用集合、Run/invocation 归属和 digest，再注入独立数据副本；不能通过猜测 ID 访问其他结果。
结果不是代码字符串，不能通过拼接源码注入；模型也拿不到存储句柄或宿主对象。

## 4. 隔离执行

复用 `apps/server/node/runtime/isolated-vm.ts` 的 `IsolatedVmHost.invoke()`。
Run owner 负责传入已有执行宿主，由部署适配代码构造单模块 RuntimeProgram；不启动嵌套 Scheduler。
程序模块闭包只包含此次源码，导入列表为空。入口包装只将解析后的输入交给作者函数。

调用传入空 Connector capability 声明，并使用拒绝所有业务 capability 请求的 handler。
必须验证现有 platform/global 接口不能成为旁路：即便代码直接访问 context、fetch 或平台模块，也不能执行外部操作。
复用执行器基础不等于复用 Code Task 的能力授权。

每次调用创建独立 isolate；不保留变量，不向代码传递 ivm Reference 或 host callback。
执行使用固定 Engine contract/digest。若实现修改执行器合同，按现有规则更新 digest 和分发产物。

初始部署预算：源码 64 KiB、解析后输入总量 32 MiB、JSON 输出 32 MiB、isolate 内存 256 MiB、CPU 执行片段 1 秒、单次墙钟 5 秒。
这些预算属于宿主常量，模型不能修改。内存上限独立生效，输入符合字节限制不承诺一定可完成计算。
同时服从 Agent/Run 剩余时间和取消信号；不能因单次计算获得新的节点或 Run 时间预算。
CPU 限制沿用现有执行器的 V8 调用 timeout，覆盖入口和 Promise 继续执行；跨定时器的总执行受单次墙钟限制。

第一版不新增 console 日志 API。结果、错误、源码与耗时通过工具记录观察。

## 5. 调用、结果和恢复

调用沿用 Agent 工具批次的串行顺序；代码执行不会绕过模型轮数上限。
调用身份沿用 invocation、模型轮数、provider toolCallId 的稳定组合。
成功结果必须先保存，之后才能进入模型消息和成功日志。

代码输出复用 `{ kind: "stored-result", result, page }`，继续享受完整结果存储、分页、历史压缩、下载和配额管理。
它也加入当前 invocation 的引用集合，可被下一次 run_code 或 read_result 使用。
无 JSON 输出、循环对象、BigInt、非有限数等必须按既有 JSON 边界规则明确拒绝，不能静默丢字段或转成 null。

当前 ResultHost/ResultStore 的写入 API 依赖 AgentTool。应把持久化调用身份收窄为真正需要的字段，
让 Connector 与代码调用都能提供工具身份和参数摘要；不要伪造 Connector action、账号或审批声明。
结果来源必须能区分 Connector 与内置代码计算，并贯通 Control API、decoder、CLI 和 Workbench。
技术合同中的结果身份字段及数据库迁移在此步骤一起完成，不让上层通过字符串前缀猜测来源。

恢复时验证代码、来源声明和引用 digest 与既有调用记录匹配。已有成功调用直接返回保存结果，不重复执行。
不能从日志推导恢复事实，也不能通过重新调用外部 Action 补回缺失输入。
未确认完成的执行继续遵守 Run 的不确定恢复语义，不因为代码没有外部副作用就引入另一套自动重放规则。

## 6. 错误与取消

可反馈模型修正：源码语法错误、普通运行时异常、输入名错误、不可用的引用请求、非法 JSON 输出。
模型后续提交修正代码属于新的工具调用，仍受模型轮数和运行预算限制。

终止 Agent：已授权引用的数据丢失或 digest 不符、结果持久化失败、执行器崩溃、资源限制、取消及 deadline。
引用请求不合法与已有恢复事实损坏必须区分；不能把存储损坏伪装成模型参数错误。
错误内容来自本次执行并有长度限制，不包含服务器栈、宿主路径或凭据。
取消后禁止提交成功结果；取消与完成竞争以 Run owner 的现有权威状态为准。

## 7. Workbench 与运行记录

“代码计算”属于内置能力，放在“更多设置”中；复用共享开关、字段说明和折叠样式。
不提供源码编辑表单，用户在运行详情中检查模型实际生成的代码。

执行过程显示“代码计算”、执行状态和耗时。展开详情显示源码、输入来源、输出引用或错误。
工具调用统计纳入代码计算，结果读取仍单独表达，不把内部读取计为新的业务调用。
结果浏览器能展示代码计算来源，不能显示成假 Connector 动作。

## 8. 实施顺序与验收

1. 公共能力声明与测试：code 字段往返、保留名称、仅代码 Agent、禁用时不可调用，以及 Connector eligibility。
2. 结果身份与存储合同：支持内置来源、参数身份校验、配额、范围隔离、恢复；同步 API/CLI 解码。
3. 部署执行适配：复用 IsolatedVmHost，验证隔离、无网络和无平台能力、CPU/墙钟/内存限制、取消和 JSON 边界。
4. Agent 注册与生命周期：输入引用解析、执行、持久化、普通错误修正、fatal 传播、checkpoint 恢复。
5. Workbench 配置与日志：内置能力开关、保存反馈、代码详情、结果来源与调用统计。
6. 更新 architecture 的临时代码执行边界，以及 Agent、Runtime 和 Control API 的技术合同。

关键行为测试：

- 数 MiB 的模拟邮件结果通过引用进入代码，模型只看到统计输出，Connector 实际调用一次。
- 上一次代码计算输出可以作为下一次输入；多个输入引用的总量受限。
- 越权结果 ID、未知输入名、同名保留工具、禁用能力不可绕过宿主。
- fetch、平台 capability、动态 import、宿主对象探测均不能取得外部能力。
- 无限循环、异步不结束、内存耗尽、取消竞争不会继续执行或提交成功结果。
- 语法错误可在后续模型轮次修正；资源限制与宿主失败不能被模型吞掉。
- 审批暂停并重启后，已成功计算不重跑，结果引用仍可读取；正文损坏明确终止。
- 纯代码 Agent 在没有 Connector 的部署可运行；带业务工具或审批通知时仍执行对应能力检查。

执行仓库 format、check、test、build 与 test:package；不使用真实外部写操作作为验证，也不启动浏览器自动化。
