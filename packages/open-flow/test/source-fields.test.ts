import type { ConditionNode, JsonValue, NodeSource, RevisionContent } from '../src/flow/common/change.ts'

import * as Effect from 'effect/Effect'
import { describe, expect, it } from 'vitest'
import { mcpTools } from '../src/control/common/mcp.ts'
import { controlRequests } from '../src/control/common/requests.ts'
import { currentEngineContract, findEngineContract } from '../src/execution/common/runtime.ts'
import { decodeFlowRunCheckpoint, runFlow } from '../src/execution/common/scheduler.ts'
import { applyFlowChanges, currentFlowModelVersion, decodeChangeOperations } from '../src/flow/common/change.ts'
import { decodeRevision, encodeRevision, digestBytes } from '../src/flow/common/encoding.ts'
import { checkInputSource, inputSourceCandidates } from '../src/flow/common/graph.ts'
import { inverseFlowChanges } from '../src/flow/common/inverseChanges.ts'
import { prepareFlow, validateFlow } from '../src/flow/common/semantics.ts'
import { sourceFields, sourceOutputLabel, sourcePort } from '../src/flow/common/sourceField.ts'
import { copyNodes, pasteNodes } from '../src/workbench/browser/runtime/editor/nodeClipboard.ts'
import { revisionView } from '../src/workbench/browser/runtime/revisionView.ts'
import { advanceWaiting, waitHost } from './waitHost.ts'

const engine = findEngineContract(currentEngineContract)!
const target = { kind: 'flow' } as const
const reference = (field?: string): NodeSource => ({ kind: 'node', nodeId: 'data', output: 'payload', ...(field === undefined ? {} : { field }) })
const outputSchema = {
  type: 'object',
  properties: { name: { type: 'string', description: 'Customer display name.' }, count: { type: 'number' } },
  required: ['name'],
}
function fixture(value: JsonValue = { name: 'Ada', count: 2 }, schema: JsonValue = outputSchema, field = 'name'): RevisionContent {
  return {
    modelVersion: currentFlowModelVersion,
    modules: { main: { name: 'Main', imports: [], source: 'export default (inputs) => inputs' } },
    document: {
      bindings: {},
      tasks: {},
      subflows: {},
      graph: {
        edges: [
          { source: 'start', target: 'data' },
          { source: 'data', target: 'sink' },
        ],
        nodes: {
          start: { kind: 'manual', name: 'Start' },
          data: {
            kind: 'value',
            name: 'Data',
            inputs: {},
            values: [{ handle: 'payload', description: 'Structured customer payload.', jsonSchema: schema, nullable: true, value }],
          },
          sink: {
            kind: 'task',
            name: 'Sink',
            inputs: { value: { kind: 'sources', sources: [reference(field)] } },
            task: {
              name: 'Sink',
              moduleId: 'main',
              inputs: [{ handle: 'value', jsonSchema: { type: 'string' }, nullable: true }],
              outputs: [{ handle: 'value', jsonSchema: {}, nullable: true }],
            },
          },
        },
      },
    },
  }
}
function view(content: RevisionContent) {
  return revisionView({ content, flowId: 'flow', revision: 'draft' } as unknown as Parameters<typeof revisionView>[0])
}
async function prepared(content: RevisionContent) {
  const result = await prepareFlow(content, currentEngineContract)
  if (result.kind !== 'prepared') throw new Error(JSON.stringify(result))
  return result.flow
}
async function execute(content: RevisionContent) {
  let id = 0
  return Effect.runPromise(
    runFlow(await prepared(content), {
      flowId: 'flow',
      runId: 'run',
      createId: () => `job-${++id}`,
      trigger: { nodeId: 'start', outputs: {} },
      invokeTask: ({ input }) => Effect.succeed(input),
    }),
  )
}

describe('Source object fields', () => {
  it('projects directly declared fields with optionality and literal keys', () => {
    const port = {
      nullable: false,
      jsonSchema: {
        type: 'object',
        required: ['a.b/~', ''],
        properties: { 'a.b/~': { type: 'string' }, '': { type: 'number' }, 'nested': { type: 'object', properties: { deeper: { type: 'string' } } } },
      },
    }
    expect(sourceFields(port).map(({ field }) => field)).toEqual(['a.b/~', '', 'nested'])
    expect(sourcePort(port, 'a.b/~')).toEqual({ jsonSchema: { type: 'string' }, nullable: false })
    expect(sourcePort(port, 'nested')?.nullable).toBe(true)
    expect(sourcePort({ ...port, nullable: true }, '')?.nullable).toBe(true)
    expect(sourcePort(port, 'missing')).toBeUndefined()
    expect(sourceOutputLabel(reference('a.b/~'))).toBe('payload / a.b/~')
    expect(sourceFields({ nullable: false, jsonSchema: { anyOf: [outputSchema] } })).toEqual([])
    expect(sourceFields({ nullable: false, jsonSchema: { type: 'array', items: outputSchema } })).toEqual([])
  })

  it('does not resolve references or enumerate composition branches', () => {
    const schemas: JsonValue[] = [
      { $schema: 'https://json-schema.org/draft/2020-12/schema', $ref: '#/$defs/object', $defs: { object: outputSchema }, title: 'Payload' },
      { $ref: '#/missing' },
      { allOf: [outputSchema] },
      { anyOf: [outputSchema] },
      { oneOf: [outputSchema] },
      { type: 'string', properties: outputSchema.properties },
    ]
    for (const jsonSchema of schemas) {
      expect(sourceFields({ nullable: false, jsonSchema })).toEqual([])
    }
  })

  it('reads only direct properties and leaves child schemas unchanged', () => {
    const jsonSchema = {
      properties: { direct: { $ref: '#/$defs/text' } },
      $defs: { text: { type: 'string' } },
      allOf: [outputSchema],
    }
    expect(sourceFields({ nullable: false, jsonSchema })).toEqual([{ field: 'direct', port: { jsonSchema: jsonSchema.properties.direct, nullable: true } }])
  })

  it('checks the field independently of the whole object and preserves missing-field diagnostics', async () => {
    const content = fixture()
    const { document } = content
    const candidates = inputSourceCandidates(document, document.graph, 'sink', 'value').data!
    expect(candidates[0]?.check.kind).toBe('schema')
    expect(candidates[0]?.description).toBe('Structured customer payload.')
    expect(candidates[0]?.fields).toMatchObject([
      { field: 'name', description: 'Customer display name.', check: { kind: 'available' } },
      { field: 'count', check: { kind: 'schema' } },
    ])
    expect(checkInputSource(document, document.graph, 'sink', 'value', reference('removed'))).toEqual({ kind: 'field-missing' })
    expect(view(content).sourceType(target, reference('name'))).toBe('string')
    expect((await validateFlow(fixture({ name: 'Ada' }, outputSchema, 'removed'), engine)).diagnostics).toContainEqual(
      expect.objectContaining({ code: 'graph.source-missing', values: expect.objectContaining({ variant: 'field', field: 'removed' }) }),
    )
  })

  it('round trips references through changes, Control API, MCP, encoding, undo and copying', async () => {
    const original = fixture()
    const operations = decodeChangeOperations([
      {
        kind: 'graph.node.input.set',
        target,
        nodeId: 'sink',
        handle: 'value',
        before: { kind: 'sources', sources: [reference('name')] },
        value: { kind: 'sources', sources: [reference('')] },
      },
    ])
    expect(controlRequests.changeDraft({ version: 1, expectedRevisionId: 'draft', operations }).operations).toEqual(operations)
    expect(
      mcpTools.flow_apply.inputSchema['~standard'].validate({ flowId: 'flow', expectedRevisionId: 'draft', idempotencyKey: 'change', operations }),
    ).toMatchObject({ value: { operations } })
    const changed = applyFlowChanges(original, operations)
    expect(decodeRevision(encodeRevision(changed)).document.graph.nodes).toEqual(changed.document.graph.nodes)
    expect(encodeRevision(decodeRevision(encodeRevision(changed)))).toEqual(encodeRevision(changed))
    expect(await digestBytes(encodeRevision(changed))).not.toEqual(await digestBytes(encodeRevision(original)))
    expect(applyFlowChanges(changed, inverseFlowChanges(original, operations))).toEqual(original)
    const clipboard = copyNodes(view(changed), target, ['data', 'sink'])
    let id = 0
    const pasted = pasteNodes(view(changed), target, clipboard, () => `copy${++id}`)
    const copied = applyFlowChanges(changed, pasted.changes)
    const sink = copied.document.graph.nodes[pasted.nodeIds[pasted.sourceIds.indexOf('sink')]!]!
    expect('inputs' in sink && sink.inputs.value).toEqual({
      kind: 'sources',
      sources: [{ ...reference(''), nodeId: pasted.nodeIds[pasted.sourceIds.indexOf('data')] }],
    })
  })

  it.each([
    [{ name: 'Ada' }, 'Ada'],
    [{}, null],
    [null, null],
    [{ name: null }, null],
  ] as const)('resolves present, absent and null values: %j', async (value, expected) => {
    const content = fixture(value, { type: 'object', properties: { name: { type: ['string', 'null'] } } })
    expect(await execute(content)).toMatchObject({ kind: 'node-results', nodes: [{ nodeId: 'sink', outputs: { value: expected } }] })
  })

  it.each(['', 'a.b/~', '__proto__', 'constructor'])('reads the literal own key %j', async (field) => {
    const content = fixture(Object.fromEntries([[field, 'literal']]), { type: 'object', properties: Object.fromEntries([[field, { type: 'string' }]]) }, field)
    expect(await execute(content)).toMatchObject({ nodes: [{ outputs: { value: 'literal' } }] })
  })

  it('does not read inherited properties', async () => {
    const content = fixture({}, { type: 'object', properties: { constructor: true } }, 'constructor')
    const sink = content.document.graph.nodes.sink
    if (sink?.kind !== 'task' || sink.task == null) throw new Error('Missing task')
    const revision = {
      ...content,
      document: {
        ...content.document,
        graph: {
          ...content.document.graph,
          nodes: { ...content.document.graph.nodes, sink: { ...sink, task: { ...sink.task, inputs: [{ handle: 'value', jsonSchema: {}, nullable: true }] } } },
        },
      },
    }
    expect(await execute(revision)).toMatchObject({ nodes: [{ outputs: { value: null } }] })
  })

  it('counts explicit null as a source, but not a missing property', async () => {
    const source = fixture({ name: null }, { type: 'object', properties: { name: { type: ['string', 'null'] }, other: { type: 'string' } } })
    const sink = source.document.graph.nodes.sink
    if (sink?.kind !== 'task') throw new Error('Missing task')
    const content = {
      ...source,
      document: {
        ...source.document,
        graph: {
          ...source.document.graph,
          nodes: {
            ...source.document.graph.nodes,
            sink: { ...sink, inputs: { value: { kind: 'sources' as const, sources: [reference('name'), reference('other')] } } },
          },
        },
      },
    }
    // The static conflict rule remains conservative, independent of optional field values.
    expect((await validateFlow(content, engine)).diagnostics.some((diagnostic) => diagnostic.code === 'graph.source-unavailable')).toBe(true)
    const flow = await prepared(source)
    const mappedSink = { ...sink, inputs: { value: { kind: 'sources' as const, sources: [reference('name'), reference('other')] } } }
    const run = (value: JsonValue) => {
      const data = flow.graph.nodes.data
      if (data?.kind !== 'value') throw new Error('Missing value')
      return Effect.runPromise(
        runFlow(
          {
            ...flow,
            graph: {
              ...flow.graph,
              nodes: { ...flow.graph.nodes, sink: mappedSink, data: { ...data, values: data.values.map((port) => Object.assign({}, port, { value })) } },
            },
          },
          {
            flowId: 'flow',
            runId: 'run',
            createId: () => crypto.randomUUID(),
            trigger: { nodeId: 'start', outputs: {} },
            invokeTask: ({ input }) => Effect.succeed(input),
          },
        ),
      )
    }
    expect(await run({ name: null })).toMatchObject({ nodes: [{ outputs: { value: null } }] })
    await expect(run({ name: null, other: 'present' })).rejects.toThrow('multiple available sources')
  })

  it('resolves Condition operands and fails on missing fields before Otherwise', async () => {
    const content = fixture()
    const condition: ConditionNode = {
      kind: 'condition',
      name: 'Condition',
      inputs: {},
      matchMode: 'first',
      cases: [
        {
          output: 'match',
          groups: [{ expressions: [{ left: { kind: 'source', source: reference('name') }, operator: '==', right: { kind: 'value', value: 'Ada' } }] }],
        },
      ],
    }
    const withCondition = {
      ...content,
      document: { ...content.document, graph: { ...content.document.graph, nodes: { ...content.document.graph.nodes, sink: condition } } },
    }
    expect(await execute(withCondition)).toMatchObject({ nodes: [{ nodeId: 'sink', outputs: {} }] })
    const absent = fixture({}, { type: 'object', properties: { name: { type: 'string' } } })
    await expect(
      execute({ ...absent, document: { ...absent.document, graph: { ...absent.document.graph, nodes: { ...absent.document.graph.nodes, sink: condition } } } }),
    ).rejects.toThrow('Source has no value')
  })

  it('projects Subflow outputs using the same Source contract', async () => {
    const content = fixture()
    const data = content.document.graph.nodes.data!
    const revision: RevisionContent = {
      ...content,
      document: {
        ...content.document,
        graph: {
          nodes: { start: { kind: 'manual', name: 'Start' }, child: { kind: 'subflow', name: 'Child', subflowId: 'child', inputs: {} } },
          edges: [{ source: 'start', target: 'child' }],
        },
        subflows: {
          child: {
            name: 'Child',
            inputs: [],
            outputs: [{ handle: 'name', jsonSchema: { type: 'string' }, nullable: true, sources: [reference('name')] }],
            graph: { nodes: { data }, edges: [] },
          },
        },
      },
    }
    expect(decodeRevision(encodeRevision(revision))).toEqual(revision)
    expect(await execute(revision)).toMatchObject({ nodes: [{ nodeId: 'child', outputs: { name: 'Ada' } }] })
  })

  it('keeps complete objects in checkpoints and projects after Wait resumes', async () => {
    const content = fixture()
    const revision: RevisionContent = {
      ...content,
      document: {
        ...content.document,
        graph: {
          nodes: { ...content.document.graph.nodes, wait: { kind: 'wait', name: 'Wait', inputs: {}, inputDefinitions: [], prompt: 'Continue?' } },
          edges: [
            { source: 'start', target: 'data' },
            { source: 'data', target: 'wait' },
            { source: 'wait', sourceHandle: 'continue', target: 'sink' },
          ],
        },
      },
    }
    const flow = await prepared(revision)
    const options = {
      createId: () => crypto.randomUUID(),
      flowId: 'flow',
      runId: 'run',
      invokeTask: ({ input }: { input: Readonly<Record<string, JsonValue>> }) => Effect.succeed(input),
    }
    const first = await advanceWaiting(runFlow(flow, { ...options, trigger: { nodeId: 'start', outputs: {} }, waits: waitHost() }))
    if (first.kind !== 'waiting') throw new Error('Expected wait')
    const checkpoint = decodeFlowRunCheckpoint(JSON.parse(JSON.stringify(first.checkpoint)))
    expect(checkpoint.results.data?.outputs.payload).toEqual({ name: 'Ada', count: 2 })
    const result = await Effect.runPromise(
      runFlow(flow, { ...options, resume: { checkpoint }, waits: waitHost({ [checkpoint.waits[0]!.waitId]: 'continue' }) }),
    )
    expect(result).toMatchObject({ nodes: [{ nodeId: 'sink', outputs: { value: 'Ada' } }] })
  })
})
