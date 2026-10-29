import type { JsonValue } from '@oomol-lab/open-flow/flow-change'

import { ControlClient } from '@oomol-lab/open-flow/control-api'
import { canonicalJsonBytes, decodeRevision, digestBytes, encodeRevision, upgradeWorkflowInterfaceDocument } from '@oomol-lab/open-flow/flow-encoding'
import { flowClosure, prepareFlow } from '@oomol-lab/open-flow/flow-semantics'
import { currentEngineContract } from '@oomol-lab/open-flow/runtime-contract'
import { runFlow } from '@oomol-lab/open-flow/scheduler'
import * as Effect from 'effect/Effect'
import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { expect, it, onTestFinished, vi } from 'vitest'
import { runEnvironment } from '../node/application/run-environment.ts'
import { isolatedVmEngineDigest } from '../node/runtime/isolated-vm.ts'
import { Database } from '../node/storage/database.ts'
import { RevisionStore } from '../node/storage/revision-store.ts'
import { Store } from '../node/storage/store.ts'
import { createServerApp } from '../node/transport/http.ts'
import { closeService, openService, startService } from './serviceFixture.ts'

const number = { handle: 'answer', jsonSchema: { type: 'number' }, nullable: false }
const engine = currentEngineContract
const encoder = new TextEncoder()
function serialized(value: JsonValue) {
  const content = new TextDecoder().decode(canonicalJsonBytes(value))
  return { content, digest: `sha256:${createHash('sha256').update(content).digest('hex')}` }
}
function legacyDocument() {
  return {
    bindings: {},
    inputDefs: [number],
    outputDefs: [number],
    outputMappings: { answer: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'start', output: 'answer' }] } },
    graph: {
      nodes: { start: { kind: 'start', name: 'Start' }, outputs: { kind: 'outputs', name: 'Outputs' } },
      edges: [{ source: 'start', target: 'outputs' }],
    },
  }
}
async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), 'interface-migration-'))
  onTestFinished(() => rm(directory, { recursive: true, force: true }))
  const file = path.join(directory, 'flow.sqlite')
  const database = Database.open(file)
  const store = new Store(database, runEnvironment(isolatedVmEngineDigest), Date.now)
  function seed(id: string, document: JsonValue = legacyDocument(), modelVersion = 8) {
    const source = { kind: 'open-flow-flow-revision', version: 1, modelVersion, document, modules: {} }
    const body = serialized(source)
    store.flows.createFlow({
      actorId: 'operator',
      flowId: id,
      revisionId: id,
      name: id,
      createdAt: Date.now(),
      idempotencyKey: id,
      requestDigest: id,
      modelVersion,
      ...body,
    })
    return {
      interface: { inputs: null, outputs: null },
      flowId: id,
      revisionId: id,
      revisionDigest: body.digest,
      content: body.content,
      closureDigest: 'legacy-closure',
      engineContract: engine,
      expectedLivePublicationId: null,
      crons: [],
      polls: [],
      integrations: [],
      webhooks: [],
      variableNames: [],
      publishedAt: Date.now(),
      idempotencyKey: `publish-${id}`,
      requestDigest: `request-${id}`,
      metadata: { operation: 'publish' as const, actorId: 'operator', modelVersion },
    }
  }
  function closeLegacy() {
    database.connection.exec(
      "UPDATE publish_operations SET input_json = json_remove(input_json, '$.interface'); ALTER TABLE publications DROP COLUMN interface_json; ALTER TABLE runs DROP COLUMN initiator_actor_id; ALTER TABLE runs DROP COLUMN initiator_channel; DROP INDEX wait_auto_continue_due; ALTER TABLE wait_receipts DROP COLUMN auto_continue_at; ALTER TABLE wait_receipts DROP COLUMN resolution_source; DROP TABLE webhook_responses; DROP TABLE event_source_apps; DROP TABLE source_event_versions; DROP TABLE event_source_namespace; ALTER TABLE event_sources DROP COLUMN connector_json; ALTER TABLE event_sources DROP COLUMN pending_json; PRAGMA user_version = 48;",
    )
    database.close()
  }
  return { file, database, store, seed, closeLegacy }
}

it('upgrades full and delta Revisions, preserves identities and Live history, and executes the migrated interface', async () => {
  const { file, database, store, seed, closeLegacy } = await fixture()
  const input = seed('published')
  const first = store.publications.publish(input)
  if (first.kind != 'published') throw new Error('Fixture publication failed')
  const changed = JSON.parse(input.content)
  changed.document.graph.nodes.start.description = 'x'.repeat(2000)
  const base = serialized(changed)
  store.flows.commitRevision({
    actorId: 'operator',
    flowId: input.flowId,
    revisionId: 'base',
    expectedRevisionId: input.revisionId,
    changeId: 'base',
    requestDigest: 'base',
    createdAt: Date.now(),
    modelVersion: 8,
    ...base,
  })
  changed.document.graph.nodes.outputs.name = 'Updated outputs'
  const draft = serialized(changed)
  store.flows.commitRevision({
    actorId: 'operator',
    flowId: input.flowId,
    revisionId: 'draft',
    expectedRevisionId: 'base',
    changeId: 'draft',
    requestDigest: 'draft',
    createdAt: Date.now(),
    modelVersion: 8,
    ...draft,
  })
  expect(database.connection.prepare("SELECT 1 FROM revision_deltas WHERE revision_id = 'draft'").get()).toBeDefined()
  const second = store.publications.publish({
    ...input,
    revisionId: 'draft',
    revisionDigest: draft.digest,
    content: draft.content,
    expectedLivePublicationId: first.publicationId,
    idempotencyKey: 'second',
    requestDigest: 'second',
  })
  if (second.kind != 'published') throw new Error('Fixture publication failed')
  closeLegacy()

  const upgraded = Database.open(file)
  const upgradedStore = new Store(upgraded, runEnvironment(isolatedVmEngineDigest))
  for (const id of ['published', 'base', 'draft']) {
    const row = new RevisionStore(upgraded.connection).read(id)!
    const content = decodeRevision(encoder.encode(row.content))
    expect(content.document).not.toHaveProperty('inputDefs')
    expect(content.document.graph.nodes).toMatchObject({
      start: { inputDefs: [number] },
      outputs: { outputDefs: [number], outputMappings: legacyDocument().outputMappings },
    })
    expect(await digestBytes(encoder.encode(row.content))).toBe(row.digest)
    expect(encodeRevision(content)).toEqual(encoder.encode(row.content))
    expect(upgraded.connection.prepare('SELECT digest FROM flow_revisions WHERE revision_id = ?').get(id)).toEqual({ digest: row.digest })
  }
  const live = upgradedStore.publications.live('published')!
  expect(live.publication).toMatchObject({ publicationId: second.publicationId, revisionId: 'draft' })
  expect(live.publication.closureDigest).toBe(
    (await flowClosure(decodeRevision(encoder.encode(new RevisionStore(upgraded.connection).read('draft')!.content)))).digest,
  )
  expect(upgradedStore.publications.interfaceForRevision('published', 'published')).toEqual({ inputs: [number], outputs: [number] })
  expect(upgraded.connection.prepare("SELECT [notnull], dflt_value FROM pragma_table_info('publications') WHERE name = 'interface_json'").get()).toEqual({
    notnull: 1,
    dflt_value: null,
  })
  expect(upgraded.connection.prepare("SELECT name FROM sqlite_schema WHERE type = 'index' AND name = 'publications_revision'").get()).toBeDefined()
  expect(upgraded.connection.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' })
  upgraded.close()

  const service = await openService(file)
  await startService(service)
  const app = createServerApp(service, { resolveControlActor: () => 'operator' })
  const api = new ControlClient(async (route, init) => app.request(route, init))
  expect(service.control.flows.getWorkflowContract('operator', 'published')).toMatchObject({ inputs: [number], outputs: [number] })
  const run = await api.createLiveRun(second.publicationId, { trigger: { nodeId: 'start', outputs: { answer: 42 } }, idempotencyKey: 'after-migration' })
  await expect.poll(() => service.control.runs.getRun('operator', run.runId).status).toBe('completed')
  expect(service.run(run.runId)?.result).toMatchObject({ outputs: { answer: 42 } })
  const rollback = await service.control.publications.rollbackFlow('operator', 'published', first.publicationId, second.publicationId, 'rollback')
  expect(service.control.flows.getWorkflowContract('operator', 'published')).toMatchObject({
    revisionId: 'published',
    publicationId: rollback.publication.publicationId,
  })
  await closeService(service)
  const reopened = Database.open(file)
  expect(reopened.connection.prepare('PRAGMA user_version').get()).toEqual({ user_version: 55 })
  reopened.close()
})

it('backfills null versus empty interfaces and resumes pending publication with its fixed Revision', async () => {
  const { file, database, store, seed, closeLegacy } = await fixture()
  const absent = seed('absent', { bindings: {}, graph: { nodes: {}, edges: [] } })
  expect(store.publications.publish(absent).kind).toBe('published')
  const empty = seed('empty', { bindings: {}, graph: { nodes: { start: { kind: 'start', name: 'Start', parameters: [] } }, edges: [] } })
  expect(store.publications.publish(empty).kind).toBe('published')
  const pending = seed('pending')
  const accepted = store.publications.acceptPublishOperation(pending)
  if (accepted.kind != 'accepted') throw new Error('Fixture pending publication failed')
  database.connection.prepare('INSERT INTO run_checkpoints VALUES (?, ?, ?, ?, ?)').run('historical', '{"preserved":true}', 'checkpoint-digest', 18, 100)
  closeLegacy()
  const upgraded = Database.open(file)
  const after = new Store(upgraded, runEnvironment(isolatedVmEngineDigest), Date.now)
  expect(after.publications.interfaceForRevision('absent', 'absent')).toEqual({ inputs: null, outputs: null })
  expect(after.publications.interfaceForRevision('empty', 'empty')).toEqual({ inputs: [], outputs: null })
  const work = after.publications.nextPublishOperation(Date.now())
  if (work?.kind != 'ready') throw new Error('Pending publication did not recover')
  const input = JSON.parse(work.input)
  expect(input).toMatchObject({ interface: { inputs: [number], outputs: [number] }, revisionId: 'pending' })
  expect(input.content).toBe(new RevisionStore(upgraded.connection).read('pending')!.content)
  expect(after.publications.publish({ ...input, operationId: work.operationId }).kind).toBe('published')
  expect(after.publications.publishOperation('pending', accepted.operation.operationId)?.status).toBe('succeeded')
  expect(upgraded.connection.prepare('SELECT checkpoint_json, checkpoint_digest FROM run_checkpoints').get()).toEqual({
    checkpoint_json: '{"preserved":true}',
    checkpoint_digest: 'checkpoint-digest',
  })
  upgraded.close()
})

it.each([false, true])('snapshots historical Task revisions without rewriting them (Start present: %s)', async (hasStart) => {
  const { file, database, store, seed, closeLegacy } = await fixture()
  const historical = seed(
    'historical',
    {
      tasks: { shared: { name: 'Historical task' } },
      bindings: {},
      graph: {
        nodes: {
          task: { kind: 'task', name: 'Task', taskId: 'shared' },
          ...(hasStart ? { start: { kind: 'start', name: 'Start', inputDefs: [number] } } : {}),
        },
        edges: [],
      },
    },
    hasStart ? 7 : 5,
  )
  expect(store.publications.publish(historical).kind).toBe('published')
  const before = database.connection.prepare('SELECT * FROM publications').get()
  closeLegacy()
  const upgraded = Database.open(file)
  try {
    const snapshot = { inputs: hasStart ? [number] : null, outputs: null }
    expect(new Store(upgraded, runEnvironment(isolatedVmEngineDigest), Date.now).publications.interfaceForRevision('historical', 'historical')).toEqual(
      snapshot,
    )
    const stored = new RevisionStore(upgraded.connection).read('historical')!
    expect(stored).toMatchObject({ content: historical.content, digest: historical.revisionDigest })
    expect(upgraded.connection.prepare('SELECT * FROM publications').get()).toEqual({ ...before, interface_json: JSON.stringify(snapshot) })
    expect(() => decodeRevision(encoder.encode(stored.content))).toThrow('Independent Task definitions are no longer supported.')
  } finally {
    upgraded.close()
  }
})

it.each(['pending', 'failed'] as const)('preserves historical Task revisions with %s publication operations', async (status) => {
  const { file, database, store, seed, closeLegacy } = await fixture()
  const historical = seed(
    'historical',
    {
      tasks: { shared: { name: 'Historical task' } },
      bindings: {},
      graph: { nodes: { task: { kind: 'task', name: 'Task', taskId: 'shared' } }, edges: [] },
    },
    5,
  )
  const accepted = store.publications.acceptPublishOperation({
    ...historical,
    integrations: [
      {
        connectionId: 'connection',
        reconcileAt: Date.now(),
        triggerNodeId: 'integration',
        triggerJson: JSON.stringify({ kind: 'integration', definition: { key: 'github.on_repo_event' } }),
      },
    ],
    polls: [{ connectionId: 'connection', nextAt: Date.now(), scheduleJson: '[]', triggerNodeId: 'poll', triggerJson: '{}' }],
  })
  if (accepted.kind !== 'accepted') throw new Error('Expected accepted operation')
  if (status === 'failed') store.publications.failPublishOperation(accepted.operation.operationId, { code: 'flow.invalid', message: 'Historical failure' })
  expect(database.connection.prepare('SELECT COUNT(*) AS count FROM publish_work').get()).toEqual({ count: 2 })
  closeLegacy()
  const upgraded = Database.open(file)
  try {
    const migrated = new Store(upgraded, runEnvironment(isolatedVmEngineDigest), Date.now)
    const operationId = accepted.operation.operationId
    expect(upgraded.connection.prepare('SELECT status FROM publish_operations').get()).toEqual({ status: 'failed' })
    const candidate = migrated.integrations.candidate(operationId, 'integration')!
    expect(candidate.status).toBe('cleanup')
    expect(upgraded.connection.prepare('SELECT COUNT(*) AS count FROM poll_candidates').get()).toEqual({ count: 0 })
    expect(migrated.publications.nextPublishOperation(Date.now())).toBeUndefined()
    expect(migrated.publications.prunePublishOperations(Number.MAX_SAFE_INTEGER, 10)).toBe(0)
    expect(migrated.integrations.deleteCandidate(candidate)).toBe(true)
    expect(migrated.publications.prunePublishOperations(Number.MAX_SAFE_INTEGER, 10)).toBe(1)
    expect(upgraded.connection.prepare('SELECT COUNT(*) AS count FROM publish_work').get()).toEqual({ count: 0 })
    expect(new RevisionStore(upgraded.connection).read('historical')).toMatchObject({ content: historical.content, digest: historical.revisionDigest })
  } finally {
    upgraded.close()
  }
})

it.each(['conflict', 'orphan', 'missing-revision', 'bad-digest', 'bad-delta'])(
  'rolls back the entire upgrade on %s without changing data or schema',
  async (problem) => {
    const { file, database, store, seed, closeLegacy } = await fixture()
    const first = seed('first')
    store.publications.publish(first)
    const invalid = legacyDocument() as Record<string, any>
    if (problem == 'conflict') invalid.graph.nodes.start.parameters = []
    if (problem == 'orphan') delete invalid.graph.nodes.start
    const second = seed('second', invalid)
    store.publications.publish(second)
    if (problem == 'missing-revision') database.connection.prepare("DELETE FROM revisions WHERE revision_id = 'second'").run()
    if (problem == 'bad-digest') database.connection.prepare("UPDATE revisions SET digest = 'incorrect' WHERE revision_id = 'second'").run()
    if (problem == 'bad-delta') {
      database.connection.prepare("DELETE FROM revisions WHERE revision_id = 'second'").run()
      database.connection.prepare("INSERT INTO revision_deltas VALUES ('second', 'first', '[]', 1)").run()
      database.connection.prepare("UPDATE flow_revisions SET digest = 'incorrect' WHERE revision_id = 'second'").run()
    }
    closeLegacy()
    const before = new DatabaseSync(file)
    const snapshot = dump(before)
    before.close()
    expect(() => Database.open(file)).toThrow()
    const after = new DatabaseSync(file)
    expect(dump(after)).toEqual(snapshot)
    after.close()
  },
)

function dump(database: DatabaseSync) {
  const schema = database.prepare('SELECT type, name, sql FROM sqlite_schema ORDER BY name').all()
  return {
    version: database.prepare('PRAGMA user_version').get(),
    schema,
    rows: schema.filter((row) => row.type == 'table').map((row) => database.prepare(`SELECT * FROM "${String(row.name)}"`).all()),
  }
}

it.each(['live', 'draft'] as const)('preserves a waiting %s Run and resumes its existing checkpoint after migration', async (source) => {
  const { file, database, store, seed, closeLegacy } = await fixture()
  const document = legacyDocument()
  const input = seed('waiting', {
    ...document,
    graph: {
      nodes: { ...document.graph.nodes, wait: { kind: 'wait', name: 'Wait', prompt: 'Continue', inputDefinitions: [], inputs: {} } },
      edges: [
        { source: 'start', target: 'wait' },
        { source: 'wait', sourceHandle: 'continue', target: 'outputs' },
      ],
    },
  })
  const publication = store.publications.publish(input)
  if (publication.kind != 'published') throw new Error('Fixture publication failed')
  const admission = {
    initiator: { channel: 'api' as const },
    ...input,
    modelVersion: 8,
    idempotencyKey: 'waiting-run',
    requestDigest: 'waiting-run',
    inputs: {},
    trigger: { nodeId: 'start', outputs: { answer: 17 } },
  }
  const run =
    source == 'live'
      ? store.runs.acceptLiveControlRun({ ...admission, expectedPublicationId: publication.publicationId })
      : store.runs.acceptControlRun(admission)
  if (run.kind != 'accepted') throw new Error('Fixture Run admission failed')
  expect(store.runs.claim()?.runId).toBe(run.runId)
  expect(store.runs.start(run.runId, { kind: 'run.started', payload: { flowId: input.flowId, scopeId: run.runId } })).toBe(true)
  const raw = JSON.parse(input.content)
  const content = decodeRevision(canonicalJsonBytes({ ...raw, document: upgradeWorkflowInterfaceDocument(raw.document) }))
  const prepared = await prepareFlow(content, engine, source == 'draft' ? 'start' : undefined)
  if (prepared.kind != 'prepared') throw new Error('Fixture Flow preparation failed')
  // Generate a real scheduler checkpoint with a controlled clock instead of waiting two minutes.
  vi.useFakeTimers()
  try {
    const pending = Effect.runPromise(
      runFlow(prepared.flow, {
        createId: () => crypto.randomUUID(),
        flowId: input.flowId,
        runId: run.runId,
        trigger: admission.trigger,
        inputs: {},
        bindingValues: {},
        invokeTask: () => Effect.succeed({}),
        waits: {
          create: (wait) => Effect.sync(() => store.runs.createWait(run.runId, wait, undefined)),
          resolutions: (ids, block) => (block ? Effect.never : Effect.sync(() => store.runs.resolutions(run.runId, ids))),
        },
      }),
    )
    let settled = false
    void pending.then(
      () => {
        settled = true
      },
      () => {
        settled = true
      },
    )
    for (let step = 0; step < 100; step++) {
      if (settled) break
      await vi.runOnlyPendingTimersAsync()
    }
    expect(settled).toBe(true)
    const outcome = await pending
    if (outcome.kind != 'waiting') throw new Error('Expected scheduler checkpoint')
    expect(store.runs.wait(run.runId, outcome, 100_000)).toBe(true)
  } finally {
    vi.useRealTimers()
  }
  const checkpoints = database.connection.prepare('SELECT * FROM run_checkpoints ORDER BY run_id').all()
  expect(checkpoints).toHaveLength(1)
  closeLegacy()

  const upgraded = Database.open(file)
  expect(upgraded.connection.prepare('SELECT * FROM run_checkpoints ORDER BY run_id').all()).toEqual(checkpoints)
  const saved = upgraded.connection.prepare('SELECT revision_digest, closure_digest FROM runs WHERE run_id = ?').get(run.runId)!
  expect(saved.revision_digest).toBe(new RevisionStore(upgraded.connection).read(input.revisionId)!.digest)
  expect(saved.closure_digest).toBe(prepared.flow.closureDigest)
  upgraded.close()
  const resumed = await openService(file, { clock: Date.now })
  await startService(resumed)
  const wait = resumed.control.runs.getRun('operator', run.runId).waits[0]!
  resumed.control.runs.resolveRunWait('operator', run.runId, wait.waitId, 'continue')
  await expect.poll(() => resumed.control.runs.getRun('operator', run.runId).status).toBe('completed')
  expect(resumed.run(run.runId)?.result).toMatchObject({ outputs: { answer: 17 } })
  await closeService(resumed)
})
