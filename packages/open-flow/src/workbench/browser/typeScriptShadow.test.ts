import ts from 'typescript-lsp'
import { describe, expect, it } from 'vitest'
import { syntaxDiagnostics } from './typeScriptDiagnostics.ts'
import { ShadowDocument } from './typeScriptShadow.ts'

function languageService(source: string) {
  const file = '/module.js'
  const service = ts.createLanguageService({
    fileExists: (name) => name == file,
    getCompilationSettings: () => ({ allowJs: true, checkJs: true, module: ts.ModuleKind.ESNext, noEmit: true, strict: true }),
    getCurrentDirectory: () => '/',
    getDefaultLibFileName: () => '/lib.d.ts',
    getScriptFileNames: () => [file],
    getScriptSnapshot: (name) => (name == file ? ts.ScriptSnapshot.fromString(source) : undefined),
    getScriptVersion: () => '0',
    readDirectory: () => [],
    readFile: (name) => (name == file ? source : undefined),
  })
  return { file, service }
}

const typing = [
  '/**',
  ' * @typedef {{',
  ' *   alpha: string;',
  ' *   count: number;',
  ' * }} Inputs;',
  ' * @typedef {{',
  ' *   result: boolean;',
  ' * }} Outputs;',
  ' */',
  '',
].join('\n')

describe('TypeScript shadow documents', () => {
  it('maps completion, hover, and signature help through generated typing', () => {
    const source = [
      '/** @typedef {{ stale: boolean }} Inputs */',
      'function join(value, count) { return value.repeat(count) }',
      'const label = "流程🚀"',
      '/** @param {Inputs} payload */',
      'export default function (payload, ctx) {',
      '  const result = join(payload.alpha, 2)',
      '  return { result: result.length > 0 }',
      '}',
      '',
    ].join('\n')
    const document = new ShadowDocument(source, typing)
    const sourceFile = ts.createSourceFile('/source.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
    const alpha = source.indexOf('payload.alpha') + 'payload.'.length
    const comma = source.indexOf(', 2)', source.indexOf('join(payload')) + 1
    const alphaOffset = document.offsetAt(sourceFile.getLineAndCharacterOfPosition(alpha))
    const commaOffset = document.offsetAt(sourceFile.getLineAndCharacterOfPosition(comma))
    const { file, service } = languageService(document.text)

    const completions = service.getCompletionsAtPosition(file, alphaOffset, {})
    expect(completions?.entries.map((entry) => entry.name)).toEqual(expect.arrayContaining(['alpha', 'count']))
    expect(completions?.entries.map((entry) => entry.name)).not.toContain('stale')

    const hover = service.getQuickInfoAtPosition(file, alphaOffset + 1)
    if (hover == null) throw new Error('Expected hover information.')
    const hoverStart = document.positionAt(hover.textSpan.start)
    const hoverEnd = document.positionAt(hover.textSpan.start + hover.textSpan.length)
    if (hoverStart == null || hoverEnd == null) throw new Error('Expected a source hover range.')
    const start = sourceFile.getPositionOfLineAndCharacter(hoverStart.line, hoverStart.character)
    const end = sourceFile.getPositionOfLineAndCharacter(hoverEnd.line, hoverEnd.character)
    expect(source.slice(start, end)).toBe('alpha')

    const help = service.getSignatureHelpItems(file, commaOffset, { triggerReason: { kind: 'invoked' } })
    expect(help?.argumentIndex).toBe(1)
    expect(help?.items[0]?.parameters).toHaveLength(2)
  })

  it('uses renamed arrow parameters and keeps every source offset reversible', () => {
    const source = ['const note = "你好"', 'export default (data, task) => {', '  return { result: data.alpha + note }', '}', ''].join('\n')
    const document = new ShadowDocument(source, typing.replace('count: number;', 'count: number; enabled: boolean;'))

    expect(document.source).toBe(source)
    expect(document.text).toContain('@param {__TaskInputs} data')
    expect(document.text).toContain('@param {import("@oomol-lab/open-flow").TaskContext} task')
    for (let offset = 0; offset <= source.length; offset++) expect(document.toSource(document.toShadow(offset))).toBe(offset)
    expect(document.positionAt(1)).toBeUndefined()
  })
})

describe('local JavaScript syntax diagnostics', () => {
  it('maps errors to editable source past generated typing, including UTF-16 columns', () => {
    const source = 'export default function (inputs, context) {\n  const text = "流程🚀"; const broken = ;\n  return inputs\n}'
    const document = new ShadowDocument(source, typing)
    const { file, service } = languageService(document.text)
    const errors = syntaxDiagnostics(service, file, document)
    expect(errors).toEqual([expect.objectContaining({ from: source.indexOf(';', source.indexOf('broken')), severity: 'error' })])
    expect(errors[0]?.message).toContain('Expression expected')
  })

  it('reports end-of-file errors and clears them for repaired source', () => {
    const source = 'export default function (inputs) {\n  return inputs'
    const document = new ShadowDocument(source, typing)
    const { file, service } = languageService(document.text)
    expect(syntaxDiagnostics(service, file, document)).toEqual([expect.objectContaining({ from: source.length, to: source.length })])
    const repaired = new ShadowDocument(source + '\n}', typing)
    const fixed = languageService(repaired.text)
    expect(syntaxDiagnostics(fixed.service, fixed.file, repaired)).toEqual([])
  })

  it('does not report semantic errors or errors inside generated typing', () => {
    const document = new ShadowDocument('export default () => missingVariable', typing)
    const { file, service } = languageService(document.text)
    expect(syntaxDiagnostics(service, file, document)).toEqual([])
    const generated = new ShadowDocument('export default () => 1', 'const broken = ;\n')
    const invalid = languageService(generated.text)
    expect(syntaxDiagnostics(invalid.service, invalid.file, generated)).toEqual([])
  })
})
