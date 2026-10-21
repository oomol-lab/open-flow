# Node authoring development guide

When adding or changing a node, design its Agent-facing read and edit contract at the same time.
CLI, MCP, and HTTP callers must be able to complete tasks with business configuration, data sources, and public schemas.
They must not need to reconstruct persisted node definitions.

See [architecture](../architecture.md) for product ownership, the [node authoring contract](../control/contracts/control-api.md#node-authoring) for request and operation syntax, and [CLI Lab](cli-lab.md) for scenarios and cost accounting.
This guide defines the boundaries node developers must handle. Public schemas and technical contracts define exact fields.

## Design public configuration

Identify the source of each configurable node property before deciding whether to expose it.

| Category                | Caller responsibility                                                                             | Product responsibility                                                                                     |
| ----------------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Business choices        | Meaningful choices such as operation, account, model, rules, prompts, timing, and policies        | Validate choices and generate execution configuration                                                      |
| Input data              | Named values, upstream outputs, variables, or other supported sources                             | Resolve sources, assemble bindings, and validate data                                                      |
| Business data contracts | Custom code results, request content, or structured model results that cannot be derived reliably | Convert fields or schemas into runtime port definitions                                                    |
| Capability definitions  | Select an Action, Trigger, or OpenAPI operation                                                   | Derive parameters, results, and authentication definitions from the authoritative catalog or document      |
| Fixed runtime structure | None                                                                                              | Fixed outputs, internal identifiers, node execution configuration, Modules, imports, and low-level changes |

Public configuration must not copy internal definition schemas directly.
Even when an internal type is reusable, check whether each field represents a choice the caller must make.
A complete type does not guarantee a usable interface. Instructions for building internal wrappers cannot replace the tool's assembly responsibility.

Tools generate output definitions for fixed single results. Callers can omit the port name when referencing the only data output.
When a node has multiple business outputs, the caller must select one. The tool returns available names to help correct the request.

Start owns `inputDefs`, edited through its public `config.inputDefs` named field map. Outputs owns `outputDefs` and `outputMappings`: edit definitions through `config.outputDefs` and sources through `node.add.inputs` or `input.set`. Definitions have no defaults. Configuration is removed with its node, restored by undo, and copied with source remapping. Outputs remains an execution sink with no downstream data ports; its business result is separate from node logs.

Call Workflow has public type `workflow` and config `{ flowId }`. The platform reads the target's current published interface snapshot and stores capability-derived Task ports. Ordinary updates preserve that snapshot; `node.refresh` reloads it. A changed Revision with an equal interface remains callable without mutating the caller. Changed interfaces require refresh; named schemas and nullability determine equality, while descriptions and port ordering do not. Refresh matches fields by exact name and retains unresolved output references for diagnostics. Callers do not reconstruct executor identities or inspect another workflow's graph.

A workflow cannot target itself; draft writes reject direct self-references, including disconnected calls.
Selection may retain an owned unpublished, disabled or Start-less target as an incomplete draft. Interface reads and checks report the unavailable target; execution rechecks current Live admission. A missing saved snapshot requires explicit refresh. No Outputs node means no declared business outputs and does not prevent calling a Start entry.

Model execution branches and data outputs separately. Only data outputs produced at runtime can be bound.
Condition branches and other control signals cannot act as data ports. Expose Wait data and decisions according to their runtime contract.

For custom data contracts, accept business field maps or result schemas. Do not infer permanent types from one sample.
Do not weaken existing constraints to make one binding succeed.

If a node permits freely named inputs, a new binding can declare an input.
If the catalog fixes the inputs, the tool must reject unknown names and return candidates.
New nodes must not inject sample business data. Business defaults must have an explicit meaning.

## Respect execution capabilities

A common input-operation format does not mean that every node supports the same sources.
Each node's public schema, compiler, and diagnostics must describe and enforce its actual limits.

- Ordinary execution nodes consume upstream results according to existing execution-path rules. Data bindings do not implicitly create execution edges, and execution edges do not implicitly bind data.
- Trigger configuration is used before a Run starts. It can accept only sources supported by its runtime mechanism, not outputs from downstream nodes in that Run.
- Authentication fields must preserve credential-source and event-visibility limits. Simpler configuration must not bypass these limits.
- When the capability or operation is unchanged, local edits preserve the existing definition snapshot. Catalog refreshes, Action changes, and operation reselection must be explicit. Changing a name or description must not silently change a contract.
- This interface edits one Flow graph in the current model. Subflow is retired. The model contract rejects reads and repairs of Revisions with old subgraphs. New nodes must not restore a subgraph entry point or silently discard old content before editing.

## Implement public conversion

`packages/open-flow` owns public node configuration, read views, request schemas, compilation, operation generation, and diagnostic mapping.
CLI and MCP call the same deployment service. The deployment uses the existing Revision and commit implementation.
Clients handle only transport, arguments, and file adaptation. They must not maintain separate defaults or state machines.

For each node change, consider these interfaces together.

| Interface     | Development requirement                                                                                                                                          |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `flow_schema` | Return business configuration, supported sources, required constraints, and minimal runnable examples. Explain node differences so callers do not have to guess. |
| `flow_read`   | Keep outlines short. Combine actual business configuration and input sources in details. Read long text on demand and hide internal definition identities.       |
| `flow_edit`   | Convert public configuration into low-level changes. Modify only the target node. Copy shared code modules when necessary and preserve node and edge identities. |
| `flow_search` | Locate objects by public fields and source text. Return references for further reads and bounded context.                                                        |
| `flow_check`  | Map internal diagnostics to public nodes, fields, ports, and code locations. Return errors that callers can use to correct a request.                            |

Callers must be able to use configuration from a detail response to update a node of the same type without adding hidden fields.
Each execution node stores its own `node.task`. Nodes do not share Task definitions, even when their configuration is identical or they were copied.

Compare business semantics when determining whether configuration changed. Internal resources such as code modules can be reassigned legitimately.
Unrelated edits must preserve existing port groups, descriptions, and other metadata that the public interface does not expose.

Updates use the public merge contract: omitted fields are preserved, arrays replace as a whole, and explicit `clear` differs from JSON `null`.
Do not collapse explicit values, unset inputs, inherited defaults, multiple sources, or variable bindings into one state.
Schemas are configuration objects too. An empty object does not clear existing constraints. Help and examples must explain explicit field removal.

The compiler processes batches and new-node aliases in order. If application fails, no part of the batch is persisted.

The interface returns save state and semantic validation separately. Drafts with diagnostics can be saved.
Commits reuse whole-graph version checks and idempotency records. If a response is lost, an identical request checks the idempotent result first.
A new request based on an old version must not merge automatically.

## Verify new nodes

First complete a minimal task through the public interface. Confirm that callers do not need to know internal definitions.
Then verify the boundaries affected by the change. Do not add static file inventories or tests that repeat implementation fields.

1. **Creation and discovery.** Public schema examples compile. Capability definitions come from the correct catalog and scope. New nodes support alias-based data bindings and execution edges. The actual created configuration can be read.
2. **Local edits and preservation.** Changing one business field preserves the semantics of other fields, bindings, edges, and other nodes with initially identical configuration. Read and edit configuration have the same meaning. Editing a shared code module locally does not change other nodes' source. Cover the node's supported defaults, null, unset, variables, multiple sources, and constraint failures.
3. **Errors and recovery.** Invalid fields, unknown inputs, ambiguous outputs, and restricted sources return public field diagnostics. A failed batch writes nothing. Version conflicts, idempotent replay, and lost responses reuse public contract tests. For text nodes, cover unique, zero, and multiple matches.
4. **Execution.** For supported nodes, verify inputs, results, branches, call counts, accounts, and expected errors. Cover waiting and decisions for Wait nodes, and admission and configuration sources for Triggers. Compilation alone does not prove correct execution.
5. **Consumer boundaries.** HTTP, CLI, and MCP produce equivalent semantic results for the same request. Workbench can read the new Revision. Run the corresponding package tests when distribution artifacts change.

Lab scenarios use real tasks that can observe the changed capability. A separate scenario for every field is unnecessary.
CLI and MCP share tasks, fixtures, and independent verifiers.
Reference solutions discover and edit only through interfaces available to Agents. They must not read fixtures or databases to construct answers.
Verifiers can inspect persisted results but must not reuse the reference solution's conversion logic.

Model mocks record actual requests and verify prompts, models, tools, input redaction, and result forwarding.
Deterministic output proves only the invocation contract, not real model generation quality.
Use explicit gates for concurrent recovery. Record initialization, simulated user edits, and verification costs separately from Agent costs.
Report script results and real Agent trials separately.

Leina notification nodes require a nonblank robot identifier (`leinaId`) or an input source binding.
Drafts may retain an unselected robot for editing, but `flow_check` reports `leina.robot-required` until configured.

Action account selections use an omitted `connectionId` for unconfigured, a nonempty ID for selected, and `""` for explicitly deferred. Deferral is supported by Connector Tasks, independent Code Actions, Agent tools and notifications, but not Provider Triggers. It bypasses only account readiness checks. A deferred Action fails if called; deferred Agent tools are excluded from the callable tool set. Preserve this distinction in public reads, edits and exports.

## Webhook HTTP responses

Webhook response configuration is static business configuration applied after Run admission, not
an input binding. Set `config.options.responseBody` to
`{ "kind": "workflow-outputs", "output": "message", "timeoutMs": 30000 }` to return a top-level
workflow output after the Run succeeds. Omit `output` for the complete output object. Connect the
Webhook execution path to the singleton Outputs node and define/map its fields through the ordinary
Outputs authoring interface. Response selection does not add an execution edge or data port.

The timeout accepts 1000–60000 ms, defaults to 30000 ms and includes queueing, retries, approvals and
called workflows. HTTP timeout returns 504 and the Run continues. Keyed retries reuse the accepted
Run. A string returns plain text; other values, including null, return JSON. An executed empty
Outputs node returns `{}`; a skipped Outputs node or missing selected field returns 500. Failed,
canceled and indeterminate Runs return 500; execution deadlines return 504. Errors have a fixed JSON
body without internal exception details. Success uses the configured status (default 200); dynamic
responses reject 204, 205 and 304. In workflow-output response mode, optional
`responseStatusCodeOutput` selects a numeric top-level output as the status. It overrides the saved
fixed `responseStatusCode`. Missing, null, fractional, out-of-range or bodyless status values return
500 with a fixed error body. No string-to-number conversion or fallback is applied. Existing response
header restrictions and CORS still apply.

Fixed `responseHeaders` remains a map of text values. In workflow-output response mode,
`responseHeaderOutputs: { "X-Count": "count" }` maps header names to top-level outputs and overrides
fixed values by case-insensitive name. Values accept string, number and boolean; number and boolean
are converted to text. `responseHeadersSource: { kind: "workflow-outputs", output: "headers" }`
replaces the entire header object, or omits `output` to use all business outputs. It preserves but
ignores fixed headers and per-header bindings until cleared. Empty objects are valid. Missing fields,
null, arrays, nested objects, invalid names/values and case-insensitive duplicates return a fixed
500 `webhook.response-headers-invalid` error without fallback. Deployment-owned header restrictions,
CORS and Content-Type encoding policy remain authoritative. References are limited to the singleton
Outputs node; names and literal values are edited as single-line text.

Omitted `responseBody` retains immediate `responseData` behavior. Updating dynamic configuration
preserves saved fixed text. Switch back by clearing `responseBody` and any
`responseStatusCodeOutput`, `responseHeadersSource` and `responseHeaderOutputs`; the fixed status, text and headers remain saved.
Explicit output renames update response selections through shared editing; removals preserve stale
selections for diagnostics. Drafts can retain incomplete configuration; checks and publication reject
missing, unreachable or undeclared response outputs. Live reads expose the published configuration
independently of later Draft edits.

## Node retries

Ordinary Code, Connector, OpenAPI, LLM and AI Decision Tasks support node-level
`retry: { maxRetries, intervalMs }` on creation and update. The count is 0–5 additional attempts;
intervals are 1–60 whole seconds expressed in milliseconds. Omission means no retry on creation,
and preserves the saved policy on update. Use `clear: [["retry"]]` to disable an existing policy.
Agent, workflow calls, Triggers, Wait and Approval do not support this policy. Reads, search, public
schemas and diagnostics expose the node setting without requiring internal Task reconstruction.

Retries repeat the whole Task with the same inputs. They may duplicate external operations. They
never replay unconfirmed side effects, bypass resource limits, or reset node/Run deadlines. Output
validation and commit failures cannot retry an already completed Task.

## Node error handling

The same five Task types accept optional `onError: "stop" | "error"`. Default is stop. With error
handling enabled, successful and handled executions continue along the same execution edges.
Enable retry independently; error handling occurs after the last attempt. Input/output validation
errors can be handled but are not retried. Cancellation, deadlines, limits, isolation failures,
indeterminate outcomes and persistence failures cannot be handled.

System `error` is null on success or a fixed object with `code`, `message`, `nodeId`, `nodeName`,
`runId`, `executionId` on failure. Bind it with `{kind:"system", node:"$step", port:"error"}` or
select one field with `field`. Business `{kind:"output", node:"$step", port:"error"}` remains a
different source. System definitions are read-only and appear separately in detail reads and the
property panel. There is no error execution edge or canvas connection point. Use a Condition node
to distinguish null from an error object. Business output bindings must allow missing/null values
if downstream processing also executes after a handled failure.
