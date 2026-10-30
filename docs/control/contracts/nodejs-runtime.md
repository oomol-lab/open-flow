# Node compatibility runtime contract

`open-flow-engine/v9` is the single current contract. It includes the fixed builtin module allowlist
below and `context.fetch` (see [Code HTTP access](#code-http-access)). The published
`open-flow-engine/v8/nodejs-compat-v1` has the same allowlist without `context.fetch`, and the base
`open-flow-engine/v8` has no builtins; both remain supported for existing Publications and Runs.

The public package owns the guest implementation of the builtin modules as
`@oomol-lab/open-flow/runtime-nodejs-compat`. A deployment supplies the bridge described there:
synchronous primitives backed by `createNodejsPrimitives`, timers, and synchronous evaluation of
lazily loaded builtin groups. The guest bundle is generated with `bun run generate:nodejs-builtins`
from pinned dependencies; `bun run check` verifies it is current.

The published `open-flow-engine/v6` and `open-flow-engine/v6/nodejs-compat-v1` remain supported for
existing Publications and Runs, with their original platform identity and builtin allowlist.
Webhook response nodes require v7; v6 cannot prepare them.

`EngineContract.builtinModules` declares accepted builtin specifiers. The list explicitly includes
both prefixed and bare forms. Static validation recognizes these imports without adding dependencies
to the user module closure. User `CodeModule.imports` still contains only user module identities.
This contract does not permit unknown packages, private runtime modules, dynamic imports, or
CommonJS require. The runtime linker checks named exports. The platform module exports the selected
contract identity, including for this additional contract.

The allowlist contains `assert`, `assert/strict`, `buffer`, `console`, `constants`, `crypto`,
`events`, `fs`, `fs/promises`, `os`, `path`, `path/posix`, `process`, `punycode`, `querystring`,
`stream`, `stream/promises`, `stream/web`, `string_decoder`, `timers`, `timers/promises`, `url`,
`util`, and `zlib`, plus their `node:` forms. It does not authorize arbitrary package resolution or
installation.

This contract is a Node compatibility subset, not a claim of complete Node.js or Workers API parity.
Each deployment must document its resource limits and any APIs it adds beyond the guaranteed
behavior below. Deployments continue running the original runtime conformance for the original
contract.

## Guaranteed behavior

Every deployment of this contract provides the same observable subset; implementation details and
limits stay with the deployment.

- `node:` and bare builtin names resolve to the same module instance within a Task. `Buffer`,
  `process`, `URL`, `URLSearchParams`, Web Streams, `AbortController` and `AbortSignal` are also
  globals and are identical to their module exports.
- `process.cwd()` is `/tmp` and `process.env` is empty. No host process, environment or machine
  information is exposed.
- `events`, `string_decoder`, POSIX `path`, `querystring`, `url` and `util.promisify` follow Node.
  `URL` follows the WHATWG standard, including `URL.canParse`. Windows paths are not covered.
- `buffer` supports UTF-8, base64, hex, ASCII, Latin-1 and UTF-16LE encodings.
- `TextEncoder` and `TextDecoder` handle text of any size within the memory limit, including
  streaming decodes, and a Task may create any number of decoders.
- `crypto` provides incremental `createHash` and `createHmac` for the SHA family and MD5,
  `randomBytes`, `randomUUID` and `getRandomValues`. Web Crypto `subtle` is not part of the contract.
- `zlib` provides one-shot gzip, gunzip, deflate, inflate, deflateRaw, inflateRaw and unzip. Brotli
  and Zstandard are not part of the contract.
- `fs` and `fs/promises` operate on a fresh in-memory filesystem per Task, initially containing
  `/tmp`, and report Node error codes such as `ENOENT`.
- `timers`, `timers/promises`, Node streams, `stream/promises` and Web Streams are available.
  `AbortSignal` supports reasons, `throwIfAborted`, `any`, `timeout` and `abort`. Node event-loop
  phase ordering is not emulated.
- Files, globals, intrinsic changes and builtin module state never cross Task invocations.

Networking (`fetch`, HTTP, DNS, TCP, TLS), `async_hooks`, subprocesses, Worker threads, `require`,
dynamic imports and package installation are outside this contract. `nodejsRuntimeConformanceCases`
verifies the list above.

Virtual files belong to one Task invocation. They have no implicit connection to the host filesystem
or to durable storage. Node compatibility does not grant additional business capabilities. Error
subclasses and library initialization may use mutable guest intrinsics. The runtime must isolate
these intrinsics from other Task invocations. Task termination revokes associated asynchronous work
and capabilities.

## Code HTTP access

Engine v9 Code calls HTTP(S) APIs with `context.fetch(input, init?)` only for hosts its node declares
in the Model v12 Capability `{ kind: "http", hosts }`. Hosts are lowercase DNS names or IPv4
addresses, at most 20; `*.example.com` matches subdomains, not the apex. Deployments deny other
hosts with `capability.denied` and URLs with credentials or other schemes before any request.

`init` accepts `method` (GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS), `headers` as an object or
name/value pairs, `body` as a string, `Uint8Array` or `ArrayBuffer`, and `signal`. Bodies are at
most 1 MiB in each direction. Deployments manage `host`, `content-length` and hop-by-hop headers,
add no platform credentials, return redirects instead of following them, drop `set-cookie`, and
bound each request in time. The result is a read-only subset of the Fetch `Response`: `status`,
`statusText`, `ok`, `url`, `redirected: false`, `headers` (`get`, `has` and iteration), and a
buffered body read once through `text()`, `json()`, `bytes()` or `arrayBuffer()`. Network failures
and oversized bodies reject the call. A request that fails without a complete response is
retryable only for GET, HEAD and OPTIONS, because the target may already have acted on other methods. The guest sends one `http.fetch` Capability call per request;
`createFetch` owns that protocol, and runtime conformance covers it.

Engine v9 removes the always-denied `context.egress` placeholder.

## Handled task failures

Engine v6 supports node-owned `onError` handling for ordinary Code, Connector, OpenAPI, LLM and
AI Decision Tasks. Hosts preserve trusted `catchable` separately from `retryable`; absent
classification forbids handling. Resource limits, cancellation, deadlines, protocol/isolation and
indeterminate failures cannot be handled. System outputs use an independent namespace and are
available to downstream inputs and `getPrevious().systemOutputs`; they do not add execution ports.

## Workflow tools

Engine v8 exposes `context.workflows.call(alias, input)` for explicitly declared workflow
capabilities. Each call creates an independently identified child Run against current Live, after
ownership, interface, input and recursion checks. Results contain only workflow business outputs;
a workflow without Outputs returns `{}`. Concurrent calls, including `Promise.all`, are supported.
The calling node remains active and its deadline continues during child Wait or approval. These
in-memory calls are not restartable JavaScript checkpoints. Ending the node or parent cancels
unfinished calls; unconfirmed execution remains indeterminate after restart.

## Artifacts

Engine v8 `context.artifact` stores bytes that belong to the current Run, available under both the
base and the Node compatibility contract. `put(data, { name, mediaType? })` accepts a string (stored
as UTF-8) or `Uint8Array` and returns `ArtifactRef { kind: 'artifact', id, name, mediaType?, size,
digest }`, where `digest` is `sha256:` followed by 64 lowercase hexadecimal characters. The reference
is a JSON value; ports declare it with `contentMediaType: 'oomol/artifact'` and downstream Tasks in the
same Run read it with `open(ref)`, which resolves to a `Uint8Array`. Blobs and streams are not
accepted. Each `put` produces a `node.artifact` event.

The public `createArtifacts` guest helper transfers base64 chunks of at most 512 KiB through three
Capability kinds:

| Kind             | Payload                                               | Response body                     |
| ---------------- | ----------------------------------------------------- | --------------------------------- |
| `artifact.write` | `{ upload?, data }`                                   | `{ upload }`                      |
| `artifact.put`   | `{ upload?, name, mediaType?, data }`, the last chunk | `ArtifactRef`                     |
| `artifact.read`  | `{ id, offset }`                                      | `{ data, size }`, at most 512 KiB |

Uploads belong to one Task invocation and are discarded when it ends. A reference from another Run is
denied. Deployments own storage, retention and the per-Artifact and per-Run size limits; exceeding
them is a non-catchable `limit-exceeded` failure. Invalid arguments fail with `capability.invalid`
before Host dispatch.

## Flow State (Engine v10)

Code receives `context.state.get(key)`, `set(key, value)`, `insert(key, value)`, `delete(key)` and
`list()`. Keys contain 1 to 256 UTF-8 bytes. Values are strictly JSON, checked before serialization.
Get returns an independent value or null; list returns sorted keys. Set with null deletes. Insert
rejects null and returns false without replacing an existing key. Writes persist immediately,
even if the Task subsequently fails or the Run is canceled. State is not a credential store.

`context.dedupe.insert(ids)` returns aligned booleans indicating newly recorded identities;
`has(ids)` only checks membership. Identities are strings or finite numbers. Public common code
hashes UTF-8 `${typeof id}:${String(id)}` with SHA-256 and retains its first 16 bytes; -0 equals 0.
No original identities are stored. Code uses only the shared `flow` space; node spaces are private.
Run source fixes isolated Draft or Live scope. Calls after Task or Run termination are denied.
Agent code tools do not receive State. State calls emit no events and do not log values.

Increasing mode compares finite numbers numerically or RFC 3339 timestamps by epoch milliseconds.
Timestamps require seconds, an explicit Z or numeric timezone and at most three fractional digits.
Invalid dates or mixed types (including the saved watermark) fail the whole batch. Items compare
to the initial watermark, equal values count once, and the maximum is committed after the batch.
Input order is retained. Empty batches preserve the watermark in the same mode; switching modes resets the space even with an empty batch. Code insert resets increasing spaces
to set mode atomically; Code has rejects increasing spaces without changing them.

Capability kinds and payloads: `state.get`/`state.delete` use `{ key }`, `state.set`/`state.insert`
use `{ key, value }`, `state.list` uses `{}`, and `dedupe.insert`/`dedupe.has` use `{ ids }`.
Responses respectively contain `{ value }`, null, null, `{ inserted }`, `{ keys }`,
`{ inserted }` and `{ present }`. Invalid parameters fail with `capability.invalid`.
Exhausted identity or space slots fail with catchable `dedupe.full`; exhausted saved-key slots, oversized values or the write budget fail with
non-catchable `limit-exceeded`. Capacity failure writes nothing, while all-duplicate batches still
succeed at capacity. Mode switches and record counts commit in the same transaction.

Default limits per Flow/source are 1,000 saved keys, 64 KiB per JSON value, 10,000 identities shared across all spaces, 100 spaces, and
1,000 attempted writes per Run. Each set/insert/delete or dedupe batch consumes one durable write
allowance, including failed writes. Reads consume no
write allowance. Publishing, rollback and node editing do not clear history.

State count limits allow updates and deletion at capacity. Keys and dedupe space names are limited to 256 UTF-8 bytes. Watermark spaces consume one space slot but no identity slots. Switching mode releases the previous identities atomically; rejected batches preserve the previous state. There is no separate total byte quota.
