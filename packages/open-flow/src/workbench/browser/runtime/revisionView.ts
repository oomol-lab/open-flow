import type { InputSourceCandidate, InputSourcesCheck } from '../../../flow/common/graph.ts'
import type {
  CodeModule,
  ApprovalNode,
  ConditionNode,
  Draft,
  Graph,
  GraphNode,
  FlowDocument,
  TaskDefinition,
  TaskNode,
  TriggerNode,
  ValueNode,
  WaitNode,
} from './api.ts'

import { nodeInputMappings } from '../../../flow/common/condition.ts'
import { connectionUsage } from '../../../flow/common/connectionUsage.ts'
import { checkInputSources, inputSourceCandidates, nodeOutputDescription, nodeOutputPorts } from '../../../flow/common/graph.ts'
import { agentActions, codeActions } from '../../../flow/common/semantics.ts'
import { sourcePort } from '../../../flow/common/sourceField.ts'

export interface InputSourceQuery {
  readonly check: () => InputSourcesCheck
  readonly candidates: () => Readonly<Record<string, readonly InputSourceCandidate[]>>
}

export type ResolvedNode =
  | { readonly id: string; readonly kind: 'condition'; readonly node: ConditionNode }
  | {
      readonly definition?: TaskDefinition
      readonly id: string
      readonly kind: 'task'
      readonly module?: CodeModule
      readonly node: TaskNode
    }
  | { readonly id: string; readonly kind: 'value'; readonly node: ValueNode }
  | { readonly id: string; readonly kind: 'approval'; readonly node: ApprovalNode }
  | { readonly id: string; readonly kind: 'wait'; readonly node: WaitNode }

export interface ResolvedTrigger {
  readonly id: string
  readonly kind: 'trigger'
  readonly node: TriggerNode
  readonly trigger: TriggerNode
}

export type ResolvedSelection = ResolvedNode | ResolvedTrigger

const views = new WeakMap<Draft, RevisionView>()

export class RevisionView {
  public readonly connectorReferences: ReturnType<typeof connectorAccessReferences>
  public readonly connectorActionIds: ReadonlySet<string>
  public readonly connectorProviderIds: ReadonlySet<string>
  readonly #document: FlowDocument
  readonly #modules: Draft['content']['modules']
  readonly #resolvedNodes = new WeakMap<GraphNode, Map<string, ResolvedSelection>>()
  readonly #inputSources = new Map<string, InputSourceQuery>()

  public constructor(public readonly revision: Draft) {
    this.#document = revision.content.document
    this.#modules = revision.content.modules
    this.connectorReferences = connectorAccessReferences(this.#document)
    const connectorActionIds = new Set<string>()
    for (const node of Object.values(this.#document.graph.nodes)) {
      if (node.kind == 'task' && 'executor' in node.task && node.task.executor.kind == 'connector') connectorActionIds.add(node.task.executor.action)
    }
    for (const declaration of [...codeActions(this.#document), ...agentActions(this.#document)]) {
      if ('action' in declaration) connectorActionIds.add(declaration.action)
      else if ('mode' in declaration) {
        if (declaration.mode == 'independent') for (const action of declaration.actions) connectorActionIds.add(action.action)
      } else {
        for (const action of declaration.actionHints ?? []) connectorActionIds.add(action)
        for (const hint of declaration.connectionHints ?? []) connectorActionIds.add(hint.action)
      }
    }
    this.connectorActionIds = connectorActionIds
    const connectorProviderIds = new Set<string>()
    for (const actionId of connectorActionIds) {
      const separator = actionId.indexOf('.')
      if (separator > 0) connectorProviderIds.add(actionId.slice(0, separator))
    }
    for (const node of Object.values(this.#document.graph.nodes)) {
      if (node.kind == 'integration' || node.kind == 'poll') connectorProviderIds.add(node.definition.provider)
    }
    this.connectorProviderIds = connectorProviderIds
  }

  public graph(): Graph {
    return this.#document.graph
  }

  public inputSource(nodeId: string, handle: string): InputSourceQuery {
    const graph = this.graph()
    const key = JSON.stringify([nodeId, handle])
    const cached = this.#inputSources.get(key)
    if (cached != null) return cached
    const node = graph.nodes[nodeId]!
    const mapping = 'inputs' in node ? nodeInputMappings(node)[handle] : undefined
    const sources = mapping?.kind === 'sources' ? mapping.sources.filter((source) => source.kind === 'node') : []
    let checks: InputSourcesCheck | undefined = sources.length == 0 ? { conflict: false, sources: [] } : undefined
    let candidates: ReturnType<typeof inputSourceCandidates> | undefined
    const query: InputSourceQuery = {
      check: () => (checks ??= checkInputSources(graph, nodeId, handle, sources)),
      candidates: () => (candidates ??= inputSourceCandidates(graph, nodeId, handle)),
    }
    this.#inputSources.set(key, query)
    return query
  }

  public sourceType(source: import('../../../flow/common/change.ts').Source): string | undefined {
    const graph = this.graph()
    const node = source.kind === 'node' ? graph.nodes[source.nodeId] : undefined
    const output = source.kind === 'node' && node != null ? nodeOutputPorts(node)[source.output] : undefined
    const schema = output == null || source.kind !== 'node' ? undefined : sourcePort(output, source.field)?.jsonSchema
    if (source.kind === 'binding') return 'string'
    if (schema != null && typeof schema === 'object' && !Array.isArray(schema) && 'type' in schema && typeof schema.type === 'string') return schema.type
    return
  }

  public outputDescription(nodeId: string, output: string): string | undefined {
    const graph = this.graph()
    return nodeOutputDescription(graph, nodeId, output)
  }

  public designerInputs(): readonly unknown[] {
    const inputs: unknown[] = [this.#document.graph]
    for (const [nodeId, node] of Object.entries(this.#document.graph.nodes)) {
      const resolved = this.resolveNode(nodeId, node)
      if (resolved.kind == 'task') inputs.push(resolved.definition)
    }
    return inputs
  }

  public node(nodeId: string): ResolvedSelection | undefined {
    const node = this.graph().nodes[nodeId]
    return node == null ? undefined : this.resolveNode(nodeId, node)
  }

  public selection(nodeId: string): ResolvedSelection | undefined {
    return this.node(nodeId)
  }

  public resolveNode(nodeId: string, node: GraphNode): ResolvedSelection {
    let resolvedById = this.#resolvedNodes.get(node)
    const cached = resolvedById?.get(nodeId)
    if (cached != null) return cached
    resolvedById ??= new Map()
    let resolved: ResolvedSelection
    switch (node.kind) {
      case 'condition':
        resolved = { id: nodeId, kind: node.kind, node }
        break
      case 'task': {
        const definition = node.task
        const module = definition != null && 'moduleId' in definition ? this.#modules[definition.moduleId] : undefined
        resolved = { definition, id: nodeId, kind: node.kind, module, node }
        break
      }
      case 'value':
        resolved = { id: nodeId, kind: node.kind, node }
        break
      case 'approval':
        resolved = { id: nodeId, kind: node.kind, node }
        break
      case 'wait':
        resolved = { id: nodeId, kind: node.kind, node }
        break
      case 'error':
      case 'manual':
      case 'cron':
      case 'integration':
      case 'poll':
      case 'webhook':
        resolved = { id: nodeId, kind: 'trigger', node, trigger: node }
        break
    }
    resolvedById.set(nodeId, resolved)
    this.#resolvedNodes.set(node, resolvedById)
    return resolved
  }

  public findModuleNode(moduleId: string): string | undefined {
    return Object.entries(this.graph().nodes).find(([, node]) => node.kind == 'task' && 'moduleId' in node.task && node.task.moduleId == moduleId)?.[0]
  }

  public connectorNodes(): readonly { readonly nodeId: string; readonly actionId: string; readonly connectionId?: string }[] {
    return Object.entries(this.#document.graph.nodes).flatMap(([nodeId, node]) => {
      if (node.kind != 'task' || !('executor' in node.task) || node.task.executor.kind != 'connector') return []
      return [{ nodeId, actionId: node.task.executor.action, connectionId: node.task.executor.connectionId }]
    })
  }

  public binding(bindingId: string): FlowDocument['bindings'][string] | undefined {
    return this.#document.bindings[bindingId]
  }

  public trigger(triggerId: string): TriggerNode | undefined {
    const node = this.#document.graph.nodes[triggerId]
    return node != null && !('inputs' in node) ? node : undefined
  }
}

export function revisionView(revision: Draft): RevisionView {
  let view = views.get(revision)
  if (view == null) {
    view = new RevisionView(revision)
    views.set(revision, view)
  }
  return view
}

export interface ConnectorAccountReference {
  readonly kind?: 'connector' | 'agent' | 'trigger' | 'notification' | 'code'
  readonly providerId: string
  readonly connectionId?: string
  readonly nodeId: string
  readonly name: string
}

function connectorAccessReferences(document: FlowDocument): { readonly accounts: readonly ConnectorAccountReference[]; readonly hasCode: boolean } {
  const accounts = [
    ...new Map(connectionUsage(document).map((use) => [JSON.stringify([use.nodeId, use.kind, use.providerId, use.connectionId]), use])).values(),
  ]
  const hasCode = Object.values(document.graph.nodes).some((node) => node.kind == 'task' && 'moduleId' in node.task)
  return { accounts, hasCode }
}
