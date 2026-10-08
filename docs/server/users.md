# Server 用户、登录与权限

## 使用方式

管理员从登录页选择“管理员 token 登录”，沿用当前 Operator token。未认领部署仍先完成一次性 setup。
进入“设置 → 用户管理”，点击“创建用户”，填写邮箱并选择普通用户或管理员，提交后 Server 自动生成密码。密码只在创建或重置的响应中返回一次，管理员保存并交给用户。
用户从默认邮箱登录表单输入邮箱和密码。当前不提供自助注册、邮件发送或密码找回；忘记密码时由管理员重置。

邮箱去除首尾空白并统一为小写，在部署内唯一。账号 ID 创建后保持不变，不使用邮箱作为 Flow 归属。
生成密码有 144 bits 的随机熵；数据库保存独立随机 salt 和 scrypt 哈希，不保存原始密码。

## 权限与资源归属

| 能力                                                   | 普通用户               | 管理员                 |
| ------------------------------------------------------ | ---------------------- | ---------------------- |
| 创建、编辑、发布和运行自己的 Flow                      | 允许                   | 允许                   |
| 查看他人的 Flow、Revision、Publication、Run 或结果     | 不允许                 | 不允许                 |
| 在自己的 Flow 中选择和使用已配置的 Connector 账号、LLM | 允许，仍受上游授权限制 | 允许，仍受上游授权限制 |
| 创建用户、重置密码、启用或停用账号                     | 不允许                 | 允许                   |
| 修改 Connector、LLM、Integration 配置、建立外部连接    | 不允许                 | 允许                   |
| 读取或管理全局 Variable、管理 Event Source             | 不允许                 | 允许                   |

部署角色与 OOMOL Team 的成员角色彼此独立。本地管理员身份不会提升上游 Connector 权限。
跨用户资源请求按所属资源返回 `404`，不暴露资源是否存在；管理权限不足返回 `403 authorization.denied`。
错误处理 Flow 只能订阅同一账号的上游 Flow。列表、总数、分页、幂等键和实时订阅遵循账号边界。

## 登录与会话

以下接口属于 Server 宿主，不属于跨部署的公共 Control API 合同。JSON 请求和响应使用 `version: 1`。

| Method   | Path                 | 请求                              | 成功响应               |
| -------- | -------------------- | --------------------------------- | ---------------------- |
| `GET`    | `/auth/session`      | 无                                | 当前登录状态与 `user`  |
| `POST`   | `/auth/session`      | `{ version: 1, token }`           | 建立 Operator 会话     |
| `POST`   | `/auth/user-session` | `{ version: 1, email, password }` | 建立邮箱账号会话       |
| `DELETE` | `/auth/session`      | 无                                | `204`，清除认证 Cookie |

已登录时 `user` 为 `{ userId, email, role }`，`role` 是 `admin` 或 `user`。
Operator 返回 `{ userId: "operator", email: null, role: "admin" }`；未登录时 `user` 为 `null`。
会话使用 HttpOnly、SameSite=Strict Cookie，有效期为 30 天。HTTPS 部署沿用 `OPEN_FLOW_SESSION_COOKIE_SECURE=true`。
邮箱登录和 Operator 登录共用已有认证限流，密码验证限制并发以控制 scrypt 的内存占用。未知邮箱、错误密码和停用账号返回相同的认证错误。

重置密码或切换账号启用状态会递增账号凭据版本，旧 Cookie 失效；重新启用账号不会恢复旧登录。
实时订阅在发送下一条数据前检查会话，失效时关闭流。退出登录清除浏览器 Cookie；客户端应丢弃旧 Cookie。

## 用户管理接口

所有接口要求管理员认证，并返回 `Cache-Control: no-store`。

| Method | Path                           | 请求                                        | 成功响应                             |
| ------ | ------------------------------ | ------------------------------------------- | ------------------------------------ |
| `GET`  | `/auth/users`                  | 无                                          | `{ version: 1, users: User[] }`      |
| `POST` | `/auth/users`                  | `{ version: 1, email, role }`               | `201 { version: 1, user, password }` |
| `PUT`  | `/auth/users/:userId`          | `{ version: 1, enabled, expectedRevision }` | `{ version: 1, user }`               |
| `POST` | `/auth/users/:userId/password` | `{ version: 1, expectedRevision }`          | `{ version: 1, user, password }`     |

`User` 包含 `userId`、`email`、`role`、`enabled`、`revision` 和毫秒时间戳 `createdAt`，不包含密码哈希或 salt。
邮箱冲突和账号并发修改返回 `409 user.conflict`，账号不存在返回 `404 user.not-found`。
管理员不能停用当前登录账号。停用账号保留其 Flow 与历史执行数据，不停止已有后台 Run 或已发布 Trigger。

## 已有数据升级

SQLite migration 0037 在启动事务中创建账号存储，并将旧 Flow 固定到 `operator` 归属。
旧的 Flow 创建和 Draft/Live Run 幂等键归入 Operator 作用域，既有客户端可继续重试相同请求。
Revision 正文、Publication、Run、结果及外部 Trigger 身份保持不变；本地账号归属不修改固定的执行能力快照。
账号和会话签名秘密随 Server 数据卷持久化，重启不会重新生成账号密码或改变 Flow 归属。
