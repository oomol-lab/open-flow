import { createSystem, createVirtualTypeScriptEnvironment } from '@typescript/vfs'
import ts, { displayPartsToString } from 'typescript-lsp'
import { syntaxDiagnostics } from './typeScriptDiagnostics.ts'
import { ShadowDocument } from './typeScriptShadow.ts'

const compilerOptions: import('typescript-lsp').CompilerOptions = {
  allowJs: true,
  checkJs: true,
  lib: ['lib.es2024.d.ts', 'lib.dom.d.ts'],
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  noEmit: true,
  strict: true,
  target: ts.ScriptTarget.ES2024,
}

const libraries = import.meta.glob<string>(
  [
    '../../../node_modules/typescript-lsp/lib/lib.*.d.ts',
    '!../../../node_modules/typescript-lsp/lib/lib.webworker*.d.ts',
    '!../../../node_modules/typescript-lsp/lib/lib.scripthost*.d.ts',
  ],
  { eager: true, query: '?raw', import: 'default' },
)
const platformSources = import.meta.glob<string>('../../types/index.ts', { eager: true, query: '?raw', import: 'default' })
const platformTypes = platformSources['../../types/index.ts']!

const files = new Map<string, string>()
const libraryFiles: string[] = []
for (const path in libraries) {
  const file = `/${path.split('/').at(-1)}`
  files.set(file, libraries[path]!)
  libraryFiles.push(file)
}
files.set('file:///node_modules/@oomol-lab/open-flow/package.json', JSON.stringify({ name: '@oomol-lab/open-flow', types: 'index.d.ts' }))
files.set('file:///node_modules/@oomol-lab/open-flow/index.d.ts', platformTypes)

const system = createSystem(files)
const openDocuments = new Map<string, ShadowDocument>()
const typings = new Map<string, string>()
const compiler = ts as unknown as Parameters<typeof createVirtualTypeScriptEnvironment>[2]
let environment = createVirtualTypeScriptEnvironment(system, libraryFiles, compiler, compilerOptions)

const completionKinds: Readonly<Record<string, number>> = {
  'alias': 18,
  'class': 7,
  'const': 21,
  'enum': 13,
  'enum member': 20,
  'function': 3,
  'interface': 8,
  'keyword': 14,
  'let': 21,
  'local function': 3,
  'local var': 6,
  'method': 2,
  'module': 9,
  'parameter': 6,
  'primitive': 22,
  'property': 10,
  'string': 1,
  'type': 22,
  'var': 6,
}

function ensureFile(uri: string, text: string): void {
  const document = new ShadowDocument(text, typings.get(uri) ?? '')
  openDocuments.set(uri, document)
  if (environment.getSourceFile(uri) == null) environment.createFile(uri, document.text)
  else environment.updateFile(uri, document.text)
}

function removeFile(uri: string): void {
  openDocuments.delete(uri)
  typings.delete(uri)
  if (environment.getSourceFile(uri) != null) environment.deleteFile(uri)
}

function positionToOffset(uri: string, position: { readonly character: number; readonly line: number }): number {
  return openDocuments.get(uri)?.offsetAt(position) ?? 0
}

function offsetToPosition(uri: string, offset: number): { readonly character: number; readonly line: number } | undefined {
  return openDocuments.get(uri)?.positionAt(offset)
}

function handleRequest(method: string, params: any): unknown {
  switch (method) {
    case 'initialize':
      return {
        capabilities: {
          completionProvider: { resolveProvider: true, triggerCharacters: ['.'] },
          hoverProvider: true,
          signatureHelpProvider: { retriggerCharacters: [')'], triggerCharacters: ['(', ','] },
          textDocumentSync: 1,
        },
      }
    case 'openFlow/syntaxDiagnostics': {
      const document = openDocuments.get(params.uri)
      return document == null ? [] : syntaxDiagnostics(environment.languageService, params.uri, document)
    }
    case 'shutdown':
      return null
    case 'textDocument/completion': {
      const uri = params.textDocument.uri
      const offset = positionToOffset(uri, params.position)
      const result = environment.languageService.getCompletionsAtPosition(uri, offset, {})
      if (result == null) return null
      const replacement = result.optionalReplacementSpan
      const replacementStart = replacement == null ? undefined : offsetToPosition(uri, replacement.start)
      const replacementEnd = replacement == null ? undefined : offsetToPosition(uri, replacement.start + replacement.length)
      const editRange = replacementStart == null || replacementEnd == null ? undefined : { end: replacementEnd, start: replacementStart }
      return {
        isIncomplete: Boolean(result.isIncomplete),
        itemDefaults: editRange == null ? undefined : { editRange },
        items: result.entries.map((entry: import('typescript-lsp').CompletionEntry) => ({
          data: { name: entry.name, offset, source: entry.source, uri },
          kind: completionKinds[entry.kind] ?? 1,
          label: entry.name,
          sortText: entry.sortText,
        })),
      }
    }
    case 'completionItem/resolve': {
      const data = params.data
      if (data == null) return params
      const details = environment.languageService.getCompletionEntryDetails(data.uri, data.offset, data.name, {}, data.source, undefined, undefined)
      if (details == null) return params
      const documentation = displayPartsToString(details.documentation)
      return {
        ...params,
        detail: displayPartsToString(details.displayParts),
        documentation: documentation == '' ? undefined : { kind: 'markdown', value: documentation },
      }
    }
    case 'textDocument/hover': {
      const uri = params.textDocument.uri
      const info = environment.languageService.getQuickInfoAtPosition(uri, positionToOffset(uri, params.position))
      if (info == null) return null
      const documentation = displayPartsToString(info.documentation ?? [])
      const signature = displayPartsToString(info.displayParts)
      let contents = '```typescript\n' + signature + '\n```'
      if (documentation && documentation !== ';') {
        contents += '\n\n' + documentation
      }
      const start = offsetToPosition(uri, info.textSpan.start)
      const end = offsetToPosition(uri, info.textSpan.start + info.textSpan.length)
      if (start == null || end == null) return null
      return {
        contents: { kind: 'markdown', value: contents },
        range: {
          end,
          start,
        },
      }
    }
    case 'textDocument/signatureHelp': {
      const uri = params.textDocument.uri
      const context = params.context
      let triggerReason: import('typescript-lsp').SignatureHelpTriggerReason = { kind: 'invoked' }
      if (context?.triggerKind == 2 && (context.triggerCharacter == '(' || context.triggerCharacter == ',' || context.triggerCharacter == '<')) {
        triggerReason = { kind: 'characterTyped', triggerCharacter: context.triggerCharacter }
      } else if (context?.isRetrigger === true) {
        const character = context.triggerCharacter
        triggerReason =
          character == '(' || character == ',' || character == '<' || character == ')'
            ? { kind: 'retrigger', triggerCharacter: character }
            : { kind: 'retrigger' }
      }
      const help = environment.languageService.getSignatureHelpItems(uri, positionToOffset(uri, params.position), { triggerReason })
      if (help == null) return null
      return {
        activeParameter: help.argumentIndex,
        activeSignature: help.selectedItemIndex,
        signatures: help.items.map((item: import('typescript-lsp').SignatureHelpItem) => {
          const prefix = displayPartsToString(item.prefixDisplayParts)
          const separator = displayPartsToString(item.separatorDisplayParts)
          const suffix = displayPartsToString(item.suffixDisplayParts)
          const parameters = item.parameters.map((parameter: import('typescript-lsp').SignatureHelpParameter) => ({
            documentation: { kind: 'markdown', value: displayPartsToString(parameter.documentation) },
            text: displayPartsToString(parameter.displayParts),
          }))
          const documentation = displayPartsToString(item.documentation)
          let cursor = prefix.length
          return {
            documentation: documentation == '' ? undefined : { kind: 'markdown', value: documentation },
            label: prefix + parameters.map((parameter: { readonly text: string }) => parameter.text).join(separator) + suffix,
            parameters: parameters.map((parameter) => {
              const start = cursor
              cursor += parameter.text.length
              const end = cursor
              cursor += separator.length
              return { documentation: parameter.documentation, label: [start, end] }
            }),
          }
        }),
      }
    }
    default:
      throw new Error(`Method not found: ${method}`)
  }
}

function handleNotification(method: string, params: any): void {
  switch (method) {
    case 'initialized':
      return
    case 'openFlow/typing': {
      const uri = params.uri
      if (typeof uri != 'string' || typeof params.typing != 'string') return
      typings.set(uri, params.typing)
      const document = openDocuments.get(uri)
      if (document != null) ensureFile(uri, document.source)
      return
    }
    case 'textDocument/didOpen':
      ensureFile(params.textDocument.uri, params.textDocument.text)
      return
    case 'textDocument/didChange': {
      const change = params.contentChanges.at(-1)
      if (change != null && typeof change.text == 'string') ensureFile(params.textDocument.uri, change.text)
      return
    }
    case 'textDocument/didClose':
      removeFile(params.textDocument.uri)
      return
  }
}

self.addEventListener('message', (event: MessageEvent) => {
  const message = event.data
  if (message.id != null && typeof message.method == 'string') {
    try {
      // oxlint-disable-next-line unicorn/require-post-message-target-origin
      self.postMessage({ id: message.id, jsonrpc: '2.0', result: handleRequest(message.method, message.params) })
    } catch (error) {
      const response = {
        error: { code: -32603, message: error instanceof Error ? error.message : String(error) },
        id: message.id,
        jsonrpc: '2.0',
      }
      // oxlint-disable-next-line unicorn/require-post-message-target-origin
      self.postMessage(response)
    }
  } else if (typeof message.method == 'string') {
    handleNotification(message.method, message.params)
  }
})
