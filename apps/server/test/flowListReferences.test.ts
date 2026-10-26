import type { Store } from '../node/storage/store.ts'

import { expect, it, onTestFinished, vi } from 'vitest'
import { openService } from './serviceFixture.ts'

it('counts only returned page rows and leaves detail and mutation reads free of counts', async () => {
  let time = 1
  const service = await openService(':memory:', { clock: () => time++ })
  const store = (service.control.runs as unknown as { store: Store }).store
  const flows = []
  for (const name of ['One', 'Two', 'Lookahead']) flows.push((await service.control.flows.createFlow('owner', name, name)).flow)
  const foreign = (await service.control.flows.createFlow('foreign-owner', 'Foreign', 'Foreign')).flow
  store.resourceReferences.replaceResources('owner', flows[2]!.flowId, 'draft', {
    variableNames: [],
    calledFlowIds: flows.slice(0, 2).map((flow) => flow.flowId),
  })
  const count = vi.spyOn(store.resourceReferences, 'incomingFlowCounts')
  const revisions = vi.spyOn(store.revisions, 'read')
  onTestFinished(() => {
    vi.restoreAllMocks()
  })
  const first = service.control.flows.listFlows('owner', 2, undefined, true)
  expect(first.page.total).toBe(3)
  expect(first.page.flows.map(({ flowId, referenceCount }) => [flowId, referenceCount])).toEqual(flows.slice(0, 2).map((flow) => [flow.flowId, 1]))
  expect(count).toHaveBeenCalledTimes(1)
  expect(count.mock.calls[0]![0].map(({ ownerId, flowId }) => ({ ownerId, flowId }))).toEqual(
    flows.slice(0, 2).map(({ flowId }) => ({ ownerId: 'owner', flowId })),
  )
  expect(revisions).not.toHaveBeenCalled()
  count.mockClear()
  const second = service.control.flows.listFlows('owner', 2, first.next, false)
  expect(second.page.flows).toMatchObject([{ flowId: flows[2]!.flowId, referenceCount: 0 }])
  expect(second.next).toBeUndefined()
  expect(count.mock.calls[0]![0].map(({ flowId }) => flowId)).toEqual([flows[2]!.flowId])
  count.mockClear()
  const empty = service.control.flows.listFlows('owner', 2, { createdAt: Number.MAX_SAFE_INTEGER, flowId: '' }, false)
  expect(empty.page.flows).toEqual([])
  expect(count).toHaveBeenCalledWith([])
  count.mockClear()
  expect(service.control.flows.getFlow('owner', flows[0]!.flowId)).not.toHaveProperty('referenceCount')
  expect(service.control.flows.renameFlow('owner', flows[0]!.flowId, 'Renamed')).not.toHaveProperty('referenceCount')
  expect((await service.control.flows.createFlow('owner', 'New', 'New')).flow).not.toHaveProperty('referenceCount')
  expect(count).not.toHaveBeenCalled()
  expect(service.control.flows.listFlows('foreign-owner', 2, undefined, false).page.flows).toMatchObject([{ flowId: foreign.flowId, referenceCount: 0 }])
})
