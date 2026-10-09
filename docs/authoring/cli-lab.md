# CLI Lab

CLI Lab provides an isolated local deployment for experimenting with the existing `oo flow`
commands. Edit flows in the terminal and inspect the same data in a live, read-only page.
Validation, revision commits, execution, code isolation, and change notifications use the
production implementation. Connectors and models use deterministic mocks, so no real accounts
or paid model calls are needed.

## Quick start

Install dependencies and start a session from the repository root:

```bash
bun install
bun run lab list
bun run lab start fix-notification
```

Keep that terminal running. In another terminal, run:

```bash
bun run lab open
bun run lab flow inspect FLOW_ID --json
bun run lab flow node input FLOW_ID notify text format text --json
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
bun run lab --session SESSION_ID flow inspect FLOW_ID --json
bun run lab --session SESSION_ID report --json
```

Run CLI commands sequentially within each session. Initialization, reset, and acceptance
verification do not interleave with CLI edits. Ctrl+C stops the backend and the read-only page's
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

Reports default to readable text; `--json` returns the full structure. Each command record includes
arguments, input sources, request paths, statuses, and byte counts. Raw stdout/stderr are saved
separately in files named with the attempt and command IDs. Git HEAD, working-tree status, and a
diff digest help identify the source version, but the digest cannot reconstruct uncommitted or
untracked files. Pin source and script versions when strict comparisons are required.

The first successful verification freezes the task result. Later commands are recorded under
`after` and do not change the completed cost totals. Run `reset` to start another comparison.
A failed manual verification allows further repairs; a script failure ends the attempt.

The read-only page does not modify Revision or Presentation data and does not mark attempts as
`mixed`. Semantic changes made directly through other clients still mark an attempt as `mixed`,
excluding it from pure CLI cost comparisons. Presentation differences are reported separately.

## Script regression tests without model costs

```bash
bun run lab test
bun run lab test edit-code
bun run lab test fix-notification --keep-failed
```

The four scenarios cover prompt changes, notification input repairs, coordinated code and
downstream input changes, and creation from an empty flow. Each reference script starts in a
clean environment, reads state, queries schemas, submits edits, checks the flow, and invokes
the shared acceptance verifier.

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

| Layer               | Measurements                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------- |
| CLI operations      | Count, read/write/execute/validate classification, exit codes, duration, exact replay count |
| Caller-visible data | Argument text, consumed file/stdin content, stdout, stderr                                  |
| HTTP                | Request count, method/path, status, request and response bodies                             |

All sizes are measured in UTF-8 bytes. Argument text is calculated by joining argv elements with
a single space. It excludes shell quoting, the Lab invocation prefix, and the shell's own output.
The original argv array is also retained.

Files are identified by their resolved filesystem paths. Repeated reads within one command count
once; resubmitting the same file in another command counts again. File and stdin content are
counted separately from paths in command arguments. A full Revision fetched internally but not
shown to the caller counts only at the HTTP layer. HTTP sizes measure bodies consumed by the
transport adapter, excluding headers, TLS overhead, and compression overhead. Responses and
terminal output are counted incrementally as they stream.

Initialization, reset, and Lab acceptance verification are excluded from task costs. Explicit
`check`, `run`, and status polling calls made by task scripts are included. Requests are marked
as replays only when their method, path, idempotency key, and body match exactly. Lab does not
infer whether a modified request after an error is a retry. Nonzero exit codes are reported
separately; they include production CLI waiting/timeout states and do not always indicate a
failed edit.

Summed command duration and task wall-clock time are reported separately. Human thinking time
is part of wall-clock time. Successful verification freezes task wall-clock time at the moment
verification began; the final acceptance run does not contribute to command costs. Byte counts
are neither token estimates nor model billing estimates.

## Adding scenarios

The development host lives in `apps/server/scripts/lab/`:

- `scenarios.ts` defines stable scenario IDs, versions, tasks, initialization operations,
  acceptance assertions, and reference edits.
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
