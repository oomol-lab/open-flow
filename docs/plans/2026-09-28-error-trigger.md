> 设计修订：配置方向已改为仅在 Error Trigger 节点多选已发布上游，移除源 Flow 的错误处理选择入口。当前实现与契约以 [Error Trigger](../error-trigger.md) 为准；下文保留最初方案背景。

# Error Trigger 实施计划

状态：已实施。公共模型、Server 持久化派发、Workbench 与 Lab 已接入；实现合同见 [Error Trigger 使用说明](../error-trigger.md) 和 [Control API](../control/contracts/control-api.md)。

## 1. 目标与范围

提供内置 Error Trigger：生产自动运行失败后，将失败上下文交给指定 Flow，执行通知、记录或用户编排的处理逻辑。
多个源 Flow 可以共用一个错误处理 Flow；错误处理目标必须是另一个 Flow，禁止选择源 Flow 自身。

复用现有 Revision、Publication、Trigger admission、普通 Run 和 Maintenance；不引入通用事件总线、外部队列或第二套执行器。
范围包含公共模型与协议、Server 持久化和运行机制、Workbench、Lab、受影响的 CLI/MCP 消费者以及文档和验证。

首版不包含生产 Run 自动重试、任意节点错误分支、发布失败告警、外部订阅健康告警、未准入请求的错误处理，
也不提供跨部署或跨 scope 的错误处理关联。
本文的 scope 指当前部署已有的数据与访问边界，不新增 Flow 分组、租户结构或独立的 Flow scope 模型，也不与 Connector 调用 scope 混用。

## 2. 产品语义

| 项目     | 实施行为                                                                                    |
| -------- | ------------------------------------------------------------------------------------------- |
| 节点     | 根 Flow 可有一个 Error Trigger，作为独立 source node；Subflow 不允许放置                    |
| 关联     | 源 Flow 显式配置一个错误处理 Flow；不配置则保持原行为                                       |
| 自身处理 | 禁止选择当前 Flow；加入 Error Trigger 不自动改变错误处理配置                                |
| 发布     | 错误处理 Flow 必须有包含 Error Trigger 的 Live Publication，并已启用；该 Trigger 必须未暂停 |
| 触发来源 | 仅生产 Trigger 自动准入的 Run；手动 Draft 和手动 Live 运行不产生错误派发                    |
| 触发终态 | `failed`、`indeterminate`；`completed`、`canceled` 不触发                                   |
| 触发粒度 | 每个源 Run 至多创建一个错误处理 Run，按 Run 的最终终态决定                                  |
| 防递归   | Error Trigger 准入的 Run 失败后不再派发错误处理，包含跨 Flow 的循环关联                     |
| 测试     | 通过现有手动运行入口，使用符合输出合同的样例错误数据测试分支；不生成真实错误派发            |
| 原 Run   | 始终保留原失败状态；错误处理成功不把原 Run 改成成功                                         |

`indeterminate` 明确表示执行结果无法确认，可能已经产生外部副作用。输出和 UI 保留这一差异，不能将其转换成可安全重试的普通失败。
节点启动前失败、执行超时、Wait 过期和恢复失败，只要符合来源和终态规则，都由统一终态提交覆盖。

自动来源必须由服务端持久化事实判断。当前 `source: 'live'` 同时包含手动 Live 运行，不能作为自动来源的唯一判断依据。
递归防护也不能依赖客户端可构造的 Trigger outputs。

## 3. 模型与版本合同

### 3.1 Flow 配置

- 在 `FlowDocument` 中增加可选 `errorWorkflow` 引用，保存目标 `flowId`。目标根图最多一个 Error Trigger，不另存可漂移的目标节点选择。
- 配置属于 Revision，进入 digest，使用正常 Draft change、预期 Revision、幂等 identity 和 inverse operation 保存。
- 源 Run 读取自己固定 Revision 中的配置；后续草稿修改或重新发布不改变该 Run 的关联目标。
- 错误处理目标的 `flowId` 必须与源 `flowId` 不同。前端候选列表排除当前 Flow，服务端在关联写入、发布和派发准入边界拒绝自身引用，不能绕过 UI 通过 API 建立。
- 旧 Revision 缺少该字段时表示未配置；不得改写历史正文或 digest。实施时按既有 modelVersion 规则处理新节点和字段。
- 新增或切换关联时，服务端只接受同 scope 中已发布并启用、Live 包含未暂停 Error Trigger 的目标；下拉选择遵守相同规则，不能只在前端过滤。
- 已保存引用后来不可用时，草稿保留引用并显示诊断。发布源 Flow 时重新验证目标资格及非自身约束。
- 跨 Flow 的资格验证不形成级联发布事务；目标随后停用、删除或重新发布，由派发准入重新检查。

### 3.2 Error Trigger

- 在公共 `TriggerNode` 联合中增加 `kind: 'error'`，提供固定输出合同、创建操作和内置目录展示。
- 更新涉及 Trigger kind 的严格 decoder、validation、图编译、Revision 展示转换和 public exports，依赖编译器穷尽检查找齐消费者。
- Error Trigger 无外部订阅、Connection 或周期配置。发布时在现有激活事务安装内部 binding，保留普通 Trigger 暂停和恢复能力。
- 执行继续消费通用 Trigger seed 和端口映射；不要在 Scheduler 中增加跨 Flow 派发逻辑。
- 源 Flow 同时包含普通入口和 Error Trigger 时，保持现有 source node 可达分支执行语义。

### 3.3 输出与错误事实

固定三个对象输出，详细字段和可空性在实现阶段作为公共 schema 一次定义：

| 输出        | 内容                                                                        |
| ----------- | --------------------------------------------------------------------------- |
| `workflow`  | 源 Flow ID、失败提交时取得的名称快照、固定 Revision 和可用的 Publication ID |
| `execution` | 源 Run ID、`failed` 或 `indeterminate`、可用的开始时间、结束时间            |
| `error`     | 错误码、消息，以及可用的节点、invocation 和 Subflow 调用路径                |

当前 Runner 的 terminal result 多数只有通用 `run.failed` 提示，而 Scheduler 已产生包含节点信息的 `node.failed`。
需要在执行错误的权威传播路径上保留导致终止的结构化原因，并随 terminal result 持久化。
并发失败保留决定 Run 终止的原因，不把其他分支的取消误报成根因，也不通过扫描最后一个事件猜测根因。
Subflow 错误必须能够定位到调用路径；启动失败、Run 超时和进程恢复失败允许没有节点信息。

错误事实不依赖 RunEvent retention、截断或 UI 是否订阅。进程异常退出无法取得详情时，保留明确的恢复错误码，不虚构业务错误。
沿用现有错误投影和隔离边界，不默认复制完整节点输入、输出、credentials 或宿主堆栈。

## 4. Server 执行与持久化

### 4.1 原子登记

在 RunStore 的统一 `#finishRun` 路径中，只有终态提交成功且符合触发条件时，登记一条待处理错误记录。
源 Run terminal、错误上下文快照和派发意图处于同一个数据库事务；不能在 Runner catch、浏览器事件或提交后的内存回调中单独创建。

记录至少保存源 Run、目标 Flow、固定输出、派发状态、下次尝试时间，以及成功后的处理 Run ID 或终止原因。
以源 Run 建立唯一约束。新增字段与表按当前数据库迁移方式实现，不建立历史失败 Run 的自动补发行为。

### 4.2 派发与去重

1. Run owner 提供到期待处理记录和下一工作时间，现有 Maintenance/Supervisor 唤醒链推进。
2. 读取目标当前 Live，准备其固定 Revision、closure、Error Trigger seed 和执行授权。
3. 在准入事务重新检查 scope、Flow lifecycle、Live identity、启用状态和 current binding，执行现有运行所需的 Variable/授权检查。
4. 使用稳定 occurrence identity 调用现有 `acceptTriggerOccurrence`，原子创建普通 Run 并完成派发记录。
5. 发布处理 Run 的正常创建通知；派发成功或失败提交后，同时向源 Flow 发布源 Run 的变更通知。后续执行、并发限制、取消、等待和恢复全部走普通 Run owner。

occurrence identity 由源 Run 派生，不包含重试次数。已完成派发的重放先返回原关联结果，不读取新的目标版本后再创建执行。
准备与准入之间 Live 变化时，重新解析当前 Live 后再尝试；成功准入后固定版本，目标后续发布不改变处理 Run。
重启恢复、并发领取或取消竞争不能产生第二个处理 Run。按现有事务和领取模式实现，只有实际存在跨事务异步工作时才增加必要租约。

### 4.3 失败、背压与生命周期

- 队列容量不足是暂时背压，持久化下一尝试时间并退避；不能丢失派发，也不能忙循环。
- 目标已删除、未发布、停用、缺少 Error Trigger、Trigger 暂停或确定性授权/配置失败时，结束本次派发并保存可读原因。
- 目标后来恢复不会自动补发已经结束的派发；首版不增加手动重投入口。
- 派发失败不改变源 Run terminal，也不能阻止其完成落库；处理 Flow 执行失败不自动重试其副作用。
- 派发记录独立于普通 RunEvent retention，由源 Run 的生命周期负责清理。源 Flow 删除时取消其尚未准入的派发并清理记录。
- 处理 Run 已准入后是独立执行，源 Flow 删除不隐式取消它。目标删除按目标自身的 Run 清理规则执行。
- 删除任一关联资源后允许显示“记录已删除”，不能要求跨 Flow 级联删除历史执行。
- 服务端为错误处理 Run 保存可信来源关联，用于防递归和反向导航；不能仅靠可被历史清理掉的来源事件识别。

## 5. Workbench UI：沿用现有风格和交互

用户要求：UI 参考当前 Workbench。实施前使用 [frontend-ui skill](../../.agents/skills/frontend-ui/SKILL.md)，
以已有生产组件为基准，再在 Lab 中验证；不能只凭静态类名检查声称风格一致。

### 5.1 参考入口与组件

| 界面部分        | 当前参考                                                                                       | 实施要求                                                                         |
| --------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Flow 级配置入口 | `runtime/flowWorkspace.tsx`、`editor/connectorAccessSettings.tsx` 中的 `ConnectionUsageButton` | 沿用工具栏 ghost/icon 按钮与带标题的紧凑 `PopoverPanelContent`，不另建全屏设置页 |
| 目标选择        | `shell/workbenchSelect.tsx` 和现有共享选择控件                                                 | 展示名称和可用状态，排除当前 Flow；名称由既有 Flow catalog 派生                  |
| 节点添加        | `editor/nodePicker.tsx`、`addNodeOptions.ts`、Trigger summary                                  | 放进现有内置 Trigger 分类，遵循同组的标题、图标和说明密度                        |
| 节点属性        | `editor/triggerConfigEditor.tsx`、`builtInOutputPresentation.ts`、`ContextPanel`               | 显示简洁用途和固定输出；不添加无效的账号或订阅设置                               |
| 测试入口        | `runs/runControl.tsx`、`runInputPanel.tsx`                                                     | 沿用现有运行与输入编辑模式，提供确定性错误样例                                   |
| 运行结果        | `runs/runDrawer.tsx`、`runOutput.tsx`、`runsView.tsx`                                          | 在现有详情中增加紧凑关联信息，保留原失败信息的视觉优先级                         |

入口放在现有 Flow 级工具栏，与账号使用等控件保持相同尺寸、提示和焦点行为；仅根 Flow 允许编辑关联。
优先采用一个“错误处理”浮层，包含目标选择、当前配置状态和简短说明，不为单个字段搭建通用设置框架。

### 5.2 配置流程与状态

- 初始显示“未配置”；选择有效目标后通过 WorkspaceStore 正常保存草稿，并明确“发布后生效”。
- 目标列表仅提供同 scope 中已发布并启用、Live 包含未暂停 Error Trigger 的 Flow；资格以线上版本为准，草稿中新增节点不算可用。无论当前 Flow 是否已上线或包含 Error Trigger，均不出现在候选列表中。
- 不把另一 Flow 的全部 Revision 嵌入 Flow catalog，也不为了下拉框无界下载所有草稿。先检查现有查询合同，缺少资格信息时由权威 API 提供最小必要字段。
- 空列表给出“先发布并启用包含 Error Trigger 的工作流”的简短说明，复用现有新建/导航能力。
- 加载失败显示重试；已选目标不可用时保留引用和原因，不静默清空、不自动切换目标。
- 覆盖保存中、保存失败、外部更新、未发布修改、目标停用/删除和历史只读状态。
- 配置操作进入既有 Draft 保存和 undo/redo 流程，正常保存保留先前历史；不要在组件中维护另一份已保存配置。
- undo/redo 同样受目标当前资格约束。例如从 A 切换到 B 后 A 停用，撤销回 A 必须被拒绝，并显示目标不可用的原因；沿用 WorkspaceStore 既有保存失败恢复语义，重新读取实际状态并清空历史，不承诺失败后保留历史，也不为撤销放宽上线或非自身约束。

### 5.3 运行详情

源 Run 展示“等待错误处理”“已创建错误处理运行”或明确的派发失败原因；成功准入后提供处理 Run 的真实导航链接。
处理 Run 显示来源 Flow/Run 链接。派发状态与处理 Run 执行状态分别由各自事实来源提供，不能将“已创建”展示成“处理成功”。
通过现有 Run 通知和 Store 刷新机制更新，不依赖 toast 承载持久结果，不增加独立轮询系统。
源 Run 进入终态后，派发仍可能继续推进。动态派发状态通过可刷新的 Run 元数据或独立权威读取合同提供，不能只放入按 Run ID 缓存的 terminal result。
源 Run 的变更通知必须使已经结束观察的详情重新读取状态；派发成功和失败都要更新，即使未创建任何处理 Run。

### 5.4 视觉与无障碍约束

- 使用现有 Button、Field、Popover、选择控件、Alert 和导航链接；字号、间距、圆角、边框与状态色沿用标准尺寸及主题 token。
- 普通 Error Trigger 节点使用同类 Trigger 视觉，不因名称带 Error 而默认整块标红；错误色只表达真实失败状态。
- Workbench chrome 使用产品主题，节点内容使用 canvas surface，不能把画布的紧凑配色泄漏到浮层。
- 新增图标按 iconify-icons skill 选择；保留国际化文案与可访问名称，覆盖 `uiLanguages`。
- 弹出内容保留 Workbench theme/mount context；属性面板遵守 ContextPanel 的 stacking 合同，不增加独立 z-index 体系或定位补丁。
- 键盘可打开、选择、关闭并返回触发按钮；禁用、加载和错误状态可被辅助技术识别。
- 文字允许长名称和多语言换行，检查明暗主题与窄宿主容器，不使用固定桌面宽度掩盖布局问题。

## 6. 分阶段实施

### 阶段一：公共模型与结构化失败

- [ ] 增加 Error Trigger、Flow 引用、schema、decoder、Draft change/inverse 和输出合同。
- [ ] 校验根图限制、节点数量、禁止自身关联、旧 Revision 读取和新的版本边界。
- [ ] 在执行错误传播和 terminal result 中保留结构化失败原因，覆盖 Subflow 和无节点错误。
- [ ] 同步 Control API、公共导出和受影响的 CLI/MCP 定义，避免入口合同分叉。

完成标准：可通过公共 authoring 合同创建、修改和读取配置；样例输出可启动正确分支；错误详情不依赖事件日志。

### 阶段二：发布、可靠派发与恢复

- [ ] 实现 Error Trigger binding 的发布激活、暂停和失效处理。
- [ ] 增加数据库迁移、终态原子登记、可信来源关系、去重准入和 Maintenance 调度。
- [ ] 实现背压、目标变更、不可用原因和生命周期清理。
- [ ] 暴露源 Run 派发状态、处理 Run 关联及必要的资格查询；接入既有通知。

完成标准：自动失败可产生一次普通处理 Run；重启和背压不丢失、不重复；所有失败路径不递归。

### 阶段三：Workbench 与 Lab

- [ ] 增加 Flow 级配置浮层、节点选择项、属性和输出展示、样例测试入口。
- [ ] 在现有 Run 详情中加入派发状态和双向关联导航。
- [ ] 完成保存、undo/redo、国际化、只读和无障碍行为。
- [ ] 用真实生产组件添加/维护相关 Lab stories；样例数据确定，sample controls 使用 `useStoryActions`。
- [ ] 在 Lab 验证明暗主题、窄容器、长名称、相邻侧栏 section、弹出层和键盘操作，并进行真实工作流集成验证。

完成标准：界面与现有 Workbench 控件和布局一致，用户可完成创建、关联、发布、观察失败和跳转处理 Run 的完整路径。

### 阶段四：合同文档与交付检查

- [ ] 更新 `docs/architecture.md` 中 Trigger、Run 错误事实和派发所有权约束。
- [ ] 更新 `docs/control/contracts/control-api.md` 中模型、错误详情、派发读取及候选资格合同。
- [ ] 编写用户使用说明，明确发布要求、自动来源限制、测试方式和防递归行为。
- [ ] 完成下列验证并记录实际结果；本计划不充当已实现合同。

## 7. 验证矩阵

| 边界       | 必须验证的行为                                                                                                                                                            |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 公共模型   | 严格解码、旧 Revision、输出 schema、非法 Subflow/重复 Error Trigger、Draft change 幂等及 inverse                                                                          |
| 执行       | 自动失败、启动失败、超时、Wait 过期、Subflow 路径、恢复 indeterminate；固定原因不会被并发取消覆盖                                                                         |
| 触发规则   | 手动 Draft/Live 不派发，正常完成和取消不派发，Error Trigger 执行失败不递归                                                                                                |
| 发布       | 未上线目标不可选择、前端排除自身、API/发布/准入拒绝自身引用、服务端拒绝无效目标、草稿修改隔离、目标 Live 切换、启停及 Trigger 暂停                                        |
| 持久化     | terminal 与待处理记录原子提交；提交后重启、准入后重启和重复推进均只得到一个处理 Run                                                                                       |
| 准入       | 队列满后恢复、Live 检查竞争、目标删除、权限/Variable 缺失、scope 隔离                                                                                                     |
| 生命周期   | RunEvent 截断/过期不影响详情；源/目标删除不会误取消独立执行或形成悬挂待处理任务                                                                                           |
| API/消费者 | 派发状态与双向关系读取；源 Run 终态后收到派发成功/失败通知并刷新；公共 client、受影响的 CLI/MCP 和 conformance                                                            |
| UI 行为    | 保存失败和外部更新、undo/redo；A→B 后 A 停用再撤销时的拒绝、提示和历史恢复；已打开源 Run 经历失败→等待派发→已创建或派发失败；只读、空列表、不可用引用、键盘焦点、运行导航 |
| 渲染       | Lab 中明暗主题、窄容器、多语言长内容、属性面板与浮层层级、不同派发状态                                                                                                    |

先运行能证伪当前变更的最小测试，再按共享合同影响扩大验证。Open Flow 测试从 `packages/open-flow` 执行 `bun run test`，
Server 测试从 `apps/server` 执行 `bun run test`，不直接调用 `bun test`。受影响的 CLI/产物边界使用项目对应检查。
代码交付运行根目录 `bun run check`；任何提交前必须通过，rebase/merge 改变结果后重跑。
视觉验收不能被静态或单元测试替代；复用现有 Lab 服务，结束时停止本次启动的临时服务。

## 实施验证记录

- Flow model 升级到 5，历史 model 2/4 正文与 digest 不改写；SQLite 增加第 35 版迁移。
- 覆盖自动失败派发、手动运行不派发、终态去重、队列背压、重启恢复、目标下线与暂停、双向关联防递归、日志截断后的失败详情、输出合同与嵌套调用路径。
- Webhook 集成测试通过实际执行器验证源节点失败、错误处理 Flow 成功执行和双方 Run 关联。
- Workbench 配置使用正常 Revision history，覆盖保存、清除、撤销与重做；运行样例覆盖预填与保留用户清空的数据。
- 浏览器 Lab 检查了浅色/深色、窄表单长名称、失效目标、只读状态、键盘选择、属性面板与运行菜单。修正 Trigger Lab 模拟响应以匹配当前 catalog/check 合同。
- 验证命令：根目录 `bun run check`、`bun run test`、`bun run test:package`；最后的 UI/测试数据调整再次运行 Open Flow 测试和静态检查。
