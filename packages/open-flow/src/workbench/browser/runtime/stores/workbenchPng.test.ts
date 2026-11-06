import type { FlowPngResult } from '../../../../canvas/browser/graph/FlowCanvas/exportPng.ts'

import { expect, it, vi } from 'vitest'
import { downloadPng } from '../../../../canvas/browser/graph/FlowCanvas/exportPng.ts'
import { WorkbenchClient } from '../api.ts'
import { WorkbenchStore } from './workbenchStore.ts'

vi.mock('../../../../canvas/browser/graph/FlowCanvas/exportPng.ts', () => ({ downloadPng: vi.fn() }))

it.each(['complete', 'partial', 'failed'])('downloads the prepared PNG and reports its outcome (%s)', async (outcome) => {
  const result: FlowPngResult = { blob: new Blob([], { type: 'image/png' }), width: 640, height: 240, hasImagePlaceholders: outcome === 'partial' }
  vi.mocked(downloadPng)
    .mockReset()
    .mockImplementation(() => {
      if (outcome === 'failed') throw new Error('Download failed')
    })
  const store = new WorkbenchStore(new WorkbenchClient(vi.fn()), { getItem: () => null, setItem: () => {} })
  try {
    expect(await store.downloadPng(result)).toBe(outcome !== 'failed')
    expect(downloadPng).toHaveBeenCalledExactlyOnceWith(result, 'Workflow')
    expect(store.$.notice.value).toEqual(
      outcome === 'failed'
        ? { kind: 'error', message: 'Could not export the PNG image. Please try again.' }
        : { kind: 'success', message: outcome === 'partial' ? 'PNG image exported. Some images were replaced with placeholders.' : 'PNG image exported.' },
    )
  } finally {
    store.dispose()
  }
})
