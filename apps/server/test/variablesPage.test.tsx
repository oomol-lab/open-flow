import type { ControlClient, Variable } from '@oomol-lab/open-flow/control-api'

import { beforeEach, expect, it, vi } from 'vitest'
import { VariablesPage } from '../browser/variables.tsx'

const hooks = vi.hoisted(() => ({
  cleanup: undefined as (() => void) | undefined,
  focus: undefined as (() => void) | undefined,
  refIndex: 0,
  refs: [] as { current: unknown }[],
  stateIndex: 0,
  setters: [] as ReturnType<typeof vi.fn>[],
  states: [] as unknown[],
  toast: vi.fn(),
}))

vi.mock('react', async (importOriginal) => {
  const original = await importOriginal<typeof import('react')>()
  return {
    ...original,
    useCallback: <T,>(callback: T) => callback,
    useEffect: (callback: () => void | (() => void)) => {
      hooks.cleanup = callback() ?? undefined
    },
    useMemo: <T,>(factory: () => T) => factory(),
    useRef: <T,>(value: T) => {
      const index = hooks.refIndex++
      return (hooks.refs[index] ??= { current: value }) as { current: T }
    },
    useState: <T,>(initial: T | (() => T)) => {
      const index = hooks.stateIndex++
      hooks.states[index] ??= typeof initial == 'function' ? (initial as () => T)() : initial
      hooks.setters[index] ??= vi.fn()
      return [hooks.states[index], hooks.setters[index]] as const
    },
  }
})

vi.mock('sonner', () => ({ toast: { error: hooks.toast } }))
vi.mock('val-i18n-react', () => ({ useTranslate: () => (key: string) => key }))

beforeEach(() => {
  hooks.cleanup = undefined
  hooks.focus = undefined
  hooks.refIndex = 0
  hooks.refs = []
  hooks.stateIndex = 0
  hooks.setters = []
  hooks.states = []
  hooks.toast.mockClear()
  vi.stubGlobal(
    'addEventListener',
    vi.fn((type: string, listener: () => void) => {
      if (type == 'focus') hooks.focus = listener
    }),
  )
  vi.stubGlobal('removeEventListener', vi.fn())
})

it('ignores an older Variable response that finishes last', async () => {
  const older = Promise.withResolvers<{ readonly variables: readonly Variable[] }>()
  const newer = Promise.withResolvers<{ readonly variables: readonly Variable[] }>()
  const listVariables = vi.fn().mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise)
  const client = { listVariables } as unknown as ControlClient
  const fresh = [{ name: 'FRESH', updatedAt: '2026-08-27T00:00:00.000Z', value: 'new', version: 1 }] as const
  const stale = [{ name: 'STALE', updatedAt: '2026-08-26T00:00:00.000Z', value: 'old', version: 1 }] as const

  VariablesPage({ client, language: 'en' })
  hooks.focus?.()
  newer.resolve({ variables: fresh })
  await newer.promise
  await Promise.resolve()

  expect(hooks.setters[0]).toHaveBeenCalledOnce()
  expect(hooks.setters[0]).toHaveBeenCalledWith(fresh)

  older.resolve({ variables: stale })
  await older.promise
  await Promise.resolve()

  expect(hooks.setters[0]).toHaveBeenCalledOnce()
  expect(hooks.toast).not.toHaveBeenCalled()
  hooks.cleanup?.()
})
