# MCP integration reference

## 1. Endpoint and scope

Server provides MCP Streamable HTTP at `/v1/mcp`. It shares the deployment, listening port, and application services with Workbench and Control API. It supports protocol `2026-07-28` and stateless legacy MCP handshakes (`2025-11-25` and earlier via `initialize`), using `@modelcontextprotocol/server` 2.0.0.

Modern clients (`2026-07-28`) use `server/discover` and per-request protocol metadata/headers (`MCP-Protocol-Version`, `Mcp-Method`, `Mcp-Name`). Standard `initialize`-based MCP clients (Claude Desktop, Cursor, VS Code, etc.) also connect statelessly without `Mcp-Session-Id`. There is no stdio transport, separate SSE endpoint, or `/mcp` alias.

The endpoint exposes a fixed catalog of 21 tools and 3 guided prompts (`author_flow`, `publish_and_run_flow`, `debug_run`), with no dynamic per-Flow tool registration and no list-change notifications. You can optionally scope the exposed tools by passing `?toolsets=<comma-separated-list>` on `/v1/mcp` (valid values: `default` for the 16 core authoring/publish/run/catalog tools, `all` for all 21 tools, or individual toolsets `core`, `authoring`, `publish`, `state`, `runs`, `connections`, `catalog`, `canvas`; unknown values return HTTP 400).

## 2. Authentication and connection

The MCP URL shown and copied in Agent access uses the public address configured in Settings (or `OPEN_FLOW_INTEGRATION_PUBLIC_ORIGIN` when environment-managed). Without a configured public address, it uses the browser's current origin.

Operator and email users create a personal access Token in Agent access. Configure the client with the `/v1/mcp` URL and this header:

```http
Authorization: Bearer <personal-token>
```

See [Personal access Tokens](users.md#personal-access-tokens-and-mcp) for creation, revocation, and invalidation rules.

The deployment’s Operator credential remains supported for existing clients.

Credential environment locking, persistence, and invalidation follow Control API rules. The existing authentication entry point also validates same-origin browser sessions. Unauthenticated requests return HTTP 401 with `WWW-Authenticate: Bearer realm="open-flow"`. OAuth discovery and interactive authorization are unavailable; clients must support an Authorization header. MCP uses Server local accounts for Flow ownership and management permissions:

- An Operator personal Token or deployment credential can access only the Operator’s own Flows.
- An email account’s personal access Token or login session can access only that account’s Flows.
- Administrator status does not expand Flow read access.
- Ordinary users cannot manage deployment resources.

See [Server users](users.md) for details.

If a request includes `Origin`, it must match the origin of the request URL received by Server. Otherwise, Server returns 403. Direct cross-origin browser calls are unsupported. Server-side clients without Origin can connect.

Example using the official TypeScript client:

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

## 3. HTTP contract

- Send one JSON-RPC message per body to `POST /v1/mcp` (optionally with `?toolsets=...`).
- Set `Content-Type` to `application/json`. Include both `application/json` and `text/event-stream` in `Accept`.
- For `2026-07-28` clients, supply `MCP-Protocol-Version` and `Mcp-Method` (`Mcp-Name` on `tools/call`). Headers and body must agree.
- `server/discover` returns supported versions, server identity, capabilities, and instructions.
- Successful tool calls return JSON in `content` and `structuredContent`. Business errors return `isError: true` with JSON in `content[0].text` (omitting `structuredContent`).
- The endpoint stores no protocol sessions and issues no `Mcp-Session-Id`. GET and DELETE return 405.
- Request bodies are limited to 5 MiB. Larger bodies return 413. Responses use `Cache-Control: no-store`.

Reverse proxies should preserve `/v1/mcp`, Authorization, Accept, Content-Type, and MCP headers. For requests with Origin, the proxy must make the request URL match the public origin. Do not bypass Origin checks using arbitrary client-supplied forwarding headers. Initial tools require no persistent SSE connection. Proxy disconnection and request cancellation do not revoke accepted Runs.

## 4. Tools and prompts

`flow_read` with `export: "bundle"` returns a workflow bundle containing all referenced drafts. `flow_create` accepts optional `file` (single workflow or bundle) and `tagIds` applied to every imported member. Bundle import returns `{ version: 1, flow, flows, validations }` with `validations` keyed by each imported `flowId`; single import returns the Flow result with `validation`. Each validation entry contains static `status`, `diagnostics`, and `unboundProviderIds` computed locally without external Connector calls. Imported calls require interface refresh after their new dependencies are configured and published. See [workflow bundles](../control/contracts/control-api.md#workflow-bundles).

| Tool                    | Toolset       | Main inputs                                                                                                                                                                  | Result                                                                                 |
| ----------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `server_whoami`         | `core`        | None                                                                                                                                                                         | Authenticated account identity and Server information.                                 |
| `flow_list`             | `core`        | `cursor?`, `limit?`                                                                                                                                                          | Flows and `nextCursor?`.                                                               |
| `flow_create`           | `authoring`   | `name?`, `file?`, `teamId?`, `tagIds?`, `idempotencyKey`                                                                                                                     | Created empty Flow or imported unpublished draft(s) with static validation.            |
| `flow_read`             | `authoring`   | `flowId`, `revision?`, one of: `nodes?`, `text?`, `query?` (`type?`, `offset?`, `limit?`), or `export?` (`workflow` / `bundle`)                                              | Pinned revision outline, node details, text excerpt, search matches, or exported JSON. |
| `flow_schema`           | `authoring`   | `type?` or `action?`; Action requires `flowId`                                                                                                                               | Edit syntax, configuration, ports, and examples.                                       |
| `flow_edit`             | `authoring`   | `flowId`, `baseRevision`, `requestId`, `edits`                                                                                                                               | Save result, new revision, alias references, and separate validation.                  |
| `flow_check`            | `authoring`   | `flowId`, `revisionId`                                                                                                                                                       | Diagnostics for the pinned Revision.                                                   |
| `flow_canvas_control`   | `canvas`      | `flowId`, `command` (`focus` / `zoom` / `pan` / `fit`)                                                                                                                       | Transient Workbench viewport broadcast receipt.                                        |
| `flow_live_get`         | `publish`     | `flowId`, `operationId?`, `waitSeconds?`                                                                                                                                     | Current online entries/Webhook URLs, or publish operation status.                      |
| `flow_publish`          | `publish`     | `flowId`, `revisionId`, `expectedLivePublicationId`, `idempotencyKey`, `waitSeconds?`                                                                                        | Publication operation (`operationId`, `status`).                                       |
| `flow_live_set`         | `publish`     | `flowId`, `expectedPublicationId`, `enabled`                                                                                                                                 | Updated Flow and Live enabled state.                                                   |
| `flow_state_get`        | `state`       | `flowId`, `scope`, `keys?`                                                                                                                                                   | State metadata & dedupe spaces, or values for 1–16 keys.                               |
| `flow_state_clear`      | `state`       | `flowId`, `scope`, `target` (`state` / `dedupe`), `key?`, `space?`                                                                                                           | Cleared state keys or deduplication space.                                             |
| `run_start`             | `runs`        | `source` (`draft` / `live`), `flowId?`, `revisionId?`, `publicationId?`, `trigger`, `inputs?`, `idempotencyKey`, `waitSeconds?`                                              | Accepted (or settled) Run.                                                             |
| `run_list`              | `runs`        | `flowId`, `status?`, `pendingWait?`, `cursor?`, `limit?`                                                                                                                     | Runs and `nextCursor?`.                                                                |
| `run_get`               | `runs`        | `runId`, `view?` (`status` / `result` / `events` / `tool_results`), `waitSeconds?`, `after?`, `limit?`, `resultId?`, `pointer?`, `offset?`, `maxBytes?`                      | Status/waits, terminal result, events, or stored tool results.                         |
| `run_resolve_wait`      | `runs`        | `runId`, `waitId`, `action`, `comment?`                                                                                                                                      | Whether resolution was accepted, authoritative action, and Run status.                 |
| `run_cancel`            | `runs`        | `runId`                                                                                                                                                                      | Whether cancellation was accepted and authoritative status.                            |
| `flow_connections_get`  | `connections` | `flowId`, `publicationId?` or `providerIds?`                                                                                                                                 | Draft/published shared Code connections, or candidate connections.                     |
| `flow_connections_edit` | `connections` | `flowId`, `action` (`set_code_binding` / `remove_usage`), `expectedAccessRevision`, and action-specific fields                                                               | Updated Draft shared Code connections or usage removal revision.                       |
| `catalog_get`           | `catalog`     | `resource` (`teams` / `providers` / `actions` / `action` / `connections` / `event_sources` / `triggers` / `trigger`), `flowId?`, `query?`, `actionId?`, `serviceId?`, `key?` | Connector teams/providers/actions/connections/event sources or Trigger definitions.    |

Registered MCP Prompts:

- `author_flow` (`flowId?`, `goal?`): Step-by-step workflow for inspecting, authoring, and validating a Draft.
- `publish_and_run_flow` (`flowId`, `revisionId?`): Validate, publish with `waitSeconds`, and start a Run.
- `debug_run` (`runId`): Inspect Run status, events, stored Agent tool results, and terminal errors.

### Short long-polling (`waitSeconds`)

`flow_publish`, `flow_live_get` (with `operationId`), `run_start`, and `run_get` (with `view: "status"`) accept an optional `waitSeconds` integer (`0`–`25`). The server subscribes to internal flow-change events and returns as soon as the publish operation leaves `pending`, the Run enters `waiting` or a terminal state, `waitSeconds` elapses, or the HTTP request is aborted.

### Canvas control

`flow_canvas_control({ flowId, command })` broadcasts a transient command to all connected Workbenches viewing that Flow:

- `{ "type": "focus", "nodeId": "NODE_ID" }` uses the canvas's existing node focus behavior without selecting the node or opening its inspector.
- `{ "type": "zoom", "zoom": 0.8 }` sets an absolute zoom ratio in the range 0.1–3.
- `{ "type": "pan", "dx": 200, "dy": -100 }` moves the viewport in screen CSS pixels. Positive values move right/down; zoom is preserved.
- `{ "type": "fit" }` fits all nodes regardless of selection. Empty canvases and absent focus targets are ignored.

The result is `{ version: 1, flowId, broadcast: true }`. Success confirms only Server broadcast, including when no browser is connected; it does not confirm delivery or execution. Commands are not idempotent (`idempotentHint: false`): retrying `pan` moves again.

### General query rules

All tools reject undeclared top-level parameters. Flow, Run, and event lists accept `limit` from 1–100, default 50. Event `after` defaults to 0. Flow and Run cursors match Control API; a Run cursor is bound to its Flow. `run_list.status` accepts `queued`, `starting`, `running`, `waiting`, `completed`, `failed`, `canceled`, and `indeterminate`. `pendingWait: true` selects Runs with unresolved Waits, including running and queued Runs.

`run_get(view="tool_results")` without `resultId` returns up to 50 items per page (`after?` → `nextAfter`). With `resultId`, `pointer` defaults to `""` (root, up to 4096 chars), `offset` defaults to 0, `limit` defaults to 20 (1–100), and `maxBytes` defaults to 15000 (1–1048576).

`flow_live_get` (without `operationId`) shares the [online entry details contract](../control/contracts/control-api.md#current-online-entry-details) with REST and CLI.

## 5. Conflicts, retries, and cancellation

Business failures return `isError: true` with JSON in `content[0].text` (and no `structuredContent`). Structured errors include `error.code`, `message`, an applicable HTTP `status`, and an optional `hint` for recoverable conflicts or states (such as `flow.revision-conflict`, `live.conflict`, `run.not-terminal`, `page.invalid-cursor`, `connector.unconfigured`, `flow.not-found`, `run.not-found`). Unknown internal errors do not expose exception stacks.

`flow_create`, `flow_import`, `flow_publish`, `run_start`, and `flow_connections_edit` (`action: "remove_usage"`) require an explicit, nonempty `idempotencyKey` of at most 256 characters. `flow_edit` uses `requestId` with the same length limit and pins `baseRevision`. Retries of a mutation must retain its identity and arguments.

Request cancellation propagates to Connector queries and `waitSeconds` waits in that request. Server shutdown aborts active MCP requests. Accepted Runs continue independently of MCP connections. Use `run_cancel` for explicit cancellation.

## 6. Specification sources

- [MCP 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28)
- [Streamable HTTP](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)
- [Official TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)

`mcpTools`, `mcpPrompts`, `mcpToolsets`, and `mcpDefaultToolsets` from `@oomol-lab/open-flow/mcp` centrally provide tool parameters, titles, descriptions, annotations, output schemas, and prompts. Server registers these Standard Schema definitions directly and runs `mcpConformanceCases` from the same entry point. See [Public contracts and version evolution](../control/contracts/compatibility.md) for deployment boundaries and version rules.
