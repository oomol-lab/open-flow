# OpenConnector 第三方 Trigger 接入计划

状态：代码实现和本地自动化验收已完成，尚未发布或部署。真实第三方账号验收未完成；实施记录见文末。

目标是在开源 `connect` 仓库补齐现有第三方 Trigger 的执行、授权与远端订阅生命周期，让自托管 Open Flow 能通过 OpenConnector 完成配置、发布、接收事件、运行和清理。最终范围是当前目录中的 18 个 provider、21 个 Trigger；先完成代表性闭环，再迁移其余实现。

主要修改发生在 `connect`。Open Flow 负责核对调用协议、保留自身调度与授权边界，并更新目录生成和自托管文档。实施不引入 OOMOL Team、relation-control、Redis 或 BullMQ 依赖。

## 当前依据与接入缺口

截至 2026 年 9 月 30 日，代码核对结果如下：

| 位置                                                  | 已有能力或缺口                                                                                      | 本次处理                                                      |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `oomol-connector/src/flow-triggers/`                  | 已有 provider 实现、严格操作接口、订阅归属、租约及清理                                              | 迁移适用的协议与行为，适配开源基础设施                        |
| `connect/src/core/action-policy.ts`                   | 已有 deployment、runtime、token 三层 Action／proxy policy，没有 Trigger policy                      | 在现有 owner 中增加独立 Trigger 授权                          |
| `connect/src/server/storage/runtime-token-service.ts` | 持久化 runtime token 有稳定 `tokenId`                                                               | 用于首版有状态订阅的调用方归属和持续授权检查                  |
| `connect/src/server/api/runtime-jwt.ts`               | JWT verifier 只返回认证成功与否，没有稳定主体契约                                                   | 保留现有认证语义，不从未经定义的 claims 推断订阅所有者        |
| `connect/src/server/api/runtime-api.ts`               | runtime connected-app 响应没有 `providerAccountId`，Open Flow 飞书事件源创建与 reconcile 必须读取它 | 从已验证的连接 profile 输出应用身份，经真实 HTTP adapter 传递 |
| `connect/src/server/connect-server.ts`                | 执行入口主要按 alias／connectionName 选连接；未解析 Open Flow 使用的 `x-oo-connector-app-id`        | 在共享连接解析与执行 owner 中补齐按稳定 ID 执行               |
| `connect/src/connection-service.ts`                   | disconnect 直接删除本地凭据                                                                         | 增加订阅清理前的连接删除／替换约束，防止丢失清理所需凭据      |
| `connect/src/saas/saas-execution-service.ts`          | SaaS 连接仅有 Action／proxy 转发                                                                    | 首版明确不支持通过该来源执行 Trigger                          |
| Open Flow `apps/server/node/deployment/connector.ts`  | 已调用专门的 Trigger execute API，并提交稳定 connection ID                                          | 联调开源实现，不回退通用 proxy                                |
| Open Flow 自托管指南                                  | 仍用 proxy grant 说明 Poll／Integration Trigger                                                     | 更新独立授权、订阅维护与公开 callback 配置                    |

Open Flow 的 [Trigger 架构](../architecture.md#trigger)、[Flow 鉴权模型](../control/flow-authorization.md)和 [Trigger 权限与执行](../control/trigger-permissions.md)是核对来源。后者当前描述托管 connector 的身份语义；开源身份差异需要在实施时补充，不能直接套用 Team 授权。

## 交付边界

| 职责                                            | OpenConnector          | Open Flow                         |
| ----------------------------------------------- | ---------------------- | --------------------------------- |
| Trigger 定义、配置与输出元数据、所需权限        | 提供源定义与目录生成   | 使用展示快照                      |
| 当前调用授权、连接、凭据与 provider scopes      | 权威校验               | 限制节点的调用范围并提示错误      |
| 第三方请求、分页与回调验证                      | provider 构造与执行    | 提交已注册操作，消费返回结果      |
| webhook／watch 远端资源、验证密钥、归属与幂等   | 保存并管理             | 保存不透明订阅 ID                 |
| 远端订阅创建、续订与删除                        | 执行操作，维护失败清理 | 现有 scheduler 驱动正常 reconcile |
| 飞书共享资源与引用计数                          | 按连接与资源管理       | 保留共享事件 ingress              |
| 业务 checkpoint、事件去重、Flow 发布与 Run 准入 | 不接管                 | 保持现有 owner                    |

首版支持 OpenConnector 本地保存的 API key、OAuth 与 custom credential 连接，具体认证类型沿用每个 provider 的实际能力。OAuth 应用仍由自托管用户配置。

SaaS 和 Marketplace 来源的连接不能通过本地 provider executor 假装执行，也不能借用另一条本地连接。若当前来源没有 Trigger transport，返回明确的不支持错误。SaaS Trigger 转发需要单独核对托管项目的公开接口与权限合同，另行接入。

Manual、Cron、普通 Webhook、Flow Error 等内置 Trigger 不进入本次迁移。新增 SDK／CLI 的订阅命令、独立事件投递平台和完整订阅管理 UI 不作为首版前置条件。

## 操作协议与代码归属

保留当前 Open Flow 已消费的两个入口：

- `GET /v1/providers/:service/trigger-permissions`：返回真实权限与认证元数据，遵循现有 locale 处理约定。
- `POST /v1/providers/:service/triggers/:triggerId/execute`：执行严格的 operation 判别联合。

| operation   | 输入用途                                                   | 返回及约束                                                     |
| ----------- | ---------------------------------------------------------- | -------------------------------------------------------------- |
| `options`   | 配置与字段                                                 | 返回该 Trigger 已注册的配置选项                                |
| `read`      | 配置与 checkpoint                                          | 返回现有 Poll 或 listener 页面；分页与游标由 provider 校验     |
| `reconcile` | 配置、endpointUrl、requestKey、active、可选 subscriptionId | 创建、续订或取消服务端拥有的订阅；返回不透明 ID 与调度状态     |
| `receive`   | subscriptionId、回调原始字节、必要 headers／query 等       | 使用服务端保存的配置与密钥验证，返回事件、唤醒、忽略或协议响应 |
| `resource`  | 飞书资源配置、requestKey、active                           | 维护逻辑使用者与共享资源订阅关系                               |

实施前对照两端当前类型核实全部字段，包括飞书共享事件来源标识与回调 body 限额。沿用现有 Poll／listener／Integration 输出，不新增统一事件模型或改变已有端口含义。未知字段、不支持的 operation、跨 provider 的 Trigger ID 和客户端自报 accessGrant 均拒绝。

第三方 endpoint、method、认证 headers、远端 hook／channel ID 与删除参数始终由服务端构造。`receive` 提交的 method／headers／rawBody 仅描述待验证回调，不能转化为任意第三方请求。

建议的开源代码归属：

- Provider 元数据归 `src/providers/<service>/definition.ts`；确有规模需要时拆出 provider-local 定义文件，由该入口引用。
- 执行实现归该 provider 的 `executors.ts` 或其正常导入的 provider-local runtime 模块。扩展现有 ProviderLoader 与生成 registry，保持 executor 模块首次执行时才加载。
- 操作解析、配置校验、订阅状态机与维护归 `src/triggers/`，与 provider-specific 请求分开。
- HTTP 入口归 `src/server/`，`/v1` 响应序列化继续归 `src/server/api/runtime-api.ts`。
- Store contract 接入现有 `RuntimeDatabase`；SQLite、PostgreSQL、D1 使用现有事务、迁移与 secretCodec 设施。

复用已有凭据解析、OAuth refresh、超时、取消、错误分类、日志脱敏与 SSRF guarded fetch。Trigger 授权后可内部复用 provider proxy transport，但不要求调用方同时拥有公共 proxy 权限。

Scope 元数据转换为开源侧已有的 provider-native scopes／capabilities。不能把闭源 `gmail.read` 等内部别名机械复制成第三方 OAuth scope。没有可靠 scope 映射时明确记录 provider 权限检查的边界。

飞书接入还须补齐 runtime connection 元数据。在 `runtime-api.ts` 的 connected-app 类型与 serializer 中输出验证过的 `providerAccountId`，使 Open Flow 的 `runtimeConnection` 能读取它。现有飞书应用机器人 validator 已通过应用凭据获取 tenant token，并将应用 ID 保存为 `profile.accountId`；应传播这个验证结果，不增加客户端手填 appId、默认值或凭据字段。管理接口已有该字段，不能以管理接口可读代替 `/v1/apps` 的实际接入验收。

## 独立授权与连接身份

### Policy 规则

建议在现有 policy 中增加以下字段，沿用 Action 的匹配语法：完整 ID、`<service>.*`、`*`。

| 层级                       | 字段与默认行为                                                                    |
| -------------------------- | --------------------------------------------------------------------------------- |
| deployment／runtime policy | `allowedTriggers`、`blockedTriggers`；空 allowlist 表示本层不额外收窄，block 优先 |
| 持久化 runtime token       | `allowedTriggers`；省略或空列表拒绝全部 Trigger                                   |
| connection grant           | 继续使用 `allowedConnections`，对实际选中的稳定 ID 校验                           |

新增能力采用显式授予。既有持久化 token 迁移为 `allowedTriggers: []`，现有 Action／proxy 的默认语义不改变。维护任务读取当前 deployment、runtime 与 token policy，不把创建时的 grant 保存为持续权限。

仅允许一个 GitHub Trigger 的 token 创建请求示例，字段是本计划建议新增的合同：

```json
{
  "name": "open-flow-github-events",
  "allowedActions": [],
  "blockedActions": ["*"],
  "allowedProxies": [],
  "allowedTriggers": ["github.on_repo_event"],
  "allowedConnections": ["<github connection id>"]
}
```

`allowedActions: []` 在当前开源实现中不禁止 Action；Trigger-only token 必须同时使用 `blockedActions: ["*"]`。需要运行 Connector Action 节点的 Flow 应按实际用途另行配置 Action 规则。

Token 创建、更新、回读、SQL 存储、OpenAPI 和现有 Access 控件共同更新。实施涉及控件时遵循各仓库前端约定，并验证实际保存与读取行为。

### 有状态操作的身份

首版建议要求 `reconcile`、`receive`、`resource` 使用持久化 runtime token。归属由认证中间件解析出的 `tokenId` 决定，不接受请求中的 actor、Flow ID、deployment 名称作为主体证明。

同一个 token 可供多个 Flow 使用；它们用 requestKey 分开订阅，服务端不声称按 Flow 隔离同一 token 的权限。不同 token 不能读写对方的订阅，即使二者允许同一连接和 Trigger。

`options`／`read` 可沿用现有 runtime 认证路径并校验相应 deployment／runtime policy；持久化 token 还须满足其 Trigger 与 connection grants。环境 runtime token、JWT 和无认证开发模式没有首版有状态订阅身份。通过这些路径提交有状态操作时明确报错，不新增临时主体或从 bearer 明文派生身份。

管理员通过最小管理接口查看脱敏订阅状态并发起取消，服务端内部清理可以处理失效 token 留下的资源。该接口不接受任意远端资源 ID，不提供伪装成另一个 token 的执行能力。

### 稳定连接 ID

Open Flow 已提交 `x-oo-connector-app-id`。OpenConnector 应在共享连接选择 owner 中解析此头，并直接以稳定 ID 取得、验证和使用同一条连接，核对 provider、来源与 connection grant。缺失、断开或已替换时失败，不能回退默认连接。

现有 alias 调用继续按其合同选连接。同时提交冲突的 ID 与 alias 时拒绝。不要在 Open Flow 加入“先查 ID 再发 alias”的补偿，它无法保证查询与执行之间连接没有变化。

同一共享解析链路服务 Action、proxy 和 Trigger；本次修正影响它们时，需要覆盖相关消费者。连接删除后用同 alias 重建得到的新 ID 不能接管旧订阅。

## 订阅状态与维护

保存最小控制状态：订阅 ID、owner tokenId、connection ID、Trigger ID、requestKey、不可变配置与 callback、回调随机标识及密钥、provider 控制状态、下次维护时间、生命周期状态和租约。正常业务扫描 checkpoint 仍由 Open Flow 推进；保留现有协议必要的初始化／续订状态，避免续订响应覆盖已推进的扫描位置。

- 创建幂等按 owner、connection、Trigger、requestKey 隔离。同一键的配置或 callback 变化产生冲突；已删除记录的重新启用按既有合同重置控制状态并轮换验证信息。
- 创建前落盘意图，再执行第三方请求并保存结果。结果丢失时按本记录的完整 callback 恢复，不能根据用户原始 callback 地址接管其他资源。
- 控制操作取得持久化租约；租约过期的执行不能提交状态。覆盖跨进程并发、取消和进程退出，不用进程内锁代替 SQL 协调。
- 正常创建／续订仍由 Open Flow reconcile 驱动。OpenConnector 维护任务检查 token 是否存在、当前权限与待删除状态，执行撤权清理及删除重试，不重复调度 Flow。
- Token 撤销、Trigger grant 收窄或 connection grant 移除后，拒绝新调用并将其订阅转入清理。一次暂时性授权查询失败不能被当作已确认撤权。
- 清理以服务端记录的资源为范围，可以绕过已撤销的调用方 grant；不能绕过资源归属、provider 凭据或出站安全边界。
- 正常断开或切换连接来源前先取消相关订阅。首版可在存在未清理订阅时拒绝删除／替换，提供订阅列表与管理员取消入口；完成清理后才删除凭据。约束放在连接写入 owner，并与订阅创建协调，避免检查后仍出现新订阅。
- 同一连接的正常 OAuth token refresh 保持现有生命周期，不视为账号替换；用户重新配置凭据或变更来源时，必须避免新账号凭据被用于清理旧账号资源。
- 凭据在第三方被撤销时，远端删除可能无法完成。保留可识别的失败状态与管理员处理指引，不把失败标为已清理，也不保存额外 credential 副本规避连接生命周期。

订阅保护不能阻断恢复旧账号访问的重新授权。在连接 credential replacement 的 owner 验证新凭据；能证明属于同一 provider 账号时，允许更新该稳定连接并恢复清理，仍须处理并发 revision 变化。账号证明使用 provider validator 的可信身份，不能只比较 alias、displayName 或用户自报字段。无法证明同账号时继续拒绝带订阅的普通替换。

若原账号访问无法恢复，管理员应先在第三方处理资源，再确认本地记录收尾。确实无法删除远端资源时，提供显式放弃自动清理并断开本地连接的管理操作：保留“远端未清理”的记录与资源归属，停止其自动重试，不将其标为删除成功；新连接不能接管这些资源。该操作与正常 disconnect 分开，避免旧凭据失效导致连接永久无法处理。

Token 轮换的首版流程是：暂停相关 Trigger、使用旧 token 或管理员取消订阅、等待清理完成、配置新 token、重新启用并建立新订阅。新 token 不接管旧 token 的订阅。轮换窗口可能漏过第三方事件，不能承诺无缝；业务 checkpoint 按现有 Open Flow 语义保留。

轮换还必须处理 Open Flow 保存的旧 subscriptionId：通过 binding 生命周期明确重建远端控制绑定，保留业务 checkpoint。第二阶段核对现有取消／发布路径是否满足；缺少可操作路径时在该 owner 补齐，不要求用户编辑数据库，也不在遇到归属错误后自动清空状态并重建。

飞书轮换的等待条件还包括 Open Flow 的共享资源状态收尾：所有使用旧 token 的相关 binding 释放 resource demand，旧 token 下的取消完成后，由 event-source 生命周期删除本地 `source_subscriptions` 记录，再切换 token。仅暂停事件准入或仅由 connector 管理员取消远端资源不满足这个条件；本地仍为 `ready` 时，当前 reconcile 会跳过新的 resource 调用。提前撤销旧 token 或取消结果不确定时，通过显式恢复路径确认远端和本地状态，不能靠换 token 自动修复，也不能删除其他仍有效使用者的 demand。

复用 `secretCodec` 保存敏感状态，遵循部署是否配置 encryption key 的现有合同；启用加密的部署不得把验证密钥或配置明文写入表、日志或管理响应。

Node／Docker／headless runtime 使用现有维护服务的 `start`、`run`、`close` 生命周期模式。Cloudflare 在已有 `scheduled` 入口执行有界批次。共用状态机与 SQL 租约；关闭 runtime 时停止维护、取消在途任务并等待收尾。

## Provider 迁移范围

以实施起点的 `catalog.generated.json` 与闭源注册表核对 ID、definitionVersion、配置、输出和实际支持的操作。当前清单如下：

| Provider        | Trigger ID                                                                                |
| --------------- | ----------------------------------------------------------------------------------------- |
| Airtable        | `airtable.on_record_changed`                                                              |
| 飞书应用机器人  | `feishu_app_bot.on_event`                                                                 |
| Gmail           | `gmail.on_message_received`                                                               |
| GitHub          | `github.on_repo_event`、`github.watch_pull_request`                                       |
| GitLab          | `gitlab.on_project_event`                                                                 |
| Google Calendar | `googlecalendar.on_event_changed`                                                         |
| Google Drive    | `googledrive.changes_detected`、`googledrive.watch_changes`、`googledrive.on_file_change` |
| Google Sheets   | `googlesheets.on_row_added`                                                               |
| Linear          | `linear.on_issue_changed`                                                                 |
| Notion          | `notion.on_database_page_event`                                                           |
| OneDrive        | `one_drive.on_item_changed`                                                               |
| Outlook         | `outlook.on_message_received`                                                             |
| Shopify         | `shopify.on_shop_event`                                                                   |
| Slack           | `slack.on_message_posted`                                                                 |
| Stripe          | `stripe.on_event`                                                                         |
| Telegram        | `telegram.on_update`                                                                      |
| WooCommerce     | `woocommerce.on_store_event`                                                              |
| Zendesk         | `zendesk.on_event`                                                                        |

迁移保持现有 push／poll／listener 行为，本次不顺带更换采集策略。Telegram 保留单 webhook 冲突拒绝；Drive 保留 watch 通道与 listener 扫描分工；飞书按逻辑使用者维护共享引用，最后一个使用者退出才取消远端资源。

遵循 `connect/AGENTS.md`：纯 provider 迁移不复制闭源已有的 provider-local 测试。开源新增的 auth、policy、store、connection resolution、维护与适配行为在共享模块旁测试；需要改变 provider 行为时按其实际 owner 补充回归证据。

## 实施顺序与阶段产物

### 第一阶段 固定协议与补齐执行边界

1. 对照当前闭源和 Open Flow 类型确认请求／响应、回调大小、错误分类及共享事件来源验证。
2. 补齐稳定 connection ID 的共享解析，验证两个同 provider 账号、默认账号切换及删除重建。
3. 增加 Trigger policy、token schema／存储迁移、HTTP 输入及元数据序列化，默认不给旧 token 授予新能力。
4. 建立懒加载的 Trigger execution 入口，复用凭据、OAuth、取消和受保护出站链路。

产物：可审查的开源接口与权限合同；Gmail read 和 Linear options 使用显式授权成功；无授权、错误来源、跨连接与畸形 checkpoint 均被拒绝。现有 Action／proxy 的账号选择没有被破坏。

### 第二阶段 完成 GitHub 订阅闭环

1. 实现 SQLite、PostgreSQL、D1 的订阅 store、幂等与租约，接入现有迁移入口。
2. 迁移 `github.on_repo_event`，实现 reconcile／receive 和管理员查看／取消。
3. 接入 Node 与 Cloudflare 维护、token 撤权清理、runtime close，以及连接删除／替换约束；打通同账号重新授权恢复清理和管理员放弃自动清理的处理路径。
4. 通过现有 Open Flow adapter 完成配置、发布、回调验证、Run、停用、删除和重启恢复，并验证 token 轮换后的显式绑定重建。

产物：使用持久化 runtime token 的完整 GitHub 闭环。只有 options／read 可用不算该阶段完成。真实 webhook 验收使用可从第三方访问的 HTTPS Open Flow callback。

### 第三阶段 迁移其余现有 Trigger

1. 迁移其余 Poll、配置选项和 listener 读取。
2. 迁移其余 webhook provider，覆盖创建响应丢失后的恢复与签名验证。
3. 完成 Drive 续订与扫描 checkpoint、Telegram 冲突，以及飞书 runtime 应用身份传播、共享事件来源、资源引用计数和 token 轮换后的本地状态收尾。
4. 按 provider 核对 authTypes、provider-native scopes、运行时限制和输出元数据。

产物：21 个 Trigger 在本地连接路径均有实际实现，Node 与 Workers 支持范围有明确证据。平台不支持的 provider／来源应明确返回不支持，不仅保留可发现的目录项。

飞书必须通过本地连接经 `/v1/apps` 和真实 Open Flow adapter 创建事件源、验证 callback、发布／reconcile、事件产生 Run 的完整链路。资源订阅另验共享引用、停用清理和 token 轮换后重新申请，不能仅以 resource handler 可调用作为接入完成。

### 第四阶段 接通公开构建与自托管交付

1. 在开源 provider 定义中建立 Trigger 展示目录的源，扩展已有 catalog generator，并提供导出 Open Flow 快照的入口。
2. 验证导出的 snapshot、options、listener interval 和 eventSource 与 Open Flow 消费合同一致。保持字段、版本及输出语义；仅生成来源变化不需要重写历史 Revision。
3. 从开源定义更新 Open Flow `catalog.generated.json`，保留现有本地化资源；公开构建与 CI 可以在没有私有仓库时完成。
4. 更新 OpenConnector runtime API、catalog format、配置、权限及部署文档。更新 Open Flow 的自托管指南及其译文，删除依赖 proxy grant 执行 Trigger 的旧说明。
5. 验证 headless tarball、provider 选择构建、Docker 与 Workers 的 registry、目录和 migrations 均包含所需能力；不在裁剪构建中误带全部 Trigger executor。

产物：可安装、可部署、可复现的公开实现；一份独立 Trigger grant 的自托管样例和逐项验收记录。闭源后续共享定义／行为的同步方式另行处理，不阻塞开源交付。

## 验收与检查

自动化必须能观察实际边界，不以文件存在、class 名或注册项数量替代行为证据。

| 验收面        | 必须覆盖的行为                                                                                                                                       |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 授权          | Trigger-only 可用；同 provider 其他 Trigger、未授予连接、伪造 grant 拒绝；旧 token 不自动获得权限                                                    |
| 身份与账号    | 两个 runtime token 不能交叉操作订阅；非默认账号按稳定 ID 执行；删除／重建与并发替换不能漂移到另一账号                                                |
| 操作与来源    | 未注册操作、原始请求扩展字段、恶意游标拒绝；SaaS／Marketplace 不走本地 fallback                                                                      |
| 生命周期      | 并发 reconcile、远端创建结果丢失、租约失效、取消与 runtime close、重启、重复删除、同键重建                                                           |
| 撤权与清理    | 当前 policy 与 token 撤销生效；删除失败重试；connection 写入与订阅创建竞态；同账号重新授权恢复清理；管理员放弃清理保留未清理记录                     |
| Provider 特性 | 回调签名与旧 callback 拒绝；Telegram 冲突；Drive 续订不覆盖扫描 checkpoint；飞书应用身份经 runtime API 创建来源与发布；共享资源引用及 token 轮换恢复 |
| 持久化与平台  | SQLite、PostgreSQL、D1 共同行为；加密配置生效；多实例／scheduled 维护按租约协调                                                                      |
| Open Flow     | 真实 HTTP adapter、implicit scope、发布／暂停／恢复、去重与事件输出；托管 selectable 路径保持既有语义                                                |
| 公开产物      | 独立消费者可安装运行；导出目录不依赖闭源；裁剪构建与 migrations 完整                                                                                 |

OpenConnector 实施完成后运行 `npm run fix-check`、`npm run generate:catalog` 与直接相关的 Vitest 测试。本次涉及共享执行和存储，最终合并前运行 `npm test`。执行 `npm run build:runtime`，按现有 npm 发布流程打包、在隔离消费者安装并验证 Trigger；同时复用并扩展现有 headless smoke。Workers 和 PostgreSQL 使用各自现有测试／迁移流程，不假定 Node 测试能代表其他后端。

Open Flow 按受影响边界运行 Server adapter／Trigger runtime 测试；公共 package 改动运行 `packages/open-flow` 下的 `bun run test`，并从根目录运行 `bun run --filter @oomol-lab/open-flow test:package`。自托管组合部署验证真实 HTTP 和公开 HTTPS callback。提交前按仓库要求运行根目录 `bun run check`。

没有真实第三方账号时，可完成 fake upstream 的自动化，但验收记录必须将“本地可执行”与“真实第三方已验证”分开。全部 provider 有实现不等于全部 provider 已做真实账号验收。

## 升级与完成条件

先部署带迁移和维护能力的 OpenConnector，再创建／更新 runtime token 的 Trigger grants，最后更新 Open Flow 并启用流程。PostgreSQL 继续显式运行 runtime migration；启动只检查 schema readiness。

此前由通用 proxy 创建、没有服务端所有权记录的远端资源，需要原部署或账号管理员先清理。新版不能信任 Open Flow 保存的旧 hook／channel ID，也不能在识别到旧状态后静默再创建一份。旧 connector 返回 404 或其他错误时，Open Flow 应保留可诊断失败，不恢复原始 proxy 路径。

交付完成需要同时满足：

- 21 个现有 Trigger 的本地连接实现、独立授权和订阅生命周期已覆盖。
- 自托管 Open Flow 与 OpenConnector 的代表性完整闭环通过，平台和真实账号验证范围有记录。
- 持久化 runtime token 的撤销、轮换、管理员清理与连接删除流程可操作。
- 公开目录、包产物、部署文档和译文与实现一致。
- 所有实际运行的检查及未验证部分都记录清楚；清理验收服务器和临时资源。

本文中的 token 所有权、首版有状态认证范围和连接删除约束是建议的实现合同。实施第一阶段应固定并记录这些选择；若需要环境 token／JWT 同样拥有独立订阅，应先定义其可信主体和持续授权来源，再调整范围。

## 实施记录（2026-09-30）

OpenConnector 已实现严格的五操作 API、Trigger 独立授权、稳定连接 ID、18 个 provider 的 21 个原生 Trigger、持久化订阅和失败清理。SQLite、PostgreSQL、D1 共用订阅合同，订阅状态沿用部署配置的 secret codec；SQLite 和 PostgreSQL 的密钥轮换包含订阅。飞书资源通过 provider executor 注册并按原账号共享引用；`/v1/apps` 传播已验证的应用 ID。管理接口提供订阅列表、cancel 和显式 abandon。

Open Flow 已改用公开 OpenConnector checkout 生成目录，并更新七种语言的自托管指南。联调补齐了 callback `connector_subscription` nonce 转发和独立 Trigger 拒绝码映射，允许首次发布 GitHub 仓库 webhook 候选订阅。GitHub 已有订阅的配置替换继续遵循原有安全限制，拒绝在候选准备时修改 current 资源；其他 webhook 的候选发布限制没有扩展。

| 检查                                      | 结果                                                                                                             |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| OpenConnector `npm run fix-check`         | 通过                                                                                                             |
| OpenConnector `npm test`                  | 3,405 通过，20 跳过；包含 SQLite、PostgreSQL、D1、原生 Trigger HTTP 合同和 token grant 保留                      |
| OpenConnector catalog 与 headless 包      | 生成、构建、打包通过                                                                                             |
| 安装实际 tarball 后的 Node／compiled host | 全部 1,567 provider、仅 GitHub、空 provider 均通过；GitHub 实际原生 executor 的创建和清理通过 fake upstream 验证 |
| OpenConnector Web 和 Workers              | Web 构建及 Wrangler `deploy --dry-run` 通过，未执行部署                                                          |
| Open Flow `bun run check`                 | 通过                                                                                                             |
| Open Flow package `bun run test`          | 2,360 通过                                                                                                       |
| Open Flow `test:package`                  | 公开 tarball、Browser exports 与隔离消费者检查通过                                                               |
| Open Flow Server `bun run test`           | 构建产物后，61 个测试文件、729 项全量测试通过                                                                    |
| 两仓库实际 HTTP 联调                      | GitHub 与飞书的发布、回调到 Run、验证应用身份、token 撤销后清理通过；第三方请求由 fake upstream 承接             |
| 全部目录合同对照                          | 21 个 snapshot、options、listener interval、eventSource 与升级前目录语义一致                                     |

跨仓库联调使用临时验收测试和真实本地 OpenConnector HTTP 服务，测试结束已关闭服务并删除依赖机器绝对路径的测试文件。长期回归位于各自 owner：OpenConnector 的共享存储／原生 HTTP 测试，Open Flow 的 remote callback、ConnectorClient 错误映射和 GitHub 候选发布测试。

未验证项：没有使用真实 GitHub、飞书或其余 provider 账号完成第三方网络验收；Workers 检查是构建和 D1 行为验证，没有部署到 Cloudflare；尚未发布 npm 包。Token 轮换的旧订阅排空和飞书 ready 缓存重建仍按文档要求由部署操作执行，不提供自动跨 token 接管。

PostgreSQL 验证使用项目现有的 PGlite socket fixture；三后端专项检查曾在 SaaS 回滚用例遇到间歇性的 `unexpected commandComplete` socket 错误。完整测试复跑用于确认结果；本次未改动测试基础设施。
