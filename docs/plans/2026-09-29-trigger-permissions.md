# Trigger 独立权限实施计划

状态：已在工作区实施不可信调用方方案，权限、生命周期、PostgreSQL、前端构建和包产物自动化验证已通过。未提交、未部署；真实第三方账号及生产网关验收尚未执行。

## 1. 已确认的边界

- 调用方是用户自部署的 Open Flow，代码、请求与本地持久化都不可信。
- 开发／配置可以使用用户或服务账号 Token，部署后的 Open Flow 使用 team-token。授权与 Action execute 一致：用户／服务账号查询当前 app-access，team-token 使用 Team 权限并检查可选 accessGrant；actor 仅用于审计。
- 继续使用现有 Token 认证与可信网关传递主体的机制。用户自部署实例不是可信网关；connector 的认证头仍必须只来自已有可信认证边界。
- 权限粒度仍为“连接 + Trigger ID”。Trigger 配置中的标签、仓库、筛选条件是业务配置，除非权限组另有明确资源限制，否则不承诺它们是管理员授予的资源 ACL。
- 用户拥有某个 Token 的全部权限。不能通过限制 Open Flow 界面把一个宽权限 Token 变成窄权限 Token；需要最小权限时使用受 app-access 约束的主体。
- 不迁移 Open Flow 的流程调度、Run、去重与工作流执行，不增加实例注册或新的 Token 体系。

## 2. 覆盖范围

全部 18 个 provider 的 21 个现有第三方 Trigger 都要接入。手动、Cron、普通 Webhook、Error 等不使用第三方连接的内置 Trigger 不受影响。

| Provider        | Trigger ID                        | 能力                         |
| --------------- | --------------------------------- | ---------------------------- |
| Airtable        | `airtable.on_record_changed`      | 记录创建或更新               |
| 飞书应用机器人  | `feishu_app_bot.on_event`         | 应用事件与资源订阅           |
| Gmail           | `gmail.on_message_received`       | 收到新邮件                   |
| GitHub          | `github.on_repo_event`            | 仓库事件                     |
| GitHub          | `github.watch_pull_request`       | 监测 Pull Request            |
| GitLab          | `gitlab.on_project_event`         | 项目事件                     |
| Google Calendar | `googlecalendar.on_event_changed` | 日历事件变化                 |
| Google Drive    | `googledrive.changes_detected`    | Drive 变更通知               |
| Google Drive    | `googledrive.watch_changes`       | 通知与定期扫描结合的变更监测 |
| Google Drive    | `googledrive.on_file_change`      | 文件夹内文件或文件夹变化     |
| Google Sheets   | `googlesheets.on_row_added`       | 新增表格行                   |
| Linear          | `linear.on_issue_changed`         | Issue 创建或更新             |
| Notion          | `notion.on_database_page_event`   | 数据库页面新增或更新         |
| OneDrive        | `one_drive.on_item_changed`       | 文件或文件夹变化             |
| Outlook         | `outlook.on_message_received`     | 收到新邮件                   |
| Shopify         | `shopify.on_shop_event`           | 店铺事件                     |
| Slack           | `slack.on_message_posted`         | 频道新消息                   |
| Stripe          | `stripe.on_event`                 | 账号事件                     |
| Telegram        | `telegram.on_update`              | Bot 更新事件                 |
| WooCommerce     | `woocommerce.on_store_event`      | 店铺事件                     |
| Zendesk         | `zendesk.on_event`                | 事件订阅                     |

第三方运行实现注册表在 connector 的 `src/flow-triggers/providers/definitions.ts`；Open Flow 从该实现生成展示快照并注册操作客户端。同一 provider 的多个 Trigger 独立授权。

## 3. 代码检查发现

1. 当前新增的 `/v1/proxy/:service/triggers/:triggerId` 接受任意 proxy 请求。它只能证明 ID 已注册，不能证明请求属于该 Trigger，应删除并替换。
2. connector 的 `src/execution/runtime.ts` 已有按用户／服务账号查询 relation-control app-access 的授权链路。Trigger 复用该公共链路；team-token 沿用 Action 的 Team 执行与可选 accessGrant 语义，用户／服务账号不能自报 grant。
3. Open Flow 的 `PollDefinition.poll`、`configOptions`、`IntegrationDefinition.reconcile` 和 `listener.read` 已明确分离。可以搬迁第三方交互部分，保留本地调度与输出组装。
4. GitHub reconcile 从本地 subscription 读取 hookId 并执行 PATCH/DELETE；Drive 的 channel 与资源 ID 同样影响远端清理；飞书保存原始 subscribe/unsubscribe 请求。这些都不能成为 connector 的可信远端资源标识。
5. Telegram webhook 属于 bot 全局资源。现有逻辑会拒绝覆盖另一个 callback；迁移时必须保留此约束，不能把不可信 callback 比较当作所有权证明。
6. connector 现有 Trigger 系统包含订阅、后台轮询和事件投递，其 ID、配置与 Open Flow 不完全相同。不得为了复用表而把 Open Flow 外部驱动的操作伪装成旧系统自动调度的订阅；可复用其真实适用的 provider、凭据与持久化设施。

## 4. 最终职责

| 职责                                     | connector            | Open Flow                    |
| ---------------------------------------- | -------------------- | ---------------------------- |
| Token 主体、连接归属、app-access、scopes | 权威校验             | 可做提前提示                 |
| Trigger 配置的服务端校验                 | 权威校验             | 表单校验与配置保存           |
| 第三方 endpoint、method、headers、body   | 由 provider 实现构造 | 不再提交原始请求             |
| 单页轮询、监听读取、选项查询             | 执行并返回规范化结果 | 调用与消费                   |
| 远端订阅标识、归属、续订与删除           | 权威保存与操作       | 保存 connector 返回的订阅 ID |
| 工作流调度、checkpoint、去重、Run        | 不接管               | 保留                         |
| webhook 事件接收与本地流程触发           | 不默认增加中转       | 保留已有路径                 |

普通 proxy 仍是独立能力。Trigger 实现可在 connector 内复用 proxy 传输、凭据、超时、取消和错误处理，但不能再次暴露一个绕过 Trigger 语义的公共 proxy 通道。

## 5. 操作接口

沿用 provider 下的轻量元数据接口：

`GET /v1/providers/:service/trigger-permissions?locale=zh-CN`

业务操作统一使用 `POST /v1/providers/:service/triggers/:triggerId/execute`，通过严格的 `operation` 判别联合定义输入：

| 操作        | 输入与输出                                                                         |
| ----------- | ---------------------------------------------------------------------------------- |
| `options`   | 配置、字段；返回配置选项                                                           |
| `read`      | 配置、checkpoint；返回规范化事件／输出与下一页 checkpoint                          |
| `reconcile` | 配置、callback、幂等键、active，可附 connector 订阅 ID；创建、续订或清理本记录订阅 |
| `receive`   | connector 订阅 ID、原始回调字节及回调 headers/query；验证签名后返回事件或唤醒结果  |
| `resource`  | 飞书资源配置、幂等键、active；维护按主体隔离的需求与共享引用计数                   |

不复用已有 `/v1/trigger-subscriptions` 管理路由，以免混淆现有 connector 自动调度订阅的合同。

同一 Trigger 只注册实际支持的操作；不同 Trigger 的 read 输出按已有 poll/listener 合同适配，不强制制造无用的通用结果模型。

执行顺序：认证主体 → 解析 provider/Trigger/操作 → 校验输入 → 解析连接与当前 app-access → 校验 scopes → 调用 provider handler → 规范化输出。

严格拒绝未声明字段、未知操作、未知 Trigger、跨 provider/连接及用户／服务账号提供的 accessGrant。服务端决定执行时间、分页与请求数量上限；不接受任意上游 URL、GraphQL、headers 或请求体作为扩展出口；`receive` 的 headers 和原始字节只用于验证第三方回调。

游标是外部输入。按 provider 校验并重建固定 API 请求，不能直接跟随客户端传入的 nextLink。只有游标包含不能由客户端修改的授权状态时才采用服务端保存或完整性保护，不默认引入游标签名系统。

## 6. 订阅状态与生命周期

connector 保存最小必要的远端控制状态：订阅 ID、团队与主体类型／ID、连接、Trigger、配置、callback、远端标识、必要密钥、版本和生命周期状态。Open Flow 本地记录不再提供 hookId/channelId 或原始取消订阅请求作为执行依据。

- 创建使用按主体、连接与 Trigger 隔离的幂等键；失败重试不能重复创建或接管其他订阅。
- 更新、续订、读取和清理核对服务端记录归属并按 Token 类型检查权限；Team 订阅绑定已认证 Team，不按审计 actor 分割。不能通过传入另一个远端 ID 或伪造本地状态管理其他订阅。
- callback 是自部署实例正常提供的业务输入，按协议校验并绑定订阅。connector 为 callback 附加每条记录独立生成、加密保存的随机标识；故障恢复只匹配该完整地址，不能仅据客户端原始 callback 相同接管 webhook。
- Telegram 等单实例资源保留冲突拒绝；飞书共享资源按连接和资源维护实际订阅关系，删除一个使用者不能取消其他使用者仍需要的订阅。
- 创建前后的状态持久化、超时、重试和并发更新必须处理，避免远端已创建但本地记录缺失。复用现有持久化与任务设施中语义匹配的部分。
- 权限撤销后拒绝新的读取、创建和续订。Team 订阅不套用用户撤权判断，已开始的删除由 worker 重试。已创建资源的清理作为服务端拥有的受限生命周期动作，只能作用于本记录资源；不能为了清理向客户端重新开放写权限。
- 所有权与生命周期状态在 connector；Open Flow 保留业务 checkpoint、事件去重和调度。webhook 本身可能包含完整事件，未定义的客户端过滤不能被描述成服务端数据访问限制。

## 7. app-access 与元数据

保留此前独立授权字段：`triggers: "*" | string[]`，指定 ID 含 provider 前缀。

- Trigger-only：`{ "actions": [], "triggers": ["gmail.on_message_received"] }`。
- 省略 actions 沿用全部 Action 语义；省略 triggers 时仅旧完全不受限 grant 保留全部 Trigger，旧受限 Action grant 不自动获得 Trigger。
- 显式 Trigger grant 不开放通用 proxy。metadata、管理 Action、控制台的默认组、自定义组与成员配置共同遵循此合同。
- requiredScopes 表示 connector 内部 scope；providerPermissions 与 instructions 说明第三方细粒度权限，不能把内部粗粒度 scope 描述成第三方授权的充分条件。
- 元数据描述必须与服务端 handler 实际读取、返回和修改的内容一致。

## 8. 实施顺序

1. 删除尚未部署的任意请求 Trigger 执行入口，并使新操作的可选 accessGrant 与 Action 使用相同的身份限制。普通 proxy 不增加 Trigger 权限回退。
2. 复用用户／服务账号鉴权与执行生命周期，建立 provider 拥有的严格操作输入和 handler。
3. 先打通 Gmail read、Linear options，以及 GitHub 订阅创建、归属、维护、清理，验证两类边界；这只是开发顺序，交付仍覆盖全部 21 项。
4. 搬迁剩余轮询、listener 与选项查询；删除 Open Flow 中被替代的第三方请求构造，不维护双份实现。
5. 完成 Drive 通道续订、Telegram 单 webhook、飞书共享订阅及其余 webhook provider 的生命周期。
6. 更新 Open Flow ConnectorHost 和各运行时调用，保留调度、重启恢复、取消与现有事件输出语义。
7. 联调权限组与元数据、更新技术文档，完成自动化及可用真实账号验收。

## 9. 验收重点

- 有 Trigger 权限而无 Action/proxy 权限时，仅该 Trigger 的已注册操作成功。
- 用户／服务账号不能通过自报 accessGrant 提升权限；Team 的可选 grant 只收窄本次调用。伪造 actor、Trigger ID、原始请求字段、外部 URL 或跨 provider 游标不能突破已认证主体的权限。
- 用户和服务账号均从实际认证主体取权限；未知授权状态失败关闭。
- 同 provider 的其他 Trigger、其他连接、其他主体订阅的更新／删除被拒绝。
- Gmail 等仅返回声明的事件数据，不能通过输入切换到原始内容或附件下载。
- webhook 创建重试、并发 reconcile、续订失败、重启、权限撤销和清理均保持归属与幂等语义。
- Telegram 不覆盖无归属的既有 webhook；飞书共享资源不被一个使用者误删；Drive 清理只影响本记录通道。
- 全部 21 个 Trigger 的 options/read/订阅等实际操作都覆盖，不能静默回退普通 proxy。
- app-access 保存回读、成员配置及元数据本地化继续通过。

已删除旧 Trigger proxy 入口，原有 provider 行为测试随实现迁到 connector。新测试覆盖实际用户／服务账号鉴权、拒绝自报权限、订阅归属、幂等、租约、撤权清理和 PostgreSQL 加密存储。部署顺序、旧订阅处理及验证限制见 [技术契约](../control/trigger-permissions.md)。
