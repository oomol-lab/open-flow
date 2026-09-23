import type { ConnectorAction } from '../../control/common/api.ts'
import type { ConnectorCapability } from '../../flow/common/change.ts'

import { createSystem, createVirtualTypeScriptEnvironment } from '@typescript/vfs'
import ts from 'typescript-lsp'
import { describe, expect, it } from 'vitest'
import { codeTyping } from './runtime/editor/codeTyping.ts'
import { contextName, ShadowDocument } from './typeScriptShadow.ts'

const libraries = import.meta.glob<string>('../../../node_modules/typescript-lsp/lib/lib.*.d.ts', { eager: true, query: '?raw', import: 'default' })
const platform = import.meta.glob<string>('../../types/index.ts', { eager: true, query: '?raw', import: 'default' })
const declaration: ConnectorCapability = {
  kind: 'connector',
  action: 'example.echo',
  connections: [{ connectionId: 'work', alias: 'office' }, { connectionId: 'home' }],
}
const definition: ConnectorAction = {
  actionId: 'example.echo',
  authenticated: true,
  description: '',
  inputs: {},
  outputs: {},
  name: 'Echo',
  serviceId: 'example',
  serviceName: 'Example',
  inputSchema: { type: 'object', properties: { 'any': { type: 'string' }, 'optional-field': { type: 'number' } } },
  outputSchema: { type: 'object', properties: { result: { type: 'string' } }, required: ['result'] },
}

function editorService(
  source: string,
  declarations = [declaration],
  catalog: Readonly<Record<string, ConnectorAction>> = { 'example.echo': definition },
  providerIds: readonly string[] = ['example'],
) {
  const files = new Map(Object.entries(libraries).map(([path, text]) => [`/${path.split('/').at(-1)}`, text]))
  const roots = [...files.keys()]
  const types = platform['../../types/index.ts']
  if (types == null) throw new Error('Public Task types are missing.')
  files.set('/node_modules/@oomol-lab/open-flow/index.d.ts', types)
  files.set('/node_modules/@oomol-lab/open-flow/package.json', '{ "types": "index.d.ts" }')
  const shadow = new ShadowDocument(source, codeTyping({ inputs: [], outputs: [] }, declarations, catalog, providerIds))
  files.set('/module.js', shadow.text)
  const compiler = ts as unknown as Parameters<typeof createVirtualTypeScriptEnvironment>[2]
  const environment = createVirtualTypeScriptEnvironment(createSystem(files), [...roots, '/module.js'], compiler, {
    allowJs: true,
    checkJs: true,
    strict: true,
    noEmit: true,
    target: ts.ScriptTarget.ES2024,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
  })
  return { service: environment.languageService, text: shadow.text }
}

function diagnostics(source: string, declarations = [declaration], catalog: Readonly<Record<string, ConnectorAction>> = { 'example.echo': definition }) {
  return editorService(source, declarations, catalog)
    .service.getSemanticDiagnostics('/module.js')
    .map((diagnostic: ts.Diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
}

describe('Code Action editor types', () => {
  it('completes every available Provider without requiring inserted Action hints', () => {
    const { service, text } = editorService('export default async (_, ctx) => { ctx.actions. }', [], {}, ['github', 'gmail', 'sheets'])
    const position = text.indexOf('ctx.actions.') + 'ctx.actions.'.length
    const names = service.getCompletionsAtPosition('/module.js', position, {})?.entries.map((entry: ts.CompletionEntry) => entry.name)
    expect(names).toEqual(expect.arrayContaining(['call', 'github', 'gmail', 'sheets']))
  })

  it.each([{ providerIds: ['gmail'] }, { providerIds: [] }])(
    'limits completions to Code-authorized Providers $providerIds even with cached Actions and saved hints',
    ({ providerIds }) => {
      const catalog = {
        'example.echo': definition,
        'gmail.send': { ...definition, actionId: 'gmail.send', serviceId: 'gmail' },
      }
      const { service, text } = editorService('export default async (_, ctx) => { ctx.actions. }', [declaration], catalog, providerIds)
      const names = service
        .getCompletionsAtPosition('/module.js', text.indexOf('ctx.actions.') + 'ctx.actions.'.length, {})
        ?.entries.map((entry: ts.CompletionEntry) => entry.name)
      expect(names).toContain('call')
      expect(names).not.toContain('example')
      expect(names).not.toContain('example.echo')
      expect(names?.includes('gmail')).toBe(providerIds.length > 0)
      const call = editorService("export default async (_, ctx) => { ctx.actions.call('') }", [declaration], catalog, providerIds)
      const actions = call.service
        .getCompletionsAtPosition('/module.js', call.text.indexOf("call('") + "call('".length, {})
        ?.entries.map((entry: ts.CompletionEntry) => entry.name)
      expect(actions ?? []).not.toContain('example.echo')
    },
  )

  it('completes catalog Actions and checks their schemas without saved hints', () => {
    const { service, text } = editorService('export default async (_, ctx) => { ctx.actions.example. }', [], { 'example.echo': definition }, ['example'])
    const names = service
      .getCompletionsAtPosition('/module.js', text.indexOf('ctx.actions.example.') + 'ctx.actions.example.'.length, {})
      ?.entries.map((entry: ts.CompletionEntry) => entry.name)
    expect(names).toContain('echo')
    expect(diagnostics('export default async (_, ctx) => ctx.actions.example.echo({ any: 123 })', [], { 'example.echo': definition }).length).toBeGreaterThan(0)
    expect(
      diagnostics('export default async (_, ctx) => (await ctx.actions.example.echo({ any: "ok" })).result.toUpperCase()', [], { 'example.echo': definition }),
    ).toEqual([])
  })

  it('identifies the typed Action prefix as the completion replacement span', () => {
    const source = `export default async (_, ctx) => { ctx.actions.call('example.') }`
    const { service, text } = editorService(source)
    const position = text.indexOf("'example.") + "'example.".length
    const completions = service.getCompletionsAtPosition('/module.js', position, {})
    const span = completions?.optionalReplacementSpan

    expect(completions?.entries.map((entry: ts.CompletionEntry) => entry.name)).toContain('example.echo')
    expect(span == null ? undefined : text.slice(span.start, span.start + span.length)).toBe('example.')
  })

  it('types the dynamic call API for every Code Task', () => {
    expect(
      diagnostics(
        `export default async (_, ctx) => {
          await ctx.actions.call('unlisted.action', {}, { connectionId: 'outside' })
          await ctx.actions.unlisted.action({ any: 'value' })
          return {}
        }`,
        [],
      ),
    ).toEqual([])
  })

  it('completes shared catalog Actions without a node Action list', () => {
    const permissions: ConnectorCapability[] = [{ kind: 'connector', mode: 'shared' }]
    expect(diagnostics("export default async (_, ctx) => ctx.actions.example.echo({ any: 'value' })", permissions)).toEqual([])
    expect(diagnostics("export default async (_, ctx) => ctx.actions.call('example.echo', {}, { connectionId: 'work' })", permissions)).toEqual([])
    expect(diagnostics("export default async (_, ctx) => ctx.actions.call('other.read', {})", permissions).length).toBeGreaterThan(0)
  })

  it('limits configured Code completions to the node Action list', () => {
    const permissions: ConnectorCapability[] = [{ kind: 'connector', mode: 'independent', actions: [{ action: 'example.echo' }] }]
    const source = 'export default async (_, ctx) => { ctx.actions. }'
    const { service, text } = editorService(
      source,
      permissions,
      { 'example.echo': definition, 'other.read': { ...definition, actionId: 'other.read', serviceId: 'other' } },
      ['example', 'other'],
    )
    const names = service
      .getCompletionsAtPosition('/module.js', text.indexOf('ctx.actions.') + 'ctx.actions.'.length, {})
      ?.entries.map((entry: ts.CompletionEntry) => entry.name)
    expect(names).toContain('example')
    expect(names).not.toContain('other')
    expect(diagnostics("export default async (_, ctx) => ctx.actions.call('other.read', {})", permissions).length).toBeGreaterThan(0)
  })

  it('adds precise overloads for hinted Actions while keeping the dynamic fallback', () => {
    expect(
      diagnostics(
        `export default async (_, ctx) => {
          const result = await ctx.actions.call('example.echo', { any: 'value' }, { connectionId: 'work' })
          const nested = await ctx.actions.example.echo({ any: 'value' })
          await ctx.actions.call('unlisted.action', {})
          await ctx.actions.example.unlisted({ anything: true })
          return { text: result.result.toUpperCase() + nested.result }
        }`,
        [
          {
            kind: 'connector',
            actionHints: ['example.echo'],
            connectionHints: [{ action: 'example.echo', connectionId: 'work' }],
          },
        ],
      ),
    ).toEqual([])
    expect(
      diagnostics(
        `export default async (_, ctx) => {
          await ctx.actions.call('example.echo', { any: 1 }, { connectionId: 'other' })
          return {}
        }`,
        [{ kind: 'connector', actionHints: ['example.echo'], connectionHints: [{ action: 'example.echo', connectionId: 'work' }] }],
      ).length,
    ).toBeGreaterThan(0)
  })

  it('checks both APIs against raw optional fields, output schemas and exact Connection choices', () => {
    expect(
      diagnostics(`export default async (_, ctx) => {
      const first = await ctx.actions.example.echo({}, { connectionId: 'work' })
      const second = await ctx.actions['example.echo']({ any: 'ok', 'optional-field': 1 }, { connectionAlias: 'office' })
      return { text: first.result.toUpperCase() + second.result }
    }`),
    ).toEqual([])
    expect(contextName('export default async (data, renamed) => ({})')).toBe('renamed')
  })

  it.each([
    'ctx.actions.example.echo({})',
    "ctx.actions.example.echo({}, { connectionId: 'other' })",
    "ctx.actions.example.echo({}, { connectionAlias: 'renamed' })",
    "ctx.actions.example.echo({}, { connectionId: 'work', connectionAlias: 'office' })",
    "ctx.actions.example.echo({ any: 1 }, { connectionId: 'work' })",
  ])('diagnoses invalid calls: %s', (call) => {
    expect(diagnostics(`export default async (_, ctx) => { await ${call}; return {} }`).length).toBeGreaterThan(0)
  })

  it('allows omitted input only when the schema and Connection selection permit it', () => {
    const source = `export default async (_, ctx) => {
      await ctx.actions.example.echo()
      await ctx.actions['example.echo']()
      return {}
    }`
    const defaults = [{ ...declaration, connectionId: 'work' }]
    expect(diagnostics(source, defaults)).toEqual([])
    expect(diagnostics(source, [{ ...declaration, connections: [] }])).toEqual([])
    expect(diagnostics(source, defaults, {})).toEqual([])
    expect(diagnostics(source).length).toBeGreaterThan(0)
    expect(
      diagnostics(source, defaults, {
        'example.echo': { ...definition, inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
      }).length,
    ).toBeGreaterThan(0)
    expect(
      diagnostics(`export default async (_, ctx) => {
      await ctx.actions.example.echo(undefined, { connectionId: 'work' })
      return {}
    }`),
    ).toEqual([])
  })

  it('allows dynamic IDs and diagnoses removed Connection aliases for hinted Actions', () => {
    const source = `export default async (_, ctx) => {
      /** @type {string} */ const id = 'example.echo'
      await ctx.actions[id]({}, { connectionId: 'work' })
      return {}
    }`
    expect(diagnostics(source)).toEqual([])
    expect(
      diagnostics(`export default async (_, ctx) => { await ctx.actions.example.echo({}, { connectionAlias: 'office' }); return {} }`, [
        { ...declaration, connections: [{ connectionId: 'work' }] },
      ]).length,
    ).toBeGreaterThan(0)
    expect(diagnostics(`export default async (_, ctx) => { await ctx.actions.example.echo({}); return {} }`, [])).toEqual([])
  })

  it('permits omitted options for a default or public Action and keeps missing schemas unknown', () => {
    const source = `export default async (_, ctx) => { await ctx.actions.example.echo({}); return {} }`
    expect(diagnostics(source, [{ ...declaration, connectionId: 'work' }])).toEqual([])
    expect(diagnostics(source, [{ ...declaration, connections: [] }])).toEqual([])
    expect(
      diagnostics(
        `export default async (_, ctx) => { const result = await ctx.actions.example.echo({}, { connectionId: 'work' }); return { value: result.value } }`,
        [declaration],
        {},
      ).join(' '),
    ).toContain('unknown')
  })

  it('accepts declared ID unions and requires narrowing when their inputs differ', () => {
    const declarations = [declaration, { ...declaration, action: 'example.other' }]
    const source = `export default async (_, ctx) => {
      const id = Math.random() > 0.5 ? 'example.echo' : 'example.other'
      await ctx.actions[id]({ any: 'ok' }, { connectionId: 'work' })
      return {}
    }`
    const catalog = { 'example.echo': definition, 'example.other': { ...definition, actionId: 'example.other' } }
    expect(diagnostics(source, declarations, catalog)).toEqual([])
    const different = {
      ...catalog,
      'example.other': { ...catalog['example.other'], inputSchema: { type: 'object', properties: { count: { type: 'number' } }, required: ['count'] } },
    }
    expect(diagnostics(source, declarations, different).length).toBeGreaterThan(0)
    expect(
      diagnostics(
        source.replace(
          "await ctx.actions[id]({ any: 'ok' }, { connectionId: 'work' })",
          "if (id === 'example.echo') await ctx.actions[id]({ any: 'ok' }, { connectionId: 'work' }); else await ctx.actions[id]({ count: 1 }, { connectionId: 'work' })",
        ),
        declarations,
        different,
      ),
    ).toEqual([])
  })
})
