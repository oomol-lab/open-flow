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

    await expect(load(providerIconsPlugin())).resolves.toBe('export const spriteCatalog = null;export default {};')
    expect(timeout).toHaveBeenCalledWith(5_000)
  })

  it('bundles valid catalog entries', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          data: [
            { iconUrl: 'https://static.oomol.com/example.svg', service: 'example' },
            { iconUrl: '', service: 'missing' },
          ],
        }),
      ),
    )

    await expect(load(providerIconsPlugin())).resolves.toBe(
      'export const spriteCatalog = null;export default {"example":"https://static.oomol.com/example.svg"};',
    )
  })

  it('uses an empty catalog for invalid responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ data: null })),
    )

    await expect(load(providerIconsPlugin())).resolves.toBe('export const spriteCatalog = null;export default {};')
  })

  it('uses an empty catalog when the catalog is unavailable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 503 })),
    )

    await expect(load(providerIconsPlugin())).resolves.toBe('export const spriteCatalog = null;export default {};')
  })
})

it('bundles sprite-only entries and keeps image fallbacks', async () => {
  const iconSprite = {
    version: 'v1',
    pixelRatio: 2,
    iconSize: 48,
    bleed: 2,
    width: 104,
    height: 52,
    lightUrl: 'https://example.com/light.png',
    darkUrl: 'https://example.com/dark.png',
  }
  const iconSpritePosition = { x: 54, y: 2 }
  const fetcher = vi.fn(async () =>
    Response.json({
      success: true,
      meta: { iconSprite },
      data: [
        { service: 'sprite-only', iconSpritePosition },
        { service: 'second', iconSpritePosition: { x: 2, y: 2 } },
        { service: 'invalid', iconSpritePosition: { x: 200, y: 2 }, iconUrl: 'https://example.com/invalid.svg' },
        { service: 'legacy', iconUrl: 'https://example.com/icon.svg' },
      ],
    }),
  )
  vi.stubGlobal('fetch', fetcher)
  const result = await load(providerIconsPlugin())
  expect(fetcher).toHaveBeenCalledWith('https://connector.oomol.com/public/v1/apps', { signal: expect.any(AbortSignal) })
  expect(result).toBe(
    `export const spriteCatalog = ${JSON.stringify({ iconSprite, positions: { 'sprite-only': iconSpritePosition, 'second': { x: 2, y: 2 } } })};export default ${JSON.stringify({ invalid: 'https://example.com/invalid.svg', legacy: 'https://example.com/icon.svg' })};`,
  )
})
