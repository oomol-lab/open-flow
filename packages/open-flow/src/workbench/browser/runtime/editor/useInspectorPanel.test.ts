import { beforeEach, describe, expect, it, vi } from 'vitest'
import { inspectorPreferenceKey, readInspectorOpen, useInspectorPanel, writeInspectorOpen } from './useInspectorPanel.ts'

const hooks = vi.hoisted(() => ({ cursor: 0, values: [] as unknown[], effects: [] as (() => void)[] }))
vi.mock('react', () => ({
  useState: (initial: unknown) => {
    const index = hooks.cursor++
    if (!(index in hooks.values)) hooks.values[index] = typeof initial === 'function' ? initial() : initial
    return [
      hooks.values[index],
      (next: unknown) => {
        hooks.values[index] = next
      },
    ]
  },
  useRef: (initial: unknown) => {
    const index = hooks.cursor++
    if (!(index in hooks.values)) hooks.values[index] = { current: initial }
    return hooks.values[index]
  },
  useEffect: (effect: () => void, dependencies: unknown[]) => {
    const index = hooks.cursor++
    const previous = hooks.values[index] as unknown[] | undefined
    if (!previous || dependencies.some((value, i) => value !== previous[i])) hooks.effects.push(effect)
    hooks.values[index] = dependencies
  },
}))

beforeEach(() => {
  hooks.cursor = 0
  hooks.values = []
  hooks.effects = []
})

function fixture(saved: string | null = null) {
  let identity = 'flow-a'
  let selected: readonly string[] = []
  const preferences = {
    getItem: vi.fn(() => saved),
    setItem: vi.fn((_key: string, value: string) => {
      saved = value
    }),
  }
  const commit = vi.fn((ids: readonly string[]) => {
    selected = ids
  })
  const render = () => {
    const once = () => {
      hooks.cursor = 0
      return useInspectorPanel({ identity, preferences, selectedNodeIds: selected, onSelectNodes: commit })
    }
    once()
    hooks.effects.splice(0).forEach((effect) => effect())
    return once()
  }
  return {
    render,
    preferences,
    commit,
    selection: () => selected,
    switchFlow: () => {
      identity = 'flow-b'
      selected = []
    },
  }
}

describe('inspector navigation', () => {
  it('keeps a closed inspector closed for selection and persists only explicit opening', () => {
    const f = fixture()
    f.render().activate(['a'])
    expect(f.render().open).toBe(false)
    expect(f.preferences.setItem).not.toHaveBeenCalled()
    f.render().openInspector()
    expect(f.render().page).toBe('properties')
    expect(f.preferences.setItem).toHaveBeenLastCalledWith(inspectorPreferenceKey, 'true')
    f.render().close()
    f.render().activate(['b'])
    expect(f.render().open).toBe(false)
  })
  it('returns without clearing selection and reopens properties for the same node', () => {
    const f = fixture('true')
    f.render().activate(['a'])
    expect(f.render().page).toBe('properties')
    f.render().back()
    expect(f.selection()).toEqual(['a'])
    expect(f.render().page).toBe('outline')
    f.render().activate(['a'])
    expect(f.render().page).toBe('properties')
  })
  it('keeps committed selection and page stable during a marquee and commits the final event selection', () => {
    const f = fixture('true')
    f.render().activate(['a'])
    f.render().back()
    f.render().startSelection()
    f.render().select(['b'])
    expect(f.render().canvasSelection).toEqual(['b'])
    expect(f.selection()).toEqual(['a'])
    expect(f.render().page).toBe('outline')
    f.render().select(['b', 'c'])
    f.render().endSelection(['c', 'd'])
    expect(f.selection()).toEqual(['c', 'd'])
    expect(f.render().page).toBe('properties')
    expect(f.render().selecting).toBe(false)
    expect(f.preferences.setItem).not.toHaveBeenCalled()
  })
  it('handles cancellation/end once and returns to the outline for an empty final selection', () => {
    const f = fixture('true')
    f.render().activate(['a'])
    f.render().startSelection()
    f.render().select([])
    expect(f.render().page).toBe('properties')
    f.render().endSelection([])
    expect(f.render().page).toBe('outline')
    f.commit.mockClear()
    f.render().endSelection(['stale'])
    expect(f.commit).not.toHaveBeenCalled()
  })
  it('never opens a closed inspector at marquee completion', () => {
    const f = fixture()
    f.render().startSelection()
    f.render().endSelection(['a', 'b'])
    expect(f.selection()).toEqual(['a', 'b'])
    expect(f.render().open).toBe(false)
  })
  it('returns to the outline after clearing selection or changing workflows without changing the preference', () => {
    const f = fixture('true')
    f.render().activate(['a'])
    f.render().select([])
    expect(f.render().page).toBe('outline')
    f.render().activate(['a'])
    f.switchFlow()
    expect(f.render().page).toBe('outline')
    expect(f.render().open).toBe(true)
    expect(f.preferences.setItem).not.toHaveBeenCalled()
  })
  it('discards an unfinished gesture when switching workflows', () => {
    const f = fixture('true')
    f.render().activate(['a'])
    f.render().startSelection()
    f.render().select(['b'])
    f.switchFlow()
    expect(f.render().canvasSelection).toEqual([])
    f.render().endSelection(['b'])
    expect(f.selection()).toEqual([])
    expect(f.render().page).toBe('outline')
  })
  it('treats the block library as temporary without overwriting the preference or page', () => {
    const f = fixture('true')
    f.render().activate(['a'])
    f.render().openBlocks()
    f.render().activate(['b'])
    expect(f.render().blocksOpen).toBe(true)
    f.render().close()
    expect(f.render().open).toBe(true)
    expect(f.render().page).toBe('properties')
    expect(f.preferences.setItem).not.toHaveBeenCalled()
    f.render().openBlocks()
    f.render().openInspector()
    expect(f.render().blocksOpen).toBe(false)
  })
})

describe('inspector preferences', () => {
  it.each([null, '', 'undefined', 'false', '{invalid}'])('defaults to closed for %s', (value) => {
    expect(readInspectorOpen({ getItem: () => value, setItem: () => {} })).toBe(false)
  })
  it('restores an explicit preference and tolerates unavailable storage', () => {
    expect(readInspectorOpen({ getItem: () => 'true', setItem: () => {} })).toBe(true)
    const unavailable = {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('denied')
      },
    }
    expect(readInspectorOpen(unavailable)).toBe(false)
    expect(() => writeInspectorOpen(unavailable, true)).not.toThrow()
  })
})
