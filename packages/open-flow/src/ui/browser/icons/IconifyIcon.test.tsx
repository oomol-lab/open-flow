import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchIcon, IconifyIcon } from './IconifyIcon.tsx'

afterEach(() => vi.unstubAllGlobals())

describe('remote Iconify icons', () => {
  it('shares requests and renders a previously loaded icon immediately on remount', async () => {
    const request = vi.fn(async () => Response.json({ icons: { cached: { body: '<path d="M0 0"/>', width: 16, height: 16 } } }))
    vi.stubGlobal('fetch', request)
    const first = fetchIcon('test-cache', 'cached')
    const concurrent = fetchIcon('test-cache', 'cached')
    expect(concurrent).toBe(first)
    await first
    await fetchIcon('test-cache', 'cached')
    expect(request).toHaveBeenCalledTimes(1)
    const markup = renderToStaticMarkup(<IconifyIcon collection="test-cache" icon="cached" />)
    expect(markup).toContain('data:image/svg+xml')
  })

  it('allows retry after a failed request', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(Response.json({ icons: { retry: { body: '<path d="M0 0"/>' } } }))
    vi.stubGlobal('fetch', request)
    await expect(fetchIcon('test-cache', 'retry')).rejects.toThrow()
    await expect(fetchIcon('test-cache', 'retry')).resolves.toBeDefined()
    expect(request).toHaveBeenCalledTimes(2)
  })
})
