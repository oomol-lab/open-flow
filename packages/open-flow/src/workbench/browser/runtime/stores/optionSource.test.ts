import type { ResourceState } from './resource.ts'

import { val } from 'value-enhancer'
import { describe, expect, it } from 'vitest'
import { combineSources } from './optionSource.ts'

describe('combined option sources', () => {
  it('shows cached triggers while actions are pending, then appends actions', () => {
    const controller = new AbortController()
    const triggers = val<ResourceState<readonly string[]>>({ data: ['trigger'], refreshing: false, error: undefined })
    const actions = val<ResourceState<readonly string[]>>({ data: undefined, refreshing: false, error: undefined })
    const combined = combineSources(controller.signal, [triggers, actions])
    try {
      expect(combined.value).toEqual({ data: ['trigger'], refreshing: true, error: undefined })
      actions.set({ data: ['action'], refreshing: false, error: undefined })
      expect(combined.value).toEqual({ data: ['trigger', 'action'], refreshing: false, error: undefined })
      expect(triggers.value.data).toEqual(['trigger'])
    } finally {
      controller.abort()
      triggers.dispose()
      actions.dispose()
    }
  })

  it('keeps available results on failure and stops loading after every source settles', () => {
    const controller = new AbortController()
    const triggers = val<ResourceState<readonly string[]>>({ data: ['trigger'], refreshing: false, error: undefined })
    const actions = val<ResourceState<readonly string[]>>({ data: undefined, refreshing: true, error: undefined })
    const combined = combineSources(controller.signal, [triggers, actions])
    try {
      const error = new Error('Search failed')
      actions.set({ data: undefined, refreshing: false, error })
      expect(combined.value).toEqual({ data: ['trigger'], refreshing: false, error })
      actions.set({ data: undefined, refreshing: true, error: undefined })
      expect(combined.value.data).toEqual(['trigger'])
      actions.set({ data: [], refreshing: false, error: undefined })
      triggers.set({ data: [], refreshing: false, error: undefined })
      expect(combined.value).toEqual({ data: [], refreshing: false, error: undefined })
    } finally {
      controller.abort()
      triggers.dispose()
      actions.dispose()
    }
  })
})
