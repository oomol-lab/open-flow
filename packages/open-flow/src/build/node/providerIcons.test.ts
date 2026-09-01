import type { Plugin } from 'vite'

import { afterEach, describe, expect, it, vi } from 'vitest'
import { providerIconsPlugin } from './providerIcons.ts'

const resolvedModuleId = '\0virtual:oomol-provider-icons'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function load(plugin: Plugin): Promise<unknown> {
  if (typeof plugin.load != 'function') throw new Error('Provider icons plugin does not have a load hook.')
  return await Reflect.apply(plugin.load, {}, [resolvedModuleId])
}

describe('providerIconsPlugin', () => {
  it.each(['Server Workbench', 'npm Workbench'])('settles the %s catalog fetch within the configured bound', async () => {
    const controller = new AbortController()
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => {
      queueMicrotask(() => controller.abort())
      return controller.signal
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
        const signal = init?.signal
        if (signal == null) throw new Error('Catalog fetch did not include a timeout signal.')
        return await new Promise<Response>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        })
      }),
    )

    await expect(load(providerIconsPlugin())).resolves.toBe('export default {};')
    expect(timeout).toHaveBeenCalledWith(5_000)
  })

  it('bundles valid catalog entries', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          items: [
            { iconUrl: 'https://static.oomol.com/example.svg', service: 'example' },
            { iconUrl: '', service: 'missing' },
          ],
        }),
      ),
    )

    await expect(load(providerIconsPlugin())).resolves.toBe('export default {"example":"https://static.oomol.com/example.svg"};')
  })

  it('uses an empty catalog for invalid responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ items: null })),
    )

    await expect(load(providerIconsPlugin())).resolves.toBe('export default {};')
  })

  it('uses an empty catalog when the catalog is unavailable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 503 })),
    )

    await expect(load(providerIconsPlugin())).resolves.toBe('export default {};')
  })
})
