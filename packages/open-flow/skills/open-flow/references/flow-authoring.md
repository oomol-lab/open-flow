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

## Find a Flow or a relevant part

```bash
<!-- agentic:var flowCommand --> list --json
<!-- agentic:var flowCommand --> create "Order summary" --json
<!-- agentic:var flowCommand --> show FLOW_ID --json
<!-- agentic:var flowCommand --> read FLOW_ID --json
<!-- agentic:var flowCommand --> search FLOW_ID --input '{"query":"Customer summary","type":"agent"}' --json
<!-- agentic:var flowCommand --> read FLOW_ID --input '{"revision":"REVISION","nodes":["NODE"]}' --json
<!-- agentic:var flowCommand --> read FLOW_ID --input '{"revision":"REVISION","text":{"node":"NODE","field":"prompt","start":1,"lines":40}}' --json
```

A known Flow ID avoids a list lookup. `show` gives lifecycle and publication
state. `read` gives a graph outline, selected node details, or a text excerpt;
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

This complete edit adds a Manual Trigger, a calculation, and a formatter. It
needs no Connector or model. `total` is a business output; `amount` is a named
input whose binding reads it. Both execution edges and data bindings are visible.

```json
{
  "baseRevision": "REVISION",
  "requestId": "example-code-and-data",
  "edits": [
    { "op": "node.add", "as": "start", "type": "manual", "name": "Start" },
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

| Capability                      | Relevant schema and configuration                                                                                       |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Provider read or write          | `connector`: discovered `action`, optional `connectionId`, named input bindings.                                        |
| Provider event                  | `poll` or `integration`: discovered `key`, Connection and any static inputs; polling also has a schedule.               |
| Manual, HTTP or scheduled entry | `manual`, `webhook`, `cron`: business payload fields or schedule. A Manual Trigger has no output parameters.            |
| Workflow failure handler        | `error`: published upstream Flows' automatic Run failures; not a node-level catch or a handler for manual Run failures. |
| Fixed HTTP operation            | `openapi`: an OpenAPI source, path and method; resolved authentication choices and ports appear in node details.        |
| Reusable constants              | `value`: named JSON values and optional output constraints.                                                             |
| Durable interaction             | `wait`, `approval`: prompt and named inputs; resume through the Run's Wait ID.                                          |

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
readiness concerns the selected Trigger's path and dependencies; publishing and
Live Runs require the complete Flow to be ready.

A sole Manual Trigger is selected automatically; otherwise specify `--trigger`.
`--outputs` supplies named Trigger outputs. `--input` supplies per-node input
overrides; command help gives their shape. Live Runs use `--source live` and
`--expected-publication` instead of `--expected-revision`.

### Inspect or continue an existing Run

```bash
<!-- agentic:var flowCommand --> runs show RUN_ID --json
<!-- agentic:var flowCommand --> runs events RUN_ID --json
<!-- agentic:var flowCommand --> runs wait RUN_ID --timeout 60000 --json
<!-- agentic:var flowCommand --> runs resolve RUN_ID WAIT_ID approve --json
```

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
<!-- agentic:var flowCommand --> workbench FLOW_ID --json
<!-- agentic:var flowCommand --> open FLOW_ID
```

`none` means no prior Live Publication was observed. Publication and enablement
are for a requested release or automatic execution, and are unnecessary for a
Draft test Run. `publications wait` follows an accepted pending publication.

`workbench` returns a URL; `open` opens the system browser. Browser authentication
belongs to the host. An open Workbench receives Revision notifications, so a CLI
edit does not require a page reload.

## Recover without losing another change or repeating an effect

- **Revision conflict:** another writer changed the Draft. Read the latest
  relevant state, recompute the edit, and use a new request ID. Merely replacing
  `baseRevision` can overwrite the other writer's intent.
- **`flow.mutation-outcome-unknown`:** the submission may have succeeded. Preserve
  its identity, key and complete payload. Only an identical retry can safely
  resolve that uncertainty; a new key describes a new mutation.
- **Saved with diagnostics:** the edit happened. Repair the saved Revision or
  investigate unavailable validation; resubmitting it is not a validation step.
- **Failed Run:** events and results identify the failing node and available
  inputs. Consider already-completed external effects before running it again.

A useful completion report identifies the Flow and Revision, what changed,
what was actually checked or executed, and any remaining blocker. Its detail
should match the task.
