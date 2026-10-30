import type { CodeModule, ConnectorCapability, TaskCapability, JsonValue } from '../../flow/common/model.ts'

import { dequal } from 'dequal/lite'
import { currentEngineContract } from './engineContract.ts'

export { currentEngineContract, nodejsEngineContract, findEngineContract, type EngineContract } from './engineContract.ts'

export type RuntimeModule = Pick<CodeModule, 'imports' | 'source'>

/** Snapshot a Task result before JSON transport can discard or coerce invalid values. */
export function snapshotRuntimeResult(value: unknown): JsonValue | undefined {
  // This function is also serialized into the isolated runtime; keep it self-contained.
  const parents = new Set<object>()
  const copy = (item: unknown, depth: number): JsonValue => {
    if (depth > 64) throw new Error('Task result exceeds the maximum JSON depth.')
    if (item === null || typeof item == 'string' || typeof item == 'boolean') return item
    if (typeof item == 'number' && Number.isFinite(item)) return item
    if (
      typeof item != 'object' ||
      parents.has(item) ||
      (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) ||
      Object.getOwnPropertySymbols(item).length > 0
    )
      throw new Error('Task result must contain only JSON values.')
    parents.add(item)
    const result = Array.isArray(item)
      ? Array.from(item, (child) => copy(child, depth + 1))
      : Object.fromEntries(
          Object.entries(item)
            .filter(([, child]) => depth != 0 || child !== undefined)
            .map(([key, child]) => [key, copy(child, depth + 1)]),
        )
    parents.delete(item)
    return result
  }
  return value === undefined ? undefined : copy(value, 0)
}

export const nodejsRuntimeConformanceCases: readonly RuntimeConformanceCase[] = [
  {
    name: 'supports Node builtin imports and asynchronous virtual file operations',
    async verify(harness) {
      const value = await harness.invoke({
        capability: async () => ({ body: null, status: 403 }),
        input: null,
        invocationId: 'nodejs-files',
        program: program(
          harness,
          `import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer'; import path from 'node:path'; import fs from 'node:fs/promises';
export default async () => {
  const file = path.join('/tmp', 'conformance.txt');
  await fs.writeFile(file, Buffer.from('你好'));
  const text = await fs.readFile(file, 'utf8');
  assert.equal(text, '你好');
  await fs.unlink(file);
  return { text, bytes: Buffer.byteLength(text) };
}`,
        ),
      })
      equal(value, { text: '你好', bytes: 6 }, 'Node virtual files')
    },
  },
  {
    name: 'preserves abort reasons and cancels Promise timers',
    async verify(harness) {
      const value = await harness.invoke({
        capability: async () => ({ body: null, status: 403 }),
        input: null,
        invocationId: 'nodejs-abort',
        program: program(
          harness,
          `import { setTimeout } from 'node:timers/promises';
export default async () => {
  const controller = new AbortController(); const reason = { message: 'stop' };
  const combined = AbortSignal.any([controller.signal]);
  const pending = setTimeout(60000, 'late', { signal: combined });
  controller.abort(reason); controller.abort('ignored');
  let thrown; try { combined.throwIfAborted(); } catch (error) { thrown = error; }
  try { await pending; return false; } catch (error) {
    return { sameReason: combined.reason === reason && thrown === reason, name: error.name };
  }
}`,
        ),
      })
      equal(value, { sameReason: true, name: 'AbortError' }, 'Node cancellation')
    },
  },
  nodejsCase(
    'resolves prefixed and bare builtin names to the same module and shares globals with their modules',
    `import { Buffer } from 'node:buffer'; import bare from 'buffer'; import processModule from 'node:process';
import { URL as ImportedURL, URLSearchParams as ImportedParams } from 'node:url'; import { ReadableStream as ImportedStream } from 'node:stream/web';
export default () => ({ buffer: Buffer === bare.Buffer && Buffer === globalThis.Buffer, process: process === processModule,
  url: URL === ImportedURL && URLSearchParams === ImportedParams, stream: ReadableStream === ImportedStream,
  cwd: process.cwd(), env: Object.keys(process.env) })`,
    { buffer: true, process: true, url: true, stream: true, cwd: '/tmp', env: [] },
  ),
  nodejsCase(
    'supports events, string decoding, paths, query strings, URLs and promisify',
    `import { EventEmitter } from 'node:events'; import { StringDecoder } from 'node:string_decoder'; import { Buffer } from 'node:buffer';
import path from 'node:path'; import qs from 'node:querystring'; import { promisify } from 'node:util';
export default async () => {
  const emitter = new EventEmitter(); let count = 0; emitter.once('value', (x) => (count += x)); emitter.emit('value', 7); emitter.emit('value', 9);
  const decoder = new StringDecoder('utf8'); const bytes = Buffer.from('你好');
  const incremental = new TextDecoder(); const partial = incremental.decode(new Uint8Array([0xe4, 0xbd]), { stream: true });
  const url = new URL('../文件?a=1', 'https://example.com/a/b'); url.searchParams.append('b', 'x y');
  return { count, text: decoder.write(bytes.subarray(0, 2)) + decoder.end(bytes.subarray(2)), partial, rest: incremental.decode(new Uint8Array([0xa0])),
    path: path.join('/tmp', 'a', '..', 'b'), query: qs.parse('a=1&a=2').a, url: url.href, canParse: URL.canParse('not a url'),
    value: await promisify((callback) => callback(null, 42))() };
}`,
    {
      count: 7,
      text: '你好',
      partial: '',
      rest: '你',
      path: '/tmp/b',
      query: ['1', '2'],
      url: 'https://example.com/%E6%96%87%E4%BB%B6?a=1&b=x+y',
      canParse: false,
      value: 42,
    },
  ),
  nodejsCase(
    'encodes Buffers and computes hashes, HMACs, gzip and random values',
    `import { Buffer } from 'node:buffer'; import { createHash, createHmac, randomBytes } from 'node:crypto'; import { gzipSync, gunzipSync, deflateRawSync, inflateRawSync } from 'node:zlib';
export default () => ({ hex: Buffer.from('你好').toString('hex'), base64: Buffer.from('abc').toString('base64'), latin1: Buffer.from([0xe9]).toString('latin1'),
  utf16: Buffer.from('a', 'utf16le').length, hash: createHash('sha256').update('a').update('bc').digest('hex'),
  md5: createHash('md5').update('abc').digest('base64'), hmac: createHmac('sha256', 'key').update('message').digest('hex'),
  gzip: gunzipSync(gzipSync(Buffer.from('你好'))).toString(), raw: inflateRawSync(deflateRawSync('raw')).toString(),
  random: randomBytes(12).length, uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(crypto.randomUUID()),
  values: crypto.getRandomValues(new Uint8Array(4)).length })`,
    {
      hex: 'e4bda0e5a5bd',
      base64: 'YWJj',
      latin1: 'é',
      utf16: 2,
      hash: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
      md5: 'kAFQmDzST7DWlj99KOF/cg==',
      hmac: '6e9ef29b75fffc5b7abae527d58fdadb2fe42e7219011976917343065f58ed4a',
      gzip: '你好',
      raw: 'raw',
      random: 12,
      uuid: true,
      values: 4,
    },
  ),
  nodejsCase(
    'provides an invocation-local filesystem with Node error codes',
    `import fs from 'node:fs'; import fsp from 'node:fs/promises';
export default async () => {
  await fsp.mkdir('/tmp/nested', { recursive: true });
  fs.writeFileSync('/tmp/nested/data', '你好');
  const handle = await fsp.open('/tmp/nested/data', 'r'); const data = await handle.readFile('utf8'); await handle.close();
  await fsp.rename('/tmp/nested/data', '/tmp/nested/moved');
  let missing; try { fs.readFileSync('/etc/passwd'); } catch (error) { missing = error.code; }
  return { data, size: fs.statSync('/tmp/nested/moved').size, entries: fs.readdirSync('/tmp/nested'), missing };
}`,
    { data: '你好', size: 6, entries: ['moved'], missing: 'ENOENT' },
  ),
  nodejsCase(
    'runs timers, Node streams, pipelines and Web Streams',
    `import { setTimeout as delay } from 'node:timers/promises'; import { Readable, Writable } from 'node:stream'; import { pipeline } from 'node:stream/promises';
export default async () => {
  let count = 0; const timer = setInterval(() => { count++; clearInterval(timer) }, 1); const removed = setTimeout(() => { count += 100 }, 1); clearTimeout(removed);
  await delay(10);
  const data = []; for await (const chunk of Readable.from(['a', 'b'])) data.push(chunk);
  let piped = ''; await pipeline(Readable.from(['x', 'y']), new Writable({ write(chunk, _encoding, callback) { piped += chunk.toString(); callback() } }));
  const reader = new ReadableStream({ start(controller) { controller.enqueue('web'); controller.close() } }).getReader();
  return { count, data, piped, web: (await reader.read()).value };
}`,
    { count: 1, data: ['a', 'b'], piped: 'xy', web: 'web' },
  ),
  nodejsCase(
    'supports AbortSignal timeout and pre-aborted signals',
    `import { setTimeout as delay } from 'node:timers/promises';
export default async () => { const timeout = AbortSignal.timeout(1); await delay(10); return { timeout: timeout.reason.name, aborted: AbortSignal.abort().aborted } }`,
    { timeout: 'TimeoutError', aborted: true },
  ),
  nodejsCase(
    'encodes and decodes text larger than one builtin transfer and creates many decoders',
    `export default () => {
  const text = '你😀a'.repeat(400000); const bytes = new TextEncoder().encode(text);
  const decoder = new TextDecoder(); let streamed = '';
  for (let offset = 0; offset < bytes.length; offset += 1000003) streamed += decoder.decode(bytes.subarray(offset, offset + 1000003), { stream: true });
  streamed += decoder.decode();
  let decoded = 0; for (let index = 0; index < 300; index++) decoded += new TextDecoder().decode(new Uint8Array([0x61])).length;
  return { bytes: bytes.length, whole: new TextDecoder().decode(bytes) === text, streamed: streamed === text, decoded };
}`,
    { bytes: 3_200_000, whole: true, streamed: true, decoded: 300 },
  ),
  {
    name: 'isolates files, globals and builtin module state between Task invocations',
    async verify(harness) {
      const invoke = async (invocationId: string, source: string) =>
        await harness.invoke({
          capability: async () => ({ body: null, status: 403 }),
          input: null,
          invocationId,
          program: program(harness, source),
        })
      await invoke(
        'nodejs-isolation-write',
        `import fs from 'node:fs'; import crypto from 'node:crypto';
export default () => { fs.writeFileSync('/tmp/marker', 'x'); URL.prototype.taskMarker = true; crypto.constants.taskMarker = true; globalThis.taskMarker = true }`,
      )
      const value = await invoke(
        'nodejs-isolation-read',
        `import fs from 'node:fs'; import crypto from 'node:crypto';
export default () => ({ file: fs.existsSync('/tmp/marker'), url: 'taskMarker' in URL.prototype, module: 'taskMarker' in crypto.constants, global: 'taskMarker' in globalThis })`,
      )
      equal(value, { file: false, url: false, module: false, global: false }, 'Task isolation')
    },
  },
]

/** Reference Artifact Host for the guest chunk protocol; deployments own storage, identity and limits. */
function artifactHost() {
  const chunkBytes = 512 * 1024
  const uploads = new Map<string, Uint8Array[]>()
  const artifacts = new Map<string, Uint8Array>()
  const kinds: string[] = []
  let nextUpload = 0
  const capability = async (call: RuntimeCapabilityCall): Promise<RuntimeCapabilityResponse> => {
    kinds.push(call.kind)
    const payload = call.payload as Readonly<Record<string, JsonValue>>
    if (call.kind == 'artifact.write') {
      const upload = typeof payload.upload == 'string' ? payload.upload : `u${++nextUpload}`
      uploads.set(upload, [...(uploads.get(upload) ?? []), decodeBase64(payload.data!)])
      return { body: { upload }, status: 200 }
    }
    if (call.kind == 'artifact.put') {
      const parts = [...(typeof payload.upload == 'string' ? (uploads.get(payload.upload) ?? []) : []), decodeBase64(payload.data!)]
      const bytes = new Uint8Array(parts.reduce((size, part) => size + part.length, 0))
      parts.reduce((offset, part) => (bytes.set(part, offset), offset + part.length), 0)
      const id = `a${artifacts.size + 1}`
      artifacts.set(id, bytes)
      return {
        body: {
          kind: 'artifact',
          id,
          name: payload.name!,
          size: bytes.length,
          digest: artifactDigest(id),
          ...(payload.mediaType == null ? {} : { mediaType: payload.mediaType }),
        },
        status: 200,
      }
    }
    if (call.kind == 'artifact.read') {
      const bytes = artifacts.get(String(payload.id))!
      const offset = Number(payload.offset)
      return { body: { data: encodeBase64(bytes.subarray(offset, offset + chunkBytes)), size: bytes.length }, status: 200 }
    }
    throw new Error(`Unexpected Capability ${call.kind}.`)
  }
  return { capability, digest: artifactDigest, kinds: () => kinds }
}

function decodeBase64(text: JsonValue): Uint8Array {
  return Uint8Array.from(atob(String(text)), (character) => character.charCodeAt(0))
}

function encodeBase64(bytes: Uint8Array): string {
  return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''))
}

function artifactDigest(id: string): string {
  return `sha256:${id.slice(1).padStart(64, '0')}`
}

function nodejsCase(name: string, source: string, expected: JsonValue): RuntimeConformanceCase {
  return {
    name,
    async verify(harness) {
      const value = await harness.invoke({
        capability: async () => ({ body: null, status: 403 }),
        input: null,
        invocationId: `nodejs-${name}`,
        program: program(harness, source),
      })
      equal(value, expected, name)
    },
  }
}

export interface RuntimeProgram {
  readonly engineContract: string
  readonly engineDigest: string
  readonly entryModuleId: string
  readonly modules: Readonly<Record<string, RuntimeModule>>
}

export interface RuntimeCapabilityCall {
  readonly nodeId?: string
  readonly jobId?: string
  readonly callId: string
  readonly invocationId: string
  readonly kind: string
  readonly payload: JsonValue
  readonly signal: AbortSignal
}

export interface RuntimeCapabilityResponse {
  readonly body: JsonValue
  readonly status: number
}

export interface LlmTaskInvocation {
  readonly input: Readonly<Record<string, JsonValue>>
  readonly invocationId: string
  readonly mode: 'chat' | 'json'
  readonly signal: AbortSignal
  readonly version: 1
}

export type LlmTaskResult =
  | { readonly kind: 'completed'; readonly value: JsonValue; readonly version: 1 }
  | {
      readonly retryable?: boolean
      readonly code: 'llm.output-invalid' | 'llm.unavailable'
      readonly kind: 'failed'
      readonly message: string
      readonly version: 1
    }

export type InvokeLlmTask = (invocation: LlmTaskInvocation) => Promise<LlmTaskResult>

export interface AgentCheckpoint {
  readonly state: JsonValue
  readonly callId: string
  readonly toolId: string
  readonly input: Readonly<Record<string, JsonValue>>
  readonly rounds: number
  readonly version: 1
}

export type AgentResult = { readonly kind: 'completed'; readonly output: JsonValue } | { readonly kind: 'suspended'; readonly checkpoint: AgentCheckpoint }

export interface AgentInvocation {
  readonly input: Readonly<Record<string, JsonValue>>
  readonly invocationId: string
  readonly signal: AbortSignal
  readonly resume?: { readonly action: 'approve' | 'reject'; readonly checkpoint: AgentCheckpoint }
}

export interface RuntimeInvocation {
  readonly capabilities?: readonly TaskCapability[]
  readonly capability: (call: RuntimeCapabilityCall) => Promise<RuntimeCapabilityResponse>
  readonly input: JsonValue
  readonly invocationId: string
  readonly program: RuntimeProgram
  readonly signal?: AbortSignal
}

export interface RuntimeHarness {
  readonly engineDigest: string
  invoke(invocation: RuntimeInvocation): Promise<JsonValue | undefined>
}

export interface RuntimeConformanceCase {
  readonly name: string
  verify(harness: RuntimeHarness): Promise<void>
}

function program(harness: RuntimeHarness, source: string, modules: Readonly<Record<string, RuntimeModule>> = {}): RuntimeProgram {
  return {
    engineContract: currentEngineContract,
    engineDigest: harness.engineDigest,
    entryModuleId: 'main',
    modules: {
      ...modules,
      main: { imports: Object.keys(modules), source },
    },
  }
}

function equal(actual: unknown, expected: unknown, message: string): void {
  if (!dequal(actual, expected)) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}.`)
  }
}

async function rejects(operation: Promise<unknown>, pattern: RegExp, message: string): Promise<void> {
  try {
    await operation
  } catch (error) {
    if (pattern.test(error instanceof Error ? error.message : String(error))) return
    throw new Error(`${message}: received ${error instanceof Error ? error.message : String(error)}.`, { cause: error })
  }
  throw new Error(`${message}: operation unexpectedly succeeded.`)
}

export const runtimeConformanceCases: readonly RuntimeConformanceCase[] = [
  {
    name: 'rejects Task results that JSON transport would discard or coerce',
    async verify(harness) {
      for (const expression of [
        '{ value: () => 42 }',
        '{ value: Symbol("value") }',
        '{ value: NaN }',
        '{ value: Infinity }',
        '{ value: 1n }',
        '{ value: { nested: undefined } }',
        '{ value: [undefined] }',
        '{ value: Array(1) }',
        '{ value: new Date() }',
        '{ value: { toJSON() { return "hidden" } } }',
        '{ [Symbol("key")]: 1 }',
        '(() => { const value = {}; value.self = value; return { value } })()',
      ]) {
        await rejects(
          harness.invoke({
            capability: async () => ({ body: null, status: 200 }),
            input: null,
            invocationId: 'invalid-task-result',
            program: program(harness, `export default () => (${expression})`),
          }),
          /Task result must contain only JSON values/,
          `Invalid Task result: ${expression}`,
        )
      }
    },
  },
  {
    name: 'snapshots JSON results while preserving missing ports and shared values',
    async verify(harness) {
      const value = await harness.invoke({
        capability: async () => ({ body: null, status: 200 }),
        input: null,
        invocationId: 'json-task-result',
        program: program(
          harness,
          `export default () => {
            const shared = { text: 'hello', values: [1, true, null] };
            return { missing: undefined, nullable: null, first: shared, second: shared };
          }`,
        ),
      })
      const shared = { text: 'hello', values: [1, true, null] }
      equal(value, { nullable: null, first: shared, second: shared }, 'JSON Task result')
    },
  },
  {
    name: 'preserves Action error codes and fixed per-call Connection selection',
    async verify(harness) {
      const declarations: readonly ConnectorCapability[] = [
        {
          kind: 'connector',
          action: 'example.echo',
          connections: [{ connectionId: 'work', alias: 'office' }, { connectionId: 'home' }],
        },
      ]
      const result = await harness.invoke({
        capabilities: declarations,
        capability: async ({ payload }) => {
          const selected = resolveAction(declarations, payload)
          if (selected.input.fail) throw Object.assign(new Error('Provider unavailable.'), { code: 'connector.unavailable' })
          return { body: selected.connectionId ?? null, status: 200 }
        },
        input: null,
        invocationId: 'action-accounts',
        program: program(
          harness,
          `export default async (_, context) => {
          const values = await Promise.all([
            context.actions.example.echo({}, { connectionAlias: 'office' }),
            context.actions['example.echo']({}, { connectionId: 'home' }),
          ])
          try { await context.actions.example.echo({ fail: true }, { connectionId: 'work' }) }
          catch (error) { values.push(error.code) }
          return values
        }`,
        ),
      })
      equal(result, ['work', 'home', 'connector.unavailable'], 'Action selection and recovery')
    },
  },
  {
    name: 'shares Action entries and assigns independent concurrent call identities',
    async verify(harness) {
      const calls: RuntimeCapabilityCall[] = []
      const value = await harness.invoke({
        capabilities: [{ kind: 'connector', action: 'example.echo', connections: [] }],
        capability: async (call) => {
          calls.push(call)
          return { body: call.payload, status: 200 }
        },
        input: null,
        invocationId: 'action-calls',
        program: program(
          harness,
          `export default async (_input, context) => {
          const call = context.actions.example.echo
          return { same: call === context.actions['example.echo'], values: await Promise.all([call({ value: 1 }), call({ value: 2 }), call({ value: 3 })]) }
        }`,
        ),
      })
      equal(value, { same: true, values: [1, 2, 3].map((item) => ({ action: 'example.echo', input: { value: item } })) }, 'Action results')
      equal(new Set(calls.map((call) => call.callId)).size, 3, 'Independent Action identities')
      equal(
        calls.map((call) => call.invocationId),
        ['action-calls', 'action-calls', 'action-calls'],
        'Task identity',
      )
    },
  },

  {
    name: 'loads the fixed ESM closure and platform module',
    async verify(harness) {
      const value = await harness.invoke({
        capability: async () => {
          throw new Error('Capability must not be called.')
        },
        input: { value: 6 },
        invocationId: 'module-closure',
        program: program(
          harness,
          `import { double } from './helper.mjs'
import { engineContract, identity } from 'open-flow:platform'
export default (input) => ({ engineContract, value: identity(double(input.value)) })`,
          { helper: { imports: [], source: 'export const double = (value) => value * 2' } },
        ),
      })
      equal(value, { engineContract: currentEngineContract, value: 12 }, 'ESM closure result')
    },
  },
  {
    name: 'rejects modules outside the fixed closure',
    async verify(harness) {
      await rejects(
        harness.invoke({
          capability: async () => ({ body: null, status: 200 }),
          input: null,
          invocationId: 'closed-linker',
          program: program(
            harness,
            `import { execSync } from 'node:child_process'
export default () => execSync('cat /etc/passwd').toString()`,
          ),
        }),
        /invalid|unsupported|cannot import|not part of/i,
        'Closed linker',
      )
    },
  },
  {
    name: 'copies asynchronous Capability requests and responses',
    async verify(harness) {
      const calls: RuntimeCapabilityCall[] = []
      const value = await harness.invoke({
        capabilities: [{ kind: 'connector', action: 'example.read', connections: [] }],
        capability: async (call) => {
          calls.push(call)
          return { body: { accepted: true, echoed: call.payload }, status: 200 }
        },
        input: { issue: 42 },
        invocationId: 'async-capability',
        program: program(harness, `export default async (input, context) => context.actions.example.read(input)`),
      })
      equal(value, { accepted: true, echoed: { action: 'example.read', input: { issue: 42 } } }, 'Capability result')
      equal(
        calls.map(({ invocationId, kind, payload }) => ({ invocationId, kind, payload })),
        [{ invocationId: 'async-capability', kind: 'connector', payload: { action: 'example.read', input: { issue: 42 } } }],
        'Capability request',
      )
    },
  },
  {
    name: 'stores and reads Artifacts through bounded chunks',
    async verify(harness) {
      const host = artifactHost()
      const value = await harness.invoke({
        capability: host.capability,
        input: null,
        invocationId: 'artifact-roundtrip',
        program: program(
          harness,
          `export default async (_input, context) => {
  const large = new Uint8Array(1200 * 1024).map((_, index) => index % 251)
  const text = await context.artifact.put('你好', { name: 'greeting.txt', mediaType: 'text/plain' })
  const binary = await context.artifact.put(large, { name: 'data.bin' })
  const empty = await context.artifact.put(new Uint8Array(0), { name: 'empty' })
  const read = await context.artifact.open(binary)
  return { text, binary, empty, greeting: new TextDecoder().decode(await context.artifact.open(text)),
    same: read.length == large.length && read.every((byte, index) => byte == large[index]), emptyLength: (await context.artifact.open(empty)).length }
}`,
        ),
      })
      const ref = (id: string, name: string, size: number, mediaType?: string) => ({
        kind: 'artifact',
        id,
        name,
        size,
        digest: host.digest(id),
        ...(mediaType == null ? {} : { mediaType }),
      })
      equal(
        value,
        {
          text: ref('a1', 'greeting.txt', 6, 'text/plain'),
          binary: ref('a2', 'data.bin', 1200 * 1024),
          empty: ref('a3', 'empty', 0),
          greeting: '你好',
          same: true,
          emptyLength: 0,
        },
        'Artifact roundtrip',
      )
      equal(
        host.kinds(),
        [
          'artifact.put',
          'artifact.write',
          'artifact.write',
          'artifact.put',
          'artifact.put',
          'artifact.read',
          'artifact.read',
          'artifact.read',
          'artifact.read',
          'artifact.read',
        ],
        'Artifact chunks',
      )
    },
  },
  {
    name: 'rejects invalid Artifact arguments before Host dispatch',
    async verify(harness) {
      const host = artifactHost()
      const value = await harness.invoke({
        capability: host.capability,
        input: null,
        invocationId: 'artifact-invalid',
        program: program(
          harness,
          `export default async (_input, context) => {
  const codes = []
  for (const call of [() => context.artifact.put({}, { name: 'x' }), () => context.artifact.put('x', {}), () => context.artifact.put('x', { name: 'x', mediaType: 1 }), () => context.artifact.open({ id: 'a1' })]) {
    try { await call() } catch (error) { codes.push(error.code) }
  }
  return codes
}`,
        ),
      })
      equal(
        value,
        Array.from({ length: 4 }, () => 'capability.invalid'),
        'Artifact validation',
      )
      equal(host.kinds(), [], 'Artifact dispatch')
    },
  },
  {
    name: 'calls declared HTTP hosts through context.fetch',
    async verify(harness) {
      const calls: JsonValue[] = []
      const value = await harness.invoke({
        capability: async (call) => {
          calls.push({ kind: call.kind, payload: call.payload })
          return {
            status: 200,
            body: {
              status: 201,
              statusText: 'Created',
              url: 'https://api.example.com/items?q=1',
              headers: [
                ['content-type', 'application/json'],
                ['x-tag', 'a'],
                ['x-tag', 'b'],
              ],
              body: btoa('{"id":7}'),
            },
          }
        },
        input: null,
        invocationId: 'code-fetch',
        program: program(
          harness,
          `export default async (_input, context) => {
  const response = await context.fetch(new URL('https://api.example.com/items?q=1'), { method: 'post', headers: [['X-Trace', '1']], body: '{"name":"a"}' })
  const json = await response.json()
  let reused; try { await response.text() } catch (error) { reused = error instanceof TypeError }
  const codes = []
  for (const call of [() => context.fetch('https://api.example.com', { method: 'TRACE' }), () => context.fetch('https://api.example.com', { body: 'x' }),
    () => context.fetch('https://api.example.com', { method: 'POST', body: {} }), () => context.fetch('https://api.example.com', { headers: { 'bad header': 'x' } }),
    () => context.fetch('https://api.example.com', { method: 'PUT', body: new Uint8Array(1024 * 1024 + 1) })]) {
    try { await call() } catch (error) { codes.push(error.code) }
  }
  return { status: response.status, ok: response.ok, statusText: response.statusText, url: response.url, redirected: response.redirected, json, reused,
    tag: response.headers.get('X-Tag'), has: response.headers.has('content-type'), names: [...response.headers.keys()], codes, egress: typeof context.egress }
}`,
        ),
      })
      equal(
        value,
        {
          status: 201,
          ok: true,
          statusText: 'Created',
          url: 'https://api.example.com/items?q=1',
          redirected: false,
          json: { id: 7 },
          reused: true,
          tag: 'a, b',
          has: true,
          names: ['content-type', 'x-tag', 'x-tag'],
          codes: Array.from({ length: 5 }, () => 'capability.invalid'),
          egress: 'undefined',
        },
        'Fetch response',
      )
      equal(
        calls,
        [
          {
            kind: 'http.fetch',
            payload: {
              url: 'https://api.example.com/items?q=1',
              method: 'POST',
              headers: [
                ['x-trace', '1'],
                ['content-type', 'text/plain;charset=UTF-8'],
              ],
              body: btoa('{"name":"a"}'),
            },
          },
        ],
        'Fetch request',
      )
    },
  },
  {
    name: 'returns final outputs without exposing intermediate output capability',
    async verify(harness) {
      const value = await harness.invoke({
        capability: async () => {
          throw new Error('Capability must not be called.')
        },
        input: null,
        invocationId: 'final-outputs',
        program: program(
          harness,
          `export default async (_input, context) => ({ available: typeof context.outputs, previous: await context.getPrevious(), value: 1 })`,
        ),
      })
      equal(value, { available: 'undefined', previous: [], value: 1 }, 'Final Task outputs')
    },
  },
  {
    name: 'cancels a pending Capability and the user invocation',
    async verify(harness) {
      const cancellation = new AbortController()
      let capabilityAborted = false
      let capabilityStarted!: () => void
      const started = new Promise<void>((resolve) => {
        capabilityStarted = resolve
      })
      const invoked = harness.invoke({
        capabilities: [{ kind: 'connector', action: 'example.wait', connections: [] }],
        capability: async ({ signal }) => {
          capabilityStarted()
          return await new Promise<RuntimeCapabilityResponse>((_resolve, reject) =>
            signal.addEventListener(
              'abort',
              () => {
                capabilityAborted = true
                reject(signal.reason)
              },
              { once: true },
            ),
          )
        },
        input: null,
        invocationId: 'canceled-capability',
        program: program(harness, `export default async (_input, context) => context.actions.example.wait({})`),
        signal: cancellation.signal,
      })
      await started
      cancellation.abort(new Error('Invocation canceled.'))
      await rejects(invoked, /cancel|abort|disposed/i, 'Canceled invocation')
      equal(capabilityAborted, true, 'Capability cancellation')
    },
  },
]

export function createActions(invoke: (payload: JsonValue) => Promise<RuntimeCapabilityResponse>): Readonly<Record<string, unknown>> {
  // Keep validation inside the function serialized into the isolated runtime.
  // eslint-disable-next-line unicorn/consistent-function-scoping
  const json = (value: unknown, parents: Set<object>): void => {
    if (value === null || typeof value == 'string' || typeof value == 'boolean' || (typeof value == 'number' && Number.isFinite(value))) return
    if (
      typeof value != 'object' ||
      parents.has(value) ||
      (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) ||
      Object.getOwnPropertySymbols(value).length > 0
    )
      throw Object.assign(new Error('Action parameters must contain only JSON values.'), { code: 'capability.invalid' })
    parents.add(value)
    for (const child of Array.isArray(value) ? value : Object.values(value)) json(child, parents)
    parents.delete(value)
  }
  const target: Record<string, unknown> = Object.create(null)
  const calls = new Map<string, (input?: JsonValue, options?: JsonValue) => Promise<JsonValue>>()
  const providers = new Map<string, Readonly<Record<string, unknown>>>()
  const actionCall = (action: string): ((input?: JsonValue, options?: JsonValue) => Promise<JsonValue>) => {
    let call = calls.get(action)
    if (call != null) return call
    call = async (input: JsonValue = {}, options?: JsonValue): Promise<JsonValue> => {
      json(input, new Set())
      if (options !== undefined) json(options, new Set())
      const response = await invoke({ action, input, ...(options === undefined ? {} : { options }) })
      return response.body
    }
    calls.set(action, call)
    return call
  }
  target.call = async (action: JsonValue, input: JsonValue = {}, options?: JsonValue): Promise<JsonValue> => {
    if (typeof action != 'string') throw Object.assign(new Error('Action ID must be a string.'), { code: 'capability.invalid' })
    return actionCall(action)(input, options)
  }
  Object.freeze(target)
  return new Proxy(target, {
    get(object, property) {
      if (typeof property != 'string') return Reflect.get(object, property)
      if (Object.hasOwn(object, property)) return object[property]
      if (property.includes('.')) return actionCall(property)
      let methods = providers.get(property)
      if (methods == null) {
        const provider = property
        const providerTarget = Object.freeze(Object.create(null) as Record<string, unknown>)
        methods = new Proxy(providerTarget, {
          get(_object, name) {
            return typeof name == 'string' ? actionCall(`${provider}.${name}`) : undefined
          },
        })
        providers.set(property, methods)
      }
      return methods
    },
  })
}

export function resolveAction(
  declarations: readonly ConnectorCapability[],
  payload: unknown,
): { readonly action: string; readonly connectionId?: string; readonly input: Readonly<Record<string, JsonValue>> } {
  const invalid = Object.assign(new Error('The Action request is invalid.'), { code: 'capability.invalid' })
  const denied = Object.assign(new Error('The Action or Connection is unavailable for this Code node.'), { code: 'capability.denied' })
  if (payload == null || typeof payload != 'object' || Array.isArray(payload)) throw invalid
  const source = payload as Record<string, JsonValue>
  if (
    Object.keys(source).some((key) => !['action', 'input', 'options'].includes(key)) ||
    typeof source.action != 'string' ||
    !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_.-]+$/.test(source.action) ||
    source.input == null ||
    typeof source.input != 'object' ||
    Array.isArray(source.input)
  )
    throw invalid
  const permissions = declarations.find((declaration) => 'mode' in declaration)
  const allowed = permissions?.mode == 'independent' ? permissions.actions.find((entry) => entry.action == source.action) : undefined
  if (permissions?.mode == 'independent' && allowed == null) throw denied
  const hints = declarations.flatMap((declaration) => {
    if ('mode' in declaration) return []
    if ('action' in declaration) {
      if (declaration.action != source.action) return []
      return [
        ...declaration.connections.flatMap((connection) =>
          connection.alias == null ? [] : [{ action: declaration.action, connectionId: connection.connectionId, alias: connection.alias }],
        ),
        ...(declaration.connectionId == null ? [] : [{ action: declaration.action, connectionId: declaration.connectionId }]),
      ]
    }
    return declaration.connectionHints?.filter((hint) => hint.action == source.action) ?? []
  })
  let connectionId = hints.find((hint) => hint.alias == null)?.connectionId
  if (Object.hasOwn(source, 'options')) {
    if (source.options == null || typeof source.options != 'object' || Array.isArray(source.options)) throw invalid
    const options = source.options as Record<string, JsonValue>
    const keys = Object.keys(options)
    if (keys.length != 1) throw invalid
    if (typeof options.connectionId == 'string' && options.connectionId.length > 0 && keys[0] == 'connectionId') {
      connectionId = options.connectionId
    } else if (typeof options.connectionAlias == 'string' && options.connectionAlias.length > 0 && keys[0] == 'connectionAlias') {
      connectionId = hints.find((item) => item.alias == options.connectionAlias)?.connectionId
      if (connectionId == null) throw denied
    } else throw invalid
  }
  if (permissions?.mode == 'independent') {
    if (connectionId != null && connectionId != allowed?.connectionId) throw denied
    connectionId = allowed?.connectionId
  }
  if (permissions?.mode == 'shared' && Object.hasOwn(source, 'options') && connectionId == null) throw denied
  return { action: source.action, input: source.input as Readonly<Record<string, JsonValue>>, ...(connectionId == null ? {} : { connectionId }) }
}

export interface DecisionTaskInvocation {
  readonly questions: readonly import('../../decision/common/decision.ts').DecisionQuestion[]
  readonly state: JsonValue
  readonly invocationId: string
  readonly signal: AbortSignal
  readonly version: 1
}
export type InvokeDecisionTask = (invocation: DecisionTaskInvocation) => Promise<LlmTaskResult>

/**
 * Serialized into the sandbox before the Capability helpers that use it; keep it self-contained. Encodes in guest
 * JavaScript, because Node compatibility `atob`/`btoa` route through bounded Host primitives.
 */
export function createBase64() {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  const values = new Uint8Array(128).fill(255)
  for (let index = 0; index < alphabet.length; index++) values[alphabet.charCodeAt(index)] = index
  return Object.freeze({
    encode(bytes: Uint8Array): string {
      const parts: string[] = []
      for (let start = 0; start < bytes.length; start += 0x6000) {
        let text = ''
        for (let index = start; index < Math.min(start + 0x6000, bytes.length); index += 3) {
          const value = (bytes[index]! << 16) | ((bytes[index + 1] ?? 0) << 8) | (bytes[index + 2] ?? 0)
          text +=
            alphabet[value >> 18]! +
            alphabet[(value >> 12) & 63]! +
            (index + 1 < bytes.length ? alphabet[(value >> 6) & 63]! : '=') +
            (index + 2 < bytes.length ? alphabet[value & 63]! : '=')
        }
        parts.push(text)
      }
      return parts.join('')
    },
    decode(text: unknown): Uint8Array {
      if (typeof text != 'string' || text.length % 4 != 0) throw new TypeError('Base64 content is invalid.')
      const padding = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0
      const bytes = new Uint8Array((text.length / 4) * 3 - padding)
      for (let index = 0, offset = 0; index < text.length; index += 4) {
        const digits = [0, 1, 2, 3].map((position) => {
          const code = text.charCodeAt(index + position)
          if (code == 61 && index + position >= text.length - padding) return 0
          const value = code < 128 ? values[code]! : 255
          if (value == 255) throw new TypeError('Base64 content is invalid.')
          return value
        })
        const value = (digits[0]! << 18) | (digits[1]! << 12) | (digits[2]! << 6) | digits[3]!
        if (offset < bytes.length) bytes[offset++] = value >> 16
        if (offset < bytes.length) bytes[offset++] = (value >> 8) & 255
        if (offset < bytes.length) bytes[offset++] = value & 255
      }
      return bytes
    },
  })
}

/**
 * Serialized into the sandbox; keep it self-contained. Transfers bytes as base64 chunks through
 * `artifact.write`, `artifact.put` and `artifact.read` so each Capability message stays bounded.
 */
export function createArtifacts(
  invoke: (kind: string, payload: JsonValue) => Promise<RuntimeCapabilityResponse>,
  { decode, encode }: ReturnType<typeof createBase64> = createBase64(),
) {
  const chunkBytes = 512 * 1024
  // Keep helpers inside the function serialized into the isolated runtime.
  // eslint-disable-next-line unicorn/consistent-function-scoping
  const invalid = (message: string): Error => Object.assign(new TypeError(message), { code: 'capability.invalid' })
  return Object.freeze({
    async put(data: unknown, options: unknown): Promise<JsonValue> {
      const settings = options as { readonly name?: unknown; readonly mediaType?: unknown } | null
      if (settings == null || typeof settings != 'object' || typeof settings.name != 'string' || settings.name.length == 0)
        throw invalid('Artifact name is required.')
      if (settings.mediaType !== undefined && typeof settings.mediaType != 'string') throw invalid('Artifact mediaType must be a string.')
      const bytes = typeof data == 'string' ? new TextEncoder().encode(data) : data instanceof Uint8Array ? data : undefined
      if (bytes == null) throw invalid('Artifact data must be a string or Uint8Array.')
      const tail = bytes.length == 0 ? 0 : Math.floor((bytes.length - 1) / chunkBytes) * chunkBytes
      let upload: JsonValue | undefined
      for (let offset = 0; offset < tail; offset += chunkBytes) {
        const response = await invoke('artifact.write', {
          ...(upload === undefined ? {} : { upload }),
          data: encode(bytes.subarray(offset, offset + chunkBytes)),
        })
        upload = (response.body as { readonly upload?: JsonValue } | null)?.upload
      }
      const response = await invoke('artifact.put', {
        ...(upload === undefined ? {} : { upload }),
        name: settings.name,
        ...(settings.mediaType === undefined ? {} : { mediaType: settings.mediaType }),
        data: encode(bytes.subarray(tail)),
      })
      return response.body
    },
    async open(ref: unknown): Promise<Uint8Array> {
      const artifact = ref as { readonly kind?: unknown; readonly id?: unknown } | null
      if (artifact == null || typeof artifact != 'object' || artifact.kind != 'artifact' || typeof artifact.id != 'string')
        throw invalid('An ArtifactRef is required.')
      const parts: Uint8Array[] = []
      let offset = 0
      let size = 0
      do {
        const body = (await invoke('artifact.read', { id: artifact.id, offset })).body as { readonly data?: unknown; readonly size?: unknown } | null
        const part = decode(body?.data)
        if (typeof body?.size != 'number' || !Number.isSafeInteger(body.size) || (part.length == 0 && offset < body.size))
          throw new TypeError('Artifact content is invalid.')
        size = body.size
        parts.push(part)
        offset += part.length
      } while (offset < size)
      const bytes = new Uint8Array(offset)
      let position = 0
      for (const part of parts) {
        bytes.set(part, position)
        position += part.length
      }
      return bytes
    },
  })
}

/**
 * Serialized into the sandbox; keep it self-contained. `context.fetch` sends one `http.fetch` Capability call per request.
 * The Host authorizes the URL against the node's `http` Capability, does not follow redirects and adds no credentials.
 * Request and response bodies are limited to 1 MiB; the response is a read-only subset of the Fetch `Response`.
 */
export function createFetch(
  invoke: (kind: string, payload: JsonValue) => Promise<RuntimeCapabilityResponse>,
  { decode, encode }: ReturnType<typeof createBase64> = createBase64(),
) {
  const maximumBytes = 1024 * 1024
  const methods = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'])
  // Keep helpers inside the function serialized into the isolated runtime.
  // eslint-disable-next-line unicorn/consistent-function-scoping
  const invalid = (message: string): Error => Object.assign(new TypeError(message), { code: 'capability.invalid' })
  // eslint-disable-next-line unicorn/consistent-function-scoping
  const headerList = (value: unknown): [string, string][] => {
    if (value == null) return []
    const pairs =
      typeof (value as { [Symbol.iterator]?: unknown })[Symbol.iterator] == 'function'
        ? Array.from(value as Iterable<unknown>, (pair) => {
            if (!Array.isArray(pair) || pair.length != 2) throw invalid('Headers must be name/value pairs.')
            return pair
          })
        : typeof value == 'object'
          ? Object.entries(value as Record<string, unknown>)
          : undefined
    if (pairs == null) throw invalid('Headers must be an object or name/value pairs.')
    return pairs.map(([name, text]) => {
      if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(String(name))) throw invalid(`Invalid header name "${String(name)}".`)
      return [String(name).toLowerCase(), String(text)]
    })
  }
  return async function fetch(input: unknown, init: unknown = {}): Promise<unknown> {
    const options = (init ?? {}) as { readonly method?: unknown; readonly headers?: unknown; readonly body?: unknown; readonly signal?: unknown }
    if (typeof options != 'object') throw invalid('Fetch options must be an object.')
    const url = String(input instanceof Object && 'href' in input ? (input as { href: unknown }).href : input)
    const method = String(options.method ?? 'GET').toUpperCase()
    if (!methods.has(method)) throw invalid(`Unsupported HTTP method "${method}".`)
    const headers = headerList(options.headers)
    const body =
      options.body == null
        ? undefined
        : typeof options.body == 'string'
          ? new TextEncoder().encode(options.body)
          : options.body instanceof Uint8Array
            ? options.body
            : options.body instanceof ArrayBuffer
              ? new Uint8Array(options.body)
              : undefined
    if (options.body != null && body == null) throw invalid('Fetch body must be a string, Uint8Array or ArrayBuffer.')
    if (body != null && (method == 'GET' || method == 'HEAD')) throw invalid(`A ${method} request cannot have a body.`)
    if (body != null && body.length > maximumBytes) throw invalid('Fetch request body exceeds 1 MiB.')
    if (typeof options.body == 'string' && !headers.some(([name]) => name == 'content-type')) headers.push(['content-type', 'text/plain;charset=UTF-8'])
    const signal = options.signal as { readonly aborted?: boolean; readonly reason?: unknown; addEventListener?: Function } | undefined
    if (signal?.aborted) throw signal.reason
    const request = invoke('http.fetch', { url, method, headers, ...(body == null ? {} : { body: encode(body) }) })
    const result = (
      signal?.addEventListener == null
        ? await request
        : await Promise.race([request, new Promise<never>((_, reject) => signal.addEventListener!('abort', () => reject(signal.reason), { once: true }))])
    ).body as { readonly status?: unknown; readonly statusText?: unknown; readonly url?: unknown; readonly headers?: unknown; readonly body?: unknown } | null
    if (
      result == null ||
      typeof result.status != 'number' ||
      typeof result.url != 'string' ||
      typeof result.body != 'string' ||
      !Array.isArray(result.headers) ||
      result.headers.some((pair) => !Array.isArray(pair) || typeof pair[0] != 'string' || typeof pair[1] != 'string')
    )
      throw new TypeError('The HTTP response is invalid.')
    const status = result.status
    const entries = result.headers as [string, string][]
    const content = decode(result.body)
    let used = false
    const consume = (): Uint8Array => {
      if (used) throw new TypeError('Response body has already been used.')
      used = true
      return content.slice()
    }
    const responseHeaders = Object.freeze({
      get: (name: string) => {
        const values = entries.filter(([key]) => key == String(name).toLowerCase()).map(([, value]) => value)
        return values.length == 0 ? null : values.join(', ')
      },
      has: (name: string) => entries.some(([key]) => key == String(name).toLowerCase()),
      entries: () => entries.map(([name, value]) => [name, value])[Symbol.iterator](),
      keys: () => entries.map(([name]) => name)[Symbol.iterator](),
      values: () => entries.map(([, value]) => value)[Symbol.iterator](),
      forEach: (callback: (value: string, name: string) => void) => entries.forEach(([name, value]) => callback(value, name)),
      [Symbol.iterator]: () => entries.map(([name, value]) => [name, value])[Symbol.iterator](),
    })
    return Object.freeze({
      status,
      statusText: typeof result.statusText == 'string' ? result.statusText : '',
      ok: status >= 200 && status < 300,
      redirected: false,
      url: result.url,
      headers: responseHeaders,
      get bodyUsed() {
        return used
      },
      bytes: async () => consume(),
      arrayBuffer: async () => consume().buffer,
      text: async () => new TextDecoder().decode(consume()),
      json: async () => JSON.parse(new TextDecoder().decode(consume())) as unknown,
    })
  }
}

/** Serialized into the sandbox alongside the strict JSON snapshot helper. */
export function createWorkflows(invoke: (payload: JsonValue) => Promise<RuntimeCapabilityResponse>) {
  return Object.freeze({
    async call(name: string, input: Readonly<Record<string, JsonValue>> = {}): Promise<JsonValue> {
      if (typeof name != 'string' || input == null || typeof input != 'object' || Array.isArray(input))
        throw Object.assign(new Error('Workflow name and input object are required.'), { code: 'capability.invalid' })
      const value = snapshotRuntimeResult(input)!
      return (await invoke({ name, input: value })).body
    },
  })
}
