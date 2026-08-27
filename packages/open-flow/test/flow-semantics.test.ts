import type { JsonValue, RevisionContent as RevisionFixture } from '../src/flow/common/change.ts'

import { describe, expect, it } from 'vitest'
import { currentEngineContract, findEngineContract } from '../src/execution/common/runtime.ts'
import { createRuntimeProgram, prepareFlow, validateFlow, validateFlowInputs, validateModules } from '../src/flow/common/semantics.ts'

const engine = findEngineContract(currentEngineContract)!

function revision(source: string, imports: readonly string[] = [], modules: RevisionFixture['modules'] = {}): RevisionFixture {
  return {
    document: {
      bindings: {},
      graph: {
        nodes: {
          task: { concurrency: 1, inputs: {}, kind: 'task', task: { inputs: [], moduleId: 'module-main', name: 'Main', outputs: [] } },
        },
      },
      subflows: {},
      tasks: {},
    },
    modelVersion: 1,
    modules: {
      'module-main': { imports, name: 'Main', source },
      ...modules,
    },
  }
}

function validate(source: RevisionFixture, moduleIds: readonly string[]) {
  return validateModules(source, moduleIds, engine)
}

function variableRevision(jsonSchema: JsonValue): RevisionFixture {
  const source = revision('export default ({ token }) => ({ token })')
  const task = source.document.graph.nodes.task
  if (task?.kind != 'task' || task.task == null) throw new Error('Fixture inline Task is missing.')
  return {
    ...source,
    document: {
      ...source.document,
      bindings: { token: { kind: 'variable', target: 'TOKEN' } },
      graph: {
        nodes: {
          task: {
            ...task,
            inputs: { token: { kind: 'sources', sources: [{ bindingId: 'token', kind: 'binding' }] } },
            task: { ...task.task, inputs: [{ handle: 'token', jsonSchema, nullable: false }] },
          },
        },
      },
    },
  }
}

describe('Flow semantics', () => {
  it('accepts declared static Flow imports and the unprivileged Platform Library', () => {
    const source = revision(
      `import { value } from "./module-helper.mjs"
import { engineContract, identity } from "open-flow:platform"
export function run() { return identity({ engineContract, value }) }`,
      ['module-helper'],
      {
        'module-helper': { imports: [], name: 'Helper', source: 'export const value = 1' },
      },
    )

    expect(validate(source, ['module-main', 'module-helper'])).toEqual([])
  })

  it('maps syntax, missing Module and missing export diagnostics to user source', () => {
    const syntax = validate(revision('export function broken( {'), ['module-main'])
    const missingModule = validate(revision('import { value } from "./module-missing.mjs"\nexport { value }'), ['module-main'])
    const missingExport = validate(
      revision('import { missing } from "./module-helper.mjs"\nexport { missing }', ['module-helper'], {
        'module-helper': { imports: [], name: 'Helper', source: 'export const value = 1' },
      }),
      ['module-main', 'module-helper'],
    )

    expect(syntax).toMatchObject([{ code: 'module.syntax', line: 1, path: '/modules/module-main/source' }])
    expect(missingModule).toMatchObject([{ code: 'module.missing', line: 1, path: '/modules/module-main/source' }])
    expect(missingExport).toMatchObject([{ code: 'module.missing-export', line: 1, path: '/modules/module-main/source' }])
  })

  it('rejects npm, Node, remote, dynamic and undeclared imports deterministically', () => {
    const unsupported = validate(
      revision(`import react from "react"
import fs from "node:fs"
import remote from "https://example.com/module.mjs"
export async function run(name) { return await import(name) }
export { react, fs, remote }`),
      ['module-main'],
    )
    const undeclared = validate(
      revision('import { value } from "./module-helper.mjs"\nexport { value }', [], {
        'module-helper': { imports: [], name: 'Helper', source: 'export const value = 1' },
      }),
      ['module-main'],
    )
    const declaredWithoutSource = validate(
      revision('export const value = 1', ['module-helper'], {
        'module-helper': { imports: [], name: 'Helper', source: 'export const value = 1' },
      }),
      ['module-main', 'module-helper'],
    )

    expect(unsupported.map((diagnostic) => diagnostic.code)).toEqual([
      'module.unsupported-import',
      'module.unsupported-import',
      'module.unsupported-import',
      'module.dynamic-import',
    ])
    expect(undeclared).toMatchObject([{ code: 'module.import-not-declared', path: '/modules/module-main/source' }])
    expect(declaredWithoutSource).toMatchObject([{ code: 'module.declared-import-missing', path: '/modules/module-main/source' }])
  })

  it('rejects CommonJS and dynamic code evaluation', () => {
    const diagnostics = validate(
      revision(`export function run(source) {
  require("module")
  eval(source)
  Function(source)
  return new Function(source)
}`),
      ['module-main'],
    )

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['module.commonjs', 'module.dynamic-code', 'module.dynamic-code', 'module.dynamic-code'])
  })

  it('prepares a valid fixed Revision and derives a closed RuntimeProgram', async () => {
    const source = revision(
      `import { value } from "./module-helper.mjs"
export default () => value`,
      ['module-helper'],
      { 'module-helper': { imports: [], name: 'Helper', source: 'export const value = 1' } },
    )

    const result = await prepareFlow(source, currentEngineContract)

    expect(result).toMatchObject({ kind: 'prepared', validation: { diagnostics: [], valid: true } })
    if (result.kind != 'prepared') return
    expect(result.flow.modules).toEqual(source.modules)
    expect(createRuntimeProgram(result.flow, 'module-main', 'sha256:implementation')).toMatchObject({
      engineContract: currentEngineContract,
      engineDigest: 'sha256:implementation',
      entryModuleId: 'module-main',
      modules: source.modules,
    })
    expect(createRuntimeProgram(result.flow, 'outside-closure', 'sha256:implementation')).toBeUndefined()
  })

  it('reports unsupported Engine, invalid Flow, and invalid invocation inputs without platform errors', async () => {
    await expect(prepareFlow(revision('export default () => true'), 'unsupported')).resolves.toEqual({ kind: 'engine-unsupported' })
    await expect(prepareFlow(revision('export const value = true'), currentEngineContract)).resolves.toMatchObject({
      kind: 'flow-invalid',
      validation: { diagnostics: [expect.objectContaining({ code: 'task.missing-entry' })], valid: false },
    })
    expect(validateFlowInputs(revision('export default () => true'), { missing: {} })).toBe('invalid')
  })

  it('rejects retired Runtime Ref schemas before execution', async () => {
    const source = revision('export default ({ value }) => ({ value })')
    const task = source.document.graph.nodes.task
    if (task?.kind != 'task' || task.task == null) throw new Error('Fixture inline Task is missing.')
    const invalid: RevisionFixture = {
      ...source,
      document: {
        ...source.document,
        graph: {
          nodes: {
            task: {
              ...task,
              task: {
                ...task.task,
                inputs: [
                  {
                    handle: 'value',
                    jsonSchema: { properties: { nested: { contentMediaType: 'oomol/ref' } }, type: 'object' },
                    nullable: false,
                  },
                ],
              },
            },
          },
        },
      },
    }

    await expect(validateFlow(invalid, engine)).resolves.toMatchObject({
      diagnostics: [{ code: 'graph.schema-unsupported', path: '/document/graph/nodes/task' }],
      valid: false,
    })
    expect(validateFlowInputs(invalid, { task: { value: {} } })).toBe('invalid')
  })

  it('allows ordinary data that resembles a retired Runtime Ref schema', async () => {
    const source = revision('export default ({ value }) => ({ value })')
    const task = source.document.graph.nodes.task
    if (task?.kind != 'task' || task.task == null) throw new Error('Fixture inline Task is missing.')
    const value = { contentMediaType: 'oomol/ref' }
    const valid: RevisionFixture = {
      ...source,
      document: {
        ...source.document,
        graph: {
          nodes: {
            task: {
              ...task,
              task: {
                ...task.task,
                inputs: [{ handle: 'value', jsonSchema: {}, nullable: false, value }],
              },
            },
          },
        },
      },
    }

    await expect(validateFlow(valid, engine)).resolves.toMatchObject({ diagnostics: [], valid: true })
  })

  it('rejects incomplete Connector Capability declarations on inline Tasks', async () => {
    const source = revision('export default () => ({})')
    const task = source.document.graph.nodes.task
    if (task?.kind != 'task' || task.task == null) throw new Error('Fixture inline Task is missing.')
    const invalid: RevisionFixture = {
      ...source,
      document: {
        ...source.document,
        graph: {
          nodes: {
            task: {
              ...task,
              task: { ...task.task, capabilities: [{ action: '', connectionId: 'connection-1', kind: 'connector' }] },
            },
          },
        },
      },
    }

    await expect(prepareFlow(invalid, currentEngineContract)).resolves.toMatchObject({
      kind: 'flow-invalid',
      validation: {
        diagnostics: [expect.objectContaining({ code: 'task.capability-incomplete', path: '/document/graph/nodes/task/task/capabilities/0' })],
      },
    })
  })

  it('validates Variable bindings as exclusive unconstrained string inputs', async () => {
    await expect(validateFlow(variableRevision({ type: 'string' }), engine)).resolves.toMatchObject({ diagnostics: [], valid: true })
    await expect(validateFlow(variableRevision({ type: ['string', 'null'] }), engine)).resolves.toMatchObject({ diagnostics: [], valid: true })
    await expect(validateFlow(variableRevision({}), engine)).resolves.toMatchObject({ diagnostics: [], valid: true })

    const restricted = await validateFlow(variableRevision({ enum: ['allowed'], type: 'string' }), engine)
    expect(restricted.diagnostics).toEqual([expect.objectContaining({ code: 'graph.variable-incompatible' })])

    const restrictedUnion = await validateFlow(variableRevision({ pattern: '^allowed$', type: ['string', 'null'] }), engine)
    expect(restrictedUnion.diagnostics).toEqual([expect.objectContaining({ code: 'graph.variable-incompatible' })])

    const numberUnion = await validateFlow(variableRevision({ type: ['number', 'null'] }), engine)
    expect(numberUnion.diagnostics).toEqual([expect.objectContaining({ code: 'graph.variable-incompatible' })])

    const connection = variableRevision({ type: 'string' })
    const connectionResult = await validateFlow(
      { ...connection, document: { ...connection.document, bindings: { token: { kind: 'connection', target: 'connection-1' } } } },
      engine,
    )
    expect(connectionResult.diagnostics).toEqual([expect.objectContaining({ code: 'graph.binding-invalid' })])

    const mixed = variableRevision({ type: 'string' })
    const task = mixed.document.graph.nodes.task
    if (task?.kind != 'task') throw new Error('Fixture Task is missing.')
    const mixedResult = await validateFlow(
      {
        ...mixed,
        document: {
          ...mixed.document,
          graph: {
            nodes: {
              task: {
                ...task,
                inputs: {
                  token: {
                    kind: 'sources',
                    sources: [
                      { bindingId: 'token', kind: 'binding' },
                      { input: 'token', kind: 'flow' },
                    ],
                  },
                },
              },
            },
          },
        },
      },
      engine,
    )
    expect(mixedResult.diagnostics.map(({ code }) => code)).toContain('graph.variable-source-mixed')

    const invalidName = variableRevision({ type: 'string' })
    const invalidNameResult = await validateFlow(
      { ...invalidName, document: { ...invalidName.document, bindings: { token: { kind: 'variable', target: 'OO_TOKEN' } } } },
      engine,
    )
    expect(invalidNameResult.diagnostics).toEqual([expect.objectContaining({ code: 'binding.variable-invalid' })])
  })
})
