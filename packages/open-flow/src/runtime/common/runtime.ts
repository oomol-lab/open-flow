import type { CodeModule, ConnectorCapability, TaskCapability, JsonValue } from '../../flow/common/model.ts'

import { dequal } from 'dequal/lite'
import { currentEngineContract, nodejsEngineContract } from './engineContract.ts'

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
        program: {
          ...program(
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
          engineContract: nodejsEngineContract,
        },
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
        program: {
          ...program(
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
          engineContract: nodejsEngineContract,
        },
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
  {
    name: 'isolates files, globals and builtin module state between Task invocations',
    async verify(harness) {
      const invoke = async (invocationId: string, source: string) =>
        await harness.invoke({
          capability: async () => ({ body: null, status: 403 }),
          input: null,
          invocationId,
          program: { ...program(harness, source), engineContract: nodejsEngineContract },
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

function nodejsCase(name: string, source: string, expected: JsonValue): RuntimeConformanceCase {
  return {
    name,
    async verify(harness) {
      const value = await harness.invoke({
        capability: async () => ({ body: null, status: 403 }),
        input: null,
        invocationId: `nodejs-${name}`,
        program: { ...program(harness, source), engineContract: nodejsEngineContract },
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
            `import fs from 'node:fs'
export default () => fs.readFileSync('/etc/passwd', 'utf8')`,
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
        capability: async (call) => {
          calls.push(call)
          return { body: { accepted: true, echoed: call.payload }, status: 200 }
        },
        input: { issue: 42 },
        invocationId: 'async-capability',
        program: program(harness, `export default async (input, capability) => capability.artifact.put({ action: 'read', input })`),
      })
      equal(value, { body: { accepted: true, echoed: { action: 'read', input: { issue: 42 } } }, status: 200 }, 'Capability result')
      equal(
        calls.map(({ invocationId, kind, payload }) => ({ invocationId, kind, payload })),
        [{ invocationId: 'async-capability', kind: 'artifact.put', payload: { action: 'read', input: { issue: 42 } } }],
        'Capability request',
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
