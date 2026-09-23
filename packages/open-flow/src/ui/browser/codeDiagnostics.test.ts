import { setDiagnostics } from '@codemirror/lint'
import { EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { codeDiagnostics, codeDiagnosticsExtension, codeEditorInvalid, updateCodeFeedback } from './codeDiagnostics.ts'

describe('external code diagnostics', () => {
  it('converts server line and column positions and clamps missing ranges at EOF', () => {
    const source = 'const text = "🚀"\nexport default text'
    let state = EditorState.create({ doc: source, extensions: codeDiagnosticsExtension })
    state = state.update({
      effects: updateCodeFeedback.of({
        diagnostics: {
          source,
          items: [
            { line: 2, column: 15, message: 'Server error' },
            { line: 99, column: 99, message: 'End error' },
          ],
        },
      }),
    }).state
    expect(codeDiagnostics(state)).toEqual([
      {
        from: source.indexOf('text', source.indexOf('export')),
        to: source.indexOf('text', source.indexOf('export')) + 1,
        message: 'Server error',
        severity: 'error',
      },
      { from: source.length, to: source.length, message: 'End error', severity: 'error' },
    ])
  })

  it('hides stale diagnostics after editing, accepts new results, and clears removed results', () => {
    let state = EditorState.create({ doc: 'broken', extensions: codeDiagnosticsExtension })
    state = state.update({ effects: updateCodeFeedback.of({ diagnostics: { source: 'broken', items: [{ line: 1, column: 0, message: 'Error' }] } }) }).state
    expect(codeDiagnostics(state)).toHaveLength(1)
    state = state.update({ changes: { from: 0, to: 6, insert: 'fixed' } }).state
    expect(codeDiagnostics(state)).toEqual([])
    state = state.update({ effects: updateCodeFeedback.of({ diagnostics: { source: 'fixed', items: [{ line: 1, column: 0, message: 'New error' }] } }) }).state
    expect(codeDiagnostics(state)[0]?.message).toBe('New error')
    state = state.update({ effects: updateCodeFeedback.of({ diagnostics: undefined }) }).state
    expect(codeDiagnostics(state)).toEqual([])
  })
})

describe('code editor validity', () => {
  it('keeps error diagnostics and external validation independent', () => {
    let state = EditorState.create({ doc: 'broken', extensions: codeDiagnosticsExtension })
    const error = { from: 0, to: 6, severity: 'error' as const, message: 'Syntax error' }
    expect(codeEditorInvalid(state)).toBe(false)
    state = state.update(setDiagnostics(state, [error])).state
    expect(codeEditorInvalid(state)).toBe(true)
    state = state.update({ effects: updateCodeFeedback.of({ invalid: true }) }).state
    state = state.update(setDiagnostics(state, [])).state
    expect(codeEditorInvalid(state)).toBe(true)
    state = state.update(setDiagnostics(state, [error])).state
    state = state.update({ effects: updateCodeFeedback.of({ invalid: false }) }).state
    expect(codeEditorInvalid(state)).toBe(true)
    state = state.update(setDiagnostics(state, [])).state
    expect(codeEditorInvalid(state)).toBe(false)
  })

  it('does not turn warnings into validation errors', () => {
    let state = EditorState.create({ doc: 'code', extensions: codeDiagnosticsExtension })
    state = state.update(setDiagnostics(state, [{ from: 0, to: 4, severity: 'warning', message: 'Warning' }])).state
    expect(codeEditorInvalid(state)).toBe(false)
  })
})
