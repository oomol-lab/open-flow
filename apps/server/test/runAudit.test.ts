import { ControlClient } from '@oomol-lab/open-flow/control-api'
import { currentEngineContract } from '@oomol-lab/open-flow/runtime-contract'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { expect, it, onTestFinished } from 'vitest'
import { createServerApp } from '../node/transport/http.ts'
import { closeService, openService } from './serviceFixture.ts'

async function fixture(file = ':memory:') {
  const service = await openService(file)
  const app = createServerApp(service, { resolveControlActor: () => 'operator' })
  const request = async (route: string, init?: RequestInit) => app.request(route, init)
  const api = new ControlClient(request)
  const created = await api.createFlow('Run audit')
  const draft = await api.changeDraft(created.flowId, created.draftRevisionId, [
    { kind: 'graph.node.create', nodeId: 'start', node: { kind: 'start', name: 'Start', inputDefs: [] } },
  ])
  return { service, app, request, api, flowId: created.flowId, revisionId: draft.revision.revisionId }
}

it('records authenticated actors and channels for Draft and Live, retaining the first admission on replay', async () => {
  const { service, request, api, flowId, revisionId } = await fixture()
  const workbench = new ControlClient(request, 'workbench')
  const cli = new ControlClient(request, 'cli')
  const trigger = { nodeId: 'start', outputs: {} }
  await api.publishFlow(flowId, revisionId, null)
  await service.tickMaintenance()
  const publicationId = (await api.getLive(flowId)).publication!.publicationId
  for (const [client, channel] of [
    [workbench, 'workbench'],
    [cli, 'cli'],
    [api, 'api'],
  ] as const) {
    const options = { trigger, idempotencyKey: `draft-${channel}` }
    const draft = await client.createDraftRun(flowId, revisionId, options)
    expect(draft).toMatchObject({ source: 'draft', initiator: { actorId: 'operator', channel } })
    expect(await api.createDraftRun(flowId, revisionId, options)).toEqual(draft)
    const live = await client.createLiveRun(publicationId, { trigger, idempotencyKey: `live-${channel}` })
    expect(live).toMatchObject({ source: 'live', publicationId, initiator: { actorId: 'operator', channel } })
    expect(await api.getRun(live.runId)).toEqual(live)
  }
  expect((await api.listRuns(flowId)).runs).toHaveLength(6)
})

it('rejects caller-supplied actors and reserved server channels', async () => {
  const { app, flowId, revisionId } = await fixture()
  const route = `/v1/flows/${flowId}/revisions/${revisionId}/runs`
  const body = { version: 2, engineContract: currentEngineContract, inputs: {}, trigger: { nodeId: 'start', outputs: {} } }
  for (const channel of ['mcp', 'trigger', 'workflow', 'invalid']) {
    const response = await app.request(route, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': channel, 'x-open-flow-client': channel },
      body: JSON.stringify(body),
    })
    expect(response.status).toBe(400)
  }
  const response = await app.request(route, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': 'forged' },
    body: JSON.stringify({ ...body, initiator: { actorId: 'someone-else', channel: 'api' } }),
  })
  expect(response.status).toBe(400)
})

it('retains audit after restart and migrates old Runs without inventing identities', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'run-audit-'))
  onTestFinished(() => rm(directory, { recursive: true, force: true }))
  const file = path.join(directory, 'flow.sqlite')
  const { service, api, flowId, revisionId } = await fixture(file)
  const run = await api.createDraftRun(flowId, revisionId, { trigger: { nodeId: 'start', outputs: {} } })
  await closeService(service)
  const reopened = await openService(file)
  expect(reopened.control.runs.getRun('operator', run.runId)).toEqual(run)
  await closeService(reopened)
  const database = new DatabaseSync(file)
  database.exec('ALTER TABLE runs DROP COLUMN initiator_actor_id')
  database.exec('ALTER TABLE runs DROP COLUMN initiator_channel')
  database.exec(
    'DROP INDEX wait_auto_continue_due; ALTER TABLE wait_receipts DROP COLUMN auto_continue_at; ALTER TABLE wait_receipts DROP COLUMN resolution_source; DROP TABLE flow_state_values; DROP TABLE flow_dedupe_identities; DROP TABLE flow_dedupe_spaces; DROP TABLE flow_state_usage; ALTER TABLE runs DROP COLUMN state_writes; DROP TABLE run_artifacts; DROP TABLE webhook_responses; DROP TABLE event_source_apps; DROP TABLE source_event_versions; DROP TABLE event_source_namespace; ALTER TABLE event_sources DROP COLUMN connector_json; ALTER TABLE event_sources DROP COLUMN pending_json; PRAGMA user_version = 49',
  )
  database.close()
  const migrated = await openService(file)
  const { initiator: _initiator, ...legacy } = run
  expect(migrated.control.runs.getRun('operator', run.runId)).toEqual(legacy)
})
