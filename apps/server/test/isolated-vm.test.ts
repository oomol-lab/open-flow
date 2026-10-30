import type { RuntimeHarness, RuntimeProgram } from '@oomol-lab/open-flow/runtime-contract'

import { currentFlowModelVersion } from '@oomol-lab/open-flow/flow-change'
import { prepareFlow } from '@oomol-lab/open-flow/flow-semantics'
import { currentEngineContract } from '@oomol-lab/open-flow/runtime-contract'
import { nodejsRuntimeConformanceCases, runtimeConformanceCases } from '@oomol-lab/open-flow/runtime-contract'
import * as Effect from 'effect/Effect'
import { afterAll, describe, expect, it } from 'vitest'
import { IsolatedVmError, isolatedVmEngineDigest, isolatedVmLimits, IsolatedVmHost } from '../node/runtime/isolated-vm.ts'
import { childProcessId } from './processTree.ts'

const host = new IsolatedVmHost()

const harness: RuntimeHarness = {
  engineDigest: isolatedVmEngineDigest,
  invoke: (invocation) => host.invoke(invocation),
}

afterAll(async () => await host.close())

function program(source: string): RuntimeProgram {
  return {
    engineContract: currentEngineContract,
    engineDigest: isolatedVmEngineDigest,
    entryModuleId: 'main',
    modules: { main: { imports: [], source } },
  }
}

function invoke(source: string, limits = isolatedVmLimits) {
  return host.invoke(
    {
      capability: async () => ({ body: null, status: 200 }),
      input: null,
      invocationId: 'isolated-runtime-test',
      program: program(source),
    },
    limits,
  )
}

async function executorPid(): Promise<number> {
  return await childProcessId(process.pid, '--executor')
}

describe('isolated-vm runtime conformance', () => {
  it.each(['open-flow-engine/v6', 'open-flow-engine/v6/nodejs-compat-v1', 'open-flow-engine/v7', 'open-flow-engine/v7/nodejs-compat-v1'])(
    'executes the published runtime identity for %s',
    async (engineContract) => {
      const engineDigest = engineContract.includes('/v7')
        ? 'sha256:2574eccd876cc9a524dcdfaa8fb4f8a7e439b25470715882800d0c3bfc7dec59'
        : 'sha256:1d4de22503410f3ae83e38e7e487446c8d71fa5e2af6697f46add32c3b84bac6'
      await expect(
        host.invoke({
          capability: async () => ({ body: null, status: 403 }),
          input: null,
          invocationId: 'legacy-platform',
          program: {
            ...program("import { engineContract } from 'open-flow:platform'; export default () => ({ engineContract })"),
            engineContract,
            engineDigest,
          },
        }),
      ).resolves.toEqual({ engineContract })
      await expect(
        host.invoke({
          capability: async () => ({ body: null, status: 403 }),
          input: null,
          invocationId: 'legacy-digest-current-contract',
          program: { ...program('export default () => true'), engineDigest },
        }),
      ).rejects.toMatchObject({ code: 'invalid-program' })
    },
  )

  it.each(['return {}', 'return { result: undefined }', 'return { result: null }', 'return undefined'])(
    'transports nullable output candidates for Scheduler normalization: %s',
    async (body) => {
      const result = await invoke(`export default () => { ${body} }`)
      expect(result).toEqual(body.includes('null') ? { result: null } : body == 'return undefined' ? undefined : {})
    },
  )

  it('preserves catchable Action codes and does not let a caught error replace a later failure', async () => {
    const invocation = {
      capabilities: [{ kind: 'connector' as const, action: 'example.echo', connections: [] }],
      capability: async () => {
        throw Object.assign(new Error('Try again.'), { code: 'connector.unavailable' })
      },
      input: null,
      invocationId: 'caught-action',
    }
    await expect(
      host.invoke({
        ...invocation,
        program: program(`export default async (_, context) => {
      try { await context.actions.example.echo({}) } catch (error) { return { code: error.code } }
    }`),
      }),
    ).resolves.toEqual({ code: 'connector.unavailable' })
    await expect(
      host.invoke({
        ...invocation,
        program: program(`export default async (_, context) => {
      try { await context.actions.example.echo({}) } catch {}
      throw new Error('A different failure.')
    }`),
      }),
    ).rejects.toMatchObject({ code: 'task-failed', message: expect.stringContaining('A different failure.') })
  })

  it('cannot turn a capability limit into success by catching the Action error', async () => {
    await expect(
      host.invoke(
        {
          capabilities: [{ kind: 'connector', action: 'example.echo', connections: [] }],
          capability: async () => ({ body: null, status: 200 }),
          input: null,
          invocationId: 'caught-limit',
          program: program(`export default async (_, context) => {
        try { await context.actions.example.echo({}); await context.actions.example.echo({}) } catch {}
        return { recovered: true }
      }`),
        },
        { ...isolatedVmLimits, maxCapabilityCalls: 1 },
      ),
    ).rejects.toMatchObject({ code: 'limit-exceeded' })
  })

  it('treats omitted Action input as an empty object for both call forms', async () => {
    const seen: unknown[] = []
    await expect(
      host.invoke({
        capabilities: [{ kind: 'connector', action: 'example.echo', connections: [] }],
        capability: async ({ payload }) => {
          seen.push(payload)
          return { body: 'ok', status: 200 }
        },
        input: null,
        invocationId: 'omitted-action-input',
        program: program(`export default async (_, context) => [
        await context.actions.example.echo(),
        await context.actions['example.echo'](),
        await context.actions.example.echo(undefined)
      ]`),
      }),
    ).resolves.toEqual(['ok', 'ok', 'ok'])
    expect(seen).toEqual(Array.from({ length: 3 }, () => ({ action: 'example.echo', input: {} })))
  })

  it('rejects lossy JSON Action parameters before host dispatch', async () => {
    let calls = 0
    await expect(
      host.invoke({
        capabilities: [{ kind: 'connector', action: 'example.echo', connections: [] }],
        capability: async () => {
          calls++
          return { body: null, status: 200 }
        },
        input: null,
        invocationId: 'invalid-json',
        program: program(`export default async (_, context) => {
        const circular = {}; circular.self = circular
        const results = []
        for (const value of [{ value: undefined }, { value: NaN }, { value: () => 1 }, { value: 1n }, circular, { value: new Date() }]) {
          try { await context.actions.example.echo(value) } catch (error) { results.push(error.code) }
        }
        return results
      }`),
      }),
    ).resolves.toEqual(Array.from({ length: 6 }, () => 'capability.invalid'))
    expect(calls).toBe(0)
  })

  it('aborts an unawaited Action when its node finishes', async () => {
    let aborted = false
    await expect(
      host.invoke({
        capabilities: [{ kind: 'connector', action: 'example.echo', connections: [] }],
        capability: async ({ signal }) =>
          await new Promise((resolve) => {
            signal.addEventListener(
              'abort',
              () => {
                aborted = true
                resolve({ body: null, status: 200 })
              },
              { once: true },
            )
          }),
        input: null,
        invocationId: 'unawaited-action',
        program: program(`export default async (_, context) => {
        void context.actions.example.echo({})
        await new Promise(resolve => setTimeout(resolve, 20))
        return null
      }`),
      }),
    ).resolves.toBeNull()
    expect(aborted).toBe(true)
  })

  it('rejects the replaced Engine contract and removes the old connector method', async () => {
    await expect(
      host.invoke({
        capability: async () => ({ body: null, status: 200 }),
        input: null,
        invocationId: 'old-engine',
        program: { ...program('export default () => null'), engineContract: 'open-flow-engine/v1' },
      }),
    ).rejects.toMatchObject({ code: 'invalid-program' })
    await expect(invoke('export default (_, context) => typeof context.connector')).resolves.toBe('undefined')
  })

  for (const conformance of [...runtimeConformanceCases, ...nodejsRuntimeConformanceCases]) {
    it(conformance.name, async () => await conformance.verify(harness))
  }

  it('does not expose Node or network globals to the user realm', async () => {
    await expect(
      invoke(`export default () => ({
        AbortController: typeof AbortController,
        AbortSignal: typeof AbortSignal,
        Buffer: typeof Buffer,
        fetch: typeof fetch,
        process: typeof process,
        require: typeof require,
        WebSocket: typeof WebSocket,
      })`),
    ).resolves.toEqual({
      AbortController: 'function',
      AbortSignal: 'function',
      Buffer: 'undefined',
      fetch: 'undefined',
      process: 'undefined',
      require: 'undefined',
      WebSocket: 'undefined',
    })
  })

  it('provides invocation-local cancellation primitives', async () => {
    await expect(
      invoke(`export default () => {
  const controller = new AbortController()
  let calls = 0
  let eventType
  const listener = (event) => {
    calls += 1
    eventType = event.type
  }
  controller.signal.addEventListener('abort', listener)
  controller.abort('stop')
  controller.abort('ignored')
  let thrown
  try {
    controller.signal.throwIfAborted()
  } catch (error) {
    thrown = error
  }
  controller.signal.removeEventListener('abort', listener)
  return { aborted: controller.signal.aborted, calls, eventType, reason: controller.signal.reason, thrown }
}`),
    ).resolves.toEqual({ aborted: true, calls: 1, eventType: 'abort', reason: 'stop', thrown: 'stop' })
  })

  it('provides one context shape without Flow identity for direct programs', async () => {
    await expect(
      invoke(`export default (inputs, context) => ({
  blockId: Object.hasOwn(context, 'blockId') && context.blockId === undefined,
  flowId: Object.hasOwn(context, 'flowId') && context.flowId === undefined,
  inputs: context.inputs === inputs,
  runId: Object.hasOwn(context, 'runId') && context.runId === undefined,
  signal: context.signal instanceof AbortSignal,
})`),
    ).resolves.toEqual({ blockId: true, flowId: true, inputs: true, runId: true, signal: true })
  })

  it('provides invocation-scoped timers', async () => {
    await expect(
      invoke(`export default async () => {
  let canceledTimerFired = false
  const canceled = setTimeout(() => { canceledTimerFired = true }, 0)
  clearTimeout(canceled)
  const value = await new Promise((resolve) => setTimeout(resolve, 10, 'timer-result'))
  return { canceledTimerFired, value }
}`),
    ).resolves.toEqual({ canceledTimerFired: false, value: 'timer-result' })
  })

  it('provides safe Web globals', async () => {
    await expect(
      invoke(`export default async () => {
  let microtask = false
  queueMicrotask(() => { microtask = true })
  await Promise.resolve()

  const ticks = await new Promise((resolve) => {
    let count = 0
    const interval = setInterval(() => {
      count += 1
      if (count == 2) {
        clearInterval(interval)
        resolve(count)
      }
    }, 1)
  })

  const source = { nested: { value: 1 } }
  const clone = structuredClone(source)
  clone.nested.value = 2
  const encoded = new TextEncoder().encode('你好')
  return {
    base64: atob(btoa('open-flow')),
    clone: clone.nested.value,
    decoded: new TextDecoder().decode(encoded),
    microtask,
    performance: performance.now() >= 0 && Number.isFinite(performance.timeOrigin),
    source: source.nested.value,
    ticks,
  }
}`),
    ).resolves.toEqual({ base64: 'open-flow', clone: 2, decoded: '你好', microtask: true, performance: true, source: 1, ticks: 2 })
  })

  it('preserves user error messages', async () => {
    await expect(invoke("export default () => { throw new Error('Task failed with detail.') }")).rejects.toMatchObject({
      code: 'task-failed',
      message: 'Task failed with detail.',
    })
  })

  it('terminates synchronous user code at the CPU limit and keeps the parent alive', async () => {
    await expect(invoke('export default () => { while (true) {} }', { ...isolatedVmLimits, cpuMs: 20, wallMs: 2_000 })).rejects.toMatchObject({
      code: 'limit-exceeded',
    })
    await expect(invoke('export default () => "still-alive"')).resolves.toBe('still-alive')
  })

  it.each([
    ['timer', 'for (let index = 0; index < 3; index++) { await new Promise((resolve) => setTimeout(resolve, 1)); burn(80) }'],
    ['Capability', 'await context.actions.example.echo({}); burn(300)'],
  ])('accumulates CPU time after %s callbacks', async (_entry, body) => {
    await expect(
      host.invoke(
        {
          capabilities: [{ kind: 'connector', action: 'example.echo', connections: [] }],
          capability: async () => ({ body: 'ok', status: 200 }),
          input: null,
          invocationId: 'accumulated-cpu',
          program: program(`const burn = (ms) => { const end = Date.now() + ms; while (Date.now() < end) {} }
export default async (_, context) => { ${body}; return 'unbounded' }`),
        },
        { ...isolatedVmLimits, cpuMs: 200 },
      ),
    ).rejects.toMatchObject({ code: 'limit-exceeded', message: 'Runtime invocation exceeded its CPU limit.' })
  })

  it('cancels a busy asynchronous Task without blocking other invocations', async () => {
    const busy = invoke('export default async () => { await new Promise((resolve) => setTimeout(resolve, 1)); while (true) {} }', {
      ...isolatedVmLimits,
      wallMs: 200,
    })
    const sibling = invoke('export default async () => { await new Promise((resolve) => setTimeout(resolve, 400)); return "sibling" }')
    await expect(busy).rejects.toMatchObject({ code: 'limit-exceeded' })
    await expect(sibling).resolves.toBe('sibling')
    const started = performance.now()
    await expect(invoke('export default () => "next"')).resolves.toBe('next')
    expect(performance.now() - started).toBeLessThan(1_000)
  })

  it('rejects oversized results without returning partial data', async () => {
    await expect(invoke('export default () => "x".repeat(2048)', { ...isolatedVmLimits, maxResultBytes: 256 })).rejects.toMatchObject({
      code: 'limit-exceeded',
    })
  })

  it('rejects an Engine digest not owned by this Executor before spawning user code', async () => {
    await expect(
      host.invoke({
        capability: async () => ({ body: null, status: 200 }),
        input: null,
        invocationId: 'wrong-engine',
        program: { ...program('export default () => true'), engineDigest: 'sha256:other' },
      }),
    ).rejects.toEqual(expect.objectContaining<Partial<IsolatedVmError>>({ code: 'invalid-program' }))
  })

  it('rejects oversized inputs and programs before invoking user code', async () => {
    await expect(
      host.invoke(
        {
          capability: async () => ({ body: null, status: 200 }),
          input: 'x'.repeat(256),
          invocationId: 'oversized-input',
          program: program('export default () => true'),
        },
        { ...isolatedVmLimits, maxInputBytes: 32 },
      ),
    ).rejects.toMatchObject({ code: 'limit-exceeded' })
    await expect(invoke(`export default () => ${JSON.stringify('x'.repeat(256))}`, { ...isolatedVmLimits, maxProgramBytes: 64 })).rejects.toMatchObject({
      code: 'limit-exceeded',
    })
  })

  it('enforces Capability call and response byte limits', async () => {
    let calls = 0
    await expect(
      host.invoke(
        {
          capability: async () => {
            calls += 1
            return { body: null, status: 200 }
          },
          input: null,
          invocationId: 'capability-count-limit',
          program: program(`export default async (_input, capability) => {
  await capability.actions.call('example.echo', { call: 1 })
  return await capability.actions.call('example.echo', { call: 2 })
}`),
        },
        { ...isolatedVmLimits, maxCapabilityCalls: 1 },
      ),
    ).rejects.toMatchObject({ code: 'limit-exceeded' })
    expect(calls).toBe(1)

    await expect(
      host.invoke(
        {
          capability: async () => ({ body: 'x'.repeat(256), status: 200 }),
          input: null,
          invocationId: 'capability-response-limit',
          program: program('export default async (_input, capability) => capability.actions.call("example.echo", {})'),
        },
        { ...isolatedVmLimits, maxCapabilityResponseBytes: 64 },
      ),
    ).rejects.toMatchObject({ code: 'limit-exceeded' })
  })

  it('enforces the wall-clock limit', async () => {
    await expect(invoke('export default async () => await new Promise(() => {})', { ...isolatedVmLimits, wallMs: 20 })).rejects.toMatchObject({
      code: 'limit-exceeded',
    })
  })

  it('enforces the isolate memory limit and accepts the next invocation', async () => {
    await expect(
      invoke(
        `export default () => {
  const chunks = []
  for (let index = 0; index < 1_024; index++) chunks.push(new Array(16_384).fill(index))
  return chunks.length
}`,
        {
          ...isolatedVmLimits,
          cpuMs: 2_000,
          memoryMb: 32,
          wallMs: 5_000,
        },
      ),
    ).rejects.toMatchObject({ code: 'limit-exceeded', message: expect.stringMatching(/memory limit/i) })
    await expect(invoke('export default () => "after-memory-limit"')).resolves.toBe('after-memory-limit')
  })

  it.each([
    { ...program('export default () => true'), entryModuleId: 'missing' },
    { ...program('export default () => true'), modules: { 'invalid/module': { imports: [], source: 'export default () => true' } } },
  ])('rejects an invalid Runtime program before execution', async (invalidProgram) => {
    await expect(
      host.invoke({ capability: async () => ({ body: null, status: 200 }), input: null, invocationId: 'invalid-program', program: invalidProgram }),
    ).rejects.toMatchObject({ code: 'invalid-program' })
  })

  it('rejects an invocation whose signal is already aborted', async () => {
    const cancellation = new AbortController()
    cancellation.abort(new Error('Canceled before invocation.'))
    await expect(
      host.invoke({
        capability: async () => ({ body: null, status: 200 }),
        input: null,
        invocationId: 'pre-canceled',
        program: program('export default () => true'),
        signal: cancellation.signal,
      }),
    ).rejects.toThrow('Canceled before invocation.')
  })

  it('routes concurrent invocations independently and gives each invocation a fresh isolate', async () => {
    const first = host.invoke({
      capability: async ({ payload }) => ({ body: payload, status: 200 }),
      input: { value: 'first' },
      invocationId: 'concurrent-first',
      program: program(
        `export default async (input, capability) => {
  globalThis.count = (globalThis.count ?? 0) + 1
  return { count: globalThis.count, response: await capability.actions.call('example.echo', input) }
}`,
      ),
    })
    const second = host.invoke({
      capability: async ({ payload }) => ({ body: payload, status: 200 }),
      input: { value: 'second' },
      invocationId: 'concurrent-second',
      program: program(
        `export default async (input, capability) => {
  globalThis.count = (globalThis.count ?? 0) + 1
  return { count: globalThis.count, response: await capability.actions.call('example.echo', input) }
}`,
      ),
    })

    await expect(Promise.all([first, second])).resolves.toEqual([
      { count: 1, response: { action: 'example.echo', input: { value: 'first' } } },
      { count: 1, response: { action: 'example.echo', input: { value: 'second' } } },
    ])
  })

  it('cancels one concurrent invocation without canceling another', async () => {
    const cancellation = new AbortController()
    let capabilityStarted!: () => void
    const started = new Promise<void>((resolve) => {
      capabilityStarted = resolve
    })
    const canceled = host.invoke({
      capability: async ({ signal }) => {
        capabilityStarted()
        return await new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
      },
      input: null,
      invocationId: 'concurrent-canceled',
      program: program(`export default async (_input, capability) => capability.actions.call('example.echo', { wait: true })`),
      signal: cancellation.signal,
    })
    const completed = host.invoke({
      capability: async () => ({ body: 'completed', status: 200 }),
      input: null,
      invocationId: 'concurrent-completed',
      program: program(`export default async (_input, capability) => capability.actions.call('example.echo', { wait: false })`),
    })

    await started
    cancellation.abort(new Error('Cancel only the first invocation.'))
    await expect(canceled).rejects.toThrow('Cancel only the first invocation.')
    await expect(completed).resolves.toBe('completed')
  })

  it('rejects pending work when closed', async () => {
    const closingHost = new IsolatedVmHost()
    let capabilityStarted!: () => void
    const started = new Promise<void>((resolve) => {
      capabilityStarted = resolve
    })
    const pending = closingHost.invoke({
      capability: async ({ signal }) => {
        capabilityStarted()
        return await new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
      },
      input: null,
      invocationId: 'closed-pending',
      program: program('export default async (_input, capability) => capability.actions.call("example.echo", {})'),
    })
    await started
    const rejected = expect(pending).rejects.toMatchObject({ code: 'canceled' })
    await closingHost.close()
    await rejected
    await expect(
      closingHost.invoke({
        capability: async () => ({ body: null, status: 200 }),
        input: null,
        invocationId: 'closed-new',
        program: program('export default () => true'),
      }),
    ).rejects.toMatchObject({ code: 'executor-crashed' })
  })

  it('fails pending work on Executor loss, does not replay it, and rebuilds for the next invocation', async () => {
    let capabilityCalls = 0
    let capabilityStarted!: () => void
    const started = new Promise<void>((resolve) => {
      capabilityStarted = resolve
    })
    const pending = host.invoke({
      capability: async ({ signal }) => {
        capabilityCalls += 1
        capabilityStarted()
        return await new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
      },
      input: null,
      invocationId: 'executor-loss',
      program: program('export default async (_input, capability) => capability.actions.call("example.echo", {})'),
    })
    await started
    const crashed = expect(pending).rejects.toMatchObject({ code: 'executor-crashed' })
    process.kill(await executorPid(), 'SIGKILL')

    await crashed
    expect(capabilityCalls).toBe(1)
    await expect(invoke('export default () => "rebuilt"')).resolves.toBe('rebuilt')
    expect(capabilityCalls).toBe(1)
  })

  it('retires an idle Executor after its isolate budget and rebuilds transparently', async () => {
    const initialPid = await executorPid()
    for (let index = 0; index < 1_000; index += 1) await invoke('export default () => true')
    await expect(invoke('export default () => "retired-and-rebuilt"')).resolves.toBe('retired-and-rebuilt')
    expect(await executorPid()).not.toBe(initialPid)
  })
})

it('reads immutable single and merged predecessor arrays through the isolated script bridge', async () => {
  const port = { handle: 'value', jsonSchema: {}, nullable: true }
  const prepared = await prepareFlow(
    {
      modelVersion: currentFlowModelVersion,
      modules: {
        probe: { name: 'Probe', imports: [], source: 'export default async (_, context) => ({ value: await context.getPrevious() })' },
        sink: {
          name: 'Sink',
          imports: [],
          source: `export default async (input, context) => {
        const first = await context.getPrevious();
        first[0].outputs.value = 'mutated';
        const second = await context.getPrevious();
        return { value: { root: input.root, previous: second } };
      }`,
        },
      },
      document: {
        bindings: {},
        graph: {
          nodes: {
            start: { kind: 'manual', name: 'Start' },
            probe: { kind: 'task', inputs: {}, task: { moduleId: 'probe', name: 'Probe', inputs: [], outputs: [port] } },
            left: { kind: 'value', name: 'Left', inputs: {}, values: [{ ...port, value: 1 }] },
            right: { kind: 'value', name: 'Right', inputs: {}, values: [{ ...port, value: 2 }] },
            sink: {
              kind: 'task',
              inputs: { root: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'probe', output: 'value' }] } },
              task: { moduleId: 'sink', name: 'Sink', inputs: [{ ...port, handle: 'root' }], outputs: [port] },
            },
          },
          edges: [
            { source: 'start', target: 'probe' },
            { source: 'probe', target: 'left' },
            { source: 'probe', target: 'right' },
            { source: 'left', target: 'sink' },
            { source: 'right', target: 'sink' },
          ],
        },
      },
    },
    currentEngineContract,
  )
  if (prepared.kind != 'prepared') throw new Error(JSON.stringify(prepared))
  const outcome = await Effect.runPromise(
    host.run(prepared.flow, {
      emit: () => {},
      flowId: 'predecessors',
      runId: 'predecessors',
      trigger: { nodeId: 'start', outputs: {} },
      capability: async () => {
        throw new Error('Unexpected capability')
      },
      invokeTask: async () => {
        throw new Error('Unexpected managed task')
      },
      projectFailure: (error) => ({ code: 'test', message: String(error) }),
    }),
  )
  expect(outcome).toMatchObject({
    kind: 'node-results',
    nodes: [
      {
        nodeId: 'sink',
        outputs: {
          value: {
            root: [{ id: 'start', name: 'Start', outputs: {}, outputDefs: [] }],
            previous: [
              { id: 'left', name: 'Left', outputs: { value: 1 }, outputDefs: [port] },
              { id: 'right', name: 'Right', outputs: { value: 2 }, outputDefs: [port] },
            ],
          },
        },
      },
    ],
  })
})

async function retryFixture(kind: 'managed' | 'code', source?: string, onError?: 'error') {
  const port = { handle: 'value', jsonSchema: { type: 'number' }, nullable: false }
  const prepared = await prepareFlow(
    {
      modelVersion: currentFlowModelVersion,
      modules:
        kind == 'code'
          ? {
              code: {
                name: 'Code',
                imports: [],
                source:
                  source ??
                  `export default async (_, context) => {
      const count = await context.actions.example.echo({});
      if (count < 2) throw Object.assign(new Error('temporary'), {code: 'business.rejected'});
      return {value: count}
    }`,
              },
            }
          : {},
      document: {
        bindings: {},
        graph: {
          nodes: {
            start: { kind: 'manual', name: 'Start' },
            task: {
              kind: 'task',
              inputs: {},
              retry: { maxRetries: 2, intervalMs: 1000 },
              onError,
              task:
                kind == 'code'
                  ? {
                      moduleId: 'code',
                      name: 'Task',
                      inputs: [],
                      outputs: [port],
                      capabilities: [{ kind: 'connector', action: 'example.echo', connections: [] }],
                    }
                  : { name: 'Task', inputs: [], outputs: [port], executor: { kind: 'llm', mode: 'chat' } },
            },
          },
          edges: [{ source: 'start', target: 'task' }],
        },
      },
    },
    currentEngineContract,
  )
  if (prepared.kind != 'prepared') throw new Error(JSON.stringify(prepared))
  return prepared.flow
}

it.each(['managed', 'code'] as const)('retries %s Tasks through the real Executor with one logical execution', async (kind) => {
  const prepared = await retryFixture(kind)
  let count = 0
  const identities: string[] = []
  const events: string[] = []
  const result = await Effect.runPromise(
    host.run(prepared, {
      flowId: 'retry',
      runId: 'retry',
      trigger: { nodeId: 'start', outputs: {} },
      emit: (event) => {
        events.push(event.type)
      },
      capability: async (_capabilities, call) => {
        identities.push(call.invocationId)
        return { body: ++count, status: 200 }
      },
      invokeTask: async (invocation) => {
        identities.push(invocation.invocationId)
        if (++count < 2) throw new Error('temporary')
        return { value: count }
      },
      projectFailure: (error) => ({ code: 'node.failed', message: String(error), retryable: true }),
    }),
  )
  expect(result).toMatchObject({ kind: 'node-results', nodes: [{ nodeId: 'task', outputs: { value: 2 } }] })
  expect(count).toBe(2)
  expect(new Set(identities).size).toBe(2)
  expect(events.filter((event) => event == 'node.started')).toHaveLength(1)
  expect(events.filter((event) => event == 'node.failed')).toHaveLength(0)
  expect(events.filter((event) => event == 'node.log')).toHaveLength(1)
})

it('bounds Flow Code Tasks by node and Run deadlines rather than the standalone wall-clock limit', async () => {
  const prepared = await retryFixture('code', 'export default async () => { await new Promise((resolve) => setTimeout(resolve, 150)); return { value: 1 } }')
  const result = await Effect.runPromise(
    host.run(
      prepared,
      {
        flowId: 'wall',
        runId: 'wall',
        trigger: { nodeId: 'start', outputs: {} },
        emit: () => {},
        capability: async () => ({ body: null, status: 200 }),
        invokeTask: async () => ({}),
        projectFailure: (error) => ({ code: 'node.failed', message: String(error) }),
      },
      { ...isolatedVmLimits, wallMs: 50 },
    ),
  )
  expect(result).toMatchObject({ kind: 'node-results', nodes: [{ nodeId: 'task', outputs: { value: 1 } }] })
})

it.each([
  { catchable: false, retryable: false },
  { catchable: true, retryable: false },
  { catchable: false, retryable: true },
  { catchable: true, retryable: true },
])('preserves independent Host capability classification through guest code: %j', async ({ catchable, retryable }) => {
  const prepared = await retryFixture(
    'code',
    `export default async (_, context) => {
    try { await context.actions.example.echo({}) } catch (error) {
      error.catchable = true;
      error.retryable = true;
      throw error;
    }
  }`,
    'error',
  )
  let calls = 0
  const handledCodes: string[] = []
  const outcome = Effect.runPromise(
    host.run(prepared, {
      flowId: 'classified',
      runId: 'classified',
      trigger: { nodeId: 'start', outputs: {} },
      emit: (event) => {
        if (event.type == 'node.failed' && event.handled) handledCodes.push(event.code)
      },
      capability: async () => {
        calls++
        throw new Error('Denied')
      },
      invokeTask: async () => ({}),
      projectFailure: (error) => ({ code: 'capability.denied', message: String(error), catchable, retryable }),
    }),
  )
  if (catchable) await expect(outcome).resolves.toMatchObject({ nodes: [{ status: 'error-handled', systemOutputs: { error: { code: 'capability.denied' } } }] })
  else await expect(outcome).rejects.toThrow('Denied')
  expect(calls).toBe(retryable ? 3 : 1)
  expect(handledCodes).toEqual(catchable ? ['capability.denied'] : [])
})

it.each([
  'export default () => ({value: "wrong"})',
  'export default () => ({value: 1n})',
  'export default () => { while (true) {} }',
  `export default () => {
    JSON.stringify = () => '{"ok":true,"engineDigest":"wrong","value":{"value":1},"retryable":true}'
    return {value: 1}
  }`,
])('does not retry validation, resource or integrity failures in the real Code executor: %s', async (source) => {
  const prepared = await retryFixture('code', source)
  const events: string[] = []
  await expect(
    Effect.runPromise(
      host.run(
        prepared,
        {
          flowId: 'terminal',
          runId: 'terminal',
          trigger: { nodeId: 'start', outputs: {} },
          emit: (event) => {
            events.push(event.type)
          },
          capability: async () => ({ body: null, status: 200 }),
          invokeTask: async () => ({}),
          projectFailure: (error) => ({ code: 'node.failed', message: String(error), retryable: true }),
        },
        { ...isolatedVmLimits, cpuMs: 20 },
      ),
    ),
  ).rejects.toThrow()
  expect(events.filter((event) => event == 'node.log')).toHaveLength(0)
  expect(events.filter((event) => event == 'node.failed')).toHaveLength(1)
})
it('does not replay an unconfirmed Code Action even when user code catches it', async () => {
  const prepared = await retryFixture(
    'code',
    `export default async (_, context) => {
    try { await context.actions.example.echo({}) } catch {}
    throw new Error('later business failure')
  }`,
  )
  let calls = 0
  const events: string[] = []
  await expect(
    Effect.runPromise(
      host.run(prepared, {
        flowId: 'unknown',
        runId: 'unknown',
        trigger: { nodeId: 'start', outputs: {} },
        emit: (event) => {
          events.push(event.type)
        },
        capability: async () => {
          calls++
          throw new Error('outcome unknown')
        },
        invokeTask: async () => ({}),
        projectFailure: () => ({ code: 'connector.indeterminate', message: 'outcome unknown' }),
      }),
    ),
  ).rejects.toThrow('outcome unknown')
  expect(calls).toBe(1)
  expect(events.filter((event) => event == 'node.log')).toHaveLength(0)
})
