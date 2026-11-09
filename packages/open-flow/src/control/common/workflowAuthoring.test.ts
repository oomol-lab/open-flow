import type { ConnectorActionMetadata } from './api.ts'
import type { AuthoringRequest } from './authoring.ts'

import * as Effect from 'effect/Effect'
import { describe, expect, it, vi } from 'vitest'
import { runFlow } from '../../execution/common/scheduler.ts'
import { prepareFlow } from '../../flow/common/semantics.ts'
import { encodeWorkflowFile, parseWorkflowFile } from '../../flow/common/workflowFile.ts'
import { currentEngineContract, snapshotRuntimeResult } from '../../runtime/common/runtime.ts'
import { triggerDefinitions } from '../../trigger/providers/definitions.ts'
import { ControlClient } from './api.ts'
import { createWorkflowAuthoring } from './workflowAuthoring.ts'

const action: ConnectorActionMetadata = {
  actionId: 'example.read',
  name: 'Read',
  serviceId: 'example',
  serviceName: 'Example',
  authenticated: true,
  description: '',
  inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
  outputSchema: { type: 'object', additionalProperties: true },
  inputs: { query: { jsonSchema: { type: 'string' }, nullable: false, description: 'Server input' } },
  outputs: { output: { jsonSchema: { type: 'object', additionalProperties: true }, nullable: false, description: 'Server response' } },
}

describe('local WorkflowFile authoring', () => {
  it('creates, reads, searches, checks and executes a file without a Control deployment', async () => {
    const authoring = createWorkflowAuthoring()
    const file = authoring.create({ name: 'Local workflow', presentation: { designer: { version: 1, flow: { direction: 'vertical' } } } })
    const before = structuredClone(file)
    const edits: AuthoringRequest['edits'] = [
      { op: 'node.add', type: 'start', as: 'start', name: 'Start' },
      {
        op: 'node.add',
        type: 'code',
        as: 'code',
        name: 'Count',
        code: 'export default () => ({count: 7})',
        config: { outputs: { count: { schema: { type: 'integer' }, nullable: false } } },
      },
      {
        op: 'node.add',
        type: 'outputs',
        as: 'outputs',
        name: 'Result',
        config: { outputDefs: { count: { schema: { type: 'integer' }, nullable: false } } },
        inputs: { count: { kind: 'output', node: '$code', port: 'count' } },
      },
      { op: 'edge.connect', source: '$start', target: '$code' },
      { op: 'edge.connect', source: '$code', target: '$outputs' },
    ]
    const baseRevision = (await authoring.read(file)).revision
    const request = { baseRevision, requestId: 'create', edits }
    const result = await authoring.edit(file, request)
    expect(file).toEqual(before)
    expect(result.file.presentation).toEqual(file.presentation)
    expect(result.file.name).toBe('Local workflow')
    expect(result.validation).toEqual({ status: 'valid', diagnostics: [] })
    expect((await authoring.edit(file, request)).file).toEqual(result.file)
    expect((await authoring.search(result.file, { query: 'Count' })).data.matches).toEqual(
      expect.arrayContaining([expect.objectContaining({ node: result.nodes.code })]),
    )
    expect((await authoring.check(result.file)).valid).toBe(true)
    expect(parseWorkflowFile(encodeWorkflowFile(result.file))).toEqual(result.file)
    const optional = authoring.create({ description: undefined })
    expect((await authoring.read(optional)).revision).toBe((await authoring.read(parseWorkflowFile(encodeWorkflowFile(optional, { clean: false })))).revision)
    const prepared = await prepareFlow(result.file.content, currentEngineContract, result.nodes.start)
    if (prepared.kind != 'prepared') throw new Error('Expected a prepared file')
    const outcome = await Effect.runPromise(
      runFlow(prepared.flow, {
        flowId: 'local',
        runId: 'run',
        createId: () => 'invocation',
        trigger: { nodeId: result.nodes.start!, outputs: {} },
        invokeTask: (invocation) =>
          Effect.tryPromise({
            try: async () => {
              const node = result.file.content.document.graph.nodes[invocation.nodeId]!
              if (node.kind != 'task' || !('moduleId' in node.task)) throw new Error('Expected Code')
              const source = result.file.content.modules[node.task.moduleId]!.source
              const module = await import(`data:text/javascript,${encodeURIComponent(source)}`)
              return snapshotRuntimeResult(await module.default(invocation.input))
            },
            catch: (error) => (error instanceof Error ? error : new Error(String(error))),
          }),
      }),
    )
    if (outcome.kind == 'waiting') throw new Error('Unexpected wait')
    expect(outcome.outputs).toEqual({ count: 7 })
  })

  it('uses Flow-provided ports and preserves snapshots during unrelated edits', async () => {
    const request = vi.fn(async (path: string) => {
      expect(path).toBe('/v1/connector/action-metadata/example.read?locale=en')
      return Response.json({ version: 1, action })
    })
    const authoring = createWorkflowAuthoring({ client: new ControlClient(request) })
    const file = authoring.create({ icon: ':package:', description: 'Description' })
    const schema = await authoring.schema({ action: action.actionId })
    expect(schema).toMatchObject({ inputs: action.inputs, outputs: action.outputs })
    const result = await authoring.edit(file, {
      baseRevision: (await authoring.read(file)).revision,
      requestId: 'connector',
      edits: [
        {
          op: 'node.add',
          as: 'connector',
          type: 'connector',
          name: 'Read',
          config: { action: action.actionId, connectionId: 'account' },
          inputs: { query: { kind: 'value', value: 'hello' } },
        },
      ],
    })
    const node = result.file.content.document.graph.nodes[result.nodes.connector!]!
    expect(node).toMatchObject({
      task: {
        executor: { kind: 'connector', action: action.actionId, connectionId: 'account', outputMode: 'value' },
        inputs: [{ handle: 'query', ...action.inputs.query }],
        outputs: [{ handle: 'output', ...action.outputs.output }],
      },
    })
    request.mockRejectedValue(new Error('Must retain the snapshot'))
    const renamed = await authoring.edit(result.file, {
      baseRevision: result.revision,
      requestId: 'rename',
      edits: [{ op: 'node.update', node: result.nodes.connector!, set: { name: 'Renamed' } }],
    })
    expect(renamed.file).toMatchObject({ icon: ':package:', description: 'Description' })
    expect(renamed.file.content.document.graph.nodes[result.nodes.connector!]!).toMatchObject({
      task: { executor: { connectionId: 'account' }, outputs: [{ handle: 'output', ...action.outputs.output }] },
    })
    expect(parseWorkflowFile(encodeWorkflowFile(renamed.file, { clean: false }))).toEqual(renamed.file)
    expect(encodeWorkflowFile(renamed.file)).not.toContain('"connectionId"')
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('resolves Provider Trigger definitions asynchronously from Flow', async () => {
    const definition = triggerDefinitions[0]!.snapshot
    const request = vi.fn(async () => Response.json({ version: 1, definition }))
    const authoring = createWorkflowAuthoring({ client: new ControlClient(request) })
    const file = authoring.create()
    const result = await authoring.edit(file, {
      baseRevision: (await authoring.read(file)).revision,
      requestId: 'trigger',
      edits: [{ op: 'node.add', as: 'trigger', type: definition.type, name: 'Trigger', config: { key: definition.key } }],
    })
    expect(result.file.content.document.graph.nodes[result.nodes.trigger!]!).toMatchObject({ definition })
    expect(request).toHaveBeenCalledTimes(1)
  })

  it.each(['name', 'output'])('follows a Flow response advertising the named %s port even for an open schema', async (field) => {
    const named: ConnectorActionMetadata = {
      ...action,
      outputSchema: { type: 'object', properties: { [field]: { type: 'string' } }, additionalProperties: true },
      outputs: { [field]: { jsonSchema: { type: 'string' }, nullable: true } },
    }
    const authoring = createWorkflowAuthoring({ client: new ControlClient(async () => Response.json({ version: 1, action: named })) })
    const file = authoring.create()
    const result = await authoring.edit(file, {
      baseRevision: (await authoring.read(file)).revision,
      requestId: 'legacy-metadata',
      edits: [
        {
          op: 'node.add',
          as: 'read',
          type: 'connector',
          name: 'Read',
          config: { action: named.actionId },
          inputs: { query: { kind: 'value', value: 'record' } },
        },
      ],
    })
    const node = result.file.content.document.graph.nodes[result.nodes.read!]!
    if (node.kind != 'task' || !('executor' in node.task)) throw new Error('Expected a managed Task')
    expect(node.task.executor).toEqual({ kind: 'connector', action: named.actionId })
    expect(node.task.outputs).toEqual([{ handle: field, ...named.outputs[field] }])
  })

  it('rejects stale documents and leaves no partial edits after a failed batch', async () => {
    const authoring = createWorkflowAuthoring()
    const file = authoring.create()
    const baseRevision = (await authoring.read(file)).revision
    const edits: AuthoringRequest['edits'] = [{ op: 'node.add', as: 'code', type: 'code', name: 'Code', code: 'export default () => ({})' }]
    await expect(authoring.edit({ ...file, name: 'Changed elsewhere' }, { baseRevision, requestId: 'stale', edits })).rejects.toMatchObject({
      code: 'flow.revision-conflict',
    })
    const before = structuredClone(file)
    await expect(
      authoring.edit(file, {
        baseRevision,
        requestId: 'invalid',
        edits: [...edits, { op: 'node.add', as: 'external', type: 'connector', name: 'External', config: { action: action.actionId } }],
      }),
    ).rejects.toMatchObject({ code: 'catalog.unavailable' })
    expect(file).toEqual(before)
  })
})
