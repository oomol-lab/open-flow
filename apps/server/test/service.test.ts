import type { RevisionContent } from '@oomol-lab/open-flow/flow-change'
import type { InvokeLlmTask } from '@oomol-lab/open-flow/runtime-contract'

import { controlErrorCode } from '@oomol-lab/open-flow/control-api'
import * as Effect from 'effect/Effect'
import { TestClock } from 'effect/testing'
import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ServerService } from '../node/service.ts'
import { createConnectorHost } from './connectorHost.ts'
import { acceptRun, storeRevision } from './runFixture.ts'
import { closeService, openService, startService } from './serviceFixture.ts'

const directories: string[] = []
const execFileAsync = promisify(execFile)
const port = { jsonSchema: {}, nullable: false } as const

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })))
})

async function databaseFile(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'open-flow-server-'))
  directories.push(directory)
  return path.join(directory, 'open-flow.sqlite')
}

function fullFlow(value = 2): RevisionContent {
  return {
    document: {
      bindings: {},
      graph: {
        nodes: {
          value: {
            concurrency: 1,
            inputs: {},
            kind: 'value',
            values: [{ ...port, handle: 'value', value }],
          },
          increment: {
            concurrency: 1,
            inputs: { value: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'value', output: 'value' }] } },
            kind: 'task',
            task: { inputs: [{ ...port, handle: 'value' }], moduleId: 'increment', name: 'Increment', outputs: [{ ...port, handle: 'value' }] },
          },
          nested: {
            concurrency: 1,
            inputs: { value: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'increment', output: 'value' }] } },
            kind: 'subflow',
            subflowId: 'double',
          },
        },
      },
      subflows: {
        double: {
          graph: {
            nodes: {
              task: {
                concurrency: 1,
                inputs: { value: { kind: 'sources', sources: [{ input: 'value', kind: 'flow' }] } },
                kind: 'task',
                task: { inputs: [{ ...port, handle: 'value' }], moduleId: 'double', name: 'Double', outputs: [{ ...port, handle: 'value' }] },
              },
            },
          },
          inputs: [{ ...port, handle: 'value' }],
          name: 'Double',
          outputs: [{ ...port, handle: 'value', sources: [{ kind: 'node', nodeId: 'task', output: 'value' }] }],
        },
      },
      tasks: {},
    },
    modelVersion: 1,
    modules: {
      double: { imports: [], name: 'Double', source: 'export default ({ value }) => ({ value: value * 2 })' },
      increment: { imports: [], name: 'Increment', source: 'export default ({ value }) => ({ value: value + 1 })' },
    },
  }
}

function hangingFlow(): RevisionContent {
  return {
    document: {
      bindings: {},
      graph: {
        nodes: {
          task: {
            concurrency: 1,
            inputs: {},
            kind: 'task',
            task: { inputs: [], moduleId: 'main', name: 'Main', outputs: [] },
          },
        },
      },
      subflows: {},
      tasks: {},
    },
    modelVersion: 1,
    modules: { main: { imports: [], name: 'Main', source: 'export default async () => await new Promise(() => {})' } },
  }
}

function variableFlow(): RevisionContent {
  return {
    document: {
      bindings: { token: { kind: 'variable', target: 'TOKEN' } },
      graph: {
        nodes: {
          task: {
            concurrency: 1,
            inputs: { token: { kind: 'sources', sources: [{ bindingId: 'token', kind: 'binding' }] } },
            kind: 'task',
            task: {
              inputs: [{ handle: 'token', jsonSchema: { type: 'string' }, nullable: false }],
              moduleId: 'main',
              name: 'Variable',
              outputs: [{ handle: 'token', jsonSchema: { type: 'string' }, nullable: false }],
            },
          },
        },
      },
      subflows: {},
      tasks: {},
    },
    modelVersion: 1,
    modules: { main: { imports: [], name: 'Main', source: 'export default ({ token }) => ({ token })' } },
  }
}

function llmFlow(): RevisionContent {
  return {
    document: {
      bindings: {},
      graph: {
        nodes: {
          llm: {
            concurrency: 1,
            inputs: { prompt: { kind: 'value', value: 'Hello' } },
            kind: 'task',
            taskId: 'llm',
          },
        },
      },
      subflows: {},
      tasks: {
        llm: {
          executor: { kind: 'llm', mode: 'json' },
          inputs: [{ ...port, handle: 'prompt' }],
          name: 'Generate',
          outputs: [{ ...port, handle: 'answer' }],
        },
      },
    },
    modelVersion: 1,
    modules: {},
  }
}

async function waitForStatus(service: ServerService, runId: string, status: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (service.run(runId)?.status == status) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`Run did not reach ${status}.`)
}

describe('Server application service', () => {
  it('checks Variable eligibility after idempotency and fails unresolved queued Runs before start', async () => {
    const service = await openService(await databaseFile(), undefined, Date.now, { maxConcurrentRuns: 1 })
    await startService(service)
    const blocker = await acceptRun(service, {
      flowId: 'blocker',
      idempotencyKey: 'variable-blocker',
      revision: hangingFlow(),
      revisionId: 'revision-variable-blocker',
    })
    if (blocker.kind != 'accepted') throw new Error('Variable blocker Run was not accepted.')
    await waitForStatus(service, blocker.runId, 'running')
    await expect(
      acceptRun(service, { flowId: 'main', idempotencyKey: 'variable-missing', revision: variableFlow(), revisionId: 'revision-variable' }),
    ).rejects.toMatchObject({ code: controlErrorCode.bindingUnresolved })

    service.control.putVariable('TOKEN', 'first')
    const accepted = await acceptRun(service, {
      flowId: 'main',
      idempotencyKey: 'variable-run',
      revision: variableFlow(),
      revisionId: 'revision-variable',
    })
    if (accepted.kind != 'accepted') throw new Error('Variable Run was not accepted.')
    service.control.deleteVariable('TOKEN')
    await expect(
      acceptRun(service, { flowId: 'main', idempotencyKey: 'variable-run', revision: variableFlow(), revisionId: 'revision-variable' }),
    ).resolves.toMatchObject({ created: false, runId: accepted.runId })

    service.cancel(blocker.runId)
    await service.waitForIdle()

    expect(service.control.getRunResult(accepted.runId)).toMatchObject({ error: { code: controlErrorCode.bindingUnresolved }, status: 'failed' })
    expect(service.run(accepted.runId)).toMatchObject({ status: 'failed' })
    expect(service.events(accepted.runId).some(({ kind }) => kind == 'run.started')).toBe(false)
    await closeService(service)
  })

  it('resolves one Variable snapshot at Run start without copying it into node.started', async () => {
    const service = await openService(await databaseFile(), undefined, Date.now, { maxConcurrentRuns: 1 })
    await startService(service)
    const blocker = await acceptRun(service, {
      flowId: 'blocker',
      idempotencyKey: 'snapshot-blocker',
      revision: hangingFlow(),
      revisionId: 'revision-snapshot-blocker',
    })
    if (blocker.kind != 'accepted') throw new Error('Variable snapshot blocker Run was not accepted.')
    await waitForStatus(service, blocker.runId, 'running')
    service.control.putVariable('TOKEN', 'queued-value')
    const accepted = await acceptRun(service, {
      flowId: 'main',
      idempotencyKey: 'variable-snapshot',
      revision: variableFlow(),
      revisionId: 'revision-variable-snapshot',
    })
    if (accepted.kind != 'accepted') throw new Error('Variable Run was not accepted.')
    service.control.putVariable('TOKEN', 'start-value')

    service.cancel(blocker.runId)
    await service.waitForIdle()

    expect(service.control.getRunResult(accepted.runId)).toMatchObject({
      result: { nodes: [{ jobs: [{ outputs: { token: 'start-value' } }], nodeId: 'task' }] },
      status: 'completed',
    })
    const started = service.events(accepted.runId).filter(({ kind }) => kind == 'node.started')
    expect(JSON.stringify(started)).not.toContain('start-value')
    await closeService(service)
  })

  it('executes a fixed full Flow through Scheduler and isolated-vm and persists public events', async () => {
    const service = await openService(await databaseFile())
    await startService(service)
    const accepted = await acceptRun(service, {
      flowId: 'main',
      idempotencyKey: 'full-flow',
      revision: fullFlow(),
      revisionId: 'revision-a',
    })
    if (accepted.kind != 'accepted') throw new Error('Initial Run acceptance conflicted.')
    await service.waitForIdle()

    expect(service.run(accepted.runId)).toMatchObject({
      eventsTruncated: false,
      result: {
        kind: 'node-results',
        nodes: [{ jobs: [{ outputs: { value: 6 } }], nodeId: 'nested' }],
      },
      status: 'completed',
    })
    const events = service.events(accepted.runId)
    const kinds = events.map((event) => event.kind)
    expect(kinds[0]).toBe('run.queued')
    expect(kinds.at(-1)).toBe('run.completed')
    expect(kinds.filter((kind) => kind == 'run.started')).toHaveLength(2)
    expect(kinds.filter((kind) => kind == 'node.started')).toHaveLength(4)
    expect(kinds.filter((kind) => kind == 'node.output')).toHaveLength(4)
    expect(kinds.filter((kind) => kind == 'node.completed')).toHaveLength(4)
    expect(kinds.filter((kind) => kind == 'run.progress')).toHaveLength(4)
    expect(events.map((event) => event.cursor)).toEqual(events.map((_, index) => index + 1))
    expect(JSON.stringify(events.filter((event) => event.kind != 'run.completed'))).not.toContain('jobId')
    expect(service.control.getRunResult(accepted.runId)).toMatchObject({ result: { kind: 'node-results' }, status: 'completed' })
    const projected = service.control.getRunEvents(accepted.runId, 0, 100)
    expect(projected.done).toBe(true)
    expect(projected.nextAfter).toBe(events.length)
    expect(JSON.stringify(projected.events)).toContain('"output":{"kind":"inline"')

    await expect(acceptRun(service, { flowId: 'main', idempotencyKey: 'full-flow', revision: fullFlow(), revisionId: 'revision-a' })).resolves.toMatchObject({
      created: false,
      runId: accepted.runId,
      status: 'completed',
    })
    await expect(acceptRun(service, { flowId: 'main', idempotencyKey: 'full-flow', revision: fullFlow(4), revisionId: 'revision-b' })).resolves.toEqual({
      kind: 'conflict',
    })
    await closeService(service)
  })

  it('reopens queued work after Scope interruption and completes the same Run once', async () => {
    const file = await databaseFile()
    let service = await openService(file, undefined, Date.now, { maxConcurrentRuns: 1 })
    await startService(service)
    const blocker = await acceptRun(service, {
      flowId: 'blocker',
      idempotencyKey: 'reopen-blocker',
      revision: hangingFlow(),
      revisionId: 'revision-reopen-blocker',
    })
    if (blocker.kind != 'accepted') throw new Error('Reopen blocker Run was not accepted.')
    await waitForStatus(service, blocker.runId, 'running')
    const accepted = await acceptRun(service, {
      flowId: 'main',
      idempotencyKey: 'before-barrier',
      revision: fullFlow(),
      revisionId: 'revision-a',
    })
    if (accepted.kind != 'accepted') throw new Error('Initial Run acceptance conflicted.')
    expect(service.run(accepted.runId)?.status).toBe('queued')
    await closeService(service)

    service = await openService(file, undefined, Date.now, { maxConcurrentRuns: 1 })
    await startService(service)
    await service.waitForIdle()
    expect(service.run(accepted.runId)?.status).toBe('completed')
    expect(service.events(accepted.runId).filter((event) => event.kind == 'run.started')).toHaveLength(2)
    expect(service.events(accepted.runId).filter((event) => event.kind == 'run.completed')).toHaveLength(1)
    await closeService(service)
  })

  it('fails an unstartable Run without poisoning later work or readiness', async () => {
    const file = await databaseFile()
    let service = await openService(file, undefined, Date.now, { maxConcurrentRuns: 1 })
    await startService(service)
    const blocker = await acceptRun(service, {
      flowId: 'blocker',
      idempotencyKey: 'poisoned-blocker',
      revision: hangingFlow(),
      revisionId: 'revision-poisoned-blocker',
    })
    if (blocker.kind != 'accepted') throw new Error('Poisoned Run blocker was not accepted.')
    await waitForStatus(service, blocker.runId, 'running')
    const poisoned = await acceptRun(service, {
      flowId: 'main',
      idempotencyKey: 'poisoned',
      revision: fullFlow(),
      revisionId: 'revision-a',
    })
    const healthy = await acceptRun(service, {
      flowId: 'main',
      idempotencyKey: 'healthy',
      revision: fullFlow(),
      revisionId: 'revision-a',
    })
    if (poisoned.kind != 'accepted' || healthy.kind != 'accepted') throw new Error('Run acceptance conflicted.')
    await expect(service.ready()).resolves.toBe(true)
    await closeService(service)

    const database = new DatabaseSync(file)
    database.prepare('UPDATE runs SET engine_digest = ? WHERE run_id = ?').run('sha256:unavailable', poisoned.runId)
    database.close()

    service = await openService(file, undefined, Date.now, { maxConcurrentRuns: 1 })
    await startService(service)
    await expect(service.ready()).resolves.toBe(true)
    await service.waitForIdle()

    expect(service.run(poisoned.runId)).toMatchObject({
      result: { error: { code: 'execution.unavailable', message: 'The fixed Run could not be started by this deployment.' } },
      status: 'failed',
    })
    expect(service.control.getRunResult(poisoned.runId)).toMatchObject({
      error: { code: 'execution.unavailable', message: 'The fixed Run could not be started by this deployment.' },
      status: 'failed',
    })
    expect(service.events(poisoned.runId).map((event) => event.kind)).toEqual(['run.queued', 'run.failed'])
    expect(service.run(healthy.runId)?.status).toBe('completed')
    await closeService(service)
  })

  it('lets cancellation win once and terminates the active Executor', async () => {
    const service = await openService(await databaseFile())
    await startService(service)
    const accepted = await acceptRun(service, {
      flowId: 'main',
      idempotencyKey: 'cancel',
      revision: hangingFlow(),
      revisionId: 'revision-cancel',
    })
    if (accepted.kind != 'accepted') throw new Error('Initial Run acceptance conflicted.')
    await waitForStatus(service, accepted.runId, 'running')
    expect(service.control.cancelRun(accepted.runId)).toMatchObject({ cancelAccepted: true, status: 'canceled' })
    await service.waitForIdle()

    expect(service.run(accepted.runId)?.status).toBe('canceled')
    expect(service.control.cancelRun(accepted.runId)).toMatchObject({ cancelAccepted: false, status: 'canceled' })
    expect(service.control.getRunResult(accepted.runId)).toMatchObject({ status: 'canceled' })
    expect(service.events(accepted.runId).filter((event) => ['run.canceled', 'run.completed', 'run.failed'].includes(event.kind))).toEqual([
      expect.objectContaining({ kind: 'run.canceled' }),
    ])
    await closeService(service)
  })

  it('interrupts active Runs when the service Scope closes', async () => {
    const file = await databaseFile()
    let service = await openService(file)
    await startService(service)
    const accepted = await acceptRun(service, {
      flowId: 'main',
      idempotencyKey: 'scope-close',
      revision: hangingFlow(),
      revisionId: 'revision-scope-close',
    })
    if (accepted.kind != 'accepted') throw new Error('Scope close Run acceptance conflicted.')
    await waitForStatus(service, accepted.runId, 'running')
    await closeService(service)

    service = await openService(file)
    expect(service.run(accepted.runId)).toMatchObject({
      result: { error: { code: 'execution.terminal-unknown' } },
      status: 'indeterminate',
    })
    expect(service.events(accepted.runId).filter(({ kind }) => ['run.canceled', 'run.completed', 'run.failed', 'run.indeterminate'].includes(kind))).toEqual([
      expect.objectContaining({ kind: 'run.indeterminate' }),
    ])
    await closeService(service)
  })

  it('runs different Flows concurrently without overlapping Runs from one Flow', async () => {
    const releases: (() => void)[] = []
    let invocation = 0
    const service = await openService(await databaseFile(), undefined, Date.now, {
      llm: async () => {
        invocation += 1
        if (invocation > 2) return { kind: 'completed', value: { answer: 'done' }, version: 1 }
        return await new Promise((resolve) => {
          releases.push(() => resolve({ kind: 'completed', value: { answer: 'done' }, version: 1 }))
        })
      },
      maxConcurrentRuns: 2,
    })
    await startService(service)
    const first = await acceptRun(service, { flowId: 'main', idempotencyKey: 'revision-a-first', revision: llmFlow(), revisionId: 'revision-a' })
    const second = await acceptRun(service, { flowId: 'main', idempotencyKey: 'revision-a-second', revision: llmFlow(), revisionId: 'revision-a' })
    const other = await acceptRun(service, { flowId: 'main', idempotencyKey: 'revision-b', revision: llmFlow(), revisionId: 'revision-b' })
    if (first.kind != 'accepted' || second.kind != 'accepted' || other.kind != 'accepted') throw new Error('Concurrent Run setup conflicted.')

    await Promise.all([waitForStatus(service, first.runId, 'running'), waitForStatus(service, other.runId, 'running')])
    expect(service.run(second.runId)?.status).toBe('queued')
    await vi.waitFor(() => expect(releases).toHaveLength(2))

    for (const release of releases) release()
    await service.waitForIdle()
    expect([first.runId, second.runId, other.runId].map((runId) => service.run(runId)?.status)).toEqual(['completed', 'completed', 'completed'])
    await closeService(service)
  })

  it('fails concurrent Flow sessions once on shared Executor loss and rebuilds for later Runs', async () => {
    let aborted = 0
    let calls = 0
    const started = Promise.withResolvers<void>()
    const service = await openService(await databaseFile(), undefined, Date.now, {
      llm: async ({ signal }) => {
        calls += 1
        if (calls > 2) return { kind: 'completed', value: { answer: 'recovered' }, version: 1 }
        if (calls == 2) started.resolve()
        return await new Promise<never>((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => {
              aborted += 1
              reject(signal.reason)
            },
            { once: true },
          )
        })
      },
      maxConcurrentRuns: 2,
    })
    await startService(service)
    const first = await acceptRun(service, { flowId: 'main', idempotencyKey: 'executor-loss-a', revision: llmFlow(), revisionId: 'executor-loss-a' })
    const second = await acceptRun(service, { flowId: 'main', idempotencyKey: 'executor-loss-b', revision: llmFlow(), revisionId: 'executor-loss-b' })
    if (first.kind != 'accepted' || second.kind != 'accepted') throw new Error('Concurrent Run setup conflicted.')

    await started.promise
    const { stdout } = await execFileAsync('ps', ['-A', '-o', 'pid=,ppid=,command='])
    const executor = stdout
      .split('\n')
      .map((line) => /^(\s*\d+)\s+(\d+)\s+(.+)$/.exec(line))
      .find((match) => match?.[2] == String(process.pid) && match[3].includes('--executor'))
    if (executor == null) throw new Error('Runtime Executor process was not found.')
    process.kill(Number(executor[1]), 'SIGKILL')

    await service.waitForIdle()
    await vi.waitFor(() => expect(aborted).toBe(2))
    expect(calls).toBe(2)
    for (const runId of [first.runId, second.runId]) {
      expect(service.run(runId)?.status).toBe('failed')
      expect(
        service
          .events(runId)
          .filter((event) => ['run.canceled', 'run.completed', 'run.failed'].includes(event.kind))
          .map((event) => event.kind),
      ).toEqual(['run.failed'])
    }

    const recovered = await acceptRun(service, {
      flowId: 'main',
      idempotencyKey: 'executor-recovered',
      revision: llmFlow(),
      revisionId: 'executor-recovered',
    })
    if (recovered.kind != 'accepted') throw new Error('Recovery Run setup conflicted.')
    await service.waitForIdle()
    expect(service.run(recovered.runId)?.status).toBe('completed')
    expect(calls).toBe(3)
    await closeService(service)
  })

  it('fails a Run that exceeds its execution deadline', async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const clock = yield* TestClock.make()
          const file = yield* Effect.promise(databaseFile)
          const service = yield* ServerService.open(file, undefined, clock, { runTimeoutMs: 25 })
          yield* service.start()
          yield* Effect.tryPromise({
            try: async () => {
              const accepted = await acceptRun(service, {
                flowId: 'main',
                idempotencyKey: 'timeout',
                revision: hangingFlow(),
                revisionId: 'revision-timeout',
              })
              if (accepted.kind != 'accepted') throw new Error('Timeout Run acceptance conflicted.')
              await waitForStatus(service, accepted.runId, 'running')
              await Effect.runPromise(clock.adjust(25))
              await service.waitForIdle()

              expect(service.run(accepted.runId)).toMatchObject({
                result: { error: { code: 'run.timeout', message: 'The Run exceeded its execution deadline.' } },
                status: 'failed',
              })
            },
            catch: (error) => error,
          })
        }),
      ),
    )
  })

  it('executes LLM Tasks through the deployment host and projects stable host failures', async () => {
    const invocations: { readonly input: unknown; readonly mode: string }[] = []
    const configured = await openService(await databaseFile(), undefined, Date.now, {
      llm: async ({ input, mode }) => {
        invocations.push({ input, mode })
        return { kind: 'completed', value: { answer: 'Hello back' }, version: 1 }
      },
    })
    await startService(configured)
    const completed = await acceptRun(configured, { flowId: 'main', idempotencyKey: 'llm-completed', revision: llmFlow(), revisionId: 'revision-llm' })
    if (completed.kind != 'accepted') throw new Error('LLM Run acceptance conflicted.')
    await configured.waitForIdle()

    expect(invocations).toEqual([{ input: { prompt: 'Hello' }, mode: 'json' }])
    expect(configured.run(completed.runId)).toMatchObject({
      result: { kind: 'node-results', nodes: [{ jobs: [{ outputs: { answer: 'Hello back' } }], nodeId: 'llm' }] },
      status: 'completed',
    })
    await closeService(configured)

    const unavailable = await openService(await databaseFile())
    await startService(unavailable)
    const failed = await acceptRun(unavailable, { flowId: 'main', idempotencyKey: 'llm-unavailable', revision: llmFlow(), revisionId: 'revision-llm' })
    if (failed.kind != 'accepted') throw new Error('LLM Run acceptance conflicted.')
    await unavailable.waitForIdle()

    expect(unavailable.events(failed.runId).find((event) => event.kind == 'node.failed')).toMatchObject({
      payload: { error: { code: 'llm.unavailable', message: 'The LLM request could not be completed.' } },
    })
    await closeService(unavailable)

    const transport = await openService(await databaseFile(), undefined, Date.now, {
      llm: async () => {
        throw new Error('provider-secret-detail')
      },
    })
    await startService(transport)
    const rejected = await acceptRun(transport, { flowId: 'main', idempotencyKey: 'llm-rejected', revision: llmFlow(), revisionId: 'revision-llm' })
    if (rejected.kind != 'accepted') throw new Error('LLM Run acceptance conflicted.')
    await transport.waitForIdle()
    expect(transport.events(rejected.runId).find((event) => event.kind == 'node.failed')).toMatchObject({
      payload: { error: { code: 'llm.unavailable', message: 'The LLM request could not be completed.' } },
    })
    expect(JSON.stringify(transport.events(rejected.runId))).not.toContain('provider-secret-detail')
    await closeService(transport)
  })

  it('reports LLM Tasks when the deployment has no LLM host', async () => {
    const unavailable = await openService(await databaseFile())
    const stored = await storeRevision(unavailable, llmFlow(), 'llm-check-unavailable')

    expect(await unavailable.control.checkFlow(stored.flowId, stored.revisionId, 'open-flow-engine/v1')).toMatchObject({
      diagnostics: [
        {
          code: 'llm.unconfigured',
          message: 'LLM is not configured for this deployment. Configure OPEN_FLOW_LLM_ORIGIN and OPEN_FLOW_LLM_TOKEN.',
          path: '/document/tasks/llm/executor',
        },
      ],
      valid: false,
    })

    const configured = await openService(await databaseFile(), undefined, Date.now, {
      llm: async () => ({ kind: 'completed', value: {}, version: 1 }),
    })
    const configuredStored = await storeRevision(configured, llmFlow(), 'llm-check-configured')

    expect(await configured.control.checkFlow(configuredStored.flowId, configuredStored.revisionId, 'open-flow-engine/v1')).toMatchObject({
      diagnostics: [],
      valid: true,
    })
  })

  it('resolves the current LLM host for each check and invocation', async () => {
    let llm: InvokeLlmTask | undefined
    const service = await openService(await databaseFile(), undefined, Date.now, { resolveLlm: () => llm })
    const stored = await storeRevision(service, llmFlow(), 'llm-current')

    expect(await service.control.checkFlow(stored.flowId, stored.revisionId, 'open-flow-engine/v1')).toMatchObject({ valid: false })
    llm = async () => ({ kind: 'completed', value: { answer: 'current' }, version: 1 })
    expect(await service.control.checkFlow(stored.flowId, stored.revisionId, 'open-flow-engine/v1')).toMatchObject({ diagnostics: [], valid: true })

    await startService(service)
    const accepted = await acceptRun(service, { flowId: 'main', idempotencyKey: 'llm-current', revision: llmFlow(), revisionId: 'llm-current' })
    if (accepted.kind != 'accepted') throw new Error('LLM Run acceptance conflicted.')
    await service.waitForIdle()
    expect(service.run(accepted.runId)).toMatchObject({ status: 'completed' })
  })

  it('resolves the current Connector host and Console origin for each request', async () => {
    let connector = createConnectorHost({ listProviders: async () => [{ serviceId: 'first', serviceName: 'First' }] })
    let consoleOrigin = new URL('https://first.example.com')
    const service = await openService(await databaseFile(), undefined, Date.now, {
      resolveConnector: () => connector,
      resolveConnectorConsoleOrigin: () => consoleOrigin,
    })

    expect(await service.control.listConnectorProviders()).toEqual([{ serviceId: 'first', serviceName: 'First' }])
    expect(service.control.connectorConnectionPage('mail')).toBe('https://first.example.com/providers/mail')

    connector = createConnectorHost({ listProviders: async () => [{ serviceId: 'second', serviceName: 'Second' }] })
    consoleOrigin = new URL('https://second.example.com')
    expect(await service.control.listConnectorProviders()).toEqual([{ serviceId: 'second', serviceName: 'Second' }])
    expect(service.control.connectorConnectionPage('mail')).toBe('https://second.example.com/providers/mail')
  })

  it('ignores unreferenced LLM Tasks when the deployment has no LLM host', async () => {
    const unavailable = await openService(await databaseFile())
    const content = variableFlow()
    const unused = llmFlow().document.tasks.llm
    if (unused == null) throw new Error('LLM Task fixture is missing.')
    const stored = await storeRevision(
      unavailable,
      {
        ...content,
        document: {
          ...content.document,
          tasks: { unused },
        },
      },
      'llm-check-unreferenced',
    )

    expect(await unavailable.control.checkFlow(stored.flowId, stored.revisionId, 'open-flow-engine/v1')).toMatchObject({
      diagnostics: [],
      valid: true,
    })
  })

  it('propagates Run cancellation into the active LLM Task host', async () => {
    let started!: () => void
    const invoked = new Promise<void>((resolve) => {
      started = resolve
    })
    let aborted = false
    const service = await openService(await databaseFile(), undefined, Date.now, {
      llm: async ({ signal }) => {
        started()
        return await new Promise<never>((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => {
              aborted = true
              reject(signal.reason)
            },
            { once: true },
          )
        })
      },
    })
    await startService(service)
    const accepted = await acceptRun(service, { flowId: 'main', idempotencyKey: 'llm-canceled', revision: llmFlow(), revisionId: 'revision-llm' })
    if (accepted.kind != 'accepted') throw new Error('LLM Run acceptance conflicted.')
    await invoked
    expect(service.cancel(accepted.runId)).toBe(true)
    await service.waitForIdle()

    expect(aborted).toBe(true)
    expect(service.run(accepted.runId)?.status).toBe('canceled')
    await closeService(service)
  })

  it.each([
    ['llm.output-invalid', 'The model output did not match the requested schema.'],
    ['llm.unavailable', 'The model service is unavailable.'],
  ] as const)('preserves the deployment LLM failure %s', async (code, message) => {
    const service = await openService(await databaseFile(), undefined, Date.now, {
      llm: async () => ({ code, kind: 'failed', message, version: 1 }),
    })
    await startService(service)
    const accepted = await acceptRun(service, { flowId: 'main', idempotencyKey: code, revision: llmFlow(), revisionId: 'revision-llm' })
    if (accepted.kind != 'accepted') throw new Error('LLM failure Run acceptance conflicted.')
    await service.waitForIdle()

    expect(service.events(accepted.runId).find((event) => event.kind == 'node.failed')).toMatchObject({
      payload: { error: { code, message } },
    })
    await closeService(service)
  })
})
