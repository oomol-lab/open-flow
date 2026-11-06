// @vitest-environment happy-dom
import type { ReactFlowInstance } from '@xyflow/react'
import type { ReactElement } from 'react'
import type { FlowCanvasProps } from './FlowCanvas.tsx'
import type { FlowCanvasViewModel } from './model.ts'

import { toSvg } from 'html-to-image'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CanvasStore } from '../../stores/canvas/canvas.store.ts'
import { downloadFlowPng, downloadPng, flowToPng } from './exportPng.ts'

vi.mock('html-to-image', () => ({ toSvg: vi.fn() }))
vi.mock('./FlowCanvas.tsx', () => ({ FlowCanvas: () => null }))
vi.mock('react-dom/client', () => ({ createRoot: vi.fn() }))

const model: FlowCanvasViewModel = {
  viewport: { x: 900, y: -300, zoom: 0.1 },
  nodes: [{ id: 'task', kind: 'task', title: '客户反馈', position: { x: -300, y: 50 }, inputs: [], outputs: [], reference: 'task' }],
  edges: [],
}
const png = new Blob(['encoded PNG'], { type: 'image/png' })
const getInternalNode = vi.fn()
const instance = { getInternalNode } as unknown as ReactFlowInstance
const unmount = vi.fn()
const drawImage = vi.fn()
const fillRect = vi.fn()
const fillText = vi.fn()
const decodeSnapshot = vi.fn<() => Promise<void>>()
let nodeBounds: DOMRect
let edgeBounds: DOMRect
let mountImages: ((surface: HTMLElement) => void) | undefined
let encodingResults: (Blob | null)[]
let encodedSizes: { width: number; height: number; type?: string }[]
let canvases: HTMLCanvasElement[]
let snapshots: { src: string }[]
let allocationFailures: number
let context: CanvasRenderingContext2D

const svgUrl = (content: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg">${content}</svg>`)}`

beforeEach(() => {
  nodeBounds = new DOMRect(-300, 50, 320, 120)
  edgeBounds = new DOMRect(-380, -40, 800, 250)
  mountImages = undefined
  encodingResults = []
  encodedSizes = []
  canvases = []
  snapshots = []
  allocationFailures = 0
  getInternalNode.mockReset()
  unmount.mockClear()
  drawImage.mockReset()
  fillRect.mockClear()
  fillText.mockClear()
  decodeSnapshot.mockReset().mockResolvedValue()
  context = {
    fillStyle: '',
    fillRect,
    drawImage,
    fillText,
    isContextLost: () => false,
    save() {},
    restore() {},
    beginPath() {},
    fill() {},
    roundRect() {},
    clip() {},
    scale() {},
    stroke() {},
    moveTo() {},
    lineTo() {},
    measureText: (text: string) => ({ width: Array.from(text).length * 8 }),
  } as unknown as CanvasRenderingContext2D
  Object.defineProperty(document, 'fonts', { configurable: true, value: { status: 'loaded' } })
  vi.stubGlobal('devicePixelRatio', 4)
  vi.stubGlobal(
    'Image',
    class {
      src = ''
      decoding = ''
      decode = decodeSnapshot
      constructor() {
        snapshots.push(this)
      }
    },
  )
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    canvases.push(this)
    return allocationFailures-- > 0 ? null : (context as unknown as CanvasRenderingContext2D)
  })
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (this: HTMLCanvasElement, callback, type) {
    encodedSizes.push({ width: this.width, height: this.height, type })
    callback(encodingResults.length ? encodingResults.shift()! : png)
  })
  vi.mocked(toSvg).mockReset().mockResolvedValue(svgUrl('Rendered canvas 中文 🧩'))
  // Simulate native node measurement. Appearance and text clipping are verified in Lab.
  vi.mocked(createRoot).mockImplementation(
    (host) =>
      ({
        unmount,
        render(element) {
          let content = element as ReactElement
          while (!content.props.flowCanvasStore) content = content.props.children
          const canvas = content.props as FlowCanvasProps
          const store = canvas.flowCanvasStore
          store.onInit()
          canvas.onInit?.(instance)
          store.handleNodesChange(store.$.rfNodes.value.map((node) => ({ type: 'dimensions', id: node.id, dimensions: { width: 320, height: 120 } })))
          const surface = document.createElement('div')
          surface.className = 'react-flow'
          surface.style.backgroundColor = canvas.dark ? 'rgb(30, 30, 30)' : 'rgb(240, 240, 240)'
          surface.innerHTML = '<div class="react-flow__viewport"><div class="react-flow__node"></div><svg><path class="react-flow__edge-path" /></svg></div>'
          host.appendChild(surface)
          surface.querySelector('.react-flow__node')!.getBoundingClientRect = () => nodeBounds
          Object.assign(surface.querySelector('.react-flow__edge-path')!, { getBBox: () => edgeBounds })
          mountImages?.(surface.querySelector('.react-flow__viewport')!)
        },
      }) as ReturnType<typeof createRoot>,
  )
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  document.body.replaceChildren()
  Reflect.deleteProperty(document, 'fonts')
})

describe('canvas PNG export', () => {
  it.each([false, true])('retains padding around decorations outside the node box (frame=%s)', async (frame) => {
    nodeBounds = edgeBounds = new DOMRect(0, 0, 320, 120)
    mountImages = (viewport) => {
      const decoration = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      decoration.setAttribute('data-canvas-bounds', '')
      decoration.getBoundingClientRect = () => new DOMRect(-40, 25, 16, 16)
      viewport.append(decoration)
    }
    const result = await flowToPng(model, 'en', { frame })
    expect(result).toMatchObject(frame ? { width: 928, height: 512 } : { width: 976, height: 496 })
    expect(toSvg).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      expect.objectContaining({ style: expect.objectContaining({ transform: frame ? 'translate(72px, 32px)' : 'translate(104px, 64px)' }) }),
    )
  })

  it('includes the frame and workflow name in the bitmap and releases both decoded images', async () => {
    const result = await flowToPng(model, 'zh-CN', { frame: true, title: '客户反馈汇总' })
    expect(result).toMatchObject({ width: 1808, height: 772 })
    expect(fillText).toHaveBeenCalledWith('Open Flow', expect.any(Number), expect.any(Number))
    expect(fillText).toHaveBeenCalledWith('客户反馈汇总', expect.any(Number), expect.any(Number))
    expect(snapshots).toHaveLength(2)
    expect(snapshots.every((image) => image.src === '')).toBe(true)
    expect(canvases.every((canvas) => canvas.width === 0 && canvas.height === 0)).toBe(true)
  })

  it.each([false, true])('leaves the outside of the rounded frame transparent (dark=%s)', async (dark) => {
    await flowToPng(model, 'en', { frame: true, dark })
    expect(HTMLCanvasElement.prototype.getContext).toHaveBeenCalledWith('2d', { alpha: true })
    // Only the inset canvas receives a rectangular fill; the frame paints its own rounded shape.
    expect(fillRect).toHaveBeenCalledExactlyOnceWith(20, 52, 864, 314)
  })

  it('budgets the entire frame and halves it together with the graph on encoding failure', async () => {
    nodeBounds = edgeBounds = new DOMRect(0, 0, 20000, 5000)
    encodingResults = [null, png]
    const result = await flowToPng(model, 'en', { frame: true, title: 'Long title '.repeat(300) })
    expect(encodedSizes).toHaveLength(2)
    const initial = encodedSizes[0]!
    expect(initial.width).toBeLessThanOrEqual(16384)
    expect(initial.height).toBeLessThanOrEqual(16384)
    expect(initial.width * initial.height).toBeLessThanOrEqual(32_000_000)
    expect(result.width).toBe(Math.floor(initial.width / 2))
    expect(result.height).toBe(Math.floor(initial.height / 2))
    expect(result.width).toBeLessThan(20000)
    expect(fillText.mock.calls.filter(([text]) => text !== 'Open Flow').every(([text]) => String(text).endsWith('…'))).toBe(true)
    expect(toSvg).toHaveBeenCalledOnce()
    expect(canvases.every((canvas) => canvas.width === 0 && canvas.height === 0)).toBe(true)
  })

  it.each([false, true])('captures the full canvas and theme without changing its viewport (dark=%s)', async (dark) => {
    const snapshot = structuredClone(model)
    const result = await flowToPng(model, 'zh-CN', { dark })
    expect(model).toEqual(snapshot)
    expect(result).toEqual({ blob: png, width: 1856, height: 756, hasImagePlaceholders: false })
    expect(toSvg).toHaveBeenCalledWith(expect.any(HTMLElement), expect.objectContaining({ width: 928, height: 378 }))
    expect(decodeSnapshot).toHaveBeenCalledOnce()
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 1856, 756)
    expect(context.fillStyle).toBe(dark ? 'rgb(30, 30, 30)' : 'rgb(240, 240, 240)')
    expect(HTMLCanvasElement.prototype.getContext).toHaveBeenCalledWith('2d', { alpha: false })
    expect(encodedSizes).toEqual([{ width: 1856, height: 756, type: 'image/png' }])
    expect(unmount).toHaveBeenCalledOnce()
    expect(document.body.children).toHaveLength(0)
    expect(snapshots[0]!.src).toBe('')
    expect(canvases.every((canvas) => canvas.width === 0 && canvas.height === 0)).toBe(true)
  })

  it.each([
    [9000, 200, 16384, 364],
    [200, 9000, 364, 16384],
    [17000, 128, 16384, 123],
    [10000, 10000, 5656, 5656],
    [8000, 2000, 11313, 2828],
  ])('fits %s × %s into the single-edge and pixel budgets', async (width, height, expectedWidth, expectedHeight) => {
    nodeBounds = edgeBounds = new DOMRect(0, 0, width! - 128, height! - 128)
    const result = await flowToPng(model)
    expect(result).toMatchObject({ width: expectedWidth, height: expectedHeight })
    expect(result.width * result.height).toBeLessThanOrEqual(32_000_000)
    expect(Math.abs(result.width - (width! / height!) * result.height)).toBeLessThanOrEqual(1 + width! / height!)
  })

  it('reuses one snapshot and releases each failed bitmap before reducing resolution', async () => {
    encodingResults = [null, null, png]
    const result = await flowToPng(model)
    expect(result).toMatchObject({ blob: png, width: 464, height: 189 })
    expect(toSvg).toHaveBeenCalledOnce()
    expect(decodeSnapshot).toHaveBeenCalledOnce()
    expect(encodedSizes.map(({ width, height }) => [width, height])).toEqual([
      [1856, 756],
      [928, 378],
      [464, 189],
    ])
    expect(canvases.every((canvas) => canvas.width === 0 && canvas.height === 0)).toBe(true)
  })

  it('releases the live render surface before decoding and allocating the PNG', async () => {
    decodeSnapshot.mockImplementationOnce(async () => {
      expect(unmount).toHaveBeenCalledOnce()
      expect(document.body.children).toHaveLength(0)
      expect(canvases).toHaveLength(0)
    })
    await flowToPng(model)
  })

  it('also reduces resolution when a bitmap cannot be allocated', async () => {
    allocationFailures = 1
    expect(await flowToPng(model)).toMatchObject({ width: 928, height: 378 })
    expect(canvases).toHaveLength(2)
    expect(canvases.every((canvas) => canvas.width === 0 && canvas.height === 0)).toBe(true)
  })

  it('reduces resolution after a drawing failure', async () => {
    drawImage.mockImplementationOnce(() => {
      throw new Error('Bitmap unavailable')
    })
    expect(await flowToPng(model)).toMatchObject({ width: 928, height: 378 })
    expect(toSvg).toHaveBeenCalledOnce()
  })

  it('retries a lost canvas context instead of returning a blank image', async () => {
    context.isContextLost = vi.fn().mockReturnValueOnce(true).mockReturnValue(false)
    expect(await flowToPng(model)).toMatchObject({ width: 928, height: 378 })
    expect(canvases).toHaveLength(2)
  })

  it('stops after three failed sizes and releases the isolated canvas', async () => {
    encodingResults = [null, null, null]
    await expect(flowToPng(model)).rejects.toThrow('Unable to encode')
    expect(encodedSizes).toHaveLength(3)
    expect(canvases.every((canvas) => canvas.width === 0 && canvas.height === 0)).toBe(true)
    expect(snapshots[0]!.src).toBe('')
    expect(unmount).toHaveBeenCalledOnce()
    expect(document.body.children).toHaveLength(0)
  })

  it.each([false, true])('replaces a failed image and preserves its reserved dimensions (sized=%s)', async (sized) => {
    const image = document.createElement('img')
    image.src = 'https://example.com/unavailable.png'
    if (sized) {
      image.width = 300
      image.height = 180
    }
    const decode = vi.fn(async () => {
      expect(image.loading).toBe('eager')
      if (image.src.startsWith('https:')) throw new Error('Unavailable')
    })
    Object.assign(image, { decode })
    mountImages = (surface) => surface.append(image)
    expect(await flowToPng(model)).toMatchObject({ hasImagePlaceholders: true })
    expect(image.src).toMatch(/^data:image\/svg\+xml/)
    if (sized) {
      expect(image.width).toBe(300)
      expect(image.height).toBe(180)
    }
    const placeholder = new DOMParser().parseFromString(decodeURIComponent(image.src.slice(image.src.indexOf(',') + 1)), 'image/svg+xml')
    expect(placeholder.documentElement.getAttribute('width')).toBe('160')
    expect(placeholder.documentElement.getAttribute('height')).toBe('100')
    expect(decode).toHaveBeenCalledTimes(2)
  })

  it('waits for an image mounted after the original has failed', async () => {
    const original = document.createElement('img')
    const fallback = document.createElement('img')
    original.src = 'https://example.com/sprite.png'
    fallback.src = 'data:image/png;base64,fallback'
    Object.assign(original, {
      decode: vi.fn(async () => {
        queueMicrotask(() => original.replaceWith(fallback))
        throw new Error('Sprite failed')
      }),
    })
    const decode = vi.fn(async () => {})
    Object.assign(fallback, { decode })
    mountImages = (surface) => surface.append(original)
    expect(await flowToPng(model)).toMatchObject({ hasImagePlaceholders: false })
    expect(decode).toHaveBeenCalledOnce()
  })

  it('waits for an asynchronous icon fallback started by an image failure', async () => {
    const original = document.createElement('img')
    original.src = 'https://example.com/provider.png'
    Object.assign(original, {
      decode: vi.fn(async () => {
        const pending = document.createElement('i')
        pending.setAttribute('data-render-pending', '')
        original.replaceWith(pending)
        setTimeout(() => {
          pending.removeAttribute('data-render-pending')
          pending.textContent = 'Bundled fallback'
        }, 80)
        throw new Error('Provider failed')
      }),
    })
    mountImages = (surface) => surface.append(original)
    vi.mocked(toSvg).mockImplementation(async (node) => {
      expect(node.querySelector('[data-render-pending]')).toBeNull()
      expect(node.textContent).toContain('Bundled fallback')
      return svgUrl('Bundled fallback')
    })
    expect(await flowToPng(model)).toMatchObject({ hasImagePlaceholders: false })
  })

  it('reports placeholders discovered during cross-origin resource embedding', async () => {
    vi.mocked(toSvg).mockImplementation(async (_node, options) => svgUrl(`<image href="${options!.imagePlaceholder}"/>`))
    expect(await flowToPng(model)).toMatchObject({ hasImagePlaceholders: true })
  })

  it('releases the render surface when capture or SVG decoding fails', async () => {
    vi.mocked(toSvg).mockRejectedValueOnce(new Error('Capture unavailable'))
    await expect(flowToPng(model)).rejects.toThrow('Capture unavailable')
    expect(document.body.children).toHaveLength(0)
    decodeSnapshot.mockRejectedValueOnce(new Error('SVG unavailable'))
    await expect(flowToPng(model)).rejects.toThrow('SVG unavailable')
    expect(document.body.children).toHaveLength(0)
    expect(snapshots[0]!.src).toBe('')
  })

  it('downloads a PNG with a safe filename and releases its Blob URL', async () => {
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:sharing-png')
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe('订单_客户.png')
      expect(this.href).toBe('blob:sharing-png')
    })
    expect(await downloadFlowPng(model, '订单/客户', 'zh-CN')).toMatchObject({ blob: png })
    expect(create).toHaveBeenCalledWith(png)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(revoke).toHaveBeenCalledWith('blob:sharing-png')
    expect(document.body.children).toHaveLength(0)
  })

  it('also releases the download URL and link when triggering the download fails', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:failed-download')
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {
      throw new Error('Download unavailable')
    })
    await expect(downloadFlowPng(model, 'Workflow')).rejects.toThrow('Download unavailable')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(revoke).toHaveBeenCalledWith('blob:failed-download')
    expect(document.body.children).toHaveLength(0)
  })
})

it('arranges only the isolated vertical export when compact layout is requested', async () => {
  const input = { ...model, direction: 'vertical' as const }
  const before = structuredClone(input)
  const arrange = vi.spyOn(CanvasStore.prototype, 'compactForExport')
  await flowToPng(input, 'en', { layout: 'compact', frame: true })
  expect(arrange).toHaveBeenCalledExactlyOnceWith({ width: 104, height: 136 }, instance, 1)
  expect(input).toEqual(before)
  expect(toSvg).toHaveBeenCalledOnce()
  expect(unmount).toHaveBeenCalledOnce()
  expect(document.querySelector('[aria-hidden="true"]')).toBeNull()
})

it('preserves saved positions by default and with explicit original layout', async () => {
  const arrange = vi.spyOn(CanvasStore.prototype, 'compactForExport')
  await flowToPng(model)
  await flowToPng(model, 'en', { layout: 'original' })
  expect(arrange).not.toHaveBeenCalled()
})

it.each([undefined, 'horizontal'] as const)('preserves horizontal positions when compact layout is requested (%s)', async (direction) => {
  const input = { ...model, direction }
  const before = structuredClone(input)
  const arrange = vi.spyOn(CanvasStore.prototype, 'compactForExport')
  await flowToPng(input, 'en', { layout: 'compact', frame: true })
  expect(arrange).not.toHaveBeenCalled()
  expect(input).toEqual(before)
})

it.each(['1:1', '4:3', '3:4', '16:9', '9:16'] as const)('fits the complete image into %s without cropping content', async (aspectRatio) => {
  const [wide, high] = aspectRatio.split(':').map(Number)
  for (const frame of [false, true]) {
    vi.mocked(toSvg).mockClear()
    const result = await flowToPng(model, 'en', { aspectRatio, frame })
    expect(result.width * high!).toBe(result.height * wide!)
    const size = vi.mocked(toSvg).mock.calls[0]![1]!
    expect(size.width).toBeGreaterThanOrEqual(edgeBounds.width + (frame ? 64 : 128))
    expect(size.height).toBeGreaterThanOrEqual(edgeBounds.height + (frame ? 64 : 128))
    expect(result.width * result.height).toBeLessThanOrEqual(32_000_000)
  }
})

it('keeps the chosen ratio when downscaling and retrying bitmap allocation', async () => {
  nodeBounds = edgeBounds = new DOMRect(0, 0, 30000, 18000)
  allocationFailures = 1
  const result = await flowToPng(model, 'en', { aspectRatio: '16:9', frame: true })
  expect(result.width * 9).toBe(result.height * 16)
  expect(Math.max(result.width, result.height)).toBeLessThanOrEqual(16384)
  expect(result.width * result.height).toBeLessThanOrEqual(32_000_000)
  expect(canvases).toHaveLength(2)
})

it('uses the requested ratio to choose a compact layout', async () => {
  const arrange = vi.spyOn(CanvasStore.prototype, 'compactForExport')
  await flowToPng({ ...model, direction: 'vertical' }, 'en', { layout: 'compact', aspectRatio: '16:9', frame: true })
  expect(arrange).toHaveBeenCalledExactlyOnceWith({ width: 104, height: 136 }, instance, 16 / 9)
})

it('downloads a rendered preview without capturing or encoding it again', async () => {
  const result = { blob: png, width: 800, height: 450, hasImagePlaceholders: false }
  const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:preview')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  const trigger = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  downloadPng(result, '客户反馈')
  expect(create).toHaveBeenCalledWith(png)
  expect(trigger).toHaveBeenCalledOnce()
  expect(toSvg).not.toHaveBeenCalled()
  expect(encodedSizes).toHaveLength(0)
})
