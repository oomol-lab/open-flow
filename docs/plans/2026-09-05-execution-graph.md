# Flow 执行依赖图改造计划

本文保留此次改造的目标设计与实施顺序。新执行图已按下述范围实施，稳定产品边界见 `docs/architecture.md`，精确序列化与事件合同见 `docs/control/contracts/control-api.md`。下文“改造前实现”用于说明本次替换范围。

## 1. 已确定的目标

Flow 从数据驱动的执行模型改为显式执行依赖图：画布连线表达任务先后关系，节点输入绑定表达数据来源。

- 执行连线独立于输入绑定存在。不消费上游结果，也可以依赖上游完成。
- 在一次图调用中，普通节点最多执行一次。多条入边不分别触发执行，多个 output handle 不产生多次执行。
- 节点成功完成时，一次性校验并提交最终 outputs。删除 `context.outputs(...)` 及运行中途向下游投递结果的能力。
- 下游可以显式引用同一图作用域内、沿执行连线向前且保证已成功完成的祖先节点 output handle，无需中间节点透传。
- 输入引用不隐式创建执行连线，也不成为第二套调度规则。
- 删除普通节点的 `concurrency` 字段、编辑入口及同一节点多实例并发调度。
- 不同分支仍可并行，部署已有的 Run 并发与执行时间限制继续生效。
- 数组是普通数据，不隐式展开成多次执行。此次不引入循环、Map、批处理或新的并发配置。
- 日志、进度与已有运行预览能力继续用于观察执行，不触发下游；不为替代中途 output 额外建设一套预览系统。

典型流程：

```text
获取订单 → 审批 → 发送通知

发送通知.recipient = 获取订单.customerEmail
发送通知.result = 审批.result
```

审批不需要透传订单字段。发送通知等待审批完成后，取得两个祖先各自唯一的最终结果。

## 2. 改造前实现与改造边界

- `packages/open-flow/src/flow/common/change.ts`：Graph 原先只保存 nodes；节点输入使用 sources，节点基础字段包含 concurrency。执行关系需要成为 Revision 内独立的语义事实。
- `flow/common/edgeChanges.ts`、`change.ts` 与 `workbench/browser/runtime/workspace.ts`：连接操作修改 input mapping，画布边从 mapping 推导。需要拆开连接操作和输入绑定操作。
- `flow/common/semantics.ts`、`encoding.ts`：负责 validation、准备执行和编码；需统一新图的合法性、祖先引用、digest 与闭包语义。
- `execution/common/scheduler.ts`：原先通过输入 buffer、重复 job 和 activeCounts 调度，checkpoint 保存队列及多次执行结果。需要换成一次执行的依赖调度和结果快照。
- `execution/common/runtime.ts` 与 `apps/server/node/isolated-vm*.ts`：需要移除中途 output 的公共能力及宿主桥接。
- manifest/schema、Designer、Workbench、公共 authoring API 和 `packages/command`：消费同一底层模型，不能自行补造执行关系或维护另一套结果可用性规则。

保留 Flow、Revision、Publication、Run、Trigger、Variable、Capability 与模块所有权。此次只修改为新图语义所必需的合同与实现。

## 3. 执行与数据规则

### 3.1 普通依赖和并行

`A → B` 表示 A 成功完成后 B 才能开始，即使 B 的输入全部是常量也如此。无入边的普通节点作为当前图调用的根节点就绪；Trigger 的启动范围需要在第一阶段与现有手动运行和 Trigger admission 合同一同明确。

普通并行汇合等待所有前驱成功完成：

```text
    ┌→ B ─┐
A ──┤     ├→ D
    └→ C ─┘
```

B、C 可以同时运行。D 等待两者完成，只执行一次，并可引用 A、B、C 的结果。运行先后速度不影响绑定值的选择。

图必须无环。此次不把回边解释为循环，也不保留通过输入反馈触发重复执行的行为。

### 3.2 最终结果

节点返回后，先验证整个结果的声明、类型与可序列化性，再将结果整体变为可供下游读取的状态。任何字段校验失败，都不能让其他字段提前触发下游。

失败、取消和超时不发布可消费结果。成功提交后的 outputs 在当前图调用内保持不变。明确完成与取消竞争的提交点，并继续遵守 Run 唯一 terminal 与已有取消传播规则。

没有声明输出的任务仍可通过成功完成释放后继依赖。返回空对象或 undefined 的合法性按声明统一规定，不再保留“此前调用过 context.outputs”这一特殊前提。

现有 `node.output` 是否保留为最终结果的逐字段展示事件，应在事件合同阶段决定；即使保留，也不能承担调度或部分结果提交的职责。节点成功、结果发布与下游 started 的顺序必须有明确合同和测试。

### 3.3 祖先输入引用

继续使用显式节点 identity 和 output handle 绑定，不开放脚本任意节点查询或跨节点动态 Run store。脚本只获得自己的 inputs 和原有宿主能力。

validation 检查来源节点与 handle 存在、类型匹配、作用域正确，并保证目标执行时来源已成功完成。拒绝自身、后继、无依赖的并行节点、未连接节点和跨子流程内部引用。

祖先判断以执行图为准；分支下还必须考虑执行路径。仅有图可达性不足以证明结果可用。

输入的常量、Flow input 和 Variable binding 来源继续保留。一个普通 input 应解析为一个确定的值；不能将现有 sources 数组继续解释为事件队列或多次执行。现有多来源输入与图输出的用途必须逐项核查，将互斥路径结果选择与普通单值绑定分别定义，不能采用隐式“最快值”或“最新值”。

### 3.4 分支与汇合

条件分支出口和 Wait action 表达执行路径选择，普通 output handle 表达数据字段，两者必须在合同和编辑器中区分。

目标规则：

- 普通并行汇合等待全部前驱成功。
- 互斥分支汇合等待被选中路径完成；未选中路径被跳过，不永久等待。
- 全部进入路径都被跳过的节点也应被跳过，不能因“没有待完成前驱”而误启动。
- 汇合后可以引用保证完成的共同祖先，不能直接引用可能未执行的分支内部结果。
- 分支结果需要通过显式、确定的合并规则提供给汇合后的节点。
- 失败不等于跳过，不能用跳过规则吞掉失败；保留既有 sibling failure 与取消传播。

分支选择是否互斥、无匹配条件如何结束、嵌套分支如何汇合，以及现有 Condition 与 Wait 的数据输出如何与路径出口分开，必须在第一阶段用规格测试落定。显式结果合并优先复用经澄清的现有 mapping 能力；不在此计划中预设新节点或复杂表达式系统。

### 3.5 Subflow、Trigger 与 Wait

- 每次 Subflow invocation 拥有独立的节点执行状态与最终结果。内部通过声明的图 inputs/outputs 与外部交换数据，不能穿透作用域引用内部节点。
- Subflow 成功完成后才向父图提交最终输出，不再通过 callback 提前向父图投递 output。
- Trigger occurrence 继续准入一个普通 Run；明确选定 Trigger、其他 Trigger、无入边节点在当前调用中的就绪和跳过规则。此次不增加 Trigger fan-in 或新的 admission 语义。
- Wait 暂停和恢复保持同一 runId、固定 Revision 与执行预算。checkpoint 保存依赖状态、路径选择、已提交结果和当前 Wait，移除仅服务重复执行的输入队列与 job 序号。
- 恢复不得重跑已完成节点、重新读取 Variable 当前值或重新执行已发生的外部副作用。并行分支到达暂停边界时的处理继续保持一致的可恢复快照，不在活跃任务尚未确定结果时保存不完整状态。

## 4. 编辑和协议行为

- 连线创建和删除只修改执行关系；输入来源选择只修改绑定。复合用户动作仍通过同一原子 change batch 完成。
- 修改执行连线导致绑定不再有效时，保留绑定并给出定位明确的 diagnostic，不自动补线或清空。Draft 可以表达待修复语义，Run 和 Publish validation 必须阻止无效图。
- 节点删除、handle 删除或重命名继续遵守现有确定性、原子编辑约定；区分实体已不存在与单纯执行关系改变，避免制造两套清理规则。
- Designer 的 overview 与 detail 都展示相同执行关系；数据字段继续在节点输入输出与配置面板中展示，不能保留另一个可编辑的旧数据连线模型。
- 输入来源选择器按有效祖先节点分组显示 outputs；已有无效绑定必须可见且可修复。合法来源由公共语义层提供，Workbench 不复制分支可用性算法。
- CLI 分别提供连接执行依赖和设置输入来源的操作，帮助、JSON 合同、导入导出和公共 authoring API 同步更新。
- 继续沿用 Revision CAS、change identity 与客户端同步规则；执行边与输入绑定都参与 Revision digest，Presentation 不参与。

## 5. 瀑布式实施顺序

### 阶段一：底层模型与规格

1. 盘点现有 sources、Condition、Wait action、Trigger、Subflow output 的实际语义和测试，列清会被删除的重复触发行为。
2. 用普通链、菱形并行、互斥汇合、嵌套分支、Wait 恢复示例固定第 3 节尚需落定的细节，包括显式结果合并和 Trigger 启动范围。
3. 更新 Graph、input/output mapping、严格 decoder、schema、encoding 与 digest；删除节点 concurrency。新增或提取 TypeScript 类型前，按仓库要求请用户选定名称，不在计划中预设新类型名。
4. 更新公共 change reducer 与 authoring helpers，将执行连接和数据绑定拆开，保留原子 batch 与 CAS 语义。
5. 完成静态 validation、祖先结果可用性及错误定位的规格测试。优先在准备图时建立必要索引，不在每次读取 input 时扫描整图。

阶段出口：底层可独立接受、保存并验证新图；有效与无效分支引用有明确判定；上层无需为缺失合同打补丁。

### 阶段二：公共执行器与事件

1. 将 scheduler 改为依赖满足后最多启动一次，保留不同节点的并行执行与 Effect 生命周期。
2. 实现结果整体校验、提交和祖先 input 解析，删除按数据到达触发的 buffer 队列、重复 job 调度和 activeCounts。
3. 实现路径选择、跳过传播与汇合，确保无死锁、无提前启动、无重复执行。
4. 删除 runtime context.outputs 和 Subflow 中途投递，更新返回值、Runtime invocation 与脚本类型合同。
5. 更新 RunEvent、terminal result、进度和 checkpoint。结果结构不再为不存在的重复执行保留语义层；执行 identity 只在日志、恢复等真实消费者需要时保留。
6. 先通过公共 scheduler、runtime、事件与恢复规格测试，再进入宿主和客户端。

阶段出口：纯公共实现可以完整执行目标流程，事件和恢复不依赖旧数据流语义。

### 阶段三：Server 与持久化适配

1. 更新 isolated-vm host、executor session 与消息桥接，移除 outputs 能力暴露、消息和 callback。
2. 更新 Server 结果投影、Wait checkpoint 持久化与恢复，保持现有资源限制、取消、唯一 terminal 和外部副作用边界。
3. 将 Revision、Publication、Engine 合同及 admission 直接切换为新模型，不实现旧版本读取、转换或执行路径。
4. 增加 Control API conformance 与 Server 集成验证，覆盖保存、校验、运行、暂停、恢复和结果读取。

阶段出口：部署通过公共合同执行新模型，Workbench 和 Command 无需自行解释或修补运行状态。

### 阶段四：Workbench、Designer 和 Command

1. 更新画布边投影、连接交互和 change batch，删除端口数据连线承担执行语义的路径。
2. 更新输入来源编辑器，提供有效祖先的 handle 选择、来源展示和无效绑定修复。
3. 删除 concurrency 配置、context.outputs 编辑器提示和旧脚本模板；更新运行结果与跳过状态展示。
4. 更新 Command、公有 authoring API 消费端、导入导出、示例和对应帮助。
5. 修改 Select、popup、portal、focus 等交互前读取 `docs/authoring/frontend-ui.md`。只使用仓库测试、检查和构建验证 UI，不启动或自动化浏览器。

阶段出口：人和 Agent 都能完整创建及修改新图；没有旧数据连线或隐式调度入口。

### 阶段五：删除旧行为并交付

1. 清理遗留 schema 字段、旧消息、旧队列、脚本声明、模板、测试 fixture 和描述。不保留双引擎、feature flag 或静默兼容 adapter。
2. 将已实现的执行不变量更新到 `docs/architecture.md`；把精确字段、事件、错误和版本合同写入技术参考，不把实施历史塞进架构文档。
3. 运行完整检查与发布包验证，复查变更仅覆盖本计划目标。

## 6. 不兼容旧数据

本次明确不做旧数据兼容，直接替换旧模型。旧 Flow、Revision、Publication、Run 和 checkpoint 不属于新模型的兼容或迁移范围。

不安排存量支持评估、数据迁移、旧协议适配、双版本 decoder、双引擎或专用升级工具。公共类型、序列化、运行时、客户端、示例和测试直接更新到新合同，删除旧字段和旧行为。

Wait 恢复只支持新模型生成的 checkpoint，不恢复旧 waiting Run，也不从起点重放。外部输入继续由当前合同的严格 decoder 校验，不为旧数据增加特殊处理分支。

## 7. 必须保留的行为测试

| 场景                               | 验收结果                                       |
| ---------------------------------- | ---------------------------------------------- |
| B 不读取 A 的 output，但存在 A → B | B 仍等 A 成功完成                              |
| A → B → C，C 引用 A 和 B           | B 无需透传，C 得到唯一最终结果                 |
| 并行 B、C 汇合到 D，完成次序互换   | 保持并行，D 等待两者且只执行一次               |
| 一个返回对象部分字段无效           | 整体失败，下游不消费任何部分结果               |
| 无 output 的成功任务               | 后继正常启动                                   |
| 数组输出、多个字段或多个入边       | 不隐式增加节点执行次数                         |
| 无连线、自身、后继或跨作用域引用   | validation 拒绝并定位 input                    |
| 删除执行边使绑定失效               | 保留可修复绑定，Run/Publish 被阻止             |
| 互斥、嵌套分支及全部路径跳过       | 未选节点不启动，汇合无死锁或提前启动           |
| 引用可能跳过的祖先                 | validation 拒绝；显式合并按已定规则取值        |
| 条件无匹配及 Wait approve/reject   | 按确定路径规则结束，不依靠缺失 output 猜测路径 |
| 多次独立 Subflow invocation        | 结果隔离，父图只消费完成结果                   |
| Trigger Run 与手动 Run             | 根节点和各 Trigger 就绪范围符合固定合同        |
| 失败、取消、超时与完成竞争         | 不重复启动、不发布失败结果、唯一 terminal      |
| Wait 与并行分支、进程恢复          | 已完成节点不重跑，路径和祖先结果不丢失         |
| 输入绑定与执行边的 CAS/batch 冲突  | 原子性、幂等和 Revision digest 正确            |
| UI 与 CLI 创建等价流程             | 生成同一底层语义，validation 和运行结果一致    |

测试应覆盖真实行为，不保留只断言 class、markup、组件接线或库实现细节的低价值测试。删除旧语义测试时，用对应的新不变量替代，不能通过减少断言隐藏回归。

## 8. 完成标准与检查

- 图中任务先后由执行边唯一决定，input mapping 只取数据。
- 当前图调用内每个普通节点最多启动一次，祖先引用有唯一且已提交的结果。
- 中途 outputs、节点 concurrency 和隐式数据队列重复执行已从公开合同及实现中删除。
- 分支、Subflow、Trigger、Wait 和恢复完整使用新模型。
- Workbench、Command、Server 与公开 npm 包只消费同一套合同。
- 不存在旧数据迁移、旧协议兼容、旧 checkpoint 恢复或双模型执行路径。

实施过程中按阶段运行相关测试，最终运行：

```bash
rtk bun run format
rtk bun run check
rtk bun run test
rtk bun run build
rtk bun run test:package
```

UI 按仓库要求使用测试、检查与构建验证，不启动浏览器。
