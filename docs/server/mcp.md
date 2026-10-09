# MCP 接入参考

## 1. 入口与支持范围

Server 在 `/v1/mcp` 提供 MCP Streamable HTTP，与 Workbench、Control API 共用部署、监听端口和应用服务。
当前支持协议 `2026-07-28`，使用官方 `@modelcontextprotocol/server` 2.0.0。

客户端须支持新版逐请求协议元数据与 HTTP headers。支持 Streamable HTTP 本身不等于支持该协议版本。
旧版 `initialize` 握手不受支持，Server 会返回支持的协议版本；不提供 stdio、独立 SSE endpoint 或 `/mcp` 别名。

首版提供 Flow authoring 和运行工具，不把各个 Flow 动态注册为工具。
工具目录固定，不声明工具列表变更通知；Run 状态通过业务查询工具读取。

## 2. 认证与连接

邮箱用户在“设置 → MCP 接入”创建个人访问 Token，将 `/v1/mcp` 地址和以下请求头配置到客户端：

```http
Authorization: Bearer <personal-token>
```

Token 的创建、撤销及失效规则见[个人访问 Token](users.md#个人访问-token-与-mcp)。

Operator 使用部署的 Operator credential：

```http
Authorization: Bearer <operator-token>
```

凭据的环境锁定、持久化和失效规则与 Control API 相同。同源 Browser session 也由现有认证入口验证。
未认证请求返回 HTTP 401；当前没有 OAuth 授权发现和交互式授权流程，客户端需要支持配置 Authorization header。
MCP 沿用 Server 本地账号的 Flow 归属与管理权限：Operator token 只能访问 Operator 自己的 Flow；使用邮箱账号的个人访问 Token 或登录会话时，只能访问该账号自己的 Flow。管理员角色不扩大 Flow 读取范围，普通用户不能管理部署资源。详见 [用户系统](users.md)。

如果请求包含 `Origin`，它必须与 Server 收到的请求 URL origin 一致，否则返回 403。
跨域浏览器直接调用不在当前接入范围。无 Origin 的服务端客户端可以正常连接。

官方 TypeScript client 示例：

```typescript
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'

const client = new Client({ name: 'flow-agent', version: '1.0.0' }, { versionNegotiation: { mode: { pin: '2026-07-28' } } })

await client.connect(
  new StreamableHTTPClientTransport(new URL('https://flow.example.com/v1/mcp'), {
    requestInit: { headers: { authorization: `Bearer ${process.env.OPEN_FLOW_TOKEN}` } },
  }),
)
try {
  const tools = await client.listTools()
  const flows = await client.callTool({ name: 'flow_list', arguments: { limit: 20 } })
  console.log(tools.tools, flows.structuredContent)
} finally {
  await client.close()
}
```

该示例使用 `@modelcontextprotocol/client` 2.0.0。SDK 默认仍使用 legacy connect，必须显式指定新版协商模式。

## 3. HTTP 合同

- 消息发送至 `POST /v1/mcp`，body 为单条 JSON-RPC 消息。
- `Content-Type` 为 `application/json`；`Accept` 包含 `application/json` 和 `text/event-stream`。
- 按 MCP 规范携带 `MCP-Protocol-Version`、`Mcp-Method`，工具调用还需 `Mcp-Name`；header 与 body 必须一致。
- `server/discover` 提供支持版本、服务身份、能力和使用说明。
- 普通工具返回 JSON，结果包含 `content` 和相同数据的 `structuredContent`；SDK 填写新版协议字段。
- endpoint 不保存协议会话，也不签发 `Mcp-Session-Id`。GET 和 DELETE 返回 405。
- 请求 body 最大为 5 MiB；超限返回 413。响应使用 `Cache-Control: no-store`。

反向代理应保留 `/v1/mcp` 路径、Authorization、Accept、Content-Type 和 MCP headers。
带 Origin 的请求需要代理保证请求 URL 与公开 origin 一致；不要通过任意客户端提供的转发头绕过 Origin 校验。
首版工具不需要长驻 SSE 连接。代理断连与请求取消不会撤销已经接受的 Run。

## 4. 工具与操作流程

| 工具                           | 输入要点                                                                                   | 结果                                             |
| ------------------------------ | ------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| `flow_list`                    | `cursor?`、`limit?`                                                                        | Flow 列表和 `nextCursor?`                        |
| `flow_read`                    | `flowId`、`revision?`、`nodes?` 或 `text?`                                                 | 固定版本概要、节点详情或文本片段                 |
| `flow_search`                  | `flowId`、`query`、`type?`、`revision?`、`offset?`、`limit?`                               | 引用与有限上下文                                 |
| `flow_schema`                  | `type?` 或 `action?`；Action 需要 `flowId`                                                 | 编辑语法、配置、端口及示例                       |
| `flow_create`                  | `name`、`idempotencyKey`、`teamId?`                                                        | Flow，包含初始 `draftRevisionId`                 |
| `flow_edit`                    | `flowId`、`baseRevision`、`requestId`、`edits`                                             | 保存结果、新版本、别名引用和独立校验结果         |
| `flow_check`                   | `flowId`、`revisionId`                                                                     | 固定 Revision 的 diagnostics                     |
| `flow_publish`                 | `flowId`、`revisionId`、`expectedLivePublicationId`、`idempotencyKey`                      | 发布操作，包含 `operationId` 和状态              |
| `flow_publish_status`          | `flowId`、`operationId`                                                                    | 发布操作的状态、成功的 Publication ID 或失败原因 |
| `flow_set_enabled`             | `flowId`、`expectedPublicationId`、`enabled`                                               | 更新后的 Flow 与 Live 启用状态                   |
| `flow_run`                     | `source`、固定版本、`trigger`、`inputs?`、`idempotencyKey`                                 | 已接受的 Run                                     |
| `run_list`                     | `flowId`、`status?`、`pendingWait?`、`cursor?`、`limit?`                                   | Run 列表和 `nextCursor?`                         |
| `run_get`                      | `runId`                                                                                    | 状态与 waiting 信息                              |
| `run_events`                   | `runId`、`after?`、`limit?`                                                                | 事件页与 `nextAfter`                             |
| `run_result`                   | `runId`                                                                                    | 终态结果                                         |
| `run_results`                  | `runId`、`after?`                                                                          | Agent 工具结果元数据和 `nextAfter?`              |
| `run_result_read`              | `runId`、`resultId`、`pointer?`、`offset?`、`limit?`、`maxBytes?`                          | 工具结果元数据和有界内容页                       |
| `run_resolve_wait`             | `runId`、`waitId`、`action`、`comment?`                                                    | 决议是否被接受、权威 action 和 Run 状态          |
| `run_cancel`                   | `runId`                                                                                    | 取消是否被接受及权威状态                         |
| `flow_code_connections`        | `flowId`、`publicationId?`                                                                 | Draft 共享 Code 连接，或固定发布快照             |
| `flow_connection_candidates`   | `flowId`、`providerIds`                                                                    | 各 Provider 的候选连接和独立错误                 |
| `flow_code_connection_set`     | `flowId`、`providerId`、`accessBindingId`、`selected`、`expectedAccessRevision`            | 更新后的 Draft 共享 Code 连接                    |
| `flow_connection_usage_remove` | `flowId`、`connectionId`、`expectedRevisionId`、`expectedAccessRevision`、`idempotencyKey` | 原子移除节点选择和共享 Code 使用后的 Revision    |
| `connector_teams`              | 无                                                                                         | 部署的 Team 选择信息                             |
| `connector_providers`          | `flowId?`                                                                                  | Connector providers                              |
| `connector_search`             | `query`、`flowId?`                                                                         | Actions                                          |
| `connector_get`                | `actionId`、`flowId?`                                                                      | Action 端口与连接要求                            |
| `connector_connections`        | `serviceId`、`flowId?`                                                                     | Connection 列表                                  |
| `event_source_list`            | 无                                                                                         | 当前身份可见的独立事件源列表                     |
| `trigger_search`               | `query?`                                                                                   | Provider Trigger keys                            |
| `trigger_get`                  | `key`                                                                                      | Provider Trigger 定义                            |

所有工具拒绝未声明的顶层参数。Flow、Run 列表和事件的 `limit` 范围 1–100，默认 50；事件 `after` 默认 0。
Flow、Run 分页游标与 Control API 相同；Run cursor 绑定 Flow。`run_list.status` 支持 `queued`、`starting`、`running`、`waiting`、
`completed`、`failed`、`canceled`、`indeterminate`。`pendingWait: true` 筛选仍有未决 Wait 的 Run，包括 running 和 queued 状态。事件 retention 和终态结果规则与 Control API 相同。

`run_results` 每页最多 50 项，将 `nextAfter` 原样用作下一页的 `after`。`run_result_read` 与 Control API 共用结果查询规则：
`pointer` 默认为空字符串（根值），最长 4096 字符；`offset` 默认 0；`limit` 默认 20，范围 1–100；`maxBytes` 默认 15000，范围 1–1048576。
内容页的 `nextOffset` 用于同一 pointer 的后续读取；`complete: true` 的 value 已包含该路径的完整值。结果只能在所属 Run 下读取，
无需等待 Run 终态；它们与 `run_result` 的终态结果不同，也不依赖事件保留期。

典型步骤：

1. 通过 `flow_list`、`flow_read` 定位 Flow；创建时调用 `flow_create`。OOMOL Connector 部署可先通过 `connector_teams` 选择具体 Team。
2. 用 `flow_search` 定位目标，`flow_read` 按需读取固定版本的详情或文本。`flow_schema {"type":"code"}` 返回节点配置和示例，Action 端口用 `{flowId,action}` 查询。`flow_edit` 按序原子执行语义操作，创建使用批次内别名，无需分配内部定义 ID。
3. 新 Flow 没有 Trigger，需显式添加 Manual 或其他 Trigger。编辑返回新 Revision，用该 identity 调用 `flow_check`。
4. 上线时调用 `flow_publish`，固定 `flowId`、`revisionId`，并传入从 `flow_list` 观察到的 `expectedLivePublicationId`；首次发布传 `null`。
   轮询 `flow_publish_status`，`pending` 表示仍在进行，`succeeded` 才确认发布成功，`failed` 返回 `issue`。
   用 `flow_set_enabled` 控制已发布 Flow 的启停；`expectedPublicationId` 防止误操作已被替换的 Live。
5. Draft Run 使用 `source: "draft"`、`flowId`、`revisionId`；Live Run 使用 `source: "live"`、`publicationId`。
   两种 source 的版本字段不能混用。`trigger` 必须包含 `nodeId` 和 `outputs`；`inputs` 是 node ID 到输入值的映射，默认 `{}`。
6. `flow_run` 返回 `runId`；也可以通过 `run_list` 找到已有运行。查询 `run_get`，终态后调用 `run_result`。
   `waiting` 返回 Wait identity 和允许的 actions；通过显式 `run_resolve_wait` 提交 `approve`、`reject` 或 `continue` 中的合法动作，不自动批准。
   一次 Wait 的首次决议生效，检查 `resolutionAccepted` 与返回的权威 `action`；恢复后继续查询同一个 Run，不重新调用 `flow_run`。
7. 需要检查 Agent 工具原始结果时，用 `run_results` 找到 `resultId`，再用 `run_result_read` 按路径和页读取。

当前不提供发布历史与回滚、删除或重命名 Flow、部署 Variable 管理、实际 Trigger 管理和 Presentation 工具。这些操作继续通过现有客户端完成。

## 5. 冲突、重试与取消

工具业务失败返回 `isError: true`，结构化结果包含 `error.code`、`message` 和适用的 HTTP `status`。
协议错误由 MCP SDK 返回 JSON-RPC error。未知内部错误不向客户端暴露异常堆栈。

`flow_create`、`flow_publish`、`flow_run` 和 `flow_connection_usage_remove` 必须显式提供非空且最多 256 字符的 `idempotencyKey`。
`flow_edit` 使用同样有长度限制的 `requestId`，并固定 `baseRevision`。同一 mutation 重试必须保持身份和参数一致；更换 key 表示一次新操作，可能执行第二次 Run。
MCP JSON-RPC request ID 与业务幂等 key 是不同身份。

Draft head 冲突返回 `flow.revision-conflict`，调用方重新读取后决定修改。
mutation 内部发生无法确定结果的异常时返回 `flow.mutation-outcome-unknown` 与原 key；连接断开没有响应时也应以原参数和原 key 重试。
不要因为客户端超时自动换 key 或换到新的 Draft/Live。

Provider Trigger 通过 `node.add` 的 `config.key` 创建，服务端解析并固定定义快照。重试先读取原请求的幂等记录，再检查版本和解析目录。`flow_edit` 的 `saved:true` 与 `validation.status` 独立；草稿可带语义诊断保存。文本零匹配、多匹配和批次失败返回带 `details.reason`、`editIndex` 的可修正错误，不产生部分写入。

`flow_read` 仅读取指定版本，不回退新版本。Draft 无法读取时返回错误；可用 `flow_list` 查看 Flow 元信息。包含已退役 Subflow 的 Revision 拒绝读取和修复，不提供只读调用节点入口。

请求取消会传播给该请求中的 Connector 查询；Server 关闭会中止正在进行的 MCP 请求。
已接受的 Run 独立于 MCP 连接继续执行。显式取消使用 `run_cancel`，完成与取消竞争时以部署返回的权威状态为准。
`flow_set_enabled` 不取消已接受的 Run。`run_resolve_wait` 使用固定 Wait identity 保留决议，同一动作重试不会重复恢复，
不同动作的后续请求返回已有决议；可选 `comment` 最多 2000 个 Unicode code point，首次决议及备注生效。这两个工具不接受 `idempotencyKey`。

## 6. 规范来源

- [MCP 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28)
- [Streamable HTTP](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)
- [官方 TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)

工具参数、描述和 annotations 由 `@oomol-lab/open-flow/mcp` 的 `mcpTools` 统一提供。Server 直接注册这些 Standard Schema 定义，并运行同一入口导出的 `mcpConformanceCases`。部署边界及版本规则见[公共契约与版本演进](../control/contracts/compatibility.md)。

`flow_read`、`flow_search`、`flow_edit` 的业务响应与 CLI、HTTP 一致。默认概要不包含完整 schema 和长文本，详情不返回 Module/binding ID。各节点独立拥有执行配置，不存在独立 Task ID。`text` 读取返回行数和 `nextStart`；搜索结果带 `nextOffset`。固定 `revision` 继续读取，避免混合版本。

`node.update` 局部合并配置，未提供字段保留，数组整体替换；`clear` 路径与 JSON null 分开。`text.edit` 采用精确唯一匹配。节点修改只影响目标节点；共享代码模块的局部编辑由工具按需复制模块。输入来源与执行连线独立。完整参数见 [Flow 命令合同](../authoring/flow-command.md)。

`node.add.inputs` 可直接按业务字段名提供数据来源，Code/Agent/LLM/Wait/Approval 的新命名输入会自动声明；已有字段继续遵守原有约束。自定义输入约束使用 `config.inputs` 字段映射，Code 结果字段使用 `config.outputs`；Agent/LLM 的结构化结果使用 `config.resultSchema`，无需声明固定输出端口。单输出来源可写作 `{kind:"output",node:"$summary"}`，多输出需要显式选择 `port`。CLI、HTTP 和 MCP 使用同一配置转换和错误合同。

Agent 的工具参数也只接收按名称索引的 `model`、`value` 或 `input` 来源，端口约束由所选 Action 装配。既有工具保留原定义和未覆盖来源；只有新增工具或更换 Action 才重新读取目录。

### 目录发现和固定版本节点详情

`connector_providers` 列出 Provider，替代原 `connector_list`。`connector_search` 返回 Action 摘要（身份、描述、authenticated 和默认连接摘要），不返回 inputs/outputs/inputSchema/outputSchema；通过 `connector_get` 按需读取完整定义。

`trigger_search({ query? })` 替代原 `trigger_list`，省略 query 列出全部可用定义摘要，提供 query 时进行不区分大小写的匹配。Flow 中已创建的触发器实例由 `flow_read` 读取。Connector 和 Trigger 搜索 query 长度为 1–256 个字符。

事件源是独立于 Flow 的部署资源。`event_source_list({})` 列出当前身份可见的事件源；实际使用关系见各项的 `consumers`。配置飞书 Trigger 时，调用 `connector_connections({ serviceId: "feishu_app_bot", flowId })` 对照 Connection。空列表附带引导信息：在 Workbench 创建并验证事件源后再查询；工具不会接收或返回事件源密钥。返回的 `sourceId`、`teamId`、`connectionId`、`eventTypes`、`enabled` 和 `verifiedAt` 用于选择和确认来源。

`flow_run` 的输入 Schema 按 source 区分互斥分支：draft 要求 flowId/revisionId，live 要求 publicationId，另一分支字段不允许出现。该约束同时用于工具发现的 JSON Schema 与调用验证。

`connector_teams` 与 CLI Team 目录返回 enabled、teams 和 version，不再附带 Flow-Team 绑定清单。

### CLI 对应入口与返回包装

节点读取对应 `oo flow read FLOW_ID --input '{"revision":"REVISION","nodes":["NODE"]}' --json`；搜索和编辑分别对应 `search`、`edit`。CLI 支持 JSON、文件或 stdin 输入，不装配底层操作。

`flow_code_connections` 对应 `connector code-access FLOW_ID [--publication PUBLICATION_ID]`；
`flow_connection_candidates` 对应 `connector candidates FLOW_ID PROVIDER_ID [PROVIDER_ID ...]`。
连接读取不依赖 Draft 内容可读。发布快照只读，连接选择和全局移除只修改 Draft。

Trigger 搜索两端均返回 `keys`。其他 CLI 命令保留终端输出包装：如 `runs show` 的 `run`、`connector show` 的 `action`、
`check` 的 `check`；对应 MCP 工具直接返回这些业务对象。CLI 的 `kind`、等待结果、退出码和 stdout/stderr 属于命令合同，
不等同于 MCP 的 `content`、`structuredContent` 和 `isError`。Flow/Run/事件分页默认 CLI 为 100、MCP 为 50；
CLI 可自动生成幂等 key、选择当前版本和等待发布，MCP 要求显式固定身份并由调用方轮询。详见 [CLI 合同](../authoring/flow-command.md)。
