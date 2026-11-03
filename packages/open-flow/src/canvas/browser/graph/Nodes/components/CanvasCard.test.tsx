// @vitest-environment happy-dom
import type { ComponentProps } from 'react'
import type { Root } from 'react-dom/client'
import type { FlowCanvasViewNodeRun } from '../../FlowCanvas/model.ts'

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { I18nProvider } from 'val-i18n-react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TooltipProvider } from '../../../../../ui/browser/tooltip.tsx'
import { createI18n } from '../../../i18n/i18n-loader.ts'
import { CanvasCard } from './CanvasCard.tsx'

const i18n = createI18n('en')
const completed: FlowCanvasViewNodeRun = {
  status: 'success',
  outputs: { recordId: 'saved-record' },
  logs: [{ time: '2026-11-03T02:00:00.000Z', level: 'info', message: 'Saved the record.' }],
}
const failed: FlowCanvasViewNodeRun = { ...completed, status: 'error', error: { message: 'The retry failed.' } }
let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

async function render(props: Partial<ComponentProps<typeof CanvasCard>> = {}) {
  await act(async () =>
    root.render(
      <I18nProvider i18n={i18n}>
        <TooltipProvider>
          <CanvasCard title="Save result" {...props} />
        </TooltipProvider>
      </I18nProvider>,
    ),
  )
}

function buttons(region: 'header' | 'footer' = 'header'): string[] {
  return Array.from(container.querySelectorAll(`${region} button`), (button) => button.getAttribute('aria-label') ?? button.textContent ?? '')
}

function imageLabels(): string[] {
  return Array.from(container.querySelectorAll('[role="img"]'), (image) => image.getAttribute('aria-label') ?? '')
}

it('replaces completed status with failed status while retaining result and log controls', async () => {
  const records = [i18n.t('canvasCard.result'), i18n.t('canvasCard.logs', { count: 1 })]
  await render({ run: completed })
  expect(buttons()).toEqual([i18n.t('canvasCard.status.success'), ...records])

  await render({ run: failed })
  expect(buttons()).toEqual([i18n.t('canvasCard.status.error'), ...records])
  expect(imageLabels()).toEqual([])
})

it('shows a node diagnostic separately from the retained run outcome', async () => {
  await render({ diagnostic: { message: 'Reconnect the Provider.' }, run: failed })
  expect(imageLabels()).toEqual(['Reconnect the Provider.'])
  expect(buttons()).toEqual([])
})

it('keeps header records available when node content is collapsed', async () => {
  await render({ contentHidden: true, run: failed, children: 'Hidden description' })
  expect(buttons()).toEqual([i18n.t('canvasCard.status.error'), i18n.t('canvasCard.result'), i18n.t('canvasCard.logs', { count: 1 })])
  expect(container.querySelector('footer')).toBeNull()
})

it('shows only failed status when there are no result or log records', async () => {
  await render({ run: { status: 'error' } })
  expect(buttons()).toEqual([i18n.t('canvasCard.status.error')])
})

it('keeps a null result distinct from an absent result and omits empty logs', async () => {
  await render({ run: { status: 'error', outputs: null, logs: [] } })
  expect(buttons()).toEqual([i18n.t('canvasCard.status.error'), i18n.t('canvasCard.result')])
})

it('shows available data records independently of an idle run status', async () => {
  await render({ run: { ...completed, status: 'idle' } })
  expect(buttons()).toEqual([i18n.t('canvasCard.result'), i18n.t('canvasCard.logs', { count: 1 })])
})

it('omits idle status when there are no records', async () => {
  await render({ run: { status: 'idle' } })
  expect(buttons()).toEqual([])
  expect(imageLabels()).toEqual([])
})

it('uses the execution outcome in compact view unless a node diagnostic takes priority', async () => {
  await render({ compact: true, run: failed })
  expect(imageLabels()).toEqual([i18n.t('canvasCard.status.error')])

  await render({ compact: true, run: failed, diagnostic: { message: 'Reconnect the Provider.' } })
  expect(imageLabels()).toContain('Reconnect the Provider.')
  expect(imageLabels()).not.toContain(i18n.t('canvasCard.status.error'))
})
