import type { Diagnostic } from '@codemirror/lint'
import type { EditorState } from '@codemirror/state'

import { forEachDiagnostic, linter } from '@codemirror/lint'
import { StateEffect, StateField } from '@codemirror/state'
import { EditorView } from '@codemirror/view'

export interface CodeDiagnostics {
  readonly source: string
  readonly items: readonly {
    /** One-based line and zero-based UTF-16 column. */
    readonly line: number
    readonly column: number
    readonly message: string
  }[]
}

export interface CodeEditorFeedback {
  readonly diagnostics?: CodeDiagnostics
  readonly invalid?: boolean
}

export const updateCodeFeedback = StateEffect.define<CodeEditorFeedback>()

export function codeEditorInvalid(state: EditorState): boolean {
  let hasErrors = state.field(feedbackField).invalid === true
  forEachDiagnostic(state, (diagnostic) => {
    if (diagnostic.severity == 'error') hasErrors = true
  })
  return hasErrors
}

const feedbackField = StateField.define<CodeEditorFeedback>({
  create: () => ({}),
  update(value, transaction) {
    for (const effect of transaction.effects) if (effect.is(updateCodeFeedback)) value = { ...value, ...effect.value }
    return value
  },
})

export function codeDiagnostics(state: EditorState): Diagnostic[] {
  const diagnostics = state.field(feedbackField).diagnostics
  if (diagnostics == null || diagnostics.source != state.doc.toString()) return []
  return diagnostics.items.map((item) => {
    const line = state.doc.line(Math.min(Math.max(item.line, 1), state.doc.lines))
    const from = Math.min(line.from + Math.max(item.column, 0), line.to)
    return { from, to: Math.min(from + 1, line.to), severity: 'error', message: item.message }
  })
}

export const codeDiagnosticsExtension = [
  feedbackField,
  EditorView.editorAttributes.of((view) => ({ 'data-invalid': String(codeEditorInvalid(view.state)) })),
  EditorView.contentAttributes.of((view) => ({ 'aria-invalid': String(codeEditorInvalid(view.state)) })),
  linter((view) => codeDiagnostics(view.state), {
    delay: 300,
    needsRefresh: (update) => update.startState.field(feedbackField).diagnostics !== update.state.field(feedbackField).diagnostics,
  }),
]
