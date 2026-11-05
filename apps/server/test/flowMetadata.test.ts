import { ControlClient } from '@oomol-lab/open-flow/control-api'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import { createServerApp } from '../node/transport/http.ts'
import { closeService, openService } from './serviceFixture.ts'

it('persists Flow metadata through HTTP, catalog reads, and restart, and supports independent edits and clearing', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'open-flow-metadata-'))
  onTestFinished(() => rm(directory, { recursive: true, force: true }))
  const file = path.join(directory, 'flow.sqlite')
  let service = await openService(file)
  let actor = 'owner'
  let app = createServerApp(service, { resolveControlActor: () => actor })
  const client = new ControlClient(async (url, init) => app.request(`http://test${url}`, init))
  const created = await client.createFlow('Daily digest', 'create')
  expect(created.icon).toBeUndefined()
  expect(created.description).toBeUndefined()
  const metadata = { icon: ':twemoji:package:', description: 'Collect updates.\nSend the daily report.' }
  const before = await client.getEditor(created.flowId)
  expect(await client.updateFlow(created.flowId, metadata)).toMatchObject(metadata)
  expect((await client.listFlows()).flows[0]).toMatchObject(metadata)
  expect(await client.updateFlow(created.flowId, { description: 'Revised description' })).toMatchObject({
    icon: metadata.icon,
    description: 'Revised description',
  })
  expect(await client.updateFlow(created.flowId, { name: 'Renamed' })).toMatchObject({
    name: 'Renamed',
    icon: metadata.icon,
    description: 'Revised description',
  })
  const after = await client.getEditor(created.flowId)
  expect(after.draft).toEqual(before.draft)
  expect(after.presentation).toEqual(before.presentation)
  expect(after.live).toEqual(before.live)
  actor = 'other'
  await expect(client.updateFlow(created.flowId, { icon: null })).rejects.toMatchObject({ code: 'flow.not-found' })
  actor = 'owner'
  for (const changes of [{}, { icon: 42 }, { description: false }]) {
    const response = await app.request(`http://test/v1/flows/${created.flowId}`, {
      method: 'PATCH',
      body: JSON.stringify({ ...changes, version: 1 }),
      headers: { 'content-type': 'application/json' },
    })
    expect(response.status).toBe(400)
  }
  await closeService(service)
  service = await openService(file)
  app = createServerApp(service, { resolveControlActor: () => actor })
  expect(await client.getFlow(created.flowId)).toMatchObject({ name: 'Renamed', icon: metadata.icon, description: 'Revised description' })
  const cleared = await client.updateFlow(created.flowId, { icon: null, description: null })
  expect(cleared.icon).toBeUndefined()
  expect(cleared.description).toBeUndefined()
  expect(cleared.name).toBe('Renamed')
  expect((await client.listFlows()).flows[0]?.icon).toBeUndefined()
  expect((await client.exportFlow(created.flowId)).description).toBeUndefined()
})
