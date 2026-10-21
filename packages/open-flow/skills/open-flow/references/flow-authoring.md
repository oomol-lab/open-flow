# Build and operate Open Flow workflows

`<!-- agentic:var flowCommand -->` operates persistent workflows on the selected
Server. Commands with `--json` return machine-readable results. Help and local
schemas work offline; Flow data and provider discovery require the Server.

## The working model

A **Flow** has an editable **Draft**. Each saved change creates a **Revision**.
A **Run** executes a fixed version starting at a Trigger. A **Publication** makes
a Revision Live; enabling the Flow allows its automatic Triggers to execute.
Saving a Draft, running it, publishing it, and enabling it are separate actions.
Choose the actions covered by the user's request. A Run can have external effects.

Nodes describe business operations. **Execution edges** determine which nodes
run and in what order. **Input bindings** supply their data. A binding does not
create an execution edge. A Condition selects named execution branches; its
branch names are not output ports.

The authoring interface accepts business configuration, named inputs and source
text. It builds internal definitions, ports and Module identities for you.
`schema TYPE` supplies the current contract and a node example; `schema edit`
supplies the edit operations. Use these when a configuration is unfamiliar.

## Share a workflow template

```bash
<!-- agentic:var flowCommand --> export FLOW_ID > template.openflow.json
<!-- agentic:var flowCommand --> import --file template.openflow.json --name "Imported workflow" --idempotency-key IMPORT_KEY --json
```

Export writes only JSON to stdout. Import also accepts `--file -` for stdin and creates
a new unpublished Draft; it never overwrites the source Flow. Keep the same file, name,
and idempotency key when retrying an uncertain import. MCP equivalents are `flow_export`
with `flowId`, and `flow_import` with the JSON `file`, `idempotencyKey`, optional `name`
and optional target `teamId`.

Both operations clear structured accounts, Variables, error-source workflows and
Trigger resource selections. Graphs, shared code Modules, fixed inputs, prompts, model
choices and layout remain. Inspect the imported Draft, configure missing resources with
the normal editor or authoring interface, and check it before running or publishing.
Code, prompts and business JSON may still contain literal sensitive data. Review the
file before sharing; cleanup does not rewrite arbitrary strings.

## Find a Flow or a relevant part

```bash
<!-- agentic:var flowCommand --> list --json
<!-- agentic:var flowCommand --> create "Order summary" --json
<!-- agentic:var flowCommand --> show FLOW_ID --json
<!-- agentic:var flowCommand --> live FLOW_ID --json
<!-- agentic:var flowCommand --> read FLOW_ID --json
<!-- agentic:var flowCommand --> search FLOW_ID --input '{"query":"Customer summary","type":"agent"}' --json
<!-- agentic:var flowCommand --> read FLOW_ID --input '{"revision":"REVISION","nodes":["NODE"]}' --json
<!-- agentic:var flowCommand --> read FLOW_ID --input '{"revision":"REVISION","text":{"node":"NODE","field":"prompt","start":1,"lines":40}}' --json
```

A known Flow ID avoids a list lookup. `show` gives lifecycle and publication
state. `live` gives the current published version, enablement, and online entries,
including Webhook URLs and request fields. `resourceReferences.draft` in Flow
metadata describes Draft dependencies, not online resources. `read` defaults to
the Draft and gives a graph outline, selected node details, or a text excerpt;
`nodes` and `text` are alternative modes. `search` finds matches in names,
configuration and source text, optionally restricted by node type.

The returned `revision` pins subsequent reads and the eventual edit to the same
snapshot. Pagination uses `nextCursor` for lists, `nextOffset` for search, and
`nextStart` for text. Keep the Revision when reading more matches or text pages.
Long text is complete when `truncated` is false. Read as much context as the
change needs; a small edit need not fetch every node or every prompt.

## Save changes

```bash
<!-- agentic:var flowCommand --> schema edit --json
<!-- agentic:var flowCommand --> schema code --json
<!-- agentic:var flowCommand --> edit FLOW_ID --file edits.json --json
```

An edit request contains `baseRevision`, `requestId`, and an ordered `edits`
array. The batch is atomic. Use the observed Revision and a unique request ID
for each new change; retain both when retrying an uncertain submission.
Examples below use `REVISION` and uppercase node placeholders for observed IDs.
Their request IDs are illustrative; choose fresh IDs when adapting them.

`read`, `search`, and `edit` accept `--input` (JSON, `@file`, or `-`) or `--file`
(path or `-`). Use one input mechanism per command. Nested strings are literal:
a `code` value of `@transform.js` does not load that file.

| Operation                         | Effect                                                                              |
| --------------------------------- | ----------------------------------------------------------------------------------- |
| `node.add`                        | Create a node with optional business configuration, input bindings and code/prompt. |
| `node.update`                     | Patch metadata or configuration; `clear` removes selected paths.                    |
| `node.remove`                     | Remove a node.                                                                      |
| `input.set`                       | Set a named input's source.                                                         |
| `edge.connect`, `edge.disconnect` | Change execution routing, with an optional Condition `branch`.                      |
| `text.edit`                       | Replace one exact occurrence in code or prompt.                                     |
| `text.set`                        | Replace the entire code or prompt.                                                  |

`node.add.as` declares a batch-local alias. Later operations in that batch use
`$alias`; later requests use stable references from the response's `nodes` map.
Updates recursively merge objects, including JSON schemas; arrays replace whole
arrays. An empty object preserves existing fields. For example,
`clear: [["config", "inputs", "amount", "schema", "type"]]` removes that constraint.
Absence, explicit null, an unset binding and an inherited default are distinct.

### Connect execution and data

This complete edit adds a Start node, a calculation, and a formatter. It
needs no Connector or model. `total` is a business output; `amount` is a named
input whose binding reads it. Both execution edges and data bindings are visible.

```json
{
  "baseRevision": "REVISION",
  "requestId": "example-code-and-data",
  "edits": [
    { "op": "node.add", "as": "start", "type": "start", "name": "Start" },
    {
      "op": "node.add",
      "as": "calculate",
      "type": "code",
      "name": "Calculate total",
      "config": { "outputs": { "total": { "schema": { "type": "number" }, "nullable": false } } },
      "inputs": { "prices": { "kind": "value", "value": [12, 30] } },
      "code": "export default ({prices}) => ({total: prices.reduce((sum, price) => sum + price, 0)})"
    },
    {
      "op": "node.add",
      "as": "format",
      "type": "code",
      "name": "Format total",
      "config": { "outputs": { "text": { "schema": { "type": "string" }, "nullable": false } } },
      "inputs": { "amount": { "kind": "output", "node": "$calculate", "port": "total" } },
      "code": "export default ({amount}) => ({text: `Total: ${amount}`})"
    },
    { "op": "edge.connect", "source": "$start", "target": "$calculate" },
    { "op": "edge.connect", "source": "$calculate", "target": "$format" }
  ]
}
```

Code uses JavaScript ESM: a default-exported function receives a named input
record and returns a record matching `config.outputs`. Collections can be JSON
arrays inside a field. Bindings to new Code, Agent, LLM, Wait and Approval inputs
automatically declare inputs accepting JSON; `config.inputs` adds business
constraints or defaults where needed.

Common sources are `{"kind":"value","value":...}`,
`{"kind":"output","node":"NODE","port":"PORT"}`, and
`{"kind":"variable","name":"VARIABLE"}`. An output source may omit `port`
when there is one output, or select a nested `field`. Each node schema advertises
supported sources. A Trigger cannot read downstream results before the Run starts.

For workflow business outputs, add one `outputs` node with `config.outputDefs` as a named schema/nullable/description map. Set sources with `node.add.inputs` or `input.set` and connect execution predecessors. Outputs owns its definitions and mappings; deleting it removes both. Node details expose definitions and inputs. Run results expose business `outputs` separately from node logs. A `workflow` node with `config: { "flowId": "TARGET_FLOW_ID" }` calls the target's current enabled Live with Start. Published interface snapshots supply its ports. A changed Revision with the same interface remains callable; changed interfaces require `node.refresh`. Snapshot comparison ignores descriptions and port ordering, but preserves schema, nullability and node-presence differences.

Workflow target selection may retain an owned unpublished or disabled Flow. Without a loaded interface,
the call stores an empty source revision; checks report the target problem or missing interface.
After the target becomes available, `node.refresh` loads its current Live contract. Selection and
workflow-call checks do not validate Start presence. Start remains required at actual Live invocation.
Schema `{}` accepts dynamic JSON; it does not convert objects or arrays into text.

### Change one prompt rule

For an existing Agent whose prompt contains `Include customer email.`, this edit
changes that rule while retaining the rest of the prompt and node configuration.
Read the target text to choose an exact, unique match.

```json
{
  "baseRevision": "REVISION",
  "requestId": "example-prompt-edit",
  "edits": [
    {
      "op": "text.edit",
      "node": "AGENT_NODE",
      "field": "prompt",
      "oldText": "Include customer email.",
      "newText": "Omit customer email."
    }
  ]
}
```

Zero or multiple matches reject the replacement. A longer surrounding excerpt
can disambiguate it. `text.set` suits an intentional full rewrite. LLM message
templates live in `config.template`, rather than the Agent's `prompt` field.

### Request structured model output

An LLM node supports message templates, conversation history and model settings.
In this example, `MODEL_ID` is a model supported by the deployment and
`SOURCE_NODE` has one output containing an order. `{{order}}` interpolates the
bound business input. `resultSchema` defines the result without manually building
an output port.

```json
{
  "baseRevision": "REVISION",
  "requestId": "example-structured-output",
  "edits": [
    {
      "op": "node.add",
      "as": "summary",
      "type": "llm",
      "name": "Summarize order",
      "config": {
        "mode": "json",
        "model": { "model": "MODEL_ID" },
        "template": [{ "role": "user", "content": "Summarize this order: {{order}}" }],
        "resultSchema": {
          "type": "object",
          "properties": { "summary": { "type": "string" } },
          "required": ["summary"],
          "additionalProperties": false
        }
      },
      "inputs": { "order": { "kind": "output", "node": "SOURCE_NODE" } }
    },
    { "op": "edge.connect", "source": "SOURCE_NODE", "target": "$summary" }
  ]
}
```

A downstream node can bind the sole result and select `field: "summary"`.
For model-driven tool use, `schema agent` describes prompts, tools and structured
results. For classification, `schema decision` describes named questions and
answer objects. A Decision answer still needs a Condition if it should control
execution. Schemas constrain data shape; task-specific tests establish whether a
model's answers are useful.

### Put an existing operation behind a condition

Suppose `SOURCE_NODE` outputs `total` and directly precedes `TARGET_NODE`.
This edit inserts a threshold gate. The target runs only for totals above 100;
its existing data bindings stay unchanged. The same pattern can guard an external
write, notification, or a local calculation.

```json
{
  "baseRevision": "REVISION",
  "requestId": "example-condition",
  "edits": [
    {
      "op": "node.add",
      "as": "gate",
      "type": "condition",
      "name": "Above threshold",
      "config": {
        "match": "first",
        "branches": [
          {
            "name": "large",
            "when": {
              "left": { "kind": "output", "node": "SOURCE_NODE", "port": "total" },
              "operator": ">",
              "right": { "kind": "value", "value": 100 }
            }
          }
        ]
      }
    },
    { "op": "edge.disconnect", "source": "SOURCE_NODE", "target": "TARGET_NODE" },
    { "op": "edge.connect", "source": "SOURCE_NODE", "target": "$gate" },
    { "op": "edge.connect", "source": "$gate", "target": "TARGET_NODE", "branch": "large" }
  ]
}
```

`match: "first"` selects the first matching branch; `"all"` allows multiple
matches. `otherwise` handles unmatched execution if connected. Predicates can
combine expressions with `all` or `any`; see `schema condition`. Merely binding
data from a Condition's upstream node does not guard a side effect.

## Provider actions, events and other node types

```bash
<!-- agentic:var flowCommand --> connector search "<provider and operation>" --flow FLOW_ID --json
<!-- agentic:var flowCommand --> connector show ACTION_ID --flow FLOW_ID --json
<!-- agentic:var flowCommand --> schema --flow FLOW_ID --input '{"action":"ACTION_ID"}' --json
<!-- agentic:var flowCommand --> connector connections SERVICE --flow FLOW_ID --json
<!-- agentic:var flowCommand --> trigger search "<provider and event>" --json
<!-- agentic:var flowCommand --> trigger show TRIGGER_KEY --json
```

Discovery supplies actual Action IDs, Trigger keys, ports and Connections. A
search match is a candidate; its schema describes the operation and data. An
unavailable action and an action lacking an active Connection are different
problems. Actions marked `authenticated: false` need no account. Connection
selection rules come from the selected node contract.

For Connector Tasks, independent Code Actions, Agent tools and notifications, an omitted `connectionId` means unconfigured; `connectionId: ""` explicitly defers account configuration. Deferred selections pass account readiness checks but fail with `connector.connection-required` if invoked. Deferred Agent tools are excluded from the callable tool set. Provider Triggers still require a nonempty account ID. Public edits and portable exports preserve the empty string; clear the field to return to the unconfigured state.

| Capability                      | Relevant schema and configuration                                                                                                                                                                                                   |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Provider read or write          | `connector`: discovered `action`, optional `connectionId`, named input bindings.                                                                                                                                                    |
| Provider event                  | `poll` or `integration`: discovered `key`, Connection and any static inputs; polling also has a schedule.                                                                                                                           |
| Manual, HTTP or scheduled entry | `start`, `webhook`, `cron`: workflow `inputDefs`, HTTP body fields, or schedule.                                                                                                                                                    |
| Workflow failure handler        | `error`: published upstream Flows' automatic Run failures; not a node-level catch or a handler for manual Run failures.                                                                                                             |
| Call another workflow           | `workflow`: select an owned published Flow ID; inputs and outputs derive from its saved contract. Use `node.refresh` to update it.                                                                                                  |
| Fixed HTTP operation            | `openapi`: an OpenAPI source, path and method; resolved authentication choices and ports appear in node details.                                                                                                                    |
| Reusable constants              | `value`: named JSON values and optional output constraints.                                                                                                                                                                         |
| Durable interaction             | `wait`, `approval`: prompt and named inputs; resume through the Run's Wait ID. Wait additionally supports optional `config.autoContinue` with `{kind:"after",durationMs:86400000}` or `{kind:"at",at:"2026-10-25T10:00:00+08:00"}`. |

Connector and LLM services are configured on the Server. Missing capabilities
should be described in terms of the required operation or event, without silently
replacing the requested Flow with direct provider calls outside it.

## Validation and execution

An accepted edit returns `saved: true`, the new `revision`, alias-to-node mappings,
and `validation`. A Draft may save with diagnostics. `valid`, `invalid` and
`unavailable` describe validation, not whether the write happened.

```bash
<!-- agentic:var flowCommand --> check FLOW_ID --revision REVISION --json
<!-- agentic:var flowCommand --> run FLOW_ID --source draft --trigger TRIGGER_ID --expected-revision REVISION --idempotency-key RUN_KEY --wait --json
<!-- agentic:var flowCommand --> runs result RUN_ID --json
```

Use the edit's validation or request a check of a specific Revision. Structural
validity does not demonstrate business behavior, model quality or runtime account
access. An authorized test Run can exercise meaningful input cases. Draft Run
readiness concerns the selected Trigger's path and dependencies. Publishing and
Live Runs require the complete Flow to be ready. Explicit Live Runs must select a Start node. Other Triggers can be simulated only in Draft Runs; their Live Runs originate from their event sources.

The Start node is selected automatically even when other Triggers exist; use `--trigger` to choose another entry for a Draft test. A sole legacy Manual Trigger remains supported for Draft tests.
`--outputs` supplies named Start parameters or other Trigger outputs. Required Start parameters must be present, omitted nullable parameters become null, and unknown parameters are rejected. Start parameters have no defaults. `--input` supplies per-node input
overrides; command help gives their shape. Live Runs use `--source live` and
`--expected-publication` instead of `--expected-revision`.

Declare parameters on Start: `{"op":"node.add","as":"start","type":"start","name":"Start","config":{"inputDefs":{"message":{"schema":{"type":"string"},"nullable":false},"note":{"schema":{"type":"string"},"nullable":true}}}}`. Read definitions in Start node details at `config.inputDefs`; `flow_live.inputDefs` remains a derived view of the published Start. Update with `node.update set.config.inputDefs`, and clear node-relative paths such as `["config","inputDefs","message","description"]`. Downstream nodes bind `{ "kind": "output", "node": "$start", "port": "message" }` with separate execution edges. Call with `--outputs '{"message":"Hello"}'`; note becomes null. REST and MCP use `trigger.outputs`. Deleting Start removes its configuration; undo restores it, while a new Start has empty definitions.

### Inspect or continue an existing Run

```bash
<!-- agentic:var flowCommand --> runs show RUN_ID --json
<!-- agentic:var flowCommand --> runs events RUN_ID --json
<!-- agentic:var flowCommand --> runs wait RUN_ID --timeout 60000 --json
<!-- agentic:var flowCommand --> runs resolve RUN_ID WAIT_ID approve --json
```

Only Wait supports automatic continuation. Omit `config.autoContinue` for manual waiting or clear
`["config", "autoContinue"]` to disable it. Relative timing starts at each Wait registration;
absolute timestamps require an offset. Optional `timezone` stores the editor zone; `at` remains the absolute instant. Server rejects deadlines at or beyond its seven-day expiry
when registering the Wait. The first manual or automatic decision wins.

A Wait or Approval suspends the existing Run. `run.waits` carries its Wait IDs;
resolution uses `continue`, `approve` or `reject` as appropriate to that wait and
the authorized decision. A client timeout also leaves the operation running.
Waiting again observes the same Run; starting another Run repeats execution.

| Exit code | Meaning                                                                                    |
| --------- | ------------------------------------------------------------------------------------------ |
| `0`       | Command succeeded or asynchronous work was accepted; inspect the returned status.          |
| `1`       | Command error or unsuccessful terminal Run; inspect the error or Run events.               |
| `2`       | Run is blocked on an unresolved Wait or Approval.                                          |
| `3`       | Client wait expired or publication is pending; retain its identity and continue observing. |

`--timeout` is a wait budget in milliseconds (default 60000). Event following
with `runs events RUN_ID --follow --json` emits NDJSON; `nextAfter` supports
resuming. `runs results`, `runs read-result` and `runs download-result` expose
large results without requiring the whole value in one response.

## Publish and open

```bash
<!-- agentic:var flowCommand --> publish FLOW_ID --expected-revision REVISION --expected-publication PUBLICATION_OR_NONE --idempotency-key PUBLISH_KEY --json
<!-- agentic:var flowCommand --> enable FLOW_ID --expected-publication PUBLICATION --json
<!-- agentic:var flowCommand --> disable FLOW_ID --expected-publication PUBLICATION --json
<!-- agentic:var flowCommand --> workbench FLOW_ID --json
<!-- agentic:var flowCommand --> open FLOW_ID
```

`none` means no prior Live Publication was observed. Publication and enablement
are for a requested release or automatic execution, and are unnecessary for a
Draft test Run. `publications wait` follows an accepted pending publication.

Flow is the only manual enable/disable unit: its switch controls all current Live
Triggers together. Individual Triggers have no pause/resume operation. Disabling
a Flow blocks new production admission without cancelling already accepted Runs.
Use the observed Live publication ID for `--expected-publication`; if it changed,
read the current state before deciding whether to apply the switch to that version.
The MCP equivalent is `flow_set_enabled({ flowId, expectedPublicationId, enabled })`.

Successful `publish` includes the same `live` details as `live FLOW_ID --json`;
use that result without immediately querying again. Query `live` after waiting
for an asynchronous publication, when details are missing, or when current state
is needed later. An unpublished Flow returns `status: not-published` with no entries.

For an authorized Webhook call, use the entry's `binding.endpointUrl`,
`config.method`, and `config.body` field contracts. These retain schema,
nullable and default semantics; methods without a request body have no body
fields. Do not reconstruct URLs from node IDs. Flow `enabled` and `status` are
independent of a binding's `health` and `listener`; a healthy
subscription alone does not establish that automatic execution is enabled.
Shared event source and account references can be inspected through their own
commands when relevant.

`workbench` returns a URL; `open` opens the system browser. Browser authentication
belongs to the host. An open Workbench receives Revision notifications, so a CLI
edit does not require a page reload.

`live` includes Start and legacy Manual entry nodes without a runtime binding. `trigger search`
and `trigger show` discover provider definitions; `live` inspects the Flow's
current online entries. The MCP equivalent is `flow_live({ flowId })`.

## Recover without losing another change or repeating an effect

- **Revision conflict:** another writer changed the Draft. Read the latest
  relevant state, recompute the edit, and use a new request ID. Merely replacing
  `baseRevision` can overwrite the other writer's intent.
- **`flow.mutation-outcome-unknown`:** the submission may have succeeded. Preserve
  its identity, key and complete payload. Only an identical retry can safely
  resolve that uncertainty; a new key describes a new mutation.
- **Saved with diagnostics:** the edit happened. Repair the saved Revision or
  investigate unavailable validation; resubmitting it is not a validation step.
- **Published with detail warnings:** a succeeded `operation` confirms the
  publication even if metadata or online details could not be read. Query `live`
  rather than publishing again to retrieve an address. A pending operation still
  requires observing that same operation. If `live.publication.publicationId`
  differs from the successful operation's `publicationId`, the entries describe
  the current Live version, not the earlier publication.
- **Failed Run:** events and results identify the failing node and available
  inputs. Consider already-completed external effects before running it again.

A useful completion report identifies the Flow and Revision, what changed,
what was actually checked or executed, and any remaining blocker. Its detail
should match the task.

## Workbench node annotations

Node annotations from the Codex browser show the node title as the annotation name.
Metadata contains `flowId`, `revisionId`, `nodeId`, and `syncState`, plus `description`
when nonempty. The identity fields are never truncated; `revisionId` identifies the
saved Revision. Descriptions may be shortened with an ellipsis to fit the annotation
limits; read full content
through the public API. The browser supplies the source page URL separately. Continue
using the configured deployment and verify it matches the referenced Flow.
Read the referenced node with the public read command before acting. Before editing,
read the current Draft and use its revision checks; a captured annotation may be older
than the current Draft. If the node no longer exists, report that instead of choosing
another node by name.

`syncState` describes the Workbench's known save state (`saved`, `dirty`, `saving`, or
`failed`). The revision always identifies saved data; pending local changes, including
unsaved code, are not part of that snapshot. An annotation does not save those changes
or establish a CLI/MCP connection. Missing or invalid metadata is not sufficient to
identify a node for editing.

A multi-node annotation carries the same `flowId`, `revisionId`, and `syncState`,
with `nodeIds` instead of `nodeId`. Parse `nodeIds` as a JSON-encoded string array
and read every referenced node. The group contains business nodes and Triggers;
Comment cards have no authoring node identity and are not included in this feature.
If the complete list exceeds the annotation limits, metadata contains `nodeCount`
and `error` instead of `nodeIds`. Ask for a smaller selection; never infer a partial
list or treat a missing list as the whole Flow. The annotation captures the selection
at creation time, not whichever nodes happen to be selected when the agent acts.
