import type { GraphNode, InputMapping, JsonValue, RevisionContent } from './change.ts'

import { dequal } from 'dequal/lite'
import { z } from 'zod'
import { clearTriggerExternalConfig } from '../../trigger/common/config.ts'
import { decodeRevisionContent } from './changeSchema.ts'
import { clearConditionBindings } from './condition.ts'
import { clearNodeConnections } from './connectionUsage.ts'
import { checkJsonDepth } from './json.ts'

export interface WorkflowFile {
  readonly kind: 'open-flow-workflow'
  readonly version: 1
  readonly name?: string
  readonly icon?: string
  readonly description?: string
  readonly content: RevisionContent
  readonly presentation?: Readonly<Record<string, JsonValue>>
}

export interface WorkflowCleanupSummary {
  readonly changedNodeIds: readonly string[]
  readonly removedBindings: number
}

const envelope = z.strictObject({
  kind: z.literal('open-flow-workflow'),
  version: z.literal(1),
  name: z.string().optional(),
  icon: z.string().optional(),
  description: z.string().optional(),
  content: z.unknown(),
  presentation: z.record(z.string(), z.json()).optional(),
})

/** Structural decoding only: incomplete drafts are supported, repair is never attempted. */
export function decodeWorkflowFile(value: unknown): WorkflowFile {
  checkJsonDepth(value, -1)
  const file = envelope.parse(value)
  return { ...file, content: decodeRevisionContent(file.content) }
}

export function parseWorkflowFile(text: string): WorkflowFile {
  return decodeWorkflowFile(JSON.parse(text))
}

function cleanInput(input: InputMapping): InputMapping {
  if (input.kind != 'sources' || !input.sources.some((source) => source.kind == 'binding')) return input
  const sources = input.sources.filter((source) => source.kind != 'binding')
  return sources.length == 0 ? { kind: 'unset' } : { kind: 'sources', sources }
}

/** Clear only owned structured references, never strings in code or business values. */
export function cleanWorkflowFile(value: unknown): { readonly file: WorkflowFile; readonly summary: WorkflowCleanupSummary } {
  const file = decodeWorkflowFile(value)
  const original = file.content.document.graph
  const graph = clearNodeConnections(original)
  const nodes = Object.fromEntries(
    Object.entries(graph.nodes).map(([id, source]) => {
      let node: GraphNode = source
      if ('inputs' in node) node = { ...node, inputs: Object.fromEntries(Object.entries(node.inputs).map(([key, input]) => [key, cleanInput(input)])) }
      if (node.kind == 'outputs')
        node = { ...node, outputMappings: Object.fromEntries(Object.entries(node.outputMappings).map(([key, input]) => [key, cleanInput(input)])) }
      if (node.kind == 'condition') node = clearConditionBindings(node)
      if (node.kind == 'error' && node.sourceFlowIds != null) node = { ...node, sourceFlowIds: [] }
      if (node.kind == 'poll' || node.kind == 'integration') node = { ...node, config: clearTriggerExternalConfig(node.definition.key, node.config) }
      return [id, node]
    }),
  )
  return {
    file: {
      ...file,
      content: {
        ...file.content,
        document: {
          ...file.content.document,
          bindings: {},
          graph: { ...graph, nodes },
        },
      },
    },
    summary: {
      changedNodeIds: Object.keys(nodes).filter((id) => !dequal(nodes[id], original.nodes[id])),
      removedBindings: Object.keys(file.content.document.bindings).length,
    },
  }
}

export function encodeWorkflowFile(file: WorkflowFile, options: { readonly clean?: boolean } = {}): string {
  return `${JSON.stringify(options.clean === false ? decodeWorkflowFile(file) : cleanWorkflowFile(file).file, null, 2)}\n`
}

export function workflowFileName(name: string): string {
  // Control characters are forbidden in download filenames.
  // oxlint-disable-next-line no-control-regex
  return `${name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/g, '') || 'workflow'}.openflow.json`
}

export function workflowNameFromFile(name: string): string {
  return name.replace(/(?:\.openflow)?\.json$/i, '')
}
