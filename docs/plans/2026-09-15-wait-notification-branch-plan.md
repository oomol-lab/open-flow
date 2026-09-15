# 等待节点通知出口与局部等待实施计划

日期：2026-09-15。状态：功能已实施，本地自动化和 Lab 验证已完成；实际产品页全流程验收与部署数据盘点尚未完成。

依据：[等待节点通知出口与局部等待 spec](2026-09-15-wait-notification-branch-spec.md)。
Spec 定义产品与执行语义，本文定义实施任务、先后依赖及完成证据。每阶段完成后记录实际检查结果，不以计划中的描述代替实现状态。

## 1. 实施目标与约束

在同一个 Run、同一个图调度机制内实现 Wait 的局部等待：创建等待后释放通知出口，收到决议后释放操作出口，其他就绪节点照常执行。
保留 `continue` 与 `approve/reject` 两种配置，共用决议机制；不映射 action 名称，不扩展自定义 action。

冻结采用图静止后的固定两分钟窗口：没有运行中或可执行工作、仍有未解决等待时，在内存中保留 session 与执行槽 120,000 ms。
窗口内收到可推进的决议就原地继续，不生成完整 checkpoint；到期仍静止才保存并释放。等待记录与决议仍立即持久化。
因并发额度暂时无法启动的就绪节点仍算可执行工作，不能误判成等待。

实施不引入通知专属超时、取消范围、恢复流程、并发池、失败豁免或后台 Run。通知之后的节点使用普通图的资源、失败、汇合与恢复规则。
普通 Task 仍只在完成时发布输出；两阶段输出能力限定在 Wait。Agent 内联通知保留，其审批暂停接入统一局部等待。

保留用户工作区和暂存状态，不顺便重构无关模块。阶段顺序是开发依赖，不是允许部分合同独立发布；相关消费者未接通前不交付新行为，也不为过渡增加 feature flag 或运行时兼容包装层。

## 2. 实施前核实的起点

| 现有位置                                                  | 需要替换的假设                                                                               |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `packages/open-flow/src/execution/common/scheduler.ts`    | Wait 设置全局 `suspending`；活动节点结束后才返回单个等待与队列；依赖通常以整个节点完成为准。 |
| `apps/server/node/application/run.ts`                     | 收到 `waiting` outcome 后才持久化等待，执行期间没有应用新决议的通道。                        |
| `apps/server/node/storage/run-store.ts`                   | 当前等待、checkpoint 与暂停提交耦合，resolve 主要处理 `waiting → queued`。                   |
| `apps/server/node/storage/run-view-store.ts`              | `activeWait` 按 `status == waiting` 查询单个等待。                                           |
| `apps/server/node/application/supervisor.ts`              | 拥有 worker 和同 Flow 串行槽，须继续保证一个 Run 只有一个执行者。                            |
| `packages/open-flow/src/control/common/api.ts`            | 单个 `waiting` 对象仅允许出现在暂停状态。                                                    |
| `packages/open-flow/src/execution/common/runLifecycle.ts` | 生命周期和共享 conformance 将决议与恢复排队绑定。                                            |
| Workbench、Command、公开 Wait hook                        | 等待入口与展示依赖单个当前等待或 Run 暂停状态。                                              |

实施前没有额外的几分钟冻结计时器。共享 Executor 子进程可复用，与某个 Run session 是否已结束分开处理。

## 3. 阶段 A：固定底层合同与变更清单

### 工作

- [x] 梳理 Wait 模型、端口、编码、依赖闭包和所有内联通知消费者，标出 Agent 仍使用的共享部分。
- [x] 固定通知输出 schema、Wait 两阶段输出、端口未确定/有值/关闭的表示；不创建通用流式 Task 接口。
- [x] 固定 Scheduler 与 Run owner 的最小交互：创建等待并返回固定输出、取得并应用已接受决议、提出安全暂停。
- [x] 固定持久化事实与完整 checkpoint 的职责，定义决议已接受/已应用、执行段归属和暂停提交的一致性检查。
- [x] 定义多等待 detail、待处理筛选、局部等待事件与整图暂停事件，以及所有终态和过期入口的有效性条件。
- [x] 固定受保护通知输出的保存与恢复方式：公开验证索引保存摘要，普通图恢复所需的完整输出保存在有权限边界的运行数据中。
- [x] 列出模型、Engine、checkpoint、API、事件和分发版本的断点，确定精确版本与旧数据拒绝路径。
- [ ] 盘点可访问的实际旧 Revision/活动 Run；无法访问部署时记录缺口，不推定不存在旧数据。确认发布前需迁移、排空或保留旧 Engine 的具体清单。

### 主要落点

`packages/open-flow/src/flow/common/{change,changeSchema,encoding,graph,semantics,authoring}.ts`；
`packages/open-flow/src/execution/common/{scheduler,events,runLifecycle,runtime}.ts`；
`packages/open-flow/src/control/common/{api,requests,mcp}.ts`；
`docs/architecture.md`、`docs/control/contracts/{control-api,compatibility}.md`。

### 完成条件

合同能明确回答：谁创建 Wait、谁保存决议、谁应用决议、哪些端口就绪、何时允许冻结，以及运行中崩溃后是否有安全恢复点。
精确数据结构和版本决策写入相应技术合同或待落地变更中，不能留给各消费者自行猜测。权威文档不得提前把未完成能力描述为已上线。

## 4. 阶段 B：公共图语义与 Scheduler 核心证明

依赖：阶段 A 的端口、交互与快照形状已经固定。

### 工作

- [x] 给 Wait 增加固定通知出口，移除普通 Wait 的内联通知配置；同步 decoder、canonical encoding、变更及 closure 计算。
- [x] 修改路径分析：通知与所选 action 可以同时存在，两个审批 action 仍互斥；拒绝不保证就绪的来源和伪互斥映射。
- [x] 调整入边就绪判断：通知边不等待 Wait 完成，未决议 action 边不能提前关闭；汇合仍遵守所有入边确定、至少一条选中的普通规则。
- [x] 删除全局遇 Wait 就停止调度的路径；等待登记后继续调度无关工作，在同一 Scheduler 内应用决议。
- [x] 通知输出就绪与 Wait 完成分开发布，Wait 完成一次，后续节点执行一次；跳过 Wait 不创建等待。
- [x] 将 freeze 判定收敛到调度循环末尾：先应用结果与决议、传播关闭与跳过，再判断执行、内存等待窗口、暂停、完成或依赖错误。
- [x] 实现统一等待集合，接入 Agent continuation；Agent 内部工具串行不变，独立节点不被其等待阻塞。

### 首个证明场景

使用真实 `runFlow` 与受控 Task fixture：通知节点进入执行后保持未完成，注入已接受批准；批准路径启动并完成，通知未收到取消；随后完成通知，Run 正常结束。
同一测试证明 Wait 通知输出只发布一次、操作出口只释放一次、未发生全局冻结。fixture 只提供外部结果与信号，不实现另一套调度器。

### 聚焦验证

- `packages/open-flow/test/scheduler.test.ts`：上述场景、通知晚启动、普通失败、多个等待、Agent 审批、continue、图静止与恢复。
- `packages/open-flow/test/execution-graph.test.ts`、`flow-semantics.test.ts`：汇合、共享后续节点、来源可用性、端口关闭与无效引用。
- `packages/open-flow/test/flow-encoding.test.ts` 与相关 change 测试：新模型往返、旧字段明确拒绝、通知连线保留。

### 完成条件

公共 Scheduler 在确定性测试中证明局部等待与普通图行为成立；所有旧全局暂停断言已按新合同替换。
此时不宣称持久化和进程恢复已完成，Server 主链路须在阶段 C、D 验证。

## 5. 阶段 C：Server 等待持久化与运行中决议

依赖：阶段 A 的事务合同及阶段 B 的 Scheduler 交互。

### 工作

- [x] 将当前单等待存储拆清职责：以 `runId + waitId` 保存独立等待与决议，完整执行段 checkpoint 仍由 Run owner 保存；不新增通知后台任务表。
- [x] 添加数据库迁移，支持多等待查询、历史决议、独立过期与普通恢复输出；保持历史 Revision 和 digest 不变。
- [x] 等待创建成功后才向执行器返回输出；相同等待身份的重复请求必须验证一致性，不能重建 capability 或重复登记。
- [x] 删除 ControlService 与 Publication 中普通 Wait 的公开 origin 预检，不改为按通知出边扫描；实际链接生成由等待创建逻辑负责，地址不可用时报告普通执行配置错误，不发布无效输出。未连接也未引用通知输出时不必生成 capability；保留 Agent 内联通知的既有检查。
- [x] 修改统一 resolve：`running` 保存决议并通知当前执行者，`waiting` 保存决议并排队；`queued` 接受其他等待的决议但不重复排队，`starting` 将决议交给已领取的唯一执行者。重复操作及终态竞争沿用权威仲裁。
- [x] 扩展 `IsolatedVmHost` 与 Executor 的 session 通道，支持运行中创建等待、取得决议和继续执行；保留 session 归属验证和有界消息处理。
- [x] 把 ControlService 与公开 WaitActions 的查看和决议接到同一有效性规则，覆盖 `running/waiting/queued/starting`，不因恢复过渡状态将有效链接显示为不可用。
- [x] Supervisor 继续拥有唯一 worker；运行中决议不启动第二个恢复 session，旧回调不能修改新执行段。
- [x] Maintenance 对所有未解决等待执行过期检查，覆盖 `running/waiting/queued/starting`，同步修改终态提交条件，过期后已领取的执行不能启动。Agent 通知按各自等待身份发送，不依赖单个 active Wait，保留其既有重试和幂等义务。
- [x] Run 取消、deadline、Flow 删除和服务关闭覆盖活动执行、所有等待及共享通知清理。

### 主要落点

`apps/server/node/storage/{run-store,run-view-store,store}.ts` 与 `apps/server/migrations/`；
`apps/server/node/application/{run,supervisor,service,control-service,publication,wait-actions,maintenance}.ts`；
`apps/server/node/runtime/{isolated-vm,isolated-vm-executor}.ts`。

### 完成条件

真实 Server、存储与隔离执行器证明：通知仍执行时，通过管理入口和公开 hook 均可批准，批准路径在原 session 推进，通知继续执行。
数据库中多个等待各自可决议；原 Run 不因登记等待而错误变成整体暂停。
Run 和 Publish 均验证普通 Wait 缺少 origin 不被提前拒绝；实际需要链接时失败明确且不交付无效输出，未连接也未引用通知出口时管理决议可用，Agent 原有 origin 检查保留。

## 6. 阶段 D：安全冻结、恢复与竞争闭环

依赖：阶段 C，必须在开放新运行行为前完成。

### 工作

- [x] 实现图静止后的固定 120,000 ms 内存等待窗口；窗口内不序列化或写入完整 checkpoint，保留 session 和 Flow 执行槽。有效决议使图推进时取消窗口，再次静止重新计时；无效唤醒不延长。
- [x] 到期重新读取决议并检查图状态，仍静止才生成并提交 checkpoint；成功后释放资源。取消或等待过期立即结束，不等待窗口到期。
- [x] 让暂停事务检查最新决议和执行段身份。决议先提交则继续或重新排队；暂停先提交则决议唤醒恢复，不能留下有工作却永久等待的 Run。
- [x] checkpoint 覆盖端口已发布状态、节点结果/跳过、所有等待、决议应用状态、Agent continuation 与剩余预算，并严格验证相互一致性。
- [x] 原子恢复 claim 保证唯一执行者；已完成节点和已发布通知不重跑，未应用决议恰好应用一次。
- [x] 覆盖 claim 之前、claim 之后和 session 启动期间接受的新决议；恢复执行者读取并接续处理权威决议，不能只使用领取时快照，也不能依赖用户重试或内存唤醒必达。
- [x] 通知输出跨恢复段稳定可读，不能靠重新发通知、重执行上游或重建 URL 补回数据。
- [x] 执行段预算累计，排除两分钟窗口的纯内存等待、安全暂停和排队时间；调整当前覆盖整个 session 的 timeout，不能在窗口内继续扣预算。并行不重复扣减，原地继续及恢复都不重置。
- [x] 运行中或内存等待窗口内崩溃而无安全 checkpoint 时遵循既有不确定恢复语义，不能因已持久化某个 Wait 或决议就恢复整个执行段。

### 必测竞争矩阵

| 竞争点                             | 需要证明                                                   |
| ---------------------------------- | ---------------------------------------------------------- |
| 创建等待 / 立即决议 / 通知输出返回 | 不丢通知路径，不重建等待，只应用一次决议。                 |
| 决议提交 / 冻结提交                | 不覆盖新决议，不丢唤醒，不永久暂停。                       |
| 多个决议 / 队列 claim              | 一个 Scheduler 拥有 Run，已解决等待分别推进。              |
| 决议 / 节点失败 / 取消 / 等待过期  | 只有有效状态能推进，终态不可复活，已接受决议可追溯。       |
| 旧 session 回调 / 新执行段         | 旧结果被拒绝，不污染新 checkpoint。                        |
| 安全暂停 / 重启                    | 输出、等待、Agent 状态与预算恢复一致，已完成副作用不重放。 |
| 活动执行 / 崩溃                    | 无依据时明确不确定失败，不从旧 checkpoint 猜测重放。       |

两分钟窗口使用可控时钟验证：到期前未序列化/写入 checkpoint，窗口内决议直接继续，到期仍静止才写入；覆盖再次静止重置、无效唤醒不续期、预算暂停、到期决议竞争、取消和崩溃。不得用实际 sleep 两分钟代替确定性计时测试。

“多个决议 / 队列 claim”必须展开为可控时序用例：

1. 同一 Run 有两个未解决等待，第一个决议使 Run 从 `waiting` 进入 `queued`。
2. 用资源额度或同 Flow 串行约束保持排队，此时第二个等待仍可查看并接受决议，不重复排队。
3. 另一个用例在 claim 后将 Run 保持在 `starting`，再提交第二个决议，验证它被唯一恢复执行者读取并恰好应用一次。
4. 分别在 `queued`、`starting` 期间令第二个未解决等待过期，验证 Run 结束，已领取工作不得启动或复活 Run。
5. 覆盖重复提交、决议与过期竞争及丢失内存唤醒；管理入口与公开 hook 行为一致。

### 完成条件

使用实际 SQLite 事务、受控执行器和故障注入验证所有竞争；模拟丢失内存唤醒后仍能从权威事实推进。
节点级测试与 mock 调用次数不能替代唯一执行者、事务竞争和进程清理的证据。

## 7. 阶段 E：公共 API、Command 与 MCP

依赖：阶段 A 的公共形状和阶段 C、D 的权威行为。实现时随底层合同更新消费者，以下为整体验收关口。

### 工作

- [x] 更新 `RunDetails`、严格 decoder、请求 schema 和客户端，表达非终态 Run 的待决议集合，而非单个仅在暂停时出现的对象。
- [x] 待处理查询支持运行中的等待，复用现有分页机制，不能先按 `status=waiting` 过滤再在客户端补数据。
- [x] 分开局部等待创建、决议接受、Wait 节点完成和整图暂停事件；更新投影、详情、导出与事件恢复消费者。
- [x] 更新 `runLifecycle` 与共享 conformance，覆盖运行中决议、真正暂停后的排队、多等待和终态竞争。
- [x] Command 与 MCP 按明确 `waitId` 查询及决议；不再自动把一个 Run 等同于一个当前等待。
- [x] 更新 authoring、校验和诊断，使新端口可以从 Command/API 创建，旧内联通知数据不会被静默丢弃。

### 主要落点与验证

公共 `control/common/{api,requests,mcp,conformance}.ts`、`execution/common/{events,runLifecycle}.ts` 及实际 decoder/client 消费者；
`packages/command/src/cli/node/{runCommands,authoringCommands,applySpec}.ts`；Server transport 与 ControlService。

运行 `run-events`、`run-lifecycle`、`control-requests`、相关 decoder/conformance、Command CLI 和 Server MCP 测试。
完成条件：同一个运行中 Wait 能在 API、Command、MCP 和公开 hook 上取得一致决议，不依赖 Workbench 补偿后端合同。

## 8. 阶段 F：Workbench 与 Lab

依赖：新模型、运行事件与待决议 API 已能提供真实数据。

### 工作

- [x] 画布投影增加固定通知出口，类型和连接候选来自公共图语义；等待模式切换保留通知连线。
- [x] 删除普通 Wait 内联配置、专用 ActionPicker 路径、无用状态与样式；不要删除 Agent 使用的选择器或共享通知能力。
- [x] 更新 Workspace 变更、历史、复制、删除和输入选择器，覆盖通知输出与跨路径普通依赖。
- [x] Run drawer/control/view 支持运行中待处理项和多个独立操作；等待节点与其他执行节点分别显示真实状态。
- [x] 所有语言同步更新配置说明、操作反馈与诊断；不显示通知专属倒计时或批准取消提示。
- [ ] 补齐 Lab 的正常汇合执行过程展示。已完成两种模式、运行中多个等待、冻结等待、普通失败展示及单项决议交互；保留 Agent 内联通知覆盖。

### 主要落点

`packages/open-flow/src/workbench/browser/runtime/` 下的 `editor/nodeInspector.tsx`、`editor/flowChanges.ts`、
`flowWorkspace.tsx`、`workspace.ts`、`stores/workspaceStore.ts` 和 `runs/`；
`packages/open-flow/src/canvas/browser/graph/FlowCanvas/` 和 `packages/open-flow/dev/designer/`。

### 完成条件

组件与交互测试覆盖配置、端口和多等待操作；Lab 完成视觉检查，实际产品页完成创建节点、连通知、运行、批准、通知继续执行和最终结束的完整验证。
按 frontend-ui 技能复用现有服务；自行启动的服务验证后停止并确认退出，保留预先存在的服务。

## 9. 阶段 G：合同、旧数据与交付收尾

依赖：B—F 全部完成。

- [x] 使用真实引用搜索检查旧内联通知模型、单 active Wait 假设、全局 `suspending` 行为和旧事件消费者，删除已无用途的代码与测试夹具。
- [x] Agent 回归：审批、内联通知、多个 Agent 独立等待、Variable scope、工具顺序和暂停恢复均正常。
- [x] 完成版本变更与 Engine digest/分发产物更新，最终 architecture/API/authoring 文档与代码一致。
- [x] 用已有数据 fixture 验证迁移或明确拒绝路径；不自动清空开发或生产数据，不原地改写历史 Revision。
- [ ] 发布前处理旧活动 Run 和实际迁移要求；无法取得部署信息时明确记录尚未完成的上线条件，不将本地测试当作已升级部署。
- [x] 汇总 spec 验收项与实际测试证据，更新本计划和 spec 的实施状态。

## 10. 检查命令与证据

迭代时只跑能解决当前不确定性的聚焦检查；相关改动使旧结果失效时再重跑。不为文档或小型展示修改机械增加测试。

公共包聚焦测试，在 `packages/open-flow` 执行：

```bash
bun run vitest run --config vitest.config.ts test/scheduler.test.ts test/execution-graph.test.ts test/flow-semantics.test.ts
```

Server 聚焦验证前，先从仓库根目录执行构建，确保隔离执行器产物与源码一致：

```bash
bun run --cwd apps/server build
```

随后在 `apps/server` 使用项目固定的 Node 环境执行：

```bash
node --no-node-snapshot node_modules/vitest/vitest.mjs run --config vitest.config.ts test/service.test.ts test/runLifecycleConformance.test.ts test/isolated-vm.test.ts test/agent.test.ts test/maintenance.test.ts test/migrate.test.ts
```

测试选择随新增文件和实际消费者调整。不得用根目录 `bun test` 加载 Vitest 用例，不使用真实发信或其他外部写操作验收。
最终集成涉及三个 workspace、公共执行与分发合同，需覆盖根目录 `bun run check`、`bun run test`、`bun run build` 和 `bun run test:package`。
复用其中已在最终代码上通过且覆盖相同产物的有效结果，避免重复构建。每次 Git commit 前必须从根目录重新满足 `bun run check`；rebase/merge 改变代码后重新检查。

### 实施证据（2026-09-15，本地未提交工作区）

- A / B：公共模型、Engine v3、checkpoint v3 已落地；编码、变更、图路径及调度测试覆盖固定通知端口、审批互斥、通知继续执行与普通汇合。输入来源检查还覆盖通知路径引用未来审批输出的非法映射。
- C / D：`apps/server/test/local-waits.test.ts` 使用实际 SQLite，覆盖多等待、冻结两侧决议、queued/starting 第二个决议与过期、丢失内存唤醒、取消、损坏快照与重启；冻结后同 Flow 排队工作可领取，驻留期间仍尊重活动 worker 排他。
- D：`packages/open-flow/test/local-wait.test.ts` 使用受控时钟，验证 119,999 ms 不冻结、120,000 ms 冻结、窗口内直接继续、静止不扣预算、无效唤醒不续期，以及有效决议推进后重新静止的完整两分钟窗口。最后一项发现并修复了快速进入下一等待时沿用旧计时的问题。
- E：Control conformance、CLI、MCP 和 Server 集成测试已通过；CLI 在 running 状态出现待决议项时也结束跟随等待。
- F：Lab 实际查看 Wait 配置与输出端口、运行中两个等待、冻结等待及普通失败；操作一个审批仅移除该待处理项，另一个仍可操作。查看浅色及深色属性面板，确认通知端口和配置说明可见，普通 Wait 内联配置已移除。
- G：公共包与 Command 对齐 `0.1.0-beta.24`，Server `0.1.0-beta.10`；迁移 0018 已注册。旧模型字段与旧 checkpoint 明确拒绝，未重写历史 Revision 或清空已有数据库。
- 最后的计时修正后，全仓库 `bun run check`、`bun run test`、`bun run build` 已通过：公共包 1,448、Command 90、Server 529，共 2,067 个测试。分发包契约与 Command Artifact 检查也已通过。
- 自行启动的 Lab 服务已停止，确认 5173 不再监听；原有 5174 服务仍运行。

### 尚未完成的验收与上线条件

- 实际产品页创建节点、连线并跑到结束的完整浏览器验收尚未执行；当前证据来自真实 Server/隔离执行器集成测试与 Lab 组件交互，不能视为已完成产品页验收。
- 尚未独立故障注入覆盖竞争矩阵中的每一种旧 session 迟到回调时序；现有执行器取消、进程恢复和生命周期测试通过。
- 未访问部署数据库，无法确认旧 Revision、活动 Run 数量或完成部署升级。发布前仍需盘点并处理旧活动 Run；本地迁移测试不代表线上迁移完成。
