import type { WorkbenchStore } from './stores/workbenchStore.ts'

import { val } from 'value-enhancer'
import { describe, expect, it, vi } from 'vitest'
import { NavigationStore } from './navigation.ts'

describe('NavigationStore', () => {
  it('replaces a missing Flow route with the Flow catalog', async () => {
    const flowId = val<string | undefined>('missing-flow')
    const store = {
      start: vi.fn(async () => flowId.set(undefined)),
      workspace: { $: { flowId } },
    } as unknown as WorkbenchStore
    const navigate = vi.fn()
    const navigation = new NavigationStore(store, { flowId: 'missing-flow', view: 'runs' }, navigate)

    try {
      await navigation.start()

      expect(navigate).toHaveBeenCalledWith({ flowId: undefined, view: 'design' }, { replace: true })
      expect(navigation.$.view.value).toBe('design')
    } finally {
      navigation.dispose()
      flowId.dispose()
    }
  })
})
