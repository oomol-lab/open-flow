import ts from 'typescript-lsp'

function directFunction(file: ts.SourceFile): readonly [number, ts.FunctionLikeDeclaration] | undefined {
  for (const statement of file.statements) {
    if (ts.isFunctionDeclaration(statement)) {
      const exported = statement.modifiers?.some((modifier) => modifier.kind == ts.SyntaxKind.ExportKeyword) ?? false
      const defaultExport = statement.modifiers?.some((modifier) => modifier.kind == ts.SyntaxKind.DefaultKeyword) ?? false
      if (exported && defaultExport) return [statement.getStart(file), statement]
      continue
    }
    if (!ts.isExportAssignment(statement) || statement.isExportEquals) continue
    let expression = statement.expression
    while (ts.isParenthesizedExpression(expression)) expression = expression.expression
    if (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)) return [statement.getStart(file), expression]
  }
}

function functionTyping(node: ts.FunctionLikeDeclaration, typing: string): string | undefined {
  const input = node.parameters[0]?.name
  const context = node.parameters[1]?.name
  const lines = ['/**']
  if (input != null && ts.isIdentifier(input)) lines.push(` * @param {__TaskInputs} ${input.text}`)
  if (context != null && ts.isIdentifier(context)) {
    lines.push(` * @param {${typing.includes('} TaskContext */') ? '__TaskContext' : 'import("@oomol-lab/open-flow").TaskContext'}} ${context.text}`)
  }
  if (lines.length == 1) return
  const result = 'import("@oomol-lab/open-flow").TaskResult<__TaskOutputs>'
  const async = node.modifiers?.some((modifier) => modifier.kind == ts.SyntaxKind.AsyncKeyword)
  lines.push(` * @returns {${async ? `Promise<${result}>` : `${result} | Promise<${result}>`}}`, ' */', '')
  return lines.join('\n')
}

export function contextName(source: string): string | undefined {
  const file = ts.createSourceFile('module.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  const parameter = directFunction(file)?.[1].parameters[1]?.name
  return parameter != null && ts.isIdentifier(parameter) ? parameter.text : undefined
}

export class ShadowDocument {
  private readonly file: ts.SourceFile
  private readonly inserts: readonly (readonly [number, string])[]
  public readonly source: string
  public readonly text: string

  public constructor(source: string, typing: string) {
    this.source = source
    this.file = ts.createSourceFile('/module.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
    const inserts: (readonly [number, string])[] = []
    if (typing != '') {
      const names = typing
        .replace('}} Inputs;', '}} __TaskInputs;')
        .replace('}} Outputs;', '}} __TaskOutputs;')
        .replace('} TaskContext */', '} __TaskContext */')
      inserts.push([0, names.endsWith('\n') ? names : `${names}\n`])
    }
    const found = directFunction(this.file)
    if (found != null) {
      const annotation = functionTyping(found[1], typing)
      if (annotation != null) inserts.push([found[0], annotation])
    }
    this.inserts = inserts.toSorted((left, right) => left[0] - right[0])
    let offset = 0
    let text = ''
    for (const insert of this.inserts) {
      text += source.slice(offset, insert[0]) + insert[1]
      offset = insert[0]
    }
    this.text = text + source.slice(offset)
  }

  public offsetAt(position: ts.LineAndCharacter): number {
    const starts = this.file.getLineStarts()
    const line = Math.min(Math.max(position.line, 0), starts.length - 1)
    const start = starts[line] ?? 0
    const end = line + 1 < starts.length ? (starts[line + 1] ?? this.file.end) : this.file.end
    return this.toShadow(Math.min(start + Math.max(position.character, 0), end))
  }

  public positionAt(offset: number): ts.LineAndCharacter | undefined {
    const sourceOffset = this.toSource(offset)
    if (sourceOffset == null) return
    return this.file.getLineAndCharacterOfPosition(Math.min(Math.max(sourceOffset, 0), this.file.end))
  }

  public toShadow(offset: number): number {
    let shadowOffset = offset
    for (const insert of this.inserts) {
      if (insert[0] > offset) break
      shadowOffset += insert[1].length
    }
    return shadowOffset
  }

  public toSource(offset: number): number | undefined {
    let added = 0
    for (const insert of this.inserts) {
      const start = insert[0] + added
      const end = start + insert[1].length
      if (offset < start) return offset - added
      if (offset < end) return
      added += insert[1].length
    }
    return offset - added
  }
}
