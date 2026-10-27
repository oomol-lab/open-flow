# Trigger 架构收敛实施计划

状态：本轮代码调整与自动化验收已完成。2026-10-27 按用户要求一次覆盖全部现有 Source Provider，真实账号验收由用户手动执行；部署前的版本和存量复核仍待上线时完成，未部署。

本轮覆盖 Feishu、Slack、Intercom、Sentry、Zoom、Fireflies、Jira 的 Connector 引用所有权；Asana 创建期握手与声明式回调转发；10 个 Poll 的单事件输出与旧版显式升级；共享应用路由。Connector 持有秘密、Provider 配置和远端订阅状态，Open Flow 保存引用、公开投影和本地消费者/投递状态。已有 Source 行上的未完成操作指纹用于重试和删除竞争，不增加导入暂存层、操作日志或后台清理框架。

2026-10-27 已只读核实目标 production 两个租户分片的 Source 及相关记录均为空。Server 迁移 54 对任何旧 Source 明确拒绝并保留原数据。发布前仍需复查部署版本和存量；本地测试不等于真实第三方验收。

实现与兼容边界见 [操作契约](connector-contract.md) 和 [发布基线](release-baseline.md)。以下阶段保留设计依据，当前实现不再限于首批 Slack。

保留现有 Publication、调度、去重、恢复和 Run 准入机制，收敛事件语义与 Connector 协议。目标是让新增 Provider 主要发生在 Connector，让同一 Trigger 在两个 Connector 后端具有一致的业务行为，并让用户不必因为采集方式改变而重写 Flow。

本计划采用两个推荐目标：普通离散事件默认一事件一 Run；Connector 持有 Provider Source 的配置、秘密和远端资源状态。实施时先完成公开契约，再修改运行行为；已发布批量 Poll Flow 的语义升级仍需显式迁移设计。现有已发布契约不能因本计划而被静默替换。

## 目标边界

| 所有者                   | 持有的数据和行为                                                                              |
| ------------------------ | --------------------------------------------------------------------------------------------- |
| Open Flow 公共包         | 节点业务配置、输出契约、公共 authoring、协议消费与输出验证、部署 conformance                  |
| Open Flow Server         | Publication、消费者绑定、调度、业务读取 checkpoint、事件去重、持久化投递、Run 准入与恢复      |
| Connector                | Provider 配置和身份验证、签名秘密、上游请求、远端订阅与续租执行、Provider Source 状态及其投影 |
| connect 部署适配         | persistent token、连接和 verified account 的授权与订阅归属、存储和维护调度                    |
| oomol-connector 部署适配 | Team、principal、app 的授权与订阅归属、存储和维护调度                                         |

保留 Open Flow 的公开回调入口。Connector 负责验证第三方回调并返回规范化事件或握手响应，Open Flow 负责可靠保存和投递。此轮不把 Connector 改造成承载全部事件队列和业务调度的平台。

共享应用入口保留三个层次：application ingress 持有应用级 signing secret 和验证状态；账号或项目 Source 引用该入口并持有来源身份与配置；Flow consumer 持有业务过滤条件和消费关系。前两层由 Connector 持久化，消费者由 Open Flow 管理。没有应用共享入口的 Provider 保持自己的 Source 模型。

应用级状态不能按 Source 复制。阶段一明确 application 的授权和共享作用域；同一授权作用域内的多个 Source 引用同一份应用状态，不能仅凭相同的 `app_id` 合并不同 Team 或部署的资源。跨作用域共享需要明确授权契约，否则拒绝合并。

Open Flow 保存的 Source 引用和消费者配置不包含 Provider 验签秘密或远端资源 ID。Connector 的状态投影由 Connector 生成；Open Flow 自己的发布准备进度、投递积压和 Run 错误独立保存。

业务 checkpoint 继续归 Open Flow，必须与事件准入一致提交。Connector 的订阅恢复状态不能被当成业务消费进度，两者需要在协议中分别命名和解释。

## 保留的运行保证

- 所有候选资源准备成功后，才能原子切换 Live 并激活绑定；失败保留旧 Live。
- 无法独立准备候选资源的修改明确拒绝，不能先拆除线上资源再补偿。
- 当前 Publication、binding 和 runtime version 决定准入；旧 worker 和候选回调不能绕过检查。
- 关闭 Flow 阻止新的生产准入，已接受的 Run 按原有机制继续执行。
- 通知唤醒和扫描进度分别持久化；扫描期间到达的通知不能丢失。
- 同一准入身份至多创建一个普通 Run。这个保证不等同于第三方事件完整性或外部副作用 exactly-once。
- 删除最后一个消费者才释放共享资源；撤权、续租失败和清理失败保持可诊断、可恢复。
- Source 修改和删除必须与发布、消费者变更保持一致：明确失败的操作不能改变当前 Live 使用的有效配置；已提交但响应丢失的操作按同一身份查询或重试，不能被当成未执行。跨服务调用不能替代本地原子约束。
- 应用密钥轮换使所有关联 Source 的旧验证状态一起失效，有效 challenge 更新共同验证状态；删除一个 Source 不影响其他 Source 的应用入口，最后一个引用完成清理后才能删除应用状态。

## 阶段一 固定契约和发布基线

目的：在跨三个仓库修改之前，确定共同语义及真实兼容义务。

1. 核实三个项目实际发布和部署的版本，记录 artifact、源码提交、协议能力及受支持的旧版本。按 [contract evolution](../control/contracts/compatibility.md#release-baselines-and-contract-versioning) 判断版本边界；本计划不预先指定新版本号，也不按 PR 次数递增契约。
2. 编写共同 Trigger 协议规范，明确 `read`、`options`、订阅控制、callback receive 与 Source 管理的请求和响应。协议覆盖事件身份、checkpoint、分页、错误分类、取消、能力缺失及不支持版本的拒绝行为。
3. 将“离散事件”“状态观察”“明确的业务批次”区分开。离散事件默认一事件一 Run；状态观察只承诺被观察到的变化；分页和上游 delivery 不直接定义业务批次。
4. 定义去重作用域和保留期限：相同配置重新发布、改变过滤条件、切换连接、重新创建 Source、手动重放分别是否产生新准入身份。不能把各路径现有不同的哈希公式直接当作统一产品语义。
5. 选择共同协议和 fixtures 的唯一维护位置。优先放在公开 connect 的独立、可版本化契约产物中，由另两个仓库消费；避免让托管服务依赖整个 Open Flow 产品包或 connect Server。

交付物：协议规范、版本兼容表、旧数据和旧 Flow 的迁移清单、三仓库的依赖与发布顺序。

验收：同一事件经不同分页、重复通知或不同后端处理，预期业务结果和准入身份可以被明确描述；旧版本不兼容时能在创建副作用前拒绝。

## 阶段二 建立双后端协议验收

先用测试固定现有有效行为，再调整状态所有权。共享 fixtures 和断言消费公开操作，不复制 Provider 的签名、事件解析或状态机实现。

| 场景                                      | 必须观察的结果                                       |
| ----------------------------------------- | ---------------------------------------------------- |
| 正常事件、重复回调、相同事件不同 delivery | 规范化输出和业务身份一致，重复不新增准入             |
| 初始化与分页续读、重启后继续              | checkpoint 含义一致，不丢页、不错误跳过数据          |
| 临时错误、权限失效、非法配置              | 错误分类一致，调用方能决定重试或重新授权             |
| 创建响应丢失、取消、重复清理              | 不重复创建远端资源，保留未完成清理记录               |
| 候选订阅握手与旧回调                      | 握手可完成，候选不能启动生产 Run，旧绑定不能继续准入 |
| 版本或能力不匹配                          | 明确拒绝，不回落到原始 proxy 或静默改变输出          |

Provider 首批选用 Gmail Poll、GitHub Watch PR、Tally webhook、Asana 握手、Slack 共享应用回调和 Jira 共享托管资源，分别覆盖不同协议形态。其余 Provider 在受影响的共享路径通过后逐步接入。

connect 的 token ownership 与托管 Connector 的 Team/principal ownership 分别验证。权限差异不要求返回完全相同的结果，但必须满足各自的隔离、撤权和清理契约。

交付物：两个后端可运行的同一套协议 fixtures、目录兼容检查，以及 Open Flow 消费端的协议测试。

验收：故意引入输出、事件身份或错误分类差异时，测试能够在对应边界失败；不能只比较 schema 或静态目录是否相等。

## 阶段三 收敛 Source 状态所有权

主要改动位于两个 Connector 的 `sources`、订阅存储和管理接口，以及 Open Flow 的 `event-source-runtime`、`event-source-store` 和公共 Source 契约。

本阶段已从 Slack 的纵向闭环扩展至全部 7 个现有 Provider。下面规定行为和所有权，不预先要求通用配置版本、操作日志或后台清理框架。

1. Connector 持久化应用共享秘密、验证状态和 Source 配置，返回不透明引用。新建 Source 直接进入正式存储；读取、准备和回调按引用操作，不再往返传递整份 Source 和秘密。
2. Open Flow 保存本地 Source ID、Connector 引用、消费者关系与部署状态，接通创建、读取、验证、回调、可靠投递和删除。Provider 投影由 Connector 生成，移除 Open Flow 对其内部字段的修改；保留现有发布、去重和准入检查。
3. 保留现有编辑能力，按字段所有权处理：名称和启用状态由 Open Flow 管理，Provider 事件类型配置由 Connector 管理。修改事件类型时复核现有及准备中消费者的需求；与发布并发或明确失败的修改不能破坏当前有效配置。先检查实际调用链和现有事务能力，只为必须跨服务协调的操作增加必要状态，不预设不可变候选配置或通用版本系统。
4. signing secret 在应用级修改，所有关联 Source 的验证状态一起失效，再通过有效 challenge 重新验证；旧在途结果不能恢复新秘密的 readiness。明确告知修改会影响该应用下的所有 Sources，不实现无中断轮换或双密钥过渡。
5. 删除复用现有消费者和发布约束，远端删除保持幂等；不能在删除过程中新增有效消费者。远端调用失败或结果未知时保留足够的引用信息供重试，不能提前丢失清理对象。按实际失败路径决定必要的本地状态，不建设通用操作日志或操作结果查询服务。
6. 读取、使用、修改和删除分别校验真实归属，连接换账号或撤权后不得继续处理事件。检查现有授权与撤权入口，优先直接接入；有权限的管理方在连接失效后仍应能删除本地持久化 Source，不能要求有效的上游凭据。Slack 当前没有需要注销的托管远端订阅，不以独立后台清理系统作为接入前置条件。其他 Provider 的续租、远端撤销和重试在接入该 Provider 时按实际资源生命周期处理。
7. 上线前只读复查目标环境的 Source、订阅、准备记录、投递记录和消费者绑定仍为空。若出现真实存量，再决定处置方式；不提前实现导入、暂存、迁移日志或长期双写。当前核验不代表所有自托管和开发环境均无数据。

交付物：两个 Connector 与 Open Flow 的全部 Source 引用闭环、现有编辑和删除能力、共享秘密修改后的重新验证，以及对应协议与部署说明。响应丢失时明确如何通过现有读取或幂等重试确认状态，不要求额外的通用操作基础设施。

验收覆盖以下行为：

- 从 Open Flow 创建 Source，读取引用和验证状态，接收 challenge 与事件并可靠投递；重启后可继续使用，回调重试不增加重复 Run。
- 修改名称、启用状态和事件类型保持现有能力；移除消费者所需事件类型被拒绝，与发布并发或明确失败的修改不破坏当前有效配置。
- 创建响应丢失后重试不重复创建；修改、删除结果未知时可确认当前状态或安全重试，删除期间不能新增有效消费者。
- 同一应用两个 Sources 共用秘密和验证状态；修改秘密后共同失效，有效 challenge 恢复共同状态，旧在途结果不能恢复 readiness。
- 删除一个 Source 不影响另一个，删除最后一个清空当前秘密和验证状态；连接失效后仍能由有权限的管理方删除。不同归属不能访问或修改彼此资源，撤权后不能继续处理事件。
- 秘密不出现在普通读取、日志或节点输出中。

正式链路切换时同步更新消费者并移除不再使用的代码。只保留有实际发布义务的兼容行为；协议已发布不等于存在需要迁移的 Source 数据。

## 阶段四 移除 Open Flow 的 Provider 协议分支

1. 由 Connector 定义回调需要的 headers、query 和 body 能力；Open Flow 提供受大小限制的通用转发。回调中的授权头作为受保护输入，与调用 Connector 的认证头隔离。
2. 解决创建期间的握手关联。Connector 必须在发起上游创建前持久化可用于握手的关联身份，Open Flow 能在正式订阅激活前调用验证路径。
3. 验证 Asana 创建请求等待 callback 的场景不会与 Connector 订阅锁互相等待。握手处理不能依赖尚未完成的创建结果，也不能借机激活生产绑定。
4. 删除 `remote.ts` 中的 Asana 名称分支与手写 Provider header 清单。Provider 解析与握手响应归 Connector；Open Flow 只执行通用协议。

交付物：通用回调适配、Connector 握手实现和双后端行为测试。

验收：增加一个具有新签名 header 的普通 webhook Provider，不需要增加 Open Flow 的 Provider 名称分支；创建响应丢失和握手重试仍可恢复。

## 阶段五 分离采集分页与 Run 语义

主要改动涉及公共 Poll 契约、Server Poll 准入事务、输出定义、authoring、Workbench 与 CLI/MCP 场景。

1. 规范化采集结果为带稳定业务身份的事件序列和下一 checkpoint。Poll 可以按页读取，Watch 可以按通知唤醒，两者均不以页大小决定下游输入结构。
2. 普通事件逐个准入 Run。首版优先沿用页内原子提交：容量不足时整页不推进 checkpoint，重试不重复准入。明确单页上限和可接受容量，防止一页永远无法被接受。只有证据表明需要时才增加部分页进度。
3. 保留首轮建立 baseline、过滤、重叠读取去重、续页恢复、关闭 Flow 和旧 runtime fencing 的现有保证。
4. 生成新的单事件输出契约，并同步公共创建、读取、局部编辑、schema/examples、诊断、搜索和 Workbench。调用方不构造内部定义或手工补默认端口。
5. 已发布的批量 Poll Flow 不自动变成单事件 Flow。Draft 升级报告受影响的输出映射、循环和 Run 数量变化；无法保持业务意义时要求用户明确修改，不能猜测数组到对象的映射。
6. 旧 Publication 与运行中 Run 继续按已发布契约处理；不再支持执行的版本明确阻止升级或要求先排空、保留匹配运行环境。新语义经重新发布生效，历史 Revision 和 Run 不重写。

交付物：单事件契约、显式升级路径、受影响 Trigger 的端口和使用说明，以及端到端 authoring 场景。

验收：同一组事件使用不同页大小、跨页重复和重启续页后，得到相同业务事件集合与输出；容量拒绝不丢事件；旧 Flow 不静默改变行为。单事件 Run 数量增加带来的执行成本需以代表性负载测量并记录。

首轮不新增通用批处理窗口、聚合 DSL 或任意配置开关。确有业务批次需求时，单独定义其边界和失败语义。

## 阶段六 优化共享应用回调路由

本阶段只优化路由和性能。阶段三已保证共享秘密和验证状态一致，以及修改秘密后的重新验证；这些保证不依赖路由优化，不要求无中断轮换或独立后台清理系统。

1. 建立同一应用下 1、10、100 个 Source 的测试，记录每次回调的 Connector 调用数、响应延迟和投递结果。加入一个来源连接失效、慢响应与重复回调。
2. Connector 在应用级验证签名并返回规范化路由身份，Open Flow 按已验证身份选出匹配 Source，再进行必要的来源验证与业务处理。未验证的 payload 只能用于候选查找，不能授权投递。
3. 保留来源和消费者版本的最终复核，避免签名有效但 workspace/account 不匹配的事件进入其他 Flow。
4. 对匹配目标持久化投递后再确认普通事件；握手和挑战按各自协议同步响应。一个无关 Source 的失效不应阻断目标 Source。

交付物：通用应用路由协议、受影响 Provider 适配和前后对比结果。

验收：只匹配一个 Source 的事件不会随应用全部 Source 数量线性增加 Connector 调用；无关来源故障不影响目标投递；真正多目标事件仍对每个目标正确去重。若当前规模尚不构成问题，可在完成基线测量后延期本阶段。

## 实施顺序与发布

依赖关系：阶段一 → 阶段二 → 阶段三 → 阶段四。阶段五依赖阶段一、二的契约和测试，可作为独立发布批次；阶段六依赖稳定的 Source 身份与回调协议。

每阶段保持可独立审查和验证，不把三个仓库的全部改造压成一次发布。先交付一个纵向闭环，再扩展 Provider 数量。协议测试可以先落地，破坏性行为必须与实际兼容义务对应的升级或拒绝机制一起交付。

默认先发布支持目标协议的 Connector，再升级 Open Flow 公共包与 Server，在确认 Source 存储为空后启用正式 Source 链路，最后显式升级和重新发布受影响的批量 Poll Flow。阶段一需确认滚动升级是否可行；不具备兼容条件时采用明确维护窗口，不假设“Connector 先发”就一定兼容旧客户端。

新 Source 创建后，回滚必须考虑新存储中的配置、秘密和远端资源，不能只切换二进制。发布说明列出可回滚边界与恢复步骤；禁止回滚时重新创建不确定是否存在的上游订阅。

## 验证和完成条件

- Open Flow 公共包测试从 `packages/open-flow` 执行 `bun run test`，不用 `bun test`。
- Server 执行受影响的 publication、poll、integration、event source、恢复与隔离测试；按共享边界扩大验证范围。
- 影响公开包代码、类型或资源时，从仓库根目录执行 `bun run --filter @oomol-lab/open-flow test:package`。
- 每次提交前从根目录执行 `bun run check`；另外两个仓库使用其届时有效的检查与包验证命令。
- 修改节点 authoring 时执行受影响 CLI/MCP Lab reference 场景；修改界面时先使用 frontend-ui skill，并在 Lab 检查真实组件及组合状态。
- 两个 Connector 分别进行已接入 Provider 的真实账号验收。Slack 覆盖创建与握手、重复投递、重启、撤权后的使用拒绝、修改秘密后重新验证和删除；续租、远端注销仅在 Provider 实际存在这些资源时验证。Mock 不能代替第三方协议证据。

整体完成时，新普通 Provider 不再要求 Open Flow 增加专用协议分支；Source 状态只有一个持久化权威；两个后端通过同一行为契约；分页不改变新事件型 Flow 的业务输入；现有已发布 Flow 的迁移和恢复路径可验证。

## 本轮交付与验收边界

- 两个 Connector 共用公开 connect 的行为 fixtures，覆盖全部 Source 创建/读取/编辑/删除，Slack 验签、共享状态及权限，Jira 创建响应丢失恢复和资源清理，Asana 创建期间握手，Tally 与 GitHub 现有协议；36 个目录逐项对照。
- 单事件 Poll 使用 definitionVersion 3 和对象端口 `event`；已发布 version 2 保留 `events[]`。以 key + definitionVersion 选择执行定义。公共 `node.refresh` 显式升级 Draft，保留旧映射并通过诊断报告失效引用，修正后重新发布。历史 Revision、Publication、Run 不改写。
- 页内 Run 准入、去重及 checkpoint 一起提交；容量不足回滚整页。单页最多 100 个事件，部署容量不足以容纳当前页时报告永久配置错误，要求提高容量；不引入部分页进度。
- CLI/MCP Lab 的 `poll-event` 使用真实公共 authoring 和执行，验证创建、读取、局部修改、显式 refresh 与单事件输出。运行时测试另覆盖旧版批量、不同页大小、跨页重复、重启和容量回滚。
- 共享应用实测 1/10/100 Sources：只匹配一个 Source 的普通回调均为 2 次 Connector 调用；挑战只需路由。Connector 内复用 Provider 的既有验签和来源匹配函数，CPU 仍随 Source 数量增长，没有额外索引或路由框架。来源凭据只在匹配后的处理阶段检查。
- 发布工作与真实账号验收未自动执行。用户负责真实账号，部署方负责镜像/包版本、数据库状态与发布前 Source 空存量复核。历史批量 Flow 的业务映射由用户显式升级，不能自动推测数组到对象的业务含义。

暂不重写 scheduler，不引入消息中间件、通用批处理窗口或 Provider 公共框架。

## 相关实现与规范

- [现有架构](../architecture.md#publication-and-trigger)
- [Trigger 权限与执行](../control/trigger-permissions.md)
- [共享事件源](shared-event-sources.md)
- [Node authoring](../authoring/node-authoring.md)
- [远端 Trigger 适配](../../packages/open-flow/src/trigger/providers/remote.ts)
- [Poll 输出契约](../../packages/open-flow/src/trigger/common/poll.ts)
- [Source 运行时](../../apps/server/node/runtime/event-source-runtime.ts)
- [Source 持久化与投递](../../apps/server/node/storage/event-source-store.ts)

相邻仓库的主要入口为 connect 的 `src/triggers/`、`src/providers/`、`scripts/export-flow-trigger-catalog.ts`，以及 oomol-connector 的 `src/flow-triggers/`、`src/proxy/` 和 `scripts/flow-triggers/`。

## 自动化验收记录（2026-10-27）

- Open Flow 公共包：237 个测试文件、2,952 个测试通过。
- Server：全量 95 个测试文件、1,203 个测试通过；包含 Feishu 资源响应丢失恢复测试，确认 Open Flow 不再用旧的 uncertain 分支阻止 Connector 重试。
- connect：Trigger 55 个测试、SQLite/PostgreSQL 与持久化 Source 99 个测试通过；fix-check 与 runtime package 构建通过。
- 托管 Connector：flow-triggers 203 个测试、持久化 Source 测试通过；fix-check:full 通过。
- 双后端共同协议、36 个目录及 Open Flow 纵向验收通过；1/10/100 Source 路由测试包括不可用的无关来源。
- CLI/MCP Lab `poll-event` 均通过。实际 Open Flow npm tarball、浏览器运行时和 bundled command 隔离消费者通过。
- 本轮没有改视觉布局，Workbench 端口与说明通过公共目录、presentation/localization 测试验证；没有将静态测试或 mock 计为真实第三方账号验收。
