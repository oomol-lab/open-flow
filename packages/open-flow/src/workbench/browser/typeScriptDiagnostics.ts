import type { Diagnostic } from '@codemirror/lint'
import type { ShadowDocument } from './typeScriptShadow.ts'

import ts from 'typescript-lsp'

export function syntaxDiagnostics(service: ts.LanguageService, uri: string, document: ShadowDocument): Diagnostic[] {
  return service.getSyntacticDiagnostics(uri).flatMap((diagnostic): Diagnostic[] => {
    if (diagnostic.start == null) return []
    const from = document.toSource(diagnostic.start)
    const to = document.toSource(diagnostic.start + (diagnostic.length ?? 0))
    // Generated typing is not editable source and must never receive a marker.
    if (from == null || to == null) return []
    return [{ from, to, severity: 'error', message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n') }]
  })
}
