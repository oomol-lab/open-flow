import type { GraphNode } from './change.ts'
import type { WorkflowBundle } from './workflowBundle.ts'
import type { WorkflowFile } from './workflowFile.ts'

import { expect, it } from 'vitest'
import { currentFlowModelVersion } from './change.ts'
import {
  cleanWorkflowBundle,
  decodeWorkflowBundle,
  decodeWorkflowExportPreview,
  encodeWorkflowBundle,
  parseWorkflowImportFile,
  remapWorkflowBundle,
  workflowBundleFromPreview,
} from './workflowBundle.ts'
import { nodeWorkflowReferences } from './workflowReferences.ts'

function file(nodes: Record<string, GraphNode> = {}): WorkflowFile {
  return {
    kind: 'open-flow-workflow',
    version: 1,
    content: { modelVersion: currentFlowModelVersion, modules: {}, document: { bindings: {}, graph: { nodes, edges: [] } } },
  }
}
const capability = { kind: 'workflow' as const, flowId: 'child', revisionId: 'old-live', name: 'lookup', inputs: [], outputs: null }
const root = file({
  call: { kind: 'task', inputs: {}, task: { name: 'Call', inputs: [], outputs: [], executor: { kind: 'workflow', flowId: 'child', revisionId: 'old-live' } } },
  code: { kind: 'task', inputs: {}, task: { name: 'Code', moduleId: 'code', inputs: [], outputs: [], capabilities: [capability] } },
  agent: {
    kind: 'task',
    inputs: {},
    task: {
      name: 'Agent',
      inputs: [],
      outputs: [],
      executor: { kind: 'agent', model: 'model', prompt: 'child', maxRounds: 2, tools: [{ ...capability, id: 'tool', description: 'child', approval: false }] },
    },
  },
})
const bundle: WorkflowBundle = {
  kind: 'open-flow-workflow-bundle',
  version: 1,
  entryFlowId: 'root',
  workflows: [
    {
      flowId: 'root',
      file: {
        ...root,
        content: { ...root.content, modules: { code: { name: 'Code', imports: [], source: 'export default () => "child"' } } },
        presentation: { comments: ['child'] },
      },
    },
    { flowId: 'child', file: file() },
  ],
}

it('round trips bundles and single files, preserving incomplete drafts and cleaning external resources', () => {
  expect(parseWorkflowImportFile(encodeWorkflowBundle(bundle))).toEqual(bundle)
  expect(parseWorkflowImportFile(JSON.stringify(file()))).toEqual(file())
  const copy = structuredClone(bundle)
  expect(cleanWorkflowBundle(bundle)).toEqual(bundle)
  expect(bundle).toEqual(copy)
  const dirty: WorkflowBundle = {
    ...bundle,
    workflows: [...bundle.workflows, { flowId: 'error', file: file({ error: { kind: 'error', name: 'Error', sourceFlowIds: ['external'] } }) }],
  }
  expect(cleanWorkflowBundle(dirty).workflows[2]?.file.content.document.graph.nodes.error).toMatchObject({ sourceFlowIds: [] })
})

it('rewrites all three workflow declaration forms without changing aliases, ports, modules or business strings', () => {
  const mapped = remapWorkflowBundle(
    bundle,
    new Map([
      ['root', 'new-root'],
      ['child', 'new-child'],
    ]),
  )
  expect(mapped.entryFlowId).toBe('new-root')
  for (const node of Object.values(mapped.workflows[0]!.file.content.document.graph.nodes))
    expect(nodeWorkflowReferences(node).map(({ target }) => ({ flowId: target.flowId, revisionId: target.revisionId }))).toEqual([
      { flowId: 'new-child', revisionId: '' },
    ])
  expect(mapped.workflows[0]!.file.content.modules).toEqual(bundle.workflows[0]!.file.content.modules)
  expect(mapped.workflows[0]!.file.presentation).toEqual(bundle.workflows[0]!.file.presentation)
  expect(mapped.workflows[0]!.file.content.document.graph.nodes.agent).toMatchObject({
    task: { executor: { prompt: 'child', tools: [{ name: 'lookup', description: 'child' }] } },
  })
  expect(() => remapWorkflowBundle(bundle, new Map([['root', 'new']]))).toThrow()
  expect(() =>
    remapWorkflowBundle(
      bundle,
      new Map([
        ['root', 'same'],
        ['child', 'same'],
      ]),
    ),
  ).toThrow()
})

it('rejects duplicate identities, missing entries, missing dependencies and unsupported versions', () => {
  for (const invalid of [
    { ...bundle, version: 2 },
    { ...bundle, entryFlowId: 'absent' },
    { ...bundle, workflows: [bundle.workflows[0]] },
    { ...bundle, workflows: [...bundle.workflows, bundle.workflows[1]] },
  ])
    expect(() => decodeWorkflowBundle(invalid)).toThrow()
  const preview = decodeWorkflowExportPreview({ version: 1, entryFlowId: 'root', workflows: [bundle.workflows[0]], unavailableFlowIds: ['child'] })
  expect(() => workflowBundleFromPreview(preview)).toThrow()
  expect(() => decodeWorkflowExportPreview({ ...preview, unavailableFlowIds: ['root', 'child'] })).toThrow()
})
