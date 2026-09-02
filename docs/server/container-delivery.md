# Server 容器交付参考

## 1. 当前镜像边界

`apps/server/Dockerfile` 只交付一个 Server Flow application 进程，包含同源 Workbench、Control API、Run runtime、Trigger runtime 和 SQLite migration。镜像不包含 Connector service、Connector 数据库或多进程 supervisor。

Server 可以通过配置的 Connector runtime API 使用 Provider/Action catalog、获准 Connection、Action execution 和 Provider proxy。镜像仍不包含
Connector service；具体 Provider transport、credential、Connection lifecycle 和管理界面不属于 Open Flow Server。未配置 Connector 时相关能力稳定
返回 `connector.unavailable`。

当前部署边界是单个 Server 容器、单个 SQLite writer。不能让多个容器并发挂载并写入同一个数据卷。

## 2. 构建和交付验证

从仓库根目录构建镜像：

```bash
docker build --file apps/server/Dockerfile --tag open-flow-server:dev .
```

Dockerfile 使用多阶段构建。builder 生成可脱离 monorepo 运行的 `dist`，最终 Node.js 镜像只复制以下 release artifact：

- `server/main.js` 和 `server/isolated-vm.js`：服务端 bundle 与其长驻 Isolated VM Executor；
- `public/`：Workbench 静态资源；
- `migrations/`：按顺序执行的独立 SQL migration；
- `node_modules/isolated-vm` 和 `node_modules/node-gyp-build`：当前平台的原生 Isolated VM runtime；
- `LICENSE`、`NOTICE` 和用于声明 ESM 布局的 `package.json`。

`isolated-vm` host、Executor、资源限制和 Engine digest 属于 Server release，不从公共 `@oomol-lab/open-flow` package 导出。公共 package
只提供它必须满足的 Engine/Runtime contract 和 conformance cases。

显式 Docker smoke 会构建临时镜像，并验证 Workbench、operator session、项目创建、真实 Code 节点执行、Docker health check、优雅退出和 SQLite volume 重启恢复：

```bash
bun run --filter @oomol-lab/open-flow-server test:docker
```

该命令创建带随机后缀的临时镜像、两个容器和一个 volume，并在结束时清理。它不进入默认单元测试，因为开发机和 CI 不一定提供 Docker daemon。

## 3. 启动

Server 可以在启动环境中读取 operator token，也可以在第一次启动后由部署者通过 Workbench 认领。Operator token 至少包含 32 UTF-8 bytes，既用于浏览器
建立 operator session，也可由 machine client 作为 Control API Bearer token 使用。Browser session 使用 Server 独立生成并保存在数据卷中的签名 secret，
不会直接使用 operator token 签名。

需要由外部 Secret 管理固定 credential 时，通过只供部署者读取的 env file 注入，不要把 token 写入 Dockerfile、镜像层或仓库文件。例如
`.env.server` 可以包含：

```dotenv
OPEN_FLOW_TOKEN=replace-with-at-least-32-random-bytes
OPEN_FLOW_LOG_LEVEL=info
```

创建数据卷并启动：

```bash
docker volume create open-flow-data
docker run --detach \
  --name open-flow-server \
  --publish 3000:3000 \
  --volume open-flow-data:/data/open-flow \
  --env-file .env.server \
  open-flow-server:dev
```

Workbench 和 API 位于 `http://127.0.0.1:3000`；登录后 `/variables` 提供该 deployment 的 Variable 管理面，`/settings` 提供外部 capability 管理面。最终镜像默认监听
`0.0.0.0:3000`，以 root 用户运行，并把 SQLite 保存为 `/data/open-flow/open-flow.sqlite`。

也可以不提供 `OPEN_FLOW_TOKEN` 直接启动：

```bash
docker run --detach \
  --name open-flow-server \
  --publish 3000:3000 \
  --volume open-flow-data:/data/open-flow \
  open-flow-server:dev
```

全新数据卷会在启动日志的 `operator.setup.required` 记录中输出一次性 setup code。打开 Workbench 后先输入该 code，再设置至少 32 UTF-8 bytes 的
Operator token。Setup code 只对当前未认领进程有效；第一步授权有效期为 10 分钟，认领成功或 Server 重启后旧 code 失效。认领 operation 在 SQLite 中
原子执行，并发请求最多一个成功。不要把未认领的 Server 暴露给无法读取部署日志的用户，也不要把包含 setup code 的启动日志公开。

认领后，Operator token 的不可逆摘要和独立 Browser session signing secret 保存在数据卷中；原 token 不落盘。容器使用同一数据卷重启后继续使用该
credential。设置 `OPEN_FLOW_TOKEN` 时环境配置锁定当前认证来源并跳过 setup；如果数据卷从未被认领，随后移除该环境变量会让 Server 重新进入未认领状态。

## 4. 配置

| 环境变量                                       | 用途                                                                                                        |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `OPEN_FLOW_HOST`                               | HTTP 监听地址；镜像默认 `0.0.0.0`。                                                                         |
| `OPEN_FLOW_PORT`                               | HTTP 监听端口；镜像默认 `3000`。                                                                            |
| `OPEN_FLOW_DATA_DIR`                           | SQLite 持久目录；镜像默认 `/data/open-flow`。                                                               |
| `OPEN_FLOW_TOKEN`                              | 可选的 env-managed Operator credential；至少 32 UTF-8 bytes，存在时跳过并锁定 deployment setup。            |
| `OPEN_FLOW_SESSION_COOKIE_SECURE`              | TLS ingress 后应设为 `true`；只接受 `true` 或 `false`。                                                     |
| `OPEN_FLOW_LOG_LEVEL`                          | Pino 日志级别；默认 `info`。                                                                                |
| `OPEN_FLOW_CONNECTOR_ORIGIN`                   | Server 可访问的 Connector runtime origin。                                                                  |
| `OPEN_FLOW_CONNECTOR_TOKEN`                    | Server 调用 Connector runtime API 的受限 token；本地未启用认证时可以为空。OOMOL-hosted token 同时用于 LLM。 |
| `OPEN_FLOW_CONNECTOR_CONSOLE_ORIGIN`           | 用户浏览器可访问的 Connector Console 公网 origin。                                                          |
| `OPEN_FLOW_LLM_ORIGIN`                         | OpenAI-compatible LLM 服务的 root origin；Server 会请求其 `/v1/chat/completions`。                          |
| `OPEN_FLOW_LLM_TOKEN`                          | Server 调用显式配置 LLM 服务的 bearer token。                                                               |
| `OPEN_FLOW_INTEGRATION_PUBLIC_ORIGIN`          | Provider 可访问的 Integration callback 公网 origin。                                                        |
| `OPEN_FLOW_INTEGRATION_CALLBACK_KEY`           | 派生 Integration callback secret 的至少 32 UTF-8 bytes 密钥。                                               |
| `OPEN_FLOW_PUBLIC_ORIGIN`                      | Wait 通知消费端可访问的 Server 公网 origin。                                                                |
| `OPEN_FLOW_RUN_EVENT_RETENTION_DAYS`           | terminal Run 详细事件的保留天数；默认 `30`。                                                                |
| `OPEN_FLOW_MAX_PENDING_RUNS`                   | 全部署尚未 terminal 的 Run 上限；默认 `1000`。                                                              |
| `OPEN_FLOW_MAX_CONCURRENT_RUNS`                | 全部署同时执行的 Run 上限；同一 Flow 最多执行一个；默认 `4`。                                               |
| `OPEN_FLOW_RUN_TIMEOUT_MS`                     | 单个 Run 从开始执行到 terminal 的最长毫秒数；默认 `1800000`。                                               |
| `OPEN_FLOW_CALLBACK_REQUESTS_PER_MINUTE`       | 每个 Webhook 或 Integration endpoint 的每分钟请求上限；默认 `120`。                                         |
| `OPEN_FLOW_OPERATOR_LOGIN_ATTEMPTS_PER_MINUTE` | 全部署每分钟允许的 operator 登录尝试数；默认 `10`。                                                         |

`OPEN_FLOW_CONNECTOR_ORIGIN` 用于启用 Connector。`OPEN_FLOW_CONNECTOR_TOKEN` 可选；Connector 本地未启用 runtime 认证时可以省略或设为空字符串，此时
Server 不发送 `Authorization` header。不能只配置 token 而不配置 origin。内部 runtime origin 与 Browser 使用的 Console origin 相互独立；
后者不能使用只在容器网络中可访问的地址，也不能包含 credential、path、query 或 fragment；除 loopback 本地开发外必须使用 HTTPS。Connector runtime
origin 可以在受信任的容器私网使用 HTTP；跨不受信任网络部署时必须由 TLS 保护 bearer token。

`OPEN_FLOW_LLM_ORIGIN` 和 `OPEN_FLOW_LLM_TOKEN` 必须同时提供或同时省略。显式配置优先，origin 必须是不带 credential、path、query 或 fragment 的
HTTPS origin；只有 loopback 本地开发可以使用 HTTP。Server 在该 origin 下调用 `/v1/chat/completions`。未显式配置时，如果 Connector runtime
origin 的 hostname 精确为 `connector.oomol.com` 或 `connector.oomol.dev` 且 token 非空，Server 会分别使用
`https://llm.oomol.com/v1` 或 `https://llm.oomol.dev/v1`，并复用 Connector token。Console origin 不参与推导；自建 OpenConnector、自定义域名和
空 token 都不会隐式启用 LLM。

Connector runtime、Connector Console、LLM 和 Integration callback 也可以在登录后的 `/settings` 中配置。每个配置块独立使用 env-managed 或
SQLite-managed 来源：对应的完整 env 配置存在时锁定该块，不能修改、清除或与 SQLite 按字段混合；外部服务暂时不可用也不会 fallback 到 SQLite。Connector
runtime 的 origin/token、Integration 的 public origin/callback key，以及显式 LLM 的 origin/token 都作为完整配置块保存。Connector Console 只有公开 origin，
与 Connector runtime 独立。

Settings-managed 配置保存后立即用于新的 request、Run、Poll 或 Integration operation，已经开始的 operation 继续使用开始时取得的配置快照，不要求重启。
读取配置只返回公开 origin、来源和 credential 是否已配置，token 与 callback key 不会返回 Browser。Settings update 使用全局预期 revision，stale update
返回冲突。LLM 的生效顺序为显式 LLM env、SQLite LLM settings、从当前生效的 OOMOL Connector 推导、未配置；其他配置块的顺序为对应 env、SQLite、未配置。

Provider Trigger definitions 由公共 Open Flow package 内置，不需要用户或部署者注册。Poll 与 Integration 通过 Connector 的
`POST /v1/proxy/:service` 运行面执行；OpenConnector 与 OOMOL Connector 都支持该接口。具体可用的 Provider、Connection 和授权范围以当前配置的
Connector 为准。

`OPEN_FLOW_INTEGRATION_PUBLIC_ORIGIN` 与 `OPEN_FLOW_INTEGRATION_CALLBACK_KEY` 必须同时提供或同时省略。前者必须是 Provider 可访问且不带
credential、path、query 或 fragment 的 HTTPS origin；只有 loopback 本地开发可以使用 HTTP。callback key 至少包含 32 UTF-8 bytes。两者也可作为一个
完整配置块在 Settings 中保存；未配置时 Integration definition 仍可用于 authoring，但 Publish 会 fail closed。

`OPEN_FLOW_PUBLIC_ORIGIN` 为 Wait Connector 通知生成 action URL。它必须是不带 credential、path、query 或 fragment 的 HTTPS origin；只有
loopback 本地开发可以使用 HTTP。普通 Wait 不需要该配置；固定 Revision 中只要有 Wait 配置了通知，Draft Run admission、Live Run admission 和
Publish 就会在缺少该 origin 时 fail closed。公开 action 路由不使用 Operator session，URL 中的 opaque capability 是只绑定当前 Wait 的 bearer
credential；不要让 reverse proxy access log、消息预览或分析工具采集完整 path。

没有 env-managed 或持久化 operator credential 时，health、callback 和已持久化的 runtime 工作仍可运行，但 Control API fail closed，Workbench 进入
setup。Operator 登录与 setup authorization 共享部署实例级限速，超过 `OPEN_FLOW_OPERATOR_LOGIN_ATTEMPTS_PER_MINUTE` 后返回 429 和 `Retry-After`。

达到 `OPEN_FLOW_MAX_PENDING_RUNS` 后，新 Run admission 返回 429；已接受请求的幂等重放仍返回原 Run。Cron 与 Poll 保留当前调度位置并短暂重试。
Cron 所属 Flow 已有未终结 Run 时同样保留当前调度位置；前一个 Run 结束后只补入最早未处理 occurrence，并把下一次计划推进到当前时间之后。
Callback 请求限流只为已存在的 endpoint 建立内存窗口，超过限制时返回 429 和 `Retry-After`。

## 5. 健康检查与停止

镜像的 Docker `HEALTHCHECK` 请求 `GET /healthz`，只表示 Server 进程能够响应。部署入口应另外使用 `GET /readyz` 判断是否接收新流量；Server 尚未
启动、Run/Trigger/Maintenance 后台处理已停止或配置的外部 Connector 不可用时，readiness 返回 503，但 liveness 仍保持 200。

收到 `SIGINT` 或 `SIGTERM` 后，Server 先结束所有 Flow notification SSE、停止接收新连接，再等待现有请求和运行时工作完成。连接在 30 秒内未结束时
会被强制关闭；因此容器编排器的 termination grace period 应大于 30 秒。

检查状态：

```bash
docker inspect --format '{{.State.Health.Status}}' open-flow-server
curl --fail http://127.0.0.1:3000/readyz
```

正常停止应给 Run drain 和 SQLite 关闭留出宽限期：

```bash
docker stop --time 30 open-flow-server
```

镜像声明 `SIGTERM` 为停止信号。进程停止接受 HTTP 请求，等待已接受的工作结束，然后关闭 SQLite 并以 0 退出。超过部署宽限期后再由容器运行时强制终止。

## 6. 持久化与恢复

Flow、Revision、Publication、Run、RunEvent、Wait checkpoint、Wait notification outbox、Variable、Trigger binding、Provider callback verifier、deployment
capability settings、持久化 Operator credential 摘要、Browser session signing secret 和 migration version 都位于数据卷中的 SQLite 文件。callback
verifier 只属于 Trigger runtime state，不进入 Flow Revision、Workbench 或 RunEvent。

Server 在提交 `waiting` 后通过持久化 outbox 发送 Connector 通知。崩溃恢复会重新 claim 未完成或 lease 已过期的 work，因此 Connector action 可能收到
相同 invocation identity 的重复请求；Run 状态和决议仍由 SQLite 中唯一的 Wait 记录约束。通知失败只记录 delivery failure，Run 保持等待，直到被决议、
取消或在进入等待 7 天后到期。SQLite 只保存 capability 的 SHA-256 摘要，通知发送时生成的完整 capability URL 会离开 Server 数据卷并进入所选 Connector 和消息系统的
信任边界。
当前只承诺 quiesced backup：先停止入口流量并让容器正常退出，再备份 volume；恢复时把完整数据目录挂载到相同路径后启动一个 Server 容器。

Variable value 和 Settings-managed 外部 service credential 以明文存在于 SQLite 主文件、WAL 和备份中。Variable 可由已认证 Operator 通过 Control API 和管理面
读取；外部 service credential 不通过读取 API 返回。两者都不是加密存储或不可导出的 Secret Manager；部署者必须把数据卷、备份、Operator token 和管理网络
视为同一信任边界。

不能只复制主 `.sqlite` 文件而遗漏同目录中的 WAL/SHM 状态，也不能在一个仍写入的容器和一个恢复容器之间共享数据卷。Connector 持久化是外部服务自己的备份边界，不属于 `/data/open-flow`。
