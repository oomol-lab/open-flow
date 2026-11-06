// @vitest-environment happy-dom
import type { FlowPngResult } from '../../../../canvas/browser/graph/FlowCanvas/exportPng.ts'
import type { PngExportSettings } from './pngExportDialog.tsx'

import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { click, render } from '../../../../../test/support/render.tsx'
import { PngExportDialog } from './pngExportDialog.tsx'
import {
  pngExportAspectRatioPreferenceKey,
  pngExportLayoutPreferenceKey,
  pngExportThemePreferenceKey,
  pngExportFramePreferenceKey,
} from './pngExportPreference.ts'

const image: FlowPngResult = { blob: new Blob(['preview'], { type: 'image/png' }), width: 1600, height: 900, hasImagePlaceholders: false }

beforeEach(() => {
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:png-preview')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

async function previewTick() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 240))
  })
}

function button(name: string): HTMLButtonElement {
  return [...document.querySelectorAll<HTMLButtonElement>('button')].find((element) => element.textContent === name)!
}

function panel(
  options: { direction?: 'vertical' | 'horizontal'; saved?: Map<string, string>; render?: (settings: PngExportSettings) => Promise<FlowPngResult> } = {},
) {
  const saved = options.saved ?? new Map<string, string>()
  const preferences = { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => saved.set(key, value) }
  const capture = options.render ?? vi.fn(async () => image)
  const onDownload = vi.fn(async () => true)
  const onOpenChange = vi.fn()
  const props = {
    defaultDark: false,
    direction: options.direction ?? 'vertical',
    onDownload,
    onOpenChange,
    open: true,
    preferences,
    render: capture,
    title: 'Workflow',
  } as const
  const view = render(<PngExportDialog {...props} />)
  return { ...view, capture, onDownload, onOpenChange, saved, props }
}

describe('PNG export panel', () => {
  it('previews the selected settings and downloads the exact rendered image once', async () => {
    const view = panel()
    expect(button('Download PNG').disabled).toBe(true)
    await previewTick()
    expect(view.capture).toHaveBeenCalledExactlyOnceWith({ aspectRatio: 'auto', dark: false, frame: true, layout: 'original', title: 'Workflow' })
    expect(document.querySelector('output')!.textContent).toBe('1600 × 900 px')
    expect(document.querySelector('img')!.src).toBe('blob:png-preview')
    await click(button('Download PNG'))
    expect(view.onDownload).toHaveBeenCalledExactlyOnceWith(image)
    expect(view.onOpenChange).toHaveBeenCalledExactlyOnceWith(false)
    expect(view.capture).toHaveBeenCalledOnce()
    view.unmount()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:png-preview')
  })

  it('restores ratio, layout, theme and frame preferences', async () => {
    const view = panel()
    await click(button('16:9'))
    await click(button('Compact layout'))
    await click(button('Dark'))
    await click(document.querySelector<HTMLElement>('[role="checkbox"]')!)
    await previewTick()
    expect(view.capture).toHaveBeenLastCalledWith({ aspectRatio: '16:9', dark: true, frame: false, layout: 'compact', title: 'Workflow' })
    expect(view.saved.get(pngExportAspectRatioPreferenceKey)).toBe('16:9')
    expect(view.saved.get(pngExportLayoutPreferenceKey)).toBe('compact')
    expect(view.saved.get(pngExportThemePreferenceKey)).toBe('dark')
    expect(view.saved.get(pngExportFramePreferenceKey)).toBe('false')
    view.unmount()
    const next = panel({ saved: view.saved })
    await previewTick()
    expect(next.capture).toHaveBeenCalledExactlyOnceWith({ aspectRatio: '16:9', dark: true, frame: false, layout: 'compact', title: 'Workflow' })
  })

  it.each([false, true])('keeps the horizontal layout original while choosing a theme (dark=%s)', async (dark) => {
    const view = panel({ direction: 'horizontal', saved: new Map([[pngExportLayoutPreferenceKey, 'compact']]) })
    expect(button('Compact layout')).toBeUndefined()
    await click(button(dark ? 'Dark' : 'Light'))
    await previewTick()
    expect(view.capture).toHaveBeenLastCalledWith({ aspectRatio: 'auto', dark, frame: true, layout: 'original', title: 'Workflow' })
    expect(view.saved.get(pngExportLayoutPreferenceKey)).toBe('compact')
  })

  it('serializes captures, skips obsolete choices and never downloads a stale preview', async () => {
    let finish!: (result: FlowPngResult) => void
    const pending = new Promise<FlowPngResult>((resolve) => {
      finish = resolve
    })
    const capture = vi.fn<(settings: PngExportSettings) => Promise<FlowPngResult>>().mockReturnValueOnce(pending).mockResolvedValue(image)
    const view = panel({ render: capture })
    await previewTick()
    expect(capture).toHaveBeenCalledOnce()
    await click(button('16:9'))
    await previewTick()
    expect(capture).toHaveBeenCalledOnce()
    await click(button('Dark'))
    await previewTick()
    expect(button('Download PNG').disabled).toBe(true)
    await act(async () => finish({ ...image, width: 100, height: 100 }))
    expect(capture).toHaveBeenCalledTimes(2)
    expect(capture).toHaveBeenLastCalledWith({ aspectRatio: '16:9', dark: true, frame: true, layout: 'original', title: 'Workflow' })
    expect(URL.createObjectURL).toHaveBeenCalledExactlyOnceWith(image.blob)
    expect(button('Download PNG').disabled).toBe(false)
    await click(button('Download PNG'))
    expect(view.onDownload).toHaveBeenCalledExactlyOnceWith(image)
  })

  it('retries preview failures and keeps a failed download available for another attempt', async () => {
    const capture = vi.fn().mockRejectedValueOnce(new Error('Capture failed')).mockResolvedValue(image)
    const view = panel({ render: capture })
    await previewTick()
    expect(document.querySelector('[role="alert"]')!.textContent).toContain('Could not generate')
    expect(button('Download PNG').disabled).toBe(true)
    await click(button('Retry'))
    await previewTick()
    expect(button('Download PNG').disabled).toBe(false)
    view.onDownload.mockResolvedValueOnce(false)
    await click(button('Download PNG'))
    expect(view.onOpenChange).not.toHaveBeenCalled()
    expect(button('Download PNG').disabled).toBe(false)
    await click(button('Download PNG'))
    expect(view.onOpenChange).toHaveBeenCalledWith(false)
    expect(capture).toHaveBeenCalledTimes(2)
  })

  it('discards an unfinished capture when the panel closes', async () => {
    let finish!: (result: FlowPngResult) => void
    const capture = vi.fn(
      () =>
        new Promise<FlowPngResult>((resolve) => {
          finish = resolve
        }),
    )
    const view = panel({ render: capture })
    await previewTick()
    view.rerender(<PngExportDialog {...view.props} open={false} />)
    await act(async () => finish(image))
    expect(URL.createObjectURL).not.toHaveBeenCalled()
    expect(view.onDownload).not.toHaveBeenCalled()
  })
})
