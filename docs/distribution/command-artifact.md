# Command Artifact v2 distribution contract

This document defines the immutable Command Artifact delivered to the `oo flow` host, its entry host contract, and verification rules. See [Product and architecture boundaries](../architecture.md) for product ownership. The artifact distributes CLI code. It contains no Workbench, Server, or local persistence implementation.
`packages/command` owns its editable source, build, verification, and release entry points. `packages/open-flow` provides the public product API consumed by Command.

## Versions and release records

Each host release pins one Open Flow artifact:

```ts
interface OpenFlowCommandRelease {
  readonly format: 'open-flow-command-release'
  readonly version: 1
  readonly openFlowVersion: string
  readonly bunVersion: string
  readonly archive: {
    readonly url: string
    readonly length: number
    readonly digest: string
  }
}
```

`url` identifies an immutable object. `length` is the exact gzip archive size in bytes. `digest` is its 64-character lowercase SHA-256. To update an artifact, upload the new digest object first, then pin the new release record in the host. Do not overwrite an old object or use a mutable `latest` URL.

## Archive and manifest

The artifact is a deterministic gzip-compressed USTAR archive with one `open-flow-command/` root:

```text
open-flow-command/
├── command-artifact.json
├── entry.js
├── LICENSE
├── NOTICE
└── LICENSE.md
```

The file set is closed. Files absent from the manifest, links, directory entries, devices, PAX metadata, and other special entries are invalid. The mode is `0755` for `entry.js` and `0644` for all other files.

```ts
interface CommandArtifactManifest {
  readonly format: 'open-flow-command-artifact'
  readonly version: 2
  readonly openFlowVersion: string
  readonly bunVersion: string
  readonly entry: 'entry.js'
  readonly files: readonly {
    readonly path: string
    readonly length: number
    readonly digest: string
  }[]
}
```

The manifest uses UTF-8, LF endings, and canonical JSON. Object keys and `files` use Unicode code-point order. Unknown fields, duplicate paths, non-finite numbers, and non-canonical representations are forbidden. A path must be a nonempty relative POSIX path that USTAR can represent without extension headers. Absolute paths, Windows drive prefixes, backslashes, NUL, empty segments, `.` and `..` are forbidden.

The builder fixes uid, gid, mode, mtime, gzip headers, and file order. The same source tree and pinned tool versions must produce identical archive bytes.

## Command entry

`entry.js` is a single-file ESM bundle built with a pinned Bun version. It exports:

```ts
export const commandArtifactVersion = 2

interface OpenFlowCommandHost {
  readonly cloudRequest?: (path: string, init?: RequestInit) => Promise<Response>
  readonly getWorkbenchUrl?: (flowId?: string) => Promise<string>
  readonly language?: string
}

export function runOpenFlowCommand(args: readonly string[], host: OpenFlowCommandHost): Promise<number>
```

`args` contains arguments after the `oo flow` prefix. The entry returns an integer exit code in `0..255` and does not call `process.exit()`. `cloudRequest` accepts only `/v1/` Control API paths in the current deployment; it is not a general authenticated fetch function. `getWorkbenchUrl` returns the official Workbench deep link for that deployment. The artifact does not store Flow or deployment selection and does not infer resource scope from the working directory.

`language` accepts any BCP 47 tag. The entry resolves it to en, zh-CN, zh-TW, ja, ko, ru, or fr. It maps fr-CA to fr, zh-HK and zh-Hant-\* to zh-TW, and other zh\* tags to zh-CN. Unrecognized tags fall back to en.

Localized CLI titles and option hints come from `packages/command/src/cli/node/locales/<tag>.json`. val-i18n loads them, and the build inlines them into `entry.js`. The artifact distributes no separate locale files. Root `--help` returns the command index. Subcommands return their options and examples. `--help --json` returns the machine-readable contract.
Help, schema, and version require no host. Other commands use cloudRequest as needed; open/workbench also require getWorkbenchUrl.
The sections below define argument adaptation, output, exit codes, and waiting. See [Node authoring](../control/contracts/control-api.md#node-authoring) for public editing semantics.

The artifact runs in the same trusted Bun process as the host. This is not a JavaScript sandbox. The host injects the current identity and rejects cross-origin requests, non-Control API paths, and authorization headers forged by the artifact. The artifact cannot directly call a Connector, Provider, or arbitrary URL returned by Cloud.

## Skill resources and development entry

The public npm package ships the source templates separately from the Command Artifact:

- `@oomol-lab/open-flow/skills/open-flow/SKILL.md`
- `@oomol-lab/open-flow/skills/open-flow/references/flow-authoring.md`
- `@oomol-lab/open-flow/skills/open-flow/references/flow-n8n-conversion.md`

Render these with `agentic-markdown` and a `flowCommand` variable. The local skill uses
`bun run flow --`; the oo host uses `oo flow`. The standalone entrypoint accepts the
`localDevelopment` presence variable for repository connection guidance. Hosts own their
login, deployment selection and installation instructions. `./package.json` exposes the
npm version so hosts can require it to match their pinned Command Artifact version.

Within this workspace, `@oomol-lab/open-flow-command/development` exports `runCommand`
and `OpenFlowCommandHost`. The Server development tools provide the connection and pass
version, command prefix and scope guidance. This reuses production argument parsing,
Control API calls and process I/O; it does not add files or fields to Artifact v2.
See [Contributing](../../CONTRIBUTING.md#local-flow-cli-and-skill) for local usage.

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

### Result pagination

`runs results` returns the `resultId` of a complete tool result. `runs read-result` supports JSON Pointer and pagination. `runs download-result` writes raw JSON to stdout. Reading an existing result does not call the external tool again.

If a list includes `nextAfter`, pass it to `runs results RUN_ID --after NEXT_AFTER`. If a page includes `nextOffset`, use that value as the next `read-result` offset. Offsets in long strings count Unicode code points.

## Download, verification, and cache

When installing an artifact, the host must:

1. Use the pinned URL in the release record.
2. Verify HTTP success, exact archive length, and SHA-256.
3. Download to a temporary file on the cache filesystem.
4. Use a cross-process lock for the same digest.
5. Strictly decode gzip, USTAR metadata, entry types, and paths.
6. Verify the manifest, complete file set, and each file’s length and digest.
7. Commit the cache directory by atomic rename only after all checks pass.
8. Use cache hits without network access. Redownload only the same pinned archive for a corrupt entry.
9. On failure, execute no partial content and do not fall back to an old protocol or unverified version.

The cache uses a separate namespace:

```text
<oo-cache>/open-flow/command-artifact-v2/<archiveDigest>/
```

## Release acceptance

Before release, verify at least:

- Two clean builds produce identical archive bytes.
- The archive has the exact file set, manifest, and per-file digests.
- The extracted entry can be imported.
- A fake host completes the main Flow read, create, and check commands.
- Reads of the same remote Flow return the same result from different working directories.
- The host rejects cross-origin/path requests and overrides forged identity headers.
- The current loader does not execute the old cache namespace.

Upload the artifact before changing the release record. Any byte change requires a new digest object. A released host version must not silently execute new code.
