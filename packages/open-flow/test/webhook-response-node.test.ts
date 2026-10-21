import type { GraphNode, RevisionContent } from '../src/flow/common/change.ts'

import * as Effect from 'effect/Effect'
import { describe, expect, it } from 'vitest'
import { authoringNode, compileAuthoring } from '../src/control/common/authoring.ts'
import { authoringExample } from '../src/control/common/authoringExamples.ts'
import { currentEngineContract } from '../src/execution/common/engineContract.ts'
import { createEventProjector } from '../src/execution/common/events.ts'
import { runFlow } from '../src/execution/common/scheduler.ts'
import { applyFlowChanges, currentFlowModelVersion } from '../src/flow/common/change.ts'
import { decodeRevision, decodeRevisionContent, encodeRevision } from '../src/flow/common/encoding.ts'
import { validateFlowGraph } from '../src/flow/common/graph.ts'
import { inverseFlowChanges } from '../src/flow/common/inverseChanges.ts'
import { prepareFlow } from '../src/flow/common/semantics.ts'

const host = {
  action: async () => {
    throw new Error('Unexpected action')
  },
  openapi: async () => {
    throw new Error('Unexpected OpenAPI')
  },
  id: (value: string) => value.replaceAll(':', '-'),
  trigger: () => {
    throw new Error('Unexpected trigger')
  },
  connector: async () => {
    throw new Error('Unexpected connector')
  },
}
function content(nodes: Record<string, GraphNode> = {}): RevisionContent {
  return {
    modelVersion: currentFlowModelVersion,
    modules: {},
    document: {
      bindings: {},
      graph: {
        nodes: {
          hook: { kind: 'webhook', name: 'Hook', method: 'POST', bodyFields: [], options: { responseBody: { kind: 'webhook-response', nodeId: 'reply' } } },
          reply: { kind: 'webhook-response', name: 'Reply', inputs: {} },
          ...nodes,
        },
        edges: [{ source: 'hook', target: 'reply' }],
      },
    },
  }
}

describe('Webhook response node contract', () => {
  it('creates multiple fixed-input nodes, resolves response aliases, reads and undoes edits', async () => {
    const base: RevisionContent = { modelVersion: currentFlowModelVersion, modules: {}, document: { bindings: {}, graph: { nodes: {}, edges: [] } } }
    const created = await compileAuthoring(
      base,
      {
        baseRevision: 'base',
        requestId: 'create',
        edits: [
          {
            op: 'node.add',
            type: 'webhook-response',
            as: 'reply',
            name: 'Reply',
            inputs: { body: { kind: 'value', value: 'ok' }, headers: { kind: 'value', value: { 'X-Result': 'yes' } } },
          },
          { op: 'node.add', type: 'webhook-response', as: 'other', name: 'Other' },
          {
            op: 'node.add',
            type: 'webhook',
            as: 'hook',
            name: 'Hook',
            config: { method: 'POST', options: { responseBody: { kind: 'webhook-response', nodeId: '$reply' } } },
          },
          { op: 'edge.connect', source: '$hook', target: '$reply' },
        ],
      },
      host,
    )
    const next = applyFlowChanges(base, created.operations)
    expect(authoringNode(next, 'node-reply')).toMatchObject({ type: 'webhook-response', inputs: { body: { kind: 'value', value: 'ok' } } })
    expect(authoringNode(next, 'node-hook').config).toMatchObject({ options: { responseBody: { nodeId: 'node-reply' } } })
    expect(validateFlowGraph(next)).toEqual([])
    expect(decodeRevision(encodeRevision(next))).toEqual(next)
    expect(applyFlowChanges(next, inverseFlowChanges(base, created.operations))).toEqual(base)
    await expect(
      compileAuthoring(
        next,
        {
          baseRevision: 'next',
          requestId: 'unknown',
          edits: [{ op: 'input.set', node: 'node-reply', input: 'headers/X-Count', source: { kind: 'value', value: '' } }],
        },
        host,
      ),
    ).rejects.toThrow('Unknown input')
  })

  it('keeps missing and disconnected selections as draft errors and rejects old models/engines', async () => {
    expect(validateFlowGraph(content({ reply: { kind: 'value', name: 'Wrong kind', inputs: {}, values: [] } }))).toContainEqual(
      expect.objectContaining({ code: 'trigger.webhook-response-node-missing' }),
    )
    const original = content()
    const disconnected = { ...original, document: { ...original.document, graph: { ...original.document.graph, edges: [] } } }
    expect(validateFlowGraph(disconnected)).toContainEqual(expect.objectContaining({ code: 'trigger.webhook-response-node-unreachable' }))
    expect(() => decodeRevisionContent({ ...content(), modelVersion: 9 })).toThrow('version 10')
    expect(await prepareFlow(content(), 'open-flow-engine/v6')).toMatchObject({ kind: 'engine-unsupported' })
    expect(authoringExample('webhook-response').operations).toHaveLength(1)
  })

  it.each([undefined, { kind: 'webhook-response', nodeId: 'reply' }] as const)(
    'locates inactive workflow references on their own settings in mode %j',
    (responseBody) => {
      const source = content({
        hook: {
          kind: 'webhook',
          name: 'Hook',
          method: 'POST',
          bodyFields: [],
          options: { responseBody, responseStatusCodeOutput: 'status', responseHeaderOutputs: { 'X-Test': 'value' } },
        },
      })
      const issues = validateFlowGraph(source).filter((issue) => issue.code.endsWith('-source'))
      expect(issues.map(({ code, path }) => ({ code, path }))).toEqual([
        { code: 'trigger.webhook-response-status-source', path: '/document/graph/nodes/hook/options/responseStatusCodeOutput' },
        { code: 'trigger.webhook-response-headers-source', path: '/document/graph/nodes/hook/options/responseHeaderOutputs' },
      ])
    },
  )

  it.each(['hello', [], 42, false, null, {}])('completes with a response snapshot and no business output for %j', async (body) => {
    const prepared = await prepareFlow(
      content({
        reply: { kind: 'webhook-response', name: 'Reply', inputs: { body: { kind: 'value', value: body } } },
        after: {
          kind: 'value',
          name: 'After',
          inputs: {},
          values: [{ handle: 'result', jsonSchema: { type: 'string' }, nullable: false, value: 'continued' }],
        },
      }),
      currentEngineContract,
    )
    if (prepared.kind !== 'prepared') throw new Error(JSON.stringify(prepared))
    const flow = { ...prepared.flow, graph: { ...prepared.flow.graph, edges: [...prepared.flow.graph.edges, { source: 'reply', target: 'after' }] } }
    const events: unknown[] = []
    const result = await Effect.runPromise(
      runFlow(flow, {
        flowId: 'flow',
        runId: 'run',
        createId: () => crypto.randomUUID(),
        trigger: { nodeId: 'hook', outputs: { headers: {}, query: {}, body: {}, webhookUrl: 'http://localhost/' } },
        invokeTask: () => Effect.die('Unexpected invocation'),
        emit: (event) =>
          Effect.sync(() => {
            events.push(event)
          }),
      }),
    )
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'node.completed',
        nodeId: 'reply',
        outputs: {},
        response: {
          body: typeof body === 'string' ? body : JSON.stringify(body),
          status: 200,
          headers: {},
          contentType: typeof body === 'string' ? 'text/plain;charset=UTF-8' : 'application/json',
        },
      }),
    )
    expect(result).toMatchObject({
      kind: 'node-results',
      nodes: expect.arrayContaining([expect.objectContaining({ nodeId: 'after', outputs: { result: 'continued' } })]),
    })
    expect(result).not.toHaveProperty('outputs')
  })

  it('projects root response metadata independently of logs and excludes child workflow scopes', async () => {
    const project = createEventProjector('run', new Set())
    const response = { status: 200, body: 'ok', headers: {}, contentType: 'text/plain;charset=UTF-8' }
    await project({ type: 'run.started', runId: 'run', flowId: 'root' })
    expect(await project({ type: 'node.completed', runId: 'run', jobId: 'job', nodeId: 'reply', outputs: {}, response })).toHaveProperty('response', response)
    await project({ type: 'run.started', runId: 'child', flowId: 'child', parentRunId: 'run', parentJobId: 'job' })
    expect(await project({ type: 'node.completed', runId: 'child', jobId: 'child-job', nodeId: 'reply', outputs: {}, response })).not.toHaveProperty('response')
  })
})

it('commits each execution snapshot while keeping response data out of downstream outputs in a loop', async () => {
  const original = content({
    counter: {
      kind: 'task',
      name: 'Counter',
      maxExecutions: 2,
      inputs: {},
      task: { name: 'Counter', moduleId: 'counter', inputs: [], outputs: [{ handle: 'count', jsonSchema: { type: 'number' }, nullable: false }] },
    },
    reply: { kind: 'webhook-response', name: 'Reply', inputs: { body: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'counter', output: 'count' }] } } },
  })
  const source = {
    ...original,
    modules: { counter: { name: 'Counter', imports: [], source: 'export default () => ({count: 1})' } },
    document: {
      ...original.document,
      graph: {
        nodes: original.document.graph.nodes,
        edges: [
          { source: 'hook', target: 'counter' },
          { source: 'counter', target: 'reply' },
          { source: 'reply', target: 'counter' },
        ],
      },
    },
  }
  const prepared = await prepareFlow(source, currentEngineContract)
  if (prepared.kind !== 'prepared') throw new Error(JSON.stringify(prepared))
  const bodies: string[] = []
  let count = 0
  await expect(
    Effect.runPromise(
      runFlow(prepared.flow, {
        flowId: 'flow',
        runId: 'run',
        createId: () => crypto.randomUUID(),
        trigger: { nodeId: 'hook', outputs: { headers: {}, query: {}, body: {}, webhookUrl: 'http://localhost/' } },
        invokeTask: () => Effect.succeed({ count: ++count }),
        emit: (event) =>
          Effect.sync(() => {
            if (event.type === 'node.completed' && event.response != null) {
              expect(event.outputs).toEqual({})
              bodies.push(event.response.body)
            }
          }),
      }),
    ),
  ).rejects.toThrow('maximum execution count')
  expect(bodies).toEqual(['1', '2'])
})
