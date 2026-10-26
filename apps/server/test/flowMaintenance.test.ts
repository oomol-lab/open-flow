import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { closeService, openService } from './serviceFixture.ts'

it('physically deletes a retired Flow without retaining its authoring history', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'open-flow-retirement-'))
  const service = await openService(path.join(directory, 'open-flow.sqlite'))
  try {
    const created = await service.control.flows.createFlow('operator', 'Retirement', 'retirement-flow')
    service.control.flows.retireFlow('operator', created.flow.flowId)

    await service.tickMaintenance()
    await service.tickMaintenance()

    expect(() => service.control.flows.getFlow('operator', created.flow.flowId)).toThrow(expect.objectContaining({ code: 'flow.not-found' }))
  } finally {
    await closeService(service)
    await rm(directory, { force: true, recursive: true })
  }
})
