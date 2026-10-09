# Public contracts and version evolution

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
| Flow model        | `modelVersion: 6`                                                 | Serialization of documents, modules, nodes, and ports.                                                     |
| Control API       | `/v1`; Run creation request `version: 2`, all others `version: 1` | Request fields, responses, error codes, CAS, and idempotency.                                              |
| Engine Contract   | `open-flow-engine/v5`                                             | Execution, Trigger, Task return, Wait, and cancellation semantics.                                         |
| MCP               | `2026-07-28`                                                      | Streamable HTTP negotiation; tool product semantics reuse Control API.                                     |

Equal or different version numbers do not establish compatibility. Older formats may also have used `modelVersion: 1`; do not accept content based only on this field. Decode the complete structure before semantic validation and execution. Reject execution of Revisions that do not match the current structure. Do not rewrite them or recompute their original digest on read. Create a new Revision through a separate, auditable migration or rebuild.

Before upgrading a deployment, finish or cancel active Runs on the old Engine, or explicitly retain a recovery environment that can execute the pinned old Engine. Public decoders provide no implicit model migration.

## Legacy Project data

The legacy Project schema and API are outside the current product contract and cannot be imported. If Server encounters an unsupported legacy schema, it stops startup and preserves the original database. Startup must not implicitly rebuild or delete data.

## Decoding boundaries

`@oomol-lab/open-flow/flow-encoding` provides:

- `decodeFlowDocument(value)`: structurally decodes a complete Flow document.
- `decodeRevisionContent(value)`: decodes `{ modelVersion, document, modules }`.
- `decodeRevision(bytes)`: strictly decodes UTF-8, JSON, the envelope, and content. It pairs with `encodeRevision`.

Decoders ignore and remove undeclared fields from ordinary objects. Wait nodes use strict field validation and reject legacy inline notifications. All three functions validate known field types, required fields, and supported versions. `maxJsonDepth` limits nesting depth. Custom keys in JSON values and JSON Schema remain unchanged.

A valid structure does not establish that the graph can execute. Flow validation checks references, titles, cycles, ports, and module semantics. Decoding does not fill missing fields, migrate old nodes, or normalize user source code. `encodeRevision(decodeRevision(bytes))` produces canonical bytes. Bytes remain identical only if the input was already canonical and contained no unknown fields.

`@oomol-lab/open-flow/control-requests` provides `controlRequests` decoders and `controlRequestSchema`. They cover Flow creation and renaming, Draft changes, Live enable/disable, Presentation, checks, publication, rollback, Draft/Live Runs, Wait resolution, Variable writes, and version-only requests. Deployments map decoding exceptions to the corresponding public invalid errors. Deployments still own HTTP body limits, identity, scope, permissions, route parameters, pagination cursors, and storage transactions.

`@oomol-lab/open-flow/mcp` provides tool parameters, descriptions, annotations, protocol versions, and service instructions. Deployments register `mcpTools` through Standard Schema and implement only operation invocation, identity, and error mapping. A deployment must not add parameter defaults, change the definition of a tool with the same name, or weaken request validation. Business errors retain Control error codes. For an unconfirmed write outcome, require a retry with the original arguments and idempotency key.

## Conformance verification

- Control API base cases cover concurrent creation, CAS editing, replay with the same key, and retries after a lost response. Creation replay pins Flow identity but may return current metadata. Draft change replay pins the committed Revision.
- `controlRecoveryConformanceCases` also requires a `restart()` driver. Close the deployment service, discard in-memory state, preserve storage, and reopen the service. Flow identity, Draft head, and change receipts must survive. This does not test recovery from unknown execution after a killed process; that requires deployment runtime fault injection.
- `mcpConformanceCases` sends real `/v1/mcp` requests to check discovery, structure, and annotations. It verifies consistency between MCP writes, retries, errors, and REST reads.
- `verifyWorkbenchHost` uses deployment-provided connection, fault, notification, and time drivers. It verifies that initial failure cannot block loading indefinitely, recovery triggers a reread, a normal first connection only completes ready, no events arrive after stop, and repeated stop is supported.

A deployment may claim a package profile only after all applicable cases pass. Unrun tests, missing test doubles, or a skipped recovery driver do not verify those guarantees. Deployment integration tests still own identity isolation, remote gateways, and recovery on real infrastructure.

Optional response fields may be added if existing read semantics remain unchanged. Removing or renaming fields, changing types, narrowing valid inputs, changing defaults, or changing execution results are compatibility changes.

For a compatibility change, increment the affected contract version or declare the break in prerelease notes and provide migration and rejection paths. Do not only increment the npm version while retaining an old contract identifier and silently accepting data with different meanings.

## Wait local execution upgrade

An earlier beta upgraded the public package, Command, and Server together for Wait local execution. It used Engine v3 and checkpoint version 3. Control API retained the /v1 envelope, required a waits array in detail responses, added wait.created, and changed run.waiting to waitIds. These were explicit beta breaks requiring clients and deployments to upgrade together. SQLite migration 18 separated run_checkpoints from wait_receipts and changed Agent notification work keys to runId/waitId.

Old checkpoint bytes remain available for recovery validation. The current Engine does not execute them and marks them indeterminate. Do not automatically replay or rewrite old Revisions. Before release, finish or cancel old active Runs, or retain their matching execution environment. That work verified only local fixtures; it did not read or upgrade any deployed database.

## Execution semantics and isolated runtime identity

`engineContract` identifies the public execution contract. `engineDigest` retains its existing name and identifies the deployment’s isolated runtime and host capabilities. Server computes `isolatedVmEngineDigest` from the isolated executor protocol, isolated-vm/Node versions, Web globals, and Action host capability versions. It excludes Scheduler rules such as Wait, branch joins, and input sources. Graph rule changes alone do not change this digest. Checkpoints have their own format version and state consistency checks; the runtime digest cannot replace them.

Engine v4 separated execution scheduling from input sources. A node is skipped only when its execution branch is closed. Missing inputs and ordinary data outputs receive `null` and are then validated against port declarations. An actual `null` remains an available source. That release directly replaced v3 without an old execution contract or Run migration. The public package, Command, Server, and clients upgraded together. Checkpoint version 4 recovery used v4 semantics and required complete normalized outputs.

Removing historical graph semantics labels from the digest previously changed isolated runtime identity once. Runs pinned to the old digest use the existing mismatch rejection path. Historical Run identities are not rewritten, and old identity aliases are not added. Subsequent Scheduler-only changes do not change the isolated runtime digest.

The Trigger output protocol uses ordered output definitions. Provider definitionVersion and Webhook revision are 2, and the definition digest protocol version is 2. That upgrade used Scheduler checkpoint version 4. The current version is 5 and rejects recovery from older versions. SQLite migration 19 only renames output storage columns; it does not convert old content to the new contract.

## Unreleased Wait pending revision

The current Engine Contract remains `open-flow-engine/v5`, and the Scheduler checkpoint remains version 5. The early Wait output port and output field in wait records change directly from `notification` to `pending`. They fire once when the wait is created and provide confirmation links and related data. This is an unreleased contract revision. Equal version numbers do not guarantee compatibility with earlier development snapshots. There are no old-name aliases, implicit conversions, or compatible recovery.

Graph validation rejects old Wait ports and data references. Strict decoding rejects the old `notification` field in checkpoint wait records instead of silently discarding it or replaying notifications. Historical Revisions and Runs remain unchanged, as do Flow model, Control API envelopes, and the isolated runtime digest. Agent notification configuration still represents actual notifications and is unaffected.

## beta.39 MCP and CLI read contract upgrade

The public package and Command upgraded to `0.1.0-beta.39`; Server upgraded to `0.1.0-beta.16`. This beta includes explicit tool and command breaks. Client scripts and deployments must upgrade together:

- Agent interfaces use `flow_read/search/schema/edit/check`; the CLI uses `read/search/schema/edit/check`. Legacy flow_get/flow_node_get/flow_apply and low-level CLI authoring commands leave the public interface. Workbench retains its low-level Revision/ChangeOperation contract.
- MCP renames `connector_list` to `connector_providers` and `trigger_list` to `trigger_search`, which accepts an optional query. CLI renames `connector list` to `connector providers`. Old names have no aliases.
- Connector search returns only Action summaries. Use `connector_get` / `connector show` for full schemas. The Team directory no longer returns Flow-Team bindings.
- CLI rejects `connector set --name`; use `node set --name`. Result list/read commands replace old positional arguments with named options such as `--after`, `--pointer`, and `--offset`.
- MCP `flow_run` declares Draft and Live identities mutually exclusive in its input schema. Invocation validation rejects mixed fields.

See the [CLI invocation contract](../../distribution/command-artifact.md#cli-invocation-contract) and [MCP interface](../../server/mcp.md) for parameters and updated usage. This release does not change the Flow persistence model, Engine Contract, or Run checkpoint format.

## beta.47 CLI and MCP precise-read alignment

The public package and Command upgraded together to `0.1.0-beta.47`. CLI `node show` adds `--revision` and `--subflow`; `connector code-access` adds `--publication`; `connector candidates` supports multiple Providers.

This prerelease has two CLI JSON breaks: `trigger search` renames `definitions` to `keys`; `node show` moves `nodeId`, `node`, `task?`, and `module?` from the old `node` wrapper to the result root. Old fields and nesting have no aliases. Consumers must update read paths using the [CLI result contract](../../distribution/command-artifact.md#output-and-errors). MCP tool contracts, Flow model, and Engine Contract remain unchanged.
