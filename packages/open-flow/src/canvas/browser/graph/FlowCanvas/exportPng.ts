import type { FlowCanvasViewModel } from './model.ts'

import { toSvg } from 'html-to-image'
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { IconImageCrossOriginContext } from '../../../../ui/browser/icons/ContentIcon.tsx'
import { IconifyProvider } from '../../../../ui/browser/icons/iconifyContext.tsx'
import { openFlowLogoSource } from '../../../../ui/browser/logo.tsx'
import { CanvasStore } from '../../stores/canvas/canvas.store.ts'
import { FlowCanvas } from './FlowCanvas.tsx'

export interface FlowPngOptions {
  readonly dark?: boolean
  readonly frame?: boolean
  readonly title?: string
  readonly ignoredNodeIds?: readonly string[]
}

export interface FlowPngResult {
  readonly blob: Blob
  readonly width: number
  readonly height: number
  readonly hasImagePlaceholders: boolean
}

const padding = 64
const maximumDimension = 16384
const maximumPixels = 32_000_000
const framePadding = 12
const frameHeaderHeight = 40
const frameTitleInset = 20
const frameInset = 8
const frameRadius = 16

interface ImageFrame {
  readonly title: string
  readonly logo: string
  readonly background: string
  readonly outerBackground: string
  readonly foreground: string
  readonly border: string
  readonly fontFamily: string
}

function drawFrame(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  logo: HTMLImageElement,
  width: number,
  height: number,
  background: string,
  frame: ImageFrame,
) {
  const x = framePadding
  const y = framePadding
  const frameWidth = width - framePadding * 2
  const frameHeight = height - framePadding * 2
  const contentX = x + frameInset
  const contentY = y + frameHeaderHeight
  const contentWidth = frameWidth - frameInset * 2
  const contentHeight = frameHeight - frameHeaderHeight - frameInset
  context.save()
  context.fillStyle = frame.background
  context.beginPath()
  context.roundRect(x, y, frameWidth, frameHeight, frameRadius)
  context.fill()
  context.save()
  context.beginPath()
  // Concentric corners keep the surrounding frame visually even on every side.
  context.roundRect(contentX, contentY, contentWidth, contentHeight, frameRadius - frameInset)
  context.clip()
  context.fillStyle = background
  context.fillRect(contentX, contentY, contentWidth, contentHeight)
  context.drawImage(image, contentX, contentY, contentWidth, contentHeight)
  context.restore()
  context.strokeStyle = frame.border
  context.beginPath()
  context.roundRect(contentX + 0.5, contentY + 0.5, contentWidth - 1, contentHeight - 1, frameRadius - frameInset - 0.5)
  context.stroke()
  context.drawImage(logo, x + 12, y + 10, 20, 20)
  context.fillStyle = frame.foreground
  context.textBaseline = 'middle'
  context.font = `600 14px ${frame.fontFamily}`
  const wordmarkX = x + 40
  context.fillText('Open Flow', wordmarkX, y + frameHeaderHeight / 2)
  const availableWidth = x + frameWidth - frameTitleInset - (wordmarkX + context.measureText('Open Flow').width + 24)
  context.font = `400 12px ${frame.fontFamily}`
  if (availableWidth > 0) {
    let title = frame.title.replace(/\s+/g, ' ')
    if (context.measureText(title).width > availableWidth) {
      const characters = Array.from(title)
      while (characters.length && context.measureText(characters.join('') + '…').width > availableWidth) characters.pop()
      title = characters.join('') + '…'
    }
    context.textAlign = 'right'
    context.fillText(title, x + frameWidth - frameTitleInset, y + frameHeaderHeight / 2)
  }
  context.strokeStyle = frame.border
  context.beginPath()
  context.roundRect(x + 0.5, y + 0.5, frameWidth - 1, frameHeight - 1, frameRadius - 0.5)
  context.stroke()
  context.restore()
}
// Keep this neutral and language-independent: html-to-image caches resource fallbacks by URL.
const imagePlaceholder =
  'data:image/svg+xml;charset=utf-8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="100" viewBox="0 0 160 100"><rect width="160" height="100" rx="6" fill="#eeeeee"/><text x="80" y="50" text-anchor="middle" dominant-baseline="central" font-family="sans-serif" font-size="24" fill="#777777">?</text></svg>',
  )
const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

async function waitFor(ready: () => boolean, deadline: number): Promise<void> {
  while (!ready()) {
    if (performance.now() > deadline) throw new Error('Timed out rendering the workflow image.')
    await nextFrame()
  }
}

async function decodeImage(image: HTMLImageElement, timeout: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      image.decode().then(
        () => true,
        () => false,
      ),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), Math.max(0, timeout))
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

/** Image failures can mount another image or start loading a bundled fallback icon. */
async function prepareImages(host: HTMLElement, deadline: number): Promise<boolean> {
  let hasImagePlaceholders = false
  while (true) {
    for (const image of host.querySelectorAll('img')) image.loading = 'eager'
    await waitFor(() => host.querySelector('[data-render-pending]') == null, deadline)
    const images = [...host.querySelectorAll('img')].map((image) => ({ image, source: image.src }))
    const decoded = await Promise.all(
      images.map(({ image }) => {
        image.loading = 'eager'
        return decodeImage(image, Math.min(5000, deadline - performance.now()))
      }),
    )
    // Flush React's error handlers before deciding whether the failed image needs a placeholder.
    await nextFrame()
    await nextFrame()
    let replaced = false
    images.forEach(({ image, source }, index) => {
      if (decoded[index] || !host.contains(image) || image.src !== source) return
      if (source === imagePlaceholder) throw new Error('Unable to load the image placeholder.')
      // Retain authored dimensions. An unsized broken image must use the placeholder's
      // intrinsic 160 × 100, rather than freezing the browser's broken-image/alt-text box.
      image.removeAttribute('srcset')
      image.src = imagePlaceholder
      hasImagePlaceholders = replaced = true
    })
    const current = [...host.querySelectorAll('img')]
    if (
      !replaced &&
      host.querySelector('[data-render-pending]') == null &&
      current.length === images.length &&
      current.every((image, index) => image === images[index]!.image && image.src === images[index]!.source)
    )
      return hasImagePlaceholders
    if (performance.now() > deadline) throw new Error('Timed out preparing workflow images.')
  }
}

async function renderPng(
  dataUrl: string,
  width: number,
  height: number,
  background: string,
  frame?: ImageFrame,
): Promise<Omit<FlowPngResult, 'hasImagePlaceholders'>> {
  const ratio = Math.min(2, maximumDimension / width, maximumDimension / height, Math.sqrt(maximumPixels / (width * height)))
  let outputWidth = Math.max(1, Math.floor(width * ratio))
  let outputHeight = Math.max(1, Math.floor(height * ratio))
  const image = new Image()
  const logo = frame ? new Image() : undefined
  image.decoding = 'async'
  image.src = dataUrl
  try {
    await image.decode()
    if (logo && frame) {
      logo.src = frame.logo
      await logo.decode()
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      const canvas = document.createElement('canvas')
      try {
        canvas.width = outputWidth
        canvas.height = outputHeight
        const context = canvas.getContext('2d', { alpha: false })
        if (!context) throw new Error('Unable to allocate the workflow image.')
        context.fillStyle = frame?.outerBackground ?? background
        context.fillRect(0, 0, outputWidth, outputHeight)
        if (frame && logo) {
          context.scale(outputWidth / width, outputHeight / height)
          drawFrame(context, image, logo, width, height, background, frame)
        } else context.drawImage(image, 0, 0, outputWidth, outputHeight)
        if (context.isContextLost?.()) throw new Error('The workflow image context was lost.')
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
        if (!blob || context.isContextLost?.()) throw new Error('Unable to encode the workflow image.')
        return { blob, width: outputWidth, height: outputHeight }
      } catch (error) {
        if (attempt === 2 || (outputWidth === 1 && outputHeight === 1)) throw error
        outputWidth = Math.max(1, Math.floor(outputWidth / 2))
        outputHeight = Math.max(1, Math.floor(outputHeight / 2))
      } finally {
        // Release the bitmap before allocating another size or returning its encoded Blob.
        canvas.width = canvas.height = 0
      }
    }
    throw new Error('Unable to render the workflow image.')
  } finally {
    image.src = ''
    if (logo) logo.src = ''
  }
}

/** Render the real canvas at full detail without moving or changing the user's canvas. */
async function captureFlowImage(model: FlowCanvasViewModel, language: string, options: FlowPngOptions) {
  const contentPadding = options.frame ? padding / 2 : padding
  const positions = model.nodes.map((node) => node.position)
  const minX = Math.min(0, ...positions.map((position) => position.x))
  const minY = Math.min(0, ...positions.map((position) => position.y))
  const snapshot = { ...model, viewport: { x: contentPadding - minX, y: contentPadding - minY, zoom: 1 } }
  const host = document.createElement('div')
  host.lang = language
  // Every node starts inside this viewport, so off-screen placeholders never replace its content.
  Object.assign(host.style, {
    position: 'fixed',
    left: '-100000px',
    top: '0',
    pointerEvents: 'none',
    width: `${Math.max(0, ...positions.map((position) => position.x)) - minX + 1000}px`,
    height: `${Math.max(0, ...positions.map((position) => position.y)) - minY + 1000}px`,
  })
  host.inert = true
  host.setAttribute('aria-hidden', 'true')
  document.body.append(host)
  const root = createRoot(host)
  const store = new CanvasStore(snapshot, false, language, { onMoveNodes: () => {}, onChangeComment: () => {} })
  store.reconcile(snapshot, false, language, [], options.ignoredNodeIds ?? [])
  try {
    root.render(
      createElement(
        IconifyProvider,
        null,
        createElement(
          IconImageCrossOriginContext.Provider,
          { value: 'anonymous' },
          createElement(FlowCanvas, {
            flowCanvasStore: store,
            dark: options.dark ?? false,
            fitView: false,
            layoutMotion: false,
            nodesDraggable: false,
          }),
        ),
      ),
    )
    const deadline = performance.now() + 15000
    await waitFor(() => store.$.initialized.value && store.$.rfNodes.value.every((node) => !!node.measured?.width && !!node.measured.height), deadline)
    let hasImagePlaceholders = await prepareImages(host, deadline)
    await waitFor(() => document.fonts.status === 'loaded', deadline)
    const viewport = host.querySelector<HTMLElement>('.react-flow__viewport')!
    const origin = viewport.getBoundingClientRect()
    // Node-owned decorations can protrude outside React Flow's layout boxes.
    const bounds = [...viewport.querySelectorAll('.react-flow__node, [data-canvas-bounds]')].map((node) => {
      const rect = node.getBoundingClientRect()
      return { x: rect.left - origin.left, y: rect.top - origin.top, width: rect.width, height: rect.height }
    })
    // Include wrapped and backward connections, which can extend past node bounds.
    for (const edge of viewport.querySelectorAll<SVGGraphicsElement>('.react-flow__edge-path')) bounds.push(edge.getBBox())
    const left = bounds.length ? Math.min(...bounds.map((rect) => rect.x)) : 0
    const top = bounds.length ? Math.min(...bounds.map((rect) => rect.y)) : 0
    const right = bounds.length ? Math.max(...bounds.map((rect) => rect.x + rect.width)) : 320
    const bottom = bounds.length ? Math.max(...bounds.map((rect) => rect.y + rect.height)) : 120
    const width = Math.ceil(right - left + contentPadding * 2)
    const height = Math.ceil(bottom - top + contentPadding * 2)
    const background = getComputedStyle(host.querySelector('.react-flow')!).backgroundColor
    const dataUrl = await toSvg(viewport, {
      width,
      height,
      imagePlaceholder,
      preferredFontFormat: 'woff2',
      includeQueryParams: true,
      style: { transform: `translate(${contentPadding - left}px, ${contentPadding - top}px)`, transformOrigin: '0 0' },
    })
    // Includes failures discovered only when html-to-image fetches cross-origin resources.
    hasImagePlaceholders ||= dataUrl.includes(encodeURIComponent(imagePlaceholder))
    let frame: ImageFrame | undefined
    if (options.frame) {
      const palette = document.createElement('div')
      palette.className = 'open-flow-theme'
      palette.dataset.theme = options.dark ? 'dark' : 'light'
      Object.assign(palette.style, { backgroundColor: 'var(--ui-background)', color: 'var(--ui-foreground)', borderColor: 'var(--ui-border)' })
      host.append(palette)
      const style = getComputedStyle(palette)
      const outerBackground = style.backgroundColor
      if (options.dark) palette.style.backgroundColor = 'var(--ui-card)'
      frame = {
        title: options.title ?? '',
        logo: openFlowLogoSource(options.dark ? 'dark' : 'light'),
        background: getComputedStyle(palette).backgroundColor,
        outerBackground,
        foreground: style.color,
        border: style.borderColor,
        fontFamily: getComputedStyle(viewport).fontFamily || 'sans-serif',
      }
    }
    return {
      dataUrl,
      width: width + (frame ? framePadding * 2 + frameInset * 2 : 0),
      height: height + (frame ? framePadding * 2 + frameHeaderHeight + frameInset : 0),
      background,
      frame,
      hasImagePlaceholders,
    }
  } finally {
    root.unmount()
    store.dispose()
    host.remove()
  }
}

export async function flowToPng(model: FlowCanvasViewModel, language = 'en', options: FlowPngOptions = {}): Promise<FlowPngResult> {
  // Release the live canvas and its stores before allocating the output bitmap.
  const { dataUrl, width, height, background, frame, hasImagePlaceholders } = await captureFlowImage(model, language, options)
  return { ...(await renderPng(dataUrl, width, height, background, frame)), hasImagePlaceholders }
}

export async function downloadFlowPng(model: FlowCanvasViewModel, title: string, language = 'en', options: FlowPngOptions = {}): Promise<FlowPngResult> {
  const result = await flowToPng(model, language, { ...options, title })
  const url = URL.createObjectURL(result.blob)
  const link = document.createElement('a')
  try {
    // oxlint-disable-next-line no-control-regex
    link.download = `${title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/g, '') || 'workflow'}.png`
    link.href = url
    document.body.append(link)
    link.click()
  } finally {
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }
  return result
}
