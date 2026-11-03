# Workflow benchmark

The [workflow benchmark](../../apps/server/scripts/benchmark-workflow.ts) measures the Server's
application-service Flow call path using temporary SQLite storage, real isolated execution, and one
concurrent Run slot. It verifies business outputs and removes its database afterward. HTTP transport
and fixture setup are excluded.

## Running

From the repository root:

```bash
bun run --cwd apps/server benchmark:workflow 30 > /tmp/workflow-benchmark.json
```

The optional argument is the number of measured Runs per scenario (default 15), after one warm-up.
The command writes a JSON report with the runtime, platform, timings, counters, and sampled phases.

## Scenarios and metrics

Scenarios cover direct, nested, parallel-node, Code-tool, and logging calls, including a larger Flow
with 64 Code nodes. Logging cases cover 100 and 1,000 short messages and 16 long messages; `direct`
provides the zero-log baseline.

The report includes admission, completion, and total latency, method-call counts, SQL preparation
counts, and root Flow notifications. Counter values are averages per measured root Run:

| Field              | Meaning                                                                    |
| ------------------ | -------------------------------------------------------------------------- |
| `logRequests`      | Log IPC requests, including batches; not the number of individual logs.    |
| `transactions`     | Database transaction calls across the Run, including lifecycle operations. |
| `eventAppends`     | Event write requests, which may contain multiple events.                   |
| `eventsSubmitted`  | Individual events in those requests, before storage limits are applied.    |
| `sqlPreparations`  | SQL statement preparation calls, not statement executions.                 |
| `workflowRequests` | Workflow host requests, not all IPC messages.                              |
| `resultReads`      | Result reads, including one verification read per root Run.                |

Other counters describe calls to the named methods instrumented in the benchmark script.

## Sampling and comparisons

`sampledMsPerRun` estimates inclusive main-process stack time for Revision reads, Revision decoding,
workflow diagnostics, and Flow preparation using V8 profiling with a requested 100 μs interval.
The preparation bucket includes `prepareFlow`, `validateFlow`, and `flowClosure` stacks; it does not
measure their asynchronous wall time. Buckets overlap (diagnostics includes reads and decoding),
so do not add them together. Isolated executor work is outside this profile.

Latencies include instrumentation and profiler overhead. Compare runs on the same machine and
runtime, keeping the sample count and benchmark scenarios consistent. Avoid interpreting these
measurements as production latency. Keep individual optimization results in their PR descriptions
or performance reports rather than this reference.
