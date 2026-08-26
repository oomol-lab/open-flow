import type { RuntimeHarness, RuntimeProgram } from '@oomol-lab/open-flow/runtime-contract'

import { runtimeConformanceCases } from '@oomol-lab/open-flow/runtime-contract'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { afterAll, describe, expect, it } from 'vitest'
import { IsolatedVmError, isolatedVmEngineDigest, isolatedVmLimits, IsolatedVmHost } from '../node/isolated-vm.ts'

const host = new IsolatedVmHost()
const execFileAsync = promisify(execFile)

const harness: RuntimeHarness = {
  engineDigest: isolatedVmEngineDigest,
  invoke: (invocation) => host.invoke(invocation),
}

afterAll(async () => await host.close())

function program(source: string): RuntimeProgram {
  return {
    engineContract: 'open-flow-engine/v1',
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
  const { stdout } = await execFileAsync('ps', ['-A', '-o', 'pid=,ppid=,command='])
  const processLine = stdout
    .split('\n')
    .map((line) => /^(\s*\d+)\s+(\d+)\s+(.+)$/.exec(line))
    .find((match) => match?.[2] == String(process.pid) && match[3].includes('--executor'))
  if (processLine == null) throw new Error('Runtime Executor process was not found.')
  return Number(processLine[1])
}

describe('isolated-vm runtime conformance', () => {
  for (const conformance of runtimeConformanceCases) {
    it(conformance.name, async () => await conformance.verify(harness))
  }

  it('does not expose Node or network globals to the user realm', async () => {
    await expect(
      invoke(`export default () => ({
        Buffer: typeof Buffer,
        fetch: typeof fetch,
        process: typeof process,
        require: typeof require,
        WebSocket: typeof WebSocket,
      })`),
    ).resolves.toEqual({ Buffer: 'undefined', fetch: 'undefined', process: 'undefined', require: 'undefined', WebSocket: 'undefined' })
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
  await capability.connector({ call: 1 })
  return await capability.connector({ call: 2 })
}`),
        },
        { ...isolatedVmLimits, maxCapabilityCalls: 1 },
      ),
    ).rejects.toMatchObject({ code: 'task-failed' })
    expect(calls).toBe(1)

    await expect(
      host.invoke(
        {
          capability: async () => ({ body: 'x'.repeat(256), status: 200 }),
          input: null,
          invocationId: 'capability-response-limit',
          program: program('export default async (_input, capability) => capability.connector({})'),
        },
        { ...isolatedVmLimits, maxCapabilityResponseBytes: 64 },
      ),
    ).rejects.toMatchObject({ code: 'task-failed' })
  })

  it('enforces the wall-clock and isolate memory limits', async () => {
    await expect(invoke('export default async () => await new Promise(() => {})', { ...isolatedVmLimits, wallMs: 20 })).rejects.toMatchObject({
      code: 'limit-exceeded',
    })
    await expect(
      invoke('export default () => new Array(2_000_000).fill("xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx")', {
        ...isolatedVmLimits,
        cpuMs: 2_000,
        memoryMb: 8,
        wallMs: 5_000,
      }),
    ).rejects.toMatchObject({ code: 'limit-exceeded' })
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
  return { count: globalThis.count, response: await capability.connector(input) }
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
  return { count: globalThis.count, response: await capability.connector(input) }
}`,
      ),
    })

    await expect(Promise.all([first, second])).resolves.toEqual([
      { count: 1, response: { body: { value: 'first' }, status: 200 } },
      { count: 1, response: { body: { value: 'second' }, status: 200 } },
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
      program: program(`export default async (_input, capability) => capability.connector({ wait: true })`),
      signal: cancellation.signal,
    })
    const completed = host.invoke({
      capability: async () => ({ body: 'completed', status: 200 }),
      input: null,
      invocationId: 'concurrent-completed',
      program: program(`export default async (_input, capability) => capability.connector({ wait: false })`),
    })

    await started
    cancellation.abort(new Error('Cancel only the first invocation.'))
    await expect(canceled).rejects.toThrow('Cancel only the first invocation.')
    await expect(completed).resolves.toEqual({ body: 'completed', status: 200 })
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
      program: program('export default async (_input, capability) => capability.connector({})'),
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
      program: program('export default async (_input, capability) => capability.connector({})'),
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
