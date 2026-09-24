import type { WorkbenchStore } from './stores/workbenchStore.ts'

import { val } from 'value-enhancer'
import { describe, expect, it, vi } from 'vitest'
import { WorkbenchClient } from './api.ts'
import { NavigationStore } from './navigation.ts'
import { RunStore } from './runs/runStore.ts'

describe('NavigationStore', () => {
  it('marks the workbench ready only after startup completes', async () => {
    const loading = Promise.withResolvers<void>()
    const flowId = val<string | undefined>(undefined)
    const store = {
      start: vi.fn(() => loading.promise),
      workspace: { $: { flowId } },
    } as unknown as WorkbenchStore
    const navigation = new NavigationStore(store, { view: 'design' }, vi.fn())

    try {
      const start = navigation.start()
      expect(navigation.$.ready.value).toBe(false)
      loading.resolve()
      await start
      expect(navigation.$.ready.value).toBe(true)
    } finally {
      navigation.dispose()
      flowId.dispose()
    }
  })

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

it('restores, changes and clears the Run source through navigation', async () => {
  const flowId = val<string | undefined>('flow')
  const request = vi.fn(async (_path: string) => Response.json({ flowId: 'flow', runs: [], version: 1 }))
  const runs = new RunStore(new WorkbenchClient(request), vi.fn())
  const store = { start: vi.fn(async () => {}), runs, workspace: { $: { flowId } } } as unknown as WorkbenchStore
  const navigate = vi.fn()
  const navigation = new NavigationStore(store, { flowId: 'flow', view: 'runs', runSource: 'live' }, navigate)
  try {
    await navigation.start()
    expect(navigation.runSource).toBe('live')
    expect(navigate).not.toHaveBeenCalled()
    await runs.load('flow', { source: navigation.runSource })
    await runs.applyFilter({ source: 'live', status: 'failed' })
    request.mockClear()

    navigation.open('runs', 'draft')
    expect(navigate).toHaveBeenLastCalledWith({ flowId: 'flow', view: 'runs', runSource: 'draft' }, { replace: false })
    expect(navigation.runSource).toBe('draft')
    expect(runs.$.filter.value).toEqual({ source: 'draft', status: 'failed' })
    expect(request).toHaveBeenCalledOnce()

    navigate.mockClear()
    request.mockClear()
    await navigation.apply({ flowId: 'flow', view: 'runs', runSource: 'live' })
    expect(navigation.runSource).toBe('live')
    expect(navigate).not.toHaveBeenCalled()
    expect(runs.$.filter.value).toEqual({ source: 'live', status: 'failed' })
    expect(request).toHaveBeenCalledOnce()

    navigation.open('runs')
    expect(navigation.runSource).toBeUndefined()
    expect(navigate).toHaveBeenLastCalledWith({ flowId: 'flow', view: 'runs' }, { replace: false })
    await runs.applyFilter({ source: 'live', status: 'failed' })
    request.mockClear()
    navigation.open('runs', 'live')
    expect(request).not.toHaveBeenCalled()
    navigation.open('design')
    expect(navigation.runSource).toBeUndefined()
    expect(navigate).toHaveBeenLastCalledWith({ flowId: 'flow', view: 'design' }, { replace: false })
  } finally {
    navigation.dispose()
    runs.dispose()
    flowId.dispose()
  }
})
