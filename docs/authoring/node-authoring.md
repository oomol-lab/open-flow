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
