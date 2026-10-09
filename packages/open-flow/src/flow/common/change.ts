import type { JsonValue, Port, PortDefinition } from '../../types/index.ts'

import { assertOpenApiAuthBindings } from '../../openapi/common/authBindings.ts'
export { fixedInputValue, inputValue, inputValues } from './inputValue.ts'
import type { WebhookMethod } from './webhookMethod.ts'

import { dequal } from 'dequal/lite'
import { currentFlowModelVersion } from './changeSchema.ts'
import { nodeInputMappings, setConditionInput } from './condition.ts'

export { changeOperationsSchema, currentFlowModelVersion, decodeChangeOperations } from './changeSchema.ts'
export type { WebhookMethod }

export type { JsonValue, Port, PortDefinition } from '../../types/index.ts'

export type SchemaKeyword =
  | 'const'
  | 'enum'
  | 'exclusiveMaximum'
  | 'exclusiveMinimum'
  | 'maximum'
  | 'maxItems'
  | 'maxLength'
  | 'maxProperties'
  | 'minimum'
  | 'minItems'
  | 'minLength'
  | 'minProperties'
  | 'multipleOf'
  | 'pattern'
  | 'required'
  | 'type'

export type SchemaMismatch =
  | { readonly kind: 'artifact' | 'binary' | 'nullable' }
  | {
      readonly kind: 'keyword'
      readonly keyword: SchemaKeyword
      readonly path: readonly (string | number)[]
      readonly source: JsonValue | undefined
      readonly target: JsonValue | undefined
    }
  | { readonly kind: 'schema'; readonly path?: readonly (string | number)[] }

const schemaKeywords: ReadonlySet<string> = new Set<SchemaKeyword>([
  'const',
  'enum',
  'exclusiveMaximum',
  'exclusiveMinimum',
  'maximum',
  'maxItems',
  'maxLength',
  'maxProperties',
  'minimum',
  'minItems',
  'minLength',
  'minProperties',
  'multipleOf',
  'pattern',
  'required',
  'type',
])

export function isSchemaKeyword(value: string): value is SchemaKeyword {
  return schemaKeywords.has(value)
}

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

export interface InputPortDefinition extends PortDefinition {
  readonly value?: JsonValue
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
  readonly field?: string
  readonly kind: 'node'
  readonly nodeId: string
  readonly output: string
}

export interface BindingSource {
  readonly bindingId: string
  readonly kind: 'binding'
}

export type FixedInputValue = { readonly kind: 'unset' } | { readonly kind: 'value'; readonly value: JsonValue }
export type InputValues = Readonly<Record<string, FixedInputValue>>

export type InputMapping = FixedInputValue | { readonly kind: 'sources'; readonly sources: readonly (BindingSource | NodeSource)[] }

interface GraphNodeBase {
  readonly description?: string
  readonly icon?: string
  readonly inputs: Readonly<Record<string, InputMapping>>
  readonly name?: string
  readonly maxExecutions?: number
  readonly timeoutMs?: number
}

export interface ValueNode extends GraphNodeBase {
  readonly kind: 'value'
  readonly values: readonly InputPort[]
}

export type WaitAction = 'approve' | 'continue' | 'reject'

interface ResolutionNodeBase extends GraphNodeBase {
  readonly inputDefinitions: readonly InputPort[]
  readonly prompt: string
  readonly timeoutMs?: never
}

export interface WaitNode extends ResolutionNodeBase {
  readonly kind: 'wait'
}

export interface ApprovalNode extends ResolutionNodeBase {
  readonly kind: 'approval'
}

export type ResolutionNode = ApprovalNode | WaitNode

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

export type Source = BindingSource | NodeSource

export type ConditionOperand =
  | { readonly kind: 'value'; readonly value?: JsonValue; readonly jsonSchema?: JsonValue }
  | { readonly kind: 'source'; readonly source: Source }

export interface ConditionExpression {
  readonly left: ConditionOperand
  readonly operator: ConditionOperator
  readonly right?: ConditionOperand
}

export interface ConditionGroup {
  readonly expressions: readonly ConditionExpression[]
}

export interface ConditionCase {
  readonly description?: string
  readonly groups: readonly ConditionGroup[]
  readonly output: string
}

export interface ConditionNode extends GraphNodeBase {
  readonly cases: readonly ConditionCase[]
  readonly matchMode: 'first' | 'all'
  readonly kind: 'condition'
}

export type ManagedTaskExecutor =
  | import('../../decision/common/decision.ts').DecisionExecutor
  | import('../../openapi/common/openapi.ts').OpenApiExecutor
  | { readonly kind: 'connector'; readonly action: string; readonly connectionId?: string }
  | { readonly kind: 'llm'; readonly mode: 'chat' | 'json' }
  | {
      readonly kind: 'agent'
      readonly code?: boolean
      readonly model: string
      readonly prompt: string
      readonly maxRounds: number
      readonly tools: readonly AgentTool[]
      readonly notification?: {
        readonly action: string
        readonly connectionId?: string
        readonly inputDefinitions: readonly InputPort[]
        readonly messageHandle: string
        readonly inputs: Readonly<Record<string, Exclude<AgentInput, { readonly kind: 'model' }>>>
      }
    }

export type AgentInput = { readonly kind: 'value'; readonly value: JsonValue } | { readonly kind: 'input'; readonly input: string } | { readonly kind: 'model' }

export interface AgentTool {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly action: string
  readonly connectionId?: string
  readonly approval: boolean
  readonly inputs: readonly (InputPort & { readonly source: AgentInput })[]
}

export interface ConnectorAccessCapability {
  readonly actionHints?: readonly string[]
  readonly connectionHints?: readonly {
    readonly action: string
    readonly connectionId: string
    readonly alias?: string
  }[]
  readonly kind: 'connector'
}

export interface ConnectorActionCapability {
  readonly action: string
  readonly connections: readonly { readonly connectionId: string; readonly alias?: string }[]
  readonly connectionId?: string
  readonly kind: 'connector'
}

export type ConnectorPermissionCapability =
  | { readonly kind: 'connector'; readonly mode: 'shared' }
  | { readonly kind: 'connector'; readonly mode: 'independent'; readonly actions: readonly { readonly action: string; readonly connectionId?: string }[] }

export type ConnectorCapability = ConnectorAccessCapability | ConnectorActionCapability | ConnectorPermissionCapability

export function decodeConnectorCapabilities(value: unknown): readonly ConnectorCapability[] {
  if (!Array.isArray(value)) throw new TypeError('Connector capabilities must be an array.')
  if (value.length == 0) return []
  if (value.some((item) => item != null && typeof item == 'object' && !Array.isArray(item) && Object.hasOwn(item, 'mode'))) {
    if (value.length != 1) throw new TypeError('Connector capability is declared more than once.')
    const source = value[0] as Record<string, unknown>
    if (source.mode == 'shared') {
      if (source.kind != 'connector' || Object.keys(source).some((key) => !['kind', 'mode'].includes(key)))
        throw new TypeError('Invalid shared Connector permission capability.')
      return [{ kind: 'connector', mode: 'shared' }]
    }
    if (
      Object.keys(source).some((key) => !['kind', 'mode', 'actions'].includes(key)) ||
      source.kind != 'connector' ||
      source.mode != 'independent' ||
      !Array.isArray(source.actions)
    )
      throw new TypeError('Invalid Connector permission capability.')
    const actions = source.actions.map((entry: unknown) => {
      if (entry == null || typeof entry != 'object' || Array.isArray(entry)) throw new TypeError('Invalid Connector Action.')
      const action = entry as Record<string, unknown>
      if (
        Object.keys(action).some((key) => !['action', 'connectionId'].includes(key)) ||
        typeof action.action != 'string' ||
        !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_.-]+$/.test(action.action) ||
        (Object.hasOwn(action, 'connectionId') && (typeof action.connectionId != 'string' || action.connectionId.length == 0))
      )
        throw new TypeError('Invalid Connector Action permission.')
      return action.connectionId == null ? { action: action.action } : { action: action.action, connectionId: action.connectionId as string }
    })
    if (new Set(actions.map((action) => action.action)).size != actions.length) throw new TypeError('Duplicate Connector Action permission.')
    return [{ kind: 'connector', mode: 'independent', actions }]
  }
  if (value.some((item) => item != null && typeof item == 'object' && !Array.isArray(item) && !Object.hasOwn(item, 'action'))) {
    if (value.length != 1) throw new TypeError('Connector capability is declared more than once.')
    const item = value[0]
    if (item == null || typeof item != 'object' || Array.isArray(item)) throw new TypeError('Invalid Connector capability.')
    const source = item as Record<string, unknown>
    if (
      Object.keys(source).some((key) => !['kind', 'actionHints', 'connectionHints'].includes(key)) ||
      source.kind != 'connector' ||
      (Object.hasOwn(source, 'actionHints') && !Array.isArray(source.actionHints)) ||
      (Object.hasOwn(source, 'connectionHints') && !Array.isArray(source.connectionHints))
    ) {
      throw new TypeError('Invalid Connector capability.')
    }
    const actionHints = ((source.actionHints as readonly unknown[] | undefined) ?? []).map((action: unknown) => {
      if (typeof action != 'string' || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_.-]+$/.test(action)) throw new TypeError('Invalid Connector Action hint.')
      return action
    })
    if (new Set(actionHints).size != actionHints.length) throw new TypeError('Duplicate Connector Action hint.')
    const keys = new Set<string>()
    const connectionHints = ((source.connectionHints as readonly unknown[] | undefined) ?? []).map((entry: unknown) => {
      if (entry == null || typeof entry != 'object' || Array.isArray(entry)) throw new TypeError('Invalid Connector Connection hint.')
      const hint = entry as Record<string, unknown>
      if (
        Object.keys(hint).some((key) => !['action', 'connectionId', 'alias'].includes(key)) ||
        typeof hint.action != 'string' ||
        !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_.-]+$/.test(hint.action) ||
        typeof hint.connectionId != 'string' ||
        hint.connectionId.length == 0 ||
        (Object.hasOwn(hint, 'alias') && (typeof hint.alias != 'string' || hint.alias.length == 0))
      ) {
        throw new TypeError('Invalid Connector Connection hint.')
      }
      const key = `${hint.action}\0${hint.alias ?? ''}`
      if (keys.has(key)) throw new TypeError('Duplicate Connector Connection hint.')
      keys.add(key)
      return hint.alias == null
        ? { action: hint.action, connectionId: hint.connectionId }
        : { action: hint.action, connectionId: hint.connectionId, alias: hint.alias as string }
    })
    return [
      {
        kind: 'connector',
        ...(actionHints.length == 0 ? {} : { actionHints }),
        ...(connectionHints.length == 0 ? {} : { connectionHints }),
      },
    ]
  }
  const actions = new Set<string>()
  return value.map((item: unknown) => {
    if (item == null || typeof item != 'object' || Array.isArray(item)) throw new TypeError('Invalid Connector capability.')
    const source = item as Record<string, unknown>
    if (
      Object.keys(source).some((key) => !['kind', 'action', 'connections', 'connectionId'].includes(key)) ||
      source.kind != 'connector' ||
      typeof source.action != 'string' ||
      !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_.-]+$/.test(source.action) ||
      !Array.isArray(source.connections)
    ) {
      throw new TypeError('Invalid Connector capability.')
    }
    if (actions.has(source.action)) throw new TypeError('Connector Action is declared more than once.')
    actions.add(source.action)
    const ids = new Set<string>()
    const aliases = new Set<string>()
    const connections = source.connections.map((entry: unknown) => {
      if (entry == null || typeof entry != 'object' || Array.isArray(entry)) throw new TypeError('Invalid Connector Connection.')
      const connection = entry as Record<string, unknown>
      if (
        Object.keys(connection).some((key) => !['connectionId', 'alias'].includes(key)) ||
        typeof connection.connectionId != 'string' ||
        connection.connectionId.length == 0 ||
        ids.has(connection.connectionId)
      ) {
        throw new TypeError('Invalid or duplicate Connector Connection ID.')
      }
      ids.add(connection.connectionId)
      if (Object.hasOwn(connection, 'alias')) {
        if (typeof connection.alias != 'string' || connection.alias.length == 0 || aliases.has(connection.alias))
          throw new TypeError('Invalid or duplicate Connector alias.')
        aliases.add(connection.alias)
      }
      return { connectionId: connection.connectionId, ...(connection.alias == null ? {} : { alias: connection.alias as string }) }
    })
    if (Object.hasOwn(source, 'connectionId') && (typeof source.connectionId != 'string' || !ids.has(source.connectionId))) {
      throw new TypeError('The default Connector Connection must be declared.')
    }
    return { kind: 'connector', action: source.action, connections, ...(source.connectionId == null ? {} : { connectionId: source.connectionId as string }) }
  })
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

export interface TaskNode extends GraphNodeBase {
  readonly kind: 'task'
  readonly additionalInputs?: readonly InputPort[]
  readonly task: TaskDefinition
}

export interface Graph {
  readonly edges: readonly GraphEdge[]
  readonly nodes: Readonly<Record<string, GraphNode>>
}

export type TriggerSchedule =
  | { readonly expression: string; readonly timezone: string; readonly type: 'cron' }
  | { readonly type: 'every'; readonly unit: 'day' | 'hour' | 'minute' | 'month' | 'week'; readonly value: number }

interface TriggerKeySnapshotBase {
  readonly configInputs: readonly (InputPort | Group)[]
  readonly definitionVersion: number
  readonly description: string
  readonly displayName: string
  readonly key: string
  readonly name: string
  readonly outputs: readonly Port[]
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

export interface WebhookBodyField extends InputPort {}

export interface WebhookOptions {
  readonly allowedOrigins?: readonly string[]
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
  | (TriggerNodeBase & { readonly kind: 'manual' })
  | (TriggerNodeBase & { readonly kind: 'error'; readonly sourceFlowIds?: readonly string[] })
  | (TriggerNodeBase & {
      readonly bodyFields: readonly WebhookBodyField[]
      readonly kind: 'webhook'
      readonly method: WebhookMethod
      readonly options?: WebhookOptions
    })
  | (TriggerNodeBase & { readonly cronTimes: readonly TriggerSchedule[]; readonly kind: 'cron' })
  | (TriggerNodeBase & {
      readonly connectionId?: string
      readonly config: InputValues
      readonly definition: TriggerKeySnapshot & { readonly type: 'poll' }
      readonly kind: 'poll'
      readonly pollTimes: readonly TriggerSchedule[]
    })
  | (TriggerNodeBase & {
      readonly connectionId?: string
      readonly config: InputValues
      readonly definition: TriggerKeySnapshot & { readonly type: 'integration' }
      readonly kind: 'integration'
    })

export type GraphNode = ApprovalNode | ConditionNode | TaskNode | TriggerNode | ValueNode | WaitNode

export interface FlowDocument {
  readonly bindings: Readonly<Record<string, { readonly kind: 'variable'; readonly target: string }>>
  readonly graph: Graph
}

export interface CodeModule {
  readonly imports: readonly string[]
  readonly name: string
  readonly source: string
}

export interface RevisionContent {
  readonly document: FlowDocument
  readonly modelVersion: 2 | 4 | 5 | typeof currentFlowModelVersion
  readonly modules: Readonly<Record<string, CodeModule>>
}

export interface GraphEdge {
  readonly source: string
  readonly sourceHandle?: string
  readonly target: string
}

export function normalizeNodeName(value: string): string {
  return value.trim().normalize('NFC')
}

export function nextNodeName(value: string, names: Iterable<string>): string {
  const name = normalizeNodeName(value)
  const used = new Set([...names].map(normalizeNodeName))
  if (!used.has(name)) return name
  const match = /^(.*) \((\d+)\)$/.exec(name)
  const ordinalText = match?.[2]
  const ordinal = ordinalText != null && Number(ordinalText) >= 2 ? Number(ordinalText) : undefined
  const base = ordinal == null ? name : (match?.[1] ?? name)
  let number = ordinal == null ? 2 : ordinal + 1
  while (used.has(`${base} (${number})`)) number += 1
  return `${base} (${number})`
}

export function nodeNameIssue(graph: Graph, nodeId: string, value: string): 'duplicate' | 'empty' | undefined {
  const name = normalizeNodeName(value)
  if (name.length == 0) return 'empty'
  return Object.entries(graph.nodes).some(([candidateId, node]) => candidateId != nodeId && node.name != null && normalizeNodeName(node.name) == name)
    ? 'duplicate'
    : undefined
}

export type ChangeOperation =
  | { readonly kind: 'graph.node.replace'; readonly nodeId: string; readonly before: GraphNode; readonly node: GraphNode }
  | {
      readonly before?: readonly ConnectorCapability[]
      readonly kind: 'graph.node.task.capabilities.set'
      readonly nodeId: string

      readonly value?: readonly ConnectorCapability[]
    }
  | { readonly kind: 'graph.trigger.sources.set'; readonly nodeId: string; readonly before?: readonly string[]; readonly value?: readonly string[] }
  | { readonly binding: FlowDocument['bindings'][string]; readonly bindingId: string; readonly kind: 'binding.create' }
  | { readonly bindingId: string; readonly kind: 'binding.delete' }
  | { readonly before: string; readonly bindingId: string; readonly kind: 'binding.target.set'; readonly value: string }
  | { readonly kind: 'graph.edge.connect'; readonly edge: GraphEdge }
  | { readonly kind: 'graph.edge.disconnect'; readonly edge: GraphEdge }
  | {
      readonly before?: readonly InputPort[]
      readonly kind: 'graph.node.additional-inputs.set'
      readonly nodeId: string

      readonly value?: readonly InputPort[]
    }
  | {
      readonly before: Pick<ConditionNode, 'cases' | 'matchMode'>
      readonly kind: 'graph.node.condition.set'
      readonly nodeId: string

      readonly value: Pick<ConditionNode, 'cases' | 'matchMode'>
    }
  | { readonly kind: 'graph.node.create'; readonly node: GraphNode; readonly nodeId: string }
  | { readonly kind: 'graph.node.delete'; readonly nodeId: string }
  | {
      readonly before?: number | string
      readonly field: 'connectionId' | 'description' | 'icon' | 'maxExecutions' | 'name' | 'timeoutMs'
      readonly kind: 'graph.node.field.set'
      readonly nodeId: string

      readonly value?: number | string
    }
  | {
      readonly before?: InputMapping
      readonly handle: string
      readonly kind: 'graph.node.input.set'
      readonly nodeId: string

      readonly value?: InputMapping
    }
  | {
      readonly before: Pick<InlineTaskDefinition, 'inputs' | 'outputs'>
      readonly kind: 'graph.node.task.ports.set'
      readonly nodeId: string

      readonly value: Pick<InlineTaskDefinition, 'inputs' | 'outputs'>
    }
  | {
      readonly before: string
      readonly kind: 'graph.node.task.name.set'
      readonly nodeId: string

      readonly value: string
    }
  | {
      readonly before: readonly InputPort[]
      readonly kind: 'graph.node.values.set'
      readonly nodeId: string

      readonly value: readonly InputPort[]
    }
  | {
      readonly before: Pick<ResolutionNode, 'inputDefinitions' | 'prompt'>
      readonly kind: 'graph.node.resolution.set'
      readonly nodeId: string

      readonly value: Pick<ResolutionNode, 'inputDefinitions' | 'prompt'>
    }
  | {
      readonly before: Pick<Extract<TriggerNode, { readonly kind: 'webhook' }>, 'bodyFields' | 'method' | 'options'>
      readonly kind: 'graph.node.webhook.set'
      readonly nodeId: string

      readonly value: Pick<Extract<TriggerNode, { readonly kind: 'webhook' }>, 'bodyFields' | 'method' | 'options'>
    }
  | {
      readonly before?: FixedInputValue
      readonly kind: 'graph.trigger.config.set'
      readonly name: string
      readonly nodeId: string
      readonly value?: FixedInputValue
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
  | {
      readonly kind: 'graph.node.task.set'
      readonly nodeId: string

      readonly before: TaskDefinition
      readonly value: TaskDefinition
    }

export class FlowChangeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FlowChangeError'
  }
}

function invalid(message: string): never {
  throw new FlowChangeError(message)
}

export function applyFlowChanges(content: RevisionContent, operations: readonly ChangeOperation[]): RevisionContent {
  const document = { ...content.document }
  const modules = { ...content.modules }
  for (const operation of operations) {
    switch (operation.kind) {
      case 'graph.trigger.sources.set': {
        const graph = document.graph
        const node = graph.nodes[operation.nodeId]
        if (node?.kind != 'error') invalid('The Flow Error node does not exist.')
        if (!dequal(node.sourceFlowIds, operation.before)) invalid('The Flow Error node’s sources changed before this operation was applied.')
        const { sourceFlowIds: _, ...base } = node
        const updated = operation.value == null ? base : { ...base, sourceFlowIds: operation.value }
        document.graph = { ...graph, nodes: { ...graph.nodes, [operation.nodeId]: updated } }
        break
      }
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
        const graph = document.graph
        if (graph.nodes[operation.edge.source] == null) invalid('The source Node does not exist.')
        const node = graph.nodes[operation.edge.target]
        if (node == null || !('inputs' in node)) invalid('The target Node does not accept execution dependencies.')
        if (graph.edges.some((edge) => dequal(edge, operation.edge))) invalid('The Nodes are already connected.')
        Object.assign(document, { graph: { ...graph, edges: [...graph.edges, operation.edge] } })
        break
      }
      case 'graph.edge.disconnect': {
        const graph = document.graph
        const edges = graph.edges.filter((edge) => !dequal(edge, operation.edge))
        if (edges.length == graph.edges.length) invalid('The Nodes are not connected.')
        Object.assign(document, { graph: { ...graph, edges } })
        break
      }
      case 'graph.node.additional-inputs.set': {
        const graph = document.graph
        const node = graph.nodes[operation.nodeId]
        if (node?.kind != 'task') invalid('The Task Node does not exist.')
        if (!dequal(node.additionalInputs, operation.before)) invalid('The Task Node inputs changed before this operation was applied.')
        const { additionalInputs: _, ...rest } = node
        const updated: TaskNode = operation.value == null ? rest : { ...rest, additionalInputs: operation.value }
        Object.assign(document, { graph: { ...graph, nodes: { ...graph.nodes, [operation.nodeId]: updated } } })
        break
      }
      case 'graph.node.condition.set': {
        const graph = document.graph
        const node = graph.nodes[operation.nodeId]
        if (node?.kind != 'condition') invalid('The Condition Node does not exist.')
        if (!dequal(node.cases, operation.before.cases) || node.matchMode != operation.before.matchMode) {
          invalid('The Condition Node changed before this operation was applied.')
        }
        const updated: ConditionNode = { ...node, ...operation.value }
        Object.assign(document, { graph: { ...graph, nodes: { ...graph.nodes, [operation.nodeId]: updated } } })
        break
      }
      case 'graph.node.replace': {
        const graph = document.graph
        if (!dequal(graph.nodes[operation.nodeId], operation.before)) invalid('The Node changed before this operation was applied.')
        if (operation.node.kind != operation.before.kind) invalid('Replacing a Node cannot change its kind.')
        if (operation.node.kind == 'task' && 'moduleId' in operation.node.task && operation.node.task.capabilities !== undefined)
          decodeConnectorCapabilities(operation.node.task.capabilities)
        const name = normalizeNodeName(operation.node.name ?? '')
        const issue = nodeNameIssue(graph, operation.nodeId, name)
        if (issue != null) invalid(`Node name is ${issue}.`)
        const node = name == operation.node.name ? operation.node : { ...operation.node, name }
        Object.assign(document, { graph: { ...graph, nodes: { ...graph.nodes, [operation.nodeId]: node } } })
        break
      }
      case 'graph.node.create': {
        const graph = document.graph
        if (graph.nodes[operation.nodeId] != null) invalid('A Node with this ID already exists in the target graph.')
        if (operation.node.kind == 'error' && Object.values(graph.nodes).some((node) => node.kind == 'error'))
          invalid('A graph can contain only one Flow Error node.')
        if (operation.node.kind == 'manual' && Object.values(graph.nodes).some((node) => node.kind == 'manual')) {
          invalid('A graph can contain only one manual Trigger.')
        }
        if (operation.node.kind == 'task' && 'moduleId' in operation.node.task && operation.node.task.capabilities !== undefined)
          decodeConnectorCapabilities(operation.node.task.capabilities)
        if (operation.node.name == null) invalid('A Node name cannot be empty.')
        const name = normalizeNodeName(operation.node.name)
        const issue = nodeNameIssue(graph, operation.nodeId, name)
        if (issue == 'empty') invalid('A Node name cannot be empty.')
        if (issue == 'duplicate') invalid('A Node with this name already exists in the target graph.')
        const node = name == operation.node.name ? operation.node : { ...operation.node, name }
        Object.assign(document, { graph: { ...graph, nodes: { ...graph.nodes, [operation.nodeId]: node } } })
        break
      }
      case 'graph.node.delete': {
        const graph = document.graph
        if (graph.nodes[operation.nodeId] == null) invalid('The Node does not exist in the target graph.')
        const removed = new Set([operation.nodeId])
        const nodes = Object.fromEntries(Object.entries(graph.nodes).filter(([nodeId]) => !removed.has(nodeId)))
        Object.assign(document, {
          graph: {
            ...graph,
            edges: graph.edges.filter((edge) => !removed.has(edge.source) && !removed.has(edge.target)),
            nodes,
          },
        })
        break
      }
      case 'graph.node.field.set': {
        const graph = document.graph
        const node = graph.nodes[operation.nodeId]
        if (node == null) invalid('The Node does not exist in the target graph.')
        if (operation.field == 'connectionId' && node.kind != 'poll' && node.kind != 'integration') invalid('Only provider Triggers select a node Connection.')
        if (!dequal(Reflect.get(node, operation.field), operation.before)) invalid('The Node field changed before this operation was applied.')
        const updated = { ...node }
        if (operation.field == 'name') {
          if (typeof operation.value != 'string') invalid('A Node name cannot be empty.')
          const name = normalizeNodeName(operation.value as string)
          const issue = nodeNameIssue(graph, operation.nodeId, name)
          if (issue == 'empty') invalid('A Node name cannot be empty.')
          if (issue == 'duplicate') invalid('A Node with this name already exists in the target graph.')
          Object.assign(updated, { name })
        } else if (operation.value == null) Reflect.deleteProperty(updated, operation.field)
        else Object.assign(updated, { [operation.field]: operation.value })
        Object.assign(document, { graph: { ...graph, nodes: { ...graph.nodes, [operation.nodeId]: updated } } })
        break
      }
      case 'graph.node.input.set': {
        const graph = document.graph
        const node = graph.nodes[operation.nodeId]
        if (node == null || !('inputs' in node)) invalid('The Node does not accept inputs.')
        if (!dequal(nodeInputMappings(node)[operation.handle], operation.before)) invalid('The Node input changed before this operation was applied.')
        const inputs = { ...node.inputs }
        if (operation.value == null) delete inputs[operation.handle]
        else inputs[operation.handle] = operation.value
        Object.assign(document, {
          graph: {
            ...graph,
            nodes: {
              ...graph.nodes,
              [operation.nodeId]: node.kind == 'condition' ? setConditionInput(node, operation.handle, operation.value) : { ...node, inputs },
            },
          },
        })
        break
      }
      case 'graph.node.task.capabilities.set': {
        const graph = document.graph
        const node = graph.nodes[operation.nodeId]
        if (node?.kind != 'task' || !('moduleId' in node.task)) invalid('The inline Task Node does not exist.')
        if (!dequal(node.task.capabilities, operation.before)) invalid('The inline Task capabilities changed before this operation was applied.')
        const task = { ...node.task }
        if (operation.value === undefined) delete task.capabilities
        else task.capabilities = decodeConnectorCapabilities(operation.value)
        Object.assign(document, { graph: { ...graph, nodes: { ...graph.nodes, [operation.nodeId]: { ...node, task } } } })
        break
      }
      case 'graph.node.task.name.set': {
        const graph = document.graph
        const node = graph.nodes[operation.nodeId]
        if (node?.kind != 'task' || !('moduleId' in node.task)) invalid('The inline Task Node does not exist.')
        if (node.task.name != operation.before) invalid('The inline Task name changed before this operation was applied.')
        const updated = { ...node, task: { ...node.task, name: operation.value } }
        Object.assign(document, { graph: { ...graph, nodes: { ...graph.nodes, [operation.nodeId]: updated } } })
        break
      }
      case 'graph.node.task.ports.set': {
        const graph = document.graph
        const node = graph.nodes[operation.nodeId]
        if (node?.kind != 'task' || !('moduleId' in node.task)) invalid('The inline Task Node does not exist.')
        if (!dequal({ inputs: node.task.inputs, outputs: node.task.outputs }, operation.before)) {
          invalid('The inline Task ports changed before this operation was applied.')
        }
        const updated = { ...node, task: { ...node.task, inputs: operation.value.inputs, outputs: operation.value.outputs } }
        Object.assign(document, { graph: { ...graph, nodes: { ...graph.nodes, [operation.nodeId]: updated } } })
        break
      }
      case 'graph.node.values.set': {
        const graph = document.graph
        const node = graph.nodes[operation.nodeId]
        if (node?.kind != 'value') invalid('The Value Node does not exist.')
        if (!dequal(node.values, operation.before)) invalid('The Value Node changed before this operation was applied.')
        Object.assign(document, { graph: { ...graph, nodes: { ...graph.nodes, [operation.nodeId]: { ...node, values: operation.value } } } })
        break
      }
      case 'graph.node.resolution.set': {
        const graph = document.graph
        const node = graph.nodes[operation.nodeId]
        if ((node?.kind != 'wait' && node?.kind != 'approval') || !dequal({ inputDefinitions: node.inputDefinitions, prompt: node.prompt }, operation.before)) {
          invalid('The resolution node changed before this operation was applied.')
        }
        const updated: ResolutionNode = { ...node, ...operation.value }
        document.graph = { ...graph, nodes: { ...graph.nodes, [operation.nodeId]: updated } }
        break
      }
      case 'graph.node.webhook.set': {
        const graph = document.graph
        const node = graph.nodes[operation.nodeId]
        if (node?.kind != 'webhook') invalid('The Webhook Node does not exist.')
        if (
          node.method != operation.before.method ||
          !dequal(node.bodyFields, operation.before.bodyFields) ||
          !dequal(node.options, operation.before.options)
        ) {
          invalid('The Webhook Node changed before this operation was applied.')
        }
        const { options: _, ...rest } = node
        const updated: TriggerNode =
          operation.value.options == null
            ? { ...rest, bodyFields: operation.value.bodyFields, method: operation.value.method }
            : { ...node, ...operation.value }
        Object.assign(document, { graph: { ...graph, nodes: { ...graph.nodes, [operation.nodeId]: updated } } })
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
        document.graph = { ...graph, nodes: { ...graph.nodes, [operation.nodeId]: { ...node, config } } }
        break
      }
      case 'graph.trigger.schedule.set': {
        const graph = document.graph
        const node = graph.nodes[operation.nodeId]
        if (node == null || (node.kind != 'cron' && node.kind != 'poll')) invalid('The scheduled Trigger Node does not exist.')
        const before = node.kind == 'cron' ? node.cronTimes : node.pollTimes
        if (!dequal(before, operation.before)) invalid('The Trigger schedule changed before this operation was applied.')
        const updated: TriggerNode = node.kind == 'cron' ? { ...node, cronTimes: operation.value } : { ...node, pollTimes: operation.value }
        document.graph = { ...graph, nodes: { ...graph.nodes, [operation.nodeId]: updated } }
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
      case 'graph.node.task.set': {
        const graph = document.graph
        const node = graph.nodes[operation.nodeId]
        if (node?.kind != 'task') invalid('The Task Node does not exist.')
        if (!dequal(node.task, operation.before)) invalid('The Task configuration changed before this operation was applied.')
        document.graph = { ...graph, nodes: { ...graph.nodes, [operation.nodeId]: { ...node, task: operation.value } } }
        break
      }
    }
  }
  assertOpenApiAuthBindings(document)
  return { document, modelVersion: currentFlowModelVersion, modules }
}
