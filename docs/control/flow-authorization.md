# Flow authorization model

A Flow stores how it uses connections. The deployment resolves and fixes authorization identities.
Connector manages account credentials and checks upstream permissions.
Selecting a `connectionId` specifies an account, but permission to call it also depends on the consumer's declared scope, fixed authorization identity, and current upstream permissions.

This document explains data relationships, call scopes, and lifecycle behavior.
[Architecture](../architecture.md) defines product boundaries.
The [Control API contract](contracts/control-api.md#provider-access-binding) defines fields, HTTP interfaces, errors, and concurrency protocols.
This document covers Flow authorization to use Connector, not Server login, Operator sessions, or public Wait URL authentication.

## 1. Three data layers

| Layer                            | Data                                                                                    | Owner and purpose                                                                   | Stored with the Revision                              |
| -------------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Connection use declaration       | Node or Task `connectionId`, Code shared/independent mode, and independent Action lists | Flow authors declare which consumers use which accounts and operations              | Yes                                                   |
| Shared access configuration      | `ConnectorAccess`, whose `bindings` is the shared Code allowlist                        | The deployment maintains editable shared selections and their configuration version | No                                                    |
| Execution authorization snapshot | `ConnectorAccessSnapshot`, with `sharedBindings` and `selectedBindings`                 | Publication or Run admission fixes identities for execution and background recovery | No; persisted with the corresponding execution record |

The same account can appear in shared configuration and node declarations. These uses are independent.
Selecting an account in an ordinary node does not grant it to shared Code.
Removing it from the shared list does not clear the ordinary node's selection.

### Connection use declarations

Connector Task executors, fixed Agent tools, Triggers, and independent Code Actions store `connectionId` directly in their declarations.
Agent inline notifications obtain a fixed Action and account through the referenced Connector Task.
Triggers no longer look up accounts indirectly through a Flow binding table.

`FlowDocument.bindings` stores only Variable references, such as the name `TOKEN`, not account authorization or variable values.
It is distinct from the Provider Access Binding described below.

New Code Tasks use shared mode by default. Independent mode stores an Action list and each Action's account in the capability.
These declarations constrain script calls but do not replace Connector authorization.
See the [Code Action contract](contracts/control-api.md#10-code-action-contract) for serialization.

### Shared access configuration: ConnectorAccess

`ConnectorAccess` is editable configuration with current structure version `1`:

- `bindings`: authorization selections available to shared Code throughout the Flow.
- `accessRevision`: the shared configuration's concurrency version. Writes submit `expectedAccessRevision` to prevent overwriting other changes.
- `sharedAccessDigest`: a deterministic digest of shared selections, used for change detection, publication state, and request identity.
- `providerIds`: explicitly added services. A service can have no selected account. Adding it does not grant permission.
- `mode`: the deployment's `implicit` or `selectable` authorization mode.

Entries can include names, status, and `policyRevision`.
Damaged historical entries can be projected as `invalid`, or `discardedBindingCount` can indicate that configuration is required.
Keeping display information does not mean that the entry remains executable.

`sharedAccessDigest` hashes only sorted `[providerId, accessBindingId]` shared selections.
It excludes node accounts, service display lists, names, and current upstream permissions.

Equal digests indicate equal shared selections. They do not prove equal execution permissions for two Flows or unchanged upstream permissions.

### Execution snapshot: ConnectorAccessSnapshot

The current snapshot structure version is `2`. It fixes `mode`, `sharedAccessDigest`, and two required authorization sets:

| Field              | Source                                                                       | Purpose                                                                               |
| ------------------ | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `sharedBindings`   | Active identities in shared configuration at admission                       | Shared Code calls                                                                     |
| `selectedBindings` | Assignable identities resolved from explicit account uses in the fixed graph | Checks for ordinary nodes, independent Code, Agent tools, notifications, and Triggers |

Each `ConnectorAccessGrant` stores account, Provider, authorization identity, source, and names for historical display.
It does not store credentials, raw permission rules, configuration versions, or current status.
`accessRevision`, `providerIds`, `status`, and `policyRevision` are not part of the execution snapshot.

`selectedBindings` deduplicates by authorization identity, not by nodeId.
Multiple nodes can reference one identity. Fixed declarations and call context constrain which node can call each Action.
Both sets must exist explicitly. The runtime must not interpret a missing `selectedBindings` as permission to use the shared list or treat editable configuration as an execution snapshot.

## 2. Authorization identities and deployment modes

### What a Provider Access Binding identifies

An authorization identity includes `accessBindingId`, `connectionId`, `providerId`, and an explicit `source`:

| source                               | Meaning                  |
| ------------------------------------ | ------------------------ |
| `{ kind: 'admin-delegation' }`       | Administrator delegation |
| `{ kind: 'policy', ruleId: null }`   | Team default grant       |
| `{ kind: 'policy', ruleId: string }` | A specific named rule    |

`ruleId: null` explicitly selects the default grant; it does not mean an unknown source.
If a named rule is deleted, execution cannot fall back to the default grant or another authorization source.
Identity encoding includes Team, account, Provider, and source. It excludes rule names, rule content, and policy revisions.
The public contract defines the exact encoding.

The client submits a candidate ID. The deployment checks whether it is assignable, then saves the complete identity.
Workbench does not parse permission rules, receive account credentials, or gain authorization through a self-reported source.

The deployment separately checks whether a user can assign an authorization to a Flow and whether a fixed authorization can execute now.
Do not assume that every later call repeats the candidate assignment process.

### implicit and selectable

| Mode         | Authorization source                                                   | Snapshot representation                                                            |
| ------------ | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `implicit`   | The deployment's configured scoped Connector authority                 | Both sets are empty; no fabricated Provider Access Binding                         |
| `selectable` | Assignable account authorization candidates provided by the deployment | Fix the selected identities and resolve current permissions from them at execution |

The open-source Server uses `implicit` for OpenConnector and `selectable` for supported OOMOL Connector endpoints.
Empty sets in `implicit` mode mean neither deny-all nor unlimited permission.
Calls remain subject to consumer declarations, account validity, and the deployment's Connector identity permissions.
The host selects the deployment mode. A Flow or script cannot switch it.

An Action that Connector explicitly declares does not require account authorization can omit an account grant.
It must still satisfy its call scope and any platform identity required by the deployment.
An ordinary authenticated Action cannot use this exception to omit connection configuration or borrow another node's account.

### OOMOL Team scope

When Server uses OOMOL-hosted Connector, Operator must select a specific Team when creating a Flow.
Server saves it as immutable Flow metadata in the creation operation.

Selecting the default Team still fixes that Team's current identity; it does not follow later account defaults.
Nodes cannot override Team. An existing Flow cannot change Team in place. Create a new Flow to use another Team.

Catalog and account queries resolve Team through the Flow. Run admission fixes it in the Run record.
Poll and Integration use their Flow's Team. Runtime Connector requests explicitly carry this scope instead of reading a mutable deployment-wide Team.
The deployment host extends Flow creation with Team selection. Product-neutral Workbench does not own this external identity configuration.
Self-hosted and custom Connectors do not show OOMOL Team selection or implicitly query OOMOL membership services.

Connector adapters must state how upstream execution identity is fixed.
Resolving a stable ID to a local alias does not prove that upstream execution is atomic by stable ID.
Aliases are not authorization evidence. Catalog renames do not modify old Revisions.

## 3. Constraining individual calls

The host builds `ConnectorAccessContext` from fixed Revision declarations. Scripts cannot construct or expand it.

| Consumer or phase                                                      | scope      | Authorization and limits                                                                      |
| ---------------------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------- |
| Catalog, candidate, and configuration queries during editing           | `catalog`  | Operator configuration context; not a Run execution snapshot                                  |
| Explicit connection eligibility checks at publication or Run admission | `selected` | Check the fixed explicit selections; this scope cannot execute Actions or runtime proxy calls |
| Shared Code                                                            | `shared`   | Use currently permitted Actions for accounts in `sharedBindings`; no node-level Action list   |
| Connector nodes, fixed Agent tools, notifications, independent Code    | `action`   | Fix the Action and Connection, then resolve matching authorization from `selectedBindings`    |
| Runtime Trigger requests such as Poll and Integration                  | `trigger`  | Fix Trigger ID, Provider, and Connection; check Trigger permissions                           |

Shared Code calls only its permitted accounts. An omitted account follows the shared-call single-account or default-account rules.
It cannot borrow an account from `selectedBindings`.
Independent Code must first pass its own Action list check, then use the fixed account from that list.
Ordinary nodes cannot switch accounts merely because another account appears in the snapshot.
Aliases, default accounts, and typing hints in old Code capabilities are not allowlists. The Code Action contract defines their compatibility behavior.

Runtime checks follow this sequence:

1. The host confirms that the call belongs to the current declaration and invocation, including the Action and Connection match.
2. In `selectable` mode, it resolves the fixed identity in the relevant set and checks identity, Provider, account, and source consistency.
3. It checks account status and current Action, Trigger, or proxy permission. Connector then executes with the actual deployment identity.

A snapshot fixes the accepted authorization identity, not external permissions.
Upstream revocation, deleted rules, or invalid accounts can still fail later calls in published Flows or accepted Runs.
Permission resolution can use deployment caching and refresh rules. A current permission check does not imply an uncached upstream read on every call.

Catalog reads during editing are not filtered by the Flow's selected authorizations.
Visible Action definitions, connection display information, or candidate permission summaries do not grant execution permission.
Trigger option queries bind a registered Trigger ID in `catalog` context. Runtime calls use `trigger` scope.
Both submit operations through `/v1/providers/:service/triggers/:triggerId/execute`.

A self-hosted Open Flow context constrains only its own scripts. Connector uses the same Token authorization as Action execute:

- User/service accounts query current app-access and cannot self-report accessGrant.
- Deployments use team-token with Team permissions. An optional grant only narrows the current call.

Connector constructs third-party requests and stores remote resource IDs. The connector worker cleans up resources after revocation.
See [Trigger permissions and execution](trigger-permissions.md) for interfaces and upgrade contracts.

### Example: two accounts cannot borrow authority

An ordinary mail node declares account A. Shared Code configuration selects only account B.
The publication snapshot puts A's authorization in `selectedBindings` and B's in `sharedBindings`.

- The mail node can use A only for its declared Action. It cannot switch to B.
- Shared Code can use B's currently authorized Actions. It cannot use A just because A appears in the same Flow.
- Adding independent Code that declares an Action using A requires an admission check for that operation. Execution still cannot switch to another Action or account.

## 4. Editing, publication, and recovery

| Operation                                 | Authorization source                                                                            | Effect on existing records                                               |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Edit a node account or Code mode          | Change the Draft Revision declaration                                                           | No change to existing Publications or Runs                               |
| Edit shared access configuration          | Update deployment-owned `ConnectorAccess`                                                       | Do not rewrite Revisions or replace execution snapshots                  |
| Draft test Run                            | Capture from the fixed Draft execution graph and shared configuration; perform admission checks | Save a fixed snapshot on acceptance                                      |
| Publish                                   | Fix Revision, shared selections, and resolved identities in the publish operation               | Publication stores the snapshot on success; failure does not switch Live |
| Live/Trigger Run                          | Use the corresponding published version's snapshot                                              | Do not expand permission from current Draft shared configuration         |
| Rollback                                  | Copy the source Publication's snapshot and perform publication checks                           | Create a new Publication without modifying the source                    |
| Recover a Run or background work          | Read the snapshot fixed in the owning record                                                    | Do not reselect current defaults or recapture Draft authorization        |
| Upstream revocation or connection failure | Deployment and Connector permission checks                                                      | Can invalidate authorization referenced by existing snapshots            |

Run, Publication, publication preparation work, and subscription lifecycle owners persist the snapshots they need.
Notification recovery uses its Run's fixed context. Do not create another source of current Flow permissions for background work.

Removing an account from the connection-usage overview is a Draft operation across two layers.
One transaction checks graph Revision and `accessRevision`, clears node account selections, and removes the account from shared configuration.
Independent Code keeps its Actions and clears accounts. Nodes, code, inputs, and edges remain.
The operation does not delete the upstream account, revoke OAuth, or change other Flows or accepted execution records.
An incomplete Draft can remain. A removed account is not automatically reselected because it is still the default connection.

The connection-usage overview groups node, independent Code Action, and shared Code uses by account.
New nodes can select a default connection suitable for their Action. This differs from reconfiguring after removal:
refresh must not fill a cleared selection automatically.
Missing connections do not block Draft editing. Publication, Run admission, and actual calls still check eligibility.
Before physical Flow deletion, the deployment's access configuration owner must remove its shared configuration records.

## 5. Persistence and legacy data upgrades

Flow model, shared configuration, execution snapshot, and SQLite schema versions are separate version axes.
The current Flow model is `4`, `ConnectorAccess.version` is `1`, and `ConnectorAccessSnapshot.version` is `2`.

Migration 0027 cleared old Draft `flow_provider_access` once while preserving graphs, Publications, Runs, and background snapshots.
Restarting does not clear newly configured data again.

Server structural migration 0030 renames old digest columns, converts permission snapshots, and updates defaults in the startup transaction.
It supports old schemas and development databases rebuilt with the new schema.
Conversion failure rolls back the transaction. Do not leave partially upgraded structures, edit already-applied historical SQL, or reset version numbers to upgrade a database.

Legacy snapshot conversion rules:

- Active `bindings` entries become `sharedBindings`. Active `nodeBindings` entries become `selectedBindings`.
- For older snapshots without `nodeBindings`, active entries from the old shared candidates become fixed explicit selections. This occurs only at migration, not as a runtime authorization default.
- Converted grants must pass the new snapshot decoder. The migration does not guess the source of damaged active identities.
- Both sets in `implicit` snapshots remain empty. Snapshots already in the new structure are still validated against the new contract.

Structural migration does not rewrite historical Revision content, digests, or references.
The existing upgrade operation creates a new Revision for an old Draft: resolve Trigger connection bindings into direct `connectionId`, preserve Variable references, then check and publish again.
Unresolvable account references require configuration. They are not replaced by default accounts.

Preserving historical publication and Run records does not mean that the new model can resume old execution.
Handle active old-model Runs and external subscriptions before upgrading. Structural migration does not keep old tasks executable.
Interpret historical `nodeBindings` and Trigger `bindingId` through these upgrade rules; do not restore them to the new model.

## 6. Code entry points

| Responsibility                                              | Code entry                                                                                                                                                                                    |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public configuration, candidate, grant, and snapshot types  | [control/common/api.ts](../../packages/open-flow/src/control/common/api.ts)                                                                                                                   |
| Configuration and snapshot decoding                         | [connectorDecoders.ts](../../packages/open-flow/src/control/common/connectorDecoders.ts)                                                                                                      |
| Collect connection use from declarations                    | [connectionUsage.ts](../../packages/open-flow/src/flow/common/connectionUsage.ts)                                                                                                             |
| Shared configuration storage and admission snapshot capture | [connector-access.ts](../../apps/server/node/deployment/connector-access.ts)                                                                                                                  |
| Call scope and Action/Trigger/proxy checks                  | [connector.ts](../../apps/server/node/deployment/connector.ts)                                                                                                                                |
| Candidate and upstream identity resolution                  | [provider-access.ts](../../apps/server/node/deployment/provider-access.ts)                                                                                                                    |
| Publication, Draft Run, and execution contexts              | [publication.ts](../../apps/server/node/application/publication.ts), [run-control.ts](../../apps/server/node/application/run-control.ts), [run.ts](../../apps/server/node/application/run.ts) |
| Legacy database structural migration                        | [migrate-connector-access.ts](../../apps/server/node/storage/migrate-connector-access.ts)                                                                                                     |
| Legacy Draft upgrade                                        | [changeSchema.ts](../../packages/open-flow/src/flow/common/changeSchema.ts)                                                                                                                   |

When adding a connection consumer, store its account selection in its own declaration.
Include it in connection-use collection and admission checks. Let the host create the appropriate per-call scope.
Do not expose the entire graph's `selectedBindings` as executable authority or let clients and scripts specify a trusted authorization source.
