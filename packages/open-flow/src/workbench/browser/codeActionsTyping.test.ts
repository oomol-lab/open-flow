import type { ConnectorAction } from '../../control/common/api.ts'
import type { ConnectorCapability } from '../../flow/common/change.ts'

import { createSystem, createVirtualTypeScriptEnvironment } from '@typescript/vfs'
import ts from 'typescript-lsp'
import { describe, expect, it } from 'vitest'
import { codeTyping } from './runtime/designer/flowChanges.ts'
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

function diagnostics(source: string, declarations = [declaration], catalog: Readonly<Record<string, ConnectorAction>> = { 'example.echo': definition }) {
  const files = new Map(Object.entries(libraries).map(([path, text]) => [`/${path.split('/').at(-1)}`, text]))
  const roots = [...files.keys()]
  const types = platform['../../types/index.ts']
  if (types == null) throw new Error('Public Task types are missing.')
  files.set('/node_modules/@oomol-lab/open-flow/index.d.ts', types)
  files.set('/node_modules/@oomol-lab/open-flow/package.json', '{ "types": "index.d.ts" }')
  const shadow = new ShadowDocument(source, codeTyping({ inputs: [], outputs: [] }, declarations, catalog))
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
  return environment.languageService
    .getSemanticDiagnostics('/module.js')
    .map((diagnostic: ts.Diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
}

describe('Code Action editor types', () => {
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
    "ctx.actions['example.missing']({})",
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

  it('requires narrowing an arbitrary string and diagnoses removed bindings', () => {
    const source = `export default async (_, ctx) => {
      /** @type {string} */ const id = 'example.echo'
      await ctx.actions[id]({}, { connectionId: 'work' })
      return {}
    }`
    expect(diagnostics(source).length).toBeGreaterThan(0)
    expect(diagnostics(source.replace('await ctx.actions[id]', "if (id === 'example.echo') await ctx.actions[id]"))).toEqual([])
    expect(
      diagnostics(`export default async (_, ctx) => { await ctx.actions.example.echo({}, { connectionAlias: 'office' }); return {} }`, [
        { ...declaration, connections: [{ connectionId: 'work' }] },
      ]).length,
    ).toBeGreaterThan(0)
    expect(diagnostics(`export default async (_, ctx) => { await ctx.actions.example.echo({}); return {} }`, []).length).toBeGreaterThan(0)
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
