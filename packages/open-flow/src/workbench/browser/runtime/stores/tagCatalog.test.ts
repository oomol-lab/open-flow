import { expect, it, vi } from 'vitest'
import { ApiError, WorkbenchClient } from '../api.ts'
import { createI18n } from '../i18n.ts'
import { TagCatalog } from './tagCatalog.ts'

it('checks normalized names and routes conflicts to the field while retaining other error notifications', async () => {
  const client = new WorkbenchClient(vi.fn())
  vi.spyOn(client, 'listTags').mockResolvedValue({ tags: [{ tagId: 'sales', name: 'Sales', referenceCount: 0, version: 1 }], version: 1 })
  const create = vi.spyOn(client, 'createTag').mockRejectedValue(new ApiError(409, 'tag.conflict', 'Duplicate'))
  const notice = vi.fn()
  const conflict = vi.fn()
  const i18n = createI18n('en')
  const catalog = new TagCatalog(client, notice, i18n)
  try {
    await catalog.reload()
    expect(catalog.hasName(' SALES ')).toBe(true)
    expect(catalog.hasName(' SALES ', 'sales')).toBe(false)
    expect(await catalog.save('Sales', undefined, conflict)).toBeUndefined()
    expect(conflict).toHaveBeenCalledTimes(1)
    expect(notice).not.toHaveBeenCalled()
    await catalog.save('Sales')
    expect(notice).toHaveBeenCalledWith({ kind: 'error', message: 'A tag with this name already exists.' })
    create.mockRejectedValue(new Error('Offline'))
    await catalog.save('New', undefined, conflict)
    expect(conflict).toHaveBeenCalledTimes(1)
    expect(notice).toHaveBeenCalledTimes(2)
  } finally {
    catalog.dispose()
    i18n.dispose()
  }
})

it('retains the complete tag directory after failure and replaces it on retry', async () => {
  const client = new WorkbenchClient(vi.fn())
  const tag = { tagId: 'tag', name: 'Tag', version: 1 as const, referenceCount: 1 }
  const list = vi
    .spyOn(client, 'listTags')
    .mockResolvedValueOnce({ tags: [tag], version: 1 })
    .mockRejectedValueOnce(new Error('Unavailable'))
    .mockResolvedValueOnce({ tags: [{ ...tag, name: 'Renamed', referenceCount: 2 }], version: 1 })
  const notice = vi.fn()
  const i18n = createI18n()
  const catalog = new TagCatalog(client, notice, i18n)
  try {
    await catalog.reload()
    const original = catalog.state.value.tags
    await catalog.reload()
    expect(catalog.state.value).toMatchObject({ tags: original, loading: false, failed: true })
    expect(notice).toHaveBeenCalledTimes(1)
    await catalog.reload()
    expect(catalog.state.value).toEqual({ tags: [{ ...tag, name: 'Renamed', referenceCount: 2 }], loading: false, failed: false })
    expect(list.mock.calls[0]?.[0]?.aborted).toBe(true)
  } finally {
    catalog.dispose()
    i18n.dispose()
  }
})

it('ignores a late directory response after a newer refresh', async () => {
  const client = new WorkbenchClient(vi.fn())
  const old = Promise.withResolvers<Awaited<ReturnType<typeof client.listTags>>>()
  const current = { tags: [{ tagId: 'new', name: 'New', referenceCount: 0, version: 1 as const }], version: 1 as const }
  vi.spyOn(client, 'listTags').mockReturnValueOnce(old.promise).mockResolvedValueOnce(current)
  const notice = vi.fn()
  const i18n = createI18n()
  const catalog = new TagCatalog(client, notice, i18n)
  try {
    const pending = catalog.reload()
    await catalog.reload()
    old.resolve({ tags: [], version: 1 })
    await pending
    expect(catalog.state.value.tags).toEqual(current.tags)
    expect(notice).not.toHaveBeenCalled()
  } finally {
    catalog.dispose()
    i18n.dispose()
  }
})
