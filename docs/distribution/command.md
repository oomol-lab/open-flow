# Command distribution and invocation

`packages/command` owns CLI arguments, output and the host boundary. The public
`@oomol-lab/open-flow` npm package distributes its compiled entry under `/command`
alongside the product APIs and skill templates. Hosts such as `oo-cli` install a
fixed package version and bundle the command into their own build.

## Command entry

```ts
import { runOpenFlowCommand, type OpenFlowCommandHost } from '@oomol-lab/open-flow/command'

const host: OpenFlowCommandHost = {
  cloudRequest: authenticatedControlRequest,
  getWorkbenchUrl: workbenchUrl,
  language: 'en',
}
const exitCode = await runOpenFlowCommand(args, host)
```

`args` contains arguments after `oo flow`. The function returns an integer exit code
in `0..255`, uses process stdin/stdout/stderr, and does not call `process.exit()`.
Importing the entry does not execute the CLI or change the process exit code.
The package includes generated TypeScript declarations, bundled runtime dependencies
and its own version; consumers need no workspace paths or build constants.
The command targets Bun 1.4.2 or newer, not browsers or Node.js.

The host owns identity, deployment selection and Workbench URLs. Optional
`cloudRequest(path, init)` returns a `Response` for deployment-relative `/v1/`
Control API paths. Restrict requests to the selected deployment and reject forged
authorization headers. Optional `getWorkbenchUrl(flowId?)` returns the official
Workbench URL. The command neither stores deployment selection nor infers scope
from the working directory. It runs in the trusted host process, not a sandbox.

Optional `language` accepts BCP 47 tags and resolves to en, zh-CN, zh-TW, ja, ko,
ru or fr. Help, local schemas and version work without a host. Other operations
require `cloudRequest`; open/workbench also require `getWorkbenchUrl`.
Localized help is bundled in the command entry. Root `--help` lists commands;
subcommands show options and examples; `--help --json` returns their contract.

## Build and verification

The public package build invokes the command workspace's build script to place
JavaScript, declarations and dependency licenses in `dist/command` before packing.
CLI implementation stays in `packages/command`, which consumes public Open Flow
entries. This is build-time assembly, with no circular npm dependency.

`bun run test:npm-package` installs the actual tarball in an isolated consumer,
checks the command types, imports and invokes it, then bundles a host as JavaScript
and a standalone executable and runs both after removing installed dependencies. Command changes also trigger this
package check in CI. There is no separate command archive, download manifest,
runtime cache or OSS publication flow.

## Skill resources and development entry

The same package ships templates:

- `@oomol-lab/open-flow/skills/open-flow/SKILL.md`
- `@oomol-lab/open-flow/skills/open-flow/references/flow-authoring.md`
- `@oomol-lab/open-flow/skills/open-flow/references/flow-n8n-conversion.md`

Render these with `agentic-markdown` and a `flowCommand` variable: `oo flow` for
the host or `bun run flow --` for local development. The `localDevelopment`
presence variable includes repository connection guidance. Hosts own login,
deployment selection and installation instructions. Pin one npm version for both
commands and templates; `./package.json` exposes that version.

Within the workspace, `@oomol-lab/open-flow-command/development` exports `runCommand`
and `OpenFlowCommandHost`. Development tools provide connection, version, command
prefix and scope guidance while reusing the production CLI. See
[Contributing](../../CONTRIBUTING.md#local-flow-cli-and-skill).

## CLI invocation contract

[The shared Flow skill reference](../../packages/open-flow/skills/open-flow/references/flow-authoring.md) owns CLI workflows and Agent instructions. This document defines the artifact behavior observable by hosts and scripts. Use the matching artifact’s `--help` and public schema for command arguments, node fields, and examples.

The CLI stores no current Flow or local transaction. The host selects the team and deployment. Flow references accept an ID or a unique full name.

### Arguments and request adaptation

`read/search/edit` accept two mutually exclusive input forms:

- `--input`: JSON, `@file`, or `-`.
- `--file path|-`: read from a file or stdin.

MCP accepts the same request directly, with an additional `flowId`. `schema TYPE` and request schemas are available offline. Action queries require a deployment.

`read/search/edit/check --help --json` includes the command’s request schema, constraints, and examples. Text help includes the same instructions and examples. `schema check` describes the public request field `revisionId`; the CLI supplies it through `--revision`.

`--help --json` does not access the deployment. Options accept `--option value` or `--option=value`. Use the latter for values that start with `-`; a standalone `-` means stdin. Unsupported options, repeated single-value options, and missing values are rejected before a request is sent.

See [Node authoring](../control/contracts/control-api.md#node-authoring) for public read, edit, validation response, and idempotent retry semantics. The CLI does not expose the underlying ChangeOperation to callers.

Flow creation, execution, publication, and rollback retain their existing responsibilities and `--idempotency-key`. Draft Run and Publish pin `--expected-revision`. Publish, Rollback, and Live Run pin `--expected-publication`; use `none` for the first publication.

### Output and errors

The CLI writes normal results to stdout and invocation errors to stderr. `--json` makes both machine-readable. A failed `check` writes structured diagnostics once to stdout and exits with 1. Event following uses NDJSON.

`read/search/edit` return the same business objects as MCP and HTTP directly. Other existing commands retain their wrappers, such as `check.check` and `runs show.run`.

| Exit code | Meaning                                                                                                                                                 |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0         | Operation succeeded, asynchronous creation was accepted, or waiting reached a successful terminal state. Check validation separately for Edit validity. |
| 1         | Invocation error, failed validation, or a wait/result query returned failed, canceled, or indeterminate.                                                |
| 2         | The Run is waiting. Handle the returned actions.                                                                                                        |
| 3         | Waiting timed out, or the queried publication operation is still pending. The underlying operation continues.                                           |

### Execution and waiting

A Run pins one Trigger. The CLI selects it automatically if the graph has exactly one Manual Trigger. Otherwise, use `--trigger`. `--outputs` accepts a JSON object indexed by port name. Its default, `{}`, is suitable for Manual. Other Triggers require complete outputs.

When a pending decision is detected, wait commands return the Run detail’s `waits` array. Each item includes `waitId`, `nodeId`, `prompt`, `actions`, and an expiry time. The Run can still be running. Use `runs list --pending-wait` to find all Runs with pending waits.

`runs resolve` requires an explicit run, wait, and action (continue/approve/reject). The CLI does not decide for the user.

`--timeout` is a wait budget in milliseconds, with a default of 60000. It limits CLI waiting and does not cancel a Run or publication. `runs events --follow --json` writes one line per page without accumulating the full history. Resume with the returned `nextAfter`. If a later read fails, the error retains the run ID and the cursor already emitted.

`publish` waits until the publication operation completes or times out. A timeout result retains `flowId` and `operation.operationId`. Query it with `publications operation FLOW_ID OPERATION_ID`, or continue waiting with `publications wait FLOW_ID OPERATION_ID --timeout 60000`.

### Published resources

`resources FLOW_ID [RESOURCE_ID] [--publication PUBLICATION_ID] [--json]` reads resources
from the current Live publication by default. Supply a resource ID from the list for its detail,
or `--publication` to select a fixed publication. Use `publications list FLOW_ID` to find historical IDs.

JSON results have `kind: "flow.resources"` with `resources`, or `kind: "flow.resource"` with
`resource`. Both include `flowId`, `publicationId`, `revisionId`, `status` (`live` or `historical`),
and `version: 1`. Live results also include the Flow's `enabled` flag. Each resource includes
`resourceId`, `kind`, `type`, `name`, optional `description`, business `config` and `inputs`.
Current resources may include `runtime` with Trigger health and a Webhook `endpointUrl`.
Use `enable` / `disable` on the Flow to control all of its Triggers together.

The first resource kind is `trigger`, with types `webhook`, `cron`, `poll`, `integration`, and
`error`. Resource IDs are the corresponding node IDs. Manual entry nodes have no runtime binding
and are not listed. Historical results contain fixed configuration only, with no `runtime`,
current health, or callable URL. Selecting a publication that is still Live returns its current state.
An unpublished Flow returns `live.not-found`; a missing resource returns `resource.not-found`.

### Result pagination

`runs results` returns the `resultId` of a complete tool result. `runs read-result` supports JSON Pointer and pagination. `runs download-result` writes raw JSON to stdout. Reading an existing result does not call the external tool again.

If a list includes `nextAfter`, pass it to `runs results RUN_ID --after NEXT_AFTER`. If a page includes `nextOffset`, use that value as the next `read-result` offset. Offsets in long strings count Unicode code points.
