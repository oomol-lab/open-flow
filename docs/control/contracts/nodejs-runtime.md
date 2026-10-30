# Node compatibility runtime contract

`open-flow-engine/v8/nodejs-compat-v1` extends the v2 execution model with a fixed builtin module
allowlist. The base `open-flow-engine/v8` contract remains available. Deployments advertise this
additional contract only when they implement it; Server does not automatically opt into it.

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
