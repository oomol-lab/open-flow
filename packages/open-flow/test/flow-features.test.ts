import type { GraphNode, RevisionContent } from '../src/flow/common/change.ts'

import { describe, expect, it } from 'vitest'
import { currentFlowModelVersion, UnsupportedFlowFeaturesError, upgradeRevisionContent } from '../src/flow/common/change.ts'
import {
  decodeRevision,
  decodeRevisionContent,
  decodeWorkflowFile,
  encodeRevision,
  encodeWorkflowFile,
  repairRevision,
  revisionRepairKind,
  serializeRevisionContent,
} from '../src/flow/common/encoding.ts'
import { missingEngineCapabilities, prepareFlow, requiredEngineCapabilities, validateFlow } from '../src/flow/common/semantics.ts'
import { findEngineContract } from '../src/runtime/common/runtime.ts'

const encoder = new TextEncoder()
const value: GraphNode = { inputs: {}, kind: 'value', values: [{ handle: 'value', jsonSchema: { type: 'number' }, nullable: false, value: 1 }] }
const delay: GraphNode = { inputs: {}, kind: 'delay' }

function task(executor: Record<string, unknown>): GraphNode {
  return { inputs: {}, kind: 'task', task: { name: 'Task', inputs: [], outputs: [], executor } } as unknown as GraphNode
}

function content(nodes: Record<string, GraphNode>, edges: RevisionContent['document']['graph']['edges'] = []): RevisionContent {
  return { modelVersion: currentFlowModelVersion, document: { bindings: {}, graph: { nodes, edges } }, modules: {} }
}

function bytes(candidate: unknown): Uint8Array {
  return encoder.encode(JSON.stringify(candidate))
}

function envelope(nodes: Record<string, unknown>, fields: Record<string, unknown> = {}) {
  return {
    kind: 'open-flow-flow-revision',
    version: 1,
    modelVersion: currentFlowModelVersion,
    features: [],
    document: { bindings: {}, graph: { nodes, edges: [] } },
    modules: {},
    ...fields,
  }
}

describe('Engine capabilities', () => {
  it.each([
    ['open-flow-engine/v6', [], {}],
    ['open-flow-engine/v6/nodejs-compat-v1', [], {}],
    ['open-flow-engine/v7', ['wait-auto-continue', 'webhook-response'], {}],
    ['open-flow-engine/v7/nodejs-compat-v1', ['wait-auto-continue', 'webhook-response'], {}],
    ['open-flow-engine/v8', ['http-request', 'wait-auto-continue', 'webhook-response', 'workflow-tools'], { workflowTools: true }],
    ['open-flow-engine/v8/nodejs-compat-v1', ['http-request', 'wait-auto-continue', 'webhook-response', 'workflow-tools'], { workflowTools: true }],
    [
      'open-flow-engine/v9',
      ['code-http', 'http-request', 'wait-auto-continue', 'webhook-response', 'workflow-tools'],
      { workflowTools: true, codeFetch: true },
    ],
    [
      'open-flow-engine/v10',
      ['code-http', 'http-request', 'skip-duplicates', 'wait-auto-continue', 'webhook-response', 'workflow-tools'],
      { workflowTools: true, codeFetch: true, flowState: true },
    ],
    [
      'open-flow-engine/v11',
      ['code-http', 'connector-proxy', 'http-request', 'skip-duplicates', 'wait-auto-continue', 'webhook-response', 'workflow-tools'],
      { workflowTools: true, codeFetch: true, flowState: true },
    ],
    [
      'open-flow-engine/v12',
      ['code-http', 'connector-proxy', 'delay', 'http-request', 'skip-duplicates', 'wait-auto-continue', 'webhook-response', 'workflow-tools'],
      { workflowTools: true, codeFetch: true, flowState: true },
    ],
  ] as const)(
    '%s keeps its published capabilities and guest interfaces',
    (contract, capabilities, guest: Partial<Record<'workflowTools' | 'codeFetch' | 'flowState', boolean>>) => {
      const engine = findEngineContract(contract)!
      expect([...engine.capabilities].toSorted()).toEqual(capabilities)
      expect({ workflowTools: engine.workflowTools, codeFetch: engine.codeFetch, flowState: engine.flowState }).toEqual({
        workflowTools: guest.workflowTools ?? false,
        codeFetch: guest.codeFetch,
        flowState: guest.flowState,
      })
    },
  )

  it('derives each capability from the Flow content that enables it', () => {
    const cases: readonly [string, GraphNode][] = [
      ['webhook-response', { inputs: {}, kind: 'webhook-response' }],
      ['webhook-response', { kind: 'webhook', name: 'Hook', method: 'POST', bodyFields: [], options: { responseBody: { kind: 'webhook-response' } } }],
      [
        'wait-auto-continue',
        { inputs: {}, kind: 'wait', prompt: '', inputDefinitions: [], autoContinue: { kind: 'after', durationMs: 1000, action: 'continue' } } as GraphNode,
      ],
      ['http-request', task({ kind: 'http-request' })],
      ['skip-duplicates', task({ kind: 'skip-duplicates', fields: [] })],
      ['connector-proxy', task({ kind: 'connector-proxy' })],
      [
        'code-http',
        { inputs: {}, kind: 'task', task: { name: 'Code', inputs: [], outputs: [], moduleId: 'm', capabilities: [{ kind: 'http', hosts: ['example.com'] }] } },
      ],
      [
        'workflow-tools',
        {
          inputs: {},
          kind: 'task',
          task: {
            name: 'Code',
            inputs: [],
            outputs: [],
            moduleId: 'm',
            capabilities: [{ kind: 'workflow', name: 'Tool', flowId: 'f', revisionId: 'r', inputs: [], outputs: null }],
          },
        },
      ],
      ['delay', delay],
    ]
    for (const [capability, node] of cases) expect(requiredEngineCapabilities(content({ node })), capability).toEqual([capability])
    expect(requiredEngineCapabilities(content({ value }))).toEqual([])
    expect(missingEngineCapabilities(content({ pause: delay }), findEngineContract('open-flow-engine/v11')!)).toEqual(['delay'])
  })

  it('checks only the graph selected by a Trigger', async () => {
    const flow = content({ first: { kind: 'manual', name: 'First' }, second: { kind: 'manual', name: 'Second' }, value, pause: delay }, [
      { source: 'first', target: 'value' },
      { source: 'second', target: 'pause' },
    ])
    expect((await prepareFlow(flow, 'open-flow-engine/v11', 'first')).kind).toBe('prepared')
    expect(await prepareFlow(flow, 'open-flow-engine/v11', 'second')).toEqual({ kind: 'engine-unsupported', capabilities: ['delay'] })
    expect(await prepareFlow(flow, 'open-flow-engine/v11')).toEqual({ kind: 'engine-unsupported', capabilities: ['delay'] })
    expect((await prepareFlow(flow, 'open-flow-engine/v12', 'second')).kind).toBe('prepared')
  })

  it('reports missing capabilities as a validation diagnostic', async () => {
    const validation = await validateFlow(content({ pause: delay }), findEngineContract('open-flow-engine/v11')!)
    expect(validation.valid).toBe(false)
    expect(validation.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'engine.capability-unsupported', path: '/document/graph', values: { capabilities: 'delay' } }),
    )
    const current = await validateFlow(content({ pause: delay }), findEngineContract('open-flow-engine/v12')!)
    expect(current.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain('engine.capability-unsupported')
  })
})

describe('Model v16 features', () => {
  it('serializes the derived features list only from Model v16', () => {
    const current = content({ pause: delay })
    expect(serializeRevisionContent(current)).toEqual({ ...current, features: [] })
    const legacy = { ...current, modelVersion: 15 } as const
    expect(serializeRevisionContent(legacy)).toBe(legacy)
    expect(JSON.parse(new TextDecoder().decode(encodeRevision(legacy)))).not.toHaveProperty('features')
  })

  it('upgrades earlier models on write and round-trips the features list', () => {
    const upgraded = upgradeRevisionContent({ ...content({ value }), modelVersion: 15 })
    expect(upgraded.modelVersion).toBe(currentFlowModelVersion)
    const encoded = encodeRevision(upgraded)
    expect(JSON.parse(new TextDecoder().decode(encoded))).toMatchObject({ modelVersion: currentFlowModelVersion, features: [] })
    expect(decodeRevision(encoded)).toEqual(upgraded)
    expect(decodeRevisionContent(serializeRevisionContent(upgraded))).toEqual(upgraded)
    expect(decodeRevisionContent(upgraded)).toEqual(upgraded)
  })

  it('rejects features this package does not know without offering repair', () => {
    const unknown = envelope({ pause: delay }, { features: ['future-feature'] })
    expect(() => decodeRevision(bytes(unknown))).toThrow(UnsupportedFlowFeaturesError)
    expect(() => decodeRevisionContent(unknown)).toThrow(expect.objectContaining({ features: ['future-feature'] }))
    expect(() => decodeRevisionContent({ ...unknown, features: ['future-feature', 'future-feature'] })).toThrow(
      expect.objectContaining({ features: ['future-feature'] }),
    )
    expect(revisionRepairKind(bytes(unknown))).toBeUndefined()
    expect(() => repairRevision(bytes(unknown))).toThrow(UnsupportedFlowFeaturesError)
  })

  it('rejects a features list on earlier models', () => {
    expect(() => decodeRevisionContent({ ...content({ value }), modelVersion: 15, features: [] })).toThrow(/Flow model version 16/)
  })

  it('refuses to repair unknown kinds that may belong to a newer package', () => {
    for (const node of [
      { kind: 'future-node' },
      task({ kind: 'future-executor' }),
      { inputs: {}, kind: 'task', task: { name: 'Code', inputs: [], outputs: [], moduleId: 'm', capabilities: [{ kind: 'future-capability' }] } },
    ]) {
      const candidate = bytes(envelope({ value, future: node }))
      expect(revisionRepairKind(candidate)).toBeUndefined()
      expect(() => repairRevision(candidate)).toThrow(/cannot be repaired/)
    }
  })

  it('keeps discarding retired kinds during repair', () => {
    const retired = bytes(
      envelope({ value, dedupe: { inputs: {}, kind: 'task', task: { name: 'Dedupe', inputs: [], outputs: [], executor: { kind: 'dedupe', key: 'id' } } } }),
    )
    expect(revisionRepairKind(retired)).toBe('repair')
    expect(repairRevision(retired).document.graph.nodes).toEqual({ value })
  })

  it('writes features into exported workflow files and rejects unknown ones on import', () => {
    const file = { kind: 'open-flow-workflow', version: 1, name: 'Flow', content: content({ pause: delay }) } as const
    expect(JSON.parse(encodeWorkflowFile(file, { clean: false }))).toMatchObject({ content: { features: [] } })
    expect(() => decodeWorkflowFile({ ...file, content: { ...file.content, features: ['future-feature'] } })).toThrow(UnsupportedFlowFeaturesError)
  })
})
