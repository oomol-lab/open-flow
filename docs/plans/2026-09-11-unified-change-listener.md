# 统一业务变化监听实施计划

日期：2026-09-11。状态：公共包、Server、业务入口与两个 Provider 场景已实现，相关提交已整合到 `feat/execution-graph`。

当前未完成项（以此处和最新实施记录为准，旧阶段记录中的“下一步”保留作历史）：

- 真实 Provider 的线上端到端验收：baseline、通知唤醒、无通知补查、去重、暂停恢复及订阅清理；按当前安排暂缓。
- 阶段三其他适用 Provider 的迁移与边界确认：现有 Poll 已由统一运行时读取，但不等于其公开定义全部改为 listener 或已有通知能力。
- 阶段四最终交付收尾：核对仍有消费者的旧 snapshot / 协议，明确保留与退出范围，更新最终合同与验收记录。

需求来源：[Issue #114](https://github.com/oomol-lab/open-flow/issues/114)。
本文是实施计划，不修改当前产品合同，也不代表已经提供新的可靠性保证。

实施约束：现有开发部署优先迁移，保留可迁移的 Flow、Revision、Publication、Run、监听进度和订阅。
不能将开发环境等同于可直接重置；无法安全迁移的具体状态需单独说明，不能自动清空。

## 1. 目标与决策

将业务对象变化监听从互斥的 Poll / Integration 定义收敛到一个监听模型。同一个监听实例可以同时具有初始化、
定期扫描、外部通知和订阅维护能力，并由一个权威 owner 负责变化处理、去重、恢复和 Run 准入。

用户配置 Provider、Connection、对象范围和业务触发条件；不需要创建两个 Trigger 来组合低延迟通知与补漏扫描。
Provider 根据实际外部能力提供所需机制，不要求每个 Provider 都同时支持 Webhook 和 Polling。

Manual、Cron、通用 Webhook 保持独立语义。现有 Integration 中逐条消费外部事件的定义必须保留事件事实，
不能在迁移时悄悄改为只读取对象最新状态。是否共用同一公开定义类型，在完成 Provider 分类后确定，
不为统一名称强迫不适用的语义进入对象监听。

实施覆盖公共 package 与开源 Server。复用现有 Connector、持久化、调度、发布准备和 Run 准入设施；
不新增通用同步平台、消息系统、Provider SDK 框架或 rollout flag。

## 2. 现状与改造边界

| 所属位置        | 已有能力                                                               | 需要改变的边界                                                 |
| --------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------- |
| 公共 package    | Poll / Integration 定义、Provider、Registry、conformance               | 同一个定义能够表达扫描与通知协作，以及明确的变化身份和恢复合同 |
| Server          | SQLite、Poll claim 与 checkpoint、批量准入、Integration 回调和订阅维护 | 回调与调度进入同一个监听工作 owner                             |
| Connector       | Connection、授权、credential 和 proxy                                  | 继续复用现有边界，不转移监听进度或 Run authority               |
| Workbench / CLI | Trigger 配置、snapshot、诊断和测试入口                                 | 表达业务监听及实际能力，更新公开协议消费者                     |

当前 Poll 已将一页 fresh events 合成一个 Run；baseline 不产生历史 Run。Integration 的部分 Provider 已在通知后回源，
但该行为不是与定期扫描协作的共享合同。
不能只把两种 kind 改名，或并行启用现有两个独立 binding。

## 3. 第一版语义

### 3.1 初始化与监听范围

- 第一版保持当前 baseline 语义：建立起始进度，不将已有对象自动提交给工作流。
- “把全部存量对象运行一遍”属于独立的 backfill 行为，本次不引入；这是对 issue 中 initial sync 的明确范围限定。
- Provider 必须定义监听起点，以及如何衔接起点、订阅建立和激活。准备完成前可以记录变化，但不能准入生产 Run。
- 配置或 Connection 改变时重新准备相应范围；未改变的业务语义应保留可复用进度，不能因普通重新发布造成重复历史触发。
- 暂停时不准入新 Run，不把未处理变化标为完成。恢复后按保存进度补查；上游历史已过期时明确报告缺口，不能悄悄重建基线。

### 3.2 状态与历史事件

- 对象状态监听处理可观察的对象变化，回源结果是某次读取时的快照，不承诺是 Run 执行时的最新状态。
- 历史事件监听按上游稳定事件身份处理；不能用最新对象状态替代已经发生的事件。
- “进入 Done 后又退出”是否必须触发，必须由具体 Provider 定义说明。只有当前状态查询时，不承诺恢复轮询间隔内的全部转换。
- 删除、失去访问权限、对象暂时查不到分别遵循 Provider 可证明的含义；不能把每个 404 都当作删除。
- 对象版本、事件 ID 或其他可证明的稳定变化身份由 Provider 提供；不能只用对象 ID，也不能分别用 Webhook delivery ID 和扫描时间表示同一变化。
- 没有可对应的变化身份时，先收敛检测算法或缩小保证范围，不声明双通道严格去重。

### 3.3 批量与保证范围

- 默认将有界的一批变化交给一个 Run，保留对象 ID 和必要的变化类型、版本或事件事实。复用现有 payload schema 机制。
- 不要求所有 Provider 只返回 ID；不默认把完整大对象写入待处理记录。
- 只在业务语义允许时合并同一对象的重复通知；历史事件不能因为对象 ID 相同而被合并。
- 在明确的身份作用域与去重保留期内，同一变化只能成功准入一次；定义批次重试、重新分页和重新发布时的身份规则。
- 本地保证持久工作可恢复、准入与进度一致；外部漏通知能否补齐取决于上游查询能力、历史保留期和访问权限。
- 不承诺工作流外部副作用 exactly-once，也不自动重跑已开始执行但结果不确定的 Run。

## 4. 运行时设计

### 4.1 入口与处理

外部通知依次完成路由、验签、握手判断和通知解析。对需要异步检查的有效通知，先保存待处理工作，
再返回协议允许的成功响应。保存失败不能返回表示已经可靠接收的成功。握手等同步响应仍在入口完成。

定时扫描使用 Server 已有本地调度，唤醒同一个监听实例。
定时器和 HTTP 唤醒都不拥有处理完成事实；唤醒遗漏后，持久工作仍可由维护任务重新发现。

处理 owner 领取工作，执行定向读取或增量扫描，生成具有稳定身份的变化，再进行批量准入。
外部网络请求不进入数据库事务。原子提交边界包含本次变化接受事实、Run 准入、相关进度推进和工作完成状态。
若 Run 容量不足，不丢弃变化，不把进度推进到尚未接受的变化之后。

### 4.2 并发、持久化和恢复

- 首版复用每个监听实例的 claim / lease 串行处理状态变更；不同监听继续使用部署已有并发限制。
- 即使处理被串行化，也允许通知在处理期间到达；完成旧 work 不能清除领取后新增的通知。
- 定向读取不能直接推进集合扫描 cursor。保存扫描进度与待检查集合各自必要的状态，由同一个 owner 协调。
- 租约失效或 binding runtime version 改变后，旧 worker 不能提交；外部调用完成不等于仍有准入权限。
- 通知风暴下使用有界持久工作。可重扫的集合可以合并为待扫描标记；不可重建的历史事件不能丢弃后假装可以补查。
- retry、退避、取消和关机沿用现有错误语义；公共合同明确区分单个检测机制故障与整个监听无法继续。
  订阅续期或回调失效不能阻断仍然可用的扫描，通知恢复后继续共享去重。共享 Connection 失效按实际权限影响处理。
  调度与准入资格依据所需能力是否可用判断，不能因单一总体 health 标为失败就停止所有路径；通过 health / activity 明确报告降级或不可恢复错误。
- 所有路径按所属 Flow 固定的 Connection / Team scope 调用 Connector；共享监听不产生跨租户状态或凭据缓存。

具体类型、表结构、claim 字段和唤醒合同 在合同阶段按实际需求确定，不预建通用任务框架。

### 4.3 发布和清理

复用现有 publish operation：将同一监听需要的基线准备和订阅准备纳入同一个激活条件。
Provider 必须给出可验证的准备顺序，例如先取得可回放 cursor，再建立订阅，并在激活后从 cursor 补查。
没有可证明的无缝衔接方式时明确能力限制，不能由运行时猜测补偿。

只有所有必需 work ready，才能在权威事务中移动 Live、安装 binding、进度与待处理工作并开放 admission。
候选通知与激活并发必须收敛，不能因切换丢掉已持久化工作。准备失败保持旧 Live，并清理候选外部订阅。

监听语义未改变的重新发布，必须在激活事务中继承旧 Live 当时最新的扫描进度、去重作用域及其有效记录、待处理工作，
合并候选期间的工作，并同时使旧 worker 失去提交资格。不能用候选准备时的 checkpoint 覆盖旧 Live 后续进度，
也不能因清理旧版本而删除已经接收但未处理的通知。
配置、Connection 或监听范围确实改变时，在公共合同中明确旧工作由哪个版本处理或按何种显式规则终止，
不得把旧范围工作转交给不匹配的新配置，也不能将未处理工作静默标为完成。

停用、替换、删除、取消发布和受支持的 Rollback 都必须覆盖调度、回调路由、待处理工作与订阅清理。
无法安全准备独立候选资源的 Provider 继续 fail closed，不先破坏当前订阅。

## 5. 实施阶段

### 阶段一：Provider 分类与公共合同

1. 逐个登记当前 Provider：业务语义、扫描 / 回源能力、通知内容、事件或版本身份、分页、历史保留与删除语义。
2. 根据真实能力区分对象监听和事件接收，明确迁入统一监听的清单；不删除仍有独立用途的事件 Trigger。
3. 优先选择已有 Google Drive changes 定义验证“通知唤醒 + cursor 扫描”。实施前核对其官方协议与当前实现，证明起点与变化身份。
4. 选择第二个对象级场景验证定向读取，优先研究 GitHub PR；不能将通用 Repository Event 直接改成 PR 最新状态监听。
5. 确认 Server 实际存在的 Flow、Revision、binding、外部订阅及在途工作，不能由 beta 版本号推断没有用户数据。
   为 serialized kind、definition version、旧 Revision 解码与执行、消息和工作交接制定升级方案，明确旧执行版本如何退出。
   不原地改写历史 Revision 或 digest，不无授权清空部署数据。
6. 定义公共监听合同、snapshot、decoder、validation、错误和 payload 语义，以及实际机制所需的最小能力声明；
   明确机制故障隔离和重新发布时完整状态交接的义务。
7. 更新架构与 Control API 技术参考，编写共享 conformance；覆盖初始化、通知、扫描、去重、恢复与生命周期。

完成条件：首个 Provider 的双通道变化身份和初始化衔接有依据；第二个场景不会要求复制整套运行时。
若第二个场景需要更窄的产品定义，应先收紧定义，不为通用性增加大量配置开关。
消费者调查和升级方案必须在首个新公共包发布及 Server 数据迁移前完成，并影响合同设计。
Server 首次升级前，使用已有 Revision、binding、订阅与在途工作验证升级和升级中断后的恢复。

### 阶段二：Server 完整实现

1. 在现有 SQLite 与 Trigger lifecycle 中实现持久监听工作、领取、恢复与原子提交。
2. 将首个 Provider 的通知与扫描接到同一个处理 owner，复用现有订阅准备、路由和 Connector。
3. 处理暂停 / 启用、重新发布、候选切换、失败清理与 Flow 退役。
4. 用共享 conformance 和 Server 存储故障测试证明完整路径，不以 happy path 或 mock 调用次数作为完成标准。

完成条件：丢弃通知后扫描仍能发现变化；双入口只准入一次；保存通知后重启仍能继续；Run 满额后释放容量能恢复。

### 阶段三：业务配置与 Provider 迁移

1. Workbench 以业务名称呈现监听，按实际能力展示必要配置；不要求用户在 Poll / Integration 间做互斥选择。
2. 复用现有诊断与 activity 表达初始化、健康、失败和重新授权，明确呈现“通知失效但扫描仍正常”等机制降级；
   展示状态服从公共合同，不由 UI 决定是否继续扫描。
3. 更新 CLI、MCP、程序化 authoring、snapshot、测试运行与 schema 消费者；草稿编辑和测试不能隐式创建生产订阅。
4. 更新相关 Lab Stories，在入口同时展示配置与状态；按 frontend-ui 技能验证共享 UI。
5. 实现第二个对象级 Provider 场景，再按阶段一清单迁移其他适用定义，保留已有事件语义与 payload 契约，或明确版本化变更。

完成条件：用户用一个节点获得双机制监听；两个不同读取模式的 Provider 共用生产处理逻辑；没有要求用户自行去重的第二个 Trigger。

### 阶段四：版本升级、清理和交付

1. 按阶段一确定并验证的方案完成剩余升级，核对实际持久化消费者与迁移结果。
2. 确认旧 Revision 的读取与执行符合升级合同，在途消息和工作已经交接或按明确规则结束，旧外部订阅清理可恢复。
3. 确认旧执行版本满足退出条件后再删除旧路径，不提前移除已有持久化消费者仍依赖的能力。
4. 未发布且确无消费者的旧行为直接删除。不保留仅为旧名称转发的接口，不长期维护两套业务监听运行时。
5. 完成引用清理、package 发布验证，移除已迁移路径的旧表写入、调度分支和无效测试。

完成条件：公共合同与 Server 实现一致，旧资源清理可恢复，已有业务行为没有未经声明的变化；测试与文档不再描述已删除的实现。

## 6. 验收矩阵

| 场景                                             | 预期结果                                                       |
| ------------------------------------------------ | -------------------------------------------------------------- |
| 初次建立 baseline                                | 存量不创建 Run；准备期间变化从已声明起点可继续读取             |
| 正常通知                                         | 持久化后响应；定向读取或增量读取产生正确批次                   |
| 丢失全部通知                                     | 周期扫描在可恢复范围内发现变化                                 |
| 订阅续期失败或回调失效，查询仍正常               | 扫描继续发现变化，明确报告降级；通知恢复后不重复准入           |
| 通知与扫描发现同一次变化                         | 在身份作用域与保留期内仅一个 Run 接受该变化                    |
| 同一对象连续不同变化                             | 合法的新版本 / 事件不被对象 ID 去重吞掉                        |
| 保存通知后、处理前进程退出                       | 维护任务重新发现持久工作并继续                                 |
| 回源失败、提交前退出                             | 进度不越过未接受变化，重试能继续                               |
| 提交成功、响应前退出                             | 重投返回已完成事实，不重复准入                                 |
| 批次重试时页面内容或划分改变                     | 已接受变化不重复，未接受变化仍可继续                           |
| 处理期间收到新通知                               | 旧任务完成不清除新工作                                         |
| 超过一页或回调处理上限                           | 后续分页无需等待另一条外部通知即可继续                         |
| Run 满额、Provider 限流                          | 保留工作并退避，容量恢复后继续                                 |
| 旧 worker 在租约或版本失效后返回                 | 不能推进 checkpoint 或创建 Run                                 |
| 初始化与激活交错、发布失败                       | 候选不能提前准入，旧 Live 保持有效，候选可清理                 |
| 候选准备后旧 Live 提交变化并接收未处理通知       | 激活继承最新进度与去重记录，已接受变化不重复，未处理通知不丢失 |
| 配置或 Connection 改变时仍有旧工作               | 按明确归属处理或终止，不转交给不匹配的新配置，不静默完成       |
| 暂停、重启、重新启用、重新发布                   | 符合已声明进度复用与补查语义                                   |
| 已有 Revision、binding、订阅和在途工作升级时中断 | 恢复后旧数据仍按合同可用，工作不重复不丢失，旧资源可清理       |
| cursor 过期或权限被收回                          | 明确错误 / 缺口，不静默重置起点                                |
| 大集合与通知风暴                                 | 有界工作和批次，遵守 tenant 限制，不线性创建无界 Run           |
| 伪造通知、跨 tenant、Flow 退役                   | 在权威边界拒绝，不产生外部读取或 Run 越权                      |

使用可控假时钟和真实生产处理路径进行确定性测试。Provider fixtures 不实现第二份扫描或去重算法。
外部 Provider 的实际语义还需窄范围接入验证；本地测试不能证明上游具备未核实的历史恢复能力。

## 7. 检查与交付要求

- 迭代期间先运行受影响的公共包或 Server 测试；发布前覆盖完整消费者与生命周期。
- 每次提交前从仓库根目录运行 `bun run check` 并通过；rebase / merge 后按仓库要求重新运行。
- 公共包变更运行 package 发布验证及受影响的 CLI 测试。
- 共享 UI 用 Lab 验证实际外观与交互，维护相关 Stories；停止并确认本次启动的验证服务已退出。
- 文档写明各 Provider 的初始化语义、批量输出、恢复范围和去重保留期。不能用“企业级”代替精确保证。
- 实施完成后再更新 issue。创建本计划不包含发评论、发布 package 或部署的授权。

## 8. 本次不包含

- 存量 backfill 产品能力、全量业务对象镜像库、任意字段变化规则引擎。
- 把 Trigger 与 Action 合并为一种执行模型，或移动 Connector 的凭据管理职责。
- 无依据的全事件不丢失、跨版本永久去重、外部副作用 exactly-once 保证。
- 为每个 Provider 建立独立调度器，或先实现全部 Provider 再验证恢复和一致性。
- 无关执行引擎、Run scheduler、Workbench 布局及部署基础设施重构。

## 9. 实施记录

### 9.1 现有 Provider 分类

以下是当前源码行为盘点，不把尚未核实的外部协议能力视为已实现保证。

| 当前定义                                                   | 检测方式与身份                                               | 统一监听时的处理                                                          |
| ---------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------- |
| `googledrive.changes_detected`                             | 通知后读取 changes cursor；当前准入身份为 scope + page token | 首个双机制场景，共用单一 cursor 读取；现有 `changeId` 不是上游唯一事件 ID |
| `googledrive.on_file_change`                               | 文件夹扫描；文件 ID + 时间戳                                 | 对象监听；核实版本及边界，不承诺全部中间变化                              |
| `airtable.on_record_changed`                               | 记录扫描；记录 ID + 时间戳                                   | 对象监听；保留用户配置的时间字段含义                                      |
| `googlecalendar.on_event_changed`                          | 增量同步；event ID + updated / etag                          | 对象监听；保留取消与 cursor 失效语义                                      |
| `notion.on_database_page_event`                            | 集合查询；page ID + 编辑时间                                 | 对象监听；保留 added / updated 的区分                                     |
| `one_drive.on_item_changed`                                | delta 读取；item ID + eTag / 时间，删除使用独立标记          | 对象监听；迁移前处理删除后重建的身份边界                                  |
| `gmail.on_message_received`、`outlook.on_message_received` | history / delta 读取；message ID                             | 新消息监听；不能因为统一对象模型而把后续消息修改当成新收到                |
| `slack.on_message_posted`                                  | history 查询；channel ID + message timestamp                 | 新消息监听；保留频道与消息身份                                            |
| `googlesheets.on_row_added`                                | 行范围扫描；sheet ID + 行号 + 内容 hash                      | 保留现有新增行语义，不将可移动行号宣传成永久对象身份                      |
| `github.on_repo_event`、GitLab project event               | 验签 / token 后交付原始事件；delivery ID                     | 保留事件入口；GitHub PR 对象监听使用独立业务定义                          |
| Stripe、Telegram                                           | 原始事件 / update；上游 event / update ID                    | 保留逐事件事实与现有输出                                                  |
| Shopify、WooCommerce、Zendesk                              | 验证后交付事件；通知 delivery identity                       | 保留事件入口，不推断存在可恢复的对象变化历史                              |

Google Drive 已核实：changes 集合返回当前文件状态，起点可通过 getStartPageToken 取得；`removed` 也可能表示失去访问权限。
v3 Change 没有独立的唯一事件 ID。现有 `changeId` 拼接值不能直接用作跨入口唯一身份保证。
双通道首先应共同唤醒同一个 cursor reader，并将页面接受与 cursor 推进原子提交，而非各自读取后按通知 ID 去重。
若需要跨扫描窗口的逐对象去重，还需结合真实对象版本与删除语义验证，不能仅凭页面 token 推导。

参考：[读取 changes](https://developers.google.com/workspace/drive/api/guides/manage-changes)、
[Change 资源](https://developers.google.com/workspace/drive/api/reference/rest/v3/changes)、
[通知协议](https://developers.google.com/workspace/drive/api/guides/push)。
GitHub PR 列表支持按更新时间排序，但这不能证明能恢复每一次 review 或状态转换；
第二场景需按具体 PR 状态定义验证，不能宣称等同于 review 历史。
参考：[GitHub PR REST API](https://docs.github.com/en/rest/pulls/pulls#list-pull-requests)。

### 9.2 迁移调查与约束

- 阶段一盘点时公共包版本为 `0.1.0-beta.17`。
- 已只读检查的 Server 当前开发库为 schema 14，包含 Flow、Revision、Publication 与 Run，不能重置。
  当前没有 Poll / Integration binding，但历史 Revision 中仍存在 GitHub、Gmail 和 Airtable 定义；无 active binding 不等于无消费者。
- 历史 Revision 的 serialized kind、definitionVersion、payload 与 digest 保持可读；迁移不能用新 kind 原地改写历史内容。
  现有事件定义继续执行原合同。迁入对象监听的定义通过正常 authoring operation 生成新 Revision，旧固定 Run 保持原语义。
- 监听状态迁移使用追加 migration，在同一业务 owner 内接管旧 cursor、去重记录与待处理工作；不能仅复制表后同时启动两套处理。
- 已发现另一个前 Flow schema 的本地 standalone 库。现有 Server migrator 对这类库会重建应用表，本次不能直接在原库运行该逻辑。
  对这一旧库先保留原文件，在副本确认可迁移数据与旧语义；它不属于已验证的 schema 14 升级路径。
- Server 当前 staged Integration 创建逻辑对新候选只放行 Stripe；首个 Google Drive 场景必须同时实现其独立候选订阅准备与清理。

### 9.3 已完成的代码准备

- Google Drive cursor 初始化与页面读取已从 HTTP 通知处理拆开，现有回调复用同一读取路径，保持已发布 payload 与准入身份。
- 页面读取不写 subscription 或 checkpoint；调用方仅在成功准入后持久化返回的进度。
- 增加无通知分页读取、失败后重读原 cursor、取消信号传递与异常响应验证。

### 9.4 Server 实施与验证

- 新增 `googledrive.watch_changes` 定义；暂沿用 Integration 的序列化入口，通过 `listener` 能力声明提供周期与 reader。
  旧 `googledrive.changes_detected` 的版本、payload 与回调语义保持不变。新定义不携带 Webhook transport 字段。
- 通知验签后持久化唤醒；候选订阅准备期间同样接收通知，但激活前不创建 Run。定时扫描默认每五分钟补查同一 cursor。
- 新增 SQLite migration 0015，仅增加 `listener_work`；持久化唤醒 generation、扫描租约、下一次调度及独立扫描健康状态。
  页面准入、游标推进和工作完成使用同一事务；空页只更新进度，分页继续处理不依赖后续通知。
- 未变更的发布保留最新状态；变化范围和 Connection 的替换先准备候选，成功后切换并持久清理旧订阅。
  范围切换终止旧范围尚未准入的扫描工作，新范围使用自己的基线，不把旧工作交给新配置。
- 扫描和订阅健康独立；订阅维护失败时仍可扫描。扫描失败或容量不足保留游标；租约过期后可以接续，旧 Publication worker 不能提交。
- 共享 listener conformance 已通过现有 `integration-trigger` 公开 entry 提供。Server 覆盖漏通知、分页、重复通知、通知后重启、
  处理中新增通知、重新发布隔离、容量恢复、checkpoint 写入失败的事务回滚、关机取消、范围替换和 Flow 退役清理。
- 现有开发库副本验证了 14 → 15 升级，34 张原表、1527 行记录逐表比较未变；验证时开发库已处于 15，
  因此只在临时副本移除空的新表并恢复 version 14 后重放迁移。另有带旧订阅和 checkpoint 的迁移测试。
  旧 Project / 未知 schema 不再隐式重置，明确拒绝自动升级并保留原数据，专门迁移仍待后续处理。
- 本阶段尚未发布 npm 包；Workbench/CLI 业务入口、第二个 Provider 及历史 Poll 定义迁移按后续阶段进行。

### 9.5 公共包发布

- 公共包 `0.1.0-beta.18` 已通过发布流程上线，包含此前公共合同和 Server 的变更。

### 9.6 业务入口与第二种读取模式

- Workbench 将 Poll 与 Integration 放在同一个应用触发器目录，直接展示 Provider 的业务说明。
  已发布 snapshot 的 kind、版本和 digest 保持不变，CLI/MCP 和程序化 authoring 继续消费同一 Registry。
- Control API 的 TriggerBinding 增加可选 listener 健康投影。Server 分别返回订阅与扫描状态，
  Workbench 明确显示通知降级、扫描失败和重新授权；暂停与退役优先于机制健康。
- 新增 `github.watch_pull_request`，范围为指定仓库的单个 PR。通知验签并过滤 PR 后只唤醒，
  定时读取同一个 PR 并比较规范化状态版本；首次读取仅保存基线，状态变化后才创建 Run。
  与 Google Drive 的 cursor 分页不同，该定义验证定向对象读取，复用 Server 的同一个 listener 运行时。
- 输出是被观察到的 PR 当前状态与版本，不包含全部中间转换或 review 历史。
  checkpoint 中的单调序号使观察到 A → B → A 可以分别准入，而失败后重读同一进度仍保持稳定身份。
  失去访问权限不推断为删除，订阅创建失败也不重置已保存的基线。
- 新增使用真实 TriggerSummary 与发布状态组件的 Lab Story，同时展示正常、通知降级、读取失败、重新授权和暂停。
  已在 Lab 验证浅色英文和简体中文，验证服务已停止。
- 公共仓库根目录 check 和 test 通过，公共包 1182 项、CLI 90 项、Server 417 项测试通过。
  包含 PR 读取、重复读取、签名过滤、取消、错误响应、独立健康协议与状态呈现。
- 公共包 `0.1.0-beta.19` 已发布，源码提交为 `85200187`（`codex/unified-change-listener`）。
  发布分支的根目录 check、test 与 npm package 消费验证通过；该分支 Server 415 项测试通过。
  原工作区另外两项无关存储测试与其修改未纳入本次发布。
- 其他适用 Poll 定义的迁移、旧 Project 数据转换与阶段四清理仍未完成；本节不代表整个计划完成。

PR 状态字段依据 [GitHub Get a pull request](https://docs.github.com/en/rest/pulls/pulls#get-a-pull-request)。

### 9.7 发布时的进度继承修正

- 发现原来的完整 trigger JSON 比较会将节点改名、说明和图标变化判定为换源，导致重新建立 baseline。
- 公共运行语义投影忽略这三个展示字段；Server 的候选准备、激活和普通发布采用这一规则。
  当前 binding / state 更新到新节点信息，checkpoint、订阅、去重和持久唤醒保留；真实配置或 Connection 变化继续准备候选。
- 旧 Worker 仍须通过当前 Publication 与 runtime version 的准入校验，不能因展示信息兼容而越过发布隔离。
- 进一步只读核实：旧 Server standalone 中有 6 个 Project Revision。
  其中包含旧字典式端口、无显式执行边的数据流图，不能通过改表名或修改 envelope kind 变成当前可执行 Revision。
  这些原库继续保留，尚未实施语义转换；其他适用 Poll 定义的迁移和旧路径退出也仍待完成。

- 已发布公共包 `0.1.0-beta.20`，提交 `be58cc6a`，发布流程与 npm 包消费验证通过。
  发布分支公共包 1182 项、CLI 90 项、Server 417 项测试通过；原工作区包含其他存储修改的 Server 共 419 项通过。

### 9.8 旧 Server Project 草稿转换

- 新增显式离线导入工具 `apps/server/scripts/migrate-project.ts`。使用 SQLite backup API 先保存包含 WAL 提交的完整旧库，
  再将支持的当前草稿写入独立的当前 schema 数据库；输出目录必须是新目录，原始数据库不改写。
- 支持无旧绑定、managed task、subflow 的空图或单 Trigger / 单执行链图，转换字典式端口与执行边，保留模块源码与 Flow ID。
  新 Revision 具有独立 identity，并通过当前 decoder 和完整 Flow validation。未知字段、并行分支、多前驱与损坏 digest 明确拒绝。
- 已实际转换旧 standalone 当前草稿：1 个 Flow 成功，0 个草稿被阻断，未创建 Live 或外部订阅。
  输出位于 `apps/server/.open-flow-dev/project-migration-20260911/`；逐表比较确认备份的 23 张表、603 行记录与原库一致，目标 integrity check 为 ok。
- 历史 Revision、Publication、Run、订阅、监听进度、Presentation 与部署设置仅完整保存在旧库备份，未转为新引擎可执行记录。
  这属于当前草稿导入，不代表完整部署迁移；其他适用 Poll 定义迁移及旧执行路径退出仍未完成。
- 根目录 check 与 Server 424 项测试通过，包含 WAL 备份、正常转换、部分拒绝、损坏 digest、重复内容的身份隔离与拒绝覆盖目录。
  操作与边界见 [旧 Project 草稿导入](../project-draft-import.md)。

### 9.9 公共 Project 草稿转换接口

- 将 Project 图转换收敛到公共 `flow-encoding` 入口，Server 消费同一实现。没有 Trigger 的单一任务链补充手动入口，
  重复节点名称按公共规则消歧；节点 ID、数据引用、字面量输入与模块源码保留，调整记录随结果返回。
- 公共包 beta.21 已发布（提交 `7e5c19e2`），公共发布流程、package 验证和测试通过；发布分支 Server 423 项测试通过。

### 9.10 OneDrive 迁移前的删除身份修正

- 修复 `one_drive.on_item_changed` 使用固定 `itemId:deleted` 的问题：同一 ID 恢复后再次删除会被此前去重记录抑制。
  删除身份改为 delta 读取轮次的起始 token 与 item ID 的稳定 digest；同一轮 continuation 保持该 token，后续轮次独立。
  普通 created / updated 身份、payload、配置、definition snapshot 与已有 checkpoint 格式不变，不要求重建 baseline。
- Provider 回归覆盖同一游标重试、删除后恢复再删除、跨五页预算的 continuation、不同 item 身份及长 opaque token 的有界 digest。
- 此身份表示被观察到的 delta 轮次中的删除，不是上游永久事件 ID。不同轮次重复返回同一删除可能再次准入，
  升级前的 `itemId:deleted` 记录无法反推出读取轮次，不能承诺升级边界上的历史 tombstone 全部跨版本去重。
  不自动改写旧去重记录或进度。微软 delta 只返回最新状态，也不保证捕获读取之间的每一次恢复与删除。
- 已发布公共包 `0.1.0-beta.22`，提交 `324c79c3`。发布分支 check、test 与 npm 包消费验证通过，
  公共包 1184 项、CLI 90 项、Server 423 项测试通过；原工作区 Server 425 项测试通过。
  CI 首次运行在既有 Project 导入测试超时，该测试本地单独 6 项通过，重跑同一提交的发布流程全部通过，未放宽超时或跳过测试。
- 本节只处理计划 9.1 中明确列出的迁移前身份边界；尚未将 OneDrive Poll 改为 listener 或移除其旧调度路径。

协议依据：[Microsoft Graph driveItem delta](https://learn.microsoft.com/en-us/graph/api/driveitem-delta?view=graph-rest-1.0)。

### 9.11 Server 统一读取 owner

- 用 `ListenerRuntime` 接管所有现有 Poll 读取、候选 baseline 和 Integration listener 扫描；删除独立 `PollRuntime`，
  Supervisor 只保留一个监听读取调度入口。订阅创建、续期与事件 callback 继续由 Integration owner 处理。
- 两类读取共用 Connector / Team 作用域、AbortSignal 与读取 deadline；Poll 的事件级去重与 listener 的页面级准入仍分别使用原有权威事务。
  没有创建第二份 checkpoint、改写历史 snapshot / Revision 或搬移数据表。旧 Poll 的调度、checkpoint、claim、去重记录直接由新 owner 使用，
  纯定时读取不要求 callback endpoint。仅运行时 owner 接管，不等于所有 Provider 已获得通知能力。
- 每批最多处理 100 项读取 / baseline 工作，Poll 与 listener 到期时交替处理，避免持续分页的 Poll 饿死其他 listener。
  将扫描到期时间从订阅维护调度中分离，订阅维护不持有扫描锁。
- 增加混合持续分页和重启恢复测试，验证两类工作都推进、binding / runtimeVersion / checkpoint 原样保留，并从原进度继续。
  补充畸形页面校验，验证源返回非法页面时记录失败并保留进度，不能作为未捕获缺陷中止整个监听 worker。
- 提交 `d9016ed`（`codex/unified-change-listener`）。提交分支根目录 check、test 通过，公共包 1184 项、CLI 90 项、Server 425 项测试通过；
  Server test 包含构建。原工作区包含其他存储测试，共 427 项 Server 测试通过。
- 本轮没有发布新 npm 包。
