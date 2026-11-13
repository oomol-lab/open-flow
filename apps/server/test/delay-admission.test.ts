import { ControlClient } from '@oomol-lab/open-flow/control-api'
import { expect, it } from 'vitest'
import { waitDurationMs } from '../node/storage/run-store.ts'
import { createServerApp } from '../node/transport/http.ts'
import { openService } from './serviceFixture.ts'

async function fixture(durationMs: number, connected = true) {
  const service = await openService(':memory:')
  const app = createServerApp(service, { resolveControlActor: () => 'operator' })
  const api = new ControlClient(async (route, init) => app.request(route, init))
  const flow = await api.createFlow('Delay admission')
  const draft = await api.changeDraft(flow.flowId, flow.draftRevisionId, [
    { kind: 'graph.node.create', nodeId: 'start', node: { kind: 'start', name: 'Start', inputDefs: [] } },
    { kind: 'graph.node.create', nodeId: 'delay', node: { kind: 'delay', name: 'Delay', inputs: { durationMs: { kind: 'value', value: durationMs } } } },
    ...(connected ? [{ kind: 'graph.edge.connect' as const, edge: { source: 'start', target: 'delay' } }] : []),
  ])
  return { service, api, flowId: flow.flowId, revisionId: draft.revision.revisionId }
}

it.each(['draft', 'live'] as const)('enforces the seven-day Delay limit before accepting a %s Run', async (source) => {
  for (const durationMs of [waitDurationMs - 1, waitDurationMs, waitDurationMs + 1]) {
    const { service, api, flowId, revisionId } = await fixture(durationMs)
    let publicationId: string | undefined
    if (source === 'live') {
      const operation = await api.publishFlow(flowId, revisionId, null)
      await service.tickMaintenance()
      const published = service.control.publications.getPublishOperation('operator', flowId, operation.operationId)
      if (published.status !== 'succeeded') throw new Error('Expected a published Flow')
      publicationId = published.publicationId
    }
    const options = { trigger: { nodeId: 'start', outputs: {} } }
    const accepted = source === 'draft' ? api.createDraftRun(flowId, revisionId, options) : api.createLiveRun(publicationId!, options)
    if (durationMs < waitDurationMs) {
      await expect(accepted).resolves.toMatchObject({ source, status: 'queued' })
      expect((await api.listRuns(flowId)).runs).toHaveLength(1)
    } else {
      await expect(accepted).rejects.toMatchObject({ code: 'flow.invalid', message: 'Delay must be shorter than seven days.' })
      expect((await api.listRuns(flowId)).runs).toEqual([])
    }
  }
})

it('admits a Draft Run whose selected branch excludes an overlong Delay', async () => {
  const { api, flowId, revisionId } = await fixture(waitDurationMs, false)
  await expect(api.createDraftRun(flowId, revisionId, { trigger: { nodeId: 'start', outputs: {} } })).resolves.toMatchObject({ status: 'queued' })
})
