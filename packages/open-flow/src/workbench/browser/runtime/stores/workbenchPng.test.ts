import type { FlowPngResult } from '../../../../canvas/browser/graph/FlowCanvas/exportPng.ts'

import { expect, it, vi } from 'vitest'
import { downloadFlowPng } from '../../../../canvas/browser/graph/FlowCanvas/exportPng.ts'
import { WorkbenchClient } from '../api.ts'
import { WorkbenchStore } from './workbenchStore.ts'

vi.mock('../../../../canvas/browser/graph/FlowCanvas/exportPng.ts', () => ({ downloadFlowPng: vi.fn() }))

it.each(['complete', 'partial', 'failed'])('reports the PNG export result after completion (%s)', async (outcome) => {
  let finish!: () => void
  const pending = new Promise<FlowPngResult>((resolve, reject) => {
    finish = () =>
      outcome === 'failed'
        ? reject(new Error('Export failed'))
        : resolve({ blob: new Blob([], { type: 'image/png' }), width: 640, height: 240, hasImagePlaceholders: outcome === 'partial' })
  })
  vi.mocked(downloadFlowPng).mockClear().mockReturnValueOnce(pending)
  const store = new WorkbenchStore(new WorkbenchClient(vi.fn()), { getItem: () => null, setItem: () => {} })
  try {
    const exporting = store.exportPng('en', { dark: true })
    await vi.waitFor(() => expect(downloadFlowPng).toHaveBeenCalledTimes(1))
    expect(store.$.notice.value).toBeUndefined()
    finish()
    await exporting
    expect(store.$.notice.value).toEqual(
      outcome === 'failed'
        ? { kind: 'error', message: 'Could not export the PNG image. Please try again.' }
        : { kind: 'success', message: outcome === 'partial' ? 'PNG image exported. Some images were replaced with placeholders.' : 'PNG image exported.' },
    )
  } finally {
    store.dispose()
  }
})
