// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render as mount } from '../../../../../test/support/render.tsx'
import { inspectorPreferenceKey, readInspectorOpen, useInspectorPanel, writeInspectorOpen } from './useInspectorPanel.ts'

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
  let state: ReturnType<typeof useInspectorPanel>
  function Host() {
    state = useInspectorPanel({ identity, preferences, selectedNodeIds: selected, onSelectNodes: commit })
    return null
  }
  const view = mount(createElement(Host))
  const render = () => {
    view.rerender(createElement(Host))
    return state!
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
  it('reveals properties automatically without changing the saved visibility preference', () => {
    const f = fixture('false')
    act(() => f.render().activate(['a']))
    act(() => f.render().revealInspector())
    expect(f.render().open).toBe(true)
    expect(f.render().page).toBe('properties')
    expect(f.preferences.setItem).not.toHaveBeenCalled()
    act(() => f.render().close())
    expect(f.render().open).toBe(false)
  })
  it('keeps a closed inspector closed for selection and persists only explicit opening', () => {
    const f = fixture()
    act(() => f.render().activate(['a']))
    expect(f.render().open).toBe(false)
    expect(f.preferences.setItem).not.toHaveBeenCalled()
    act(() => f.render().openInspector())
    expect(f.render().page).toBe('properties')
    expect(f.preferences.setItem).toHaveBeenLastCalledWith(inspectorPreferenceKey, 'true')
    act(() => f.render().close())
    act(() => f.render().activate(['b']))
    expect(f.render().open).toBe(false)
  })
  it('returns without clearing selection and reopens properties for the same node', () => {
    const f = fixture('true')
    act(() => f.render().activate(['a']))
    expect(f.render().page).toBe('properties')
    act(() => f.render().back())
    expect(f.selection()).toEqual(['a'])
    expect(f.render().page).toBe('outline')
    act(() => f.render().activate(['a']))
    expect(f.render().page).toBe('properties')
  })
  it('keeps committed selection and page stable during a marquee and commits the final event selection', () => {
    const f = fixture('true')
    act(() => f.render().activate(['a']))
    act(() => f.render().back())
    act(() => f.render().startSelection())
    act(() => f.render().select(['b']))
    expect(f.render().canvasSelection).toEqual(['b'])
    expect(f.selection()).toEqual(['a'])
    expect(f.render().page).toBe('outline')
    act(() => f.render().select(['b', 'c']))
    act(() => f.render().endSelection(['c', 'd']))
    expect(f.selection()).toEqual(['c', 'd'])
    expect(f.render().page).toBe('properties')
    expect(f.render().selecting).toBe(false)
    expect(f.preferences.setItem).not.toHaveBeenCalled()
  })
  it('handles cancellation/end once and returns to the outline for an empty final selection', () => {
    const f = fixture('true')
    act(() => f.render().activate(['a']))
    act(() => f.render().startSelection())
    act(() => f.render().select([]))
    expect(f.render().page).toBe('properties')
    act(() => f.render().endSelection([]))
    expect(f.render().page).toBe('outline')
    f.commit.mockClear()
    act(() => f.render().endSelection(['stale']))
    expect(f.commit).not.toHaveBeenCalled()
  })
  it('never opens a closed inspector at marquee completion', () => {
    const f = fixture()
    act(() => f.render().startSelection())
    act(() => f.render().endSelection(['a', 'b']))
    expect(f.selection()).toEqual(['a', 'b'])
    expect(f.render().open).toBe(false)
  })
  it('returns to the outline after clearing selection or changing workflows without changing the preference', () => {
    const f = fixture('true')
    act(() => f.render().activate(['a']))
    act(() => f.render().select([]))
    expect(f.render().page).toBe('outline')
    act(() => f.render().activate(['a']))
    f.switchFlow()
    expect(f.render().page).toBe('outline')
    expect(f.render().open).toBe(true)
    expect(f.preferences.setItem).not.toHaveBeenCalled()
  })
  it('discards an unfinished gesture when switching workflows', () => {
    const f = fixture('true')
    act(() => f.render().activate(['a']))
    act(() => f.render().startSelection())
    act(() => f.render().select(['b']))
    f.switchFlow()
    expect(f.render().canvasSelection).toEqual([])
    act(() => f.render().endSelection(['b']))
    expect(f.selection()).toEqual([])
    expect(f.render().page).toBe('outline')
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
