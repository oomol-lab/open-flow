# Convert n8n behavior into Open Flow

An n8n export describes a workflow's behavior and its n8n-specific machinery.
Use the behavior to design an Open Flow graph with current node contracts.
Equivalent results may need a different number of nodes or a different graph.
[Flow authoring](flow-authoring.md) covers `<!-- agentic:var flowCommand -->`,
atomic edits, input bindings and execution.

The requested outcome can be a feasibility assessment, a complete conversion,
or a useful partial Draft. Unresolved behavior limits what can be claimed as
converted; it does not prevent saving an agreed partial result. Running,
publishing and enabling remain separate actions within the user's authorization.

## Choose a representation

| Source behavior                               | Open Flow building blocks                       | What determines a good fit                                                     |
| --------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------ |
| Scheduled, webhook or provider event          | Cron, Webhook, Poll or Integration Trigger      | Schedule/timezone, event payload, delivery and response behavior.              |
| Provider read or write                        | Connector                                       | Exact operation, input/output shape, account and number of calls.              |
| Field shaping, filtering, aggregation or join | Code with named input/output fields             | Explicit collection representation, ordering, keys and empty-input behavior.   |
| IF or Switch                                  | Condition and named execution branches          | Predicate, first/all matches, fallback route and data sent onward.             |
| Prompt plus model and output parser           | LLM with template, inputs and `resultSchema`    | Supported model, result shape and any parser repair behavior.                  |
| Agent with tools or memory                    | Agent where its current contract fits           | Tool permissions, state lifetime and how context is supplied.                  |
| HTTP request                                  | OpenAPI where an actual operation contract fits | Method, parameters, auth, response format and error behavior.                  |
| Human response or durable pause               | Wait or Approval                                | Who resumes it, payload, timing, notification and external response lifecycle. |
| Workflow failure handling                     | Error Trigger where its scope fits              | Which failures trigger it and what failure data it receives.                   |

Use `schema TYPE` and provider discovery for the actual deployment. A node's
name alone does not establish equivalence. Provider operations can differ even
when both products use the same service name. Model, parser, tool, memory and
retrieval nodes connected by specialized AI edges often form one semantic unit;
those edges do not translate directly into execution edges.

## Records, collections and item identity

n8n passes arrays of items and many nodes process each item automatically.
Open Flow Code receives one named input record; a collection is an explicit
array field in that record. Passing an array to a Connector does not imply one
call per element. This distinction matters most for external writes. See
[n8n data structure](https://docs.n8n.io/build/work-with-data/understand-n8ns-data-structure.md).

For example, a source step that filters paid orders and sums their amounts can
be represented by a Code node with an `orders` input and `count` and `total`
outputs. Assuming numeric amounts, its code can be:

```javascript
export default ({ orders }) => {
  const paid = orders.filter((order) => order.status === 'paid')
  return {
    count: paid.length,
    total: paid.reduce((sum, order) => sum + order.amount, 0),
  }
}
```

Declare those business outputs in `config.outputs` and bind the input to the
actual upstream collection. Empty input produces zero count and total. If the
source accepts null or string amounts, preserve that behavior explicitly. If
its next step sends one message per order, this aggregation would change the
behavior; preserve the individual calls or discuss a batch-message redesign.

n8n also links output items to their originating items. An expression such as
`$('Customer').item.json.email` depends on that lineage, whereas `.first()`
explicitly chooses a position. Neither implies an arbitrary first available
customer. An Open Flow representation can use a single record when the relation
is one-to-one, or an explicit keyed join when working with collections. Missing
and duplicate keys need the source's intended behavior. See
[n8n item linking](https://docs.n8n.io/build/work-with-data/reference-data/link-data-items.md).

### Expression examples

| n8n intent                             | Possible Open Flow expression                                                                          |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Read `orderId` from the current item   | Bind a named `order` input; Code reads `order.orderId`, or select an upstream output's `field`.        |
| Read all records from an earlier step  | Bind its explicit array output and process the array.                                                  |
| Read a linked customer for each order  | Pass the linked record explicitly, or join collections on the real customer key.                       |
| Interpolate an order in a model prompt | Bind `order` to Agent/LLM and use `{{order}}`.                                                         |
| Read a file or attachment              | Use the selected Trigger/Connector's file or artifact contract; there is no implicit n8n binary store. |
| Read environment or execution metadata | Use an equivalent supported binding, or an explicit business input when appropriate.                   |

n8n helpers such as `$input`, `$json` and `$node` are not Open Flow JavaScript
globals. Rewrite their meaning using named inputs. Execution-time clocks, timezones
and persisted state may also affect the result; an ordinary JavaScript value is
only equivalent when those lifetimes agree.

## Branches control execution separately from data

Consider “if an order total exceeds 100, notify operations; otherwise archive it.”
The Open Flow Condition reads the total, selects a named branch, and execution
edges reach the notification or archive node. Both destinations bind their
payload from the original order output.

The [condition example](flow-authoring.md#put-an-existing-operation-behind-a-condition)
shows inserting such a gate without altering the destination's input bindings.
A data reference to an upstream node does not restrict when a side effect runs.

Preserve the meaning of source branch indexes: inspect what each output of the
specific node represents. For multi-case routing, `match: "first"` and
`match: "all"` support different behavior; `otherwise` is the unmatched route.
For item-by-item IF routing, partitioning a collection may be necessary before
choosing execution branches. One condition over an array is not automatically
one condition per item.

Merge behavior also depends on join mode, keys, ordering, duplicates and absent
inputs. Code can implement a bounded, explicit join. A generic connection
between two predecessors does not reproduce every Merge mode.

## Provider access and credentials

```bash
<!-- agentic:var flowCommand --> connector search "<provider and operation>" --flow FLOW_ID --json
<!-- agentic:var flowCommand --> schema --flow FLOW_ID --input '{"action":"ACTION_ID"}' --json
<!-- agentic:var flowCommand --> connector connections SERVICE --flow FLOW_ID --json
<!-- agentic:var flowCommand --> trigger search "<provider and event>" --json
```

Select real Action IDs, Trigger keys and Connections from discovery. An n8n
credential ID is not an Open Flow Connection ID. Exports can also contain secrets
inside URLs, headers, expressions or Code; keep those out of Drafts and reports.
Use supported credential bindings for the selected operation. A missing account
can leave a Draft incomplete without implying that the action itself is absent.

For HTTP Request conversion, `schema openapi` describes source URL, operation
selection and supported authentication. Check the actual operation's response,
non-success status, redirect, binary and retry requirements against that contract.
An invented API specification does not establish support for an unknown operation.

A provider event may expose an ID where the source expected a full record. A
Connector read can supply the missing data if it preserves the desired behavior.
Likewise, a polling Trigger may own state or deduplication that a schedule plus
list action would need to reproduce explicitly.

## Models and stateful interactions

A standard prompt/model/parser cluster can often become one LLM node. The
[structured result example](flow-authoring.md#request-structured-model-output)
shows a message template, a bound input and a result schema. Business rules that
depend on particular fields may also need validation before a side effect.
A result schema alone does not reproduce an arbitrary parser's retry or repair
policy.

Agent tools, memory, retrievers and vector stores affect both available actions
and state lifetime. Inspect them as part of the source behavior. A successful
single prompt response does not establish equivalence with a stateful conversation.

Wait and Approval suspend a Run with a durable Wait ID. `runs resolve` continues
that Run. Match the source's resume payload, timing and external interaction
before calling it equivalent. Forms, conversational memory, delayed responses and
webhook response lifecycles may require capabilities beyond a simple pause;
a polling loop inside Code does not provide those lifecycles.

## Failures and execution settings

Source execution settings can change the number of processed items, output on
empty results, retries and failure routes. Account for settings such as
`executeOnce`, `alwaysOutputData`, `retryOnFail`, `onError` and legacy
`continueOnFail` when present. Their effective behavior depends on the source
node and n8n version; use its implementation or a representative execution when
the export is insufficient evidence.

The observable questions are whether a failed operation is retried, whether a
retry repeats a side effect, which output receives failure data, and whether the
workflow ultimately fails or continues. Handling a returned error item and
handling a thrown exception can be different paths. Preserve both when relevant;
do not infer their payload or route from the setting's label.

Open Flow Error Triggers observe automatic Run failures of published upstream
Flows. They expose `workflow`, `execution` and `error`; they do not implement a
node's continue-on-error route or catch manual Run failures. Node-level recovery
needs a separately supported design.

## Describe gaps and verify the requested result

Useful distinctions for a conversion report are:

- **Converted:** current contracts express the required behavior.
- **Needs configuration:** the design fits but needs an account or business value.
- **Missing provider capability:** the required event or operation is absent
  from the available catalog. Describe its inputs, outputs and affected behavior.
- **Behavioral mismatch:** execution, state, lineage or response semantics need
  a redesign or cannot currently be preserved. More catalog searching will not
  resolve an execution-model mismatch.

Discovery effort should follow the uncertainty. A close search result warrants
contract inspection; a broad catalog query can help resolve ambiguous terminology.
There is no prescribed query count or requirement to produce a full inventory
before a useful local edit. When a gap would change the promised result, explain
it and align on the reduced scope or redesign before implementing that choice.

A saved, valid graph establishes structural correctness. Behavioral comparison
needs representative inputs and observable results: empty and multiple items,
branch boundaries, duplicate join keys, failures and external call counts as
relevant. Test execution stays within the user's authorization. Reports should
distinguish what was mapped, saved, checked and actually run, identify remaining
gaps, and link the resulting Flow/Revision when one was created. Annotations and
disabled nodes need mention only when their omission or behavior matters.
