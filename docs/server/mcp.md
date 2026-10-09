# MCP integration reference

## 1. Endpoint and scope

Server provides MCP Streamable HTTP at `/v1/mcp`. It shares the deployment, listening port, and application services with Workbench and Control API. It supports protocol `2026-07-28` and uses the official `@modelcontextprotocol/server` 2.0.0.

Clients must support the new per-request protocol metadata and HTTP headers. Streamable HTTP support alone does not establish support for this protocol version. The legacy `initialize` handshake is unsupported; Server returns the supported protocol version. There is no stdio transport, separate SSE endpoint, or `/mcp` alias.

The first version provides Flow authoring and execution tools. It does not dynamically register each Flow as a tool. The tool catalog is fixed and advertises no tool-list change notifications. Read Run status through business query tools.

## 2. Authentication and connection

Email users create a personal access Token in Settings → MCP access. Configure the client with the `/v1/mcp` URL and this header:

```http
Authorization: Bearer <personal-token>
```

See [Personal access Tokens](users.md#personal-access-tokens-and-mcp) for creation, revocation, and invalidation rules.

Operators use the deployment’s Operator credential:

```http
Authorization: Bearer <operator-token>
```

Credential environment locking, persistence, and invalidation follow Control API rules. The existing authentication entry point also validates same-origin browser sessions. Unauthenticated requests return HTTP 401. OAuth discovery and interactive authorization are unavailable; clients must support an Authorization header. MCP uses Server local accounts for Flow ownership and management permissions:

- An Operator token can access only the Operator’s own Flows.
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

This example uses `@modelcontextprotocol/client` 2.0.0. The SDK still defaults to legacy connect, so explicitly select the new negotiation mode.

## 3. HTTP contract

- Send one JSON-RPC message per body to `POST /v1/mcp`.
- Set `Content-Type` to `application/json`. Include both `application/json` and `text/event-stream` in `Accept`.
- Supply `MCP-Protocol-Version` and `Mcp-Method` as required by MCP. Tool calls also require `Mcp-Name`. Headers and body must agree.
- `server/discover` returns supported versions, server identity, capabilities, and instructions.
- Ordinary tools return JSON with `content` and equivalent `structuredContent`. The SDK supplies new protocol fields.
- The endpoint stores no protocol sessions and issues no `Mcp-Session-Id`. GET and DELETE return 405.
- Request bodies are limited to 5 MiB. Larger bodies return 413. Responses use `Cache-Control: no-store`.

Reverse proxies should preserve `/v1/mcp`, Authorization, Accept, Content-Type, and MCP headers. For requests with Origin, the proxy must make the request URL match the public origin. Do not bypass Origin checks using arbitrary client-supplied forwarding headers. Initial tools require no persistent SSE connection. Proxy disconnection and request cancellation do not revoke accepted Runs.

## 4. Tools and workflow

| Tool                           | Main inputs                                                                                | Result                                                                  |
| ------------------------------ | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| `flow_list`                    | `cursor?`, `limit?`                                                                        | Flows and `nextCursor?`.                                                |
| `flow_read`                    | `flowId`, `revision?`, `nodes?` or `text?`                                                 | Pinned revision summary, node details, or text fragments.               |
| `flow_search`                  | `flowId`, `query`, `type?`, `revision?`, `offset?`, `limit?`                               | References and bounded context.                                         |
| `flow_schema`                  | `type?` or `action?`; Action requires `flowId`                                             | Edit syntax, configuration, ports, and examples.                        |
| `flow_create`                  | `name`, `idempotencyKey`, `teamId?`                                                        | Flow with its initial `draftRevisionId`.                                |
| `flow_edit`                    | `flowId`, `baseRevision`, `requestId`, `edits`                                             | Save result, new revision, alias references, and separate validation.   |
| `flow_check`                   | `flowId`, `revisionId`                                                                     | Diagnostics for the pinned Revision.                                    |
| `flow_publish`                 | `flowId`, `revisionId`, `expectedLivePublicationId`, `idempotencyKey`                      | Publication operation with `operationId` and status.                    |
| `flow_publish_status`          | `flowId`, `operationId`                                                                    | Operation status, successful Publication ID, or failure reason.         |
| `flow_set_enabled`             | `flowId`, `expectedPublicationId`, `enabled`                                               | Updated Flow and Live enabled state.                                    |
| `flow_run`                     | `source`, pinned version, `trigger`, `inputs?`, `idempotencyKey`                           | Accepted Run.                                                           |
| `run_list`                     | `flowId`, `status?`, `pendingWait?`, `cursor?`, `limit?`                                   | Runs and `nextCursor?`.                                                 |
| `run_get`                      | `runId`                                                                                    | Status and waiting information.                                         |
| `run_events`                   | `runId`, `after?`, `limit?`                                                                | Event page and `nextAfter`.                                             |
| `run_result`                   | `runId`                                                                                    | Terminal result.                                                        |
| `run_results`                  | `runId`, `after?`                                                                          | Agent tool result metadata and `nextAfter?`.                            |
| `run_result_read`              | `runId`, `resultId`, `pointer?`, `offset?`, `limit?`, `maxBytes?`                          | Tool result metadata and a bounded content page.                        |
| `run_resolve_wait`             | `runId`, `waitId`, `action`, `comment?`                                                    | Whether resolution was accepted, authoritative action, and Run status.  |
| `run_cancel`                   | `runId`                                                                                    | Whether cancellation was accepted and authoritative status.             |
| `flow_code_connections`        | `flowId`, `publicationId?`                                                                 | Draft shared Code connections or a pinned publication snapshot.         |
| `flow_connection_candidates`   | `flowId`, `providerIds`                                                                    | Per-Provider connection candidates and independent errors.              |
| `flow_code_connection_set`     | `flowId`, `providerId`, `accessBindingId`, `selected`, `expectedAccessRevision`            | Updated Draft shared Code connections.                                  |
| `flow_connection_usage_remove` | `flowId`, `connectionId`, `expectedRevisionId`, `expectedAccessRevision`, `idempotencyKey` | Revision after atomic removal of node selections and shared Code usage. |
| `connector_teams`              | None                                                                                       | Deployment Team selection information.                                  |
| `connector_providers`          | `flowId?`                                                                                  | Connector providers.                                                    |
| `connector_search`             | `query`, `flowId?`                                                                         | Actions.                                                                |
| `connector_get`                | `actionId`, `flowId?`                                                                      | Action ports and connection requirements.                               |
| `connector_connections`        | `serviceId`, `flowId?`                                                                     | Connections.                                                            |
| `event_source_list`            | None                                                                                       | Independent event sources visible to the current identity.              |
| `trigger_search`               | `query?`                                                                                   | Provider Trigger keys.                                                  |
| `trigger_get`                  | `key`                                                                                      | Provider Trigger definition.                                            |

All tools reject undeclared top-level parameters. Flow, Run, and event lists accept `limit` from 1–100, default 50. Event `after` defaults to 0. Flow and Run cursors match Control API; a Run cursor is bound to its Flow. `run_list.status` accepts `queued`, `starting`, `running`, `waiting`, `completed`, `failed`, `canceled`, and `indeterminate`. `pendingWait: true` selects Runs with unresolved Waits, including running and queued Runs. Event retention and terminal result rules match Control API.

`run_results` returns up to 50 items per page. Pass `nextAfter` unchanged as the next `after`. `run_result_read` shares Control API result query rules: `pointer` defaults to an empty string (root) and permits up to 4096 characters; `offset` defaults to 0; `limit` defaults to 20 with range 1–100; `maxBytes` defaults to 15000 with range 1–1048576. Use `nextOffset` to read the next page at the same pointer. A value with `complete: true` contains the full value at that path.

Results are readable only under their owning Run and do not require a terminal Run. They differ from the terminal `run_result` and do not depend on event retention.

Typical workflow:

1. Find a Flow with `flow_list` and `flow_read`, or create one with `flow_create`. OOMOL Connector deployments can first select a Team through `connector_teams`.
2. Locate a target with `flow_search`. Use `flow_read` for details or text at a pinned revision. `flow_schema {"type":"code"}` returns node configuration and examples; query Action ports with `{flowId,action}`. `flow_edit` executes semantic operations atomically in order. Creation uses batch-local aliases and requires no internal definition IDs.
3. New Flows have no Trigger. Explicitly add Manual or another Trigger. Call `flow_check` with the Revision identity returned by editing.
4. To publish, call `flow_publish` with pinned `flowId`, `revisionId`, and `expectedLivePublicationId` observed from `flow_list`. Use `null` for the first publication. Poll `flow_publish_status`: `pending` means work continues, `succeeded` confirms publication, and `failed` returns an `issue`. Use `flow_set_enabled` to enable or disable a published Flow. `expectedPublicationId` prevents changing a replacement Live publication.
5. Draft Runs use `source: "draft"`, `flowId`, and `revisionId`. Live Runs use `source: "live"` and `publicationId`. Do not mix version fields from these sources. `trigger` requires `nodeId` and `outputs`. `inputs` maps node IDs to input values and defaults to `{}`.
6. `flow_run` returns `runId`; `run_list` can find existing Runs. Query `run_get`, then call `run_result` after a terminal state. `waiting` returns Wait identity and allowed actions. Explicitly submit a permitted `approve`, `reject`, or `continue` through `run_resolve_wait`; do not approve automatically. The first resolution wins. Check `resolutionAccepted` and the authoritative returned `action`. After resumption, query the same Run instead of calling `flow_run` again.
7. To inspect original Agent tool results, find `resultId` through `run_results`, then read paths and pages with `run_result_read`.

Publication history, rollback, Flow deletion/renaming, deployment Variable management, actual Trigger management, and Presentation tools are unavailable. Use existing clients for these operations.

## 5. Conflicts, retries, and cancellation

Business failures return `isError: true`. Structured results include `error.code`, `message`, and an applicable HTTP `status`. The MCP SDK returns protocol failures as JSON-RPC errors. Unknown internal errors do not expose exception stacks.

`flow_create`, `flow_publish`, `flow_run`, and `flow_connection_usage_remove` require an explicit, nonempty `idempotencyKey` of at most 256 characters. `flow_edit` uses `requestId` with the same length limit and pins `baseRevision`. Retries of a mutation must retain its identity and arguments. A new key means a new operation and may execute a second Run. MCP JSON-RPC request IDs and business idempotency keys are separate identities.

Draft head conflicts return `flow.revision-conflict`; reread before deciding how to edit. An internal mutation exception with an uncertain outcome returns `flow.mutation-outcome-unknown` and the original key. If the connection closes without a response, retry with the same arguments and key. Do not automatically change keys or select a new Draft/Live after a client timeout.

Create Provider Triggers through `node.add` with `config.key`. The server resolves and pins the definition snapshot. On retry, it reads the original request’s idempotency record before checking versions or resolving the catalog.

For `flow_edit`, `saved:true` is independent of `validation.status`. Drafts may be saved with semantic diagnostics. A text replacement with zero or multiple matches, or a failed batch, returns a correctable error with `details.reason` and `editIndex`. A batch never writes partial results.

`flow_read` reads only the requested revision and does not fall forward to a newer one. An unreadable Draft returns an error; use `flow_list` for Flow metadata. Revisions with retired Subflows cannot be read or repaired. There is no read-only call-node interface.

Request cancellation propagates to Connector queries in that request. Server shutdown aborts active MCP requests. Accepted Runs continue independently of MCP connections. Use `run_cancel` for explicit cancellation; if completion races with cancellation, use the deployment’s authoritative returned state. `flow_set_enabled` does not cancel accepted Runs. `run_resolve_wait` retains decisions by pinned Wait identity. Retrying the same action does not resume twice; later requests with a different action return the existing decision. Optional `comment` permits up to 2000 Unicode code points. The first decision and comment win. These two tools do not accept `idempotencyKey`.

## 6. Specification sources

- [MCP 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28)
- [Streamable HTTP](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)
- [Official TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)

`mcpTools` from `@oomol-lab/open-flow/mcp` centrally provides tool parameters, descriptions, and annotations. Server registers these Standard Schema definitions directly and runs `mcpConformanceCases` from the same entry point. See [Public contracts and version evolution](../control/contracts/compatibility.md) for deployment boundaries and version rules.

`flow_read`, `flow_search`, and `flow_edit` return the same business responses as CLI and HTTP. Default summaries exclude full schemas and long text. Details omit Module/binding IDs. Each node owns its execution configuration; there is no independent Task ID.

`text` reads return line counts and `nextStart`. Search results return `nextOffset`. Pin the same `revision` when continuing to avoid mixing versions.

`node.update` merges configuration locally: omitted fields remain, and arrays are replaced as a whole. `clear` paths differ from JSON null. `text.edit` requires an exact unique match. Changes affect only the target node; tools copy shared code modules as needed for local edits. Input sources and execution connections are independent. See [Node authoring](../control/contracts/control-api.md#node-authoring) for public editing semantics and each tool’s inputSchema for complete parameters.

`node.add.inputs` accepts data sources indexed by business field name. New named inputs for Code/Agent/LLM/Wait/Approval are declared automatically. Existing fields retain their constraints. Use `config.inputs` field maps for custom input constraints and `config.outputs` for Code result fields. Agent/LLM structured results use `config.resultSchema`; callers need not declare fixed output ports. A single-output source may use `{kind:"output",node:"$summary"}`; multiple outputs require an explicit `port`. CLI, HTTP, and MCP share configuration conversion and error contracts.

Agent tool arguments also accept only name-indexed `model`, `value`, or `input` sources. The selected Action supplies port constraints. Existing tools retain their definitions and sources not overwritten. Only new tools or Action changes reread the catalog.

### Catalog discovery and pinned node details

`connector_providers` lists Providers and replaces `connector_list`. `connector_search` returns Action summaries with identity, description, authenticated status, and default connection summaries. It omits inputs/outputs/inputSchema/outputSchema. Fetch full definitions as needed with `connector_get`.

`trigger_search({ query? })` replaces `trigger_list`. Without query, it lists all available definition summaries; with query, it performs case-insensitive matching. Read Trigger instances already in a Flow through `flow_read`. Connector and Trigger search queries permit 1–256 characters.

Event sources are deployment resources independent of Flows. `event_source_list({})` lists sources visible to the current identity; each item’s `consumers` shows actual usage. When configuring a Feishu Trigger, use `connector_connections({ serviceId: "feishu_app_bot", flowId })` to match its Connection.

If the list is empty, the tool instructs the caller to create and verify an event source in Workbench before querying again. Tools neither accept nor return event source secrets. Returned `sourceId`, `teamId`, `connectionId`, `eventTypes`, `enabled`, and `verifiedAt` support selection and confirmation.

The `flow_run` input schema has mutually exclusive source branches: draft requires flowId/revisionId, live requires publicationId, and fields from the other branch are forbidden. Both discovery JSON Schema and invocation validation enforce this rule.

`connector_teams` and the CLI Team directory return enabled, teams, and version. They no longer include Flow-Team binding lists.

### CLI equivalents and result wrappers

Node reads map to `oo flow read FLOW_ID --input '{"revision":"REVISION","nodes":["NODE"]}' --json`; search and editing map to `search` and `edit`. The CLI accepts JSON, files, or stdin without assembling low-level operations.

`flow_code_connections` maps to `connector code-access FLOW_ID [--publication PUBLICATION_ID]`. `flow_connection_candidates` maps to `connector candidates FLOW_ID PROVIDER_ID [PROVIDER_ID ...]`. Connection reads do not require readable Draft content. Publication snapshots are read-only; connection selection and global removal modify only Draft.

Trigger search returns `keys` on both interfaces. Other CLI commands retain terminal wrappers, such as `run` for `runs show`, `action` for `connector show`, and `check` for `check`. MCP tools return those business objects directly. CLI `kind`, wait results, exit codes, and stdout/stderr belong to the command contract and differ from MCP `content`, `structuredContent`, and `isError`. Flow/Run/event page defaults are 100 for CLI and 50 for MCP. CLI can generate idempotency keys, select current versions, and wait for publication. MCP requires explicit pinned identities and caller polling. See the [CLI invocation contract](../distribution/command-artifact.md#cli-invocation-contract).
