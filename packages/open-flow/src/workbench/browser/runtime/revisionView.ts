import type { InputSourceCandidate, InputSourcesCheck } from '../../../flow/common/graph.ts'
import type {
  CodeModule,
  ApprovalNode,
  ConditionNode,
  Draft,
  Graph,
  GraphNode,
  GraphTarget,
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
import { agentActions, codeActions, referencedTaskIds } from '../../../flow/common/semantics.ts'
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

interface TaskNodeReference {
  readonly nodeId: string
  readonly taskId: string
}

const views = new WeakMap<Draft, RevisionView>()

export class RevisionView {
  public readonly connectorReferences: ReturnType<typeof connectorAccessReferences>
  public readonly connectorActionIds: ReadonlySet<string>
  public readonly connectorProviderIds: ReadonlySet<string>
  readonly #document: FlowDocument
  readonly #modules: Draft['content']['modules']
  readonly #resolvedNodes = new WeakMap<GraphNode, Map<string, ResolvedSelection>>()
  readonly #inputSourcesByGraph = new WeakMap<Graph, Map<string, InputSourceQuery>>()
  readonly #taskNodesByGraph = new WeakMap<Graph, readonly TaskNodeReference[]>()

  public constructor(public readonly revision: Draft) {
    this.#document = revision.content.document
    this.#modules = revision.content.modules
    this.connectorReferences = connectorAccessReferences(this.#document)
    const connectorActionIds = new Set<string>()
    const tasks = Object.fromEntries(
      [...referencedTaskIds(this.#document)].flatMap((id) => (this.#document.tasks[id] == null ? [] : [[id, this.#document.tasks[id]]])),
    )
    for (const task of Object.values(tasks)) if (task.executor.kind == 'connector') connectorActionIds.add(task.executor.action)
    for (const declaration of [...codeActions(this.#document), ...agentActions({ tasks })]) {
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

  public graph(target: GraphTarget): Graph | undefined {
    switch (target.kind) {
      case 'flow':
        return this.#document.graph
    }
  }

  public inputSource(target: GraphTarget, nodeId: string, handle: string): InputSourceQuery {
    const graph = this.graph(target)!
    let queries = this.#inputSourcesByGraph.get(graph)
    const key = JSON.stringify([nodeId, handle])
    const cached = queries?.get(key)
    if (cached != null) return cached
    const node = graph.nodes[nodeId]!
    const mapping = 'inputs' in node ? nodeInputMappings(node)[handle] : undefined
    const sources = mapping?.kind === 'sources' ? mapping.sources.filter((source) => source.kind === 'node') : []
    let checks: InputSourcesCheck | undefined = sources.length == 0 ? { conflict: false, sources: [] } : undefined
    let candidates: ReturnType<typeof inputSourceCandidates> | undefined
    const query: InputSourceQuery = {
      check: () => (checks ??= checkInputSources(this.#document, graph, nodeId, handle, sources)),
      candidates: () => (candidates ??= inputSourceCandidates(this.#document, graph, nodeId, handle)),
    }
    if (queries == null) this.#inputSourcesByGraph.set(graph, (queries = new Map()))
    queries.set(key, query)
    return query
  }

  public sourceType(target: GraphTarget, source: import('../../../flow/common/change.ts').Source): string | undefined {
    const graph = this.graph(target)
    const node = source.kind === 'node' ? graph?.nodes[source.nodeId] : undefined
    const output = source.kind === 'node' && node != null ? nodeOutputPorts(this.#document, node)[source.output] : undefined
    const schema = output == null || source.kind !== 'node' ? undefined : sourcePort(output, source.field)?.jsonSchema
    if (source.kind === 'binding') return 'string'
    if (schema != null && typeof schema === 'object' && !Array.isArray(schema) && 'type' in schema && typeof schema.type === 'string') return schema.type
    return
  }

  public outputDescription(target: GraphTarget, nodeId: string, output: string): string | undefined {
    const graph = this.graph(target)
    return graph == null ? undefined : nodeOutputDescription(this.#document, graph, nodeId, output)
  }

  public designerInputs(): readonly unknown[] {
    const inputs: unknown[] = [this.#document.graph]
    for (const [nodeId, node] of Object.entries(this.#document.graph.nodes)) {
      const resolved = this.resolveNode(nodeId, node)
      if (resolved.kind == 'task') inputs.push(resolved.definition)
    }
    return inputs
  }

  public node(target: GraphTarget, nodeId: string): ResolvedSelection | undefined {
    const node = this.graph(target)?.nodes[nodeId]
    return node == null ? undefined : this.resolveNode(nodeId, node)
  }

  public selection(target: GraphTarget, nodeId: string): ResolvedSelection | undefined {
    return this.node(target, nodeId)
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
        const definition = node.task != null ? node.task : this.#document.tasks[node.taskId]
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

  public findTaskNode(target: GraphTarget, taskIds: ReadonlySet<string>): string | undefined {
    const graph = this.graph(target)
    if (graph == null) return
    return this.#taskNodes(graph).find(({ taskId }) => taskIds.has(taskId))?.nodeId
  }

  public findModuleNode(target: GraphTarget, moduleId: string): string | undefined {
    return Object.entries(this.graph(target)?.nodes ?? {}).find(([, node]) => node.kind == 'task' && node.task?.moduleId == moduleId)?.[0]
  }

  public task(taskId: string): FlowDocument['tasks'][string] | undefined {
    return this.#document.tasks[taskId]
  }

  public tasks(): [string, TaskDefinition][] {
    return Object.entries(this.#document.tasks)
  }

  public binding(bindingId: string): FlowDocument['bindings'][string] | undefined {
    return this.#document.bindings[bindingId]
  }

  public trigger(triggerId: string): TriggerNode | undefined {
    const node = this.#document.graph.nodes[triggerId]
    return node != null && !('inputs' in node) ? node : undefined
  }

  #taskNodes(graph: Graph): readonly TaskNodeReference[] {
    let taskNodes = this.#taskNodesByGraph.get(graph)
    if (taskNodes != null) return taskNodes
    taskNodes = Object.entries(graph.nodes).flatMap(([nodeId, node]) => (node.kind == 'task' && node.task == null ? [{ nodeId, taskId: node.taskId }] : []))
    this.#taskNodesByGraph.set(graph, taskNodes)
    return taskNodes
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
  readonly target: GraphTarget
}

function connectorAccessReferences(document: FlowDocument): { readonly accounts: readonly ConnectorAccountReference[]; readonly hasCode: boolean } {
  const accounts = [
    ...new Map(connectionUsage(document).map((use) => [JSON.stringify([use.target, use.nodeId, use.kind, use.providerId, use.connectionId]), use])).values(),
  ]
  const hasCode = Object.values(document.graph.nodes).some((node) => node.kind == 'task' && node.task != null)
  return { accounts, hasCode }
}
