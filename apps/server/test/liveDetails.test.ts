import { ControlClient } from '@oomol-lab/open-flow/control-api'
import { currentEngineContract } from '@oomol-lab/open-flow/runtime-contract'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { expect, it } from 'vitest'
import { createServerApp } from '../node/transport/http.ts'
import { closeService, openService } from './serviceFixture.ts'

it('reads authorized published entries independently of edits and unreadable Drafts', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'open-flow-live-details-'))
  const file = path.join(directory, 'flow.sqlite')
  const service = await openService(file)
  try {
    const created = await service.control.createFlow('operator', 'Online', 'create')
    const flowId = created.flow.flowId
    const app = createServerApp(service, { resolveControlActor: (request) => request.headers.get('x-actor') ?? undefined })
    const client = new ControlClient(async (route, init) => app.request(route, { ...init, headers: { 'x-actor': 'operator' } }))
    expect(await client.getLiveDetails(flowId)).toEqual({ flowId, inputDefs: null, publication: null, status: 'not-published', entries: [], version: 1 })
    const saved = await service.control.changeDraft('operator', flowId, created.flow.draftRevisionId, [
      {
        kind: 'graph.node.create',
        nodeId: 'webhook',
        node: { kind: 'webhook', name: 'Online hook', method: 'POST', bodyFields: [{ handle: 'message', jsonSchema: { type: 'string' }, nullable: false }] },
      },
      {
        kind: 'graph.node.create',
        nodeId: 'manual',
        node: { kind: 'start', name: 'Start', inputDefs: [{ handle: 'message', jsonSchema: { type: 'string' }, nullable: false }] },
      },
      { kind: 'graph.node.create', nodeId: 'cron', node: { kind: 'cron', name: 'Schedule', cronTimes: [{ type: 'every', unit: 'hour', value: 1 }] } },
    ])
    const op = await service.control.publishFlow('operator', flowId, saved.revision.revisionId, currentEngineContract, null, 'publish')
    await service.tickMaintenance()
    const done = service.control.getPublishOperation(flowId, op.operationId)
    if (done.status != 'succeeded') throw new Error('Publication did not succeed')
    const current = await client.getLiveDetails(flowId)
    expect(current.inputDefs).toEqual({ message: { schema: { type: 'string' }, nullable: false } })
    expect(current.entries.find((entry) => entry.type == 'start')?.config).toEqual({ inputDefs: current.inputDefs })
    const changedInputs = await service.control.editAuthoring('operator', flowId, {
      baseRevision: saved.revision.revisionId,
      requestId: 'input-defs-update',
      edits: [{ op: 'node.update', node: 'manual', set: { config: { inputDefs: { message: { description: 'Draft only' } } } } }],
    })
    expect(service.control.readAuthoring(flowId, { nodes: ['manual'] }).data.nodes?.[0]).toMatchObject({
      config: { inputDefs: { message: { description: 'Draft only' } } },
    })
    expect((await client.getLiveDetails(flowId)).inputDefs).toEqual(current.inputDefs)
    expect(current.publication?.publicationId).toBe(done.publicationId)
    expect(current.entries.find((entry) => entry.type == 'webhook')).toMatchObject({
      name: 'Online hook',
      config: { method: 'POST', body: { message: { nullable: false } } },
      binding: { endpointUrl: expect.stringMatching(/\/v1\/webhooks\/endpoint_/) },
    })
    await service.control.setFlowEnabled(flowId, done.publicationId, false)
    expect(await client.getLiveDetails(flowId)).toMatchObject({
      enabled: false,
      status: 'suspended',
      entries: expect.arrayContaining([expect.objectContaining({ type: 'webhook', binding: expect.objectContaining({ health: 'healthy' }) })]),
    })
    const changed = await service.control.changeDraft('operator', flowId, changedInputs.revision, [{ kind: 'graph.node.delete', nodeId: 'webhook' }])
    expect((await client.getLiveDetails(flowId)).entries.some((entry) => entry.nodeId == 'webhook')).toBe(true)
    const second = await service.control.publishFlow('operator', flowId, changed.revision.revisionId, currentEngineContract, done.publicationId, 'republish')
    await service.tickMaintenance()
    expect(service.control.getPublishOperation(flowId, second.operationId).status).toBe('succeeded')
    expect(service.control.listFlowTriggerBindings(flowId).some((item) => item.triggerNodeId == 'webhook' && item.currentPublicationId == null)).toBe(true)
    expect((await client.getLiveDetails(flowId)).entries.map((item) => item.type)).toEqual(['cron', 'start'])
    const draft = await service.control.changeDraft('operator', flowId, changed.revision.revisionId, [
      { kind: 'graph.node.create', nodeId: 'draft-only', node: { kind: 'webhook', name: 'Draft only', method: 'GET', bodyFields: [] } },
    ])
    const db = new DatabaseSync(file)
    try {
      db.prepare("UPDATE revisions SET content = '{}' WHERE revision_id = ?").run(draft.revision.revisionId)
      db.prepare('UPDATE revision_deltas SET patch = ? WHERE revision_id = ?').run('[{"op":"invalid","path":"/"}]', draft.revision.revisionId)
      expect(() => service.control.getDraft(flowId)).toThrow()
      expect((await client.getLiveDetails(flowId)).entries.map((item) => item.type)).toEqual(['cron', 'start'])
      db.prepare("UPDATE publications SET revision_digest = 'invalid' WHERE flow_id = ?").run(flowId)
      await expect(client.getLiveDetails(flowId)).rejects.toMatchObject({ code: 'flow.revision-storage-conflict' })
    } finally {
      db.close()
    }
    expect((await app.request(`/v1/flows/${flowId}/live/details`)).status).toBe(401)
    expect((await app.request(`/v1/flows/${flowId}/live/details`, { headers: { 'x-actor': 'someone-else' } })).status).not.toBe(200)
  } finally {
    await closeService(service)
    await rm(directory, { recursive: true, force: true })
  }
})
