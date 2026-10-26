import { currentEngineContract } from '@oomol-lab/open-flow/runtime-contract'
import { expect, it } from 'vitest'
import { openService } from './serviceFixture.ts'

it('enforces Flow ownership at the application boundary without a protocol adapter', async () => {
  const { control } = await openService(':memory:')
  const { flow } = await control.flows.createFlow('owner', 'Private', 'create')
  for (const actor of ['other', 'operator']) {
    expect(() => control.flows.getFlow(actor, flow.flowId)).toThrow(expect.objectContaining({ code: 'flow.not-found' }))
    expect(() => control.flows.renameFlow(actor, flow.flowId, 'Stolen')).toThrow(expect.objectContaining({ code: 'flow.not-found' }))
    expect(() => control.flows.updatePresentation(actor, flow.flowId, 1, {})).toThrow(expect.objectContaining({ code: 'flow.not-found' }))
    await expect(control.drafts.changeDraft(actor, flow.flowId, flow.draftRevisionId, [])).rejects.toMatchObject({ code: 'flow.not-found' })
    await expect(control.publications.publishFlow(actor, flow.flowId, flow.draftRevisionId, currentEngineContract, null, 'publish')).rejects.toMatchObject({
      code: 'flow.not-found',
    })
    await expect(control.connectors.listConnectorProviders(actor, flow.flowId)).rejects.toMatchObject({ code: 'flow.not-found' })
    expect(control.flows.listFlows(actor, 10).page.flows).toEqual([])
  }
  expect(control.flows.getFlow('owner', flow.flowId).name).toBe('Private')
  expect(control.drafts.getDraft('owner', flow.flowId).revisionId).toBe(flow.draftRevisionId)
})

it('checks Run and Publication ownership before admission, replay, reads and cancellation', async () => {
  const service = await openService(':memory:')
  const { control } = service
  const { flow } = await control.flows.createFlow('owner', 'Private', 'create')
  const changed = await control.drafts.changeDraft('owner', flow.flowId, flow.draftRevisionId, [
    { kind: 'graph.node.create', nodeId: 'start', node: { kind: 'start', name: 'Start', inputDefs: [] } },
  ])
  const args = [flow.flowId, changed.revision.revisionId, currentEngineContract, {}, 'run', { nodeId: 'start', outputs: {} }] as const
  const accepted = await control.runs.createDraftRun('owner', ...args)
  expect((await control.runs.createDraftRun('owner', ...args)).run.runId).toBe(accepted.run.runId)
  await expect(control.runs.createDraftRun('other', ...args)).rejects.toMatchObject({ code: 'flow.not-found' })
  for (const actor of ['other', 'operator']) {
    expect(() => control.runs.getRun(actor, accepted.run.runId)).toThrow(expect.objectContaining({ code: 'run.not-found' }))
    expect(() => control.runs.cancelRun(actor, accepted.run.runId)).toThrow(expect.objectContaining({ code: 'run.not-found' }))
    expect(() => control.runs.resolveRunWait(actor, accepted.run.runId, 'wait', 'continue')).toThrow(expect.objectContaining({ code: 'run.not-found' }))
    expect(() => control.runs.listRunResults(actor, accepted.run.runId)).toThrow(expect.objectContaining({ code: 'run.not-found' }))
  }
  expect(control.runs.getRun('owner', accepted.run.runId).status).toBe('queued')
  const operation = await control.publications.publishFlow('owner', flow.flowId, changed.revision.revisionId, currentEngineContract, null, 'publish')
  await service.tickMaintenance()
  const published = control.publications.getPublishOperation('owner', flow.flowId, operation.operationId)
  if (published.status != 'succeeded') throw new Error('Publication failed.')
  await expect(control.runs.createLiveRun('other', published.publicationId, {}, 'live', { nodeId: 'start', outputs: {} })).rejects.toMatchObject({
    code: 'publication.not-found',
  })
})

it('enforces administrative event source and connection console policy in the service', async () => {
  const { control } = await openService(':memory:')
  const signal = new AbortController().signal
  await expect(control.eventSources.listEventSources('member')).rejects.toMatchObject({ code: 'authorization.denied' })
  await expect(control.connectors.listEventSourceConnections('member', undefined, signal)).rejects.toMatchObject({ code: 'authorization.denied' })
  expect(() => control.eventSources.deleteEventSource('member', 'source', 1)).toThrow(expect.objectContaining({ code: 'authorization.denied' }))
  await expect(control.connectors.connectorConnectionPage('member', 'mail')).rejects.toMatchObject({ code: 'authorization.denied' })
})
