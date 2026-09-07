import type { CodeModule, ConnectorCapability, JsonValue } from '../../flow/common/change.ts'

import { dequal } from 'dequal/lite'
import { currentEngineContract } from './engineContract.ts'

export { currentEngineContract, findEngineContract, type EngineContract } from './engineContract.ts'

export type RuntimeModule = Pick<CodeModule, 'imports' | 'source'>

export interface RuntimeProgram {
  readonly engineContract: string
  readonly engineDigest: string
  readonly entryModuleId: string
  readonly modules: Readonly<Record<string, RuntimeModule>>
}

export interface RuntimeCapabilityCall {
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
  | { readonly code: 'llm.output-invalid' | 'llm.unavailable'; readonly kind: 'failed'; readonly message: string; readonly version: 1 }

export type InvokeLlmTask = (invocation: LlmTaskInvocation) => Promise<LlmTaskResult>

export interface RuntimeInvocation {
  readonly capabilities?: readonly ConnectorCapability[]
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
        program: program(harness, `export default (_input, context) => ({ available: typeof context.outputs, value: 1 })`),
      })
      equal(value, { available: 'undefined', value: 1 }, 'Final Task outputs')
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

export function createActions(
  declarations: readonly ConnectorCapability[],
  invoke: (payload: JsonValue) => Promise<RuntimeCapabilityResponse>,
): Readonly<Record<string, unknown>> {
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
  const actions: Record<string, unknown> = Object.create(null)
  const providers = new Map<string, Record<string, unknown>>()
  for (const declaration of declarations) {
    const separator = declaration.action.indexOf('.')
    const provider = declaration.action.slice(0, separator)
    const name = declaration.action.slice(separator + 1)
    let methods = providers.get(provider)
    if (methods == null) {
      methods = Object.create(null) as Record<string, unknown>
      providers.set(provider, methods)
      actions[provider] = methods
    }
    const call = async (input: JsonValue = {}, options?: JsonValue): Promise<JsonValue> => {
      json(input, new Set())
      if (options !== undefined) json(options, new Set())
      const response = await invoke({ action: declaration.action, input, ...(options === undefined ? {} : { options }) })
      return response.body
    }
    actions[declaration.action] = call
    methods[name] = call
  }
  for (const methods of providers.values()) Object.freeze(methods)
  return Object.freeze(actions)
}

export function resolveAction(
  declarations: readonly ConnectorCapability[],
  payload: unknown,
): { readonly action: string; readonly connectionId?: string; readonly input: Readonly<Record<string, JsonValue>> } {
  const invalid = Object.assign(new Error('The Action request is invalid.'), { code: 'capability.invalid' })
  const denied = Object.assign(new Error('The Action or Connection is not declared for this Task.'), { code: 'capability.denied' })
  if (payload == null || typeof payload != 'object' || Array.isArray(payload)) throw invalid
  const source = payload as Record<string, JsonValue>
  if (
    Object.keys(source).some((key) => !['action', 'input', 'options'].includes(key)) ||
    typeof source.action != 'string' ||
    source.input == null ||
    typeof source.input != 'object' ||
    Array.isArray(source.input)
  )
    throw invalid
  const declaration = declarations.find((item) => item.action == source.action)
  if (declaration == null) throw denied
  let connectionId = declaration.connectionId
  if (Object.hasOwn(source, 'options')) {
    if (source.options == null || typeof source.options != 'object' || Array.isArray(source.options)) throw invalid
    const options = source.options as Record<string, JsonValue>
    const keys = Object.keys(options)
    if (keys.length != 1) throw invalid
    if (typeof options.connectionId == 'string' && options.connectionId.length > 0 && keys[0] == 'connectionId') {
      connectionId = options.connectionId
    } else if (typeof options.connectionAlias == 'string' && options.connectionAlias.length > 0 && keys[0] == 'connectionAlias') {
      connectionId = declaration.connections.find((item) => item.alias == options.connectionAlias)?.connectionId
      if (connectionId == null) throw denied
    } else throw invalid
  }
  if (connectionId != null && !declaration.connections.some((item) => item.connectionId == connectionId)) throw denied
  if (connectionId == null && declaration.connections.length > 0) {
    throw Object.assign(new Error('Choose a Connector Connection for this Action.'), { code: 'connector.connection-required' })
  }
  return { action: source.action, input: source.input as Readonly<Record<string, JsonValue>>, ...(connectionId == null ? {} : { connectionId }) }
}
