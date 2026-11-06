import type { RevisionContent } from '@oomol-lab/open-flow/flow-change'

import { currentFlowModelVersion } from '@oomol-lab/open-flow/flow-change'
import { createServer } from 'node:http'
import { expect, it, onTestFinished } from 'vitest'
import { childProcessId } from './processTree.ts'
import { acceptRun } from './runFixture.ts'
import { openService, startService } from './serviceFixture.ts'

function parallelFlow(width: number): RevisionContent {
  return {
    modelVersion: currentFlowModelVersion,
    modules: {},
    document: {
      bindings: {},
      graph: {
        edges: [],
        nodes: Object.fromEntries(
          Array.from({ length: width }, (_, index) => [
            `llm${index}`,
            {
              kind: 'task' as const,
              inputs: { prompt: { kind: 'value' as const, value: 'Hello' } },
              task: {
                name: `LLM ${index}`,
                executor: { kind: 'llm' as const, mode: 'json' as const },
                inputs: [{ handle: 'prompt', jsonSchema: {}, nullable: false }],
                outputs: [{ handle: 'answer', jsonSchema: {}, nullable: false }],
              },
            },
          ]),
        ),
      },
    },
  }
}

it('bounds actual node execution across parallel nodes and independent Runs of one Flow', async () => {
  let active = 0
  let peak = 0
  let calls = 0
  const service = await openService(':memory:', {
    clock: Date.now,
    runtime: { maxConcurrentRuns: 2, maxConcurrentTasks: 2 },
    capabilities: {
      llm: () => async () => {
        active++
        peak = Math.max(peak, active)
        calls++
        await new Promise((resolve) => setTimeout(resolve, 10))
        active--
        return { kind: 'completed', version: 1, value: { answer: 1 } }
      },
    },
  })
  await startService(service)
  const revision = parallelFlow(8)
  const first = await acceptRun(service, { flowId: 'flow', revision, revisionId: 'same', idempotencyKey: 'first' })
  const second = await acceptRun(service, { flowId: 'flow', revision, revisionId: 'same', idempotencyKey: 'second' })
  if (first.kind != 'accepted' || second.kind != 'accepted') throw new Error('Expected acceptance')
  await service.waitForIdle()
  expect([service.run(first.runId)?.status, service.run(second.runId)?.status]).toEqual(['completed', 'completed'])
  expect(calls).toBe(16)
  expect(peak).toBe(2)
})

it('cancels queued node admissions and reuses every execution permit afterwards', async () => {
  const started = Promise.withResolvers<void>()
  let blocked = true
  let calls = 0
  const service = await openService(':memory:', {
    clock: Date.now,
    runtime: { maxConcurrentRuns: 2, maxConcurrentTasks: 1 },
    capabilities: {
      llm:
        () =>
        async ({ signal }) => {
          calls++
          if (!blocked) return { kind: 'completed', version: 1, value: { answer: 1 } }
          started.resolve()
          return await new Promise<never>((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
        },
    },
  })
  await startService(service)
  const revision = parallelFlow(4)
  const first = await acceptRun(service, { flowId: 'flow', revision, revisionId: 'same', idempotencyKey: 'first' })
  const second = await acceptRun(service, { flowId: 'flow', revision, revisionId: 'same', idempotencyKey: 'second' })
  if (first.kind != 'accepted' || second.kind != 'accepted') throw new Error('Expected acceptance')
  await started.promise
  service.control.runs.cancelRun('test', first.runId)
  service.control.runs.cancelRun('test', second.runId)
  await service.waitForIdle()
  expect(calls).toBe(1)
  blocked = false
  const third = await acceptRun(service, { flowId: 'flow', revision, revisionId: 'same', idempotencyKey: 'third' })
  if (third.kind != 'accepted') throw new Error('Expected acceptance')
  await service.waitForIdle()
  expect(service.run(third.runId)?.status).toBe('completed')
  expect(calls).toBe(5)
})

it('releases the only Run slot when an idle Wait is persisted', async () => {
  const service = await openService(':memory:', { clock: Date.now, runtime: { maxConcurrentRuns: 1, maxConcurrentTasks: 1 } })
  await startService(service)
  const revision: RevisionContent = {
    modelVersion: currentFlowModelVersion,
    modules: {},
    document: {
      bindings: {},
      graph: {
        edges: [],
        nodes: {
          wait: { kind: 'wait', name: 'Wait', prompt: 'Continue', inputs: {}, inputDefinitions: [] },
        },
      },
    },
  }
  const first = await acceptRun(service, { flowId: 'flow', revision, revisionId: 'wait', idempotencyKey: 'wait' })
  if (first.kind != 'accepted') throw new Error('Expected acceptance')
  await service.waitForIdle()
  expect(service.run(first.runId)?.status).toBe('waiting')
  const quick = await acceptRun(service, {
    flowId: 'quick',
    revisionId: 'quick',
    idempotencyKey: 'quick',
    revision: { ...revision, document: { bindings: {}, graph: { edges: [], nodes: { value: { kind: 'value', name: 'Value', inputs: {}, values: [] } } } } },
  })
  if (quick.kind != 'accepted') throw new Error('Expected acceptance')
  await service.waitForIdle()
  expect(service.run(quick.runId)?.status).toBe('completed')
  expect(service.run(first.runId)?.status).toBe('waiting')
})

it('preserves uncertainty when the Executor dies after a POST reaches its destination', async () => {
  let sideEffects = 0
  const received = Promise.withResolvers<void>()
  const http = createServer((request) => {
    request.resume()
    sideEffects++
    received.resolve()
  })
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve))
  onTestFinished(async () => {
    http.closeAllConnections()
    await new Promise<void>((resolve) => http.close(() => resolve()))
  })
  const address = http.address()
  if (address == null || typeof address == 'string') throw new Error('Expected a listening server')
  const service = await openService(':memory:', { clock: Date.now })
  await startService(service)
  const revision: RevisionContent = {
    modelVersion: currentFlowModelVersion,
    modules: {
      main: {
        name: 'POST',
        imports: [],
        source: `export default async (_, context) => { await context.fetch('http://127.0.0.1:${address.port}', { method: 'POST' }); return {} }`,
      },
    },
    document: {
      bindings: {},
      graph: {
        edges: [],
        nodes: {
          code: {
            kind: 'task',
            inputs: {},
            task: { name: 'POST', moduleId: 'main', inputs: [], outputs: [], capabilities: [{ kind: 'http', hosts: ['127.0.0.1'] }] },
          },
        },
      },
    },
  }
  const accepted = await acceptRun(service, { flowId: 'flow', revision, revisionId: 'post', idempotencyKey: 'post' })
  if (accepted.kind != 'accepted') throw new Error('Expected acceptance')
  await received.promise
  process.kill(await childProcessId(process.pid, '--executor'), 'SIGKILL')
  await service.waitForIdle()
  expect(sideEffects).toBe(1)
  expect(service.control.runs.getRunResult('test', accepted.runId)).toMatchObject({ status: 'indeterminate', error: { code: 'execution.terminal-unknown' } })
})

it('confines Executor loss to active Code Runs and rebuilds without interrupting a managed Task', async () => {
  const started = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  let aborted = false
  const service = await openService(':memory:', {
    clock: Date.now,
    runtime: { maxConcurrentRuns: 3 },
    capabilities: {
      llm:
        () =>
        async ({ signal }) => {
          signal.addEventListener(
            'abort',
            () => {
              aborted = true
            },
            { once: true },
          )
          started.resolve()
          await release.promise
          return { kind: 'completed', version: 1, value: { answer: 1 } }
        },
    },
  })
  await startService(service)
  const revision: RevisionContent = {
    modelVersion: currentFlowModelVersion,
    modules: { main: { name: 'Code', imports: [], source: "export default async () => { console.log('ready'); await new Promise(() => {}); return {} }" } },
    document: {
      bindings: {},
      graph: { edges: [], nodes: { code: { kind: 'task', inputs: {}, task: { name: 'Code', moduleId: 'main', inputs: [], outputs: [] } } } },
    },
  }
  const first = await acceptRun(service, { flowId: 'flow', revision, revisionId: 'code', idempotencyKey: 'first' })
  const second = await acceptRun(service, { flowId: 'flow', revision, revisionId: 'code', idempotencyKey: 'second' })
  const managed = await acceptRun(service, { flowId: 'managed', revision: parallelFlow(1), revisionId: 'managed', idempotencyKey: 'managed' })
  if (first.kind != 'accepted' || second.kind != 'accepted' || managed.kind != 'accepted') throw new Error('Expected acceptance')
  try {
    await started.promise
    for (const run of [first, second])
      await expect.poll(() => service.events(run.runId).some((event) => event.kind == 'node.log' && event.payload.message == 'ready')).toBe(true)
    process.kill(await childProcessId(process.pid, '--executor'), 'SIGKILL')
    for (const run of [first, second]) {
      await expect.poll(() => service.run(run.runId)?.status).toBe('indeterminate')
      expect(service.events(run.runId).filter((event) => event.kind == 'run.indeterminate')).toHaveLength(1)
    }
    expect(service.run(managed.runId)?.status).toBe('running')
    expect(aborted).toBe(false)
  } finally {
    release.resolve()
  }
  await service.waitForIdle()
  expect(service.run(managed.runId)?.status).toBe('completed')
  const recovered = await acceptRun(service, {
    flowId: 'flow',
    revisionId: 'recovered',
    idempotencyKey: 'recovered',
    revision: { ...revision, modules: { main: { ...revision.modules.main!, source: 'export default () => ({})' } } },
  })
  if (recovered.kind != 'accepted') throw new Error('Expected acceptance')
  await service.waitForIdle()
  expect(service.run(recovered.runId)?.status).toBe('completed')
})
