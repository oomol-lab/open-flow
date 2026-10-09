# Node compatibility runtime contract

`open-flow-engine/v5/nodejs-compat-v1` extends the v2 execution model with a fixed builtin module
allowlist. The existing `open-flow-engine/v5` contract is unchanged. Deployments advertise this
additional contract only when they implement it; Server does not automatically opt into it.

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
Each deployment must document the APIs it supports and its resource limits. The baseline includes
Buffer and path operations, asynchronous temporary file reads/writes, and Abort-aware Promise
timers. `nodejsRuntimeConformanceCases` verifies those behaviors; deployments continue running the
original runtime conformance for the original contract.

Virtual files belong to one Task invocation. They have no implicit connection to the host filesystem
or to durable storage. Node compatibility does not grant additional business capabilities. Error
subclasses and library initialization may use mutable guest intrinsics. The runtime must isolate
these intrinsics from other Task invocations. Task termination revokes associated asynchronous work
and capabilities.
