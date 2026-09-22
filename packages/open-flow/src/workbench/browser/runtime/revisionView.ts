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
  SubflowNode,
  TaskDefinition,
  TaskNode,
  TriggerNode,
  ValueNode,
  WaitNode,
} from './api.ts'

import { nodeInputMappings } from '../../../flow/common/condition.ts'
import { checkInputSources, inputSourceCandidates, nodeOutputDescription, nodeOutputPorts } from '../../../flow/common/graph.ts'
import { agentActions, codeActions, referencedTaskIds } from '../../../flow/common/semantics.ts'
import { sourcePort } from '../../../flow/common/sourceField.ts'

export interface InputSourceQuery {
  readonly check: () => InputSourcesCheck
  readonly candidates: () => Readonly<Record<string, readonly InputSourceCandidate[]>>
}

type SubflowDefinition = FlowDocument['subflows'][string]

export type ResolvedNode =
  | { readonly id: string; readonly kind: 'condition'; readonly node: ConditionNode }
  | { readonly id: string; readonly kind: 'subflow'; readonly node: SubflowNode; readonly definition?: SubflowDefinition }
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
      else {
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
    for (const graph of [this.#document.graph, ...Object.values(this.#document.subflows).map((subflow) => subflow.graph)]) {
      for (const node of Object.values(graph.nodes)) {
        if (node.kind == 'integration' || node.kind == 'poll') connectorProviderIds.add(node.definition.provider)
      }
    }
    this.connectorProviderIds = connectorProviderIds
  }

  public subflow(subflowId: string): SubflowDefinition | undefined {
    return this.#document.subflows[subflowId]
  }

  public graph(target: GraphTarget): Graph | undefined {
    switch (target.kind) {
      case 'flow':
        return this.#document.graph
      case 'subflow':
        return this.#document.subflows[target.id]?.graph
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

  public designerInputs(target: GraphTarget): readonly unknown[] {
    const resource = target.kind == 'flow' ? { graph: this.#document.graph } : this.#document.subflows[target.id]
    if (resource == null) return []
    const inputs: unknown[] = [resource]
    for (const [nodeId, node] of Object.entries(resource.graph.nodes)) {
      const resolved = this.resolveNode(nodeId, node)
      if (resolved.kind == 'task' || resolved.kind == 'subflow') inputs.push(resolved.definition)
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
      case 'subflow':
        resolved = { definition: this.#document.subflows[node.subflowId], id: nodeId, kind: node.kind, node }
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

  public usesSubflow(subflowId: string): boolean {
    return this.#graphUsesSubflow(this.#document.graph, subflowId, new Set())
  }

  #taskNodes(graph: Graph): readonly TaskNodeReference[] {
    let taskNodes = this.#taskNodesByGraph.get(graph)
    if (taskNodes != null) return taskNodes
    taskNodes = Object.entries(graph.nodes).flatMap(([nodeId, node]) => (node.kind == 'task' && node.task == null ? [{ nodeId, taskId: node.taskId }] : []))
    this.#taskNodesByGraph.set(graph, taskNodes)
    return taskNodes
  }

  #graphUsesSubflow(graph: Graph, subflowId: string, visited: Set<string>): boolean {
    for (const node of Object.values(graph.nodes)) {
      if (node.kind != 'subflow') continue
      if (node.subflowId == subflowId) return true
      if (visited.has(node.subflowId)) continue
      visited.add(node.subflowId)
      const nested = this.#document.subflows[node.subflowId]
      if (nested != null && this.#graphUsesSubflow(nested.graph, subflowId, visited)) return true
    }
    return false
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
  readonly providerId: string
  readonly connectionId?: string
  readonly nodeId: string
  readonly name: string
  readonly target: GraphTarget
}

function connectorAccessReferences(document: FlowDocument): { readonly accounts: readonly ConnectorAccountReference[]; readonly hasCode: boolean } {
  const accounts: ConnectorAccountReference[] = []
  let hasCode = false
  const graphs = [
    { graph: document.graph, target: { kind: 'flow' } as GraphTarget, name: '' },
    ...Object.entries(document.subflows).map(([id, subflow]) => ({ graph: subflow.graph, target: { kind: 'subflow', id } as GraphTarget, name: subflow.name })),
  ]
  for (const { graph, target, name: graphName } of graphs) {
    for (const [nodeId, node] of Object.entries(graph.nodes)) {
      const task = node.kind == 'task' && node.taskId != null ? document.tasks[node.taskId] : undefined
      const name = [graphName, node.name ?? task?.name ?? nodeId].filter(Boolean).join(' / ')
      const add = (providerId: string, connectionId?: string): void => {
        if (
          !accounts.some(
            (item) =>
              item.target.kind == target.kind &&
              (target.kind == 'flow' || (item.target.kind == 'subflow' && item.target.id == target.id)) &&
              item.nodeId == nodeId &&
              item.providerId == providerId &&
              item.connectionId == connectionId,
          )
        ) {
          accounts.push({ providerId, ...(connectionId == null ? {} : { connectionId }), nodeId, name, target })
        }
      }
      if (node.kind == 'poll' || node.kind == 'integration') {
        const binding = document.bindings[node.bindingId]
        add(node.definition.provider, binding?.kind == 'connection' ? binding.target : undefined)
      } else if (node.kind == 'task') {
        if (node.task != null) hasCode = true
        if (task?.executor.kind == 'connector') add(task.executor.action.split('.')[0]!, task.executor.connectionId)
        if (task?.executor.kind == 'agent') {
          for (const tool of task.executor.tools) add(tool.action.split('.')[0]!, tool.connectionId)
          const notice = task.executor.notification == null ? undefined : document.tasks[task.executor.notification.taskId]?.executor
          if (notice?.kind == 'connector') add(notice.action.split('.')[0]!, notice.connectionId)
        }
      }
    }
  }
  return { accounts, hasCode }
}
