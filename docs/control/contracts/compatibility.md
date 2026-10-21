# Public contracts and version evolution

## Dynamic Webhook responses: Flow model v10 and Engine v7

Model v10 adds optional Webhook `options.responseBody` with
`{ kind: "workflow-outputs", output?: string, timeoutMs?: number }`. A missing field preserves
immediate `responseData`; the new mode waits for the accepted Run to succeed and returns only its
business outputs. Timeout defaults to 30000 ms and accepts 1000–60000 ms. It includes queueing and
durable waits, and does not cancel the Run. Field omission returns the complete object; strings
return plain text and other JSON values return JSON. Missing executed outputs are an HTTP error. Optional `responseStatusCodeOutput` selects a numeric
top-level output as the HTTP status only in workflow-output response mode. Fixed
`responseStatusCode` is preserved; missing or invalid dynamic statuses return 500. This addition
shares the unreleased v10 boundary. Optional `responseHeadersSource` selects the complete business
output object or one top-level object, and `responseHeaderOutputs` maps HTTP header names to top-level
output names. These policies require workflow-output response mode and share v10. Header values
support text, numbers and booleans, with scalar conversion to text. Whole-object selection replaces
fixed/per-header values while preserving their configuration; invalid dynamic headers return 500.
Deployment-owned response header restrictions remain unchanged.

The published npm `0.1.0-beta.69` artifact (gitHead
`026f74f27383188f3f771352e10e7a84bca89550`) uses model v9. A new model boundary prevents old
servers from discarding the response policy and acknowledging requests immediately. Model v9 and
older readable Revisions retain their original bytes and digests; editing uses the existing explicit
Draft upgrade. Historical Publications and Runs are unchanged. Dynamic configuration is rejected
in older model envelopes. The workflow-output response projection alone preserves Engine v6. This release also adds
`webhook-response` nodes and `responseBody: { kind: "webhook-response", nodeId?, timeoutMs? }`,
requiring Engine v7 and a new isolation digest. A node completes with response metadata separately
from its empty business outputs. Its first committed root-Run response is persisted independently
of event history; HTTP returns immediately while execution continues. Checkpoint shape remains v6.
The published v6 and v6/nodejs-compat-v1 contracts remain available for existing Publications and
Runs, preserving their platform identity and builtin allowlist. They cannot prepare Webhook response
nodes or select them as response sources. Server also supports the beta.69 isolated runtime digest
for these two contracts: its execution and v6 checkpoint protocol remain compatible for graphs
without response nodes. Unknown digests and older incompatible contracts remain rejected. Pinned
Runs, checkpoints, Publications and Revision bytes are not rewritten. New Draft Runs and Publications
use v7. Upgrade Server and clients together before publishing v10 Revisions.

## Node retries and error handling: Flow model v9 and Engine v6

Flow model v9 adds optional node-owned `retry: { maxRetries, intervalMs }` and `onError` settings, plus a separate system source namespace. Only ordinary Code,
Connector, OpenAPI, LLM and AI Decision Tasks support it. Missing policy or zero retries preserves
single-attempt behavior. Older models cannot contain this policy. Existing model v8 Revisions remain
readable without changing their bytes or digests; editing upgrades the Draft through the existing
explicit upgrade path. Historical Publications and Runs are not rewritten. Older binaries cannot
execute model v9.

Engine `open-flow-engine/v6` (including `/nodejs-compat-v1`) adds bounded Task retries and handled failures that continue along existing execution edges. The isolated
runtime digest changes too. Before upgrading, finish or cancel active Runs on the old Engine, or keep
the matching recovery environment. Old Engine-pinned Publications require republication before new
execution. Scheduler checkpoints use v6 to retain handled failures and system output snapshots; retry intervals remain active execution, not durable waits.
No pending retry is recovered by replaying an unconfirmed side effect.

## Node-owned interfaces and Publication snapshots

The current model stores required `inputDefs` on Start and required `outputDefs`/`outputMappings` on Outputs. New nodes initialize empty configuration. Configuration is deleted with its node and restored by undo. Normal reads, authoring and repair reject top-level document interface fields and legacy `Start.parameters`. The current model and envelope version numbers remain unchanged; legacy conversion is an explicit storage upgrade, not dual-format authoring.

Server schema migration 49 upgrades existing development and deployed databases in one startup transaction. It moves legacy definitions and mappings into their existing nodes, backfills every Publication interface from its fixed Revision, and upgrades serialized asynchronous publication inputs. Revision, Flow, Publication and Run IDs, Live selections, history and checkpoint bytes are preserved. Delta chains are verified and materialized before their bases change. Changed Revision bytes and their dependent Revision/closure digests are rewritten together, including trigger-scoped Draft Run digests; resource indexes are refreshed. This is a one-time storage rewrite, so older server binaries must not open the upgraded database.

Fresh databases and migrated databases enforce Publication `interface_json` as `TEXT NOT NULL` without a default. Snapshots distinguish absent nodes (`null`) from nodes with no fields (`[]`). Databases already created with the new interface column require no content rewrite. Missing Publication Revisions, corrupt digests or deltas, conflicting configurations, duplicate special nodes, and nonempty definitions whose owning node is absent abort the entire migration without committing changes. These cases require explicit data repair rather than silently dropping configuration or inventing callable nodes.

For historical Revisions that need no interface rewrite, snapshot backfill validates only the Start and Outputs nodes after verifying the stored digest. Retired Task definitions elsewhere in those Revisions do not block server startup. Their original bytes and digests remain unchanged, and normal Revision decoding and execution still reject unsupported definitions.

Stop the previous server and back up the SQLite database before deploying this upgrade, including its WAL if present. Start the new server against the existing persistent data directory; startup performs the migration before serving traffic or resuming background work. Keep the backup for deployment rollback. Do not remove the Docker data volume to upgrade.

Outputs retains ordinary dependency snapshots, loops, cancellation and checkpoint recovery. Run business outputs are absent when Outputs never executes and `{}` when it executes with no declared fields. Start normalizes omitted nullable arguments to null and rejects unknown or missing required arguments.

Unrelated Manual compatibility remains: readable Manual nodes retain their historical bytes and behavior; new edits preserve identity and metadata while converting them to Start with empty node-owned `inputDefs`. This does not rewrite historical Publications or Runs.

Workbench automatically requests the deterministic Draft upgrade when opening an editable legacy Flow. The upgrade creates a child Revision with CAS and a stable request identity. It does not use tolerant repair, drop malformed resources, overwrite historical content, or change Live, Publications, existing Runs or Presentation. Production keeps the published contract until the upgraded Draft is published. Ordinary GET requests remain read-only. Unsupported or corrupt content requires its existing explicit recovery process.

On opening a Draft, the shared node-name repair updates recognized legacy Manual default titles to the localized Start title, including Start nodes already converted by an earlier edit. Custom titles remain unchanged. Name collisions retain the other node's title and give Start the existing numbered suffix.

## Flow model v6: removal of shared Tasks and legacy Subflows

Flow model v6 removes `document.tasks` and node `taskId`. Each execution node stores its configuration in `node.task`.
Managed Task changes use `{ kind: 'graph.node.task.set', nodeId, before, value }`; legacy `task.*` operations are rejected.
Copied nodes have independent configurations. Port changes update only the node and its downstream references. Agent notifications store Action, Connection, input definitions, and argument mappings directly.

Use the existing draft upgrade operation to convert legacy Task references into a v6 Revision. Each reference expands into independent configuration, including notification references. Missing or invalid references prevent the upgrade. Reads do not silently rewrite the original Revision. v2/v4/v5 data without separate Task definitions retain their original encoding and digest.

The same upgrade removes `document.subflows`, Subflow nodes, subgraph input sources, and `subflow.*` edit operations. Graph operations act directly on the current Flow and no longer accept a graph target. Workbench, CLI, and MCP no longer expose legacy subgraph entry points. CLI `--subflow` and MCP `flow_node_get.subflowId` are removed. This version adds no Flow invocation capability.

Revisions with legacy subgraphs or Subflow nodes cannot be read or repaired. The system must not silently remove them and treat the remaining data as a complete Flow. Legacy root-only Revisions remain readable. Immutable encodings and closure digests for model v2/v4/v5 remain unchanged; new edits produce model v6. The entries below record historical changes and do not imply support for removed interfaces.

Public entry points, serialization formats, Control API, and execution semantics have separate versions. One version cannot substitute for another.

| Version           | Current value                                                     | Contract                                                                                                   |
| ----------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| npm package       | Exact version in the package manifest                             | Pins implementation, types, Workbench assets, and the conformance suite. Deployments pin the same version. |
| Revision envelope | `kind: open-flow-flow-revision`, `version: 1`                     | UTF-8 JSON envelope fields and canonical byte rules.                                                       |
| Flow model        | `modelVersion: 10`                                                | Serialization of documents, modules, nodes, and ports.                                                     |
| Control API       | `/v1`; Run creation request `version: 2`, all others `version: 1` | Request fields, responses, error codes, CAS, and idempotency.                                              |
| Engine Contract   | `open-flow-engine/v7`                                             | Execution, Trigger, Task return, Wait, and cancellation semantics.                                         |
| MCP               | `2026-07-28`                                                      | Streamable HTTP negotiation; tool product semantics reuse Control API.                                     |

Equal or different version numbers do not establish compatibility. Older formats may also have used `modelVersion: 1`; do not accept content based only on this field. Decode the complete structure before semantic validation and execution. Reject execution of Revisions that do not match the current structure. Do not rewrite them or recompute their original digest on read. Create a new Revision through a separate, auditable migration or rebuild.

Before upgrading a deployment, finish or cancel active Runs on the old Engine, or explicitly retain a recovery environment that can execute the pinned old Engine. Immutable Revision decoders do not rewrite stored content; the legacy Start field conversion described above only changes the decoded view.

## Legacy Project data

The legacy Project schema and API are outside the current product contract and cannot be imported. If Server encounters an unsupported legacy schema, it stops startup and preserves the original database. Startup must not implicitly rebuild or delete data.

## Decoding boundaries

`@oomol-lab/open-flow/flow-encoding` provides:

- `decodeFlowDocument(value)`: structurally decodes a complete Flow document.
- `decodeRevisionContent(value)`: decodes `{ modelVersion, document, modules }`.
- `decodeRevision(bytes)`: strictly decodes UTF-8, JSON, the envelope, and content. It pairs with `encodeRevision`.

Decoders ignore and remove undeclared fields from ordinary objects. Wait nodes use strict field validation and reject legacy inline notifications. All three functions validate known field types, required fields, and supported versions. `maxJsonDepth` limits nesting depth. Custom keys in JSON values and JSON Schema remain unchanged.

A valid structure does not establish that the graph can execute. Flow validation checks references, titles, cycles, ports, and module semantics. Decoding does not fill missing fields or normalize user source code. The legacy Start field conversion described above is supported without rewriting historical storage. `encodeRevision(decodeRevision(bytes))` produces canonical bytes. Bytes remain identical only if the input was already canonical, used the current field layout and contained no unknown fields.

`@oomol-lab/open-flow/control-requests` provides `controlRequests` decoders and `controlRequestSchema`. They cover Flow creation and renaming, Draft changes, Live enable/disable, Presentation, checks, publication, rollback, Draft/Live Runs, Wait resolution, Variable writes, and version-only requests. Deployments map decoding exceptions to the corresponding public invalid errors. Deployments still own HTTP body limits, identity, scope, permissions, route parameters, pagination cursors, and storage transactions.

`@oomol-lab/open-flow/mcp` provides tool parameters, descriptions, annotations, protocol versions, and service instructions. Deployments register `mcpTools` through Standard Schema and implement only operation invocation, identity, and error mapping. A deployment must not add parameter defaults, change the definition of a tool with the same name, or weaken request validation. Business errors retain Control error codes. For an unconfirmed write outcome, require a retry with the original arguments and idempotency key.

## Conformance verification

- Control API base cases cover concurrent creation, CAS editing, replay with the same key, and retries after a lost response. Creation replay pins Flow identity but may return current metadata. Draft change replay pins the committed Revision.
- `controlRecoveryConformanceCases` also requires a `restart()` driver. Close the deployment service, discard in-memory state, preserve storage, and reopen the service. Flow identity, Draft head, and change receipts must survive. This does not test recovery from unknown execution after a killed process; that requires deployment runtime fault injection.
- `mcpConformanceCases` sends real `/v1/mcp` requests to check discovery, structure, and annotations. It verifies consistency between MCP writes, retries, errors, and REST reads.
- `verifyWorkbenchHost` uses deployment-provided connection, fault, notification, and time drivers. It verifies that initial failure cannot block loading indefinitely, recovery triggers a reread, a normal first connection only completes ready, no events arrive after stop, and repeated stop is supported.

A deployment may claim a package profile only after all applicable cases pass. Unrun tests, missing test doubles, or a skipped recovery driver do not verify those guarantees. Deployment integration tests still own identity isolation, remote gateways, and recovery on real infrastructure.

Optional response fields may be added if existing read semantics remain unchanged. Removing or renaming fields, changing types, narrowing valid inputs, changing defaults, or changing execution results are compatibility changes.

## Release baselines and contract versioning

Evaluate the cumulative changes since the latest published artifact on the affected release line.
The previous commit, feature, or development snapshot is not a new compatibility baseline. Check
each affected contract independently: a package version change does not require every contract
version to change, and an existing pending contract revision may already cover the new work.

Confirm publication using the npm artifact or published deployment release, then identify its source
commit and contract identifiers. A version in `package.json`, a release commit, a Git tag, or an
"unreleased" heading alone does not establish whether an artifact was published. If publication
cannot be established, report the uncertainty before deciding to reuse or increment an identifier.
Published beta and other prerelease artifacts establish the same boundary as stable releases.

For each affected contract:

- Preserve its identifier when the cumulative changes are compatible with the published baseline.
- Allocate the next contract revision when the cumulative changes require an incompatible contract
  or an explicit capability rejection boundary. Include the migration, rejection, and deployment
  requirements relative to the published baseline.
- Reuse that pending revision for additional changes until it is published. Update its specification,
  consumers, tests, and release notes to describe the combined result. Do not add another revision
  merely because a second feature changes the same unpublished contract.
- Once the artifact is published, its identifiers and meanings are fixed. Further incompatible
  changes require another revision. Release notes alone do not make incompatible meanings safe to
  accept under the same identifier.

For example, if Engine v5 is published and Engine v6 is pending, several execution changes may ship
together as v6. A later incompatible change requires v7 only after v6 has been published. Development
snapshots do not require compatibility aliases or migrations unless support for those snapshots was
explicitly agreed. Existing support obligations for older published releases still apply.

Runtime digests continue to identify the actual isolation protocol and environment; update them when
those inputs change. Database migrations retain their storage upgrade rules. Neither is a per-feature
contract counter, and sharing a pending contract revision does not permit ignoring a runtime mismatch
or changing a migration already applied to a supported deployment.

## Wait local execution upgrade

An earlier beta upgraded the public package, Command, and Server together for Wait local execution. It used Engine v3 and checkpoint version 3. Control API retained the /v1 envelope, required a waits array in detail responses, added wait.created, and changed run.waiting to waitIds. These were explicit beta breaks requiring clients and deployments to upgrade together. SQLite migration 18 separated run_checkpoints from wait_receipts and changed Agent notification work keys to runId/waitId.

Old checkpoint bytes remain available for recovery validation. The current Engine does not execute them and marks them indeterminate. Do not automatically replay or rewrite old Revisions. Before release, finish or cancel old active Runs, or retain their matching execution environment. That work verified only local fixtures; it did not read or upgrade any deployed database.

## Execution semantics and isolated runtime identity

`engineContract` identifies the public execution contract. `engineDigest` retains its existing name and identifies the deployment’s isolated runtime and host capabilities. Server computes `isolatedVmEngineDigest` from the isolated executor protocol, isolated-vm/Node versions, Web globals, and Action host capability versions. It excludes Scheduler rules such as Wait, branch joins, and input sources. Graph rule changes alone do not change this digest. Checkpoints have their own format version and state consistency checks; the runtime digest cannot replace them.

Engine v4 separated execution scheduling from input sources. A node is skipped only when its execution branch is closed. Missing inputs and ordinary data outputs receive `null` and are then validated against port declarations. An actual `null` remains an available source. That release directly replaced v3 without an old execution contract or Run migration. The public package, Command, Server, and clients upgraded together. Checkpoint version 4 recovery used v4 semantics and required complete normalized outputs.

Removing historical graph semantics labels from the digest previously changed isolated runtime identity once. Runs pinned to the old digest use the existing mismatch rejection path. Historical Run identities are not rewritten, and old identity aliases are not added. Subsequent Scheduler-only changes do not change the isolated runtime digest.

The Trigger output protocol uses ordered output definitions. Provider definitionVersion and Webhook revision are 2, and the definition digest protocol version is 2. That upgrade used Scheduler checkpoint version 4. The current version is 6 and rejects recovery from older versions. SQLite migration 19 only renames output storage columns; it does not convert old content to the new contract.

## Unreleased Wait pending revision

That earlier change retained Engine Contract `open-flow-engine/v5` and Scheduler checkpoint version 5. The early Wait output port and output field in wait records change directly from `notification` to `pending`. They fire once when the wait is created and provide confirmation links and related data. This is an unreleased contract revision. Equal version numbers do not guarantee compatibility with earlier development snapshots. There are no old-name aliases, implicit conversions, or compatible recovery.

Graph validation rejects old Wait ports and data references. Strict decoding rejects the old `notification` field in checkpoint wait records instead of silently discarding it or replaying notifications. Historical Revisions and Runs remain unchanged, as do Flow model, Control API envelopes, and the isolated runtime digest. Agent notification configuration still represents actual notifications and is unaffected.

## beta.39 MCP and CLI read contract upgrade

The public package and Command upgraded to `0.1.0-beta.39`; Server upgraded to `0.1.0-beta.16`. This beta includes explicit tool and command breaks. Client scripts and deployments must upgrade together:

- Agent interfaces use `flow_read/search/schema/edit/check`; the CLI uses `read/search/schema/edit/check`. Legacy flow_get/flow_node_get/flow_apply and low-level CLI authoring commands leave the public interface. Workbench retains its low-level Revision/ChangeOperation contract.
- MCP renames `connector_list` to `connector_providers` and `trigger_list` to `trigger_search`, which accepts an optional query. CLI renames `connector list` to `connector providers`. Old names have no aliases.
- Connector search returns only Action summaries. Use `connector_get` / `connector show` for full schemas. The Team directory no longer returns Flow-Team bindings.
- CLI rejects `connector set --name`; use `node set --name`. Result list/read commands replace old positional arguments with named options such as `--after`, `--pointer`, and `--offset`.
- MCP `flow_run` declares Draft and Live identities mutually exclusive in its input schema. Invocation validation rejects mixed fields.

See the [CLI invocation contract](../../distribution/command.md#cli-invocation-contract) and [MCP interface](../../server/mcp.md) for parameters and updated usage. This release does not change the Flow persistence model, Engine Contract, or Run checkpoint format.

## beta.47 CLI and MCP precise-read alignment

The public package and Command upgraded together to `0.1.0-beta.47`. CLI `node show` adds `--revision` and `--subflow`; `connector code-access` adds `--publication`; `connector candidates` supports multiple Providers.

This prerelease has two CLI JSON breaks: `trigger search` renames `definitions` to `keys`; `node show` moves `nodeId`, `node`, `task?`, and `module?` from the old `node` wrapper to the result root. Old fields and nesting have no aliases. Consumers must update read paths using the [CLI result contract](../../distribution/command.md#output-and-errors). MCP tool contracts, Flow model, and Engine Contract remain unchanged.

## Flow-wide Trigger control

Individual Trigger pause/resume routes, client methods and the `TriggerBinding.operatorState`
field are removed. Use Flow enable/disable with the observed Live publication ID. Live details and
Trigger queries retain configuration, runtime health, endpoints and activity history.

Migration 0046 disables a Flow if any binding in its current Live publication was individually
paused, then removes the per-Trigger state columns. Paused retired or older-publication bindings do
not disable the current Flow. Existing disabled Flows stay disabled. Explicitly enabling an affected
Flow restores admission through all current Triggers. Checkpoints, deduplication, subscriptions and
historical activity records remain intact; old `operator.paused` / `operator.resumed` activity entries
remain readable but are no longer generated. Deploy this change with a server restart.

## Command npm entry

Hosts now import `runOpenFlowCommand` and `OpenFlowCommandHost` from
`@oomol-lab/open-flow/command` and bundle them into their own executable. Version
`0.1.0-beta.61` ships this entry with the skill templates in one npm package.
Command Artifact archives, manifests, release records and the OSS publication
workflow are removed. Hosts must replace their artifact download/cache loader
with the npm import; arguments, host callbacks and CLI exit codes remain unchanged.

### Unreleased dependency joins

That earlier change retained Engine Contract `open-flow-engine/v5` and Scheduler checkpoint version 5. Invocations now wait for their iteration's selected or skipped predecessors, merge selected ancestor data, and repeat through loop iterations. Checkpoints require dependency progress and loop state; earlier development shapes are rejected without conversion. `context.getPrevious()` now returns an array, including for a single predecessor, and an empty array for roots. No legacy API or scheduling mode is retained. Flow model and isolated runtime digest are unchanged.

## Workflow calls

The managed `workflow` executor adds independent Live Run invocation without restoring embedded Subflows or historical publication admission. Existing Flow model and Engine identifiers are retained for this unpublished addition. Checkpoint v5 accepts optional pending `calls`; existing Wait/Agent checkpoints remain readable. Control API version 1 adds the call contract, indexed Flow references, durable caller/callee projections and entry `triggerNodeId` for Draft and ordinary Start runs. Missing `calledFlowIds` in old resource summaries means no workflow-call references; no historical graphs are rescanned to seed this new relation kind.

Run details add optional `initiator` audit metadata without changing `source: draft | live`, Run
request versions, or existing `caller/calls` associations. Older Runs and deployments may omit it.
Server migration 50 adds nullable audit columns without backfilling inferred identities or channels.

## Connector-owned shared event source protocols

Shared source protocol code and its Provider regression tests move from Open Flow to Connector.
The public event-source entry now exposes metadata, the source operation contract and generic state
projection helpers. Provider-specific `feishuApplication`, `receiveFeishuEvent`, `matchesFeishuEvent`
and `feishuSubscriptions` exports are removed. Consumers use the Connector source protocol instead.
Deploy the supporting Connector before Open Flow; no local protocol fallback is retained. Source
instances retain their IDs and acquire stored projections through Connector without rewriting bindings.

The npm publication baseline checked for this change is `0.1.0-beta.68` at
`ae0f847fde9b8b5feb96822c763ea563f456f069`, whose Engine contract is v5. The branch already carries
pending Engine v6 changes. This refactor preserves node snapshots, output contracts and Run semantics;
it does not allocate another Engine revision. Package consumers of the removed protocol helpers and
Connector deployments must upgrade together at the new package boundary.

## Unreleased Wait automatic continuation

The npm `next` baseline verified for this change is `0.1.0-beta.69`, published from
`026f74f27383188f3f771352e10e7a84bca89550`, with Engine v6. Reuse the branch's pending
Engine v7 for optional Wait automatic continuation; v6 rejects this configuration. Flow model 10,
checkpoint 6 and Control API envelopes retain their identifiers. New response and event metadata
are optional, and historical records are not backfilled with inferred decision sources.

Server migration 53 adds nullable automatic deadlines and decision sources plus a pending-deadline
index. Existing waits remain manual. The isolated host capability digest includes
`wait-auto-continue/1`; v6 retains support for its published runtime digest. Upgrade Server and the
public package together and restart Server to apply the migration.

Wait absolute-time configuration also accepts optional `timezone` editor metadata. It is preserved
through public read/update and encoding. Existing absolute timestamps remain valid and authoritative;
missing timezone metadata defaults only the editor presentation to the browser timezone. This
addition reuses the pending Engine v7 revision and adds no storage migration.

Draft timing retains invalid configuration: `durationMs: null` represents an empty duration, and
`at` can retain empty or invalid date text. Draft decoding and edit operations preserve it; graph
validation blocks publication and execution until corrected. Public authoring inputs still require
valid timing. This draft editing refinement also reuses the pending Engine v7 revision.
