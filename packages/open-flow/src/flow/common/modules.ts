import type { EngineContract } from '../../execution/common/engineContract.ts'
import type { RevisionContent } from './change.ts'
import type { Diagnostic } from './semantics.ts'

import { parse } from '@babel/parser'
interface ImportReference {
  readonly column: number
  readonly imported: readonly string[]
  readonly line: number
  readonly specifier: string
}

interface ModuleAnalysis {
  readonly exports: ReadonlySet<string>
  readonly imports: readonly ImportReference[]
}

function location(value: { readonly loc?: { readonly start: { readonly column: number; readonly line: number } } | null }): {
  readonly column: number
  readonly line: number
} {
  return { column: value.loc?.start.column ?? 0, line: value.loc?.start.line ?? 1 }
}

function modulePath(moduleId: string): string {
  return `/modules/${moduleId}/source`
}

function bindingNames(value: unknown, names: Set<string>): void {
  if (value == null || typeof value != 'object') return
  const node = value as {
    readonly argument?: unknown
    readonly elements?: readonly unknown[]
    readonly left?: unknown
    readonly name?: unknown
    readonly properties?: readonly unknown[]
    readonly type?: unknown
  }
  if (node.type == 'Identifier' && typeof node.name == 'string') names.add(node.name)
  else if (node.type == 'RestElement') bindingNames(node.argument, names)
  else if (node.type == 'AssignmentPattern') bindingNames(node.left, names)
  else if (node.type == 'ArrayPattern') for (const element of node.elements ?? []) bindingNames(element, names)
  else if (node.type == 'ObjectPattern') {
    for (const property of node.properties ?? []) {
      const candidate = property as { readonly argument?: unknown; readonly type?: unknown; readonly value?: unknown }
      bindingNames(candidate.type == 'RestElement' ? candidate.argument : candidate.value, names)
    }
  }
}

function importedName(value: unknown): string | undefined {
  if (value == null || typeof value != 'object') return
  const node = value as { readonly name?: unknown; readonly type?: unknown; readonly value?: unknown }
  if (node.type == 'Identifier' && typeof node.name == 'string') return node.name
  if (node.type == 'StringLiteral' && typeof node.value == 'string') return node.value
}

function analyzeModule(moduleId: string, source: string, diagnostics: Diagnostic[]): ModuleAnalysis | undefined {
  let program: ReturnType<typeof parse>['program']
  try {
    program = parse(source, {
      createImportExpressions: true,
      sourceFilename: modulePath(moduleId),
      sourceType: 'module',
    }).program
  } catch (error) {
    const sourceLocation = error != null && typeof error == 'object' ? Reflect.get(error, 'loc') : undefined
    diagnostics.push({
      code: 'module.syntax',
      column:
        sourceLocation != null && typeof sourceLocation == 'object' && typeof Reflect.get(sourceLocation, 'column') == 'number'
          ? Reflect.get(sourceLocation, 'column')
          : 0,
      line:
        sourceLocation != null && typeof sourceLocation == 'object' && typeof Reflect.get(sourceLocation, 'line') == 'number'
          ? Reflect.get(sourceLocation, 'line')
          : 1,
      message: `CodeModule "${moduleId}" contains invalid JavaScript syntax.`,
      path: modulePath(moduleId),
      values: { moduleId },
    })
    return
  }

  const exports = new Set<string>()
  const imports: ImportReference[] = []
  for (const statement of program.body) {
    if (statement.type == 'ImportDeclaration') {
      const imported = statement.specifiers.flatMap((specifier) => {
        if (specifier.type == 'ImportNamespaceSpecifier') return []
        if (specifier.type == 'ImportDefaultSpecifier') return ['default']
        const name = importedName(specifier.imported)
        return name == null ? [] : [name]
      })
      imports.push({ ...location(statement.source), imported, specifier: statement.source.value })
      continue
    }
    if (statement.type == 'ExportDefaultDeclaration') {
      exports.add('default')
      continue
    }
    if (statement.type != 'ExportNamedDeclaration') continue
    if (statement.source != null) {
      diagnostics.push({
        code: 'module.unsupported-import',
        ...location(statement.source),
        message: `CodeModule "${moduleId}" must import before re-exporting values.`,
        path: modulePath(moduleId),
        values: { moduleId, variant: 'reexport' },
      })
      continue
    }
    if (statement.declaration?.type == 'VariableDeclaration') {
      for (const declaration of statement.declaration.declarations) bindingNames(declaration.id, exports)
    } else if (
      (statement.declaration?.type == 'FunctionDeclaration' || statement.declaration?.type == 'ClassDeclaration') &&
      statement.declaration.id != null
    ) {
      exports.add(statement.declaration.id.name)
    }
    for (const specifier of statement.specifiers) {
      const name = importedName(specifier.exported)
      if (name != null) exports.add(name)
    }
  }

  const visit = (value: unknown): void => {
    if (value == null || typeof value != 'object') return
    if (Array.isArray(value)) {
      for (const item of value) visit(item)
      return
    }
    const node = value as Readonly<Record<string, unknown>>
    const callee = node.callee as { readonly name?: unknown; readonly type?: unknown } | undefined
    if (node.type == 'ImportExpression' || (node.type == 'CallExpression' && callee?.type == 'Import')) {
      diagnostics.push({
        code: 'module.dynamic-import',
        ...location(node),
        message: `CodeModule "${moduleId}" cannot use dynamic import.`,
        path: modulePath(moduleId),
        values: { moduleId },
      })
    } else if (node.type == 'CallExpression' && callee?.type == 'Identifier' && callee.name == 'require') {
      diagnostics.push({
        code: 'module.commonjs',
        ...location(node),
        message: `CodeModule "${moduleId}" cannot use CommonJS require.`,
        path: modulePath(moduleId),
        values: { moduleId },
      })
    } else if (
      (node.type == 'CallExpression' && callee?.type == 'Identifier' && (callee.name == 'eval' || callee.name == 'Function')) ||
      (node.type == 'NewExpression' && callee?.type == 'Identifier' && callee.name == 'Function')
    ) {
      diagnostics.push({
        code: 'module.dynamic-code',
        ...location(node),
        message: `CodeModule "${moduleId}" cannot evaluate dynamic code.`,
        path: modulePath(moduleId),
        values: { moduleId },
      })
    }
    for (const [key, child] of Object.entries(node)) {
      if (key != 'loc' && key != 'tokens' && key != 'comments') visit(child)
    }
  }
  visit(program)
  return { exports, imports }
}

function projectModule(specifier: string): string | undefined {
  const match = /^\.\/(.+)\.mjs$/.exec(specifier)
  return match?.[1]
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

export function compareDiagnostics(left: Diagnostic, right: Diagnostic): number {
  return (
    compareText(left.path, right.path) ||
    left.line - right.line ||
    left.column - right.column ||
    compareText(left.code, right.code) ||
    compareText(left.message, right.message)
  )
}

export function validateModuleGraph(
  revision: RevisionContent,
  moduleIds: readonly string[],
  engine: EngineContract,
): { readonly analysis: ReadonlyMap<string, ModuleAnalysis>; readonly diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = []
  const analysis = new Map<string, ModuleAnalysis>()
  for (const moduleId of moduleIds.toSorted()) {
    const module = revision.modules[moduleId]
    if (module == null) continue
    const result = analyzeModule(moduleId, module.source, diagnostics)
    if (result != null) analysis.set(moduleId, result)
  }

  for (const moduleId of moduleIds.toSorted()) {
    const module = revision.modules[moduleId]
    if (module == null) continue
    const result = analysis.get(moduleId)
    if (result == null) continue
    const sourceImports = new Set<string>()
    for (const imported of result.imports) {
      if (engine.builtinModules?.has(imported.specifier)) continue
      if (imported.specifier == engine.platformModule) {
        for (const name of imported.imported) {
          if (engine.platformExports.has(name)) continue
          diagnostics.push({
            code: 'module.missing-export',
            column: imported.column,
            line: imported.line,
            message: `Platform Library does not export "${name}".`,
            path: modulePath(moduleId),
            values: { name, variant: 'platform' },
          })
        }
        continue
      }
      const importedModuleId = projectModule(imported.specifier)
      if (importedModuleId == null) {
        diagnostics.push({
          code: 'module.unsupported-import',
          column: imported.column,
          line: imported.line,
          message: `CodeModule "${moduleId}" cannot import "${imported.specifier}".`,
          path: modulePath(moduleId),
          values: { moduleId, specifier: imported.specifier, variant: 'import' },
        })
        continue
      }
      sourceImports.add(importedModuleId)
      if (revision.modules[importedModuleId] == null) {
        diagnostics.push({
          code: 'module.missing',
          column: imported.column,
          line: imported.line,
          message: `CodeModule "${importedModuleId}" does not exist.`,
          path: modulePath(moduleId),
          values: { moduleId: importedModuleId },
        })
        continue
      }
      if (!module.imports.includes(importedModuleId)) {
        diagnostics.push({
          code: 'module.import-not-declared',
          column: imported.column,
          line: imported.line,
          message: `CodeModule "${moduleId}" does not declare its import of "${importedModuleId}".`,
          path: modulePath(moduleId),
          values: { importedModuleId, moduleId },
        })
        continue
      }
      const importedAnalysis = analysis.get(importedModuleId)
      if (importedAnalysis == null) continue
      for (const name of imported.imported) {
        if (importedAnalysis.exports.has(name)) continue
        diagnostics.push({
          code: 'module.missing-export',
          column: imported.column,
          line: imported.line,
          message: `CodeModule "${importedModuleId}" does not export "${name}".`,
          path: modulePath(moduleId),
          values: { moduleId: importedModuleId, name, variant: 'module' },
        })
      }
    }
    for (const importedModuleId of module.imports) {
      if (sourceImports.has(importedModuleId)) continue
      diagnostics.push({
        code: 'module.declared-import-missing',
        column: 0,
        line: 1,
        message: `CodeModule "${moduleId}" declares "${importedModuleId}" without a matching static import.`,
        path: modulePath(moduleId),
        values: { importedModuleId, moduleId },
      })
    }
  }
  return { analysis, diagnostics }
}

export function validateModules(revision: RevisionContent, moduleIds: readonly string[], engine: EngineContract): readonly Diagnostic[] {
  return validateModuleGraph(revision, moduleIds, engine).diagnostics.toSorted(compareDiagnostics)
}
