# Control API technical reference

This document defines the Open Flow Control API HTTP contract shared across deployments. It excludes databases, authentication providers, transaction implementations, schedulers, and deployment resources. `@oomol-lab/open-flow/control-api-conformance` exports public black-box cases.

Deployments should run each applicable profile in full. Importing public types or testing client mocks is insufficient. Cases use real HTTP transport and the public `ControlClient` response decoder. Fixtures prepare deterministic data and external capabilities; they do not replace the routes under test.

| Profile                                                                                                    | Deployment fixture requirements                                                                                                                                                                                                           |
| ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `controlApiConformanceCases`, `publicationControlApiConformanceCases`, `triggerControlApiConformanceCases` | Isolated data per case; Flow, publication, Trigger catalog, and Webhook support. Start an executor for cases marked `runtime`.                                                                                                            |
| `connectorControlApiConformanceCases`                                                                      | At least one Provider and Action both without scope and in a new Flow; name search, authorization pages, conditional reads, and implicit access.                                                                                          |
| `selectableConnectorAccessControlApiConformanceCases(fixture)`                                             | Selectable access, an addable Provider, and valid account authorization candidates. The initial Flow has no service selection or authorization.                                                                                           |
| `connectorScopeControlApiConformanceCases(fixture)`                                                        | Two existing Flows with different account lists. Supply each Flow’s exact Connection list, with at least one nonempty list.                                                                                                               |
| `eventSourceControlApiConformanceCases(fixture)`                                                           | An active `feishu_app_bot` Connection that can create an event source, with trusted `providerAccountId`, owning `teamId`, and expected `connectionPageUrl`. The app has no event source yet.                                              |
| `pollControlApiConformanceCases(fixture)`                                                                  | A registered Poll definition, Connection, valid configuration, dynamic options, and deterministic preview. The baseline is ready after publication. Preview does not advance the checkpoint; automatic scheduling stays off during tests. |
| `runResultControlApiConformanceCases(fixture)`                                                             | One Run with exactly 51 results and another with none. Identify a result with body `{ rows: number[] }`, at least two rows, and complete JSON within the default 15,000 bytes. Supply real metadata for every result.                     |
| `draftRepairControlApiConformanceCases(fixture)`                                                           | An existing unreadable or outdated Draft, its Flow and Revision identity, and expected repaired content. Preserve recoverable entries.                                                                                                    |

Run every case returned by a factory. Do not skip verification because a deployment lacks an interface. Deployments with Connector scopes, event sources, Poll, or results prepare the corresponding fixtures. Base profiles do not automatically run fixture-dependent factories. Storage setup may prepare historical corrupt Revisions or saved tool results, but verification uses only public HTTP. Do not call production services to generate test data.

## 1. Transport

- Paths start with `/v1`. Percent-encode resource identities as UTF-8 when placing them in path segments.
- Requests with JSON bodies use `Content-Type: application/json`.
- JSON responses contain `version: 1` at the root or in the resource object.
- Flow creation, Draft changes, Publication creation, and Run creation require a nonempty, length-limited `Idempotency-Key`.
- The same key and logical operation return the original resource. The same key with a different operation returns the corresponding conflict.
- Adapters provide authentication and deployment scope. The public contract specifies no Team header, Cookie, or token format.

Error response:

```json
{
  "error": {
    "code": "flow.revision-conflict",
    "message": "The Draft changed."
  },
  "version": 1
}
```

Clients branch only on stable `code` values. Error domains include `authentication.*`, `authorization.*`, `flow.*`, `live.*`, `publication.*`, `run.*`, `trigger.*`, `trigger-key.*`, `connector.*`, `event-source.*`, `variable.*`, `binding.*`, `engine.*`, `page.*`, and `route.*`. `controlErrorCode` from `@oomol-lab/open-flow/control-api` exports the exact set. `message` supports display and diagnosis. When known, it should state the immediate reason for rejection. It is not a stable machine contract and must not contain credentials, request payloads, or other sensitive values.

## 2. Variable

Variables are deployment-scoped configuration and do not belong to a Flow:

```ts
interface Variable {
  name: string
  updatedAt: string
  value: string
  version: 1
}
```

| Method   | Path                  | Request             | Success                                     | Missing                  |
| -------- | --------------------- | ------------------- | ------------------------------------------- | ------------------------ |
| `GET`    | `/v1/variables`       | No body/query       | `200 { variables: Variable[], version: 1 }` | Not applicable           |
| `GET`    | `/v1/variables/:name` | No body/query       | `200 Variable`                              | `404 variable.not-found` |
| `PUT`    | `/v1/variables/:name` | `{ value: string }` | `200 Variable`                              | Not applicable           |
| `DELETE` | `/v1/variables/:name` | No body/query       | `200 { version: 1 }`                        | `404 variable.not-found` |

Names are case-sensitive, contain 1–256 ASCII characters, and match `^[A-Za-z_][A-Za-z0-9_]*$`. The `OO_` prefix is reserved case-insensitively. Lists use ascending ASCII/BINARY name order. Values may contain empty strings, NUL, newlines, and Unicode, up to 64 KiB in UTF-8. Each deployment permits 200 distinct names. Existing records remain editable at the limit. PUT with the same value preserves `updatedAt`. Invalid requests return `variable.invalid`; a 201st name returns `variable.limit-reached`.

Control API Operators can enumerate and read all values. Variables are exportable deployment configuration. They provide no Secret Manager guarantees for nonexportable values, per-variable ACLs, KMS, rotation, or separate auditing.

## 3. Flow, Revision, and Presentation

Flow is a top-level resource:

```ts
interface Flow {
  live?: { enabled: boolean; publicationId: string; revisionId: string }
  createdAt: string
  draftRevisionId: string
  resourceReferences: {
    draft: {
      variableNames: readonly string[]
      connections: readonly { providerId: string; connectionId: string }[]
      errorSourceFlowIds: readonly string[]
    } | null
    sharedAccess: {
      accessRevision: number
      providerIds: readonly string[]
      bindings: readonly { providerId: string; connectionId: string | null; accessBindingId: string }[]
    }
  }
  flowId: string
  name: string
  status: 'active' | 'retiring'
  updatedAt: string
  version: 1
}

interface FlowPage {
  flows: readonly Flow[]
  nextCursor?: string
  total?: number
  version: 1
}
```

Deployments generate `flowId`. Deletion moves a Flow to `retiring`. Draft mutation, Run, Publish, Rollback, and Trigger admission then fail closed. `total` is required only with `includeTotal=true`.

`resourceReferences.draft` corresponds to `draftRevisionId`. It contains deduplicated, stably ordered Variable names, explicitly selected connection accounts, and Error Trigger source Flow IDs actually referenced by the Draft. These are static references across the whole Draft, not proof that a Run used every resource. An undecodable Draft or one requiring repair/upgrade returns `null`; a readable Draft without references returns three empty arrays. `sharedAccess` comes from independently maintained Flow shared account authorization, versioned by `accessRevision`.

Unconfigured access uses revision 0 and empty arrays. Shared access describes availability, not node usage. Unresolvable account references retain `accessBindingId` with `connectionId: null`. Account scope follows the Flow’s `connectorTeamId`. These fields contain no Variable values, credentials, live account status, or published resource snapshots. Lists and details return the same reference projection.

Unpublished Flows omit `live`. When present, it identifies the current publication and master enabled state. Lists and individual reads use the same projection. Compare `revisionId` with `draftRevisionId` to detect Draft changes. `PUT /v1/flows/:flowId/enabled` accepts `{ enabled: boolean, expectedPublicationId: string, version: 1 }`, no other fields or query, and returns `200 Flow`. A missing Flow returns `404 flow.not-found`. An unpublished Flow, changed Publication, or retiring Flow returns `409 flow.conflict`. First publication defaults to enabled=true. Publication and rollback retain enabled state. With enabled=false, Live status is suspended and new Live Runs return `412 live.conflict`; Draft tests are unaffected.

```ts
interface RevisionMetadata {
  actorId: string
  createdAt: string
  digest: string
  flowId: string
  modelVersion: number
  parentRevisionId: string | null
  revisionId: string
  version: 1
}

interface Draft extends RevisionMetadata {
  content: RevisionContent
}

interface DraftChange {
  revision: RevisionMetadata
  version: 1
}

interface DraftSync {
  draft: Draft
  kind: 'snapshot'
  version: 1
}
```

`@oomol-lab/open-flow/flow-change` defines `RevisionContent`, top-level `FlowDocument`, and `ChangeOperation`. Graph operations act directly on the current Flow graph and accept no graph target. There is no nested Flow map or Flow create/delete operation.

The API exposes Revisions as complete immutable snapshots. Server may store Draft content incrementally, reconstructing it and verifying its digest on read. Draft Run and Publish admission pin complete content. Draft changes use `expectedRevisionId` for CAS; stale heads return `flow.revision-conflict`. Each batch requires `Idempotency-Key`. The same key and batch return the first committed Revision; the same key with a different batch returns `flow.conflict`. Idempotent replay precedes Draft head CAS. Draft sync always returns the current complete snapshot. It accepts no revision cursor and returns no authoring operation history.

Server retains complete Revisions referenced by current Drafts, Publications, pending Publish operations, nonterminal Runs, and the latest 50 Draft Runs per Flow. Maintenance may remove other old Revision content. `GET /v1/flows/:flowId/revisions/:revisionId` returns 404 for removed content. Run records, terminal results, and Draft change idempotency metadata remain. Repeated Runs of the same Revision each count toward the latest 50.

Drafts unreadable under the current model but recoverable through tolerant decoding return `flow.upgrade-required` or `flow.repair-required`. Clients may call `POST /v1/flows/{flowId}/draft/repair` with `{ expectedRevisionId, version: 1 }` and `Idempotency-Key`. Repair retains individually readable resources, drops unreadable collection entries, and creates a new Revision with the old Draft as parent. The original Revision, Live, Publication, Run, and Presentation remain unchanged. If the original Draft is missing, incremental data is corrupt, the digest mismatches, or JSON cannot parse, explicit repair creates a blank child Revision.

Parseable content with invalid Task references, legacy Subflows, or unsupported models returns `flow.invalid` when repair/upgrade is rejected, leaving Draft head unchanged. Ordinary reads retain their original errors and never repair implicitly.

Draft requests use `DraftOperation` from `@oomol-lab/open-flow/control-requests`: complete ChangeOperation plus `graph.trigger.create`. The latter accepts `nodeId`, Provider `key`, `config`, and optional `connectionId`, `name`, and `schedule`. It creates Poll/Integration only in the root Flow. Schedule applies only to Poll and defaults to every five minutes. The Trigger node stores `connectionId` directly; omission means no selected account. On commit, the server resolves the Provider definition, converts it into a complete ChangeOperation, and stores its snapshot.

Flow model 4 Poll/Integration uses optional `connectionId`; `document.bindings` accepts only `kind: 'variable'`. Edit accounts through the `connectionId` field of `graph.node.field.set`; omit value to clear selection. Connection bindings and Trigger bindingId are no longer accepted. Idempotency digests use the original DraftOperation. Committed requests replay before catalog resolution, so catalog changes do not change retry results. Unknown keys or later batch failures produce no partial commit. Low-level REST Draft decoding and Workbench retain this contract.

Agent CLI/MCP use the node authoring contract below. Offline `applyFlowChanges` still accepts only resolved ChangeOperation.

### Node authoring

For these POST endpoints, `@oomol-lab/open-flow/control-requests` defines public views, input schemas, compilation, and diagnostic mapping:

| Path                                 | Request                                                                                        |
| ------------------------------------ | ---------------------------------------------------------------------------------------------- |
| `/v1/flows/:flowId/authoring/read`   | `{revision?, nodes?, text?:{node,field,start?,lines?}}`; nodes and text are mutually exclusive |
| `/v1/flows/:flowId/authoring/search` | `{revision?,query,type?,offset?,limit?}`                                                       |
| `/v1/flows/:flowId/authoring/schema` | `{type?}`, `{action?}`, or an empty object                                                     |
| `/v1/flows/:flowId/authoring/edit`   | `{baseRevision,requestId,edits}`                                                               |
| `/v1/flows/:flowId/authoring/check`  | `{revisionId}`                                                                                 |

CLI `read/search/schema/edit/check` and MCP `flow_read/search/schema/edit/check` use the same service. Public node views combine configuration and hide assembly of execution configuration, Modules, bindings, and imports. Source code and prompts are read on demand. Only current-model Flow graphs are supported. Revisions with retired Subflows reject reads and repair under the model compatibility contract.

Edits compile to existing ChangeOperation and use the original commit owner’s whole-graph CAS, atomic save, and idempotency records. Internal `graph.node.replace` checks the complete before value and preserves node IDs and edges. Nodes own independent execution configuration; edits affect only the target by default. Tools copy shared CodeModules as needed for local source edits, preserving other nodes’ behavior.

#### Reads and schemas

Reads return `{flowId,revision,data,version:1}`. `nodes` and `text` are mutually exclusive. Omitting both returns a summary.

- Summaries include node references, names, types, port handles, compact input summaries, and execution edges. They omit expanded schemas and long text.
- Details combine actual configuration, ports, input sources, and adjacent edges without internal definition IDs.
- Code and prompts appear as text metadata. Use `text` to read their bodies by line.

Text reads default to 80 lines, with limits of 200 lines and 24000 characters. Continue with `nextStart` until `truncated: false`. Search returns matching references, fields, line numbers, bounded context, and `nextOffset`. Pin the same `revision` for all pages.

Public schemas from `@oomol-lab/open-flow/control-requests` define request structure, node configuration, constraints, and creation examples. CLI `schema`, `--help --json`, and MCP tools share this source. Action schemas resolve within the specified Flow’s deployment scope.

#### Edits and input sources

Supported operations are `node.add/update/remove`, `input.set`, `edge.connect/disconnect`, and `text.edit/set`. `$alias` may reference only a node created earlier in the batch. Response `nodes` maps aliases to stable references. Batches execute in order; any application error prevents partial writes.

`node.update.set` contains name, description, icon, execution limits, and `config`. Configuration merges recursively: omitted fields remain, and arrays replace whole arrays. OpenAPI `config.authentication` is a complete authentication selection. When supplied, it replaces the whole selection to avoid mixing schemes and parameters.

`clear` is an array of field paths, such as `[["description"],["config","connectionId"]]`. Explicit clearing differs from JSON `null`. Required configuration cannot be cleared. Use `schema TYPE` for specific fields.

`node.add.inputs` supplies data sources by business field name, equivalent to `input.set` after creation. Code, Agent, LLM, Wait, and Approval named inputs can be declared automatically by binding. They accept any JSON, including null, by default. Supply `config.inputs` for constraints. Rebinding does not weaken existing constraints.

Capability definitions determine Connector, OpenAPI, and Provider Trigger fields. LLM `model/template/messages` use existing runtime constraints.

Creating Code, Agent, or LLM through this interface injects no sample business data. Inputs come from caller bindings or business constraints. Existing node inputs and defaults remain unchanged.

These configurations use field maps: Code `config.inputs/config.outputs`; Agent/LLM/Wait/Approval `config.inputs`; Webhook `config.body`; Value `config.outputs`. Example: `{"orders":{"schema":{"type":"array"},"nullable":false}}`.

Each field may specify `schema` (default `{}`), `nullable` (default `true`), and `description`. Inputs may also specify `default`. These describe business data constraints; callers need no internal wrappers such as `handle` or `jsonSchema`. Field maps follow local merge rules. Remove fields with `clear`, such as `[["config","inputs","obsolete"]]`.

Agent and LLM results default to text. Use `config.resultSchema` for structured results. The server generates fixed runtime outputs; callers do not declare `config.outputs`.

Supported input sources:

- `{kind:"value",value:null}`: explicit null, still subject to port validation.
- `{kind:"unset"}`: explicitly unset; do not inherit the port default.
- `{kind:"default"}`: remove the override and restore default inheritance.
- `{kind:"output",node:"NODE",port:"value",field:"name"}`: node output or its direct property.
- `{kind:"variable",name:"TOKEN"}`: bind a deployment variable by name.
- `{kind:"sources",sources:[...]}`: multiple output or variable sources, resolved by existing execution rules.

Omit `port` only for a node with one output, as in `{kind:"output",node:"$summary"}`. Multiple outputs require an explicit business field; omission returns candidates for correction. `field` selects a direct property within the chosen output, not the node output itself.

Execution edges are independent of input sources. Connections use `source`, `target`, and optional `branch` without implicitly binding inputs. Input edits do not implicitly create execution edges.

For `text.edit`, `oldText` must match exactly once, then is replaced by `newText`. Zero or multiple matches return `flow.invalid` with `details` containing `reason:"text.match-count"`, `matches`, `node`, `field`, and `editIndex`. `text.set` replaces the entire body.

#### Node configuration semantics

Public schemas define node fields and complete examples. These rules govern updates and preservation of capability definitions.

Value `values` stores values; `outputs` stores constraints. A constraint without a value leaves that output unset. To remove an output, clear both `config.values.FIELD` and `config.outputs.FIELD`. Clearing only its value does not remove the field.

JSON objects can pass as whole values. To select an object property through source `field`, declare its business structure in `config.outputs.FIELD.schema.properties`. Tools do not infer permanent types from one value.

LLM `template` retains runtime message-template semantics and can use named inputs such as `{{orders}}`. `messages` contains history without template interpolation and precedes template messages. Configuration values are defaults; node bindings take precedence. `input.set` with `default` restores inheritance; `unset` explicitly suppresses defaults. Changing a default model or template preserves existing bindings.

Condition comparison operands directly use values, node outputs, or variable sources without a `kind:"source"` wrapper. Branch names serve `edge.connect.branch`; execution edges are edited separately. `when` accepts one comparison, `{all:[comparison,...]}`, or `{any:[comparison,{all:[comparison,...]},...]}`. If no branch matches, execution uses the fixed `otherwise` branch.

`first` selects the first matching branch in saved order; `all` selects all matches. Branch ports provide no data outputs, so Condition cannot be a data source. All operand sources resolve before matching. Missing values, incomplete configuration, or incompatible types produce errors rather than `otherwise`.

Poll and Integration parameters come from catalog definitions. They accept only fixed `value`, explicit `unset`, or restored `default`, not other nodes’ outputs or variables. There is no separate `config.values` wrapper. Trigger catalogs and node details show input names and defaults.

OpenAPI node details list supported authentication options. `authentication:{schemes:["bearer","apiKey"]}` selects one complete option requiring all its schemes. Do not combine different options or select only part of one. `{schemes:[]}` is valid only when the specification permits anonymous access. Manual choices include `{type:"bearer"}`, `{type:"basic"}`, and `{type:"apiKey",name:"X-Token",in:"header"}`. Manual bearer supports specifications declaring OAuth when the caller already has an access token. Bind credentials to deployment variables through inputs listed in node details; do not put secrets in configuration.

At creation, omitted authentication and server URLs use the operation’s defaults. Changes to the same operation’s name, URL, or authentication reuse its saved specification snapshot.

Changing `sourceUrl/path/method` rereads the specification and uses the new operation’s default authentication and URL, unless the request explicitly supplies them. Clearing `config.authentication` or `config.serverUrl` restores the saved operation’s defaults. Manual and specification-based authentication selections replace as a whole. Existing input bindings remain by input name.

Agent tool `inputs` selects sources by Action parameter name:

- `{kind:"model"}`: the model supplies the value.
- `{kind:"value",value:...}`: use a fixed value.
- `{kind:"input",input:"orders"}`: reference an Agent named input.

Callers need not supply parameter schemas. Adding a tool or changing its Action assembles constraints from the catalog. Unspecified parameters default to model input. Existing tools with unchanged Actions retain constraints and sources not overwritten. Description or approval changes do not refresh catalog definitions. Unknown parameter names return the available names.

#### Saving, validation, and retries

Edits return `{saved:true,revision,nodes,changes,validation,version:1}`. `validation.status` is `valid`, `invalid`, or `unavailable`. A successful save may contain semantic diagnostics. Resolve them and recheck the pinned revision with `check` before execution. Diagnostics include node references, field paths, and available code line/column locations, hiding storage paths and definition IDs.

`requestId` is a stable idempotency identity. After a lost response, retry with the same Flow, baseRevision, requestId, and complete edits. The server checks the original request record before Draft versions and catalog resolution.

- Reusing an identity for a different request returns `flow.conflict`.
- A new request against an old revision returns `flow.revision-conflict` without automatic merging.

After a revision conflict, reread affected nodes, preserve user changes, and submit against the new revision with a new request identity.

Check returns pinned `revisionId`, `valid`, and diagnostics with node, field, and code locations.

### Presentation and editor reads

Presentation is independent of Draft head:

```ts
interface Presentation {
  revision: number
  updatedAt: string
  value: Readonly<Record<string, JsonValue>>
  version: 1
}
```

Update bodies use `{ expectedRevision, value, version: 1 }`. Stale CAS returns `flow.presentation-conflict`.

`GET /v1/flows/{flowId}/editor` combines data for initial editor loading:

```ts
{
  flow: Flow
  draft: Draft
  live: Live
  presentation: Presentation
  version: 1
}
```

Each field reuses its resource read contract. `flow.flowId`, `draft.flowId`, and `live.flowId` must match the requested Flow. `flow.draftRevisionId` must equal `draft.revisionId`; Live `hasUnpublishedChanges` refers to that Draft. This read creates no Revision, changes no Presentation revision, and runs no check. A missing Flow returns `flow.not-found`. Independent resource read/write interfaces remain available. Clients ignore extra fields at the editor response root and in Presentation responses, but validate required fields, types, versions, and resource consistency.

### Execution graphs and input sources

Node titles must be nonempty and unique within each Flow graph. `nodeId` is stable across title changes. Correct naming violations through normal Draft changes that create a new Revision. Reads do not rewrite existing versions.

Execution nodes own `node.task` directly. There is no independent Task ID or shared Task table. Copy, edit, delete, and undo affect only the specified node. CodeModules remain referenceable by `moduleId`. Task port groups are stored with ordered definitions and included in the digest. They create no semantic ports and do not participate in connections, validation, or Runs.

Revision graphs require `nodes` and `edges`; save `edges: []` explicitly when there are no execution edges. For legacy Drafts, decoding supplies `[]` for missing `edges`. Explicit edges still undergo array and edge-structure validation. Value nodes have no data input ports. Decoding normalizes their `inputs` to `{}`, ignoring missing or arbitrary legacy input data. Incoming execution edges remain and determine execution timing. Edges use `{ source: nodeId, target: nodeId, sourceHandle?: branch }`.

Ordinary nodes must omit `sourceHandle`; Condition and Wait require a declared branch or action. Edges have no target input handle. Duplicate edges, missing endpoints, and edges targeting Triggers fail validation. Self-edges and back edges are allowed. Edge sets use canonical order in Revision digests.

`inputs[handle]` uses `{ kind: 'value', value }` or `{ kind: 'sources', sources }`. Node sources use `{ kind: 'node', nodeId, output, field?: string }`. Omit `field` for the whole output; supply it for a direct property declared by the output object schema. Keys are literal, including empty strings, dots, and slashes. Nested paths and array indexes are unsupported. Inputs and Condition operands share field selection.

Candidates come from direct schema `properties`; `$ref` and `allOf`/`anyOf`/`oneOf` are not expanded. Whole-output selection remains available when fields cannot be listed. A null parent or absent own property is unavailable; an explicit null field remains available. Variable binding source syntax is unchanged. Node sources must target ancestors reachable through execution edges, but need not cover every execution path. Each selected incoming edge starts a separate invocation without waiting for other predecessors.

Inputs read only that arrival path’s result snapshot; multiple sources cannot supply values in the same snapshot. Parallel predecessors pass results to their own invocations. Executable nodes accept optional positive integer `maxExecutions`, default 1000, counted per node within one Flow Run. An arrival that would exceed the limit fails the Run. Wait/Agent decision resumption does not increment it. Scheduling depends only on execution edges and branch state.

Missing input sources do not skip nodes. Zero available sources produce `null`, one supplies its value, and multiple sources cause an error. Actual output `null` counts as supplied. Collected inputs undergo port validation; failure is an error.

`graph.edge.connect` and `graph.edge.disconnect` modify only execution edges. `graph.node.input.set` independently modifies data mappings. Nodes store no `concurrency`.

Agent `edge.connect/disconnect` and `input.set` independently modify execution relationships and data sources. See [Node authoring](#node-authoring). No compatibility conversion is provided for old dataflow edges, node concurrency, or old checkpoints.

## 4. Validation, Publication, and Live

```ts
interface FlowCheck {
  closureDigest: string
  diagnostics: readonly {
    code: string
    column: number
    line: number
    message: string
    path: string
    values?: Readonly<Record<string, string | number>>
  }[]
  engineContract: string
  flowId: string
  modelVersion: number
  revisionDigest: string
  revisionId: string
  valid: boolean
  version: 1
}
```

Check bodies use `{ engineContract: 'open-flow-engine/v5', version: 1 }` and always validate the Flow Revision pinned in the path. `message` is a stable canonical English fallback. Workbench may localize using `code`, optional `values.variant`, and other `values`. Unknown codes or variants must fall back to `message`.

Publication `liveEnd` records enabled state and end time when a new Live replaces that version. The ordinary publish/rollback transaction writes it atomically. Asynchronous preparation does not write it; failure and idempotent replay do not rewrite it. A new rollback Publication does not inherit its source’s end state. Current Publications and older records without history omit it. It does not indicate Trigger health.

```ts
interface Publication {
  liveEnd?: { enabled: boolean; endedAt: string }
  actorId: string
  closureDigest: string
  createdAt: string
  engineContract: string
  flowId: string
  modelVersion: number
  operation: 'publish' | 'rollback'
  publicationId: string
  sharedAccessDigest: string
  revisionDigest: string
  revisionId: string
  sourcePublicationId?: string
  version: 1
}

type PublishOperation =
  | {
      createdAt: string
      flowId: string
      operationId: string
      revisionId: string
      status: 'pending'
      updatedAt: string
      version: 1
    }
  | {
      createdAt: string
      flowId: string
      operationId: string
      publicationId: string
      revisionId: string
      status: 'succeeded'
      updatedAt: string
      version: 1
    }
  | {
      createdAt: string
      flowId: string
      issue: { code: string; message: string; nodeId?: string }
      operationId: string
      revisionId: string
      status: 'failed'
      updatedAt: string
      version: 1
    }

interface Live {
  flowId: string
  hasUnpublishedChanges: boolean
  publication: Publication | null
  revision: number
  status: 'not-published' | 'runnable' | 'suspended'
  version: 1
}
```

Publish bodies use `{ engineContract, expectedLivePublicationId, version: 1 }`. Acceptance and idempotent replay both return `202` with the same `PublishOperation`. Query status through `GET /v1/flows/{flowId}/publish-operations/{operationId}`. Pending operations create no Publication and do not move Live. After success, use `publicationId` to read Publication and Live. Failure returns only a safe issue.

Pending operations prepare new Integration subscriptions and baselines for new or changed Polls. Baseline events do not create Runs. The final checkpoint installs only on activation. Completely unchanged, healthy Integration/Poll runtime state may be reused. If an existing Integration cannot support safe staged replacement, Publish returns `publication.unsupported` before creating an operation. Old Live and its subscription remain unchanged.

Rollback bodies use `{ expectedLivePublicationId, version: 1 }` with Live CAS. First submission returns `201`; idempotent replay returns `200`. Rollback creates a new Publication with `sourcePublicationId`, preserving history and Draft head. First Publish or Rollback must verify all Variables used by the pinned closure inside the authoritative Publication-creation transaction. Missing Variables return `binding.unresolved`. Idempotent replay returns the original Publication before checking later Variable deletion.

Read a Publication’s presentation snapshot through `GET /v1/flows/:flowId/publications/:publicationId/presentation`:

```ts
interface PublicationPresentation {
  presentation: Presentation | null
  version: 1
}
```

The transaction that first accepts publication pins the saved Presentation. Asynchronous completion and replay do not reread layout. Rollback inherits the source snapshot without writing Draft Presentation. Old records and pre-upgrade pending operations without snapshots return `null`; never substitute current Presentation. Missing Publications or those outside the specified Flow return `publication.not-found`.

Publisher names and avatars are outside Publication snapshots. Workbench reads display profiles through optional host `resolveActor(actorId, signal): Promise<{ name: string; avatarUrl?: string } | null>`. Explicit host resolvers take precedence. Browser session entry points enable the default OOMOL resolver only on `https://console.oomol.com` / `https://console.oomol.dev`. They directly call the matching `https://api.oomol.com` / `https://api.oomol.dev` endpoint `GET /v1/users/summaries?user_ids=...` with upstream Cookies and cancellation signals. `nickname || username` maps to name and `url` to avatar.

This bypasses host Control API requests and includes no Flow/Team headers. Other origins do not query OOMOL by default. Missing resolvers, missing users, or failed requests display raw actorId. An independent ActorStore caches complete responses, including null, by actorId. Each Workbench session holds at most 128 entries for 24 hours. Hits update LRU order, same-identity in-flight requests coalesce, and failures are not cached. Session destruction clears the cache and cancels requests.

Profiles are not persisted.

Publication lists paginate stably in descending `createdAt`, then `publicationId` order:

```ts
interface PublicationPage {
  publications: readonly Publication[]
  nextCursor?: string
  total?: number
  version: 1
}
```

## 5. Run

```ts
interface Run {
  createdAt: string
  finishedAt?: string
  flowId: string
  revisionId: string
  runId: string
  source: 'draft' | 'live'
  startedAt?: string
  status: RunStatus
  version: 1
}
```

Run details add pinned `closureDigest`, `engineContract`, `engineDigest`, `modelVersion`, `sharedAccessDigest`, and `revisionDigest`. Live Runs add `publicationId`. Automatically triggered Runs are also Live and include `occurrenceId` and `triggerNodeId`.

`RunStatus` includes `queued | starting | running | waiting | canceled | completed | failed | indeterminate`. Every Run detail must return its pending decision collection:

```ts
waits: readonly {
  actions: readonly ['continue'] | readonly ['approve', 'reject']
  expiresAt: string
  nodeId: string
  prompt: string
  waitId: string
  waitingSince: string
}[]
```

The collection contains only unresolved waits, ordered by registration time and waitId. running, waiting, queued, and starting may each contain multiple waits. Terminal states return an empty collection. Clients locate nodes with nodeId and resolve waits with waitId. The waiting state requires a nonempty collection; the old single waiting field is rejected. RunEvents represent history.

Draft Run bodies use `{ engineContract, inputs, trigger, version: 2 }`. Live Run bodies use `{ publicationId, inputs, trigger, version: 2 }`. First acceptance returns `202`; replay returns `200`. Later Draft changes, Publish, or Rollback do not affect accepted Runs.

Required `trigger` uses `{ nodeId: string, outputs: Record<string, JsonValue> }` and pins the starting Trigger and complete outputs. Either condition returns `run.invalid`:

- The entry is missing or is not a Trigger in the pinned Revision.
- Outputs are missing, include extra ports, or violate port schemas.

Nullable permits null values, not missing ports. The entry and complete outputs participate in the Control API idempotency request digest and persist with the Run. The API neither selects an entry automatically nor falls back to whole-graph execution.

Draft Runs validate semantics, capabilities, and Variable admission only for nodes reachable from the selected Trigger through execution edges and their dependencies. Unconfigured Triggers, invalid code, and missing resources on other branches remain visible in whole-graph checks but do not block this test. Multi-source mappings for shared downstream inputs ignore existing node sources unreachable in this Run. Missing remaining sources produce `null` and undergo validation without affecting edge scheduling.

Multiple simultaneous values are forbidden. Missing node references, cycles within the selected branch, and invalid code still return `flow.invalid`. Draft Run `revisionDigest` identifies the complete Revision; `closureDigest` identifies the entry’s execution closure and may differ from the whole-graph check. Reads and recovery do not modify the original Revision. Publish and Live Runs retain complete Flow validation.

Manual Trigger structure is `{ kind: "manual", name: string, description?: string, icon?: string }`, with no inputs or schedule. It connects downstream through ordinary execution edges and provides no data output fields. Both request `trigger.outputs` and execution results are `{}`. Cron declares a `scheduledAt` string port. Poll and Integration declare outputs through their definitions. Explicit outputs can simulate other Triggers while retaining Draft/Live Run source without inventing external occurrences.

Flow Error uses Flow model 5 and `{ kind: 'error', name: string, sourceFlowIds?: readonly string[], description?: string, icon?: string }`. Only the root graph may contain it, at most once. `sourceFlowIds` lists upstream flowIds to watch. Duplicate, empty, self, and unpublished Flow IDs are forbidden. Update through `{ kind: 'graph.trigger.sources.set', nodeId: string, before?: readonly string[], value?: readonly string[] }`. Omitted value clears the list; before checks the previous value. The error-handling Flow stores and publishes its watch list; upstream Flows no longer store handler targets. Existing model 2/4 Revision bytes and digests remain unchanged. New edits upgrade to model 5.

Only failed/indeterminate terminal states of automatic occurrence Runs trigger error handling. Manual Runs may supply sample outputs to test the branch. Multiple handlers can watch one upstream Flow. Each source Run dispatches at most once per handler Flow. Flow Error has these fixed required outputs:

```ts
{
  workflow: { flowId: string; name: string; revisionId: string; publicationId: string | null }
  execution: { runId: string; status: 'failed' | 'indeterminate'; startedAt: string | null; finishedAt: string }
  error: { code: string; message: string; nodeId?: string; jobId?: string; path?: readonly string[] }
}
```

Time fields use ISO 8601. `path` is an empty list. System-level failures have no node context. Final failure reasons persist independently of event logs; error text uses existing redaction rules.

Run details may return `errorSource: { flowId, runId }` and an `errorDispatches` array containing `{ status: 'pending', flowId }`, `{ status: 'dispatched', flowId, runId }`, or `{ status: 'failed', flowId, message }`. Dispatch changes notify the source Run; handler Run creation notifies the target Flow. Failed results may include the same nodeId/jobId/path. Successful handling does not change the source terminal state. Workbench host Runs locations accept optional runId to locate either Run.

Webhook declares four required outputs in this order: `headers`, `query`, `body`, `webhookUrl`:

- headers: a string map with lowercase names.
- query: a string for one value, an ordered string array for repeated values.
- body: a strict JSON object defined by `bodyFields`.
- webhookUrl: the absolute server Request URL without query or fragment.

Empty bodies validate as `{}` without field defaults. Headers are retained in full without Trigger-layer redaction.

Webhook HTTP admission uses idempotency rules separate from Control API. Without `Idempotency-Key`, each request creates a Run. With a key, admission deduplicates within endpoint and runtime-version scope.

The digest includes pinned target identity, protocol version, and normalized method, query, and body. It excludes headers and webhookUrl. The same key and digest replay the original Run; a changed digest returns 409. Retries preserve the original outputs. Transactions and unique constraints coordinate concurrent admission. Callers that distinguish business events by headers must use different keys for different events.

First Run admission verifies all Variables required by the pinned closure in the authoritative Run-creation transaction. Missing Variables return `binding.unresolved`. Replay precedes this eligibility check. At actual execution start, one read snapshot resolves all Variable values. Updates while queued therefore apply; later updates do not affect the Run. Variable values enter neither persisted Run requests nor platform `node.started` input projections.

```ts
interface RunPage {
  flowId: string
  runs: readonly Run[]
  nextCursor?: string
  version: 1
}

interface RunEvents {
  done: boolean
  events: readonly RunEvent[]
  eventsExpiresAt?: string
  historyComplete: boolean
  nextAfter: number
  runId: string
  version: 1
}
```

Run lists paginate stably in descending `createdAt`, then `runId` order. Queries may combine one `status`, `source`, exact `runId`, inclusive `createdFrom`, and exclusive `createdBefore`. Time parameters use RFC 3339 and must form an increasing range.

`status=waiting` selects only frozen Runs. `pendingWait=true` selects all nonterminal Runs with unresolved decisions, including running and queued Runs. `false` selects the complement. Continue with identical filters on later pages. Cursors encode only Flow scope and page position.

`after` is the last observed sequence; only higher sequences return. A terminal Run has at most one terminal event. Reading a nonterminal result returns `run.not-terminal`. Successful and repeated cancellation return `cancelAccepted: true` and `false`, respectively.

Public `RunEvent` discriminates payloads by `kind`. `decodeRunEvent` and Control client share a decoder that rejects missing or incorrectly typed required fields. The envelope is `{ createdAt, kind, payload, sequence }`, where `sequence` is a nonnegative safe integer. There is no separate source sequence. Platform fields follow this table; user `outputs` and terminal `result` remain arbitrary JSON.

| kind                                                            | payload                                                                                 |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `run.queued`                                                    | `{}`                                                                                    |
| `run.started`                                                   | `{ flowId, scopeId, parentScopeId? }`                                                   |
| `run.progress`                                                  | `{ flowId, scopeId, progress }`                                                         |
| `run.completed / run.canceled / run.failed / run.indeterminate` | `{ result: JsonValue }`                                                                 |
| `run.events-truncated`                                          | JSON object reserved for event-detail truncation notices.                               |
| `node.started`                                                  | Node context plus optional `nodeKind`, `nodeTitle`, and `operation`.                    |
| `node.completed`                                                | Node context plus `outputs: Record<string, JsonValue>`.                                 |
| `node.failed`                                                   | Node context plus `error: { code, message }`.                                           |
| `node.log`                                                      | Node context plus `level: 'debug' / 'info' / 'warn' / 'error'` and `message`.           |
| `node.progress`                                                 | Node context plus `progress`.                                                           |
| `node.artifact`                                                 | Node context plus `artifact: { kind: 'artifact', id, name, size, digest, mediaType? }`. |

Node context is `{ flowId, scopeId, nodeId, executionId }`, with nonempty identities. `progress` is a finite number from 0–100. Artifact `size` is a nonnegative safe integer; `digest` is `sha256:` followed by 64 lowercase hexadecimal characters. `nodeKind` is `agent / approval / condition / connector / decision / javascript / openapi / llm / value / wait`. Runtime projection rejects legacy `node.cache-hit`, `node.preview`, and `run.output` events.

Wait registration, whole-graph freezing, and resolution append these events:

- `wait.created`: `{ expiresAt, nodeId, waitId, waitingSince }`.
- `run.waiting`: `{ waitIds }`, emitted only when a complete checkpoint commits.
- `run.resolved`: `{ action, resolvedAt, waitId }`.

Authenticated clients resolve a Wait through `POST /v1/runs/:runId/waits/:waitId/resolve` with `{ action: 'continue' | 'approve' | 'reject', version: 1 }`. The action must belong to the Wait’s `actions` in the pinned Revision. Response:

```ts
{
  action: 'continue' | 'approve' | 'reject' | null
  resolutionAccepted: boolean
  resolvedAt: string | null
  runId: string
  status: RunStatus
  version: 1
  waitId: string
}
```

Each waitId accepts the first valid, unexpired decision. A running Run wakes its original session; waiting becomes queued; queued/starting retain their state while the executor reads the latest decision. Replaying the same action returns `resolutionAccepted: true`; a competing action returns `false`. Both return committed `action` and `resolvedAt`. Missing Waits return `run.wait-not-found`; invalid actions return `run.invalid`. Expiry fails the Run with `run.wait-expired` without creating another Run.

### Run lifecycle conformance

The `run-lifecycle` model includes `fail-start` and `fail-resume`. Both commit only from `starting`, producing `failed` and `indeterminate`, respectively. Ordinary `commit` accepts terminal results from `running`, cancellation from any nonterminal state, and failure from any nonterminal state. Committed terminal states cannot be overwritten. Deployment lifecycle conformance must use its real authoritative store and cover initial start, Wait recovery, start/resume failures, idempotent admission, and terminal races. A test-only persistence implementation is not a substitute.

Public Scheduler `RunLaunch` is a mutually exclusive union for initial start and Wait recovery. Initial start requires `trigger` and permits `inputs` and `bindingValues`. Recovery accepts only `resume: { checkpoint }`, not those three launch fields. Decisions come from authoritative WaitHost reads. Run list summaries omit wait details.

## 6. Trigger and Connector

The Trigger Key catalog is deployment-scoped:

```ts
{ keys: readonly TriggerKeySummary[]; version: 1 }
{
  definitions: readonly TriggerKeySnapshot[]
  display: Readonly<
    Record<
      string,
      {
        configInputs: Readonly<Record<string, string>>
        displayName: string
        description: string
        outputs: Readonly<Record<string, string>>
      }
    >
  >
  locale: 'en' | 'zh-CN' | 'zh-TW' | 'ja' | 'ko' | 'ru' | 'fr'
  version: 2
}
{ definition: TriggerKeySnapshot; version: 1 }
```

`GET /v1/trigger-keys` and `GET /v1/trigger-keys/catalog` accept optional `locale` queries, taking precedence over `Accept-Language`. Missing or unsupported languages fall back to English. Invalid BCP 47 queries return 400. Mapping uses the public localization contract. Summaries return translated names and descriptions. Full catalog v3 `display` maps Trigger keys to Trigger text, configuration labels/descriptions, and output descriptions. `configInputLabels` includes only localized fields. Workbench reuses them in configuration panels and diagnostics; absent labels do not expose internal handles. `definitions` always retain original English. Individual definitions, CLI, and persisted Flow definitions do not change with UI language.

`localizeTrigger(definition, locale)` from public `provider-triggers` returns `Promise<TriggerDisplay>`; callers must await it. Non-English resources load lazily per language and cache. English uses original definitions without translation resources.

Both endpoints return `Content-Language`, `Vary: Accept-Language`, `Cache-Control: private, no-cache`, and an `ETag` derived from the final response. Matching `If-None-Match` returns bodyless 304 with language/cache headers. Translation changes also invalidate ETags.

Workbench uses `@oomol-lab/resource-cache` for catalog caching; that package selects persistence. Lists show valid cached data first, then refresh with ETags. Background failure retains data and shows a retry prompt.

Successful Publication commits a Live binding for every Trigger node in the Flow graph:

Trigger `name`, `description`, and `icon` affect only presentation. Publications changing only these fields retain Poll/Integration progress, subscriptions, and deduplication state. Configuration, definitions, schedules, and Connections still determine runtime equivalence. Historical Revisions and digests remain unchanged.

Bindings with unified listening expose independent change-read state through `listener`. Top-level `health` still describes subscription status. Periodic reads continue when subscriptions fail but `listener.health` is `healthy`. Pause and retirement take precedence over both health states.

```ts
interface TriggerBinding {
  currentPublicationId?: string
  currentRevisionId?: string
  endpointUrl?: string
  flowId: string
  health: 'failed' | 'healthy' | 'initializing' | 'needs_reauth' | 'suspended'
  kind: 'cron' | 'error' | 'integration' | 'poll' | 'webhook'
  lastErrorCode?: string
  listener?: { health: 'healthy' | 'failed' | 'needs_reauth'; lastErrorCode?: string }
  operatorState: 'active' | 'paused'
  runtimeVersion: number
  triggerNodeId: string
  updatedAt: string
  version: 1
}
```

Lists return `{ bindings, flowId, version: 1 }`. Pause/resume bodies are `{ version: 1 }`. State changes increment `runtimeVersion`, preventing old-version occurrences from passing final admission guards. Poll tests do not advance checkpoints, write deduplication records, or create Runs.

Connector credentials enter neither responses, Revisions, nor RunEvents. Required boolean `ConnectorAction.authenticated` is `false` when an Action executes without a Connection. Clients must not request an account or synthesize Connection identity for it. `true` requires a valid Connection. Without Connector configuration, catalog/Connection requests and Connector Task execution return `connector.unconfigured`. Configured but unavailable or invalid upstream responses return `connector.unavailable`. Clients must not collapse both into one configuration prompt.

### Trigger configuration and outputs

Event-type Integration callbacks return `outputs`; listener pages return `outputs` or `null` for no event. Providers construct complete port maps. Server validates them against the pinned Trigger contract and admits them unchanged. Poll retains raw events and per-event deduplication. Provider `buildOutputs(events)` converts nonempty deduplicated batches into one Run’s complete outputs. Baselines, empty pages, and fully duplicate pages do not call it. Provider configuration reuses node `InputPort | Group` definitions through `configInputs`. Persistence uses node input fixed assignments:

- `value` stores explicit JSON.
- `unset` explicitly clears a value.
- Missing overrides use definition defaults.

Clearing writes `unset`; resetting removes the override. Forms preserve unset state. Before calling Providers, runtime resolves configuration to plain JSON. Missing values become `null` and undergo `nullable`/schema validation. Configuration supports no source bindings. Provider outputs directly declare first-level fields of the former `payload`; nested business objects do not expand recursively. Existing Poll Providers explicitly use `eventsPollOutputs` to return `{ events }`. Generic runtime assumes no output names and does not merge port values across events.

### Event source management

Event sources are deployment resources. Creation currently supports `feishu_app_bot` apps. Management reuses Control API authentication. Responses contain no Verification Token or Encrypt Key. `teamId` is an explicit Connector Team identity; deployments without Teams use `null`. `flowId` expresses Flow scope and cannot be replaced by Team identity.

| Method   | Route                           | Request                            | Success                                                  |
| -------- | ------------------------------- | ---------------------------------- | -------------------------------------------------------- |
| `GET`    | `/v1/event-sources`             | Optional `flowId` query            | `200 { version: 1, sources: EventSource[], teamId? }`    |
| `GET`    | `/v1/event-sources/connections` | Optional `teamId` query            | `200 { version: 1, connections: ConnectorConnection[] }` |
| `POST`   | `/v1/event-sources`             | `CreateEventSource`                | `201 EventSource`                                        |
| `PUT`    | `/v1/event-sources/:sourceId`   | `UpdateEventSource`                | `200 EventSource`                                        |
| `DELETE` | `/v1/event-sources/:sourceId`   | `{ version: 1, expectedRevision }` | `200 { version: 1 }`                                     |

`CreateEventSource` is `{ version: 1, name, connectionId, teamId: string | null, verificationToken, encryptKey, eventTypes: string[], manageSubscriptions: boolean }`. `UpdateEventSource` is `{ version: 1, expectedRevision, name, enabled: boolean, eventTypes: string[], verificationToken?, encryptKey? }`; omitted secrets retain existing values. Updates cannot change Connection, Team, or app identity. Creation rejects caller-supplied `appId` or `provider`; the selected active Connection supplies identity.

Requests reject extra fields. Trimmed `name` permits 1–128 characters; Connection/Team IDs and secrets permit 1–256 characters. `eventTypes` contains 1–200 distinct values matching `^[a-z][a-z0-9_.]{0,127}$`. `expectedRevision` is a positive integer. Invalid requests return `400 event-source.invalid`; unavailable trusted app identity returns `409 event-source.identity-unavailable`.

`EventSource` is `{ version: 1, sourceId, revision, name, provider, appId, connectionId, teamId, enabled, eventTypes, manageSubscriptions, verificationTokenConfigured, encryptKeyConfigured, endpointUrl, verifiedAt, lastReceivedAt, updatedAt, consumers }`. `provider` is `feishu` or `feishu_app_bot`; `endpointUrl`, `verifiedAt`, and `lastReceivedAt` may be `null`. `consumers` is `{ flowId, flowName, triggerNodeId }[]`. Only the two `*Configured` booleans expose secret status, never plaintext.

Lists with `flowId` first verify the Flow, then return only sources in its Team and always include `teamId`, possibly `null`. Missing Flows return `404 flow.not-found`. Without `flowId`, lists return sources visible to the management identity. Connection lists use explicit Team scope. If Team selection is required, do not silently choose another Team.

Successful updates increment `revision`. Stale update/delete requests return `409 event-source.conflict` without mutation. The same conflict covers existing app sources, resource limits, deleting sources used by pending or published Triggers, and removing event types those Triggers still require. Missing sources return `404 event-source.not-found`. These endpoints use `expectedRevision`, not `Idempotency-Key`, for concurrency control.

### Provider Access Binding

See [Flow authorization model](../flow-authorization.md) for data layers, call scope, and lifecycle. This section defines serialization and interfaces.

Bindings and candidates include `connectionId`, `providerId`, `accessBindingId`, and explicit `source`. `{ kind: 'admin-delegation' }` means administrator delegation; `{ kind: 'policy', ruleId: null }` means the Team default grant; `{ kind: 'policy', ruleId: string }` means a named rule. `null` does not mean unknown or unconfigured. Rule IDs can be any nonempty string, including `team-admin` or `team-default`. Public `providerAccessBindingId` hashes canonical JSON of `['provider-access', 2, teamId, connectionId, providerId, source]` with SHA-256 and returns `sha256:<hex>`.

Names, rule content, and policy revisions do not affect identity. Resolution verifies source/Connection consistency, then resolves that exact source. Deleted rules, invalid Connections, and identity mismatches reject without authorization fallback. Clients submit only candidate IDs and CAS revisions. Deployments verify assignability, store full identities, and copy them into Publication, Run, and background-work snapshots. Never trust client-reported sources. Legacy untyped binding IDs cannot execute. On saved-list reads, protocol-invalid records with valid `accessBindingId` and `providerId` project as `status: 'invalid', connectionId: null, source: null`, preserving usable display names and requiring reauthorization.

They cannot restore or imply grants. Unrecognizable entries are skipped; optional `discardedBindingCount` signals reconfiguration. Valid records remain visible; invalid envelopes still fail. Candidate lists remain strict and must not convert corrupt records into selectable grants. Background execution also rejects references without identity. Follow operational procedures for upgrades and remote cleanup.

Shared Code Provider access is deployment-owned Flow state outside Revision. Connector, Agent fixed tools, Triggers, and notifications explicitly select Connections in Revision and need no shared Code entry. Public modes are `implicit`, using configured scoped Connector authority, and `selectable`, returning/storing opaque bindings per Provider. Public contracts and Workbench neither parse permission groups nor accept credentials or create Flow service accounts. Deployment adapters project external groups into opaque candidates and bindings.

```ts
type ConnectorAccessMode = 'implicit' | 'selectable'
type ProviderAccessBindingStatus = 'active' | 'forbidden' | 'invalid' | 'missing'

interface ConnectorAccess {
  accessRevision: number
  bindings: readonly {
    accessBindingId: string
    connectionId: string
    source: { kind: 'admin-delegation' } | { kind: 'policy'; ruleId: string | null }
    connectionDisplayName: string
    permissionGroupName: string | null
    policyRevision?: string
    providerId: string
    status: ProviderAccessBindingStatus
  }[]
  mode: ConnectorAccessMode
  sharedAccessDigest: string
  version: 1
}
```

| Method   | Path                                                  | Body                                                      |
| -------- | ----------------------------------------------------- | --------------------------------------------------------- |
| `GET`    | `/v1/flows/:flowId/connector-access`                  | None                                                      |
| `POST`   | `/v1/flows/:flowId/connector-access/candidates/query` | `{ providerIds: string[], version: 1 }`                   |
| `PUT`    | `/v1/flows/:flowId/connector-access/:providerId`      | `{ accessBindingId, expectedAccessRevision, version: 1 }` |
| `DELETE` | `/v1/flows/:flowId/connector-access/:providerId`      | `{ accessBindingId, expectedAccessRevision, version: 1 }` |

`bindings` is the whole Flow’s shared Code allowlist. `sharedAccessDigest` hashes only sorted `[providerId, accessBindingId]` selections for change detection, publication state, and request identity. It excludes node selections, display names, current upstream permissions, and Provider display lists. It is not a complete execution snapshot digest. `GET /v1/flows/:flowId/connector-access?publicationId=...` reads a read-only published `ConnectorAccessSnapshot` belonging to this Flow. Without the parameter, it reads Draft `ConnectorAccess`. Clients use `getPublishedConnectorAccess` and `getConnectorAccess`, respectively.

```ts
interface ConnectorAccessGrant {
  accessBindingId: string
  connectionId: string
  providerId: string
  source: { kind: 'admin-delegation' } | { kind: 'policy'; ruleId: string | null }
  connectionDisplayName: string
  permissionGroupName?: string | null
}

interface ConnectorAccessSnapshot {
  version: 2
  mode: ConnectorAccessMode
  sharedAccessDigest: string
  sharedBindings: readonly ConnectorAccessGrant[]
  selectedBindings: readonly ConnectorAccessGrant[]
}
```

Both grant collections are required: one serves shared Code, the other consumers with explicit Connections. They deduplicate by grant identity and are not node allowlists. Hosts must derive each call’s scope from pinned declarations. Snapshots omit `accessRevision`, `providerIds`, `status`, and `policyRevision`. Names serve historical display only. Both collections are empty in `implicit` snapshots. Run, Publication, background subscription, and notification recovery strictly decode snapshots. Editable configuration cannot substitute for a snapshot; missing fields cannot enable legacy shared semantics.

`POST /v1/flows/:flowId/connection-usage/remove` accepts `{ version: 1, connectionId, expectedRevisionId, expectedAccessRevision }`, pins identity through standard `Idempotency-Key`, and returns `DraftChange`. One transaction checks both revisions and clears all node selections and shared Code usage for that account. Nodes, code, inputs, and edges remain, as do upstream authorization, Publications, and accepted Runs. Any conflict fails the whole operation. Success emits `draft.changed` and `access.changed`. Identical retries return the original result; different requests must not reuse the key. Drafts may remain unconfigured after removal. Default Connections must not automatically restore usage.

MCP exposes `flow_code_connections`, `flow_connection_candidates`, `flow_code_connection_set`, and `flow_connection_usage_remove` through the same operations. CLI equivalents are `oo flow connector code-access <flow> [--publication <publicationId>]`, `candidates <flow> <provider> [provider ...]`, `code-allow|code-remove <flow> <provider> <binding> <access-revision>`, and `remove-usage <flow> <connection> <access-revision>` with existing edit Revision/idempotency arguments. All writes affect only Draft.

Candidate queries batch nonempty, unique `providerIds` on demand. Each ID permits at most 256 characters. Responses are `{ results, version: 1 }`, with exactly one item per requested Provider: `{ candidates, mode, providerId, version: 1 }` on success or `{ providerId, error: { code, message } }` on failure. Shared Team identity, account catalog, or policy read failures fail the whole request under normal error rules.

One Provider’s candidate calculation failure does not affect others. Multi-Provider queries share membership, operator identity, account catalog, and policies. Single-Provider queries read only that service’s accounts. Workbench batches missing entries on first expansion, fetches only newly added services later, and does not repeat cached/in-flight queries. Failed entries require explicit retry; Flow switches cancel old queries.

Candidates use `connectionDisplayName`, nullable `permissionGroupName`, and optional `isDefault` for account/group display and deployment default selection. They contain no credentials or raw rules. `permissionGroupName` affects display only, not authorization source. Optional read-only `permissions: { actionIds, allActions, configured, proxy }` supports display/filtering. `actionIds` are full IDs. `configured` indicates managed access configuration exists without exposing it. This summary is not authorization evidence and must not enter Flow bindings.

When adding Connector Actions, Workbench excludes candidates whose summaries explicitly forbid the Action, then prefers `isDefault: true`. It supports deployments without summaries, or without `isDefault` when exactly one candidate remains. Multiple candidates without an explicit default are not assigned automatically. A Provider may have multiple bindings, each granting one Connection and an operator-assignable permission group. `PUT` adds a binding; `DELETE` removes the body’s binding. Success returns complete `ConnectorAccess`.

Monotonic `expectedAccessRevision` prevents concurrent overwrites; conflicts use `connector.access-conflict` and HTTP `412`. Missing access uses `connector.access-required`; unassignable or invalid access uses `connector.access-invalid`; unsupported writes use `connector.access-unsupported`. Changes invalidate clients through `{ kind: 'access.changed', flowId, accessRevision, version: 1 }`.

Open-source Server selects mode by Connector endpoint. OpenConnector uses `implicit`, revision `0`, empty bindings, digest `implicit`, and empty candidates. PUT/DELETE return `connector.access-unsupported`. `connector.oomol.com` and `connector.oomol.dev` use `selectable`. Hosted mode obtains the current UID from `api.oomol.{com|dev}/v1/users/profile` with the configured OOMOL user token, reads Flow Team app-access from relation-control, verifies assignable candidates, and stores only opaque bindings. App-access projections cache for five minutes. Action, Connection, catalog, execute, and proxy all fail closed under the same binding.

Connection catalogs retain visible non-active accounts and health for display and reauthorization; assignable candidates and execution still require active accounts. Without `role::connector-app:<connectionId>`, Team defaults permit all Actions with `source: { kind: 'policy', ruleId: null }`. Configured accounts strictly follow their rules. Empty Action lists disable access; malformed rules must not fall back to full access. Later execution resolves current rules again; deleted named groups cannot fall back to Team defaults.

Open-source Server uses user tokens for hosted Connector and must not forge Team-token-only `accessGrant`. Bindings with `appAccessConfig` require a hosted Flow runtime with Team token transport; open-source Server returns `connector.access-invalid` for such execution.

Optional Workbench `onManageConnectorAccess(flowId)` only navigates to deployment-owned permission management. Rules and tokens never enter Workbench props. Synchronous `connectionHref(flowId, providerId, connectionId?)` builds links from existing Team bindings and Console configuration. Workbench neither requests URLs nor infers domains. OOMOL Console uses `/team/:teamName/connections/:providerId`; self-hosted Console uses `/providers/:providerId` without Team data. Account details append `app=:connectionId`. Without navigation context, display plain names. Server Shell `/connector/teams` initialization returns `console: { origin, teamScoped } | null`. Deployment code resolves configuration; Team names reuse the response’s teams and bindings.

### Connector passthrough

These GET endpoints directly access the configured Connector, independently of Flow catalog endpoints:

| Flow endpoint                   | Upstream endpoint |
| ------------------------------- | ----------------- |
| `/v1/connector/proxy/providers` | `/v1/providers`   |
| `/v1/connector/proxy/actions`   | `/v1/actions`     |
| `/v1/connector/proxy/apps`      | `/v1/apps`        |

All three require Flow authentication. Optional `flowId` must be nonempty and appear once. Flow validates it and resolves Team scope without forwarding it upstream. Other query parameters, including duplicates, pass unchanged for upstream validation. Do not transform `locale` or `q` or expand catalogs by service. Requests use the deployment’s Connector token and resolved `x-oo-team-id`; clients cannot override credentials or Teams. Forward `Accept-Language` and `If-None-Match`.

Parameters and responses follow the deployed oomol-connector/open-connector non-proxy endpoints. Preserve raw Provider, Action, and App fields and upstream wrappers such as `success` / `data`. Do not convert to Flow `ConnectorProvider`, `ConnectorAction`, or `ConnectorConnection`, or add `version`. `apps` discovers runtime accounts; it is not upstream `/v1/connections` management.

Return upstream status, body, and `ETag` unchanged, including errors. Keep 304 bodies empty. Use no Flow catalog cache or local ETag, and preserve upstream `Cache-Control`, `Vary`, and `Content-Language`. Filter hop-by-hop headers and post-decompression `Content-Encoding`/`Content-Length`. Return redirects without following them. The 30-second timeout includes body reads and supports client cancellation. Stream bodies directly with backpressure and downstream cancellation, without full buffering or a total body-size limit. Transport failures before headers use Flow errors. Failures/timeouts after response start abort the stream without changing status. Local configuration and Flow validation failures also use Flow errors. Pre-header transport failures/timeouts return `connector.unavailable`.

## 7. Realtime notifications

The public Workbench Host contract has two independent subscribers:

```ts
subscribeFlowCatalog(listener: (event?: FlowCatalogEvent) => void): { ready: Promise<void>; stop(): void }
subscribeFlow(flowId: string, listener: (event?: FlowChangeEvent) => void): { ready: Promise<void>; stop(): void }

type FlowCatalogEvent =
  | { kind: 'flows.changed'; version: 1 }
  | { kind: 'flow.created'; flowId: string; version: 1 }

type FlowChangeEvent =
  | { flowId: string; kind: 'draft.changed'; revisionId: string; version: 1 }
  | { flowId: string; kind: 'run.created'; runId: string; version: 1 }
  | { flowId: string; kind: 'run.changed'; runId: string; version: 1 }
```

`ready` resolves when the first subscription connects. That success does not additionally call `listener(undefined)`. Initial Flow list reading runs in parallel with subscription setup. A returned list initializes the page and enables operations without waiting for realtime connection. If `ready` was unsettled when reading began, reread in the background after both settle to cover missed changes. Preserve the existing list and infer no creation/navigation. If subscription was already ready, one read is enough.

Flow editors still read initial state after their Flow’s `ready` settles. Hosts must resolve `ready` on initial failure, timeout, or unsubscription. `stop()` closes connections, cancels retries, and prevents later callbacks. `undefined` means reconnection after initial waiting ends, including the first success after failure/timeout, and requires refetch. Do not drop invalidation received during initial snapshot reads. Matching Draft revisions require no repeat sync; otherwise read current Draft.

Events carry no resource snapshots; clients fetch content through read APIs. `flow.created` emits only on first successful creation, not replay. An initialized Workbench on the Flows list automatically opens the new Flow. It does not interrupt open details, local creation, or automatic navigation already underway. Initial loading, ordinary `flows.changed`, and reconnect invalidation refresh lists without inferring creation/navigation. Server waits at most 5 seconds initially, then keeps reconnecting.

Its same-origin host uses two independent SSE requests:

- `GET /v1/flows/notifications`
- `GET /v1/flows/:flowId/notifications`

Both return `text/event-stream`, require Operator authentication, and end on session invalidation or Server shutdown. Other deployments may use different transports but must retain two independent logical channels and the same event contract.

## 8. Routes

| Method    | Path                                                         | Success status | Description                                                    |
| --------- | ------------------------------------------------------------ | -------------: | -------------------------------------------------------------- |
| `GET`     | `/v1/flows`                                                  |            200 | `cursor`, `limit`, `includeTotal`                              |
| `POST`    | `/v1/flows`                                                  |        201/200 | `{ name, teamId?, version: 1 }`                                |
| `GET`     | `/v1/flows/:flowId`                                          |            200 | Flow and Draft head                                            |
| `PATCH`   | `/v1/flows/:flowId`                                          |            200 | `{ name, version: 1 }`                                         |
| `DELETE`  | `/v1/flows/:flowId`                                          |            202 | Enter `retiring`                                               |
| `GET`     | `/v1/flows/:flowId/editor`                                   |            200 | Combined Flow, Draft, Live, and Presentation read              |
| `GET`     | `/v1/flows/:flowId/draft`                                    |            200 | Current Draft snapshot                                         |
| `GET`     | `/v1/flows/:flowId/draft/sync`                               |            200 | Current complete snapshot                                      |
| `POST`    | `/v1/flows/:flowId/draft/changes`                            |            200 | `Idempotency-Key` and change batch                             |
| `POST`    | `/v1/flows/:flowId/draft/repair`                             |            200 | Tolerant repair creating a new Draft Revision                  |
| `GET`     | `/v1/flows/:flowId/revisions/:revisionId`                    |            200 | immutable Revision                                             |
| `GET/PUT` | `/v1/flows/:flowId/presentation`                             |            200 | Presentation CAS                                               |
| `POST`    | `/v1/flows/:flowId/revisions/:revisionId/check`              |            200 | Pinned Revision validation                                     |
| `GET`     | `/v1/flows/:flowId/live`                                     |            200 | Live projection                                                |
| `GET`     | `/v1/flows/:flowId/publications/:publicationId/presentation` |            200 | Immutable presentation snapshot, or null                       |
| `GET`     | `/v1/flows/:flowId/publications`                             |            200 | Publication page                                               |
| `POST`    | `/v1/flows/:flowId/revisions/:revisionId/publications`       |            202 | Publish operation                                              |
| `GET`     | `/v1/flows/:flowId/publish-operations/:operationId`          |            200 | Publish operation                                              |
| `POST`    | `/v1/flows/:flowId/publications/:publicationId/rollback`     |        201/200 | Rollback                                                       |
| `POST`    | `/v1/flows/:flowId/revisions/:revisionId/runs`               |        202/200 | Draft Run                                                      |
| `POST`    | `/v1/runs`                                                   |        202/200 | Live Run                                                       |
| `GET`     | `/v1/flows/:flowId/runs`                                     |            200 | Run page filters                                               |
| `GET`     | `/v1/runs/:runId`                                            |            200 | Run detail                                                     |
| `GET`     | `/v1/runs/:runId/events`                                     |            200 | `after`, `limit`                                               |
| `GET`     | `/v1/runs/:runId/result`                                     |            200 | terminal result                                                |
| `POST`    | `/v1/runs/:runId/cancel`                                     |            200 | `{ version: 1 }`                                               |
| `POST`    | `/v1/runs/:runId/waits/:waitId/resolve`                      |            200 | `{ action, version: 1 }`                                       |
| `GET`     | `/v1/trigger-keys`                                           |            200 | Trigger summaries                                              |
| `GET`     | `/v1/trigger-keys/catalog`                                   |       200, 304 | definitions, display, locale                                   |
| `GET`     | `/v1/trigger-keys/:key`                                      |            200 | definition detail                                              |
| `GET`     | `/v1/flows/:flowId/triggers`                                 |            200 | Trigger bindings                                               |
| `GET`     | `/v1/flows/:flowId/triggers/:triggerNodeId`                  |            200 | binding detail                                                 |
| `GET`     | `/v1/flows/:flowId/triggers/:triggerNodeId/activities`       |            200 | Activity page                                                  |
| `POST`    | `/v1/flows/:flowId/triggers/:triggerNodeId/pause`            |            200 | pause                                                          |
| `POST`    | `/v1/flows/:flowId/triggers/:triggerNodeId/resume`           |            200 | resume                                                         |
| `POST`    | `/v1/flows/:flowId/triggers/:triggerNodeId/test`             |            200 | Poll test                                                      |
| `GET`     | `/v1/connector/teams`                                        |            200 | Available Team catalog: enabled, teams, version                |
| `GET`     | `/v1/connector/providers`                                    |            200 | Provider catalog; optional `flowId`                            |
| `GET`     | `/v1/connector/actions`                                      |            200 | `service` or `q`; optional `flowId`                            |
| `GET`     | `/v1/connector/actions/:actionId`                            |            200 | Action detail; optional `flowId`                               |
| `GET`     | `/v1/flows/:flowId/triggers/:triggerNodeId/options/:field`   |            200 | Dynamic Draft Trigger options scoped by its saved Connection   |
| `GET`     | `/v1/connector/connections`                                  |            200 | All Connections in the current scope; optional `flowId`        |
| `GET`     | `/v1/connector/connections/:serviceId`                       |            200 | Connections; optional `flowId`                                 |
| `POST`    | `/v1/connector/connections/:serviceId/page`                  |            200 | External authorization page URL; optional `flowId` or `teamId` |

Connector route `flowId` is an opaque Flow identity. When supplied, deployments must verify the Flow and resolve Providers, Actions, and Connections within its Connector scope. Clients cannot substitute Team IDs, Connection owners, or other external identities. Omission uses the deployment’s unscoped Connector catalog.

Authorization pages are an exception: `POST /v1/connector/connections/:serviceId/page` accepts optional, mutually exclusive `flowId` or `teamId`. Independent event-source forms use `teamId`, which must be accessible to the current Connector identity and does not modify an existing Flow’s Team. For OOMOL-hosted Connector, Server resolves Team names and builds `https://console.oomol.com/team/:teamName/connections/:serviceId` (using `.dev` in development). Omitting both selects the identity’s default Team. Hosted entry points derive from supported runtime domains, ignoring self-hosted Console settings. Self-hosted Connector uses its explicit Console origin and `/providers/:serviceId`. Missing Console origins return `503 connector.console-unconfigured`, separate from request failure `connector.unavailable`. Clients should prompt for a Console URL.

`POST /v1/event-sources` obtains Feishu app identity from the selected active Connection. Missing trusted App IDs return `409 event-source.identity-unavailable`. Sources are app-scoped, not tenant-bound. Creation neither queries tenant information nor requires `tenant:tenant:readonly`. Responses omit `tenantKey`. Event receipt validates encrypted content, Verification Token, signature, and App ID. Event `tenant_key` remains Trigger output, not a tenant-matching input.

`GET /v1/connector/connections` returns `{ version: 1, connections: ConnectorConnection[] }` with the same Flow scope checks as service-specific reads. Provider lists accept optional `locale`, otherwise resolve `Accept-Language`, and return `Content-Language` and `Vary: Accept-Language`. Workbench includes UI language in Provider URLs and persists responses/ETags per language. Deployments forward that language upstream, including app names in Actions. Providers describe only the app catalog. Panels load Connections separately and derive app ordering from active Connections in the display layer.

Connector Provider, Action list/search/detail, and Connection GET responses use `Cache-Control: private, no-cache` and content-derived `ETag`. Servers compare `If-None-Match` after identity/scope checks and data reads. Matches return bodyless 304.

`@oomol-lab/resource-cache` manages Providers, Actions, Triggers, and Connections. WorkbenchHost no longer accepts custom storage. Providers share by environment/language; Actions also isolate by service. Connections isolate by stable nonsensitive login `sessionKey`, Connector Team, and Flow scope. Each Store independently owns stable `ReadonlyVal<{ data, refreshing, error }>` state. Requests only transport and decode.

Cache keys include resource type, environment, and format version. OOMOL Providers share by environment/language; Actions isolate by service/language; Connections also include login session and Connector Team. open-connector uses session cache and retains Flow scope. Requests still carry original flowId. Service views derive from complete responses. Search uses temporary caches without modifying catalog caches.

First access asynchronously restores and validates catalogs, then conditionally requests with ETags. Cache reads wait at most one second; failure/timeout is a miss. Late restoration cannot overwrite newer data. Network data reaches memory first; persistence does not block callers, and same-key writes execute in order. Storage timeout disables that backend for the page. Other cache failures also leave requests working. There is no LRU or timed expiry cleanup.

Actions store complete service-list responses. Canvas, node panels, and Code nodes derive individual Actions from them. Browser proxy lists are not filtered by Flow-selected access. Absence is determined only after a full successful list load. Default Connections and status combine from the independent Connections Store. Action metadata retains optional upstream `operationType` (`read`, `write`, `destructive`). Missing/unknown values display as other interfaces.

`/v1/connector/action-metadata` with optional `service` or `q`, and its `/:actionId` detail endpoint, remain available. Browsers use `q` only for search. They accept `flowId` and `locale` with the same authentication, language, and conditional-read rules. Responses are `{ version: 1, actions: ConnectorActionMetadata[] }` and `{ version: 1, action: ConnectorActionMetadata }`. They omit `defaultConnection` and do not query Connections. Workbench uses separate `ConnectorActionView` combined display data. CLI/MCP retain composed `/v1/connector/actions` interfaces, selecting an active default or sole active account and preserving `ConnectorAction.defaultConnection`.

Their ETags still change with accounts; browsers do not use them as Action caches. Global search uses independent temporary state without persistence or service-list writes. Connections Store reads `/v1/connector/connections`: with `flowId`, it returns accounts the user can select in the fixed Team, unrestricted by shared Code lists; otherwise it returns Team accounts. Full and service-specific views in one scope share complete responses. Account caches use separate keys from raw proxy Apps.

Canvas loads Actions per Provider and derives details. App ordering uses all Connections; account selection uses service-specific Connections.

Store access checks refresh intervals: 5 minutes for Providers/Triggers, 30 seconds for Actions/Connections. There is no periodic polling or extra focus refresh. Authorization completion and manual retry force refresh as needed. Ordinary reads coalesce same-entry requests; Stores own cancellation. Forced refresh waits for an old in-flight request, then rereads. The old result does not enter cache, and refreshing remains active until the new request completes.

Multiple force requests before that start coalesce. Restored data undergoes structural validation and immediate revalidation on first access. Refresh retains data; failure retains it with an error and delays automatic retry by 30 seconds. Data and ETags stay together. A 304 retains data and adopts a returned new ETag; a 200 without ETag clears the old validator. Without configured or usable persistence, caches run in memory.

Boundary checks forbid browser business code from bypassing these Stores for the four resource types.

The deployment Connector client directly reads complete upstream Providers, Actions (list/search/detail), and Apps (all/by service) on every request. It stores neither bodies nor ETags, sends no upstream conditional requests, and reuses no old data after failures. Per-response and aggregate Action catalog limits still apply. The three browser proxy endpoints independently forward upstream cache protocols without using this client. Open Flow generates its own ETags for transformed responses instead of forwarding upstream ETags.

Pagination cursors are opaque, scope-bound tokens. Reusing them across Flows, Triggers, or resource types returns `page.invalid-cursor`.

## 9. Public Wait action hook

Deployments with a public origin may include a Wait’s opaque capability URL in Connector notifications. This route uses neither Operator sessions nor bearer tokens:

```text
/v1/wait-actions/:capability/:action
```

`action` is `continue | approve | reject` and must belong to the capability-bound Wait. Responses are always JSON with `Cache-Control: no-store`, no HTML, redirects, or cookies:

- `GET` only checks the action and returns `{ action, expiresAt, prompt, state: 'waiting' | 'resolved', version: 1 }` on success.
- `HEAD` uses the same checks/status as `GET` without a body.
- Only `POST` submits an action. Success returns `{ action, resolutionAccepted, resolvedAt, state: 'waiting' | 'resolved' | 'unavailable', version: 1 }`.

`POST` uses the authenticated resolve route’s first-writer-wins and replay rules. Mismatched capabilities, actions, or wait records, and expired capabilities, return `404 wait-action.not-found`. Other methods return `405 wait-action.method-not-allowed` with `Allow: GET, HEAD, POST`. Server persists only capability digests. Complete capabilities are bearer credentials; consumers must not log or forward them as ordinary public URLs.

Rate-limited requests return `429 wait-action.rate-limited` with remaining wait seconds in `Retry-After`. Rate-limited `POST` submits no decision. Rate-limited `HEAD` also has no body.

Independent resolution receipts survive event retention and are removed with Flow deletion. After another wait or terminal Run state, the old waitId still returns the winning action and original resolvedAt. The same decision returns `resolutionAccepted: true`; an opposing one returns `false`. Neither queues more execution. Canceled or expired unresolved waits create no resolution fact. Retained receipts do not extend expired external capabilities.

### Wait local execution and freezing

Wait and Approval `inputDefinitions` declare multiple editable inputs; `inputs` stores bindings. New nodes may have zero inputs. Both have non-null pending outputs emitted once at wait creation, containing inputs, prompt, and expiresAt. Wait adds continueUrl; Approval adds approveUrl and rejectUrl. Decision outputs are non-null `{ inputs, action, resolvedAt, comment }`. inputs preserves the execution snapshot; its schema declares all configured keys without mapping their types. resolvedAt is the persisted actual decision time.

Optional plaintext comment is trimmed, normalized to null when blank, and limited to 2,000 Unicode code points. Decisions/comments persist atomically; retries cannot overwrite the first decision. Ordinary Wait and Approval store no inline notification configuration. Deployments supply public origins. Ordinary Wait has no special Run/Publish admission check; execution fails if it needs links without an origin. Unconnected and unreferenced pending outputs generate no links. Complete notification outputs are access-controlled recovery data.

Public capability indexes store only digests; URLs enter neither Revisions nor ordinary service logs. Notification and selected action edges may execute together; approve/reject are mutually exclusive. Notification descendants execute as ordinary nodes. Resolution does not cancel them, and they have no special deadline. When the graph becomes idle with pending waits, retain the session for 120,000 ms without serializing/saving a full checkpoint or consuming execution budget.

A later idle transition restarts the timer; invalid wakeups do not extend it. On expiry, reread decisions before committing the checkpoint. Concurrently resolved Runs requeue. Wait records and decisions persist immediately; in-place approval needs no checkpoint. Scheduler WaitHost provides `create(WaitRequest)` and `resolutions(waitIds, block)`. Deployments guarantee pinned inputs, permissions, persistence, and wakeups. Recovery reads current decisions rather than relying on claim-time snapshots.

### Scheduler checkpoints and node events

The exact Scheduler checkpoint object is:

```json
{
  "bindingValues": {},
  "inputs": {},
  "results": { "start": { "jobId": "start", "outputs": {} }, "source": { "jobId": "job-1", "outputs": { "value": 42 } } },
  "counts": { "": { "source": 1, "approval": 1 } },
  "frames": { "job-2": { "start": {}, "source": { "value": 42 } } },
  "version": 5,
  "agents": {},
  "waits": [{ "jobId": "job-2", "nodeId": "approval", "value": 42, "waitId": "opaque-id" }]
}
```

`inputs` stores launch inputs by node ID/input handle. `bindingValues` stores this Run’s Variable binding snapshot. `results` stores each node’s last completed outputs. `counts` stores cumulative executions by node ID with outer scope fixed to `""`. `frames` stores arrival-time node result snapshots by waiting job ID. `waits` stores all waits whose decisions remain to be applied, allowing multiple jobs per node. Entries also store complete `pending` outputs once released.

`agents` maps job IDs to `{ invocationId, input, remainingMs?, checkpoint }`, where checkpoint follows the Agent continuation contract. With node timeoutMs, remainingMs must be positive and no greater than the original limit. Total JSON is limited to 16 MiB. Recovery verifies exact fields, unique job/wait identities, node execution limits, declared results, wait-input/path consistency, and Agent continuation inputs/budgets. Older checkpoints cannot recover as v5.

Nodes outside the execution path create no jobs, execution identities, or events. Each arrival gets a separate identity, retained through suspension/recovery. Ordinary Task outputs declared but missing or `undefined` become `null`. An entirely `undefined` return becomes an empty object; explicit non-object returns remain invalid. Port contents are not recursively normalized. Unselected Condition/Wait branch ports remain absent. Runtime validates and copies return data before JSON transport.

It permits `undefined` only for the entire return or top-level ports. Functions, Symbols, BigInt, non-finite numbers, cycles, non-plain objects, nested `undefined`, and sparse arrays are rejected. Transport calls no `toJSON` and does not rely on serialization to discard or convert invalid values. `node.completed` emits only after complete output validation. Its `outputs` is the full final handle-indexed object, or `{}` with no outputs. Each invocation emits one completion event before `node.started` for downstream nodes released at completion.

There are no per-handle `node.output` events or ordinary Task intermediate outputs. Wait pending outputs become available after registration; the Wait still completes once, after resolution.

Flow terminal results use `{ kind: 'node-results', nodes }`. `nodes` contains only the last completed result for executed terminal graph nodes, sorted by node ID. Run events retain complete per-invocation outputs. Entries are `{ nodeId, status: 'completed', jobId, outputs }`, without unexecuted nodes or repeated-job arrays. If no terminal node completed, the list is `[]`.

## 10. Code Action contract

The script contract is `open-flow-engine/v5`, with one execution per incoming-edge arrival and cumulative per-node execution limits. v4 and earlier Publications/Runs require republication or a new Run. `context.actions` replaces v1 `context.connector` without aliases. v1-pinned Publications/Runs require their matching Engine; current Server explicitly rejects v1. New Code node Revisions store account mode. Only independent mode stores a node Action allowlist. Deployment Provider Access Bindings or implicit Connector authority remain the final authorization source.

### Revision and edit operations

New Inline Code Tasks save this declaration by default. Shared mode directly uses all Actions authorized by Flow shared accounts without a node list. Independent mode stores `actions`; each may specify `connectionId`, which may remain absent in Draft:

```json
{ "kind": "connector", "mode": "shared" }
```

`mode` is `shared` or `independent`. Independent Action IDs must be valid and unique. `shared` rejects `actions`. Mode, list, and account selection enter the Revision digest. Legacy `capabilities` may be omitted, empty, or contain earlier hint declarations:

```json
{
  "kind": "connector"
}
```

Legacy declarations without `mode` retain the dynamic Connector API and must not become empty allowlists implicitly. Strict decoders still read old immutable Revision `action`, `connections`, and `connectionId` structures, but those fields no longer authorize. Alias/default values become Action lookup hints only. Optional `actionHints` stores only Action IDs for schema typing; `connectionHints` stores alias/default resolution hints. Neither is an allowlist or grants Provider authority. All objects reject unknown fields.

Submit through existing Draft changes:

```ts
{
  kind: 'graph.node.task.capabilities.set',
  nodeId: 'code-node',
  before: previousCapabilities, // Omit if no previous declaration exists.
  value: nextCapabilities, // Omit to remove the entire capabilities property.
}
```

The operation requires an inline Code Task and an exact `before` match, using existing expected Revision/change identity. Public `setCodeActions(content, nodeId, capabilities)` generates it. `createCodeTask` port configuration also accepts `capabilities`. Agent `node.add/update` accepts the same declaration at Code `config.capabilities`. Ordinary source/port edits and copying preserve declarations.

### Script API

Script `context` provides cancellation, logs, progress, Artifacts, network, Connector and other host capabilities, read-only Run identity, and the same `inputs` as the first argument. On demand, `context.getPrevious()` returns the direct predecessor that triggered this invocation as `{ id, name, outputs, outputDefs }`, or `null`. outputs comes from the arrival path snapshot; outputDefs reuses pinned Revision declarations with handle, jsonSchema, nullable, and optional description. Declarations do not guarantee a value was produced.

Condition returns empty outputs/outputDefs. Data is copied into isolation only on read; returned values are independent. Example: `const previous = await context.getPrevious(); const value = previous?.outputs.items`. `context` exposes no intermediate output submission, dynamic cross-node Run store, Variable queries, or arbitrary node output queries. Deployments may privately store Run values for scheduling, debugging, and recovery, but cannot expose a second user data channel. Final results and successful completion publish through one event before downstream nodes released at completion start.

Wait pending branches may execute after wait creation.

```js
export default async (inputs, context) => {
  // Dynamic Provider method.
  const user = await context.actions.github.get_current_user({})

  // Full IDs and explicit calls use the same validator and Capability host.
  const getUser = context.actions['github.get_current_user']
  const work = await getUser({}, { connectionId: 'connection-work' })
  const message = await context.actions.call('slack.send_message', { text: inputs.text }, { connectionId: 'connection-work' })
  return { user, work, message }
}
```

Use brackets for non-JavaScript identifiers, such as `context.actions['google-drive'].list_files({})`. Dots in the remaining action name stay within the second-level key. Root and Provider tables have null prototypes, are frozen, and use Proxy to construct stable method references dynamically.

Omitting the first argument or supplying `undefined` means `{}`; Action schemas still validate required fields. Business arguments must be JSON objects, preserving explicit `null` without graph port null/default normalization. Cycles, `undefined` properties, non-finite numbers, functions, BigInt, Date, and other non-JSON values fail before transport. Methods return Connector Action data through `await`; failures throw Errors with stable `code`.

The second argument is omitted or exactly `{ connectionId: string }` / `{ connectionAlias: string }`, mutually exclusive. Empty objects/strings, null, and unknown fields return `capability.invalid`. New shared mode uses all Actions authorized by pinned Flow bindings; explicit accounts must belong to them. Omission uses single/default account selection. Independent mode uses the listed fixed account; another script account returns `capability.denied`. Legacy explicit `connectionId` is not checked against a Revision allowlist; Connector authorizes under pinned Provider access. Unknown aliases return `capability.denied`. Authenticated Actions without Connections return `connector.connection-required`. Hosts still reject forged bridge requests.

Legacy alias/default hints match exact Revision values and resolve to fixed IDs. Catalog renaming, default changes, or alias reuse do not change this mapping or expand Provider binding authority. Calls may select different accounts and run in loops or concurrently.

Public `TaskContext<Actions>` and `Task<Inputs, Outputs, Actions>` accept the node’s Action method table type, empty by default. Workbench generates shared-mode completion from the Flow-authorized catalog and independent-mode completion only from the node list. Legacy declarations retain dynamic call typing. The node panel’s shared-permission switch hides the Action list/add button when enabled. When disabled, users add Actions individually and select fixed accounts.

### Call identity, lifecycle, and catalog projection

`RuntimeInvocation.capabilities` pins direct-program declarations. Flow execution reads declarations from the pinned Inline Task. Each `RuntimeCapabilityCall` has independent `callId`; `invocationId` still identifies the Task. Server derives call IDs from trusted bridge request identity and uses them as Connector idempotency keys. Different business calls do not deduplicate; one transport request retains identity. Host logs contain Action, Connection ID, and both invocation identities, not business arguments.

Users may catch ordinary Connector errors and return success. Previously caught errors do not replace later thrown errors. Capability-count or response-size violations fail the node even if caught. Run cancellation, deadlines, sibling failure, and node exit terminate capabilities through the existing lifecycle, including unawaited requests. Cancellation does not guarantee reversal of external side effects.

Optional `ConnectorProvider` field `noSetup` means only `no_auth` is supported and contains no Connection state. Optional `ConnectorConnection` field `builtInAccount` indicates upstream `marketplace` metadata. A `no_auth:` connectionId prefix identifies a virtual account requiring no setup. Node panels combine independently fetched Provider/Connection data and sort by valid ordinary accounts, valid built-in accounts, no setup, then unconfigured.

`ConnectorConnection` optionally projects `alias`; missing aliases still permit ID binding. `ConnectorAction` optionally projects raw `inputSchema` / `outputSchema`. Existing `inputs` / `outputs` remain graph port projections. Temporarily missing schemas neither remove declarations nor expand runtime permissions.

### Current Server upstream identity selection

The Connector adapter first queries account status by stable Connection ID, then executes with `x-oo-connector-app-id`. The gateway maps it to downstream `x-oomol-connector-app-id`. Downstream execution resolves accounts by Team, service, and app ID without mutable aliases.

### Draft operation schema discovery

Public `flow-change` function `changeOperationsSchema()` returns JSON Schema for a ChangeOperation array, or a standalone operation schema when passed a kind. `decodeChangeOperations()` shares its field definitions, strips unknown fields, and rejects unknown kinds, incorrect known-field types, and incomplete structures. Server calls it at the Draft change HTTP boundary. Structural validation does not replace operation-order, before-value, graph-semantic, or Revision concurrency checks.

See [Public contracts and version evolution](compatibility.md) for public decoding, compatibility, and deployment conformance.

## 11. Agent Task

Agent uses a Managed Task with `executor.kind: "agent"`, stored directly in `node.task`. Deterministic configuration errors produce `agent.config-invalid`.

```json
{
  "name": "Reply to customer",
  "inputs": [{ "handle": "email", "nullable": false, "jsonSchema": { "type": "string" } }],
  "outputs": [{ "handle": "output", "nullable": false, "jsonSchema": { "type": "string" } }],
  "executor": {
    "kind": "agent",
    "model": "deepseek-v4-flash",
    "prompt": "Help the customer. Report rejected calls accurately. Write a reply to {{email}}.",
    "maxRounds": 10,
    "tools": [
      {
        "id": "send",
        "name": "send_mail",
        "description": "Send a reply to the customer.",
        "action": "mail.send",
        "connectionId": "work",
        "approval": true,
        "inputs": [
          { "handle": "to", "nullable": false, "jsonSchema": { "type": "string" }, "source": { "kind": "input", "input": "email" } },
          { "handle": "body", "nullable": false, "jsonSchema": { "type": "string" }, "source": { "kind": "model" } }
        ]
      }
    ]
  }
}
```

`model` is a deployment model-gateway ID with no fallback. `maxRounds` is an integer from 1–100. There are at most 64 Connector tools; tools and code computation are optional. Tool `id` is nonempty and unique within the Task. `name` is unique and matches `[A-Za-z][A-Za-z0-9_-]{0,63}`. Final output `jsonSchema` and `description` go to the model. If final JSON parsing or schema validation fails, the model receives the specific error and corrects its answer without tools or replaying executed operations.

Corrections count toward `maxRounds`. `read_result` and `run_code` are reserved. Optional `executor.code` defaults to false and is pinned in Revision. Action/Connection are pinned; unauthenticated Actions may omit `connectionId`. Tool inputs cannot declare port `value`; their `source` must be `{ kind: "value", value }`, `{ kind: "input", input }`, or `{ kind: "model" }`. `prompt` is a string template using `{{inputName}}` for node inputs. Strings insert unchanged; other JSON serializes.

Unknown references remain literal; input values do not expand recursively. Rendered text is a user message; host execution constraints stay in system messages.

Tool inputs and final outputs accept boolean schemas and these JSON Schema forms:

- Types and values: scalar or array `type`, `enum`, `const`.
- Composition and conditions: `allOf`, `anyOf`, `oneOf`, `not`, `if/then/else`.
- Strings and numbers: `minLength/maxLength`, `pattern`, known `format`, `minimum/maximum`, `exclusiveMinimum/exclusiveMaximum`, `multipleOf`.
- Objects: `properties`, `required`, schema-valued `additionalProperties`, `patternProperties`, `propertyNames`, `minProperties/maxProperties`, `dependentRequired`, `dependentSchemas`, `dependencies`, `unevaluatedProperties`.
- Arrays: schema/tuple `items`, `prefixItems`, `additionalItems`, `minItems/maxItems`, `uniqueItems`, `contains`, `minContains/maxContains`, `unevaluatedItems`.
- References: `$defs`, `definitions`, and JSON Pointer `$ref` within the parameter schema. Declared Draft 7, 2019-09, and 2020-12 are supported; undeclared schemas use 2019-09. Draft 7 `$ref` ignores sibling constraints; newer dialects retain them.

Original definitions also accept `description`, `title`, `default`, `examples`, `readOnly`, `writeOnly`, `deprecated`, and `$comment`, all retained in Revision. Generated model tool schemas retain `description`, remove other annotations, expand local references, and remove definition tables/dialect declarations. `default` is never injected into model arguments or used to overwrite fixed values. Expansion permits 4096 schema nodes and 64 levels. Model parameters reject recursive, external, and anchor references. Fixed parameters/final outputs permit resolvable local recursive references.

Unknown keywords/formats, invalid regexes, and unresolved references are configuration errors. Tool input diagnostics include specific reasons and available nested paths. Model Providers must accept generated schemas; hosts do not remove constraints to accommodate them.

Only model-generated fields are exposed to Providers, all required. Nullable fields accept explicit null. Merged arguments validate against original schemas, including composition, format, and references. Unknown fields or overrides of fixed fields reject before invocation. Validation changes neither Revision schemas nor actual arguments.

Final output is exactly one non-nullable `output`. `type: "string"` uses final text; other schemas require JSON-decodable text and complete validation before completion. Agent tool results persist separately; models receive bounded previews. Framework and Scheduler checkpoints are limited to 16 MiB.

Optional `executor.notification` is `{ action, connectionId?, inputDefinitions, messageHandle, inputs }`, independently owned by the Agent node. Notification sources are only fixed values or this node’s inputs; the host supplies the message field. Notification configuration enters the closure and independently checks Action, Connection, and public notification origin. `RunDetails.waits[].prompt` displays the complete pending call as JSON with `callId`, `toolId`, Action, optional Connection, and full `input`. Messages append the original wait expiry and decision links.

Update Agents through `{ kind: "graph.node.task.set", nodeId, before, value }`. `before` and `value` are complete Managed Tasks. The former must equal the current definition; the latter replaces this node’s execution configuration. Semantically invalid Drafts may save, but Run and Publish require validation.

### Execution and recovery

Agent Task callbacks return `{ kind: "completed", output }` or `{ kind: "suspended", checkpoint: { version: 1, callId, toolId, input, rounds, state } }`. `state` is deployment-private JSON continuation and never enters Revision or public events. Recovery carries `agent: { action: "approve" | "reject", checkpoint }` while preserving `invocationId`, `jobId`, and `runId`.

Server’s first adapter pins Mastra 1.64.0. Private continuation includes `framework: "mastra/1.64.0"`, `{ resultId, digest }[]` references, and all workflow snapshots. Snapshots enter the same Run-store wait transaction without a separate framework database. Tool-call identity combines invocation, model round, and Provider tool-call ID. Equal arguments do not merge calls.

Tools execute serially in current model-batch order. The next model round waits for all results or rejection facts. Node `timeoutMs` accumulates across active segments, with remaining budget in checkpoint node records. Approval waits, queue waits, and other nodes’ execution consume none of this node’s budget. Run budget accumulates separately. Round limits, timeout, cancellation, and resource limits are not recoverable tool errors sent to the model.

Explicit Connector `success: false` with `errorCode: "invalid_input"` becomes `connector.input-invalid`, a parameter rejection returnable to the model. Classification does not depend on `data`: schema error-array diagnostics remain; Provider error objects, null, or missing details use a generic parameter message. HTTP 400 alone is not recoverable without that identifier. An unconfirmed outcome after sending becomes `connector.indeterminate`; the Run ends `indeterminate` with `execution.terminal-unknown`. Node errors retain timeout, transport, format/size, or upstream failure reasons and received HTTP status without raw upstream bodies.

Tool failure events include `code`, `message`, and `executed`: `true` confirms a successful result, `false` confirms execution rejection, and `null` means unknown outcome. If a confirmed result fails JSON validation, size checks, or recording, terminate the Agent without running later batch tools or requesting another model round.

Progress uses `node.log` with JSON `message`. Model records are `{ kind: "model", round }`. Tool records contain `kind: "tool"`, `callId`, `toolId`, and `status` (`started/completed/failed/approval/approved/rejected`), plus complete input, output, or error code as appropriate. Failure `executed` indicates whether the call successfully returned. These records are observational, never recovery or replay sources.

### Stored Agent tool results

Each retained result belongs to one Run and invocation. `resultId` is an opaque identity, not an access capability. All routes below reuse Run authentication/resource boundaries and return not-found for mismatched ownership. Results survive log expiry and are removed with physical Flow deletion.

- `GET /v1/runs/:runId/results?after=<resultId>` returns `{ version: 1, runId, results, nextAfter? }`. Pages contain at most 50 items in ascending resultId order. Refresh from the first page for new results during execution.
- `GET /v1/runs/:runId/results/:resultId?pointer=&offset=0&limit=20&maxBytes=15000` returns `{ version: 1, runId, result, page }`. `pointer` is a JSON Pointer up to 4096 characters, defaulting to root. `offset` is a nonnegative integer. `limit` is 1–100 for object/array members. `maxBytes` is 1–1,048,576, default 15,000, limiting complete UTF-8 `page` JSON; outer result metadata is separate. String offsets count Unicode code points. Fragment size follows page budget without a separate 8192-byte cap. Reject budgets that cannot fit metadata plus one character/member. Model `read_result` permits at most 65,536 bytes, still defaulting to 15,000. Invalid pointers, out-of-range offsets, or invalid arguments return `run.invalid`.
- `GET /v1/runs/:runId/results/:resultId/content` returns complete JSON with `application/json`, attachment download, and `no-store` headers.

Result metadata is `{ resultId, callId, toolId, source, bytes, digest, createdAt }`. `source` is `{ kind: "connector", action }` or `{ kind: "code" }`, never inferred from tool names. `bytes` counts stored JSON UTF-8 bytes; `digest` is its SHA-256 hexadecimal digest; `createdAt` is an ISO timestamp.

Pages use `{ pointer, type, complete, value?, length?, offset, nextOffset?, entries? }`. `type` is a JSON type. Small values return complete `value`; larger objects/arrays return `entries` with `{ pointer, type, complete, value?, length? }`. Entries without values can be read through their pointers. String offset/nextOffset count Unicode code points; value is the current contiguous fragment, limited by encoded size. `complete: false` means value/entries are not the complete original JSON. Continue with nextOffset when present.

Model business tools return `{ kind: "stored-result", result, page }`. Reserved host tool `read_result` accepts `{ resultId, pointer?, offset?, limit?, maxBytes? }` and returns that envelope. It accesses only results obtained by the current invocation. Reads execute no external Actions and need no business approval, but consume normal model rounds and runtime budget. Compressed historical previews become `{ kind: "stored-result", result, previewOmitted: true }`; results remain readable.

Server limits Action responses to 32 MiB and per-Run tool-result bodies to 128 MiB. Catalog and Proxy limits are separate. Read pages default to 15,000 bytes, adjustable through `maxBytes`. Values fitting the budget return whole, without a per-item 2 KiB limit. Object/array pages return complete members that fit; remaining members continue on later pages. A single oversized member returns metadata for pointer-based reading. Page `complete: false` does not invalidate members with `complete: true`; they need no reread.

Previews in model history/framework snapshots share a 128 KiB budget, favoring recent previews while retaining older call pairs and result references. This is not a tokenizer or exact context-window limit. Successful results must persist before reaching the model. Storage/integrity failures cannot trigger external-call retries as correctable tool errors.

### Agent code computation

`executor.code: true` registers built-in `run_code` with `{ code, inputs }`. `code` is a JavaScript ES module exporting a default function. It accepts only resolved inputs and returns JSON or Promise<JSON>. Each input is strictly `{ kind: "value", value }`, `{ kind: "input", input }`, or `{ kind: "result", resultId }`. Named inputs must exist in the invocation. resultIds must be in its reference set and pass ownership/digest checks. Hosts inject complete data into the executor without model messages. Outputs persist before returning a stored-result envelope and may feed later computations.

Each call uses an independent isolate without node context, Connector, network, third-party imports, or other Flow modules. Inputs and results each permit 32 MiB; source permits 64 KiB; memory is 256 MiB. V8 execution-call timeout is 1 second; wall-clock limit is 5 seconds, also constrained by remaining node/Run budgets. Invalid JSON output, including undefined, BigInt, non-finite numbers, cycles, and non-plain objects, returns explicit errors. Syntax/ordinary execution errors may return to the model; corrections are new calls. Cancellation, resource limits, executor crashes, lost results, integrity failures, and storage failures terminate the Agent.

Code calls use ordinary tool logs with `source: { kind: "code" }`. Inputs retain source code and source declarations; outputs retain result references. Identity, successful-result reuse, and recovery follow Agent tool semantics. Code calls require neither per-call approval nor deployment Connector. Business tools and approval notifications retain independent capability checks.

### Dynamic Trigger configuration options

`GET /v1/flows/:flowId/triggers/:triggerNodeId/options/:field` returns `{ version: 1, options: [{ value: string, label: string, color?: string }] }`. `value` is the stable saved ID; `label` is its current name; optional `color` is six-digit hexadecimal. Success returns all options, up to 1000. Upstream failure or excess size must error rather than present truncation as complete.

Server resolves the Trigger, Connection binding, and Provider configuration from current Draft and queries within the Flow’s fixed Connector Team. Only Provider-declared fields are allowed. The interface accepts no arbitrary URLs, GraphQL, or credentials and creates no Runs, subscriptions, or production bindings. Linear currently provides `teamId` and `stateIds`, the latter depending on the saved Team.

Workbench atomically clears Linear `teamId` and `stateIds` on Connection changes, and `stateIds` on Team changes. Invalid selected options must remain with explicit notices. Do not replace or clear them automatically and thereby broaden filtering.

Flow service lists and account authorization are separate. `ConnectorAccess.providerIds` stores explicitly added services. A service may have no account or selected authorization. Older snapshots without this field use an empty list; existing bindings still contribute their services.

Code configuration combines explicitly added services with services from Code bindings, excluding node-referenced services. Overview derives usage from node configuration and Code bindings. Adding a service grants no account access and does not change `sharedAccessDigest`, which uses only authorization bindings.

`PUT /v1/flows/:flowId/connector-access/:providerId/service` adds a service. `DELETE` at the same path atomically removes it and all its bindings. Bodies use `{ version: 1, expectedAccessRevision }`; responses return updated `ConnectorAccess` with existing access conflicts and `access.changed` notifications. Addition verifies that the service exists and needs authorization. Service configuration persists on the Flow across refresh/reopening.

Open-source Server OOMOL selectable mode checks current `/v1/me/teams` membership when listing/saving candidates. In valid, nondeleted Teams, `creator` and `admin` can create `admin-delegation` for active accounts without app-access policies. `member` candidates still follow UID policies. Missing, invalid, or unverifiable membership rejects authorization. Saved administrator delegation checks current account validity using pinned identity without rereading roles/app-access. Upstream Connector still authorizes with the configured user token; Server does not forge Team tokens or bypass upstream limits.

### CLI/MCP Team selection

`POST /v1/flows` accepts `{ name, teamId?: string, version: 1 }`. teamId must be nonempty and deployment-verified as accessible. Omission retains default Team rules. The same Idempotency-Key with different Team creation requests conflicts.

Authenticated `GET /v1/connector/teams` returns `{ enabled: boolean, teams: { id: string, name: string, systemCreated: boolean }[], version: 1 }`. Deployments without Teams return enabled=false and empty teams. This catalog omits Flow-Team bindings. Public ControlClient reads through listConnectorTeams and passes teamId through createFlow’s optional third argument.

### Flow Error deletion impact

`GET /v1/flows/:flowId/error-listeners` returns `{ version: 1, listeners }` for the
existing source Flow (404 if it does not exist). Each listener contains `flowId`,
`flowName`, `nodeId`, `nodeName`, and `enabled`. The response includes all current
published Flow Error subscriptions without catalog pagination; unpublished draft
selections and retiring handlers are excluded. Node names come from the current
Publication, while Flow names use the current catalog name. `enabled` is false when
the handler deployment is disabled or its binding is paused.

The deletion dialog queries this endpoint each time it opens. This is an advisory
snapshot, not a deletion lock: subscriptions can change after the query. Deletion
still retires the source and eventually removes its subscriptions; handler draft
references remain available for manual removal.

## OpenAPI documents and Tasks

`POST /v1/openapi/document` requires Operator authentication. Request: `{ "version": 1, "url": "https://example.com/openapi.json" }`. Response: `{ "version": 1, "document": <OpenAPI JSON> }`. URLs must use HTTP(S) without embedded credentials. Only public OpenAPI 3.0/3.1 JSON is supported. Redirects are not followed; reads are limited to 4 MiB and 15 seconds. Invalid requests/loading failures return `flow.invalid` without upstream bodies. The operation changes no Flow.

Managed Tasks add `executor.kind: "openapi"` with `sourceUrl`, lowercase `method`, `path`, `serverUrl`, `document` (selected operation/dependency snapshot), and `auth`. Authentication entries are `{ id, type: "bearer" | "basic" | "apiKey", name?, in?: "header" | "query" }`. `graph.node.task.set` atomically commits `nodeId` and complete `before`/`value` Tasks with concurrency checks and undo. Empty Tasks without an operation may save but cannot run. Inputs use `path.<name>`, `query.<name>`, `header.<name>`, and JSON `body`.

Authentication uses `auth.<id>.token` or Basic `username`/`password`. Auth inputs reject fixed values, may be cleared, and require valid deployment Variables or upstream outputs at runtime. Outputs are `body`, `statusCode`, and `headers`. `node.started.nodeKind` adds `openapi`; start events omit auth inputs.

Execution uses the Revision’s saved operation snapshot without rereading remote documents. Definitions change only through explicit Draft updates. Inputs/outputs derive from that snapshot and cannot be edited as independent contracts.

The first version supports simple path/header and form query encoding, internal document references, and JSON bodies. External references, binary/streaming responses, other parameter encodings, and OAuth login are unsupported. Requests wait at most 30 seconds, bounded by shorter node/Run deadlines. Responses are limited to 4 MiB. There are no automatic retries or redirects. Non-2xx responses, undeclared statuses/media types, and schema mismatches fail the node. Missing bodies become `null`; response headers exclude `set-cookie`. Document/API requests do not forward Operator credentials, and API authentication does not apply to document loading.

### AI Decision

Managed Task `executor.kind: "decision"` stores ordered `questions`. Each has unique output `name`, plaintext `instructions`, and `type`. `noul` permits optional `criteria: { true?: string, false?: string }`; `choice` uses `criteria: { name: string, description: string }[]`; `score` uses ordered `criteria: string[]`. At least one question is required with no upper question limit. Choice uses the first 255 categories; Score uses the first 10 levels, in configuration order.

Loading, schema derivation, validation, and execution share this truncation rule. Excess entries are ignored. UI add buttons disable at limits and reenable after deletion. Effective Choice categories require at least one and unique names; Score requires at least two nonempty levels. Incomplete Drafts may save but cannot run or publish.

Fixed input `target` accepts non-null text, objects, or arrays and ordinary source bindings. Public `decisionTask` derives input/output definitions, which cannot change independently. Each question’s named port retains the full answer: Noul `type/noul`, Choice `type/choice/probabilities/confidence`, and Score `type/score/legend/probabilities/confidence`. There is no `answers` wrapper, automatic boolean conversion, or execution-branch selection. Condition may inspect results through existing direct-property Sources.

`graph.node.task.set` uses complete `before/value` Tasks for concurrency checks, atomic replacement, and undo/redo. `@oomol-lab/open-flow/decision` exports question types, Task/schema derivation, configuration validation, and request/response conversion. `flow-authoring` exports `createDecisionTask`; the authoring example is `decision`. `node.started.nodeKind` adds `decision`.

Deployments call `/v1/systemone` through optional LLM host `decision`, reusing deployment origin/token and fixed model `typesafe/jev`. Node `target` maps to gateway `state`. All questions independently evaluate the same content in one request. Prompt interpolation, question dependencies, and per-item input-array iteration are unsupported. Missing answers or invalid types/ranges fail the whole node without partial outputs. Calls obey node cancellation/timeouts; missing capability rejects admission.
