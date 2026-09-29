import type { RevisionContent } from '@oomol-lab/open-flow/flow-change'
import type { TriggerOccurrenceInput } from '../node/storage/trigger-store.ts'

import { controlErrorCode } from '@oomol-lab/open-flow/control-api'
import { applyFlowChanges, currentFlowModelVersion } from '@oomol-lab/open-flow/flow-change'
import { encodeRevision, digestBytes } from '@oomol-lab/open-flow/flow-encoding'
import { matchesTriggerOutputs } from '@oomol-lab/open-flow/flow-semantics'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { Database } from '../node/storage/database.ts'
import { Store } from '../node/storage/store.ts'
import { closeService, openService } from './serviceFixture.ts'

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

function fixture(capacity = 10) {
  const directory = mkdtempSync(join(tmpdir(), 'error-trigger-'))
  const file = join(directory, 'store.sqlite')
  let database = Database.open(file)
  let now = 1_000
  let store = new Store(database, () => now, 100, capacity)
  cleanups.push(() => {
    database.close()
    rmSync(directory, { recursive: true, force: true })
  })
  return {
    file,
    get database() {
      return database
    },
    get store() {
      return store
    },
    advance() {
      now += 2_000
    },
    reopen() {
      database.close()
      database = Database.open(file)
      store = new Store(database, () => now, 100, capacity)
    },
    maintain() {
      return store.runs.maintain(now, 100, 60_000)
    },
    async flow(id: string, kind: 'error' | 'manual' = 'manual', sourceFlowIds: readonly string[] = []) {
      const revision: RevisionContent = {
        modelVersion: currentFlowModelVersion,
        modules: {},
        document: {
          bindings: {},
          subflows: {},
          tasks: {},
          graph: { nodes: { start: kind == 'error' ? { kind, name: 'Start', sourceFlowIds } : { kind, name: 'Start' } }, edges: [] },
        },
      }
      const content = new TextDecoder().decode(encodeRevision(revision))
      const digest = await digestBytes(encodeRevision(revision))
      const revisionId = `${id}-revision`
      store.flows.createFlow({
        actorId: 'operator',
        flowId: id,
        revisionId,
        content,
        digest,
        modelVersion: currentFlowModelVersion,
        createdAt: now,
        name: id,
        idempotencyKey: id,
        requestDigest: id,
      })
      const input = {
        errorTriggers: kind == 'error' ? [{ nodeId: 'start', sourceFlowIds }] : [],
        closureDigest: digest,
        content,
        crons: [],
        expectedLivePublicationId: null,
        engineContract: 'open-flow-engine/v5',
        flowId: id,
        idempotencyKey: `publish-${id}`,
        integrations: [],
        polls: [],
        publishedAt: now,
        requestDigest: digest,
        revisionDigest: digest,
        revisionId,
        variableNames: [],
        webhooks: [],
      }
      const published = store.publications.publish(input)
      if (published.kind != 'published') throw new Error(published.kind)
      return { ...input, publicationId: published.publicationId, modelVersion: currentFlowModelVersion, triggerNodeId: 'start' }
    },
    automatic(input: Omit<TriggerOccurrenceInput, 'occurrenceId' | 'outputs'>, occurrenceId: string) {
      const accepted = database.transaction(() => store.runs.acceptTriggerOccurrence({ ...input, occurrenceId, outputs: {} }))
      if (accepted.kind != 'accepted') throw new Error(accepted.kind)
      return accepted.runId
    },
    fail(runId: string) {
      return store.runs.commit(runId, 'failed', { error: { code: 'run.failed', message: 'Failure' } })
    },
  }
}

it('commits one dispatch with terminal state, recovers it after restart, and never recurses', async () => {
  const f = fixture()
  const source = await f.flow('source')
  await f.flow('handler', 'error', ['source'])
  await f.flow('nested-handler', 'error', ['handler'])
  const runId = f.automatic(source, 'source-event')
  expect(f.fail(runId)).toBe(true)
  expect(f.fail(runId)).toBe(false)
  expect(f.store.runViews.errorHandling(runId).errorDispatches?.[0]?.status).toBe('pending')
  f.reopen()
  const changes = f.maintain().errorDispatches
  expect(changes).toHaveLength(1)
  const handlerId = changes[0]!.created!.runId
  expect(f.store.runViews.errorHandling(handlerId).errorSource).toEqual({ flowId: 'source', runId })
  const accepted = f.store.runs.claim()!
  expect(accepted.runId).toBe(handlerId)
  expect(matchesTriggerOutputs({ kind: 'error', name: 'Error' }, accepted.trigger!.outputs)).toBe(true)
  expect(accepted.trigger!.outputs.workflow).toMatchObject({ flowId: 'source' })
  f.fail(handlerId)
  f.reopen()
  expect(f.maintain().errorDispatches).toEqual([])
  expect(f.store.runViews.errorHandling(handlerId).errorDispatches).toBeUndefined()
  expect(f.store.runViews.errorHandling(runId).errorDispatches?.[0]).toEqual({ flowId: 'handler', status: 'dispatched', runId: handlerId })
})

it('waits for queue capacity without losing or duplicating the occurrence', async () => {
  const f = fixture(1)
  const source = await f.flow('source')
  await f.flow('handler', 'error', ['source'])
  const failed = f.automatic(source, 'failure')
  f.fail(failed)
  const busy = f.automatic(source, 'busy')
  expect(f.maintain().errorDispatches).toEqual([])
  expect(f.store.runViews.errorHandling(failed).errorDispatches?.[0]?.status).toBe('pending')
  f.store.runs.commit(busy, 'canceled', {})
  f.advance()
  expect(f.maintain().errorDispatches).toHaveLength(1)
  expect(f.maintain().errorDispatches).toEqual([])
})

it.each(['draft', 'live'] as const)('does not dispatch manually admitted %s failures', async (sourceKind) => {
  const f = fixture()
  const source = await f.flow('source')
  await f.flow('handler', 'error', ['source'])
  const input = {
    ...source,
    expectedPublicationId: source.publicationId,
    idempotencyKey: 'manual',
    inputs: {},
    trigger: { nodeId: 'start', outputs: {} },
    variableNames: [],
  }
  const run = sourceKind == 'draft' ? f.store.runs.acceptControlRun(input) : f.store.runs.acceptLiveControlRun(input)
  if (run.kind != 'accepted') throw new Error(run.kind)
  f.fail(run.runId)
  expect(f.store.runViews.errorHandling(run.runId).errorDispatches).toBeUndefined()
})

it.each(['paused', 'disabled', 'deleted'] as const)('reports a target becoming %s before dispatch', async (state) => {
  const f = fixture()
  const source = await f.flow('source')
  await f.flow('handler', 'error', ['source'])
  const runId = f.automatic(source, 'failure')
  f.fail(runId)
  if (state == 'paused') f.store.triggers.setTriggerOperatorState('handler', 'start', 'paused', 1_001)
  if (state == 'disabled') f.database.connection.prepare('UPDATE flow_live SET enabled = 0 WHERE flow_id = ?').run('handler')
  if (state == 'deleted') f.database.connection.prepare("UPDATE flows SET status = 'retiring' WHERE flow_id = ?").run('handler')
  const changed = f.maintain().errorDispatches
  expect(changed).toEqual([{ flowId: 'source', runId }])
  expect(f.store.runViews.errorHandling(runId).errorDispatches?.[0]).toMatchObject({ status: 'failed', flowId: 'handler' })
  expect(f.store.runViews.run(runId)?.status).toBe('failed')
})

it('persists node failure context before event truncation and after event expiry', async () => {
  const f = fixture()
  const source = await f.flow('source')
  await f.flow('handler', 'error', ['source'])
  const runId = f.automatic(source, 'failure')
  f.store.runs.claim()
  f.store.runs.start(runId, { kind: 'run.started', payload: { flowId: 'source', scopeId: 'scope' } })
  f.database.connection.prepare('UPDATE runs SET event_count = 1000 WHERE run_id = ?').run(runId)
  f.store.runs.append(runId, {
    kind: 'node.failed',
    payload: { terminal: true, nodeId: 'nested', executionId: 'job', path: ['subflow-call'], error: { code: 'node.failed', message: 'Detailed error' } },
  })
  f.fail(runId)
  f.advance()
  const handlerId = f.maintain().errorDispatches[0]!.created!.runId
  expect(f.store.runViews.run(runId)?.result).toEqual({
    error: { code: 'node.failed', message: 'Detailed error', nodeId: 'nested', jobId: 'job', path: ['subflow-call'] },
  })
  expect(f.store.runs.claim()?.trigger?.outputs.error).toEqual((f.store.runViews.run(runId)!.result as { error: unknown }).error)
  f.fail(handlerId)
})

it('rejects self and offline references in authoritative draft commits', async () => {
  const f = fixture()
  const source = await f.flow('source', 'error')
  for (const target of ['source', 'missing']) {
    const revision = JSON.parse(source.content)
    revision.document.graph.nodes.start.sourceFlowIds = [target]
    expect(() =>
      f.store.flows.commitRevision({
        actorId: 'operator',
        flowId: 'source',
        expectedRevisionId: source.revisionId,
        changeId: target,
        requestDigest: target,
        digest: target,
        revisionId: target,
        content: JSON.stringify(revision),
        modelVersion: currentFlowModelVersion,
        createdAt: 1_001,
      }),
    ).toThrow('Select published upstream')
  }
})

it('dispatches indeterminate automatic Runs recovered after a process restart', async () => {
  const f = fixture()
  const source = await f.flow('source')
  await f.flow('handler', 'error', ['source'])
  const runId = f.automatic(source, 'interrupted')
  f.store.runs.claim()
  f.store.runs.start(runId, { kind: 'run.started', payload: { flowId: 'source', scopeId: 'scope' } })
  f.reopen()
  expect(f.store.runViews.run(runId)?.status).toBe('indeterminate')
  expect(f.maintain().errorDispatches).toHaveLength(1)
  const handler = f.store.runs.claim()!
  expect(handler.trigger?.outputs.execution).toMatchObject({ runId, status: 'indeterminate' })
  expect(handler.trigger?.outputs.error).toMatchObject({ code: 'execution.terminal-unknown' })
})

it.each(['completed', 'canceled'] as const)('does not dispatch automatic %s Runs', async (status) => {
  const f = fixture()
  const source = await f.flow('source')
  await f.flow('handler', 'error', ['source'])
  const runId = f.automatic(source, status)
  f.store.runs.commit(runId, status, {})
  expect(f.maintain().errorDispatches).toEqual([])
})

async function configureSources(
  f: ReturnType<typeof fixture>,
  handler: Awaited<ReturnType<ReturnType<typeof fixture>['flow']>>,
  sourceFlowIds: string[],
  publish = true,
) {
  const revision = JSON.parse(handler.content) as RevisionContent
  const node = revision.document.graph.nodes.start
  if (node?.kind != 'error') throw new Error('Expected Flow Error')
  const updated = applyFlowChanges(revision, [{ kind: 'graph.trigger.sources.set', nodeId: 'start', before: node.sourceFlowIds, value: sourceFlowIds }])
  const bytes = encodeRevision(updated)
  const digest = await digestBytes(bytes)
  const content = new TextDecoder().decode(bytes)
  const revisionId = `revision-${digest}`
  expect(
    f.store.flows.commitRevision({
      actorId: 'operator',
      flowId: handler.flowId,
      expectedRevisionId: f.store.flows.get(handler.flowId)!.draftRevisionId,
      changeId: revisionId,
      requestDigest: digest,
      digest,
      revisionId,
      content,
      modelVersion: currentFlowModelVersion,
      createdAt: 1_001,
    }).kind,
  ).toBe('committed')
  if (!publish) return
  return f.store.publications.publish({
    ...handler,
    content,
    revisionId,
    revisionDigest: digest,
    closureDigest: digest,
    requestDigest: digest,
    idempotencyKey: `publish-${digest}`,
    expectedLivePublicationId: f.store.flows.get(handler.flowId)!.publicationId,
    errorTriggers: [{ nodeId: 'start', sourceFlowIds }],
  })
}

it('fans out once per handler, while each handler can listen to several upstream Flows', async () => {
  const f = fixture()
  const source = await f.flow('source')
  const other = await f.flow('other')
  const unrelated = await f.flow('unrelated')
  await f.flow('first', 'error', ['source', 'other'])
  await f.flow('second', 'error', ['source'])
  const firstRun = f.automatic(source, 'failure')
  const otherRun = f.automatic(other, 'other-failure')
  const unrelatedRun = f.automatic(unrelated, 'unrelated-failure')
  f.fail(firstRun)
  f.fail(otherRun)
  f.fail(unrelatedRun)
  const dispatched = f.maintain().errorDispatches
  expect(dispatched).toHaveLength(3)
  expect(f.store.runViews.errorHandling(firstRun).errorDispatches?.map((item) => item.flowId)).toEqual(['first', 'second'])
  expect(f.store.runViews.errorHandling(otherRun).errorDispatches?.map((item) => item.flowId)).toEqual(['first'])
  expect(f.store.runViews.errorHandling(unrelatedRun).errorDispatches).toBeUndefined()
  expect(new Set(dispatched.map((item) => item.created?.runId)).size).toBe(3)
  f.reopen()
  expect(f.maintain().errorDispatches).toEqual([])
})

it('keeps draft subscriptions inactive until handler publication, without republishing upstream Flows', async () => {
  const f = fixture()
  const first = await f.flow('first')
  const second = await f.flow('second')
  const handler = await f.flow('handler', 'error', ['first'])
  await configureSources(f, handler, ['second'], false)
  const before = f.automatic(first, 'before-publication')
  const notYet = f.automatic(second, 'second-before-publication')
  f.fail(before)
  f.fail(notYet)
  expect(f.maintain().errorDispatches).toHaveLength(1)
  expect(f.store.runViews.errorHandling(notYet).errorDispatches).toBeUndefined()
  expect((await configureSources(f, handler, ['second']))?.kind).toBe('published')
  const removed = f.automatic(first, 'after-publication')
  const added = f.automatic(second, 'second-after-publication')
  f.fail(removed)
  f.fail(added)
  expect(f.maintain().errorDispatches).toHaveLength(1)
  expect(f.store.runViews.errorHandling(removed).errorDispatches).toBeUndefined()
  expect(f.store.runViews.errorHandling(added).errorDispatches?.[0]?.status).toBe('dispatched')
})

it('cancels pending admission when a published handler removes the subscription', async () => {
  const f = fixture()
  const source = await f.flow('source')
  const handler = await f.flow('handler', 'error', ['source'])
  const runId = f.automatic(source, 'failure')
  f.fail(runId)
  expect((await configureSources(f, handler, []))?.kind).toBe('published')
  expect(f.maintain().errorDispatches).toEqual([{ flowId: 'source', runId }])
  expect(f.store.runViews.errorHandling(runId).errorDispatches?.[0]).toMatchObject({
    status: 'failed',
    message: 'The Flow Error node no longer listens to this upstream Flow.',
  })
})

it('validates upstream availability again at publication', async () => {
  const f = fixture()
  await f.flow('source')
  const handler = await f.flow('handler', 'error')
  await configureSources(f, handler, ['source'], false)
  f.database.connection.prepare("UPDATE flows SET status = 'retiring' WHERE flow_id = 'source'").run()
  expect((await configureSources(f, handler, ['source']))?.kind).toBe('error-sources-unavailable')
})

it.each(['paused', 'disabled'] as const)('does not subscribe while the handler is %s', async (state) => {
  const f = fixture()
  const source = await f.flow('source')
  await f.flow('handler', 'error', ['source'])
  if (state == 'paused') f.store.triggers.setTriggerOperatorState('handler', 'start', 'paused', 1_001)
  else f.database.connection.prepare("UPDATE flow_live SET enabled = 0 WHERE flow_id = 'handler'").run()
  const runId = f.automatic(source, 'failure')
  f.fail(runId)
  expect(f.store.runViews.errorHandling(runId).errorDispatches).toBeUndefined()
})

it('retries only the pending handler when fan-out exceeds queue capacity', async () => {
  const f = fixture(1)
  const source = await f.flow('source')
  await f.flow('first', 'error', ['source'])
  await f.flow('second', 'error', ['source'])
  const sourceRun = f.automatic(source, 'failure')
  f.fail(sourceRun)
  const initial = f.maintain().errorDispatches
  expect(initial).toHaveLength(1)
  expect(f.store.runViews.errorHandling(sourceRun).errorDispatches?.map((item) => item.status)).toEqual(['dispatched', 'pending'])
  f.fail(initial[0]!.created!.runId)
  f.advance()
  expect(f.maintain().errorDispatches).toHaveLength(1)
  expect(f.store.runViews.errorHandling(sourceRun).errorDispatches?.map((item) => item.status)).toEqual(['dispatched', 'dispatched'])
  expect(f.maintain().errorDispatches).toEqual([])
})

it('lists published error listeners with their names and disabled state for deletion warnings', async () => {
  const f = fixture()
  await f.flow('source')
  await f.flow('other')
  await f.flow('active', 'error', ['source'])
  const disabled = await f.flow('disabled', 'error', ['source'])
  await f.flow('paused', 'error', ['source'])
  await f.flow('retiring', 'error', ['source'])
  await f.flow('unrelated', 'error', ['other'])
  f.store.flows.rename('active', 'Alerts', 2_000)
  f.store.flows.setEnabled('disabled', disabled.publicationId, false)
  f.database.connection.prepare("UPDATE error_bindings SET operator_state = 'paused' WHERE flow_id = 'paused'").run()
  f.store.flows.retire('retiring', 2_000)
  expect(f.store.triggers.errorListeners('source')).toEqual([
    { flowId: 'active', flowName: 'Alerts', nodeId: 'start', nodeName: 'Start', enabled: true },
    { flowId: 'disabled', flowName: 'disabled', nodeId: 'start', nodeName: 'Start', enabled: false },
    { flowId: 'paused', flowName: 'paused', nodeId: 'start', nodeName: 'Start', enabled: false },
  ])
  expect(f.store.triggers.errorListeners('active')).toEqual([])
})

it.each(['unpublished', 'retired'] as const)('repairs a draft while retaining an %s upstream without allowing publication', async (state) => {
  const f = fixture()
  await f.flow('source')
  const handler = await f.flow('handler', 'error', ['source'])
  const original = f.store.flows.revision('handler', handler.revisionId)
  if (state == 'unpublished') f.database.connection.prepare("DELETE FROM flow_live WHERE flow_id = 'source'").run()
  else f.store.flows.retire('source', 2_000)
  const service = await openService(f.file)
  try {
    const repaired = await service.control.repairDraft('operator', 'handler', handler.revisionId, 'repair')
    expect(repaired.revision.parentRevisionId).toBe(handler.revisionId)
    expect(service.control.getDraft('handler')).toMatchObject({
      revisionId: repaired.revision.revisionId,
      content: { document: { graph: { nodes: { start: { kind: 'error', sourceFlowIds: ['source'] } } } } },
    })
    expect(f.database.connection.prepare('SELECT content FROM revisions WHERE revision_id = ?').get(repaired.revision.revisionId)).toBeDefined()
    expect(f.store.flows.revision('handler', handler.revisionId)).toEqual(original)
    await expect(service.control.repairDraft('operator', 'handler', handler.revisionId, 'repair')).resolves.toEqual(repaired)
    await expect(
      service.control.publishFlow('operator', 'handler', repaired.revision.revisionId, handler.engineContract, handler.publicationId, 'publish-repaired'),
    ).rejects.toMatchObject({ code: controlErrorCode.flowInvalid })
  } finally {
    await closeService(service)
  }
})
