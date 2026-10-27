# Connector Trigger 操作契约与首批验收

本契约覆盖两个 Connector 与 Open Flow 的全部 7 个 Source Provider 引用操作、声明式回调握手、Poll 批量契约。真实账号验收由用户执行，当前未部署。

## 操作边界

客户端通过 `POST /v1/providers/:service/triggers/:triggerId/execute` 调用注册操作，由 Connector 构造第三方请求并执行凭据访问。未知操作和未知请求字段拒绝执行，不回落到通用 proxy。

| 操作        | 调用方提供                                                            | Connector 返回和负责的行为                                       |
| ----------- | --------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `options`   | 业务配置、字段名                                                      | 配置选项；不能创建订阅或 Run                                     |
| `read`      | 业务配置、上次成功提交的 checkpoint                                   | 下一页或下一次观察；不得替 Open Flow 提交业务消费进度            |
| `reconcile` | 业务配置、callback URL、稳定 requestKey、active、可选 subscriptionId  | 准备、维护或清理远端订阅；只暴露不透明订阅身份                   |
| `receive`   | subscriptionId、原始 callback 字节及受控 headers/query、admit/current | 校验订阅关联和第三方签名，返回事件、唤醒、忽略或 HTTP 响应       |
| `resource`  | 业务配置、稳定 requestKey、active                                     | 维护共享资源需求与清理                                           |
| `source`    | initialize/update/inspect/prepare/receive 及现有 Source 快照          | 当前仍是 Source 协议计算；不能据此宣称 Connector 已持久化 Source |

同一有效订阅的 requestKey 绑定不可变业务配置和 callback URL。创建响应丢失后通过持久化状态与上游资源关联恢复，不能直接重建；清理失败保留资源身份，重复成功清理不重复执行上游删除。

`receive` 的外层 200 表示 Connector 已处理操作，内部 `respond.status` 才是应返回第三方的 HTTP 状态。不能把无效签名产生的内部 401 当作可准入事件，也不能混淆为调用 Connector 的认证失败。

`connector_subscription` 关联当前订阅创建世代；缺失或不匹配时返回内部 404。它不能代替 Provider 签名或调用方订阅所有权校验。订阅删除后回调被忽略，不能恢复活动状态。

## 身份与进度

Tally 表单事件使用上游 `eventId` 作为业务去重键。相同回调重试必须产生相同的输出和身份；Connector 返回重复事件是允许的，Open Flow 负责去重准入。

GitHub Watch PR 观察当前状态，不保证观察到每一次中间变化。checkpoint 包含状态摘要和递增序号；没有变化时输出为 null。有变化时返回新 checkpoint 和 `sequence:version` 身份，调用方重复使用旧 checkpoint 必须得到同一次观察结果。状态 A → B → A 的第二次 A 是新的观察，不能被首次 A 的摘要去重掉。

Open Flow 在准入事务成功后推进业务 checkpoint。容量拒绝或提交失败时继续持有旧 checkpoint，后续读取允许重放同一观察。Connector 订阅初始化保存的 baseline 不等同于 Open Flow 后续消费进度。

Poll 保持 definitionVersion 2 和 `events[]` 输出。每个非空去重结果页创建一个批量 Run，页内多条事件一起交给下游，保留原有聚合、执行次数和成本语义。Run 准入成功后才提交 checkpoint，容量不足时保留旧 checkpoint 以便重试。首轮 baseline、重叠读取去重、候选与当前版本 fencing 保持原保证；本轮不引入单事件模式或定义升级路径。

## Slack 共享应用回调

共同用例通过公开 `source` 操作初始化同一应用的两个 workspace Source，检查身份不同且事件只匹配对应 workspace、应用和机器人安装。签名验证使用原始字节，覆盖带空白和 Unicode 的 JSON、大小写 header、正文被重序列化、过期时间戳、缺失签名及重复大小写 header。

有效 challenge 返回原始 challenge 并建立 readiness。事件按 event type 和 channel 匹配消费者；Slack 重试 header 不改变规范化事件与 `event_id`。不匹配来源返回成功的空响应，无效签名返回内部 401，均不能产生事件。

这些用例固定现有无状态 Source 协议，不证明两个 Source 已在 Connector 共用一条应用记录，也不证明跨 Team 授权、共享秘密轮换或本地 Run 去重。它们是阶段三调整状态所有权前的回归基线。

## 持久化 Source

通过原注册操作入口 `POST /v1/providers/slackbot/triggers/slackbot.on_event/execute` 调用新的 `operation: "sourceReference"`。这是真实管理入口，直接读写正式应用状态，没有候选快照导入或暂存阶段。同一操作适用于 Feishu、Slack、Intercom、Sentry、Zoom、Fireflies、Jira。共享入口按 owner、deploymentId、Trigger key、appId 隔离；无共享应用入口的 Source 按 requestKey 独立持久化。

创建请求示例（连接仍由现有 HTTP 连接选择器指定）：

```json
{
  "operation": "sourceReference",
  "request": {
    "action": "create",
    "deploymentId": "open-flow-production",
    "requestKey": "source-create-unique-id",
    "input": {
      "appId": "A123",
      "workspaceId": "T123",
      "signingSecret": "replace-with-signing-secret",
      "eventTypes": ["app_mention"]
    }
  }
}
```

创建返回 `source: { reference: { applicationId, sourceId }, revision, eventTypes, view, ready, expiresAt? }`。引用的字段值是不透明身份，不能作为授权凭据，也不能由客户端自行构造。后续请求带相同的 `deploymentId` 和 `reference`；创建结果未知时，删除的 `reference` 也可使用 `{ appId?, requestKey }`（共享应用入口要求 appId），由 Connector 在属主作用域内定位：

| action    | 其他输入                                                           | 结果                                                                             |
| --------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| `get`     | 无                                                                 | 当前公开 Source 视图与 readiness，不返回秘密或内部状态                           |
| `prepare` | 消费者 `config`，包括 `eventTypes`                                 | 检查共同验证状态、连接账号和事件类型；Slack 无托管远端订阅，返回空 subscriptions |
| `receive` | 原始 `rawBody`（base64）、`headers`、`consumers`                   | 从持久化配置验签，返回 challenge 响应或匹配消费者的规范化事件                    |
| `update`  | `expectedRevision`、`input.eventTypes`，可选 `input.signingSecret` | 条件更新事件类型及应用共享秘密，返回新的公开 Source 视图                         |
| `delete`  | 无                                                                 | 幂等返回 `{ "deleted": true }`；删除后读取和接收返回 404                         |

Source 的应用、工作区和连接身份不可修改；事件类型和共享秘密通过 `update` 修改。相同应用、相同 requestKey 重试返回同一引用；已有引用对应的配置或秘密冲突返回 409。不同应用下的 requestKey 分别命名。删除后保留不含秘密的 Source 记录，旧 create 重试返回 409，不复活已删除对象；重新创建必须使用新的 requestKey。调用方须在首次远程创建前持久化 requestKey，响应丢失后继续使用它。按创建身份删除时，即使创建尚未到达也写入删除标记，阻止迟到的创建请求复活资源；授权仍检查所选 Connection 及已存记录的归属，不需要上游凭据。

connect 将应用归属绑定到已认证的 persistent runtime token；环境级临时 token 无法使用此操作。托管 Connector 只接受可信 Team workload，并绑定 Team 主体。创建、读取、修改、准备和回调检查当前解析出的连接及账号；删除按持久化归属和显式连接 ID 校验，不读取或刷新上游凭据。connect 仍检查 token 的 Trigger 与连接权限，托管侧仍要求可信 Team token 并检查随请求提供的 accessGrant；Source ID、请求中的业务字段和 deploymentId 都不能替代这些授权检查。`deploymentId` 是可信调用方选择的命名空间，不是独立认证身份；复用同一凭据的调用方具有该凭据的权限，不能把不同字符串当作额外的权限隔离。

同一归属、deployment、应用下的 Source 共用一份秘密和验证状态。一次有效 challenge 更新整个应用的 readiness；新建同应用 Source 必须使用相同秘密。删除一个 Source 保留其他 Source 的状态，删除最后一个清空应用的当前秘密与验证状态。之后用新 requestKey、新秘密创建的 Source 必须重新验证。活动应用可以通过 `update` 修改共享秘密，所有关联 Source 立即失去验证状态，必须使用新秘密完成 challenge；不提供无中断轮换或双密钥过渡。

`revision` 是应用记录现有的数据库版本，由同应用的 Sources 共用；创建、删除、配置修改和 challenge 写入都可能推进它。`update` 使用最近读取的 `expectedRevision`，实际需要修改且版本已变化时返回 409，调用方重新读取后决定是否重试。请求中的事件类型和可选秘密已经等于当前值时直接返回当前视图，允许响应丢失后的重复提交；不会再次写入或清空后来完成的验证。它不保证重放历史结果，也不新增操作日志或查询服务。修改事件类型只影响指定 Source，修改秘密影响整个应用；名称和启用状态不属于此接口。

应用以一条经过现有 SecretCodec／SecretCipher 编码的记录持久化，内部含共享状态和 Source 集合，最多 100 个活动 Source。更新使用数据库 revision 比较并交换；并发创建、删除或 challenge 发生冲突时重新读取，持续冲突返回 409。旧 challenge 的在途结果不能恢复已经删除并重建的应用状态。正常事件不重写未变化的状态，但返回前复核读取版本。接收端只输出 Source 配置中声明的事件类型。

connect 的 SQLite、PostgreSQL、D1 共享存储实现；SQLite 和 PostgreSQL 的存储密钥重加密及完整 runtime reset 包含新表。托管 Connector 使用真实 Postgres store。connect 延续部署选择的 codec，明文 codec 不会自动变成加密存储。最后一个 Source 删除不代表历史备份中的秘密已经擦除。

Open Flow 已接入全部 7 个 Provider 的引用操作。Trigger 传输使用双方均支持的 `appId` 查询参数指定连接，删除由有管理权限的 operator 发起，客户端不再先要求该连接仍存在或有效。Connector 保留原属主隔离，其他属主无法删除。未知操作明确失败，不回退到传递整份 Source 或秘密。正式 Open Flow 路径不再使用旧 `source` 操作；Connector 保留该已发布 wire 契约。

### Open Flow 的持久化与重试

Server 迁移 54 增加稳定的部署命名空间，以及现有 Source 行上的 Connector 引用和未完成操作字段。Source 本地 ID 同时作为首次创建的 requestKey；创建前即持久化，响应丢失或重启后沿用。Source 保存公开视图缓存和应用／工作区路由信息，`secrets_json` 始终为空，不写入 Slack 的 `event_source_apps` 记录；请求指纹是摘要，不保存原始秘密。

名称和启用状态仅在本地修改。Provider 配置修改与删除先在本地事务内检查 revision、当前和准备中消费者，再记录未完成操作；同应用的冲突操作、发布和新的回调准入暂时拒绝。远端确认后提交本地结果；明确拒绝的编辑解除未完成状态，结果未知则保留状态，调用方以相同内容重试。相同请求可在重启后继续，无后台任务自动补交秘密。未完成创建需重试原请求后才能编辑，也可直接删除；未完成编辑允许删除接管，但仍受消费者约束。删除通过 Connector 确认后才移除本地记录，失败可重试，无远端资源时连接失效不阻断引用删除；尚有托管资源时必须完成远端清理，失败保留引用供恢复。创建失败保留本地记录供重试或删除，避免并发失败误删另一请求已完成的 Source；迟到的创建／编辑响应不得覆盖删除意图。

普通列表读取、发布准备及回调从 Connector 获取公开投影。修改秘密后清除其他关联 Source 的投影缓存，并推进本地 revision 以拒绝旧在途结果；新的验证状态只从 Connector 读取。事件仍通过现有持久化投递、去重和 Run 准入链路。

没有无中断密钥轮换、双密钥过渡、独立撤权清理系统或删除记录回收。上线前复查 Source 存量，迁移遇到任何旧 Source 时整笔回滚并明确拒绝，不能据目标 production 为空而丢弃其他部署的数据。

## 错误与版本

| 错误                       | 操作 HTTP 状态 | 调用方行为                                     |
| -------------------------- | -------------- | ---------------------------------------------- |
| `invalid_input`            | 400            | 修正操作、配置或 checkpoint；不是无限重试      |
| `invalid_input` 配置冲突   | 409            | 同一 requestKey 已绑定其他配置，不能覆盖       |
| `trigger_connection_error` | 409            | 检查连接与授权                                 |
| `proxy_upstream_error`     | 503            | 保留进度并重试                                 |
| `provider_error`           | 500            | 结果可能不确定，查询或幂等重试，不直接重建资源 |

共同用例不要求两个部署具有相同的授权规则。connect 使用 persistent token、connection、verified account；托管 Connector 使用 Team、principal、app。授权隔离由各自已有测试负责。

当前操作请求没有 definition revision 或 protocol version 协商。未知版本字段被严格 schema 拒绝，只能证明输入拒绝行为。目录一致性检查也不能替代部署间版本协商；后续破坏性改动必须先实现可识别的兼容或拒绝边界。

## 可重复执行的检查

从 Open Flow 根目录执行，路径分别指向安装了依赖的两个源码 checkout：

```sh
node scripts/check-trigger-contracts.ts /path/to/connect /path/to/oomol-connector
```

共同用例唯一源位于 connect 的 `contracts/triggers/conformance.ts`。Open Flow 脚本使用同一份用例运行两个适配器，再导出目录，比较全部 36 个 Trigger 在两个 Connector 与 Open Flow 内置目录中的完整声明。临时目录在成功或失败后清理，不更新生成文件。

connect 适配器使用真实 HTTP 路由、token 选择、TriggerRunner 和 SQLite 内存存储，替换上游 Provider transport。托管适配器使用真实 controller、请求解析、Provider 实现和订阅管理，替换 credential executor 并使用现有内存 store。托管适配器不证明完整授权链路；两个适配器均不证明数据库重启恢复或真实第三方行为。独立的存储测试另外验证 SQLite 文件数据库重开、Postgres 连接重建、存储密钥重加密和旧回调写入隔离；这些仍不替代真实 Slack 账号验收。

共同验收覆盖全部 Source 引用生命周期、Slack 事件类型编辑与共享秘密重新验证、Jira 托管资源创建响应丢失后的恢复及清理、Asana 创建期握手，以及 Tally/GitHub 既有操作。Slack 发布、投递和 Run 去重通过 Open Flow 纵向脚本验证；所有第三方 Provider 的真实账号行为仍需人工验收，不能将 mock 当成该证据。失败报告区分行为用例失败、目录不一致与环境/依赖失败。

### Slack 纵向验收

`bun scripts/check-trigger-contracts.ts <connect-checkout> <managed-checkout>` 现在也会用两个适配器分别运行 `apps/server/scripts/check-trigger-source.ts`。脚本经过 Open Flow 的控制面、Source runtime、发布与 Run 准入，以及 Connector 的实际请求解析和 Source 实现，验证签名 challenge、重复事件、修改秘密、重新验证和连接失效后的删除。远端账号由适配器提供，托管适配器使用内存存储；这不替代真实 Slack 账号和真实数据库验证。

Server 的 Source 引用测试另行覆盖未完成操作的重启重试、秘密不落地、编辑与消费者约束、旧回调拒绝、连接失效后的未完成创建／编辑删除、迟到响应不覆盖删除、并发创建失败不误删成功记录和迁移拒绝；Connector 的 SQLite／PostgreSQL 测试覆盖正式状态持久化。

## 本轮新增操作与回调契约

`prepare` 接收消费者 config 及可选 endpointUrl，返回不透明资源 key。远端订阅配置只保存在 Connector；`resource {reference,key,active}` 复用现有资源订阅协调与恢复逻辑，返回 outcome 和公开 Source 投影。活动或状态不确定的资源必须先清理成功，才允许删除 Source。Open Flow 的 uncertain 状态记录待确认进度，不再阻止重试；资源幂等和恢复由 Connector 的已有订阅状态机负责。Jira 创建响应丢失后按已有远端回调地址查询，确认恢复后不重复创建。

`route {deploymentId,applicationId,headers,rawBody}` 只用于共享应用入口。Connector 验签并匹配来源，返回 reference 列表或 HTTP challenge/拒绝响应。路由不读取来源凭据；匹配后的 receive 仍验证连接、账号和消费者。路由授权仍限制应用归属及连接 grant。Open Flow 只向匹配且本地启用的 Source 投递，全部持久化成功后确认普通事件；匹配处理失败返回可重试错误。应用级 CAS 防止旧验签结果覆盖新秘密状态。

Integration 目录声明 `callback.headers/query`，Open Flow 只按声明转发，保留原始 body。Connector 发起远端创建前已有订阅身份，URL 带 `connector_reference` 与 nonce `connector_subscription`。Asana 的候选握手先验证订阅归属、active 与 nonce，再调用只返回 HTTP 响应的握手处理，不取得正在创建的订阅锁，不激活生产绑定。

### 路由测量

本机内存测试中，双后端分别在 1、10、100 个同应用 Source 下完成两次重复回调与投递检查。每次普通回调始终 2 次 Connector 调用；对应两次回调及检查总时长约为 connect 11.32/6.77/18.03 ms、托管适配器 5.55/5.30/14.02 ms。此数据衡量本地协议开销，不是生产网络延迟承诺。旧路径每次请求逐个调用 N 个来源；新路径为一次应用路由加匹配来源数，Connector 内签名/匹配遍历仍为 O(N)。额外 Source 的 receive 被模拟为连接不可用，目标事件仍成功，证明没有调用无关来源处理。
