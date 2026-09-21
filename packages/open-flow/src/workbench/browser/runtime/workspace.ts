import type { TFunction } from 'val-i18n'
import type {
  FlowCanvasViewConditionOperator,
  FlowCanvasViewConditionOperand,
  FlowCanvasViewInput,
  FlowCanvasViewModel,
  FlowCanvasViewNode,
  FlowCanvasViewNodeRun,
  FlowCanvasViewOutput,
  FlowCanvasViewTriggerNode,
} from '../../../canvas/browser/graph/FlowCanvas/model.ts'
import type { ConditionOperand, GraphTarget } from '../../../flow/common/change.ts'
import type { ConnectorProvider, Diagnostic, Draft, GraphNode, Group, JsonValue, Run, RunDetails, RunEvent, TaskDefinition, TriggerNode } from './api.ts'
import type { Point, DesignerViewport } from './canvasPresentation.ts'
import type { ConnectionCatalog, ConnectorActionView } from './connectionCatalog.ts'
import type { ResolvedNode, ResolvedSelection, RevisionView } from './revisionView.ts'

import { resolutionOutputPorts } from '../../../flow/common/graph.ts'
import { sourceOutputLabel } from '../../../flow/common/sourceField.ts'
import { triggerOutputPorts } from '../../../trigger/common/contract.ts'
import { savedPositions, savedOrder, savedViewport, savedComments, savedHiddenNodeContent } from './canvasPresentation.ts'
import { providerIcon } from './providerIcon.ts'
import { revisionView } from './revisionView.ts'

export type DesignerNode = FlowCanvasViewNode

export interface DesignerEdge {
  readonly id: string
  readonly source: string
  readonly sourceHandle: string
  readonly target: string
  readonly targetHandle: string
}

export interface DesignerGraph extends FlowCanvasViewModel {
  readonly edges: readonly DesignerEdge[]
  readonly nodes: readonly DesignerNode[]
  readonly viewport: DesignerViewport
}

interface NodePorts {
  readonly inputs: Map<string, Omit<FlowCanvasViewInput, 'handle' | 'sources' | 'value'>>
  readonly outputs: Map<string, Omit<FlowCanvasViewOutput, 'handle'>>
}

interface EdgeProjection {
  readonly dependencies: ReadonlyMap<string, ReadonlySet<string>>
  readonly dependents: ReadonlyMap<string, ReadonlySet<string>>
  readonly edges: readonly DesignerEdge[]
}

interface NodeLayout {
  readonly depth: ReadonlyMap<string, number>
  readonly ordered: readonly string[]
}

interface NodeProjectionContext {
  readonly connectionCatalogs: Readonly<Record<string, ConnectionCatalog>>
  readonly connectorActions: Readonly<Record<string, ConnectorActionView>>
  readonly diagnostics: readonly Diagnostic[]
  readonly nodes: ReadonlyMap<string, ResolvedSelection>
  readonly providers: Readonly<Record<string, ConnectorProvider>>
  readonly revision: RevisionView
  readonly runNodes: ReadonlyMap<string, FlowCanvasViewNodeRun>
  readonly t: TFunction | undefined
  readonly target: GraphTarget
}

function semanticNodeIcon(node: ResolvedNode, connectorActions: Readonly<Record<string, ConnectorActionView>>): string | undefined {
  if (node.node.icon != null) return node.node.icon
  if (node.kind != 'task' || node.definition == null || !('executor' in node.definition) || node.definition.executor.kind != 'connector') return nodeIcon(node)
  const action = connectorActions[node.definition.executor.action]
  return action == null ? nodeIcon(node) : providerIcon(action)
}

function sourceNodePresentation(node: ResolvedSelection, context: NodeProjectionContext): { readonly icon?: string; readonly title: string } {
  if (node.kind != 'trigger') return { icon: semanticNodeIcon(node, context.connectorActions), title: nodeTitle(node, context.t) }
  return { icon: triggerNodeIcon(node.trigger, context.providers), title: node.trigger.name }
}

function nodeTitle(node: ResolvedNode, t?: TFunction): string {
  if (node.node.name != null) return node.node.name
  switch (node.kind) {
    case 'condition':
      return t?.('addNode.condition') ?? 'Condition'
    case 'value':
      return t?.('addNode.value') ?? 'Fixed Values'
    case 'approval':
      return t?.('addNode.approval') ?? 'Approval'
    case 'wait':
      return t?.('addNode.wait') ?? 'Wait'
    case 'subflow':
      return node.definition?.name ?? node.node.subflowId
    case 'task':
      return node.definition?.name ?? (node.node.task != null ? node.node.task.moduleId : node.node.taskId)
  }
}

function nodeIcon(node: ResolvedNode): string | undefined {
  switch (node.kind) {
    case 'condition':
      return ':carbon:child-node:'
    case 'subflow':
      return ':carbon:subflow:'
    case 'value':
      return ':oomol:value:'
    case 'approval':
      return ':carbon:stamp:'
    case 'wait':
      return ':carbon:hourglass:'
    case 'task': {
      const task = node.definition
      if (task == null) return
      if ('moduleId' in task) return ':carbon:code:'
      return task.executor.kind == 'connector' ? ':carbon:connection-signal:' : ':carbon:machine-learning-model:'
    }
  }
}

function edgeId(source: string, sourceHandle: string, target: string, targetHandle: string): string {
  return JSON.stringify([source, sourceHandle, target, targetHandle])
}

function nodePorts(node: ResolvedSelection): NodePorts {
  if (node.kind == 'trigger') {
    return { inputs: new Map(), outputs: new Map(Object.entries(triggerOutputPorts(node.trigger))) }
  }
  const inputs = new Map<string, Omit<FlowCanvasViewInput, 'handle' | 'sources' | 'value'>>(Object.keys(node.node.inputs).map((handle) => [handle, {}]))
  const outputs = new Map<string, Omit<FlowCanvasViewOutput, 'handle'>>()
  switch (node.kind) {
    case 'condition': {
      for (const item of node.node.cases) outputs.set(item.output, { description: item.description })
      outputs.set('otherwise', {})
      break
    }
    case 'value': {
      for (const port of node.node.values) {
        outputs.set(port.handle, { description: port.description, jsonSchema: port.jsonSchema, nullable: port.nullable })
      }
      break
    }
    case 'approval':
    case 'wait':
      for (const port of node.node.inputDefinitions)
        inputs.set(port.handle, {
          defaultValue: port.value,
          description: port.description,
          jsonSchema: port.jsonSchema,
          nullable: port.nullable,
        })
      for (const [handle, port] of Object.entries(resolutionOutputPorts(node.node))) outputs.set(handle, port)
      break
    case 'subflow': {
      const definition = node.definition
      for (const port of definition?.inputs ?? []) {
        inputs.set(port.handle, { defaultValue: port.value, description: port.description, jsonSchema: port.jsonSchema, nullable: port.nullable })
      }
      for (const port of definition?.outputs ?? []) {
        outputs.set(port.handle, { description: port.description, jsonSchema: port.jsonSchema, nullable: port.nullable })
      }
      break
    }
    case 'task': {
      const definition = node.definition
      const mappedInputs = [...inputs]
      inputs.clear()
      for (const port of definition?.inputs ?? []) {
        if (!('handle' in port)) continue
        inputs.set(port.handle, { defaultValue: port.value, description: port.description, jsonSchema: port.jsonSchema, nullable: port.nullable })
      }
      for (const port of node.node.additionalInputs ?? []) {
        inputs.set(port.handle, { defaultValue: port.value, description: port.description, jsonSchema: port.jsonSchema, nullable: port.nullable })
      }
      for (const [handle, port] of mappedInputs) {
        if (!inputs.has(handle)) inputs.set(handle, port)
      }
      for (const port of definition?.outputs ?? []) {
        if (!('handle' in port)) continue
        outputs.set(port.handle, { description: port.description, jsonSchema: port.jsonSchema, nullable: port.nullable })
      }
      break
    }
  }
  return { inputs, outputs }
}

function conditionOperator(operator: import('./api.ts').ConditionOperator): FlowCanvasViewConditionOperator {
  switch (operator) {
    case 'endsWith':
      return 'ends with'
    case 'hasKey':
      return 'has key'
    case 'hasValue':
      return 'has value'
    case 'isEmpty':
      return 'is empty'
    case 'isFalse':
      return 'is false'
    case 'isNotEmpty':
      return 'is not empty'
    case 'isNotNull':
      return 'is not null'
    case 'isNull':
      return 'is null'
    case 'isTrue':
      return 'is true'
    case 'notContains':
      return 'not contains'
    case 'notHasKey':
      return 'not has key'
    case 'notHasValue':
      return 'not has value'
    case 'startsWith':
      return 'starts with'
    case '!=':
    case '<':
    case '<=':
    case '==':
    case '>':
    case '>=':
    case 'contains':
      return operator
  }
}

function conditionOperand(operand: ConditionOperand, context: NodeProjectionContext): FlowCanvasViewConditionOperand {
  if (operand.kind == 'value') return JSON.stringify(operand.value) ?? '…'
  const source = operand.source
  if (source.kind == 'flow') return source.input
  if (source.kind == 'binding') return { kind: 'environment', label: context.t?.('nodeInput.variable') ?? 'Env' }
  const sourceNode = context.nodes.get(source.nodeId)
  const presentation = sourceNode == null ? undefined : sourceNodePresentation(sourceNode, context)
  return {
    icon: presentation?.icon,
    kind: 'node',
    label: `${presentation?.title ?? source.nodeId} · ${sourceOutputLabel(source)}`,
  }
}

function nodeDiagnosticCount(target: GraphTarget, node: ResolvedNode, diagnostics: readonly Diagnostic[]): number {
  const graphPath = target.kind == 'flow' ? `/document/graph/nodes/${node.id}` : `/document/subflows/${target.id}/graph/nodes/${node.id}`
  const paths = [graphPath]
  if (node.kind == 'task') {
    if (node.node.task != null) paths.push(`${graphPath}/task`)
    else paths.push(`/document/tasks/${node.node.taskId}`)
    const moduleId = node.definition != null && 'moduleId' in node.definition ? node.definition.moduleId : undefined
    if (moduleId != null) paths.push(`/modules/${moduleId}`)
  } else if (node.kind == 'subflow') {
    paths.push(`/document/subflows/${node.node.subflowId}`)
  }
  return diagnostics.filter((diagnostic) => paths.some((path) => diagnostic.path.startsWith(path))).length
}

function runProjection(
  revision: RevisionView,
  target: GraphTarget,
  run: Run | RunDetails | undefined,
  events: readonly RunEvent[],
): { readonly nodes: ReadonlyMap<string, FlowCanvasViewNodeRun>; readonly status?: 'idle' | 'running' } {
  if (target.kind != 'flow' || run?.flowId != revision.revision.flowId || run.revisionId != revision.revision.revisionId) return { nodes: new Map() }
  const active = run.status == 'queued' || run.status == 'starting' || run.status == 'running' || run.status == 'waiting'
  const nodes = new Map<string, FlowCanvasViewNodeRun>()
  if ('waits' in run) for (const wait of run.waits) nodes.set(wait.nodeId, { runId: run.runId, status: 'waiting' })
  const rootScopeId = events.find((event) => event.kind == 'run.started' && event.payload.flowId == revision.revision.flowId)?.payload.scopeId
  if (typeof rootScopeId != 'string') return { nodes, status: active ? 'running' : 'idle' }
  const running = new Map<string, string>()
  for (const event of events) {
    if (event.payload.scopeId != rootScopeId || event.payload.flowId != revision.revision.flowId) continue
    const nodeId = event.payload.nodeId
    if (typeof nodeId != 'string') continue
    const current = nodes.get(nodeId)
    switch (event.kind) {
      case 'node.started':
        running.set(event.payload.executionId, nodeId)
        nodes.set(nodeId, { ...current, runId: run.runId, startedAt: event.createdAt, status: 'running' })
        break
      case 'node.progress': {
        const progress = event.payload.progress
        nodes.set(nodeId, { ...current, progress, status: current?.status ?? 'running' })
        break
      }
      case 'node.completed':
        running.delete(event.payload.executionId)
        nodes.set(nodeId, {
          ...current,
          runId: run.runId,
          finishedAt: event.createdAt,
          outputs: event.payload.outputs,
          progress: 100,
          status: 'success',
          successCount: (current?.successCount ?? 0) + 1,
        })
        break
      case 'node.failed':
        running.delete(event.payload.executionId)
        nodes.set(nodeId, { ...current, runId: run.runId, finishedAt: event.createdAt, error: event.payload.error, status: 'error' })
        break
      case 'node.log':
        nodes.set(nodeId, {
          ...current,
          runId: run.runId,
          status: current?.status ?? 'idle',
          logs: [...(current?.logs ?? []), { message: event.payload.message, level: event.payload.level, time: event.createdAt }],
        })
        break
      case 'node.artifact':
        nodes.set(nodeId, {
          ...current,
          runId: run.runId,
          status: current?.status ?? 'idle',
          artifacts: [...(current?.artifacts ?? []), event.payload.artifact],
        })
        break
    }
  }
  if (active) {
    const runningCounts = new Map<string, number>()
    for (const nodeId of running.values()) {
      runningCounts.set(nodeId, (runningCounts.get(nodeId) ?? 0) + 1)
      nodes.set(nodeId, { ...nodes.get(nodeId), runId: run.runId, status: 'running' })
    }
    const waitingCounts = new Map<string, number>()
    if ('waits' in run) for (const wait of run.waits) waitingCounts.set(wait.nodeId, (waitingCounts.get(wait.nodeId) ?? 0) + 1)
    for (const [nodeId, count] of waitingCounts) {
      if ((runningCounts.get(nodeId) ?? 0) <= count) nodes.set(nodeId, { ...nodes.get(nodeId), runId: run.runId, status: 'waiting' })
    }
  } else {
    for (const [nodeId, state] of nodes) {
      if (state.status == 'running' || state.status == 'waiting') nodes.set(nodeId, { ...state, status: 'idle' })
    }
  }
  return { nodes, status: active ? 'running' : 'idle' }
}

function executorName(task: TaskDefinition | undefined, providerName: string | undefined, t?: TFunction): string | undefined {
  if (task == null) return
  if ('moduleId' in task) return t?.('designer.executorJavaScript') ?? 'javascript'
  if (task.executor.kind == 'agent') return 'Agent'
  if (task.executor.kind == 'llm') return t?.('designer.executorLlm') ?? 'llm'
  return `${t?.('designer.executorConnector') ?? 'connector'} · ${providerName ?? task.executor.action.split('.')[0]}`
}

function triggerIcon(trigger: TriggerNode): string {
  switch (trigger.kind) {
    case 'manual':
      return ':carbon:play:'
    case 'cron':
      return ':carbon:time:'
    case 'integration':
      return ':carbon:events:'
    case 'poll':
      return ':carbon:renew:'
    case 'webhook':
      return ':carbon:webhook:'
  }
}

function triggerNodeIcon(trigger: TriggerNode, providers: Readonly<Record<string, ConnectorProvider>>): string {
  if (trigger.icon != null) return trigger.icon
  if (trigger.kind != 'integration' && trigger.kind != 'poll') return triggerIcon(trigger)
  return providerIcon(providers[trigger.definition.provider] ?? { serviceId: trigger.definition.provider, serviceName: trigger.definition.provider })
}

function triggerDiagnostics(triggerId: string, diagnostics: readonly Diagnostic[]): readonly Diagnostic[] {
  const path = `/document/graph/nodes/${triggerId}`
  return diagnostics.filter(
    (diagnostic) => diagnostic.code != 'trigger.config-incomplete' && (diagnostic.path == path || diagnostic.path.startsWith(`${path}/`)),
  )
}

function projectEdges(graph: { readonly edges?: unknown }, nodeIds: ReadonlySet<string>): EdgeProjection {
  const edges: DesignerEdge[] = []
  const dependencies = new Map([...nodeIds].map((id) => [id, new Set<string>()]))
  const dependents = new Map([...nodeIds].map((id) => [id, new Set<string>()]))
  const sourceEdges = Array.isArray(graph.edges) ? graph.edges : []
  for (const value of sourceEdges) {
    if (value == null || typeof value != 'object' || Array.isArray(value)) continue
    const edge = value as Readonly<Record<string, unknown>>
    if (typeof edge.source != 'string' || typeof edge.target != 'string') continue
    if (edge.sourceHandle != null && typeof edge.sourceHandle != 'string') continue
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue
    const sourceHandle = edge.sourceHandle == null ? '$out' : `$branch:${edge.sourceHandle}`
    const targetHandle = '$in'
    edges.push({ id: edgeId(edge.source, sourceHandle, edge.target, targetHandle), source: edge.source, sourceHandle, target: edge.target, targetHandle })
    dependencies.get(edge.target)!.add(edge.source)
    dependents.get(edge.source)!.add(edge.target)
  }
  return { dependencies, dependents, edges }
}

function layoutNodes(
  nodeIds: ReadonlySet<string>,
  dependencies: ReadonlyMap<string, ReadonlySet<string>>,
  dependents: ReadonlyMap<string, ReadonlySet<string>>,
): NodeLayout {
  const indegree = new Map([...dependencies].map(([nodeId, sources]) => [nodeId, sources.size]))
  const depth = new Map<string, number>()
  const ordered: string[] = []
  const orderedIds = new Set<string>()
  const ready = [...indegree]
    .filter(([, count]) => count == 0)
    .map(([nodeId]) => nodeId)
    .toSorted()
  for (let cursor = 0; cursor < ready.length; cursor += 1) {
    const nodeId = ready[cursor]!
    ordered.push(nodeId)
    orderedIds.add(nodeId)
    const nextDepth = (depth.get(nodeId) ?? 0) + 1
    for (const targetId of [...dependents.get(nodeId)!].toSorted()) {
      depth.set(targetId, Math.max(depth.get(targetId) ?? 0, nextDepth))
      const count = indegree.get(targetId)! - 1
      indegree.set(targetId, count)
      if (count == 0) ready.push(targetId)
    }
  }
  const cycleDepth = Math.max(0, ...depth.values()) + 1
  for (const nodeId of [...nodeIds].filter((candidate) => !orderedIds.has(candidate)).toSorted()) {
    depth.set(nodeId, cycleDepth)
    ordered.push(nodeId)
  }
  return { depth, ordered }
}

function designerInputs(nodeId: string, node: GraphNode, ports: NodePorts): readonly FlowCanvasViewInput[] {
  if (!('inputs' in node)) return []
  const inputs: FlowCanvasViewInput[] = []
  for (const [handle, definition] of ports.inputs) {
    const mapping = node.inputs[handle]
    const sources: { readonly nodeId: string; readonly output: string }[] = []
    const sourceIds = new Set<string>()
    if (mapping?.kind == 'sources') {
      for (const source of mapping.sources) {
        if (source.kind != 'node') continue
        const sourceId = source.nodeId
        const output = source.output
        const id = edgeId(sourceId, output, nodeId, handle)
        if (sourceIds.has(id)) continue
        sourceIds.add(id)
        sources.push({ nodeId: sourceId, output })
      }
    }
    inputs.push({
      ...definition,
      handle,
      ...(mapping?.kind == 'value' ? { value: mapping.value } : {}),
      ...(sources.length > 0 ? { sources } : {}),
    })
  }
  return inputs
}

function designerOutputs(ports: NodePorts): readonly FlowCanvasViewOutput[] {
  return [...ports.outputs].map(([handle, definition]) => Object.assign({ handle }, definition))
}

function groupedInputs(resolved: ResolvedNode, inputs: readonly FlowCanvasViewInput[]): readonly (FlowCanvasViewInput | Group)[] {
  if (resolved.kind != 'task' || resolved.definition == null) return inputs
  const ports = new Map(inputs.map((input) => [input.handle, input]))
  const result: (FlowCanvasViewInput | Group)[] = []
  for (const item of resolved.definition.inputs) {
    if (!('handle' in item)) {
      result.push(item)
      continue
    }
    const port = ports.get(item.handle)
    if (port != null) {
      result.push(port)
      ports.delete(item.handle)
    }
  }
  result.push(...ports.values())
  return result
}

function groupedOutputs(resolved: ResolvedNode, outputs: readonly FlowCanvasViewOutput[]): readonly (FlowCanvasViewOutput | Group)[] {
  if (resolved.kind != 'task' || resolved.definition == null) return outputs
  const ports = new Map(outputs.map((output) => [output.handle, output]))
  const result: (FlowCanvasViewOutput | Group)[] = []
  for (const item of resolved.definition.outputs) {
    if (!('handle' in item)) {
      result.push(item)
      continue
    }
    const port = ports.get(item.handle)
    if (port != null) {
      result.push(port)
      ports.delete(item.handle)
    }
  }
  result.push(...ports.values())
  return result
}

function triggerDesignerNode(
  triggerId: string,
  trigger: TriggerNode,
  position: Point,
  diagnostics: readonly Diagnostic[],
  providers: Readonly<Record<string, ConnectorProvider>>,
): DesignerNode {
  const problems = triggerDiagnostics(triggerId, diagnostics)
  const connectionRequired = problems.some((problem) => problem.code == 'trigger.connection-missing' || problem.code == 'trigger.connection-invalid')
  const provider = trigger.kind == 'integration' || trigger.kind == 'poll' ? providers[trigger.definition.provider] : undefined
  let presentation: FlowCanvasViewTriggerNode['presentation']
  switch (trigger.kind) {
    case 'manual':
      presentation = { kind: trigger.kind, schedules: [] }
      break
    case 'cron':
      presentation = { kind: trigger.kind, schedules: trigger.cronTimes }
      break
    case 'integration':
      presentation = { kind: trigger.kind, schedules: [], source: provider?.serviceName ?? trigger.definition.provider }
      break
    case 'poll':
      presentation = {
        kind: trigger.kind,
        schedules: trigger.pollTimes,
        source: provider?.serviceName ?? trigger.definition.provider,
      }
      break
    case 'webhook':
      presentation = {
        kind: trigger.kind,
        schedules: [],
      }
      break
  }
  return {
    description: trigger.description,
    diagnostics: problems.length,
    connectionRequired,
    icon: triggerNodeIcon(trigger, providers),
    id: triggerId,
    inputs: [],
    kind: 'trigger',
    outputs: Object.entries(triggerOutputPorts(trigger)).map(([handle, port]) => Object.assign({ handle }, port)),
    presentation,
    position,
    title: trigger.name,
  }
}

function semanticDesignerNode(nodeId: string, resolved: ResolvedNode, ports: NodePorts, position: Point, context: NodeProjectionContext): DesignerNode {
  const node = resolved.node
  const inputs = groupedInputs(resolved, designerInputs(nodeId, node, ports))
  const outputs = groupedOutputs(resolved, designerOutputs(ports))
  const task = resolved.kind == 'task' ? resolved.definition : undefined
  const connector = task != null && 'executor' in task && task.executor.kind == 'connector' ? task.executor : undefined
  const connectorAction = connector == null ? undefined : context.connectorActions[connector.action]
  const connections = connectorAction == null ? undefined : context.connectionCatalogs[connectorAction.serviceId]
  const connectionId = connector?.connectionId
  const selectedConnection = connectionId == null ? undefined : connections?.byId.get(connectionId)
  const connectionRequired =
    connectorAction?.authenticated == true && (connector?.connectionId == null || (connections != null && selectedConnection?.status != 'active'))
  const nodeRun = context.runNodes.get(nodeId)
  const common = {
    description: node.description,
    diagnostics: nodeDiagnosticCount(context.target, resolved, context.diagnostics),
    icon: semanticNodeIcon(resolved, context.connectorActions),
    id: nodeId,
    inputs,
    outputs,
    position,
    ...(nodeRun == null ? {} : { run: nodeRun }),
    title: nodeTitle(resolved, context.t),
  }
  switch (node.kind) {
    case 'condition':
      return {
        ...common,
        kind: node.kind,
        cases: node.cases.map((item) => ({
          ...(item.description == null ? {} : { description: item.description }),
          groups: item.groups.map((group) => ({
            expressions: group.expressions.map((expression) => ({
              left: conditionOperand(expression.left, context),
              operator: conditionOperator(expression.operator),
              right: expression.right == null ? undefined : conditionOperand(expression.right, context),
            })),
          })),
          output: item.output,
        })),
        matchMode: node.matchMode,
        defaultOutput: 'otherwise',
      }
    case 'subflow':
      return { ...common, kind: node.kind, reference: node.subflowId }
    case 'task':
      return {
        ...common,
        additionalInputs: node.additionalInputs?.flatMap((port) => {
          const input = inputs.find((item) => 'handle' in item && item.handle == port.handle)
          return input == null || 'group' in input ? [] : [input]
        }),
        kind: node.kind,
        executorName: executorName(task, connectorAction?.serviceName, context.t),
        connectionRequired,
        ...(task != null && 'executor' in task && task.executor.kind == 'agent'
          ? {
              tools: task.executor.tools.map((tool) => {
                const action = context.connectorActions[tool.action]
                const serviceId = action?.serviceId ?? tool.action.split('.')[0]!
                const serviceName = action?.serviceName ?? serviceId
                return {
                  id: tool.id,
                  icon: providerIcon(action ?? { serviceId, serviceName }),
                  label: `${serviceName} · ${action?.name ?? tool.action.slice(tool.action.indexOf('.') + 1)}`,
                }
              }),
            }
          : {}),
        reference: node.task != null ? node.task.moduleId : node.taskId,
      }
    case 'value':
      return { ...common, kind: node.kind, values: node.values.map((port) => Object.assign({}, port)) }
    case 'approval':
    case 'wait':
      return { ...common, kind: node.kind }
  }
}

export function designerGraph(
  draft: Draft | undefined,
  target: GraphTarget | undefined,
  presentation: Readonly<Record<string, JsonValue>> = {},
  diagnostics: readonly Diagnostic[] = [],
  connectorActions: Readonly<Record<string, ConnectorActionView>> = {},
  connectionCatalogs: Readonly<Record<string, ConnectionCatalog>> = {},
  t?: TFunction,
  run?: Run | RunDetails,
  runEvents: readonly RunEvent[] = [],
  providers: Readonly<Record<string, ConnectorProvider>> = {},
): DesignerGraph {
  const revision = draft == null ? undefined : revisionView(draft)
  const graph = revision == null || target == null ? undefined : revision.graph(target)
  if (revision == null || target == null || graph == null) return { edges: [], nodes: [], viewport: { x: 0, y: 0, zoom: 1 } }
  const projectedRun = runProjection(revision, target, run, runEvents)

  const entries = Object.entries(graph.nodes)
  const definitions = new Map(entries.map(([nodeId, node]) => [nodeId, revision.resolveNode(nodeId, node)]))
  const nodeIds = new Set(entries.map(([nodeId]) => nodeId))
  const ports = new Map([...definitions].map(([nodeId, node]) => [nodeId, nodePorts(node)]))
  const edgeProjection = projectEdges(graph, nodeIds)
  const layout = layoutNodes(nodeIds, edgeProjection.dependencies, edgeProjection.dependents)
  const positions = savedPositions(presentation, target)
  const hiddenNodeContent = savedHiddenNodeContent(presentation, target)
  const context: NodeProjectionContext = {
    connectionCatalogs,
    connectorActions,
    diagnostics,
    nodes: definitions,
    providers,
    revision,
    runNodes: projectedRun.nodes,
    t,
    target,
  }
  const rows = new Map<number, number>()
  const nodes: DesignerNode[] = []
  for (const nodeId of layout.ordered) {
    const column = layout.depth.get(nodeId) ?? 0
    const row = rows.get(column) ?? 0
    rows.set(column, row + 1)
    const position = positions[nodeId] ?? { x: 80 + column * 500, y: 80 + row * 240 }
    const resolved = definitions.get(nodeId)!
    if (resolved.kind == 'trigger') {
      nodes.push({
        ...triggerDesignerNode(nodeId, resolved.trigger, position, diagnostics, providers),
        contentHidden: hiddenNodeContent?.[nodeId] === true,
      })
      continue
    }
    const node = semanticDesignerNode(nodeId, resolved, ports.get(nodeId)!, position, context)
    nodes.push({ ...node, contentHidden: hiddenNodeContent?.[nodeId] === true })
  }
  for (const [nodeId, comment] of Object.entries(savedComments(presentation, target, positions)).toSorted(([left], [right]) => left.localeCompare(right))) {
    nodes.push({
      ...comment,
      id: nodeId,
      kind: 'comment',
      contentHidden: hiddenNodeContent?.[nodeId] === true,
    })
  }
  const order = new Map(savedOrder(presentation, target).map((nodeId, index) => [nodeId, index]))
  nodes.sort((left, right) => (order.get(left.id) ?? -1) - (order.get(right.id) ?? -1))
  return {
    edges: edgeProjection.edges,
    nodes,
    ...(projectedRun.status == null ? {} : { runStatus: projectedRun.status }),
    viewport: savedViewport(presentation, target),
  }
}
