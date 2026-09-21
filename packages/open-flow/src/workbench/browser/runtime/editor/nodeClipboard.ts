import type { GraphTarget } from '../../../../flow/common/change.ts'
import type { ChangeOperation, CodeModule, Draft, GraphNode, InputMapping } from '../api.ts'
import type { RevisionView } from '../revisionView.ts'
import type { FlowChanges } from './flowChanges.ts'

import { nodeInputMappings, mapConditionSources } from '../../../../flow/common/condition.ts'
import { nameCreatedNodes } from './flowChanges.ts'

export interface NodeClipboard {
  readonly edges: Draft['content']['document']['graph']['edges']
  readonly bindings: Draft['content']['document']['bindings']
  readonly modules: Readonly<Record<string, CodeModule>>
  readonly nodes: Readonly<Record<string, GraphNode>>
}

export interface PastedNodes {
  readonly changes: FlowChanges
  readonly nodeIds: readonly string[]
  readonly sourceIds: readonly string[]
}

export function copyNodes(revision: RevisionView, target: GraphTarget, nodeIds: readonly string[]): NodeClipboard {
  const nodes = revision.graph(target)?.nodes ?? {}
  const copied = Object.fromEntries(nodeIds.flatMap((nodeId) => (nodes[nodeId] == null ? [] : [[nodeId, nodes[nodeId]]])))
  return {
    edges: (revision.graph(target)?.edges ?? []).filter((edge) => copied[edge.source] != null && copied[edge.target] != null),
    bindings: Object.fromEntries(
      Object.values(copied).flatMap((node) => {
        if (!('inputs' in node)) return []
        const inputs = Object.values(nodeInputMappings(node))
        return inputs.flatMap((mapping) =>
          mapping.kind == 'sources'
            ? mapping.sources.flatMap((source) => {
                if (source.kind != 'binding') return []
                const binding = revision.binding(source.bindingId)
                return binding?.kind == 'variable' ? [[source.bindingId, binding]] : []
              })
            : [],
        )
      }),
    ),
    modules: Object.fromEntries(
      Object.values(copied).flatMap((node) => {
        if (node.kind != 'task' || node.task == null) return []
        const module = revision.revision.content.modules[node.task.moduleId]
        return module == null ? [] : [[node.task.moduleId, module]]
      }),
    ),
    nodes: copied,
  }
}

export function pasteNodes(revision: RevisionView, target: GraphTarget, clipboard: NodeClipboard, identity: () => string): PastedNodes {
  if (revision.graph(target) == null) return { changes: [], nodeIds: [], sourceIds: [] }
  const hasManualTrigger = Object.values(revision.graph(target)?.nodes ?? {}).some((node) => node.kind === 'manual')
  const entries = Object.entries(clipboard.nodes).filter(
    ([, node]) =>
      (target.kind == 'flow' || 'inputs' in node) &&
      (node.kind !== 'manual' || !hasManualTrigger) &&
      (node.kind != 'task' || node.task == null || clipboard.modules[node.task.moduleId] != null),
  )
  const sourceIds = entries.map(([sourceId]) => sourceId)
  const ids = new Map(sourceIds.map((sourceId) => [sourceId, identity()]))
  const operations: ChangeOperation[] = []
  const bindingIds = new Map<string, string>()
  for (const [, node] of entries) {
    if (!('inputs' in node)) continue
    const inputs = Object.values(nodeInputMappings(node))
    for (const mapping of inputs) {
      if (mapping.kind != 'sources') continue
      for (const source of mapping.sources) {
        if (source.kind != 'binding' || clipboard.bindings[source.bindingId]?.kind != 'variable' || bindingIds.has(source.bindingId)) continue
        bindingIds.set(source.bindingId, identity())
      }
    }
  }
  for (const [sourceId, bindingId] of bindingIds) {
    const binding = clipboard.bindings[sourceId]
    if (binding != null) operations.push({ binding, bindingId, kind: 'binding.create' })
  }
  for (const [sourceId, node] of entries) {
    const nodeId = ids.get(sourceId)!
    if (!('inputs' in node)) {
      if (node.kind == 'poll' || node.kind == 'integration') {
        const binding = revision.binding(node.bindingId)
        const bindingId = identity()
        if (binding != null) operations.push({ binding, bindingId, kind: 'binding.create' })
        operations.push({ kind: 'graph.node.create', node: { ...node, bindingId }, nodeId, target })
      } else {
        operations.push({ kind: 'graph.node.create', node, nodeId, target })
      }
      continue
    }
    const remapInputs = (sourceInputs: Readonly<Record<string, InputMapping>>): Readonly<Record<string, InputMapping>> => {
      const inputs: Record<string, InputMapping> = {}
      for (const [handle, mapping] of Object.entries(sourceInputs)) {
        if (mapping.kind != 'sources') {
          inputs[handle] = mapping
          continue
        }
        const sources: (typeof mapping.sources)[number][] = []
        for (const source of mapping.sources) {
          if (source.kind == 'binding') {
            const copiedBindingId = bindingIds.get(source.bindingId)
            if (copiedBindingId != null) sources.push({ ...source, bindingId: copiedBindingId })
            continue
          }
          if (source.kind != 'node') {
            sources.push(source)
            continue
          }
          const copiedNodeId = ids.get(source.nodeId)
          if (copiedNodeId != null) sources.push({ ...source, nodeId: copiedNodeId })
        }
        if (sources.length > 0) inputs[handle] = { kind: 'sources', sources }
      }
      return inputs
    }
    const inputs = remapInputs(node.inputs)
    let copy: GraphNode = {
      ...node,
      inputs,
    }
    if (node.kind == 'condition')
      copy = mapConditionSources(node, (source) =>
        source.kind == 'node'
          ? { ...source, nodeId: ids.get(source.nodeId) ?? source.nodeId }
          : source.kind == 'binding'
            ? { ...source, bindingId: bindingIds.get(source.bindingId) ?? source.bindingId }
            : source,
      )
    if (node.kind == 'task' && node.task != null) {
      const moduleId = nodeId
      const module = clipboard.modules[node.task.moduleId]
      operations.push({ kind: 'module.create', module: { ...module, name: `${module.name} copy` }, moduleId })
      copy = {
        ...node,
        inputs,
        ...(node.name == null ? {} : { name: node.name }),
        task: { ...node.task, moduleId, name: `${node.task.name} copy` },
      }
    }
    operations.push({
      kind: 'graph.node.create',
      node: copy,
      nodeId,
      target,
    })
  }
  for (const edge of clipboard.edges) {
    const source = ids.get(edge.source)
    const destination = ids.get(edge.target)
    if (source != null && destination != null) operations.push({ kind: 'graph.edge.connect', target, edge: { ...edge, source, target: destination } })
  }
  return { changes: nameCreatedNodes(revision, target, operations), nodeIds: [...ids.values()], sourceIds }
}
