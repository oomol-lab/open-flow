# Trigger 权限与执行

## 权限来源

### 开源 OpenConnector

自托管 OpenConnector 使用独立的 `allowedTriggers` 授权，部署和运行时策略还可设置 `blockedTriggers`。多层 allow 取交集，block 优先；旧 runtime token 未设置 `allowedTriggers` 时不能执行 Trigger。Action 和通用 proxy 授权不授予 Trigger 权限。请求通过 `x-oo-connector-app-id` 选择稳定连接 ID；同时提供 alias 时必须指向同一连接。

`reconcile`、`receive` 和 `resource` 必须使用管理 API 创建的持久化 runtime token，订阅按 token ID、连接、已验证的 provider 账号和 Trigger 隔离。环境 token 和 JWT 不作为远端订阅 owner。请求体不接受 `accessGrant`。首版仅执行本地连接，不支持 SaaS 或 Marketplace 来源；所需第三方权限由各 provider 的权限元数据说明，实际请求沿用该连接的上游权限。

OpenConnector 在 SQLite、PostgreSQL 或 D1 中保存订阅状态，并沿用部署配置的 secret codec 加密，通过租约串行化控制操作。Token 撤销或当前策略不再允许该订阅时，维护任务清理已拥有的远端资源；正常续订仍由 Open Flow 驱动。断开或换账号前必须完成清理，原账号的已验证重新授权可用于恢复清理；管理员可显式 abandon 保留未清理账本。管理接口为 `/api/trigger-subscriptions` 及每条记录的 `/cancel`、`/abandon`。

轮换 OpenConnector token 前，先按旧 token ID 清理订阅，并排空 Open Flow 的 webhook/watch 订阅 ID 和飞书 `source_subscriptions` ready 缓存，再切换 token 并显式重建 binding。保留业务 checkpoint，避免沿用属于旧 token 的远端订阅身份。详细部署步骤见[自托管指南](../server/self-hosted-stack/README.zh-CN.md)。

### 托管 connector

Open Flow 可以由用户自行部署。connector 使用与 Action execute 相同的 Token 身份与授权链路，认证头仍只能来自可信网关：

| 身份                           | 授权方式                                                               |
| ------------------------------ | ---------------------------------------------------------------------- |
| 用户／服务账号 Token           | 按实际主体查询当前 relation-control app-access，禁止提交 `accessGrant` |
| team-token，带 `accessGrant`   | 在已认证 Team 范围内检查 grant 是否允许当前 Trigger                    |
| team-token，不带 `accessGrant` | 按 Team 执行权限调用，不查询某个用户的 app-access                      |

所有路径仍检查连接所属 Team、provider、凭据及 scopes。部署后的 Open Flow 使用 team-token；与当前 Action 客户端一致，普通 Trigger 调用不自动提交 grant。Team token 持有者可以省略 grant，因此客户端提交的 grant 只是本次调用的收窄条件，不能视作不可信部署无法绕过的用户权限证明。

权限组新增 `triggers: "*" | string[]`，列表使用完整 Trigger ID。默认组、自定义组和成员分配沿用现有 app-access 模型。例如仅允许某连接的新邮件 Trigger：

```json
{ "actions": [], "triggers": ["gmail.on_message_received"] }
```

省略 `actions` 保留全部 Action 语义。省略 `triggers` 时，仅旧完全不受限授权保留全部 Trigger；原有受限 Action 授权不会自动获得 Trigger。`triggers` 不改变通用 proxy 或 `call_tool` 的既有判定：只有 `actions` 和 `appAccessConfig` 均未设置时才允许；Trigger-only 授权必须显式使用 `actions: []`。拥有宽权限 Token 的用户仍具有该 Token 原本的权限，Open Flow 的界面选择不能缩小 Token 的权限。

## 元数据与操作

`GET /v1/providers/:service/trigger-permissions?locale=zh-CN` 返回 Trigger ID、名称、描述、认证类型、内部 requiredScopes、第三方 providerPermissions 及 instructions。内部 scope 不等同于第三方平台全部细粒度权限；前端应同时展示说明。

`POST /v1/providers/:service/triggers/:triggerId/execute` 使用既有连接选择头／查询参数；请求体为严格的 `operation` 联合：

| operation   | 字段                                                                                 | 作用                                 |
| ----------- | ------------------------------------------------------------------------------------ | ------------------------------------ |
| `options`   | `config`, `field`                                                                    | 查询已注册的配置选项                 |
| `read`      | `config`, `checkpoint`                                                               | 执行固定的单页 Poll 或 listener 读取 |
| `reconcile` | `config`, `endpointUrl`, `requestKey`, `active`, 可选 `subscriptionId`               | 创建、维护或删除服务端拥有的 webhook |
| `receive`   | `subscriptionId`, `method`, `headers`, `query`, Base64 `rawBody`, `admit`, `current` | 用服务端配置和密钥处理第三方回调     |
| `resource`  | `config`, `requestKey`, `active`                                                     | 管理飞书共享资源订阅                 |

只有托管 connector 的 team-token 可以在上述各操作的请求体中附带可选 `accessGrant`，其格式与 Action execute 相同。用户／服务账号不能提交该字段。所有调用方都不能提交上游 endpoint/method/body、远端 hook/channel ID 或 cleanup 特权。`receive` 的请求信息仅作为回调验证输入。未知字段和不支持的操作被拒绝；没有原始 proxy 回退。底层第三方传输仍复用 connector 的 proxy、凭据解析与执行生命周期。

配置字段与游标在服务端校验，上游请求由 provider 实现构造。授权粒度为连接加 Trigger ID，配置中的仓库、标签、时间窗口等是业务筛选条件，不是管理员授予的独立资源 ACL。

## 状态与清理

connector 加密保存团队、主体、连接、Trigger、不可变配置、callback、远端资源 ID 和验证密钥。用户／服务账号订阅绑定真实主体；team-token 订阅绑定已认证 Team，审计 actor 不参与归属。同一 Team 的 team-token 具有同一团队执行权限，不按客户端自报的部署名称隔离。幂等键按团队、主体、连接及 Trigger 隔离。后续操作可携带 connector 返回的订阅 ID，服务端重新核对归属。调用方不能通过换幂等键复用其他主体的订阅，也不能改变已绑定的配置或 callback。

服务端给 callback 附加每条记录独立生成的随机标识。远端创建结果丢失时，只通过该记录的完整 callback 地址恢复；不会依据调用方原始 URL 接管已有 webhook。Telegram 保留单 webhook 冲突拒绝。飞书按连接与资源维护共享引用计数，最后一个使用者退出时才取消订阅。

租约阻止同一记录的并发控制操作，过期执行不能提交状态。Open Flow 保存不透明订阅 ID，保留业务 checkpoint、去重、Run 和调度；listener 续订不覆盖已推进的扫描 checkpoint，回调只持久化唤醒及订阅调度。

新的操作按 Token 类型使用上表中的授权方式。connector Trigger worker 对用户／服务账号订阅检查当前主体授权，撤权后以受限的内部清理操作删除记录拥有的资源；此能力不通过 HTTP 暴露。Team 订阅不查询用户 app-access，已开始但未完成的删除由 worker 重试；客户端传入的 grant 不被保存为持续授权来源，也不把某个用户撤权解释成整个 Team 撤权。

清理是异步的，受维护周期和第三方可用性影响，不承诺撤权瞬间停止所有在途 webhook。Team token 本身失效不会被此维护任务推断成远端订阅应当删除；正常退出应显式清理订阅。凭据失效或上游失败时待清理记录保留并重试。

## 实现与更新

开源第三方实现、静态快照和权限元数据由 OpenConnector 的 `src/providers/<service>/trigger-*.ts` 拥有。Open Flow 的 `catalog.generated.json` 是生成物；更新目录时只需要公开仓库和其已安装依赖，在 Open Flow 根目录运行：

```sh
bun run --cwd packages/open-flow generate:provider-triggers /path/to/open-connector
```

该命令调用 OpenConnector 的 `scripts/export-flow-trigger-catalog.ts`，导出已注册的 snapshot、options、listener interval 与 eventSource 信息，不需要私有 connector checkout。

随后在 Open Flow 运行格式、类型、本地化及相关测试。飞书事件入口仍由 Open Flow 处理；展示快照同样来自生成物。不要把第三方请求实现重新加入 Open Flow。

## 部署与旧订阅

1. 使用旧版 Open Flow 清理已有远端 webhook／watch channel 和飞书托管资源订阅，再升级执行端。旧版记录中的远端 ID 不能直接导入为 connector 的可信所有权。
2. 对 connector 应用 `0021_daily_jackal.sql`，部署 API 与 Trigger worker。维护 worker 必须具有现有 relation-control 配置，才能检查撤权和执行清理。
3. 部署权限组前端及新版 Open Flow，为使用者分配需要的 Trigger，并重新发布流程以创建服务端订阅。

Poll 的业务 checkpoint 结构保持不变。发现非空的旧 webhook 控制状态但没有 connector 订阅 ID 时，新版 Open Flow 明确报错，不静默再创建一份订阅。升级前未清理的旧远端资源需要由原部署或连接管理员清理。

自动化验证覆盖权限、固定请求构造、订阅生命周期、内存和 PostgreSQL 存储、Open Flow 发布／恢复／去重及包产物。第三方真实账号、生产网关和生产部署需要在相应环境验收；本地测试不代表已执行生产迁移。

回调订阅完成删除后，可以使用同一 requestKey 重新启用。重建时重置远端状态并轮换回调验证信息与上游创建幂等键；已删除记录的重复取消不因配置变化产生冲突，归属校验仍然执行。

Trigger 执行错误保留分类：已识别的连接问题返回 `trigger_connection_error`（409），暂时性 provider 故障返回 `proxy_upstream_error`（503）；输入解析错误返回 `invalid_input`（400），未预期的内部错误返回通用 `provider_error`（500），不暴露内部异常消息。Open Flow 将连接问题识别为 `connector.connection-required`。
