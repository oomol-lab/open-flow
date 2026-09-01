import type { JsonValue, RevisionContent as RevisionFixture } from '../src/flow/common/change.ts'

import { describe, expect, it } from 'vitest'
import { currentEngineContract, findEngineContract } from '../src/execution/common/runtime.ts'
import { createRuntimeProgram, matchesSchema, prepareFlow, validateFlow, validateFlowInputs, validateModules } from '../src/flow/common/semantics.ts'

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

function triggerRevision(config: Readonly<Record<string, JsonValue>>, jsonSchema: Readonly<Record<string, JsonValue>>): RevisionFixture {
  const source = revision('export default ({ input }) => ({ input })')
  const task = source.document.graph.nodes.task
  if (task?.kind != 'task' || task.task == null) throw new Error('Fixture inline Task is missing.')
  return {
    ...source,
    document: {
      ...source.document,
      bindings: { trigger: { kind: 'connection', target: 'connection-1' } },
      graph: {
        nodes: {
          trigger: {
            bindingId: 'trigger',
            config,
            definition: {
              configSchema: {
                additionalProperties: false,
                properties: { event: { enum: ['push'], type: 'string' } },
                required: ['event'],
                type: 'object',
              },
              definitionVersion: 1,
              description: 'Runs when a repository changes.',
              displayName: 'Repository event',
              endpoint: {
                body: { allowArray: false, allowEmpty: false, formats: ['json'] },
                methods: ['POST'],
                successStatus: 200,
              },
              key: 'github.on_repo_event',
              name: 'on_repo_event',
              payloadSchema: { description: 'Repository name.', type: 'string' },
              provider: 'github',
              type: 'integration',
            },
            kind: 'integration',
            name: 'Repository event',
          },
          task: {
            ...task,
            inputs: { input: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'trigger', output: 'payload' }] } },
            task: { ...task.task, inputs: [{ handle: 'input', jsonSchema, nullable: false }] },
          },
        },
      },
    },
  }
}

describe('Schema value matching', () => {
  it.each([
    { expected: true, name: 'accepts a true schema', schema: true, value: null },
    { expected: false, name: 'rejects a false schema', schema: false, value: null },
    { expected: false, name: 'rejects a non-schema value', schema: null, value: null },
    { expected: true, name: 'accepts matching allOf branches', schema: { allOf: [{ type: 'string' }, { minLength: 2 }] }, value: 'ok' },
    { expected: false, name: 'rejects a failing allOf branch', schema: { allOf: [{ type: 'string' }, { minLength: 3 }] }, value: 'ok' },
    { expected: true, name: 'accepts a matching anyOf branch', schema: { anyOf: [{ type: 'string' }, { type: 'number' }] }, value: 1 },
    { expected: false, name: 'rejects when no anyOf branch matches', schema: { anyOf: [{ type: 'string' }, { type: 'number' }] }, value: false },
    { expected: true, name: 'accepts exactly one oneOf branch', schema: { oneOf: [{ minimum: 0 }, { type: 'string' }] }, value: 1 },
    { expected: false, name: 'rejects overlapping oneOf branches', schema: { oneOf: [{ minimum: 0 }, { type: 'number' }] }, value: 1 },
    { expected: true, name: 'accepts a value outside not', schema: { not: { type: 'number' } }, value: 'ok' },
    { expected: false, name: 'rejects a value inside not', schema: { not: { type: 'number' } }, value: 1 },
    { expected: true, name: 'accepts a deep-equal const', schema: { const: { values: [1] } }, value: { values: [1] } },
    { expected: false, name: 'rejects a different const', schema: { const: { values: [1] } }, value: { values: [2] } },
    { expected: true, name: 'accepts an enum member', schema: { enum: ['push', 'pull'] }, value: 'push' },
    { expected: false, name: 'rejects a value outside enum', schema: { enum: ['push', 'pull'] }, value: 'delete' },
    { expected: true, name: 'accepts a member of a type union', schema: { type: ['string', 'null'] }, value: null },
    { expected: true, name: 'accepts an integer', schema: { type: 'integer' }, value: 1 },
    { expected: false, name: 'rejects a fractional integer', schema: { type: 'integer' }, value: 1.5 },
    { expected: true, name: 'accepts string length and pattern constraints', schema: { maxLength: 4, minLength: 2, pattern: '^o' }, value: 'ok' },
    { expected: false, name: 'rejects a short string', schema: { minLength: 3 }, value: 'ok' },
    { expected: false, name: 'rejects a long string', schema: { maxLength: 1 }, value: 'ok' },
    { expected: false, name: 'rejects a pattern mismatch', schema: { pattern: '^a' }, value: 'ok' },
    { expected: false, name: 'rejects an invalid pattern', schema: { pattern: '[' }, value: 'ok' },
    { expected: true, name: 'accepts inclusive number bounds', schema: { maximum: 2, minimum: 1 }, value: 1 },
    { expected: false, name: 'rejects a number below minimum', schema: { minimum: 1 }, value: 0 },
    { expected: false, name: 'rejects a number above maximum', schema: { maximum: 1 }, value: 2 },
    { expected: false, name: 'rejects exclusive minimum equality', schema: { exclusiveMinimum: 1 }, value: 1 },
    { expected: false, name: 'rejects exclusive maximum equality', schema: { exclusiveMaximum: 1 }, value: 1 },
    { expected: true, name: 'accepts array length and item constraints', schema: { items: { type: 'number' }, maxItems: 2, minItems: 1 }, value: [1] },
    { expected: false, name: 'rejects a short array', schema: { minItems: 1 }, value: [] },
    { expected: false, name: 'rejects a long array', schema: { maxItems: 1 }, value: [1, 2] },
    { expected: false, name: 'rejects an invalid array item', schema: { items: { type: 'number' } }, value: [1, 'two'] },
    {
      expected: true,
      name: 'accepts required object properties',
      schema: { properties: { id: { type: 'number' } }, required: ['id'], type: 'object' },
      value: { id: 1 },
    },
    { expected: false, name: 'rejects a missing required property', schema: { required: ['id'], type: 'object' }, value: {} },
    { expected: false, name: 'rejects a non-string required entry', schema: { required: [1], type: 'object' }, value: {} },
    { expected: false, name: 'rejects an invalid object property', schema: { properties: { id: { type: 'number' } }, type: 'object' }, value: { id: 'one' } },
    { expected: false, name: 'rejects a forbidden additional property', schema: { additionalProperties: false, type: 'object' }, value: { id: 1 } },
    { expected: true, name: 'accepts an additional property schema', schema: { additionalProperties: { type: 'number' }, type: 'object' }, value: { id: 1 } },
    {
      expected: false,
      name: 'rejects an invalid additional property',
      schema: { additionalProperties: { type: 'number' }, type: 'object' },
      value: { id: 'one' },
    },
    { expected: false, name: 'rejects invalid properties metadata', schema: { properties: [], type: 'object' }, value: {} },
  ])('$name', ({ expected, schema, value }) => {
    expect(matchesSchema(value as JsonValue, schema as JsonValue)).toBe(expected)
  })
})

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

    expect(syntax).toMatchObject([{ code: 'module.syntax', line: 1, path: '/modules/module-main/source', values: { moduleId: 'module-main' } }])
    expect(missingModule).toMatchObject([{ code: 'module.missing', line: 1, path: '/modules/module-main/source' }])
    expect(missingExport).toMatchObject([
      {
        code: 'module.missing-export',
        line: 1,
        path: '/modules/module-main/source',
        values: { moduleId: 'module-helper', name: 'missing', variant: 'module' },
      },
    ])
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

  it('allows Connector Tasks without a Connection during deterministic validation', async () => {
    const source: RevisionFixture = {
      document: {
        bindings: {},
        graph: { nodes: { news: { concurrency: 1, inputs: {}, kind: 'task', taskId: 'news' } } },
        subflows: {},
        tasks: {
          news: {
            executor: { action: 'hacker-news.get-ask-stories', kind: 'connector' },
            inputs: [],
            name: 'Get Ask Stories',
            outputs: [],
          },
        },
      },
      modelVersion: 1,
      modules: {},
    }

    await expect(validateFlow(source, engine)).resolves.toMatchObject({ diagnostics: [], valid: true })
  })

  it('reports an unconnected provider Trigger without rejecting its Draft shape', async () => {
    const source: RevisionFixture = {
      document: {
        bindings: {},
        graph: {
          nodes: {
            trigger: {
              bindingId: 'binding',
              config: {},
              definition: {
                configSchema: { additionalProperties: false, type: 'object' },
                definitionVersion: 1,
                description: 'Runs when a repository changes.',
                displayName: 'Repository event',
                endpoint: {
                  body: { allowArray: false, allowEmpty: false, formats: ['json'] },
                  methods: ['POST'],
                  successStatus: 200,
                },
                key: 'github.on_repo_event',
                name: 'on_repo_event',
                payloadSchema: { additionalProperties: true, type: 'object' },
                provider: 'github',
                type: 'integration',
              },
              kind: 'integration',
              name: 'Repository event',
            },
          },
        },
        subflows: {},
        tasks: {},
      },
      modelVersion: 1,
      modules: {},
    }

    await expect(validateFlow(source, engine)).resolves.toMatchObject({
      diagnostics: [
        expect.objectContaining({
          code: 'trigger.connection-missing',
          path: '/document/graph/nodes/trigger/bindingId',
          values: { bindingId: 'binding' },
        }),
      ],
      valid: false,
    })
  })

  it('validates provider Trigger config and payload connections', async () => {
    await expect(validateFlow(triggerRevision({ event: 'push' }, { type: 'string' }), engine)).resolves.toMatchObject({ diagnostics: [], valid: true })

    await expect(validateFlow(triggerRevision({ event: 'push' }, { type: 'number' }), engine)).resolves.toMatchObject({
      diagnostics: [expect.objectContaining({ code: 'graph.node-output-incompatible', path: '/document/graph/nodes/task/inputs/input' })],
      valid: false,
    })

    await expect(validateFlow(triggerRevision({}, { type: 'string' }), engine)).resolves.toMatchObject({
      diagnostics: [expect.objectContaining({ code: 'trigger.config-incomplete', path: '/document/graph/nodes/trigger/config' })],
      valid: false,
    })

    await expect(validateFlow(triggerRevision({ event: 'delete' }, { type: 'string' }), engine)).resolves.toMatchObject({
      diagnostics: [expect.objectContaining({ code: 'trigger.config-invalid', path: '/document/graph/nodes/trigger/config' })],
      valid: false,
    })
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

  it('accepts an annotated string output for an unconstrained string input', async () => {
    const source = revision('export default ({ input }) => ({ input })')
    const task = source.document.graph.nodes.task
    if (task?.kind != 'task' || task.task == null) throw new Error('Fixture inline Task is missing.')
    const valid: RevisionFixture = {
      ...source,
      document: {
        ...source.document,
        graph: {
          nodes: {
            gmail: {
              concurrency: 1,
              inputs: {},
              kind: 'value',
              name: 'Gmail',
              values: [
                {
                  handle: 'emailAddress',
                  jsonSchema: { description: "The user's email address.", type: 'string' },
                  nullable: false,
                  value: 'user@example.com',
                },
              ],
            },
            task: {
              ...task,
              inputs: { input: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'gmail', output: 'emailAddress' }] } },
              task: { ...task.task, inputs: [{ handle: 'input', jsonSchema: { type: 'string' }, nullable: false }] },
            },
          },
        },
      },
    }

    await expect(validateFlow(valid, engine)).resolves.toMatchObject({ diagnostics: [], valid: true })
  })

  it.each([
    {
      codes: ['graph.node-output-incompatible'],
      name: 'rejects a true output for a constrained input',
      sourceSchema: true as JsonValue,
      targetSchema: { type: 'string' } as JsonValue,
    },
    {
      codes: ['graph.node-output-incompatible'],
      name: 'rejects an empty output schema for a constrained input',
      sourceSchema: {} as JsonValue,
      targetSchema: { type: 'string' } as JsonValue,
    },
    { codes: [], name: 'accepts two unconstrained schemas', sourceSchema: true as JsonValue, targetSchema: {} as JsonValue },
  ])('$name', async ({ codes, sourceSchema, targetSchema }) => {
    const source = revision('export default ({ input }) => ({ input })')
    const task = source.document.graph.nodes.task
    if (task?.kind != 'task' || task.task == null) throw new Error('Fixture inline Task is missing.')
    const invalid: RevisionFixture = {
      ...source,
      document: {
        ...source.document,
        graph: {
          nodes: {
            source: {
              concurrency: 1,
              inputs: {},
              kind: 'value',
              name: 'Source',
              values: [{ handle: 'value', jsonSchema: sourceSchema, nullable: false, value: 'text' }],
            },
            task: {
              ...task,
              inputs: { input: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'source', output: 'value' }] } },
              task: { ...task.task, inputs: [{ handle: 'input', jsonSchema: targetSchema, nullable: false }] },
            },
          },
        },
      },
    }

    const result = await validateFlow(invalid, engine)
    expect(result.diagnostics.map(({ code }) => code)).toEqual(codes)
    expect(result.valid).toBe(codes.length == 0)
  })

  it('accepts a schema-nullable output for a nullable input', async () => {
    const source = revision('export default ({ input }) => ({ input })')
    const task = source.document.graph.nodes.task
    if (task?.kind != 'task' || task.task == null) throw new Error('Fixture inline Task is missing.')
    const valid: RevisionFixture = {
      ...source,
      document: {
        ...source.document,
        graph: {
          nodes: {
            source: {
              concurrency: 1,
              inputs: {},
              kind: 'value',
              name: 'Source',
              values: [{ handle: 'value', jsonSchema: { type: ['string', 'null'] }, nullable: true, value: null }],
            },
            task: {
              ...task,
              inputs: { input: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'source', output: 'value' }] } },
              task: { ...task.task, inputs: [{ handle: 'input', jsonSchema: { type: 'string' }, nullable: true }] },
            },
          },
        },
      },
    }

    await expect(validateFlow(valid, engine)).resolves.toMatchObject({ diagnostics: [], valid: true })

    const target = valid.document.graph.nodes.task
    if (target?.kind != 'task' || target.task == null) throw new Error('Fixture inline Task is missing.')
    const invalid: RevisionFixture = {
      ...valid,
      document: {
        ...valid.document,
        graph: {
          nodes: {
            ...valid.document.graph.nodes,
            task: { ...target, task: { ...target.task, inputs: [{ handle: 'input', jsonSchema: { type: 'string' }, nullable: false }] } },
          },
        },
      },
    }
    await expect(validateFlow(invalid, engine)).resolves.toMatchObject({
      diagnostics: [expect.objectContaining({ code: 'graph.node-output-incompatible' })],
      valid: false,
    })
  })

  it('rejects incompatible Subflow boundary sources', async () => {
    const invalid: RevisionFixture = {
      document: {
        bindings: {},
        graph: {
          nodes: {
            call: {
              concurrency: 1,
              inputs: { text: { kind: 'value', value: 'ok' } },
              kind: 'subflow',
              name: 'Subflow',
              subflowId: 'subflow',
            },
          },
        },
        subflows: {
          subflow: {
            graph: {
              nodes: {
                check: {
                  cases: [{ expressions: [{ input: 'value', operator: '>', value: 0 }], output: 'yes', relation: 'all' }],
                  concurrency: 1,
                  defaultOutput: 'no',
                  input: { handle: 'value', jsonSchema: { type: 'number' }, nullable: false },
                  inputs: { value: { kind: 'sources', sources: [{ input: 'text', kind: 'flow' }] } },
                  kind: 'condition',
                  name: 'Check',
                },
                number: {
                  concurrency: 1,
                  inputs: {},
                  kind: 'value',
                  name: 'Number',
                  values: [{ handle: 'value', jsonSchema: { type: 'number' }, nullable: false, value: 1 }],
                },
              },
            },
            inputs: [{ handle: 'text', jsonSchema: { type: 'string' }, nullable: false }],
            name: 'Subflow',
            outputs: [
              {
                handle: 'result',
                jsonSchema: { type: 'string' },
                nullable: false,
                sources: [{ kind: 'node', nodeId: 'number', output: 'value' }],
              },
            ],
          },
        },
        tasks: {},
      },
      modelVersion: 1,
      modules: {},
    }

    await expect(validateFlow(invalid, engine)).resolves.toMatchObject({
      diagnostics: [
        expect.objectContaining({ code: 'graph.flow-input-incompatible', path: '/document/subflows/subflow/graph/nodes/check/inputs/value' }),
        expect.objectContaining({ code: 'graph.subflow-output-incompatible', path: '/document/subflows/subflow/outputs/result/sources' }),
      ],
      valid: false,
    })
  })

  it('validates compatible Flow, Condition and Subflow output boundaries', async () => {
    const source = revision('export default ({ input }) => ({ input })')
    const task = source.document.graph.nodes.task
    if (task?.kind != 'task' || task.task == null) throw new Error('Fixture inline Task is missing.')
    const valid: RevisionFixture = {
      ...source,
      document: {
        ...source.document,
        graph: {
          nodes: {
            call: {
              concurrency: 1,
              inputs: { text: { kind: 'value', value: 'hello' } },
              kind: 'subflow',
              name: 'Subflow',
              subflowId: 'subflow',
            },
            task: {
              ...task,
              inputs: { input: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'call', output: 'result' }] } },
              task: { ...task.task, inputs: [{ handle: 'input', jsonSchema: { type: 'string' }, nullable: false }] },
            },
          },
        },
        subflows: {
          subflow: {
            graph: {
              nodes: {
                check: {
                  cases: [{ expressions: [{ input: 'text', operator: '==', value: 'hello' }], output: 'yes', relation: 'all' }],
                  concurrency: 1,
                  input: { handle: 'text', jsonSchema: { type: 'string' }, nullable: false },
                  inputs: { text: { kind: 'sources', sources: [{ input: 'text', kind: 'flow' }] } },
                  kind: 'condition',
                  name: 'Check',
                },
              },
            },
            inputs: [{ handle: 'text', jsonSchema: { type: 'string' }, nullable: false }],
            name: 'Subflow',
            outputs: [
              {
                handle: 'result',
                jsonSchema: { type: 'string' },
                nullable: false,
                sources: [{ kind: 'node', nodeId: 'check', output: 'yes' }],
              },
            ],
          },
        },
      },
    }

    await expect(validateFlow(valid, engine)).resolves.toMatchObject({ diagnostics: [], valid: true })

    const target = valid.document.graph.nodes.task
    if (target?.kind != 'task' || target.task == null) throw new Error('Fixture inline Task is missing.')
    const invalid: RevisionFixture = {
      ...valid,
      document: {
        ...valid.document,
        graph: {
          nodes: {
            ...valid.document.graph.nodes,
            task: { ...target, task: { ...target.task, inputs: [{ handle: 'input', jsonSchema: { type: 'number' }, nullable: false }] } },
          },
        },
      },
    }
    await expect(validateFlow(invalid, engine)).resolves.toMatchObject({
      diagnostics: [expect.objectContaining({ code: 'graph.node-output-incompatible', path: '/document/graph/nodes/task/inputs/input' })],
      valid: false,
    })
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
