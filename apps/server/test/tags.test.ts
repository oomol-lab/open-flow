import { ControlClient, controlErrorMetadata } from '@oomol-lab/open-flow/control-api'
import { currentEngineContract } from '@oomol-lab/open-flow/runtime-contract'
import { Hono } from 'hono'
import { expect, it } from 'vitest'
import { ControlError } from '../node/error.ts'
import { createControlApp } from '../node/transport/control.ts'
import { openService } from './serviceFixture.ts'

it('owns a case-insensitive account directory and preserves identities on rename', async () => {
  const { control } = await openService(':memory:')
  const first = control.tags.saveTag('owner', '  Équipe  ')
  expect(first.name).toBe('Équipe')
  expect(() => control.tags.saveTag('owner', 'éQUIPE')).toThrow(expect.objectContaining({ code: 'tag.conflict' }))
  expect(control.tags.saveTag('other', 'équipe').tagId).not.toBe(first.tagId)
  expect(control.tags.saveTag('owner', 'Sales', first.tagId)).toMatchObject({ tagId: first.tagId, name: 'Sales' })
  expect(control.tags.listTags('owner').tags).toEqual([{ ...first, name: 'Sales', referenceCount: 0 }])
  for (const actor of ['other', 'operator']) {
    expect(() => control.tags.saveTag(actor, 'Changed', first.tagId)).toThrow(expect.objectContaining({ code: 'tag.not-found' }))
    expect(() => control.tags.deleteTag(actor, first.tagId)).toThrow(expect.objectContaining({ code: 'tag.not-found' }))
  }
  for (const name of ['', '  ', 'a'.repeat(81), 'a\nb'])
    expect(() => control.tags.saveTag('owner', name)).toThrow(expect.objectContaining({ code: 'tag.invalid' }))
})

it('creates and imports memberships atomically and replays creation without restoring old tags', async () => {
  const { control } = await openService(':memory:')
  const a = control.tags.saveTag('owner', 'A')
  const b = control.tags.saveTag('owner', 'B')
  const foreign = control.tags.saveTag('other', 'Private')
  const { flow } = await control.flows.createFlow('owner', 'Created', 'create', undefined, [b.tagId, a.tagId, a.tagId])
  expect(flow.tagIds).toEqual([a.tagId, b.tagId].toSorted())
  const total = control.flows.listFlows('owner', 100, undefined, true).page.total
  await expect(control.flows.createFlow('owner', 'Invalid', 'invalid', undefined, [a.tagId, foreign.tagId])).rejects.toMatchObject({ code: 'tag.not-found' })
  expect(control.flows.listFlows('owner', 100, undefined, true).page.total).toBe(total)
  expect(() => control.flows.setFlowTags('owner', flow.flowId, [foreign.tagId])).toThrow(expect.objectContaining({ code: 'tag.not-found' }))
  expect(control.flows.getFlow('owner', flow.flowId).tagIds).toEqual(flow.tagIds)
  expect(() => control.flows.setFlowTags('other', flow.flowId, [])).toThrow(expect.objectContaining({ code: 'flow.not-found' }))
  const file = control.flows.exportFlow('owner', flow.flowId)
  expect(file).not.toHaveProperty('tagIds')
  await expect(control.flows.importFlow('owner', file, 'import-invalid', undefined, undefined, undefined, [foreign.tagId])).rejects.toMatchObject({
    code: 'tag.not-found',
  })
  expect(control.flows.listFlows('owner', 100, undefined, true).page.total).toBe(total)
  const imported = await control.flows.importFlow('owner', file, 'import', undefined, undefined, undefined, [a.tagId])
  expect(imported.flow.tagIds).toEqual([a.tagId])
  control.flows.setFlowTags('owner', flow.flowId, [b.tagId])
  control.flows.setFlowTags('owner', imported.flow.flowId, [])
  control.tags.deleteTag('owner', a.tagId)
  expect((await control.flows.createFlow('owner', 'Created', 'create', undefined, [a.tagId, b.tagId])).flow.tagIds).toEqual([b.tagId])
  expect((await control.flows.importFlow('owner', file, 'import', undefined, undefined, undefined, [a.tagId])).flow.tagIds).toEqual([])
  await expect(control.flows.createFlow('owner', 'Created', 'create', undefined, [b.tagId])).rejects.toMatchObject({ code: 'flow.conflict' })
})

it('keeps published definitions intact and removes memberships when tags or flows are deleted', async () => {
  const service = await openService(':memory:')
  const { control } = service
  const tag = control.tags.saveTag('owner', 'Production')
  const { flow } = await control.flows.createFlow('owner', 'Published', 'flow')
  const draft = await control.drafts.changeDraft('owner', flow.flowId, flow.draftRevisionId, [
    { kind: 'graph.node.create', nodeId: 'start', node: { kind: 'start', name: 'Start', inputDefs: [] } },
  ])
  const operation = await control.publications.publishFlow('owner', flow.flowId, draft.revision.revisionId, currentEngineContract, null, 'publish')
  await service.tickMaintenance()
  expect(control.publications.getPublishOperation('owner', flow.flowId, operation.operationId).status).toBe('succeeded')
  const editor = await control.flows.getEditor('owner', flow.flowId)
  control.flows.setFlowTags('owner', flow.flowId, [tag.tagId])
  const after = await control.flows.getEditor('owner', flow.flowId)
  expect(after.draft).toEqual(editor.draft)
  expect(after.live).toEqual(editor.live)
  expect(after.presentation).toEqual(editor.presentation)
  expect(control.tags.listTags('owner').tags[0]?.referenceCount).toBe(1)
  control.tags.saveTag('owner', 'Renamed', tag.tagId)
  expect(control.flows.getFlow('owner', flow.flowId).tagIds).toEqual([tag.tagId])
  control.tags.deleteTag('owner', tag.tagId)
  expect(control.flows.getFlow('owner', flow.flowId).tagIds).toEqual([])
  expect(control.flows.getFlow('owner', flow.flowId).live).toEqual(editor.flow.live)
  const other = control.tags.saveTag('owner', 'Other')
  control.flows.setFlowTags('owner', flow.flowId, [other.tagId])
  control.flows.retireFlow('owner', flow.flowId)
  expect(control.tags.listTags('owner').tags[0]?.referenceCount).toBe(0)
  expect(control.flows.listFlows('owner', 100, undefined, true, { tagIds: [other.tagId] }).page.total).toBe(0)
  expect(() => control.flows.setFlowTags('owner', flow.flowId, [])).toThrow(expect.objectContaining({ code: 'flow.busy' }))
})

it('filters before pagination and scopes HTTP cursors to their normalized filter', async () => {
  let now = 1
  const { control } = await openService(':memory:', { clock: () => now++ })
  const first = control.tags.saveTag('owner', 'First')
  const second = control.tags.saveTag('owner', 'Second')
  for (let index = 0; index < 65; index++)
    await control.flows.createFlow('owner', `Café item ${index}`, `create-${index}`, undefined, index < 55 ? [first.tagId] : index < 60 ? [second.tagId] : [])
  await control.flows.createFlow('other', 'Café private', 'private')
  const app = new Hono()
    .route(
      '/v1',
      createControlApp(control, () => 'owner'),
    )
    .onError((error) => {
      if (!(error instanceof ControlError)) throw error
      const status = controlErrorMetadata[error.code as keyof typeof controlErrorMetadata]?.status ?? 500
      return Response.json({ error: { code: error.code, message: error.message } }, { status })
    })
  const client = new ControlClient(async (path, init) => app.fetch(new Request(`http://test${path}`, init)))
  const query = { query: ' CAFÉ ', tagIds: [first.tagId], includeTotal: true }
  const page = await client.listFlows({ ...query, limit: 50 })
  expect(page.total).toBe(55)
  expect(page.flows).toHaveLength(50)
  expect(page.nextCursor).toBeDefined()
  const next = await client.listFlows({ ...query, query: 'café', cursor: page.nextCursor })
  expect(next.flows).toHaveLength(5)
  expect(next.nextCursor).toBeUndefined()
  expect(new Set([...page.flows, ...next.flows].map((flow) => flow.flowId)).size).toBe(55)
  await expect(client.listFlows({ cursor: page.nextCursor, tagIds: [second.tagId] })).rejects.toMatchObject({ code: 'page.invalid-cursor' })
  expect((await client.listFlows({ tagIds: [first.tagId, second.tagId], includeTotal: true })).total).toBe(60)
  expect((await client.listFlows({ untagged: true, includeTotal: true })).total).toBe(5)
  expect((await client.listFlows({ tagIds: [second.tagId], untagged: true, includeTotal: true })).total).toBe(10)
  expect((await client.listFlows({ query: 'item 64', includeTotal: true })).flows.map((flow) => flow.name)).toEqual(['Café item 64'])
  const created = await client.createTag(' Client ')
  expect((await client.listTags()).tags).toContainEqual({ ...created, referenceCount: 0 })
  expect((await client.renameTag(created.tagId, 'Client updated')).name).toBe('Client updated')
  const tagged = await client.createFlow('Tagged', 'http-create', undefined, [created.tagId])
  expect(tagged.tagIds).toEqual([created.tagId])
  expect(await client.updateFlow(tagged.flowId, { name: 'Settings', tagIds: [] })).toMatchObject({ name: 'Settings', tagIds: [] })
  expect((await client.setFlowTags(tagged.flowId, [])).tagIds).toEqual([])
  const imported = await client.importFlow(control.flows.exportFlow('owner', tagged.flowId), { tagIds: [created.tagId] })
  expect(imported.tagIds).toEqual([created.tagId])
  await client.deleteTag(created.tagId)
  expect((await client.getFlow(imported.flowId)).tagIds).toEqual([])
})

it('updates the Flow title and memberships atomically without changing its definition', async () => {
  const { control } = await openService(':memory:')
  const a = control.tags.saveTag('owner', 'A')
  const foreign = control.tags.saveTag('other', 'Private')
  const { flow } = await control.flows.createFlow('owner', 'Original', 'settings', undefined, [a.tagId])
  const before = await control.flows.getEditor('owner', flow.flowId)
  expect(() => control.flows.updateFlow('owner', flow.flowId, { name: 'Partial', tagIds: [foreign.tagId] })).toThrow(
    expect.objectContaining({ code: 'tag.not-found' }),
  )
  expect(control.flows.getFlow('owner', flow.flowId)).toEqual(flow)
  expect(() => control.flows.updateFlow('other', flow.flowId, { name: 'Changed', tagIds: [] })).toThrow(expect.objectContaining({ code: 'flow.not-found' }))
  expect(() => control.flows.updateFlow('owner', flow.flowId, {})).toThrow(expect.objectContaining({ code: 'flow.invalid' }))
  const changed = control.flows.updateFlow('owner', flow.flowId, { name: 'Changed', tagIds: [] })
  expect(changed).toMatchObject({ name: 'Changed', tagIds: [], draftRevisionId: flow.draftRevisionId })
  const after = await control.flows.getEditor('owner', flow.flowId)
  expect(after.draft).toEqual(before.draft)
  expect(after.live).toEqual(before.live)
  expect(after.presentation).toEqual(before.presentation)
})
