import type { WebhookResponseSnapshot } from '@oomol-lab/open-flow/webhook-trigger'

import { currentFlowModelVersion } from '@oomol-lab/open-flow/flow-change'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, it, vi } from 'vitest'
import { runEnvironment } from '../node/application/run-environment.ts'
import { waitForWebhookRun } from '../node/application/webhook-response.ts'
import { isolatedVmEngineDigest } from '../node/runtime/isolated-vm.ts'
import { Database } from '../node/storage/database.ts'
import { Store } from '../node/storage/store.ts'
import { acceptRun } from './runFixture.ts'
import { closeService, openService } from './serviceFixture.ts'

const response: WebhookResponseSnapshot = { body: 'first', contentType: 'text/plain;charset=UTF-8', status: 201, headers: { 'X-Count': '3' } }

it('persists the first response independently of truncated/expired events and Run failure, and deletes it with its Run', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'webhook-response-'))
  const file = path.join(directory, 'store.sqlite')
  const service = await openService(file)
  let database = Database.open(file)
  try {
    let store = new Store(database, runEnvironment(isolatedVmEngineDigest))
    const accepted = await acceptRun(service, {
      flowId: 'main',
      revisionId: 'response',
      idempotencyKey: 'receipt',
      revision: {
        modelVersion: currentFlowModelVersion,
        modules: {},
        document: {
          bindings: {},
          graph: {
            nodes: { reply: { kind: 'webhook-response', name: 'Reply', inputs: {} } },
            edges: [{ source: 'start', target: 'reply' }],
          },
        },
      },
    })
    if (accepted.kind !== 'accepted') throw new Error('Expected accepted Run')
    const runId = accepted.runId
    store.runs.claim()
    store.runs.start(runId, { kind: 'run.started', payload: { flowId: 'main', scopeId: 'root' } })
    database.connection.prepare('UPDATE runs SET event_count = 1000 WHERE run_id = ?').run(runId)
    const event = { kind: 'node.completed' as const, payload: { nodeId: 'reply', executionId: 'first', scopeId: 'root', flowId: 'main' }, value: {}, response }
    expect(store.runs.append(runId, event)).toBe(true)
    expect(store.runs.append(runId, { ...event, response: { ...response, body: 'later' } })).toBe(false)
    database.connection.prepare('DELETE FROM events WHERE run_id = ?').run(runId)
    database.connection.prepare("UPDATE runs SET status = 'failed' WHERE run_id = ?").run(runId)
    database.close()
    database = Database.open(file)
    store = new Store(database, runEnvironment(isolatedVmEngineDigest))
    expect(store.runViews.webhookResponse(runId, 'reply')).toEqual(response)
    expect(store.runViews.webhookResponse(runId, 'other')).toBeUndefined()
    await expect(
      waitForWebhookRun(
        () => store.runViews.run(runId),
        () => vi.fn(),
        1000,
        new AbortController().signal,
        () => store.runViews.webhookResponse(runId, 'reply'),
      ),
    ).resolves.toEqual({ kind: 'responded', response })
    const flowId = store.runViews.controlRun(runId)!.flowId
    expect(store.runs.deleteByFlow(flowId, 100)).toBe(1)
    expect(store.runViews.webhookResponse(runId, 'reply')).toBeUndefined()
  } finally {
    database.close()
    await closeService(service)
    await rm(directory, { recursive: true, force: true })
  }
})

it('observes early completion across subscription races and cleans up without waiting for a terminal Run', async () => {
  const unsubscribe = vi.fn()
  await expect(
    waitForWebhookRun(
      () => ({ runId: 'run', status: 'running', eventsTruncated: true }),
      (changed) => {
        changed()
        return unsubscribe
      },
      1000,
      new AbortController().signal,
      () => response,
    ),
  ).resolves.toEqual({ kind: 'responded', response })
  expect(unsubscribe).toHaveBeenCalledOnce()
  await expect(
    waitForWebhookRun(
      () => ({ runId: 'run', status: 'completed', eventsTruncated: false }),
      () => vi.fn(),
      1000,
      new AbortController().signal,
      () => undefined,
    ),
  ).resolves.toEqual({ kind: 'unavailable' })
})
