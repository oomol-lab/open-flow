// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ProviderIconCache } from '../../../connector/common/providerIconCache.ts'
import { ContentIcon, IconImageCrossOriginContext, imageIcon, placeholderIcon, spriteIcon } from './ContentIcon.tsx'
import { indexedDbIconDelegate, ProviderIconCacheContext } from './providerIconResource.ts'

const metadata = {
  version: 'resource-test',
  pixelRatio: 2,
  iconSize: 48,
  bleed: 2,
  width: 104,
  height: 52,
  lightUrl: 'https://example.test/light.svg',
  darkUrl: 'https://example.test/dark.svg',
}
const source = spriteIcon({ iconSprite: metadata, iconSpritePosition: { x: 54, y: 2 } }, placeholderIcon)
let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
const decode = vi.fn(async () => {})
beforeEach(() => {
  decode.mockClear()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal(
    'Image',
    class {
      src = ''
      decode = decode
    },
  )
  host = document.createElement('div')
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('persists browser artwork across cache instances through the IndexedDB delegate', async () => {
  const fetch = vi.fn(async () => new Response('<svg/>', { headers: { 'content-type': 'image/svg+xml' } }))
  const request = { kind: 'sprite', theme: 'light', url: metadata.lightUrl, version: metadata.version } as const
  const first = new ProviderIconCache({ scope: 'idb-test', delegate: indexedDbIconDelegate(), fetch })
  const result = await first.get(request)
  const second = new ProviderIconCache({ scope: 'idb-test', delegate: indexedDbIconDelegate(), mode: 'offline', fetch })
  expect(await second.get(request)).toBe(result)
  expect(fetch).toHaveBeenCalledTimes(1)
})

it('crops cached physical pixels for export and releases the temporary bitmap', async () => {
  const cache = new ProviderIconCache({ scope: 'crop-test', fetch: async () => new Response('<svg/>', { headers: { 'content-type': 'image/svg+xml' } }) })
  const draw = vi.fn()
  const canvases: HTMLCanvasElement[] = []
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: draw } as unknown as CanvasRenderingContext2D)
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(function (this: HTMLCanvasElement) {
    canvases.push(this)
    return 'data:image/png;base64,Y3JvcA=='
  })
  await act(async () =>
    root.render(
      <ProviderIconCacheContext.Provider value={cache}>
        <IconImageCrossOriginContext.Provider value="anonymous">
          <ContentIcon src={source} />
        </IconImageCrossOriginContext.Provider>
      </ProviderIconCacheContext.Provider>,
    ),
  )
  expect(host.querySelector('img')?.src).toBe('data:image/png;base64,Y3JvcA==')
  expect(draw).toHaveBeenCalledWith(expect.anything(), 54, 2, 48, 48, 0, 0, 48, 48)
  expect(canvases).toHaveLength(1)
  expect(canvases[0]?.width).toBe(0)
  expect(canvases[0]?.height).toBe(0)
  expect(host.querySelector('[data-render-pending]')).toBeNull()
})

it('displays the fallback when sprite loading fails without leaving capture pending', async () => {
  const cache = new ProviderIconCache({ scope: 'failed-test', fetch: async () => new Response(null, { status: 503 }) })
  await act(async () =>
    root.render(
      <ProviderIconCacheContext.Provider value={cache}>
        <ContentIcon src={source} />
      </ProviderIconCacheContext.Provider>,
    ),
  )
  expect(host.querySelector('[data-render-pending]')).toBeNull()
  expect(host.querySelector('img')).toBeNull()
  expect(host.querySelector('[aria-hidden="true"]')).not.toBeNull()
})

it.each([source, imageIcon('https://example.test/original.svg', placeholderIcon, 'example')])(
  'keeps the existing fallback visible while Provider artwork is being loaded',
  async (src) => {
    let finish!: (response: Response) => void
    const cache = new ProviderIconCache({
      scope: 'pending-test',
      fetch: () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    })
    const render = (icon?: string) => (
      <ProviderIconCacheContext.Provider value={cache}>
        <ContentIcon src={icon} fallback={<span>Default node icon</span>} />
      </ProviderIconCacheContext.Provider>
    )
    await act(async () => root.render(render()))
    expect(host.textContent).toBe('Default node icon')
    await act(async () => root.render(render(src)))
    expect(host.querySelector('[data-render-pending]')).not.toBeNull()
    expect(host.textContent).toBe('Default node icon')
    await act(async () => finish(new Response('<svg/>', { headers: { 'content-type': 'image/svg+xml' } })))
    expect(host.querySelector('[data-render-pending]')).toBeNull()
    expect(host.textContent).not.toContain('Default node icon')
  },
)

it('keeps ready artwork visible while a replacement cache reads the same resource', async () => {
  const first = new ProviderIconCache({ scope: 'first', fetch: async () => new Response('<svg/>', { headers: { 'content-type': 'image/svg+xml' } }) })
  let finish!: (response: Response) => void
  const second = new ProviderIconCache({
    scope: 'second',
    fetch: () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  })
  const render = (cache: ProviderIconCache) => (
    <ProviderIconCacheContext.Provider value={cache}>
      <ContentIcon src={source} fallback={<span>Default node icon</span>} />
    </ProviderIconCacheContext.Provider>
  )
  await act(async () => root.render(render(first)))
  const ready = host.querySelector<HTMLElement>('[style]')!.style.backgroundImage
  await act(async () => root.render(render(second)))
  expect(host.querySelector<HTMLElement>('[style]')?.style.backgroundImage).toBe(ready)
  expect(host.textContent).not.toContain('Default node icon')
  expect(host.querySelector('[data-render-pending]')).not.toBeNull()
  await act(async () => finish(new Response('<svg>new</svg>', { headers: { 'content-type': 'image/svg+xml' } })))
  expect(host.querySelector('[data-render-pending]')).toBeNull()
  expect(host.querySelector<HTMLElement>('[style]')?.style.backgroundImage).not.toBe(ready)
})

it('shares synchronous ready state across mounts and decodes a sheet only once', async () => {
  const get = vi.fn(async () => undefined)
  const cache = new ProviderIconCache({
    scope: 'ready-state',
    delegate: { get, set: async () => {}, delete: async () => {} },
    fetch: async () => new Response('<svg/>', { headers: { 'content-type': 'image/svg+xml' } }),
  })
  const render = () => (
    <ProviderIconCacheContext.Provider value={cache}>
      <ContentIcon src={source} />
      <ContentIcon src={source} />
    </ProviderIconCacheContext.Provider>
  )
  await act(async () => root.render(render()))
  expect(decode).toHaveBeenCalledTimes(1)
  expect(get).toHaveBeenCalledTimes(1)
  act(() => root.render(null))
  act(() => root.render(render()))
  expect(host.querySelectorAll('[style]')).toHaveLength(2)
  expect(host.querySelectorAll('i')).toHaveLength(0)
  await act(async () => {})
  expect(decode).toHaveBeenCalledTimes(1)
  expect(get).toHaveBeenCalledTimes(1)
})
