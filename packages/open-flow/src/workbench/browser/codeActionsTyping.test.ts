import type { ConnectorAction } from '../../control/common/api.ts'
import type { ConnectorCapability, TaskCapability } from '../../flow/common/change.ts'

import { createSystem, createVirtualTypeScriptEnvironment } from '@typescript/vfs'
import ts from 'typescript-lsp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { codeCompilerOptions, codeTypeFiles, codeTypeRoots } from './codeTypes.ts'
import { codeTyping } from './runtime/editor/codeTyping.ts'
import { contextName, ShadowDocument } from './typeScriptShadow.ts'

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

let environment: ReturnType<typeof createVirtualTypeScriptEnvironment>
beforeAll(() => {
  const files = new Map(codeTypeFiles)
  files.set('file:///module.js', 'export {}')
  const compiler = ts as unknown as Parameters<typeof createVirtualTypeScriptEnvironment>[2]
  environment = createVirtualTypeScriptEnvironment(createSystem(files), [...codeTypeRoots, 'file:///module.js'], compiler, codeCompilerOptions)
})
afterAll(() => environment?.languageService.dispose())

function editorService(
  source: string,
  declarations: readonly TaskCapability[] = [declaration],
  catalog: Readonly<Record<string, ConnectorAction>> = { 'example.echo': definition },
  providerIds: readonly string[] = ['example'],
) {
  const shadow = new ShadowDocument(source, codeTyping({ inputs: [], outputs: [] }, declarations, catalog, providerIds))
  environment.updateFile('file:///module.js', shadow.text)
  return { service: environment.languageService, text: shadow.text }
}

function diagnostics(
  source: string,
  declarations: readonly TaskCapability[] = [declaration],
  catalog: Readonly<Record<string, ConnectorAction>> = { 'example.echo': definition },
) {
  return editorService(source, declarations, catalog)
    .service.getSemanticDiagnostics('file:///module.js')
    .map((diagnostic: ts.Diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
}

describe('Code Action editor types', () => {
  it('resolves previous node outputs and definitions through public Task types', () => {
    expect(
      diagnostics(`export default async (_, context) => {
      const [previous] = await context.getPrevious();
      if (!previous) return {};
      const definition = previous.outputDefs.find(def => def.handle === 'items');
      return { value: previous.outputs.items, schema: definition?.jsonSchema, name: previous.name };
    }`),
    ).toEqual([])
    expect(
      diagnostics(`export default async (_, context) => {
      const previous = await context.getPrevious();
      return { value: previous.outputs.items };
    }`).some((message: string) => message.includes('does not exist')),
    ).toBe(true)
  })

  it('completes every available Provider without requiring inserted Action hints', () => {
    const { service, text } = editorService('export default async (_, ctx) => { ctx.actions. }', [], {}, ['github', 'gmail', 'sheets'])
    const position = text.indexOf('ctx.actions.') + 'ctx.actions.'.length
    const names = service.getCompletionsAtPosition('file:///module.js', position, {})?.entries.map((entry: ts.CompletionEntry) => entry.name)
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
        .getCompletionsAtPosition('file:///module.js', text.indexOf('ctx.actions.') + 'ctx.actions.'.length, {})
        ?.entries.map((entry: ts.CompletionEntry) => entry.name)
      expect(names).toContain('call')
      expect(names).not.toContain('example')
      expect(names).not.toContain('example.echo')
      expect(names?.includes('gmail')).toBe(providerIds.length > 0)
      const call = editorService("export default async (_, ctx) => { ctx.actions.call('') }", [declaration], catalog, providerIds)
      const actions = call.service
        .getCompletionsAtPosition('file:///module.js', call.text.indexOf("call('") + "call('".length, {})
        ?.entries.map((entry: ts.CompletionEntry) => entry.name)
      expect(actions ?? []).not.toContain('example.echo')
    },
  )

  it('completes catalog Actions and checks their schemas without saved hints', () => {
    const { service, text } = editorService('export default async (_, ctx) => { ctx.actions.example. }', [], { 'example.echo': definition }, ['example'])
    const names = service
      .getCompletionsAtPosition('file:///module.js', text.indexOf('ctx.actions.example.') + 'ctx.actions.example.'.length, {})
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
    const completions = service.getCompletionsAtPosition('file:///module.js', position, {})
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
      .getCompletionsAtPosition('file:///module.js', text.indexOf('ctx.actions.') + 'ctx.actions.'.length, {})
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

it('completes workflow aliases and validates saved input and output types', () => {
  const workflows: readonly TaskCapability[] = [
    {
      kind: 'workflow',
      name: 'double',
      flowId: 'target',
      revisionId: 'snapshot',
      inputs: [
        { handle: 'amount', jsonSchema: { type: 'number' }, nullable: false },
        { handle: 'note', jsonSchema: { type: 'string' }, nullable: true },
      ],
      outputs: [{ handle: 'total', jsonSchema: { type: 'number' }, nullable: false }],
    },
  ]
  const call = editorService("export default async (_, ctx) => ctx.workflows.call('')", workflows)
  const names = call.service
    .getCompletionsAtPosition('file:///module.js', call.text.indexOf("call('") + "call('".length, {})
    ?.entries.map((entry: ts.CompletionEntry) => entry.name)
  expect(names).toContain('double')
  expect(diagnostics("export default async (_, ctx) => (await ctx.workflows.call('double', { amount: 0, note: null })).total.toFixed(2)", workflows)).toEqual(
    [],
  )
  for (const [invalid, expected] of [
    ["ctx.workflows.call('missing', {})", `Argument of type '"missing"' is not assignable to parameter of type '"double"'.`],
    ["ctx.workflows.call('double')", 'Expected 2 arguments, but got 1.'],
    ["ctx.workflows.call('double', { amount: 'wrong' })", "Type 'string' is not assignable to type 'number'."],
    ["(await ctx.workflows.call('double', { amount: -2 })).total.toUpperCase()", "Property 'toUpperCase' does not exist on type 'number'."],
  ])
    expect(diagnostics(`export default async (_, ctx) => ${invalid}`, workflows)).toContain(expected)
})

it('escapes workflow handles and enum values throughout the TaskContext JSDoc', () => {
  const workflows: readonly TaskCapability[] = [
    {
      kind: 'workflow',
      name: 'echo',
      flowId: 'target',
      revisionId: 'snapshot',
      inputs: [{ handle: 'input*/', jsonSchema: { type: 'string', enum: ['value*/'] }, nullable: false }],
      outputs: [{ handle: 'output*/', jsonSchema: { type: 'string', enum: ['result*/'] }, nullable: false }],
    },
  ]
  const source = "export default async (_, ctx) => (await ctx.workflows.call('echo', { 'input*/': 'value*/' }))['output*/'].toUpperCase()"
  const { service } = editorService(source, workflows)
  expect(service.getSyntacticDiagnostics('file:///module.js')).toEqual([])
  expect(diagnostics(source, workflows)).toEqual([])
  expect(diagnostics(source.replace('toUpperCase()', 'toFixed()'), workflows)).toEqual([
    expect.stringContaining(`Property 'toFixed' does not exist on type '"result*/"'.`),
  ])
})
