import type { CodeModule, JsonValue } from '../../flow/common/change.ts'

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
        program: program(harness, `export default async (input, capability) => capability.connector({ action: 'read', input })`),
      })
      equal(value, { body: { accepted: true, echoed: { action: 'read', input: { issue: 42 } } }, status: 200 }, 'Capability result')
      equal(
        calls.map(({ invocationId, kind, payload }) => ({ invocationId, kind, payload })),
        [{ invocationId: 'async-capability', kind: 'connector', payload: { action: 'read', input: { issue: 42 } } }],
        'Capability request',
      )
    },
  },
  {
    name: 'submits Task outputs and accepts a void result',
    async verify(harness) {
      const calls: RuntimeCapabilityCall[] = []
      const value = await harness.invoke({
        capability: async (call) => {
          calls.push(call)
          return { body: null, status: 200 }
        },
        input: null,
        invocationId: 'task-outputs',
        program: program(
          harness,
          `export default async (_input, context) => {
  await context.outputs({ first: 1 })
  await context.outputs({ second: 2 })
}`,
        ),
      })
      equal(value, undefined, 'Void Task result')
      equal(
        calls.map(({ invocationId, kind, payload }) => ({ invocationId, kind, payload })),
        [
          { invocationId: 'task-outputs', kind: 'outputs', payload: { first: 1 } },
          { invocationId: 'task-outputs', kind: 'outputs', payload: { second: 2 } },
        ],
        'Task outputs request',
      )
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
        program: program(harness, `export default async (_input, capability) => capability.connector({ action: 'wait' })`),
        signal: cancellation.signal,
      })
      await started
      cancellation.abort(new Error('Invocation canceled.'))
      await rejects(invoked, /cancel|abort|disposed/i, 'Canceled invocation')
      equal(capabilityAborted, true, 'Capability cancellation')
    },
  },
]
