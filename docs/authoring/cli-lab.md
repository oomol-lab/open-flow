# CLI Lab

CLI Lab provides an isolated local deployment for experimenting with node-oriented `oo flow`
commands and MCP tools. Edit flows in the terminal and inspect the same data in a live, read-only page.
Validation, revision commits, execution, code isolation, and change notifications use the
production implementation. Connectors and models use deterministic mocks, so no real accounts
or paid model calls are needed.

## Quick start

Install dependencies and start a session from the repository root:

```bash
bun install
bun run lab list
bun run lab start customer-redaction
```

Keep that terminal running. In another terminal, run:

```bash
bun run lab open
bun run lab flow read FLOW_ID --json
bun run lab flow edit FLOW_ID --file edits.json --json
bun run lab diff
bun run lab verify
bun run lab report
```

Replace `FLOW_ID` with the ID printed at startup. `lab open` opens the current session's read-only
workflow page without a login. The page uses the public `OpenFlowPreview` component to support
zooming, node selection, property inspection. Dragging nodes temporarily
does not save their positions. Use the terminal to edit, validate, and run flows.

Arguments after `lab flow` pass unchanged to the production CLI in the current source tree.
Run `bun run lab flow --help --json` for the full command contract. File arguments, stdin,
stdout/stderr, and exit codes retain their normal behavior.

Server flow notifications push CLI changes to the page, which displays the current Revision.
The page exposes only a read-only snapshot stream; it does not expose the management token or
proxy Control API writes. If disconnected, it retains the last snapshot and displays its
reconnection status. Viewing the page does not count toward CLI costs.

```bash
bun run lab reset
```

Reset terminates the experiment's runs, restores the initial flow and layout, and starts a new
attempt. Previous reports remain available. The browser reconnects automatically and restores
the initial view. You can retry each scenario as often as needed.

## Sessions and reports

Commands select the most recently started manual session by default. When using multiple
sessions, specify the session before the Lab command:

```bash
bun run lab --session SESSION_ID flow read FLOW_ID --json
bun run lab --session SESSION_ID report --json
```

Offline help and local schema commands may run concurrently within a session, including alongside
one deployment command. Each call retains its own input/output and cost record. Commands that
access the deployment remain sequential. Reset and acceptance verification require every active
command to finish, including offline commands, and block new registrations while running.
Ctrl+C stops the backend and the read-only page's
development server while preserving the experiment database and reports.

```bash
bun run lab report --attempt ATTEMPT_ID
bun run lab report --attempt ATTEMPT_ID --compare OTHER_ATTEMPT_ID --json
bun run lab clean SESSION_ID
```

`clean` deletes stopped sessions only. Data lives in the Git-ignored `.open-flow-lab/` directory.
Lab does not read the regular development server's data or configuration. Restart the session
after changing backend source. CLI source changes take effect on the next invocation; frontend
changes update through Vite.

Comparisons require the same scenario version and fixture/verifier identity. Reports default to readable text; `--json` returns the full structure. Each command record includes
arguments, input sources, request paths, statuses, and byte counts. Raw stdout/stderr are saved
separately in files named with the attempt and command IDs. Git HEAD, working-tree status, and a
diff digest help identify the source version, but the digest cannot reconstruct uncommitted or
untracked files. Pin source and script versions when strict comparisons are required.

The first successful verification freezes the task result. Later commands are recorded under
`after` and do not change the completed cost totals. Run `reset` to start another comparison.
For a continuing scenario, `next` starts the next task on the accepted Flow instead of resetting it.
A failed manual verification allows further repairs; a script failure ends the attempt.

The read-only page does not modify Revision or Presentation data and does not mark attempts as
`mixed`. Semantic changes made directly through other clients still mark an attempt as `mixed`,
excluding it from pure CLI cost comparisons. Presentation differences are reported separately.

## Testing with an Agent

Start a session and copy the complete Agent prompt printed at startup into a fresh Agent
conversation with terminal access to this repository. The prompt contains the actual task,
working directory, Session and Flow, so no placeholders need to be filled in. It restricts
workflow access to the public `lab --session ID flow ...` interface, allows JSON request files,
and keeps fixtures, reference solutions, the verifier and session storage outside the Agent's
task. It does not prescribe the solution or tool-call order.

Use a fresh conversation for each trial so previous solutions do not influence discovery.
Keep the session terminal running. After the Agent finishes, review and independently verify:

```bash
bun run lab --session SESSION_ID diff
bun run lab --session SESSION_ID verify
bun run lab --session SESSION_ID report
```

Reset before testing another Agent or retrying from the initial state. Record qualitative
feedback as well as acceptance and costs: failed discovery calls, unclear parameters, and
unnecessary reads can explain differences between solutions. Coding Agent model usage is billed
by its provider and is not measured by Lab's byte or HTTP counters.

The manual CLI wrapper records real Agent calls. `lab test --mcp` exercises a reference script
through MCP; it does not launch an Agent. External MCP clients need compatible protocol support
and a Lab recording adapter for comparable per-call costs. Direct external edits mark the
attempt as mixed.

## A continuing fulfillment workflow

`fulfillment-ops` tests how an Agent maintains one useful workflow as requirements evolve. Start
an empty Flow, give the printed task to an Agent, and keep the same Agent conversation and Lab
session through all four tasks:

```bash
bun run lab start fulfillment-ops
```

| Task                           | Workflow evolution                                                                                              | Independent acceptance                                                                                                                                                                             |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Daily report                   | Discover the batch-query Action and test account; build a manually triggered query and internal report archive. | Batch is supplied at run time; empty and ordinary batches produce the correct order count and paid total.                                                                                          |
| Overdue notification           | Add a run-time SLA input and notify operations about paid, pending orders at or beyond the SLA.                 | Preserve the complete archive, select the correct orders at two SLA values, and skip notifications when none qualify.                                                                              |
| Manager and supplier follow-up | Replace JSON notifications with a model-generated manager summary; add a supplier fulfillment request.          | The actual model request contains only the redacted summary and required instruction. The notification forwards the actual model response. Supplier data contains only order ID, SKU and quantity. |
| Upstream change                | Accept decimal strings and null amounts; change the SLA boundary to strictly greater than.                      | Preserve previous behavior, handle boundary and migrated batches, and reject malformed data before any write or model call.                                                                        |

After each task, independently verify the result and advance:

```bash
bun run lab --session SESSION_ID verify
bun run lab --session SESSION_ID report
bun run lab --session SESSION_ID next
```

`next` requires successful verification of the current stage and an unchanged Draft head since
that verification. It prints the next task, preserves the Flow and starts a linked attempt with
separate costs. Send that task to the same Agent conversation so it must retain context, inspect
the current workflow and preserve the earlier requirements. Do not reset between stages. After
the fourth successful verification, the journey is complete; there is no fifth task.

Reports retain the chain of stages and their acceptance results. Each stage is measured against
its own task and starting Revision; do not compare its isolated cost with a trial that starts
from an empty Flow. `reset` restores the empty baseline and returns to the first task while
preserving previous reports. Use a fresh Agent conversation when restarting the whole journey.

This example accepts run parameters on unbound node inputs without default values. A Manual
trigger has no output parameters. Supply the query's `batch` input and calculation's `slaHours`
input through the public run command on every run; the Agent can inspect that command's help
when testing its work. Model outputs remain deterministic mocks, so this exercise verifies data
routing and transmitted instructions rather than the quality of generated prose.

The reference journey binds the redacted summary object directly to the Agent's named `orders`
input and uses `{{orders}}` in its prompt. It does not add a code output solely to stringify that
object or declare the Agent's internal output port. The notification reads the Agent's unique
result without naming a port. Code data contracts use named field maps, while node creation can
provide data sources directly through `inputs`. This exercises the same business-level authoring
contract through both CLI and MCP.

Both reference drivers run the same four stages without resetting the Flow:

```bash
bun run lab test fulfillment-ops
bun run lab test fulfillment-ops --mcp
```

Reference regression results and trials performed by real Agents must be reported separately.
One successful reference program does not demonstrate that an Agent can discover, build and
maintain the workflow without that program.

## Script regression tests without model costs

```bash
bun run lab test
bun run lab test --mcp
bun run lab test repair-amount
bun run lab test customer-redaction --keep-failed
```

The default suite includes focused tasks, two sizes of the summary customization task, and a continuing
fulfillment workflow:

| Scenario                   | Task and independent acceptance                                                                                                                                                                                                                           |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `order-alert`              | Build from an empty flow. Discover order and notification Actions and test accounts among decoys. Run empty, below, equal and above-threshold orders; verify branch choice, call counts, content and accounts.                                            |
| `customer-redaction`       | Insert a processing step into the customer notification execution path and bind its data. Verify only order ID and total leave the customer path; the internal archive retains the complete original record and account.                                  |
| `specialize-summary`       | Two Agent nodes start with identical, independently owned configurations. Change one exact rule only in the customer prompt; verify the internal prompt, other configuration and actual customer/internal model requests.                                 |
| `specialize-summary-large` | The same task with more real departmental configuration nodes and execution branches. Compare selected reads with the small fixture; unrelated content should not inflate the caller's input.                                                             |
| `repair-amount`            | Inspect a seeded failed Run, locate source and fix nullable amounts. Check null, zero, ordinary amounts and missing orders. Schemas remain fixed; missing orders must still fail.                                                                         |
| `concurrent-edit`          | After the first read containing the notification target, a deterministic gate commits an operator note edit. Require a stale write rejection with an unchanged Draft, a successful retry preserving the note, and no duplicate nodes or unnecessary Runs. |
| `fulfillment-ops`          | Maintain one Flow across four accepted tasks: batch reporting, overdue alerts, manager/supplier follow-up and an upstream data migration. Each stage retains the previous Flow and checks cumulative behavior.                                            |

Both drivers use the same task, fixture and verifier. Reference scripts call only public Agent tools through `driver.ts`; they cannot read fixture data, the database or the service to obtain answers. CLI calls use production argument/file handling; MCP calls use the real HTTP transport. Each scenario declares its entry: existing fixtures name their initial trigger; the blank-flow task requires one newly created Manual trigger. The verifier uses those entries and sample sets, supports independent Runs and expected failures, and inspects actual mock calls. Model outputs are deterministic; model request records establish correct prompt/configuration transmission, not generation quality.

The old four scenario IDs have left the default set. Historical reports retain their original IDs and versions. Compare interfaces on the same new task and verifier; an old interface unable to complete a task has a capability gap. Script regression scores do not measure real Agent success rates.

Tests do not use the current manual session, start a browser, or call real models. Trials with
real Agents require an explicit user request; Lab does not automatically drive external Agents.

Reports and raw output from each script run are saved under `.open-flow-lab/reports/`. Temporary
databases are removed after success and, by default, after failure. `--keep-failed` retains the
stopped session and prints its directory. Exit code 0 means all scenarios passed; 1 means a failure.

`verify` requires existing Runs to finish so concurrent execution cannot contaminate mock call
records. Wait, cancel, or reset first. Verification pins the current Revision, checks the requested
changes and preservation of unrelated content, then runs that fixed version to verify actual
results and mock notification calls. Passing `check` alone does not mean the task is complete.
Reference scripts demonstrate the behavior and cost of a known solution; they do not establish
that an Agent can discover it independently.

## Cost accounting

Three layers are reported separately and are not added into one total:

| Layer               | Measurements                                                                                                          |
| ------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Tool calls          | CLI/MCP calls, read/write/check categories, failures, repair attempts, revision conflicts, duration and exact replays |
| Caller-visible data | Argument text, consumed file/stdin content, stdout, stderr                                                            |
| HTTP                | Round trips, method/path, status, request and response bytes, and transport duration                                  |

All sizes are measured in UTF-8 bytes. Argument text is calculated by joining argv elements with
a single space. It excludes shell quoting, the Lab invocation prefix, and the shell's own output.
The original argv array is also retained.

Files are identified by their resolved filesystem paths. Repeated reads within one command count
once; resubmitting the same file in another command counts again. File and stdin content are
counted separately from paths in command arguments. A full Revision fetched internally but not
shown to the caller counts only at the HTTP layer. HTTP sizes measure bodies consumed by the
transport adapter, excluding headers, TLS overhead, and compression overhead. Responses and
terminal output are counted incrementally as they stream.

Initialization, seeded failure Runs, mock operator edits and Lab acceptance verification are separately recorded under `excluded` and excluded from task costs. The seed failure is a substep of initialization. The concurrency gate reports its own time separately from the caller command and HTTP duration. Explicit
`check`, `run`, and status polling calls made by task scripts are included. Requests are marked
as replays only when their method, path, idempotency key, and body match exactly. Repair attempts count edits submitted after a rejected edit; they do not imply the same request identity. Nonzero exit codes are reported
separately; they include production CLI waiting/timeout states and do not always indicate a
failed edit.

Summed command duration and task wall-clock time are reported separately. Human thinking time
is part of wall-clock time. Successful verification freezes task wall-clock time at the moment
verification began; the final acceptance run does not contribute to command costs. Byte counts
are neither token estimates nor model billing estimates.

## Adding scenarios

The development host lives in `apps/server/scripts/lab/`:

- `scenarios.ts` defines stable scenario IDs, versions, tasks, initialization operations,
  sample sets and semantic preservation assertions.
- `reference.ts` contains caller-visible reference programs. `driver.ts` adapts the same programs to CLI and MCP.
- `fulfillment.ts` defines the continuing task and batch data; `fulfillmentAcceptance.ts` checks it independently of `fulfillmentReference.ts`, which uses only public tools.
- `acceptance.ts` independently checks execution results and calls.
- `mocks.ts` provides mock catalogs, accounts, model protocols, and call records. The CLI uses
  this catalog for capability discovery.
- `session.ts` manages the real deployment lifecycle, baseline snapshots, verification, and reset.
- `preview.ts` provides the read-only snapshot stream. `browser/` displays flows through the
  public preview component and reuses the Server frontend build configuration.
- `main.ts` orchestrates commands, reference scripts, and reports. `report.ts` handles statistics
  and differences.

Include an initial Presentation, a reference script, and independent assertions when adding a
scenario. Assertions should check final semantics and behavior without depending on command
order. Do not derive the only acceptable final source code from the reference edit function.
Increment the scenario version when scenario facts or acceptance targets change to avoid
misleading comparisons.

The Lab host allows fetch requests only to registered local services and does not follow redirects.
Undefined model, Action, or other external requests fail. Lab is a development experiment
environment, not a general-purpose network sandbox for arbitrary untrusted code. Code isolation
remains the responsibility of the production runtime.
