import { dequal } from 'dequal/lite'

export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue }

export const resourceNameMaxLength = 80

export type ResourceNameIssue = 'controlCharacter' | 'empty' | 'specialCharacter' | 'tooLong'

export function resourceNameIssue(value: string): ResourceNameIssue | undefined {
  const name = value.trim()
  if (name.length == 0) return 'empty'
  if (name.length > resourceNameMaxLength) return 'tooLong'
  for (const character of name) {
    const code = character.charCodeAt(0)
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return 'controlCharacter'
  }
  if (!/^[\p{L}\p{N}](?:[\p{L}\p{N} _-]*[\p{L}\p{N}])?$/u.test(name)) return 'specialCharacter'
}

export function validVariableName(value: string): boolean {
  return value.length <= 256 && /^[A-Za-z_][A-Za-z0-9_]*$/.test(value) && value.slice(0, 3).toUpperCase() != 'OO_'
}

export interface PortDefinition {
  readonly description?: string
  readonly jsonSchema: JsonValue
  readonly nullable: boolean
}

export interface InputPortDefinition extends PortDefinition {
  readonly value?: JsonValue
}

export interface Port extends PortDefinition {
  readonly handle: string
}

export interface InputPort extends InputPortDefinition {
  readonly handle: string
}

export interface Group {
  readonly collapsed?: boolean
  readonly group: string
}

export function portsByHandle<Value extends Port>(ports: readonly (Value | Group)[]): Readonly<Record<string, Value>> {
  return Object.fromEntries(ports.flatMap((port) => ('handle' in port ? [[port.handle, port]] : [])))
}

export interface NodeSource {
  readonly kind: 'node'
  readonly nodeId: string
  readonly output: string
}

export interface FlowSource {
  readonly input: string
  readonly kind: 'flow'
}

export interface BindingSource {
  readonly bindingId: string
  readonly kind: 'binding'
}

export type InputMapping =
  | { readonly kind: 'sources'; readonly sources: readonly (BindingSource | FlowSource | NodeSource)[] }
  | { readonly kind: 'value'; readonly value: JsonValue }

export interface OutputMapping {
  readonly sources: readonly (FlowSource | NodeSource)[]
}

interface GraphNodeBase {
  readonly concurrency: number
  readonly description?: string
  readonly icon?: string
  readonly inputs: Readonly<Record<string, InputMapping>>
  readonly name?: string
  readonly timeoutMs?: number
}

export interface SubflowNode extends GraphNodeBase {
  readonly kind: 'subflow'
  readonly subflowId: string
}

export interface ValueNode extends GraphNodeBase {
  readonly kind: 'value'
  readonly values: readonly InputPort[]
}

export type WaitAction = 'approve' | 'continue' | 'reject'

export interface WaitNode extends GraphNodeBase {
  readonly actions: readonly ['continue'] | readonly ['approve', 'reject']
  readonly input: InputPort
  readonly kind: 'wait'
  readonly notification?: {
    readonly inputs: Readonly<Record<string, InputMapping>>
    readonly messageHandle: string
    readonly taskId: string
  }
  readonly prompt: string
  readonly timeoutMs?: never
}

export type ConditionOperator =
  | '!='
  | '<'
  | '<='
  | '=='
  | '>'
  | '>='
  | 'contains'
  | 'endsWith'
  | 'hasKey'
  | 'hasValue'
  | 'isEmpty'
  | 'isFalse'
  | 'isNotEmpty'
  | 'isNotNull'
  | 'isNull'
  | 'isTrue'
  | 'notContains'
  | 'notHasKey'
  | 'notHasValue'
  | 'startsWith'

export interface ConditionExpression {
  readonly input: string
  readonly operator: ConditionOperator
  readonly value?: JsonValue
}

export interface ConditionCase {
  readonly expressions: readonly ConditionExpression[]
  readonly output: string
  readonly relation: 'all' | 'any'
}

export interface ConditionNode extends GraphNodeBase {
  readonly cases: readonly ConditionCase[]
  readonly defaultOutput?: string
  readonly input: InputPort
  readonly kind: 'condition'
}

export type ManagedTaskExecutor =
  | { readonly kind: 'connector'; readonly action: string; readonly connectionId?: string }
  | { readonly kind: 'llm'; readonly mode: 'chat' | 'json' }

export interface ConnectorCapability {
  readonly action: string
  readonly connectionId: string
  readonly kind: 'connector'
}

interface TaskDefinitionBase {
  readonly inputs: readonly (InputPort | Group)[]
  readonly name: string
  readonly outputs: readonly (Port | Group)[]
}

export interface InlineTaskDefinition extends TaskDefinitionBase {
  readonly capabilities?: readonly ConnectorCapability[]
  readonly moduleId: string
}

export interface ManagedTaskDefinition extends TaskDefinitionBase {
  readonly executor: ManagedTaskExecutor
}

export type TaskDefinition = InlineTaskDefinition | ManagedTaskDefinition

export type TaskNode = GraphNodeBase & { readonly kind: 'task' } & (
    | { readonly additionalInputs?: readonly InputPort[]; readonly task: InlineTaskDefinition; readonly taskId?: never }
    | { readonly additionalInputs?: readonly InputPort[]; readonly task?: never; readonly taskId: string }
  )

export interface Graph {
  readonly nodes: Readonly<Record<string, GraphNode>>
}

export type TriggerSchedule =
  | { readonly expression: string; readonly timezone: string; readonly type: 'cron' }
  | { readonly type: 'every'; readonly unit: 'day' | 'hour' | 'minute' | 'month' | 'week'; readonly value: number }

interface TriggerKeySnapshotBase {
  readonly configSchema: JsonValue
  readonly definitionVersion: number
  readonly description: string
  readonly displayName: string
  readonly key: string
  readonly name: string
  readonly payloadSchema: JsonValue
  readonly provider: string
}

export type IntegrationEndpointMethod = 'DELETE' | 'GET' | 'HEAD' | 'PATCH' | 'POST' | 'PUT'

export type IntegrationBodyFormat = 'form' | 'json' | 'multipart' | 'text'

export interface IntegrationEndpointDeclaration {
  readonly body: {
    readonly allowArray: boolean
    readonly allowEmpty: boolean
    readonly formats: readonly IntegrationBodyFormat[]
  }
  readonly methods: readonly IntegrationEndpointMethod[]
  readonly successStatus: number
}

export type TriggerKeySnapshot =
  | (TriggerKeySnapshotBase & { readonly type: 'poll' })
  | (TriggerKeySnapshotBase & { readonly endpoint: IntegrationEndpointDeclaration; readonly type: 'integration' })

export interface WebhookInputDefinition extends InputPort {}

export interface WebhookOptions {
  readonly allowedMethods?: readonly string[]
  readonly allowedOrigins?: readonly string[]
  readonly noResponseBody?: boolean
  readonly responseData?: string
  readonly responseHeaders?: Readonly<Record<string, string>>
  readonly responseStatusCode?: number
}

interface TriggerNodeBase {
  readonly description?: string
  readonly icon?: string
  readonly name: string
}

export type TriggerNode =
  | (TriggerNodeBase & {
      readonly inputsDef: readonly WebhookInputDefinition[]
      readonly kind: 'webhook'
      readonly options?: WebhookOptions
    })
  | (TriggerNodeBase & { readonly cronTimes: readonly TriggerSchedule[]; readonly kind: 'cron' })
  | (TriggerNodeBase & {
      readonly bindingId: string
      readonly config: Readonly<Record<string, JsonValue>>
      readonly definition: TriggerKeySnapshot & { readonly type: 'poll' }
      readonly kind: 'poll'
      readonly pollTimes: readonly TriggerSchedule[]
    })
  | (TriggerNodeBase & {
      readonly bindingId: string
      readonly config: Readonly<Record<string, JsonValue>>
      readonly definition: TriggerKeySnapshot & { readonly type: 'integration' }
      readonly kind: 'integration'
    })

export type GraphNode = ConditionNode | SubflowNode | TaskNode | TriggerNode | ValueNode | WaitNode

export interface FlowDocument {
  readonly bindings: Readonly<Record<string, { readonly kind: 'connection' | 'variable'; readonly target: string }>>
  readonly graph: Graph
  readonly subflows: Readonly<
    Record<
      string,
      {
        readonly graph: Graph
        readonly inputs: readonly InputPort[]
        readonly name: string
        readonly outputs: readonly (OutputMapping & Port)[]
      }
    >
  >
  readonly tasks: Readonly<Record<string, ManagedTaskDefinition>>
}

export interface CodeModule {
  readonly imports: readonly string[]
  readonly name: string
  readonly source: string
}

export interface RevisionContent {
  readonly document: FlowDocument
  readonly modelVersion: 1
  readonly modules: Readonly<Record<string, CodeModule>>
}

export type GraphTarget = { readonly kind: 'flow' } | { readonly id: string; readonly kind: 'subflow' }

export interface GraphEdge {
  readonly source: string
  readonly sourceHandle: string
  readonly target: string
  readonly targetHandle: string
}

export type ChangeOperation =
  | { readonly binding: FlowDocument['bindings'][string]; readonly bindingId: string; readonly kind: 'binding.create' }
  | { readonly bindingId: string; readonly kind: 'binding.delete' }
  | { readonly before: string; readonly bindingId: string; readonly kind: 'binding.target.set'; readonly value: string }
  | { readonly before?: InputMapping; readonly kind: 'graph.edge.connect'; readonly edge: GraphEdge; readonly target: GraphTarget }
  | { readonly before?: InputMapping; readonly kind: 'graph.edge.disconnect'; readonly edge: GraphEdge; readonly target: GraphTarget }
  | {
      readonly before?: readonly InputPort[]
      readonly kind: 'graph.node.additional-inputs.set'
      readonly nodeId: string
      readonly target: GraphTarget
      readonly value?: readonly InputPort[]
    }
  | {
      readonly before: Pick<ConditionNode, 'cases' | 'defaultOutput' | 'input'>
      readonly kind: 'graph.node.condition.set'
      readonly nodeId: string
      readonly target: GraphTarget
      readonly value: Pick<ConditionNode, 'cases' | 'defaultOutput' | 'input'>
    }
  | { readonly kind: 'graph.node.create'; readonly node: GraphNode; readonly nodeId: string; readonly target: GraphTarget }
  | { readonly kind: 'graph.node.delete'; readonly nodeId: string; readonly target: GraphTarget }
  | {
      readonly before?: number | string
      readonly field: 'concurrency' | 'description' | 'icon' | 'name' | 'timeoutMs'
      readonly kind: 'graph.node.field.set'
      readonly nodeId: string
      readonly target: GraphTarget
      readonly value?: number | string
    }
  | {
      readonly before?: InputMapping
      readonly handle: string
      readonly kind: 'graph.node.input.set'
      readonly nodeId: string
      readonly target: GraphTarget
      readonly value?: InputMapping
    }
  | {
      readonly before: Pick<InlineTaskDefinition, 'inputs' | 'outputs'>
      readonly kind: 'graph.node.task.ports.set'
      readonly nodeId: string
      readonly target: GraphTarget
      readonly value: Pick<InlineTaskDefinition, 'inputs' | 'outputs'>
    }
  | {
      readonly before: string
      readonly kind: 'graph.node.task.name.set'
      readonly nodeId: string
      readonly target: GraphTarget
      readonly value: string
    }
  | {
      readonly before: readonly InputPort[]
      readonly kind: 'graph.node.values.set'
      readonly nodeId: string
      readonly target: GraphTarget
      readonly value: readonly InputPort[]
    }
  | {
      readonly before: Pick<WaitNode, 'actions' | 'notification' | 'prompt'>
      readonly kind: 'graph.node.wait.set'
      readonly nodeId: string
      readonly target: Extract<GraphTarget, { readonly kind: 'flow' }>
      readonly value: Pick<WaitNode, 'actions' | 'notification' | 'prompt'>
    }
  | {
      readonly before: Pick<Extract<TriggerNode, { readonly kind: 'webhook' }>, 'inputsDef' | 'options'>
      readonly kind: 'graph.node.webhook.set'
      readonly nodeId: string
      readonly target: Extract<GraphTarget, { readonly kind: 'flow' }>
      readonly value: Pick<Extract<TriggerNode, { readonly kind: 'webhook' }>, 'inputsDef' | 'options'>
    }
  | {
      readonly before?: JsonValue
      readonly kind: 'graph.trigger.config.set'
      readonly name: string
      readonly nodeId: string
      readonly value?: JsonValue
    }
  | {
      readonly before: readonly TriggerSchedule[]
      readonly kind: 'graph.trigger.schedule.set'
      readonly nodeId: string
      readonly value: readonly TriggerSchedule[]
    }
  | { readonly kind: 'module.create'; readonly module: CodeModule; readonly moduleId: string }
  | { readonly kind: 'module.delete'; readonly moduleId: string }
  | { readonly before: string; readonly kind: 'module.rename'; readonly moduleId: string; readonly name: string }
  | {
      readonly beforeImports: readonly string[]
      readonly beforeSource: string
      readonly imports: readonly string[]
      readonly kind: 'module.source.replace'
      readonly moduleId: string
      readonly source: string
    }
  | { readonly kind: 'subflow.create'; readonly subflow: FlowDocument['subflows'][string]; readonly subflowId: string }
  | {
      readonly before: Omit<FlowDocument['subflows'][string], 'graph'>
      readonly definition: Omit<FlowDocument['subflows'][string], 'graph'>
      readonly kind: 'subflow.definition.set'
      readonly subflowId: string
    }
  | { readonly kind: 'subflow.delete'; readonly subflowId: string }
  | { readonly kind: 'task.create'; readonly task: FlowDocument['tasks'][string]; readonly taskId: string }
  | { readonly before?: string; readonly kind: 'task.connector.connection.set'; readonly taskId: string; readonly value?: string }
  | { readonly kind: 'task.delete'; readonly taskId: string }
  | { readonly before: 'chat' | 'json'; readonly kind: 'task.llm.mode.set'; readonly taskId: string; readonly value: 'chat' | 'json' }
  | { readonly before: string; readonly kind: 'task.name.set'; readonly taskId: string; readonly value: string }

export class FlowChangeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FlowChangeError'
  }
}

function invalid(message: string): never {
  throw new FlowChangeError(message)
}

function selectedGraph(document: FlowDocument, target: GraphTarget): Graph {
  if (target.kind == 'flow') return document.graph
  const subflow = document.subflows[target.id]
  if (subflow == null) invalid('The target Subflow does not exist.')
  return subflow.graph
}

function replaceGraph(document: FlowDocument, target: GraphTarget, value: Graph): FlowDocument {
  if (target.kind == 'flow') return { ...document, graph: value }
  const subflow = document.subflows[target.id]
  if (subflow == null) invalid('The target Subflow does not exist.')
  return { ...document, subflows: { ...document.subflows, [target.id]: { ...subflow, graph: value } } }
}

function withoutNodeSources(node: GraphNode, removed: ReadonlySet<string>): GraphNode {
  if (!('inputs' in node)) return node
  const inputs = { ...node.inputs }
  for (const [handle, mapping] of Object.entries(inputs)) {
    if (mapping.kind != 'sources') continue
    const remaining = mapping.sources.filter((source) => source.kind != 'node' || !removed.has(source.nodeId))
    if (remaining.length == 0) delete inputs[handle]
    else inputs[handle] = { kind: 'sources', sources: remaining }
  }
  return { ...node, inputs }
}

export function applyFlowChanges(content: RevisionContent, operations: readonly ChangeOperation[]): RevisionContent {
  const document = { ...content.document }
  const modules = { ...content.modules }
  for (const operation of operations) {
    switch (operation.kind) {
      case 'binding.create':
        if (document.bindings[operation.bindingId] != null) invalid('A Binding with this ID already exists.')
        document.bindings = { ...document.bindings, [operation.bindingId]: operation.binding }
        break
      case 'binding.delete': {
        if (document.bindings[operation.bindingId] == null) invalid('The Binding does not exist.')
        const bindings = { ...document.bindings }
        delete bindings[operation.bindingId]
        document.bindings = bindings
        break
      }
      case 'binding.target.set': {
        const binding = document.bindings[operation.bindingId]
        if (binding == null) invalid('The Binding does not exist.')
        if (binding.target != operation.before) invalid('The Binding target changed before this operation was applied.')
        document.bindings = { ...document.bindings, [operation.bindingId]: { ...binding, target: operation.value } }
        break
      }
      case 'graph.edge.connect': {
        const graph = selectedGraph(document, operation.target)
        if (graph.nodes[operation.edge.source] == null) invalid('The source Node does not exist.')
        const node = graph.nodes[operation.edge.target]
        if (node == null || !('inputs' in node)) invalid('The target Node does not accept inputs.')
        const mapping = node.inputs[operation.edge.targetHandle]
        if (!dequal(mapping, operation.before)) invalid('The target input changed before this operation was applied.')
        const source: NodeSource = { kind: 'node', nodeId: operation.edge.source, output: operation.edge.sourceHandle }
        const sources =
          mapping?.kind == 'sources'
            ? mapping.sources.filter((candidate) => candidate.kind != 'binding' || document.bindings[candidate.bindingId]?.kind != 'variable')
            : []
        if (sources.some((candidate) => candidate.kind == 'node' && candidate.nodeId == source.nodeId && candidate.output == source.output)) {
          invalid('The Nodes are already connected.')
        }
        const updated = { ...node, inputs: { ...node.inputs, [operation.edge.targetHandle]: { kind: 'sources' as const, sources: [...sources, source] } } }
        Object.assign(document, replaceGraph(document, operation.target, { nodes: { ...graph.nodes, [operation.edge.target]: updated } }))
        break
      }
      case 'graph.edge.disconnect': {
        const graph = selectedGraph(document, operation.target)
        const node = graph.nodes[operation.edge.target]
        if (node == null || !('inputs' in node)) invalid('The target Node does not accept inputs.')
        const mapping = node.inputs[operation.edge.targetHandle]
        if (mapping?.kind != 'sources' || !dequal(mapping, operation.before)) invalid('The target input changed before this operation was applied.')
        const sources = mapping.sources.filter(
          (source) => source.kind != 'node' || source.nodeId != operation.edge.source || source.output != operation.edge.sourceHandle,
        )
        if (sources.length == mapping.sources.length) invalid('The Nodes are not connected.')
        const inputs = { ...node.inputs }
        if (sources.length == 0) delete inputs[operation.edge.targetHandle]
        else inputs[operation.edge.targetHandle] = { kind: 'sources', sources }
        Object.assign(document, replaceGraph(document, operation.target, { nodes: { ...graph.nodes, [operation.edge.target]: { ...node, inputs } } }))
        break
      }
      case 'graph.node.additional-inputs.set': {
        const graph = selectedGraph(document, operation.target)
        const node = graph.nodes[operation.nodeId]
        if (node?.kind != 'task') invalid('The Task Node does not exist.')
        if (!dequal(node.additionalInputs, operation.before)) invalid('The Task Node inputs changed before this operation was applied.')
        const { additionalInputs: _, ...rest } = node
        const updated: TaskNode = operation.value == null ? rest : { ...rest, additionalInputs: operation.value }
        Object.assign(document, replaceGraph(document, operation.target, { nodes: { ...graph.nodes, [operation.nodeId]: updated } }))
        break
      }
      case 'graph.node.condition.set': {
        const graph = selectedGraph(document, operation.target)
        const node = graph.nodes[operation.nodeId]
        if (node?.kind != 'condition') invalid('The Condition Node does not exist.')
        if (
          !dequal(node.cases, operation.before.cases) ||
          node.defaultOutput != operation.before.defaultOutput ||
          !dequal(node.input, operation.before.input)
        ) {
          invalid('The Condition Node changed before this operation was applied.')
        }
        const { defaultOutput: _, ...rest } = node
        const updated: ConditionNode = operation.value.defaultOutput == null ? { ...rest, ...operation.value } : { ...node, ...operation.value }
        Object.assign(document, replaceGraph(document, operation.target, { nodes: { ...graph.nodes, [operation.nodeId]: updated } }))
        break
      }
      case 'graph.node.create': {
        const graph = selectedGraph(document, operation.target)
        if (graph.nodes[operation.nodeId] != null) invalid('A Node with this ID already exists in the target graph.')
        if (operation.target.kind == 'subflow' && !('inputs' in operation.node)) invalid('Trigger Nodes cannot be created inside a Subflow.')
        Object.assign(document, replaceGraph(document, operation.target, { nodes: { ...graph.nodes, [operation.nodeId]: operation.node } }))
        break
      }
      case 'graph.node.delete': {
        const graph = selectedGraph(document, operation.target)
        if (graph.nodes[operation.nodeId] == null) invalid('The Node does not exist in the target graph.')
        const removed = new Set([operation.nodeId])
        const nodes = Object.fromEntries(
          Object.entries(graph.nodes).flatMap(([nodeId, node]) => (removed.has(nodeId) ? [] : [[nodeId, withoutNodeSources(node, removed)]])),
        )
        Object.assign(document, replaceGraph(document, operation.target, { nodes }))
        if (operation.target.kind == 'subflow') {
          const subflow = document.subflows[operation.target.id]!
          const outputs = subflow.outputs.map((output) => ({
            ...output,
            sources: output.sources.filter((source) => source.kind != 'node' || !removed.has(source.nodeId)),
          }))
          document.subflows = { ...document.subflows, [operation.target.id]: { ...subflow, outputs } }
        }
        break
      }
      case 'graph.node.field.set': {
        const graph = selectedGraph(document, operation.target)
        const node = graph.nodes[operation.nodeId]
        if (node == null) invalid('The Node does not exist in the target graph.')
        if (!dequal(Reflect.get(node, operation.field), operation.before)) invalid('The Node field changed before this operation was applied.')
        if (operation.field == 'concurrency' && operation.value == null) invalid('Node concurrency cannot be removed.')
        const updated = { ...node }
        if (operation.value == null) Reflect.deleteProperty(updated, operation.field)
        else Object.assign(updated, { [operation.field]: operation.value })
        Object.assign(document, replaceGraph(document, operation.target, { nodes: { ...graph.nodes, [operation.nodeId]: updated } }))
        break
      }
      case 'graph.node.input.set': {
        const graph = selectedGraph(document, operation.target)
        const node = graph.nodes[operation.nodeId]
        if (node == null || !('inputs' in node)) invalid('The Node does not accept inputs.')
        if (!dequal(node.inputs[operation.handle], operation.before)) invalid('The Node input changed before this operation was applied.')
        const inputs = { ...node.inputs }
        if (operation.value == null) delete inputs[operation.handle]
        else inputs[operation.handle] = operation.value
        Object.assign(document, replaceGraph(document, operation.target, { nodes: { ...graph.nodes, [operation.nodeId]: { ...node, inputs } } }))
        break
      }
      case 'graph.node.task.name.set': {
        const graph = selectedGraph(document, operation.target)
        const node = graph.nodes[operation.nodeId]
        if (node?.kind != 'task' || node.task == null) invalid('The inline Task Node does not exist.')
        if (node.task.name != operation.before) invalid('The inline Task name changed before this operation was applied.')
        const updated = { ...node, task: { ...node.task, name: operation.value } }
        Object.assign(document, replaceGraph(document, operation.target, { nodes: { ...graph.nodes, [operation.nodeId]: updated } }))
        break
      }
      case 'graph.node.task.ports.set': {
        const graph = selectedGraph(document, operation.target)
        const node = graph.nodes[operation.nodeId]
        if (node?.kind != 'task' || node.task == null) invalid('The inline Task Node does not exist.')
        if (!dequal({ inputs: node.task.inputs, outputs: node.task.outputs }, operation.before)) {
          invalid('The inline Task ports changed before this operation was applied.')
        }
        const updated = { ...node, task: { ...node.task, ...operation.value } }
        Object.assign(document, replaceGraph(document, operation.target, { nodes: { ...graph.nodes, [operation.nodeId]: updated } }))
        break
      }
      case 'graph.node.values.set': {
        const graph = selectedGraph(document, operation.target)
        const node = graph.nodes[operation.nodeId]
        if (node?.kind != 'value') invalid('The Value Node does not exist.')
        if (!dequal(node.values, operation.before)) invalid('The Value Node changed before this operation was applied.')
        Object.assign(
          document,
          replaceGraph(document, operation.target, { nodes: { ...graph.nodes, [operation.nodeId]: { ...node, values: operation.value } } }),
        )
        break
      }
      case 'graph.node.wait.set': {
        const graph = document.graph
        const node = graph.nodes[operation.nodeId]
        if (
          node?.kind != 'wait' ||
          !dequal(
            {
              actions: node.actions,
              ...(node.notification == null ? {} : { notification: node.notification }),
              prompt: node.prompt,
            },
            operation.before,
          )
        ) {
          invalid('The Wait Node changed before this operation was applied.')
        }
        const { notification: _, ...rest } = node
        const updated: WaitNode = operation.value.notification == null ? { ...rest, ...operation.value } : { ...node, ...operation.value }
        document.graph = { nodes: { ...graph.nodes, [operation.nodeId]: updated } }
        break
      }
      case 'graph.node.webhook.set': {
        const graph = selectedGraph(document, operation.target)
        const node = graph.nodes[operation.nodeId]
        if (node?.kind != 'webhook') invalid('The Webhook Node does not exist.')
        if (!dequal(node.inputsDef, operation.before.inputsDef) || !dequal(node.options, operation.before.options)) {
          invalid('The Webhook Node changed before this operation was applied.')
        }
        const { options: _, ...rest } = node
        const updated: TriggerNode = operation.value.options == null ? { ...rest, inputsDef: operation.value.inputsDef } : { ...node, ...operation.value }
        Object.assign(document, replaceGraph(document, operation.target, { nodes: { ...graph.nodes, [operation.nodeId]: updated } }))
        break
      }
      case 'graph.trigger.config.set': {
        const graph = document.graph
        const node = graph.nodes[operation.nodeId]
        if (node == null || (node.kind != 'integration' && node.kind != 'poll')) invalid('The configurable Trigger Node does not exist.')
        if (!dequal(node.config[operation.name], operation.before)) invalid('The Trigger configuration changed before this operation was applied.')
        const config = { ...node.config }
        if (operation.value === undefined) delete config[operation.name]
        else config[operation.name] = operation.value
        document.graph = { nodes: { ...graph.nodes, [operation.nodeId]: { ...node, config } } }
        break
      }
      case 'graph.trigger.schedule.set': {
        const graph = document.graph
        const node = graph.nodes[operation.nodeId]
        if (node == null || (node.kind != 'cron' && node.kind != 'poll')) invalid('The scheduled Trigger Node does not exist.')
        const before = node.kind == 'cron' ? node.cronTimes : node.pollTimes
        if (!dequal(before, operation.before)) invalid('The Trigger schedule changed before this operation was applied.')
        const updated: TriggerNode = node.kind == 'cron' ? { ...node, cronTimes: operation.value } : { ...node, pollTimes: operation.value }
        document.graph = { nodes: { ...graph.nodes, [operation.nodeId]: updated } }
        break
      }
      case 'module.create':
        if (modules[operation.moduleId] != null) invalid('A CodeModule with this ID already exists.')
        modules[operation.moduleId] = operation.module
        break
      case 'module.delete':
        if (modules[operation.moduleId] == null) invalid('The CodeModule does not exist.')
        delete modules[operation.moduleId]
        break
      case 'module.rename': {
        const module = modules[operation.moduleId]
        if (module == null) invalid('The CodeModule does not exist.')
        if (module.name != operation.before) invalid('The CodeModule name changed before this operation was applied.')
        modules[operation.moduleId] = { ...module, name: operation.name }
        break
      }
      case 'module.source.replace': {
        const module = modules[operation.moduleId]
        if (module == null) invalid('The CodeModule does not exist.')
        if (module.source != operation.beforeSource || !dequal(module.imports, operation.beforeImports)) {
          invalid('The CodeModule source changed before this operation was applied.')
        }
        modules[operation.moduleId] = { ...module, imports: operation.imports, source: operation.source }
        break
      }
      case 'subflow.create':
        if (document.subflows[operation.subflowId] != null) invalid('A Subflow with this ID already exists.')
        document.subflows = { ...document.subflows, [operation.subflowId]: operation.subflow }
        break
      case 'subflow.definition.set': {
        const subflow = document.subflows[operation.subflowId]
        if (subflow == null) invalid('The Subflow does not exist.')
        if (!dequal({ inputs: subflow.inputs, name: subflow.name, outputs: subflow.outputs }, operation.before)) {
          invalid('The Subflow definition changed before this operation was applied.')
        }
        document.subflows = { ...document.subflows, [operation.subflowId]: { ...operation.definition, graph: subflow.graph } }
        break
      }
      case 'subflow.delete': {
        if (document.subflows[operation.subflowId] == null) invalid('The Subflow does not exist.')
        const subflows = { ...document.subflows }
        delete subflows[operation.subflowId]
        document.subflows = subflows
        break
      }
      case 'task.create':
        if (document.tasks[operation.taskId] != null) invalid('A Task with this ID already exists.')
        document.tasks = { ...document.tasks, [operation.taskId]: operation.task }
        break
      case 'task.connector.connection.set': {
        const task = document.tasks[operation.taskId]
        if (task == null || !('executor' in task) || task.executor.kind != 'connector') invalid('The Connector Task does not exist.')
        if (task.executor.connectionId != operation.before) invalid('The Connector Task connection changed before this operation was applied.')
        const { connectionId: _, ...executor } = task.executor
        const next = operation.value == null ? executor : { ...executor, connectionId: operation.value }
        document.tasks = { ...document.tasks, [operation.taskId]: { ...task, executor: next } }
        break
      }
      case 'task.delete': {
        if (document.tasks[operation.taskId] == null) invalid('The Task does not exist.')
        const tasks = { ...document.tasks }
        delete tasks[operation.taskId]
        document.tasks = tasks
        break
      }
      case 'task.llm.mode.set': {
        const task = document.tasks[operation.taskId]
        if (task == null || !('executor' in task) || task.executor.kind != 'llm') invalid('The LLM Task does not exist.')
        if (task.executor.mode != operation.before) invalid('The LLM Task mode changed before this operation was applied.')
        document.tasks = { ...document.tasks, [operation.taskId]: { ...task, executor: { ...task.executor, mode: operation.value } } }
        break
      }
      case 'task.name.set': {
        const task = document.tasks[operation.taskId]
        if (task == null) invalid('The Task does not exist.')
        if (task.name != operation.before) invalid('The Task name changed before this operation was applied.')
        document.tasks = { ...document.tasks, [operation.taskId]: { ...task, name: operation.value } }
        break
      }
    }
  }
  return { document, modelVersion: content.modelVersion, modules }
}
