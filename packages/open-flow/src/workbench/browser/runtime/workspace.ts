import type { TFunction } from 'val-i18n'
import type {
  FlowDesignerViewConditionOperator,
  FlowDesignerViewInput,
  FlowDesignerViewModel,
  FlowDesignerViewNode,
  FlowDesignerViewNodeRun,
  FlowDesignerViewOutput,
  FlowDesignerViewTriggerField,
  FlowDesignerViewTriggerNode,
} from '../../../designer/browser/graph/FlowDesigner/FlowDesignerView.tsx'
import type { FlowDisplayMode } from '../../../designer/common/flowDisplay.ts'
import type {
  ConnectorAction,
  ConnectorConnection,
  Diagnostic,
  Draft,
  GraphNode,
  Group,
  JsonValue,
  Run,
  RunDetails,
  RunEvent,
  TaskDefinition,
  TriggerNode,
} from './api.ts'
import type { DesignerTarget } from './designer/flowChanges.ts'
import type { ResolvedNode, ResolvedSelection, RevisionView } from './revisionView.ts'

import { FLOW_DISPLAY_MODES } from '../../../designer/common/flowDisplay.ts'
import { variableInputCompatible } from '../../../flow/common/semantics.ts'
import { providerIcon } from './providerIcon.ts'
import { revisionView } from './revisionView.ts'

export interface Point {
  readonly x: number
  readonly y: number
}

export interface DesignerViewport extends Point {
  readonly zoom: number
}

export type DesignerNode = FlowDesignerViewNode

export interface DesignerEdge {
  readonly id: string
  readonly source: string
  readonly sourceHandle: string
  readonly target: string
  readonly targetHandle: string
}

export interface DesignerGraph extends FlowDesignerViewModel {
  readonly edges: readonly DesignerEdge[]
  readonly nodes: readonly DesignerNode[]
  readonly viewport: DesignerViewport
}

export interface ConnectionCatalog {
  readonly active: readonly ConnectorConnection[]
  readonly all: readonly ConnectorConnection[]
  readonly byId: ReadonlyMap<string, ConnectorConnection>
  readonly preferred?: ConnectorConnection
}

export interface DesignerComment {
  readonly content: string
  readonly position: Point
  readonly title: string
}

interface NodePorts {
  readonly inputs: Map<string, Omit<FlowDesignerViewInput, 'handle' | 'sources' | 'value'>>
  readonly outputs: Map<string, Omit<FlowDesignerViewOutput, 'handle'>>
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
  readonly connectorActions: Readonly<Record<string, ConnectorAction>>
  readonly diagnostics: readonly Diagnostic[]
  readonly revision: RevisionView
  readonly runNodes: ReadonlyMap<string, FlowDesignerViewNodeRun>
  readonly t: TFunction | undefined
  readonly target: DesignerTarget
  readonly variables: boolean
}

export function connectionCatalog(connections: readonly ConnectorConnection[]): ConnectionCatalog {
  const active: ConnectorConnection[] = []
  const byId = new Map<string, ConnectorConnection>()
  let defaultConnection: ConnectorConnection | undefined
  for (const connection of connections) {
    byId.set(connection.connectionId, connection)
    if (connection.status != 'active') continue
    active.push(connection)
    if (connection.isDefault) defaultConnection = connection
  }
  return {
    active,
    all: connections,
    byId,
    preferred: defaultConnection ?? (active.length == 1 ? active[0] : undefined),
  }
}

function nodeTitle(node: ResolvedNode, t?: TFunction): string {
  if (node.node.name != null) return node.node.name
  switch (node.kind) {
    case 'condition':
      return t?.('addNode.condition') ?? 'Condition'
    case 'value':
      return t?.('addNode.value') ?? 'Value'
    case 'wait':
      return 'Wait'
    case 'subflow':
      return node.definition?.name ?? node.node.subflowId
    case 'task':
      return node.definition?.name ?? (node.node.task != null ? node.node.task.moduleId : node.node.taskId)
  }
}

function nodeIcon(node: ResolvedNode): string | undefined {
  if (node.kind == 'value') return ':oomol:value:'
  if (node.kind != 'task') return undefined
  const task = node.definition
  if (task == null || 'moduleId' in task) return undefined
  return task.executor.kind == 'llm' ? ':carbon:machine-learning-model:' : ':carbon:connection-signal:'
}

function record(value: JsonValue | undefined): Readonly<Record<string, JsonValue>> | undefined {
  if (value == null || typeof value != 'object' || Array.isArray(value)) return undefined
  return value as Readonly<Record<string, JsonValue>>
}

function finite(value: JsonValue | undefined): number | undefined {
  return typeof value == 'number' && Number.isFinite(value) ? value : undefined
}

export function targetPresentation(value: Readonly<Record<string, JsonValue>>, target: DesignerTarget): Readonly<Record<string, JsonValue>> | undefined {
  const designer = record(value.designer)
  if (designer?.version != 1) return undefined
  return presentationTarget(designer, target)
}

function savedLayout(
  value: Readonly<Record<string, JsonValue>>,
  target: DesignerTarget,
  displayMode: FlowDisplayMode,
): Readonly<Record<string, JsonValue>> | undefined {
  return record(record(targetPresentation(value, target)?.layouts)?.[displayMode])
}

function savedPositions(
  value: Readonly<Record<string, JsonValue>>,
  target: DesignerTarget,
): Readonly<Record<string, { readonly x: number; readonly y: number }>> {
  const current = targetPresentation(value, target)
  const layouts = record(current?.layouts)
  const positions = (source: JsonValue | undefined): Readonly<Record<string, { readonly x: number; readonly y: number }>> => {
    return Object.fromEntries(
      Object.entries(record(source) ?? {}).flatMap(([nodeId, candidate]) => {
        const position = record(candidate)
        const x = finite(position?.x)
        const y = finite(position?.y)
        return x == null || y == null ? [] : [[nodeId, { x, y }]]
      }),
    )
  }
  return {
    ...positions(record(layouts?.overview)?.nodes),
    ...positions(current?.nodes),
    ...positions(record(layouts?.detail)?.nodes),
  }
}

function optionalViewport(value: Readonly<Record<string, JsonValue>>, target: DesignerTarget, displayMode: FlowDisplayMode): DesignerViewport | undefined {
  const legacyViewport = displayMode == 'detail' ? targetPresentation(value, target)?.viewport : undefined
  const viewport = record(savedLayout(value, target, displayMode)?.viewport ?? legacyViewport)
  const x = finite(viewport?.x)
  const y = finite(viewport?.y)
  const zoom = finite(viewport?.zoom)
  return x == null || y == null || zoom == null || zoom <= 0 ? undefined : { x, y, zoom }
}

function savedViewport(value: Readonly<Record<string, JsonValue>>, target: DesignerTarget, displayMode: FlowDisplayMode = 'detail'): DesignerViewport {
  return optionalViewport(value, target, displayMode) ?? { x: 0, y: 0, zoom: 1 }
}

function savedLayouts(
  value: Readonly<Record<string, JsonValue>>,
  target: DesignerTarget,
): Readonly<Record<string, { readonly viewport: { readonly x: number; readonly y: number; readonly zoom: number } }>> {
  return Object.fromEntries(
    FLOW_DISPLAY_MODES.flatMap((displayMode) => {
      const viewport = optionalViewport(value, target, displayMode)
      return viewport == null ? [] : [[displayMode, { viewport: { x: viewport.x, y: viewport.y, zoom: viewport.zoom } }]]
    }),
  )
}

function savedComments(
  value: Readonly<Record<string, JsonValue>>,
  target: DesignerTarget,
  positions: Readonly<Record<string, Point>>,
): Readonly<Record<string, DesignerComment>> {
  const comments = record(targetPresentation(value, target)?.comments) ?? {}
  return Object.fromEntries(
    Object.entries(comments).flatMap(([nodeId, candidate]) => {
      const comment = record(candidate)
      const title = typeof comment?.title == 'string' ? comment.title : undefined
      const content = typeof comment?.content == 'string' ? comment.content : undefined
      return title == null || content == null ? [] : [[nodeId, { content, position: positions[nodeId] ?? { x: 80, y: 80 }, title }]]
    }),
  )
}

function edgeId(source: string, sourceHandle: string, target: string, targetHandle: string): string {
  return JSON.stringify([source, sourceHandle, target, targetHandle])
}

function nodePorts(node: ResolvedSelection): NodePorts {
  if (node.kind == 'trigger') {
    return { inputs: new Map(), outputs: new Map([['payload', { jsonSchema: triggerPayloadSchema(node.trigger), nullable: false }]]) }
  }
  const inputs = new Map<string, Omit<FlowDesignerViewInput, 'handle' | 'sources' | 'value'>>(Object.keys(node.node.inputs).map((handle) => [handle, {}]))
  const outputs = new Map<string, Omit<FlowDesignerViewOutput, 'handle'>>()
  switch (node.kind) {
    case 'condition': {
      const definition = {
        defaultValue: node.node.input.value,
        description: node.node.input.description,
        jsonSchema: node.node.input.jsonSchema,
        nullable: node.node.input.nullable,
      }
      inputs.set(node.node.input.handle, definition)
      const output = { description: node.node.input.description, jsonSchema: node.node.input.jsonSchema, nullable: node.node.input.nullable }
      for (const item of node.node.cases) outputs.set(item.output, output)
      if (node.node.defaultOutput != null) outputs.set(node.node.defaultOutput, output)
      break
    }
    case 'value': {
      for (const port of node.node.values) {
        outputs.set(port.handle, { description: port.description, jsonSchema: port.jsonSchema, nullable: port.nullable })
      }
      break
    }
    case 'wait': {
      const input = node.node.input
      inputs.set(input.handle, { defaultValue: input.value, description: input.description, jsonSchema: input.jsonSchema, nullable: input.nullable })
      for (const action of node.node.actions) {
        outputs.set(action, { description: input.description, jsonSchema: input.jsonSchema, nullable: input.nullable })
      }
      break
    }
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

function conditionOperator(operator: import('./api.ts').ConditionOperator): FlowDesignerViewConditionOperator {
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

function nodeDiagnosticCount(target: DesignerTarget, node: ResolvedNode, diagnostics: readonly Diagnostic[]): number {
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
  target: DesignerTarget,
  run: Run | RunDetails | undefined,
  events: readonly RunEvent[],
): { readonly nodes: ReadonlyMap<string, FlowDesignerViewNodeRun>; readonly status?: 'idle' | 'running' } {
  if (target.kind != 'flow' || run?.flowId != revision.revision.flowId || run.revisionId != revision.revision.revisionId) return { nodes: new Map() }
  const active = run.status == 'queued' || run.status == 'starting' || run.status == 'running' || run.status == 'waiting'
  const nodes = new Map<string, FlowDesignerViewNodeRun>()
  if (run.status == 'waiting' && 'waiting' in run && run.waiting != null) {
    nodes.set(run.waiting.nodeId, { status: 'waiting' })
  }
  const rootScopeId = events.find((event) => event.kind == 'run.started' && event.payload.flowId == revision.revision.flowId)?.payload.scopeId
  if (typeof rootScopeId != 'string') return { nodes, status: active ? 'running' : 'idle' }
  for (const event of events) {
    if (event.payload.scopeId != rootScopeId || event.payload.flowId != revision.revision.flowId) continue
    const nodeId = event.payload.nodeId
    if (typeof nodeId != 'string') continue
    const current = nodes.get(nodeId)
    switch (event.kind) {
      case 'node.started':
        nodes.set(nodeId, { ...current, progress: 0, status: 'running' })
        break
      case 'node.progress': {
        const progress = event.payload.progress
        if (typeof progress == 'number') nodes.set(nodeId, { ...current, progress, status: current?.status ?? 'running' })
        break
      }
      case 'node.completed':
        nodes.set(nodeId, { progress: 100, status: 'success', successCount: (current?.successCount ?? 0) + 1 })
        break
      case 'node.failed':
        nodes.set(nodeId, { ...current, status: 'error' })
        break
    }
  }
  if (!active) {
    for (const [nodeId, state] of nodes) {
      if (state.status == 'running' || state.status == 'waiting') nodes.set(nodeId, { ...state, status: 'idle' })
    }
  }
  return { nodes, status: active ? 'running' : 'idle' }
}

function executorName(task: TaskDefinition | undefined, connectionRequired: boolean, t?: TFunction): string | undefined {
  if (task == null) return
  if ('moduleId' in task) return t?.('designer.executorJavaScript') ?? 'javascript'
  if (connectionRequired) return t?.('designer.executorConnectionRequired') ?? 'connection required'
  return task.executor.kind == 'llm' ? (t?.('designer.executorLlm') ?? 'llm') : (t?.('designer.executorConnector') ?? 'connector')
}

function triggerPayloadSchema(trigger: TriggerNode): JsonValue {
  if (trigger.kind == 'poll' || trigger.kind == 'integration') return trigger.definition.payloadSchema
  if (trigger.kind == 'cron') return { additionalProperties: false, type: 'object' }
  return {
    additionalProperties: false,
    properties: Object.fromEntries(trigger.inputsDef.map((input) => [input.handle, input.jsonSchema])),
    required: trigger.inputsDef.filter((input) => !input.nullable && !Object.hasOwn(input, 'value')).map((input) => input.handle),
    type: 'object',
  }
}

function triggerIcon(trigger: TriggerNode): string {
  switch (trigger.kind) {
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

function triggerDiagnosticCount(triggerId: string, diagnostics: readonly Diagnostic[]): number {
  return diagnostics.filter((diagnostic) => diagnostic.code != 'trigger.config-incomplete' && diagnostic.path.startsWith(`/document/graph/nodes/${triggerId}`))
    .length
}

function projectEdges(entries: readonly (readonly [string, GraphNode])[], nodeIds: ReadonlySet<string>, ports: ReadonlyMap<string, NodePorts>): EdgeProjection {
  const edges: DesignerEdge[] = []
  const edgeIds = new Set<string>()
  const dependencies = new Map([...nodeIds].map((nodeId) => [nodeId, new Set<string>()]))
  const dependents = new Map([...nodeIds].map((nodeId) => [nodeId, new Set<string>()]))
  for (const [targetId, node] of entries) {
    if (!('inputs' in node)) continue
    for (const [targetHandle, mapping] of Object.entries(node.inputs)) {
      if (mapping.kind != 'sources') continue
      for (const source of mapping.sources) {
        if (source.kind != 'node' || !nodeIds.has(source.nodeId)) continue
        const sourceId = source.nodeId
        const output = source.output
        const id = edgeId(sourceId, output, targetId, targetHandle)
        if (edgeIds.has(id)) continue
        edgeIds.add(id)
        if (!ports.get(sourceId)!.outputs.has(output)) ports.get(sourceId)!.outputs.set(output, {})
        if (!ports.get(targetId)!.inputs.has(targetHandle)) ports.get(targetId)!.inputs.set(targetHandle, {})
        edges.push({ id, source: sourceId, sourceHandle: output, target: targetId, targetHandle })
        dependencies.get(targetId)!.add(sourceId)
        dependents.get(sourceId)!.add(targetId)
      }
    }
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

function designerInputs(nodeId: string, node: GraphNode, ports: NodePorts, revision: RevisionView, variables: boolean): readonly FlowDesignerViewInput[] {
  if (!('inputs' in node)) return []
  const inputs: FlowDesignerViewInput[] = []
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
    const bindingSource = mapping?.kind == 'sources' && mapping.sources.length == 1 ? mapping.sources[0] : undefined
    const binding = bindingSource?.kind == 'binding' ? revision.binding(bindingSource.bindingId) : undefined
    inputs.push({
      ...definition,
      handle,
      ...(mapping?.kind == 'value' ? { value: mapping.value } : {}),
      ...(sources.length > 0 ? { sources } : {}),
      ...(binding?.kind == 'variable' ? { variable: binding.target } : {}),
      variableCompatible: variableInputCompatible(definition.jsonSchema as JsonValue),
      variableEnabled: variables,
    })
  }
  return inputs
}

function designerOutputs(ports: NodePorts): readonly FlowDesignerViewOutput[] {
  return [...ports.outputs].map(([handle, definition]) => Object.assign({ handle }, definition))
}

function groupedInputs(resolved: ResolvedNode, inputs: readonly FlowDesignerViewInput[]): readonly (FlowDesignerViewInput | Group)[] {
  if (resolved.kind != 'task' || resolved.definition == null) return inputs
  const ports = new Map(inputs.map((input) => [input.handle, input]))
  const result: (FlowDesignerViewInput | Group)[] = []
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

function groupedOutputs(resolved: ResolvedNode, outputs: readonly FlowDesignerViewOutput[]): readonly (FlowDesignerViewOutput | Group)[] {
  if (resolved.kind != 'task' || resolved.definition == null) return outputs
  const ports = new Map(outputs.map((output) => [output.handle, output]))
  const result: (FlowDesignerViewOutput | Group)[] = []
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

function configSource(value: JsonValue | undefined): string {
  return value === undefined ? '' : typeof value == 'string' ? value : JSON.stringify(value)
}

function triggerConfigFields(triggerId: string, trigger: TriggerNode, diagnostics: readonly Diagnostic[]): readonly FlowDesignerViewTriggerField[] {
  if (trigger.kind != 'integration' && trigger.kind != 'poll') return []
  const schema = record(trigger.definition.configSchema)
  const properties = record(schema?.properties)
  const required = new Set(Array.isArray(schema?.required) ? schema.required.filter((value): value is string => typeof value == 'string') : [])
  const incomplete = diagnostics.some(
    (diagnostic) => diagnostic.code == 'trigger.config-incomplete' && diagnostic.path == `/document/graph/nodes/${triggerId}/config`,
  )
  const fields: FlowDesignerViewTriggerField[] = []
  for (const [name, candidate] of Object.entries(properties ?? {})) {
    const field = record(candidate)
    if (field == null) continue
    const value = Object.hasOwn(trigger.config, name) ? trigger.config[name] : field.default
    const base = {
      ...(typeof field.description == 'string' ? { description: field.description } : {}),
      invalid: incomplete && required.has(name) && !Object.hasOwn(trigger.config, name),
      label: typeof field.title == 'string' ? field.title : name,
      name,
      required: required.has(name),
      source: configSource(value),
    }
    if (Array.isArray(field.enum)) {
      fields.push({
        ...base,
        kind: 'select',
        options: field.enum.map((option) => {
          const source = configSource(option)
          return { label: source, source, value: option }
        }),
      })
      continue
    }
    const items = record(field.items)
    if (field.type == 'array' && Array.isArray(items?.enum)) {
      fields.push({
        ...base,
        kind: 'multi-select',
        options: items.enum.map((option) => {
          const source = configSource(option)
          return { label: source, source, value: option }
        }),
        selected: Array.isArray(value) ? value.map(configSource) : [],
      })
      continue
    }
    switch (field.type) {
      case 'boolean':
      case 'integer':
      case 'number':
      case 'string':
        fields.push({ ...base, kind: field.type })
        break
      default:
        fields.push({ ...base, kind: 'json' })
        break
    }
  }
  return fields.toSorted(
    (left, right) =>
      Number(!left.required) - Number(!right.required) ||
      Number(left.kind == 'json' || left.kind == 'multi-select') - Number(right.kind == 'json' || right.kind == 'multi-select'),
  )
}

function triggerDesignerNode(triggerId: string, trigger: TriggerNode, position: Point, diagnostics: readonly Diagnostic[]): DesignerNode {
  let presentation: FlowDesignerViewTriggerNode['presentation']
  switch (trigger.kind) {
    case 'cron':
      presentation = { kind: trigger.kind, schedules: trigger.cronTimes }
      break
    case 'integration':
      presentation = { config: triggerConfigFields(triggerId, trigger, diagnostics), kind: trigger.kind, schedules: [], source: trigger.definition.provider }
      break
    case 'poll':
      presentation = {
        config: triggerConfigFields(triggerId, trigger, diagnostics),
        kind: trigger.kind,
        schedules: trigger.pollTimes,
        source: trigger.definition.provider,
      }
      break
    case 'webhook':
      presentation = {
        kind: trigger.kind,
        schedules: [],
        webhook: {
          inputs: trigger.inputsDef.map((input) => ({
            ...(input.description == null ? {} : { description: input.description }),
            handle: input.handle,
            jsonSchema: input.jsonSchema,
            nullable: input.nullable ?? false,
            ...(Object.hasOwn(input, 'value') ? { value: input.value } : {}),
          })),
          options: trigger.options ?? {},
        },
      }
      break
  }
  return {
    description: trigger.description,
    diagnostics: triggerDiagnosticCount(triggerId, diagnostics),
    icon:
      trigger.icon ??
      (trigger.kind == 'integration' || trigger.kind == 'poll'
        ? providerIcon({ serviceId: trigger.definition.provider, serviceName: trigger.definition.provider })
        : triggerIcon(trigger)),
    id: triggerId,
    inputs: [],
    kind: 'trigger',
    outputs: [{ handle: 'payload', jsonSchema: triggerPayloadSchema(trigger), nullable: false }],
    presentation,
    position,
    rawIcon: trigger.icon,
    rawTitle: trigger.name,
    title: trigger.name,
  }
}

function semanticDesignerNode(nodeId: string, resolved: ResolvedNode, ports: NodePorts, position: Point, context: NodeProjectionContext): DesignerNode {
  const node = resolved.node
  const inputs = groupedInputs(resolved, designerInputs(nodeId, node, ports, context.revision, context.variables))
  const outputs = groupedOutputs(resolved, designerOutputs(ports))
  const task = resolved.kind == 'task' ? resolved.definition : undefined
  const connector = task != null && 'executor' in task && task.executor.kind == 'connector' ? task.executor : undefined
  const connectorAction = connector == null ? undefined : context.connectorActions[connector.action]
  const connections = connectorAction == null ? undefined : context.connectionCatalogs[connectorAction.serviceId]
  const defaultConnection = connectorAction?.defaultConnection
  const connectionId = connector?.connectionId
  let selectedConnection = connectionId == null ? undefined : connections?.byId.get(connectionId)
  if (selectedConnection == null && defaultConnection != null && defaultConnection.connectionId == connectionId) selectedConnection = defaultConnection
  const connectionRequired =
    connectorAction?.authenticated == true && (connector?.connectionId == null || (connections != null && selectedConnection?.status != 'active'))
  const nodeRun = context.runNodes.get(nodeId)
  const common = {
    concurrency: node.concurrency,
    description: node.description,
    diagnostics: nodeDiagnosticCount(context.target, resolved, context.diagnostics),
    icon: node.icon ?? (connectorAction == null ? nodeIcon(resolved) : providerIcon(connectorAction)),
    id: nodeId,
    inputs,
    outputs,
    position,
    rawIcon: node.icon,
    rawTitle: node.name,
    ...(nodeRun == null ? {} : { run: nodeRun }),
    timeoutSeconds: node.timeoutMs == null ? undefined : node.timeoutMs / 1000,
    title: nodeTitle(resolved, context.t),
  }
  switch (node.kind) {
    case 'condition':
      return {
        ...common,
        kind: node.kind,
        cases: node.cases.map((item) => ({
          expressions: item.expressions.map((expression) => ({
            input: expression.input,
            operator: conditionOperator(expression.operator),
            value: expression.value,
          })),
          output: item.output,
          relation: item.relation,
        })),
        defaultOutput: node.defaultOutput,
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
        editableAdditionalInputs: node.task == null,
        editablePorts: node.task != null,
        kind: node.kind,
        executorName: executorName(task, connectionRequired, context.t),
        reference: node.task != null ? node.task.moduleId : node.taskId,
      }
    case 'value':
      return { ...common, kind: node.kind, values: node.values.map((port) => Object.assign({}, port)) }
    case 'wait': {
      const noticeTask = node.notification == null ? undefined : context.revision.task(node.notification.taskId)
      const action = noticeTask?.executor.kind == 'connector' ? context.connectorActions[noticeTask.executor.action] : undefined
      const name = (action?.name ?? noticeTask?.name)?.replaceAll('_', ' ')
      const target = name == null ? undefined : action == null ? name : `${action.serviceName} · ${name}`
      return {
        ...common,
        kind: node.kind,
        ...(target == null
          ? {}
          : {
              notice: {
                ...(action == null ? {} : { icon: providerIcon(action) }),
                text: `${context.t?.('inspector.wait.notificationTask') ?? 'Notification'} · ${target}`,
              },
            }),
      }
    }
  }
}

export function designerGraph(
  draft: Draft | undefined,
  target: DesignerTarget | undefined,
  presentation: Readonly<Record<string, JsonValue>> = {},
  diagnostics: readonly Diagnostic[] = [],
  connectorActions: Readonly<Record<string, ConnectorAction>> = {},
  connectionCatalogs: Readonly<Record<string, ConnectionCatalog>> = {},
  t?: TFunction,
  run?: Run | RunDetails,
  runEvents: readonly RunEvent[] = [],
  variableNames: readonly string[] = [],
  variableNamesLoaded = false,
  variableNamesLoading = false,
  variables = true,
): DesignerGraph {
  const revision = draft == null ? undefined : revisionView(draft)
  const graph = revision == null || target == null ? undefined : revision.graph(target)
  if (revision == null || target == null || graph == null) return { edges: [], nodes: [], viewport: { x: 0, y: 0, zoom: 1 } }
  const projectedRun = runProjection(revision, target, run, runEvents)

  const entries = Object.entries(graph.nodes)
  const definitions = new Map(entries.map(([nodeId, node]) => [nodeId, revision.resolveNode(nodeId, node)]))
  const nodeIds = new Set(entries.map(([nodeId]) => nodeId))
  const ports = new Map([...definitions].map(([nodeId, node]) => [nodeId, nodePorts(node)]))
  const edgeProjection = projectEdges(entries, nodeIds, ports)
  const layout = layoutNodes(nodeIds, edgeProjection.dependencies, edgeProjection.dependents)
  const positions = savedPositions(presentation, target)
  const context: NodeProjectionContext = {
    connectionCatalogs,
    connectorActions,
    diagnostics,
    revision,
    runNodes: projectedRun.nodes,
    t,
    target,
    variables,
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
      nodes.push(triggerDesignerNode(nodeId, resolved.trigger, position, diagnostics))
      continue
    }
    nodes.push(semanticDesignerNode(nodeId, resolved, ports.get(nodeId)!, position, context))
  }
  for (const [nodeId, comment] of Object.entries(savedComments(presentation, target, positions)).toSorted(([left], [right]) => left.localeCompare(right))) {
    nodes.push({ ...comment, id: nodeId, kind: 'comment' })
  }
  return {
    edges: edgeProjection.edges,
    layouts: savedLayouts(presentation, target),
    nodes,
    ...(projectedRun.status == null ? {} : { runStatus: projectedRun.status }),
    viewport: savedViewport(presentation, target),
    variableNames,
    variableNamesLoaded,
    variableNamesLoading,
  }
}

function designerPresentation(value: Readonly<Record<string, JsonValue>>): Readonly<Record<string, JsonValue>> {
  const designer = record(value.designer)
  return designer?.version == 1 ? designer : { version: 1 }
}

function presentationTarget(designer: Readonly<Record<string, JsonValue>>, target: DesignerTarget): Readonly<Record<string, JsonValue>> | undefined {
  return target.kind == 'flow' ? record(designer.flow) : record(record(designer.subflows)?.[target.id])
}

function replacePresentationTarget(
  designer: Readonly<Record<string, JsonValue>>,
  target: DesignerTarget,
  value: Readonly<Record<string, JsonValue>>,
): Readonly<Record<string, JsonValue>> {
  if (target.kind == 'flow') return { ...designer, flow: value, version: 1 }
  const subflows = record(designer.subflows) ?? {}
  return { ...designer, subflows: { ...subflows, [target.id]: value }, version: 1 }
}

function normalizedTarget(value: Readonly<Record<string, JsonValue>>, target: DesignerTarget): Record<string, JsonValue> {
  const normalized: Record<string, JsonValue> = {
    ...targetPresentation(value, target),
    layouts: savedLayouts(value, target),
    nodes: savedPositions(value, target),
  }
  delete normalized.viewport
  return normalized
}

export function setNodePosition(
  value: Readonly<Record<string, JsonValue>>,
  target: DesignerTarget,
  nodeId: string,
  position: Point,
): Readonly<Record<string, JsonValue>> {
  return setNodePositions(value, target, { [nodeId]: position })
}

export function setNodePositions(
  value: Readonly<Record<string, JsonValue>>,
  target: DesignerTarget,
  positions: Readonly<Record<string, Point>>,
): Readonly<Record<string, JsonValue>> {
  const designer = designerPresentation(value)
  const current = normalizedTarget(value, target)
  const nodes = record(current.nodes) ?? {}
  const nextNodes: Record<string, JsonValue> = {
    ...nodes,
    ...Object.fromEntries(Object.entries(positions).map(([nodeId, position]) => [nodeId, { x: position.x, y: position.y }])),
  }
  return {
    ...value,
    designer: replacePresentationTarget(designer, target, { ...current, nodes: nextNodes }),
  }
}

export function setComment(
  value: Readonly<Record<string, JsonValue>>,
  target: DesignerTarget,
  nodeId: string,
  comment: DesignerComment,
): Readonly<Record<string, JsonValue>> {
  const positioned = setNodePositions(value, target, { [nodeId]: comment.position })
  const designer = designerPresentation(positioned)
  const current = presentationTarget(designer, target) ?? {}
  const comments = record(current.comments) ?? {}
  return {
    ...positioned,
    designer: replacePresentationTarget(designer, target, {
      ...current,
      comments: { ...comments, [nodeId]: { content: comment.content, title: comment.title } },
    }),
  }
}

export function removeComments(
  value: Readonly<Record<string, JsonValue>>,
  target: DesignerTarget,
  nodeIds: ReadonlySet<string>,
): Readonly<Record<string, JsonValue>> {
  const designer = designerPresentation(value)
  const current = normalizedTarget(value, target)
  const comments = { ...record(current.comments) }
  const nodes = { ...record(current.nodes) }
  for (const nodeId of nodeIds) {
    delete comments[nodeId]
    delete nodes[nodeId]
  }
  return {
    ...value,
    designer: replacePresentationTarget(designer, target, { ...current, comments, nodes }),
  }
}

export function commentIds(value: Readonly<Record<string, JsonValue>>, target: DesignerTarget): ReadonlySet<string> {
  return new Set(Object.keys(record(targetPresentation(value, target)?.comments) ?? {}))
}

export function setFlowViewport(
  value: Readonly<Record<string, JsonValue>>,
  target: DesignerTarget,
  viewport: DesignerViewport,
  displayMode: FlowDisplayMode = 'detail',
): Readonly<Record<string, JsonValue>> {
  const currentViewport = optionalViewport(value, target, displayMode)
  if (currentViewport?.x == viewport.x && currentViewport.y == viewport.y && currentViewport.zoom == viewport.zoom) return value
  const designer = designerPresentation(value)
  const current = normalizedTarget(value, target)
  const layouts = record(current.layouts) ?? {}
  const layout = record(layouts[displayMode]) ?? {}
  return {
    ...value,
    designer: replacePresentationTarget(designer, target, {
      ...current,
      layouts: { ...layouts, [displayMode]: { ...layout, viewport: { x: viewport.x, y: viewport.y, zoom: viewport.zoom } } },
    }),
  }
}

export function eventSubject(event: RunEvent, t?: TFunction, nodeTitles?: ReadonlyMap<string, string>): string {
  const title = event.payload.nodeTitle
  if (typeof title == 'string') return title
  const executionId = event.payload.executionId
  if (typeof executionId == 'string') {
    const executionTitle = nodeTitles?.get(executionId)
    if (executionTitle != null) return executionTitle
  }
  const nodeId = event.payload.nodeId
  if (typeof nodeId == 'string') return nodeTitles?.get(nodeId) ?? nodeId
  return event.kind.startsWith('run.') ? (t?.('run.flowSubject') ?? 'Flow run') : (t?.('run.nodeSubject') ?? 'Node')
}
