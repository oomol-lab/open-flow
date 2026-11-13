import { expect, it, vi } from 'vitest'
import { ProviderIconCache } from '../src/connector/common/providerIconCache.ts'
import { indexedDbIconDelegate } from '../src/ui/browser/icons/providerIconResource.ts'

// Node's Blob supports the native structuredClone used by fake-indexeddb.
it('persists binary browser artwork across cache instances through IndexedDB', async () => {
  const fetch = vi.fn(async () => new Response('<svg/>', { headers: { 'content-type': 'image/svg+xml' } }))
  const request = { kind: 'sprite', theme: 'light', url: 'https://example.test/light.svg', version: 'idb-test' } as const
  const first = new ProviderIconCache({ scope: 'idb-test', storage: indexedDbIconDelegate(), fetch })
  const result = await first.getBlob(request)
  const second = new ProviderIconCache({ scope: 'idb-test', storage: indexedDbIconDelegate(), mode: 'offline', fetch })
  const restored = await second.getBlob(request)
  expect(restored).toBeInstanceOf(Blob)
  expect(restored.type).toBe('image/svg+xml')
  expect(await restored.text()).toBe(await result.text())
  expect(fetch).toHaveBeenCalledTimes(1)
})
