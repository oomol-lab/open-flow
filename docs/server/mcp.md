# MCP 接入参考

## 1. 入口与支持范围

Server 在 `/v1/mcp` 提供 MCP Streamable HTTP，与 Workbench、Control API 共用部署、监听端口和应用服务。
当前支持协议 `2026-07-28`，使用官方 `@modelcontextprotocol/server` 2.0.0。

客户端须支持新版逐请求协议元数据与 HTTP headers。支持 Streamable HTTP 本身不等于支持该协议版本。
旧版 `initialize` 握手不受支持，Server 会返回支持的协议版本；不提供 stdio、独立 SSE endpoint 或 `/mcp` 别名。

首版提供 Flow authoring 和运行工具，不把各个 Flow 动态注册为工具。
工具目录固定，不声明工具列表变更通知；Run 状态通过业务查询工具读取。

## 2. 认证与连接

每次请求使用部署的 Operator credential：

```http
Authorization: Bearer <operator-token>
```

凭据的环境锁定、持久化和失效规则与 Control API 相同。同源 Browser session 也由现有认证入口验证。
未认证请求返回 HTTP 401；当前没有 OAuth 授权发现和交互式授权流程，客户端需要支持配置 Authorization header。
工具具有该部署 Operator 的能力，不提供单独的 MCP 权限角色。

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

| 工具                    | 输入要点                                                       | 结果                             |
| ----------------------- | -------------------------------------------------------------- | -------------------------------- |
| `flow_list`             | `cursor?`、`limit?`                                            | Flow 列表和 `nextCursor?`        |
| `flow_get`              | `flowId`                                                       | Flow、完整 Draft、Live           |
| `flow_schema`           | `kind?`                                                        | change operations schema 与示例  |
| `flow_create`           | `name`、`idempotencyKey`、`teamId?`                            | Flow，包含初始 `draftRevisionId` |
| `flow_apply`            | `flowId`、`expectedRevisionId`、`idempotencyKey`、`operations` | 新 Revision identity             |
| `flow_check`            | `flowId`、`revisionId`                                         | 固定 Revision 的 diagnostics     |
| `flow_run`              | `source`、固定版本、`trigger`、`inputs?`、`idempotencyKey`     | 已接受的 Run                     |
| `run_get`               | `runId`                                                        | 状态与 waiting 信息              |
| `run_events`            | `runId`、`after?`、`limit?`                                    | 事件页与 `nextAfter`             |
| `run_result`            | `runId`                                                        | 终态结果                         |
| `run_cancel`            | `runId`                                                        | 取消是否被接受及权威状态         |
| `connector_teams`       | 无                                                             | 部署的 Team 选择信息             |
| `connector_list`        | `flowId?`                                                      | Connector providers              |
| `connector_search`      | `query`、`flowId?`                                             | Actions                          |
| `connector_get`         | `actionId`、`flowId?`                                          | Action 端口与连接要求            |
| `connector_connections` | `serviceId`、`flowId?`                                         | Connection 列表                  |
| `trigger_list`          | 无                                                             | Provider Trigger keys            |
| `trigger_get`           | `key`                                                          | Provider Trigger 定义            |

所有工具拒绝未声明的顶层参数。`limit` 范围 1–100，默认 50；事件 `after` 默认 0。
Flow 分页游标与 Control API 相同，事件 retention 和终态结果规则也相同。

典型步骤：

1. 通过 `flow_list`、`flow_get` 定位 Flow；创建时调用 `flow_create`。OOMOL Connector 部署可先通过 `connector_teams` 选择具体 Team。
2. 调用 `flow_schema`，按公共 change operations 定义提交 `flow_apply`。节点 title 非空且在图内唯一；ID 显式指定。
3. 新 Flow 没有 Trigger，需显式添加 Manual 或其他 Trigger。编辑返回新 Revision，用该 identity 调用 `flow_check`。
4. Draft Run 使用 `source: "draft"`、`flowId`、`revisionId`；Live Run 使用 `source: "live"`、`publicationId`。
   两种 source 的版本字段不能混用。`trigger` 必须包含 `nodeId` 和 `payload`；`inputs` 是 node ID 到输入值的映射，默认 `{}`。
5. `flow_run` 返回 `runId`。查询 `run_get`，终态后调用 `run_result`；`waiting` 会返回 Wait identity 和允许的 actions，不自动批准。

当前不提供发布、回滚、删除 Flow、部署配置写入或 Wait 决议工具。这些操作继续通过现有客户端完成。

## 5. 冲突、重试与取消

工具业务失败返回 `isError: true`，结构化结果包含 `error.code`、`message` 和适用的 HTTP `status`。
协议错误由 MCP SDK 返回 JSON-RPC error。未知内部错误不向客户端暴露异常堆栈。

`flow_create`、`flow_apply` 和 `flow_run` 必须显式提供非空且最多 256 字符的 `idempotencyKey`。
同一 mutation 重试必须保持 key 和参数一致；更换 key 表示一次新操作，可能执行第二次 Run。
MCP JSON-RPC request ID 与业务幂等 key 是不同身份。

Draft head 冲突返回 `flow.revision-conflict`，调用方重新读取后决定修改。
mutation 内部发生无法确定结果的异常时返回 `flow.mutation-outcome-unknown` 与原 key；连接断开没有响应时也应以原参数和原 key 重试。
不要因为客户端超时自动换 key 或换到新的 Draft/Live。

请求取消会传播给该请求中的 Connector 查询；Server 关闭会中止正在进行的 MCP 请求。
已接受的 Run 独立于 MCP 连接继续执行。显式取消使用 `run_cancel`，完成与取消竞争时以部署返回的权威状态为准。

## 6. 规范来源

- [MCP 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28)
- [Streamable HTTP](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)
- [官方 TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)

工具参数、描述和 annotations 由 `@oomol-lab/open-flow/mcp` 的 `mcpTools` 统一提供。Server 直接注册这些 Standard Schema 定义，并运行同一入口导出的 `mcpConformanceCases`。部署边界及版本规则见[公共契约与版本演进](../control/contracts/compatibility.md)。
