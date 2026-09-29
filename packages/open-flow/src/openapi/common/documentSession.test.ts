import { expect, it, vi } from 'vitest'
import { OpenApiDocumentSession } from './documentSession.ts'
it('loads lazily, deduplicates, refreshes explicitly, and releases data when the panel closes', async () => {
  const doc = { openapi: '3.0.0', paths: {} }
  const load = vi.fn(async () => doc)
  const session = new OpenApiDocumentSession(load)
  expect(load).not.toHaveBeenCalled()
  await Promise.all([session.read('https://example.test/spec'), session.read('https://example.test/spec')])
  expect(load).toHaveBeenCalledTimes(1)
  await session.read('https://example.test/spec', true)
  expect(load).toHaveBeenCalledTimes(2)
  session.clear()
  await session.read('https://example.test/spec')
  expect(load).toHaveBeenCalledTimes(3)
})
it('discards stale responses even if the transport ignores abort', async () => {
  let complete!: (value: { openapi: string; paths: Record<string, never> }) => void
  const session = new OpenApiDocumentSession(
    () =>
      new Promise((resolve) => {
        complete = resolve
      }),
  )
  const old = session.read('https://example.test/spec')
  session.clear()
  complete({ openapi: '3.0.0', paths: {} })
  await expect(old).rejects.toThrow('cancelled')
})

it.each([
  { paths: { '/items': { $ref: 'https://example.test/paths.json' } }, error: 'External OpenAPI references' },
  { paths: { '/items': { $ref: '#/components/pathItems/Missing' } }, error: 'reference is missing' },
])('rejects an unreadable operation list and allows retry: $error', async ({ paths, error }) => {
  const valid = { openapi: '3.1.0', paths: { '/items': { get: { responses: {} } } } }
  const load = vi.fn().mockResolvedValueOnce({ openapi: '3.1.0', paths }).mockResolvedValueOnce(valid)
  const session = new OpenApiDocumentSession(load)
  await expect(session.read('https://example.test/spec')).rejects.toThrow(error)
  await expect(session.read('https://example.test/spec')).resolves.toEqual(valid)
  expect(load).toHaveBeenCalledTimes(2)
})
