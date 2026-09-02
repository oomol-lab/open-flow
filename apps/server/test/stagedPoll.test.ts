import type { TriggerNode } from '@oomol-lab/open-flow/flow-change'
import type { PollDefinition } from '@oomol-lab/open-flow/poll-trigger'

import { PermanentPollError, TransientPollError } from '@oomol-lab/open-flow/poll-trigger'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, expect, it } from 'vitest'
import { ServerService } from '../node/service.ts'
import { createConnectorHost } from './connectorHost.ts'
import { closeService, openService } from './serviceFixture.ts'

const directories: string[] = []
const services = new Set<ServerService>()
const snapshot = {
  configSchema: {
    additionalProperties: false,
    properties: { source: { type: 'string' } },
    required: ['source'],
    type: 'object',
  },
  definitionVersion: 1,
  description: 'Poll staging test definition.',
  displayName: 'Poll staging test',
  key: 'test.staged_poll',
  name: 'staged_poll',
  payloadSchema: {
    additionalProperties: false,
    properties: { events: { items: { type: 'object' }, type: 'array' } },
    required: ['events'],
    type: 'object',
  },
  provider: 'test',
  type: 'poll',
} as const
const connector = createConnectorHost({
  listConnections: async () => [
    {
      connectionId: 'connection-main',
      displayName: 'Main',
      isDefault: true,
      serviceId: 'test',
      status: 'active',
    },
  ],
})

afterEach(async () => {
  await Promise.allSettled([...services].map(closeService))
  services.clear()
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })))
})

async function databaseFile(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'open-flow-staged-poll-'))
  directories.push(directory)
  return path.join(directory, 'open-flow.sqlite')
}

function pollNode(source: string): Extract<TriggerNode, { readonly kind: 'poll' }> {
  return {
    bindingId: 'poll-connection',
    config: { source },
    definition: snapshot,
    kind: 'poll',
    name: 'Poll events',
    pollTimes: [{ type: 'every', unit: 'minute', value: 1 }],
  }
}

async function addPoll(service: ServerService, flowId: string, revisionId: string, source: string): Promise<string> {
  const changed = await service.control.changeDraft('operator', flowId, revisionId, [
    { binding: { kind: 'connection', target: 'connection-main' }, bindingId: 'poll-connection', kind: 'binding.create' },
    { kind: 'graph.node.create', node: pollNode(source), nodeId: 'poll', target: { kind: 'flow' } },
  ])
  return changed.revision.revisionId
}

async function replacePoll(service: ServerService, flowId: string, revisionId: string, source: string): Promise<string> {
  const changed = await service.control.changeDraft('operator', flowId, revisionId, [
    { before: 'initial', kind: 'graph.trigger.config.set', name: 'source', nodeId: 'poll', value: source },
  ])
  return changed.revision.revisionId
}

async function addMarker(service: ServerService, flowId: string, revisionId: string): Promise<string> {
  const changed = await service.control.changeDraft('operator', flowId, revisionId, [
    {
      kind: 'graph.node.create',
      node: {
        concurrency: 1,
        inputs: {},
        kind: 'value',
        values: [{ handle: 'ready', jsonSchema: { type: 'boolean' }, nullable: false, value: true }],
      },
      nodeId: 'marker',
      target: { kind: 'flow' },
    },
  ])
  return changed.revision.revisionId
}

it('resumes a paged Poll baseline after restart, discards its events, reuses unchanged state, and baselines changes', async () => {
  const file = await databaseFile()
  const checkpoints: unknown[] = []
  const sources: unknown[] = []
  let call = 0
  let failOnce = true
  const definition: PollDefinition = {
    snapshot,
    async poll(context) {
      call += 1
      checkpoints.push(context.checkpoint)
      sources.push(context.config.source)
      if (context.config.source == 'changed') {
        return {
          checkpoint: { cursor: 'changed-baseline' },
          events: [{ dedupeKey: 'old-changed', payload: { value: 'old-changed' } }],
        }
      }
      if (context.checkpoint == null) {
        return {
          checkpoint: { cursor: 'page-1' },
          events: [{ dedupeKey: 'old-1', payload: { value: 'old-1' } }],
          hasMore: true,
        }
      }
      if (failOnce) {
        failOnce = false
        throw new TransientPollError('Retry the second baseline page.')
      }
      return {
        checkpoint: { cursor: 'page-2' },
        events: [{ dedupeKey: 'old-2', payload: { value: 'old-2' } }],
      }
    },
  }
  let service = await openService(file, connector, () => Date.parse('2026-08-31T10:00:30.000Z'), {}, undefined, undefined, [definition])
  services.add(service)
  const created = await service.control.createFlow('operator', 'Poll staging', 'poll-staging-flow')
  const revisionId = await addPoll(service, created.flow.flowId, created.flow.draftRevisionId, 'initial')
  const operation = await service.control.publishFlow('operator', created.flow.flowId, revisionId, 'open-flow-engine/v1', null, 'poll-staging')

  await service.tickPoll('2026-08-31T10:00:30.000Z')
  expect(service.control.getPublishOperation(created.flow.flowId, operation.operationId).status).toBe('pending')
  let database = new DatabaseSync(file, { readOnly: true })
  expect(database.prepare('SELECT checkpoint_json AS checkpointJson FROM poll_candidates').get()).toEqual({
    checkpointJson: '{"cursor":"page-1"}',
  })
  expect(database.prepare('SELECT COUNT(*) AS count FROM publications').get()).toEqual({ count: 0 })
  expect(database.prepare('SELECT COUNT(*) AS count FROM poll_bindings').get()).toEqual({ count: 0 })
  expect(database.prepare('SELECT COUNT(*) AS count FROM poll_claims').get()).toEqual({ count: 0 })
  expect(database.prepare('SELECT COUNT(*) AS count FROM poll_event_dedupe').get()).toEqual({ count: 0 })
  expect(database.prepare('SELECT COUNT(*) AS count FROM runs').get()).toEqual({ count: 0 })
  database.close()

  await closeService(service)
  services.delete(service)
  service = await openService(file, connector, () => Date.parse('2026-08-31T10:00:31.000Z'), {}, undefined, undefined, [definition])
  services.add(service)
  await service.tickPoll('2026-08-31T10:00:31.000Z')
  expect(checkpoints).toEqual([null, { cursor: 'page-1' }, { cursor: 'page-1' }])
  expect(sources).toEqual(['initial', 'initial', 'initial'])
  expect(service.control.getPublishOperation(created.flow.flowId, operation.operationId).status).toBe('pending')
  await service.tickMaintenance('2026-08-31T10:00:31.000Z')
  const completed = service.control.getPublishOperation(created.flow.flowId, operation.operationId)
  if (completed.status != 'succeeded') throw new Error('Poll Publish operation did not succeed.')
  expect(service.pollState(created.flow.flowId, 'poll')).toMatchObject({ checkpoint: { cursor: 'page-2' }, health: 'healthy', runtimeVersion: 1 })

  const unchangedRevisionId = await addMarker(service, created.flow.flowId, revisionId)
  const unchanged = await service.control.publishFlow(
    'operator',
    created.flow.flowId,
    unchangedRevisionId,
    'open-flow-engine/v1',
    completed.publicationId,
    'poll-unchanged',
  )
  await service.tickMaintenance('2026-08-31T10:00:32.000Z')
  expect(service.control.getPublishOperation(created.flow.flowId, unchanged.operationId).status).toBe('succeeded')
  expect(call).toBe(3)
  expect(service.pollState(created.flow.flowId, 'poll')).toMatchObject({ checkpoint: { cursor: 'page-2' }, health: 'healthy', runtimeVersion: 2 })

  const changedRevisionId = await replacePoll(service, created.flow.flowId, unchangedRevisionId, 'changed')
  const live = await service.control.getLive(created.flow.flowId)
  const changed = await service.control.publishFlow(
    'operator',
    created.flow.flowId,
    changedRevisionId,
    'open-flow-engine/v1',
    live.publication?.publicationId ?? null,
    'poll-changed',
  )
  await service.tickPoll('2026-08-31T10:00:33.000Z')
  expect(checkpoints.at(-1)).toBeNull()
  expect(service.pollState(created.flow.flowId, 'poll')?.checkpoint).toEqual({ cursor: 'page-2' })
  await service.tickMaintenance('2026-08-31T10:00:33.000Z')
  expect(service.control.getPublishOperation(created.flow.flowId, changed.operationId).status).toBe('succeeded')
  expect(service.pollState(created.flow.flowId, 'poll')).toMatchObject({
    checkpoint: { cursor: 'changed-baseline' },
    health: 'healthy',
    runtimeVersion: 3,
  })

  database = new DatabaseSync(file, { readOnly: true })
  expect(database.prepare('SELECT COUNT(*) AS count FROM poll_candidates').get()).toEqual({ count: 0 })
  expect(database.prepare('SELECT COUNT(*) AS count FROM poll_claims').get()).toEqual({ count: 0 })
  expect(database.prepare('SELECT COUNT(*) AS count FROM poll_event_dedupe').get()).toEqual({ count: 0 })
  expect(database.prepare('SELECT COUNT(*) AS count FROM runs').get()).toEqual({ count: 0 })
  database.close()
})

it('fails a permanent Poll baseline before activation and preserves the old Live Publication', async () => {
  const file = await databaseFile()
  const definition: PollDefinition = {
    snapshot,
    async poll() {
      throw new PermanentPollError('The fixed Poll configuration is invalid.')
    },
  }
  const service = await openService(file, connector, () => Date.parse('2026-08-31T11:00:00.000Z'), {}, undefined, undefined, [definition])
  services.add(service)
  const created = await service.control.createFlow('operator', 'Poll failure', 'poll-failure-flow')
  const initial = await service.control.publishFlow('operator', created.flow.flowId, created.flow.draftRevisionId, 'open-flow-engine/v1', null, 'poll-initial')
  await service.tickMaintenance('2026-08-31T11:00:00.000Z')
  const initialDone = service.control.getPublishOperation(created.flow.flowId, initial.operationId)
  if (initialDone.status != 'succeeded') throw new Error('Initial Publish operation did not succeed.')

  const revisionId = await addPoll(service, created.flow.flowId, created.flow.draftRevisionId, 'invalid')
  const operation = await service.control.publishFlow(
    'operator',
    created.flow.flowId,
    revisionId,
    'open-flow-engine/v1',
    initialDone.publicationId,
    'poll-failed',
  )
  await service.tickPoll('2026-08-31T11:00:00.000Z')
  await service.tickMaintenance('2026-08-31T11:00:00.000Z')

  expect(service.control.getPublishOperation(created.flow.flowId, operation.operationId)).toMatchObject({
    issue: { code: 'trigger-key.invalid', nodeId: 'poll' },
    status: 'failed',
  })
  await expect(service.control.getLive(created.flow.flowId)).resolves.toMatchObject({
    publication: { publicationId: initialDone.publicationId },
  })
  expect(service.control.listPublications(created.flow.flowId, 10).page.publications).toHaveLength(1)
  const database = new DatabaseSync(file, { readOnly: true })
  expect(database.prepare('SELECT COUNT(*) AS count FROM poll_candidates').get()).toEqual({ count: 0 })
  expect(database.prepare('SELECT COUNT(*) AS count FROM poll_bindings').get()).toEqual({ count: 0 })
  database.close()
})

it('rolls back a changed Poll candidate during activation and succeeds after recovery', async () => {
  const file = await databaseFile()
  const definition: PollDefinition = { snapshot, poll: async () => ({ checkpoint: { ready: true }, events: [] }) }
  const service = await openService(file, connector, () => Date.parse('2026-08-31T12:00:00.000Z'), {}, undefined, undefined, [definition])
  services.add(service)
  const created = await service.control.createFlow('operator', 'Poll activation', 'poll-activation-flow')
  const revisionId = await addPoll(service, created.flow.flowId, created.flow.draftRevisionId, 'activation')
  const operation = await service.control.publishFlow('operator', created.flow.flowId, revisionId, 'open-flow-engine/v1', null, 'poll-activation')
  await service.tickPoll('2026-08-31T12:00:00.000Z')

  const database = new DatabaseSync(file)
  const scheduleJson = JSON.stringify(pollNode('activation').pollTimes)
  database.prepare("UPDATE poll_candidates SET schedule_json = '[]' WHERE operation_id = ?").run(operation.operationId)
  await service.tickMaintenance('2026-08-31T12:00:00.000Z')
  expect(service.control.getPublishOperation(created.flow.flowId, operation.operationId).status).toBe('pending')
  await expect(service.control.getLive(created.flow.flowId)).resolves.toMatchObject({ publication: null })
  expect(database.prepare('SELECT COUNT(*) AS count FROM publications').get()).toEqual({ count: 0 })

  database.prepare('UPDATE poll_candidates SET schedule_json = ? WHERE operation_id = ?').run(scheduleJson, operation.operationId)
  await service.tickMaintenance('2026-08-31T12:00:01.000Z')
  expect(service.control.getPublishOperation(created.flow.flowId, operation.operationId).status).toBe('succeeded')
  expect(database.prepare('SELECT COUNT(*) AS count FROM publications').get()).toEqual({ count: 1 })
  database.close()
})
