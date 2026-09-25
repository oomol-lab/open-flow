import { afterEach, expect, it, vi } from 'vitest'
import { spriteResource } from './spriteResource.ts'

afterEach(() => vi.unstubAllGlobals())
function images() {
  const created: (EventTarget & { src: string })[] = []
  vi.stubGlobal(
    'Image',
    class extends EventTarget {
      src = ''
      constructor() {
        super()
        created.push(this)
      }
    },
  )
  return created
}
it.each(['loaded', 'failed'] as const)('shares one probe and retains %s across remounts', (status) => {
  const created = images()
  const url = `https://example.com/${status}.png`
  const resource = spriteResource(url)
  const first = vi.fn(),
    second = vi.fn()
  const off = resource.subscribe(first)
  resource.subscribe(second)
  expect(created).toHaveLength(1)
  expect(created[0]!.src).toBe(url)
  expect(resource.getSnapshot()).toBe('loading')
  created[0]!.dispatchEvent(new Event(status == 'loaded' ? 'load' : 'error'))
  expect(resource.getSnapshot()).toBe(status)
  expect(first).toHaveBeenCalledTimes(1)
  expect(second).toHaveBeenCalledTimes(1)
  off()
  spriteResource(url).subscribe(vi.fn())
  expect(created).toHaveLength(1)
  created[0]!.dispatchEvent(new Event(status == 'loaded' ? 'error' : 'load'))
  expect(resource.getSnapshot()).toBe(status)
})
it('keeps theme and version URLs independent', () => {
  const created = images()
  const light = spriteResource('light-v2'),
    dark = spriteResource('dark-v2')
  light.subscribe(() => {})
  expect(created).toHaveLength(1)
  created[0]!.dispatchEvent(new Event('error'))
  dark.subscribe(() => {})
  created[1]!.dispatchEvent(new Event('load'))
  expect(light.getSnapshot()).toBe('failed')
  expect(dark.getSnapshot()).toBe('loaded')
  spriteResource('light-v3').subscribe(() => {})
  expect(created).toHaveLength(3)
})
it('falls back when Image is unavailable', () => {
  vi.stubGlobal('Image', undefined)
  const resource = spriteResource('unsupported')
  resource.subscribe(() => {})
  expect(resource.getSnapshot()).toBe('failed')
})
