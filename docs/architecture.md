# Product and architecture boundaries

This document defines Open Flow's system boundaries, sources of truth, module ownership, and cross-module invariants.
[Technical references](#5-technical-references-and-document-ownership) own exact fields, limits, interface behavior, and deployment procedures.

## 1. System boundaries and source ownership

Open Flow consists of one public product contract and independent deployment implementations.
Workbench, CLI, and MCP clients operate on one selected deployment. That deployment owns persistence, authorization, publication, and execution.
Clients must not create a second source of truth or silently fall back to another deployment.

```text
Workbench ── Control API ─┐
CLI ──────── Control API ─┼── Deployment application services ── Persistence, execution, and external capabilities
MCP client ── MCP adapter ┘
```

Control API and MCP adapters share deployment application services. They use the same identity checks, edit compiler, idempotent admission, and lifecycle.
Protocol adapters must not create a second authoring or Run state machine.

| Owner                | Responsibility                                                                                                                                                                      |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/open-flow` | Public models and decoding, node authoring, Control API and MCP contracts, deterministic validation and graph execution, conformance tests, product-neutral Workbench and shared UI |
| `packages/command`   | CLI arguments and output, the Command Host boundary, Command Artifact builds and distribution                                                                                       |
| `apps/server`        | Server lifecycle, authentication, persistence, scheduling, isolated execution host, HTTP/MCP adapters, Workbench host, and container delivery                                       |
| Other deployments    | Their infrastructure, authentication, application lifecycle, external capability mediation, and production Workbench host                                                           |

Cross-workspace and deployment integrations consume only public package entries. Deployments pin the public package version and run its conformance tests.
They must not maintain another editable copy through source copying, deep imports, or synchronization scripts.
Common code is independent of Browser and Node. Browser code is independent of Node.

### Nodes and Workbench

Node authoring separates business configuration, input sources, and internal definitions. Callers supply business choices and data contracts.
The public package assembles fixed ports, capability-derived definitions, and internal identities.
Read, edit, schema, search, and diagnostics use the same public view. Input sources follow each node's execution capabilities.
CLI, MCP, and deployments must not compensate for missing node conversions.

Workbench owns Flow editing and its product UI. The deployment host owns login, account roles, deployment settings, and browser analytics.
Hosts integrate through public props, shared UI, and product theme contracts. They must not override internal product selectors or copy Workbench implementations.
The host manages Variable values. Public Workbench consumes only variable name projections.
Self-hosted Server deployments do not send data to the official analytics project by default.

Provider, Action, Connection, and Trigger data each own fetching, caching, refresh, and invalidation. Consumers derive combined views.
Caches store complete responses by request identity. They must not merge responses into another source of business truth or couple independent data lifecycles.
Display profiles and catalog visibility during editing do not grant execution authority.

### Event sources

The public package owns event source definitions: provider identity, configuration and secret handling,
callback authentication and payloads, consumer matching, readiness, and resource subscription rules.
The Server owns source persistence, Connector authorization, shared subscription lifecycles, durable
receipt, deduplication, fixed delivery targets, and Run admission. Server storage and delivery code
consume the source definition rather than interpreting provider-specific configuration or state.

## 2. Core resources and sources of truth

### Flow, Revision, and Presentation

Flow is a deployment-generated top-level resource with a stable identity and independent lifecycle. It does not belong to a Project.
Each Flow has one mutable Draft head. Revisions are immutable execution definitions that store the graph, node configuration, variable references, and code.
Node identities do not change when names change. Each node owns its execution configuration. A local edit must not change other nodes' behavior.

Semantic changes commit atomically with an expected Revision and a stable request identity. They must not silently overwrite concurrent changes.
Idempotent replay returns an accepted result before checking the current Draft head. Clients synchronize through complete Revision snapshots.
Internal delta storage, indexes, resource projections, and caches cannot replace the Revision or become another authoring history.
Projections update consistently with their sources. Execution always uses the complete facts from a fixed version.

Presentation stores layout, viewport, comments, and other display state independently of the execution definition. It does not affect validation or execution.
Publication fixes the corresponding display snapshot. Rollback and historical views do not rewrite the Draft's display state.
Revisions do not store credentials, execution state, Engine IR, current Provider state, or deployment caches.

### Deployment configuration and execution snapshots

Variables are user-owned key/value configuration, independent of Flow Revisions. Each account manages its own names and values; administrator status grants no cross-account access. Flows resolve variable references using their owner, including background triggers and Agent snapshots.
Connector, LLM, and callback configuration belong to the deployment, not to Flow Revisions.
Flows store only the required references. The deployment resolves and validates configuration at the relevant operation boundary.
Configuration sources must be explicit. A configuration block must not mix sources or silently fall back to another source.
An operation already in progress keeps its fixed configuration. New configuration applies only to later operations.

Variable values are resolved and fixed for the actual execution scope. The platform must not implicitly write them into Revisions or public Run inputs and events.
User code can explicitly return, log, or send values into business data and external systems. Variables do not provide non-exportable secret protection.
Agent recovery uses the fixed variable values and model configuration. Model credentials remain private deployment data.

Shared connection access configuration is maintained independently of Revisions. Publications and Runs fix the required authorization identities and execution snapshots.
Later Draft or deployment configuration changes must not rewrite accepted execution facts. A fixed identity does not freeze upstream permissions.

### Notifications and persistent results

Realtime notifications only signal invalidation. Clients recover authoritative state through normal reads and must handle changes during initial subscription and reconnection.
Notifications do not act as Revisions, RunEvents, collaboration logs, or reliable message queues.
Flow catalog subscriptions and individual Flow subscriptions have independent lifecycles.

Run terminal results, Wait decisions, and complete Agent tool results are retained independently of event logs.
Log or preview truncation and expiry must not change execution results or destroy facts required for recovery.

## 3. Execution, publication, and lifecycle

### Validation and admission

The public package performs deterministic validation using a fixed Revision, model version, and Engine Contract.
It does not read current credentials, upstream permissions, or service state.
The deployment checks resource eligibility and permissions at the authoritative Run and Publish admission boundaries. Missing requirements reject the operation.
The deployment can add diagnostics for missing static capabilities. It must not put external service probes into Revisions or deterministic validation.

Draft tests validate and prepare only the execution scope reachable from the selected Trigger and its dependencies.
Full-graph checks and Publish validate the complete Flow.
Admission, execution, and recovery use the same fixed scope and version. Clients must not block an entry test because of full-graph diagnostics on unrelated branches.

The Engine Contract defines public execution semantics. The deployment owns the isolation environment, resource limits, and recovery coordination.
Recovery must validate the execution contract, runtime environment, and checkpoint compatibility. It must not guess or replay from damaged or incomplete state.

### Graph execution and side effects

Each Run starts at one Trigger. Execution edges determine node arrivals. Input mappings determine data sources. These are edited independently.
Each incoming edge arrival creates a separate invocation. A join does not implicitly wait for or combine predecessors.
Loops permit repeated arrivals within execution budgets. Each invocation uses the result snapshot from its triggering path. Parallel paths do not share mutable results.

An ordinary Task commits its result once, after the complete output passes validation.
Internal Run storage must not become a second data channel through which scripts can read arbitrary node results.
Node execution, events, and capability calls share cancellation and deadlines. Catching an ordinary business error cannot disable resource limits or termination requirements.

The deployment owns the Run's sole execution authority and terminal state. Admission fixes the version, execution scope, and runtime identity.
Retries must not duplicate accepted execution. If side-effect outcomes cannot be confirmed, execution ends as indeterminate and is not automatically replayed.
Cancellation and completion races must produce one authoritative terminal state.
The deployment limits concurrency and execution budgets and owns queuing and recovery. Clients must not take ownership of scheduling facts.

### Wait and Agent

Wait suspends a local branch within the same Run. The deployment persists the Wait before releasing its notification branch.
Unresolved action branches remain blocked while other ready work continues.
All decision entry points share one first-writer-wins fact. Repeated submissions neither overwrite the accepted decision nor resume execution again.

Freezing must save complete recovery state and the remaining budget. A race between freezing and a decision must not lose work.
Recovery preserves completed results, path snapshots, Waits, and Agent continuations. It must not repeat side effects that already occurred.
Execution and deployment references define process, session, checkpoint, and in-memory waiting policies.

An Agent's model and tool permissions come from the fixed node declaration. The model cannot change Actions, accounts, fixed parameters, or approval policies.
Framework continuations are private deployment recovery data. The same Run owner remains responsible for approval and Run state.
Temporary code computation does not modify the Revision. It can access only data explicitly supplied to the current invocation and does not automatically receive external business capabilities.
Complete tool results are persisted separately. Recovery must not repeat external tool calls to replace missing results.

### Publication and Trigger

A Publication represents only a fully successful publication. Live points to the current production version.
A publish operation can prepare external resources asynchronously. Only after all preparation succeeds can it atomically create the Publication, switch Live, and activate Trigger bindings.
The previous Live remains valid during preparation and after failure. Rollback creates a new Publication without changing historical versions.
Changes that cannot prepare independent candidate resources must be rejected. They must not damage live resources and rely on compensation to recover.

The Flow enable switch, Live version, and individual Trigger pause states are independent.
Disabling a Flow blocks new production admission but does not cancel accepted Runs.
Live and the current Trigger binding jointly determine admission authority. Old workers and candidate callbacks cannot bypass this boundary.

The public package owns deterministic Trigger definitions, output validation, and conformance tests.
The deployment owns progress, deduplication, scheduling, routing, and admission transactions.
A valid occurrence uses a stable identity to admit at most one ordinary Run. It then uses the same execution, cancellation, and terminal-state mechanisms.
Notification wakeups and scan progress are persisted separately. Progress advancement and page admission commit consistently.
A listener switch must prevent the old scope from submitting further work.
Callback cancellation does not revoke an accepted Run. Retrying an entire callback must not repeat external side effects.

Connector owns third-party Trigger request construction, credential use, and remote subscriptions. A self-hosted Open Flow deployment is an untrusted caller of Connector.
Open Flow consumes registered operations and opaque subscription identities. It retains responsibility for its own scheduling and event admission.

Flow Error delegates a production Run failure to a separate handler Flow without changing the source Run's failure.
Terminal state and dispatch intent are saved atomically. Dispatch is deduplicated and checks target eligibility again.
A handler failure does not recursively trigger more error handling.

### Deletion and maintenance

Flow deletion first blocks new mutations, Runs, publications, and Trigger admission.
One lifecycle owner then cleans up resources and physically deletes the Flow.
Failure recovery continues the same deletion process instead of creating a second cleanup state machine.
Completed deletion does not provide implicit recovery or authoring history.

Run expiry, Waits, notifications, and publication advancement each have a state owner that determines the next work.
The deployment schedules maintenance centrally. The scheduler must not reinterpret persisted state or block other due work while waiting for a publication.

## 4. Identity and capability boundaries

The deployment derives a stable resource scope from the authenticated principal.
Operator identity, Flow ownership, external execution authority, and callback identity cannot substitute for one another.
A scope change clears old sessions, requests, caches, and subscriptions.
Server-side authorization covers every resource entry point. Clients cannot change ownership through IDs or parameters.

In the open-source Server, the host owns accounts and administrative roles. Each Flow has a fixed account owner.
Administrator status does not expand visibility into other accounts' Flows. Administrative permissions are independent of upstream Connector permissions.
Claiming a deployment requires authorization held by its deployer. The first anonymous visitor must not become an administrator.
Login verification, session signing, and callback identity use separate secrets and lifecycles.

Connector owns connection credentials and upstream authorization. A Flow declares connection use, and the deployment fixes the caller identity and permitted scope.
Shared Code, consumers with explicitly selected accounts, and different nodes must not borrow one another's authority.
Revocation, identity mismatch, or connection failure rejects execution without falling back to another account.
Catalog visibility, name resolution, and display profiles are not authorization evidence.

User code receives only the narrow capabilities declared for its current invocation inside an isolated environment.
Builtin modules do not grant host storage, identity, or external access.
The host validates caller identity, scope, and current execution state. It revokes old capabilities when the node or Run ends.
Business calls and node executions have separate identities. External-call idempotency must not deduplicate an entire node as one call.

A public Wait capability authorizes only its specified Wait. It is not a deployment login.
Complete capabilities and private recovery data must not enter ordinary logs.
Flow-controlled HTTP responses must not execute content or change deployment security headers on the management origin.
A fully custom HTTP responder requires a separate origin.

## 5. Technical references and document ownership

Update this document only when a change affects system boundaries, sources of truth, module responsibilities, security boundaries, or cross-module invariants.
Do not maintain exact fields, numeric limits, usage examples, storage algorithms, or component layouts here.

| Content                                                                | Authoritative document or implementation                                                                                 |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Public models, interfaces, node configuration, and execution protocols | [Control API reference](control/contracts/control-api.md)                                                                |
| Versions and compatibility                                             | [Public contracts and version evolution](control/contracts/compatibility.md)                                             |
| Node-compatible execution environment                                  | [Node runtime contract](control/contracts/nodejs-runtime.md)                                                             |
| Connection use and execution authorization                             | [Flow authorization](control/flow-authorization.md), [Trigger permissions and execution](control/trigger-permissions.md) |
| Node development and verification                                      | [Node authoring](authoring/node-authoring.md), [CLI Lab](authoring/cli-lab.md)                                           |
| CLI delivery and invocation contracts                                  | [Command Artifact](distribution/command-artifact.md)                                                                     |
| Server configuration, authentication, and deployment                   | [Container delivery](server/container-delivery.md), [User system](server/users.md), [MCP](server/mcp.md)                 |
| Trigger usage                                                          | [Flow Error](triggers/error-trigger.md), [Linear Issue Trigger](triggers/linear-trigger.md)                              |
| Frontend integration and component interaction                         | [frontend-ui skill](../.agents/skills/frontend-ui/SKILL.md), production components, and Lab stories                      |

Migration code and compatibility notes define specific migration rules. Git history preserves implementation history and verification records.
