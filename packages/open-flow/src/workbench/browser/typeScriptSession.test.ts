import type { CompletionSource } from '@codemirror/autocomplete'

import { CompletionContext } from '@codemirror/autocomplete'
import { EditorState } from '@codemirror/state'
import { beforeEach, expect, it, vi } from 'vitest'
import { loadTypeScriptExtension } from './typeScriptSession.ts'

const mocks = vi.hoisted(() => ({ notification: vi.fn(), completion: vi.fn(() => null) }))
vi.mock('./typeScriptWorker.ts?worker&inline', () => ({
  default: class {
    addEventListener() {}
  },
}))
vi.mock('@codemirror/lsp-client', async (original) => ({
  ...(await original<typeof import('@codemirror/lsp-client')>()),
  LSPClient: class {
    connect() {
      return Promise.resolve()
    }
    notification = mocks.notification
    plugin() {
      return []
    }
  },
  serverCompletionSource: mocks.completion,
}))

beforeEach(() => vi.clearAllMocks())

it('loads completion typing only on demand, before querying the language server', async () => {
  let finish!: (typing: string) => void
  const prepare = vi.fn(
    () =>
      new Promise<string>((resolve) => {
        finish = resolve
      }),
  )
  const extension = await loadTypeScriptExtension('file:///test.js', 'initial', prepare)
  const state = EditorState.create({ doc: 'ctx.actions.', extensions: extension })
  expect(prepare).not.toHaveBeenCalled()
  const source = state.languageDataAt<CompletionSource>('autocomplete', state.doc.length)[0]!
  expect(state.languageDataAt<CompletionSource>('autocomplete', state.doc.length)[0]).toBe(source)
  const pending = source(new CompletionContext(state, state.doc.length, true))
  expect(prepare).toHaveBeenCalledOnce()
  expect(mocks.completion).not.toHaveBeenCalled()
  finish('loaded action types')
  await pending
  expect(mocks.notification).toHaveBeenLastCalledWith('openFlow/typing', { uri: 'file:///test.js', typing: 'loaded action types' })
  expect(mocks.completion).toHaveBeenCalledOnce()
  expect(mocks.notification.mock.invocationCallOrder.at(-1)!).toBeLessThan(mocks.completion.mock.invocationCallOrder[0]!)
})

it('does not query or update a completion that was aborted while metadata loaded', async () => {
  let finish!: (typing: string) => void
  const extension = await loadTypeScriptExtension(
    'file:///test.js',
    'initial',
    () =>
      new Promise<string>((resolve) => {
        finish = resolve
      }),
  )
  const state = EditorState.create({ extensions: extension })
  const context = new CompletionContext(state, 0, true)
  const source = state.languageDataAt<CompletionSource>('autocomplete', 0)[0]!
  const pending = source(context)
  vi.spyOn(context, 'aborted', 'get').mockReturnValue(true)
  finish('stale types')
  expect(await pending).toBeNull()
  expect(mocks.completion).not.toHaveBeenCalled()
  expect(mocks.notification).toHaveBeenCalledTimes(1)
})
