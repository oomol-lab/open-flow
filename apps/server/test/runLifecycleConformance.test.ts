import type { RunLifecycleHarness } from '@oomol-lab/open-flow/run-lifecycle'

import { isRunTerminal, runLifecycleConformanceCases } from '@oomol-lab/open-flow/run-lifecycle'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { migrateDatabase } from '../node/storage/migrate.ts'
import { Store } from '../node/storage/store.ts'

for (const conformance of runLifecycleConformanceCases) {
  it(conformance.name, async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'open-flow-lifecycle-'))
    const file = path.join(directory, 'store.sqlite')
    migrateDatabase(file)
    const store = new Store(file)
    try {
      store.createFlow({
        actorId: 'operator',
        content: '{}',
        createdAt: Date.now(),
        digest: 'revision',
        flowId: 'flow',
        idempotencyKey: 'flow',
        name: 'Lifecycle',
        requestDigest: 'flow',
        revisionId: 'revision',
      })
      const harness: RunLifecycleHarness = {
        async accept(input) {
          const result = store.acceptControlRun({
            ...input,
            closureDigest: 'closure',
            flowId: 'flow',
            inputs: {},
            modelVersion: 1,
            revisionDigest: 'revision',
            revisionId: 'revision',
            trigger: { nodeId: 'start', payload: {} },
            variableNames: [],
          })
          if (result.kind != 'accepted' && result.kind != 'conflict') throw new Error(`Unexpected admission: ${result.kind}`)
          return result
        },
        async claim(runId) {
          const run = store.run(runId)
          if (run == null) throw new Error('Run is missing.')
          if (isRunTerminal(run.status)) return { kind: 'terminal', status: run.status }
          if (run.status == 'running' || run.status == 'waiting') {
            expect(store.claim()).toBeUndefined()
            return run.status == 'running' ? { kind: 'running', status: 'running' } : { kind: 'waiting', status: 'waiting' }
          }
          expect(store.claim()?.runId).toBe(runId)
          expect(store.run(runId)?.status).toBe('starting')
          return { kind: 'ready', status: 'starting' }
        },
        async start(runId) {
          const run = store.controlRun(runId)
          if (run == null) throw new Error('Run is missing.')
          const started =
            run.startedAt == null ? store.start(runId, { kind: 'run.started', payload: { flowId: 'flow', scopeId: runId } }) : store.resume(runId, 'wait')
          if (started) return { kind: 'started', status: 'running' }
          return run.status == 'running' ? { kind: 'already-started', status: 'running' } : { kind: 'stale', status: run.status }
        },
        async commit(runId, status) {
          return store.commit(runId, status, {})
        },
        async failStarting(runId) {
          return store.failStarting(runId, {})
        },
        async failResume(runId) {
          return store.failResume(runId, {})
        },
        async observe(runId) {
          const run = store.run(runId)
          if (run == null) throw new Error('Run is missing.')
          return {
            status: run.status,
            terminalEvents: store.events(runId).flatMap(({ kind }) => {
              switch (kind) {
                case 'run.canceled':
                  return ['canceled' as const]
                case 'run.completed':
                  return ['completed' as const]
                case 'run.failed':
                  return ['failed' as const]
                case 'run.indeterminate':
                  return ['indeterminate' as const]
                default:
                  return []
              }
            }),
          }
        },
        async wait(runId) {
          const wait = { jobId: 'job', nodeId: 'wait', waitId: 'wait' }
          return (
            store.wait(
              runId,
              {
                kind: 'waiting',
                wait: { ...wait, actions: ['continue'], prompt: 'Continue' },
                checkpoint: { bindingValues: {}, inputs: {}, results: {}, skipped: [], version: 2, agents: {}, queue: [], wait: { ...wait, value: null } },
              },
              1_000,
            ) != null
          )
        },
        async resolve(runId) {
          const result = store.resolveWait(runId, 'wait', 'continue')
          return result.kind == 'resolved' && result.changed && result.resolutionAccepted
        },
      }
      await conformance.verify(harness)
    } finally {
      store.close()
      await rm(directory, { force: true, recursive: true })
    }
  })
}
