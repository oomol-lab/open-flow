import type {
  CodeModule,
  ConditionOperand,
  FlowDocument,
  Graph,
  GraphNode,
  Group,
  InlineTaskDefinition,
  InputMapping,
  InputPort,
  JsonValue,
  OutputMapping,
  Port,
  RevisionContent,
  TriggerKeySnapshot,
  TriggerNode,
  TriggerSchedule,
  WebhookOptions,
} from '@oomol-lab/open-flow/flow-change'

import { currentFlowModelVersion } from '@oomol-lab/open-flow/flow-change'
import { decodeRevisionEnvelope, repairRevisionEnvelope } from './changeSchema.ts'
export { maxJsonDepth } from './json.ts'

export { decodeFlowDocument, decodeRevisionContent } from './changeSchema.ts'

const encoder = new TextEncoder()

function canonicalText(value: JsonValue): string {
  if (value == null || typeof value == 'boolean' || typeof value == 'string' || typeof value == 'number') return JSON.stringify(value)

  if (Array.isArray(value)) return `[${value.map(canonicalText).join(',')}]`

  const object = value as Readonly<Record<string, JsonValue>>
  return `{${Object.keys(object)
    .toSorted()
    .map((key) => `${JSON.stringify(key)}:${canonicalText(object[key]!)}`)
    .join(',')}}`
}

export function canonicalJsonBytes(value: JsonValue): Uint8Array {
  return encoder.encode(canonicalText(value))
}

export async function digestBytes(bytes: Uint8Array): Promise<string> {
  const input = new Uint8Array(bytes.byteLength)
  input.set(bytes)
  const value = new Uint8Array(await crypto.subtle.digest('SHA-256', input))
  return `sha256:${[...value].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

function entries<T>(value: Readonly<Record<string, T>>): readonly (readonly [string, T])[] {
  return Object.keys(value)
    .toSorted()
    .map((key) => [key, value[key]!] as const)
}

function canonicalPort(value: InputPort | Port | Group): { readonly [key: string]: JsonValue } {
  if (!('handle' in value)) return value.collapsed == null ? { group: value.group } : { collapsed: value.collapsed, group: value.group }
  return {
    ...(value.description == null ? {} : { description: value.description }),
    handle: value.handle,
    jsonSchema: value.jsonSchema,
    nullable: value.nullable,
    ...(Object.hasOwn(value, 'value') ? { value: (value as InputPort).value! } : {}),
  }
}

export function canonicalPorts(value: readonly (InputPort | Port | Group)[]): JsonValue {
  return value.map(canonicalPort)
}

function canonicalInputMapping(value: InputMapping): JsonValue {
  switch (value.kind) {
    case 'unset':
      return { kind: 'unset' }
    case 'sources':
      return { kind: value.kind, sources: value.sources.map((source) => ({ ...source })) }
    case 'value':
      return { kind: value.kind, value: value.value }
  }
}

function canonicalInputs(value: Readonly<Record<string, InputMapping>>): JsonValue {
  return Object.fromEntries(entries(value).map(([handle, mapping]) => [handle, canonicalInputMapping(mapping)]))
}

export function canonicalOutputs(value: readonly (OutputMapping & Port)[]): JsonValue {
  return value.map((output) => ({
    ...(output.description == null ? {} : { description: output.description }),
    handle: output.handle,
    jsonSchema: output.jsonSchema,
    nullable: output.nullable,
    sources: output.sources.map((source) => ({ ...source })),
  }))
}

function canonicalOperand(operand: ConditionOperand): JsonValue {
  return operand.kind === 'source'
    ? { kind: 'source', source: { ...operand.source } }
    : {
        kind: 'value',
        ...(operand.value === undefined ? {} : { value: operand.value }),
        ...(operand.jsonSchema === undefined ? {} : { jsonSchema: operand.jsonSchema }),
      }
}

function canonicalNode(value: GraphNode): JsonValue {
  if (!('inputs' in value)) return canonicalTriggerNode(value)
  const common = {
    ...(value.description == null ? {} : { description: value.description }),
    ...(value.icon == null ? {} : { icon: value.icon }),
    inputs: canonicalInputs(value.inputs),
    ...(value.name == null ? {} : { name: value.name }),
    ...(value.maxExecutions == null ? {} : { maxExecutions: value.maxExecutions }),
    ...(value.timeoutMs == null ? {} : { timeoutMs: value.timeoutMs }),
  }
  switch (value.kind) {
    case 'condition':
      return {
        ...common,
        cases: value.cases.map((item) => ({
          ...(item.description == null ? {} : { description: item.description }),
          output: item.output,
          groups: item.groups.map((group) => ({
            expressions: group.expressions.map((expression) => ({
              left: canonicalOperand(expression.left),
              operator: expression.operator,
              ...(expression.right == null ? {} : { right: canonicalOperand(expression.right) }),
            })),
          })),
        })),
        matchMode: value.matchMode,
        kind: value.kind,
      }
    case 'subflow':
      return { ...common, kind: value.kind, subflowId: value.subflowId }
    case 'task': {
      const node: Record<string, JsonValue> =
        value.task != null
          ? Object.assign({}, common, { kind: value.kind, task: canonicalInlineTask(value.task) })
          : Object.assign({}, common, { kind: value.kind, taskId: value.taskId })
      if (value.additionalInputs != null) node.additionalInputs = canonicalPorts(value.additionalInputs)
      return node
    }
    case 'value':
      return { ...common, kind: value.kind, values: canonicalPorts(value.values) }
    case 'approval':
    case 'wait':
      return {
        ...common,
        inputDefinitions: canonicalPorts(value.inputDefinitions),
        kind: value.kind,
        prompt: value.prompt,
      }
  }
}

export function canonicalGraph(value: Graph): JsonValue {
  return {
    edges: value.edges
      .map((edge) => ({ ...edge }))
      .toSorted((left, right) => {
        const a = canonicalText(left)
        const b = canonicalText(right)
        return a < b ? -1 : a > b ? 1 : 0
      }),
    nodes: Object.fromEntries(entries(value.nodes).map(([id, node]) => [id, canonicalNode(node)])),
  }
}

function resolutionNodeIds(graph: Graph): ReadonlySet<string> {
  return new Set(Object.entries(graph.nodes).flatMap(([id, node]) => (node.kind == 'approval' || node.kind == 'wait' ? [id] : [])))
}

function canonicalLegacySource(source: JsonValue, resolutionIds: ReadonlySet<string>): JsonValue {
  const object = source != null && typeof source == 'object' && !Array.isArray(source) ? (source as Readonly<Record<string, JsonValue>>) : undefined
  return object?.kind == 'node' && typeof object.nodeId == 'string' && resolutionIds.has(object.nodeId) && object.output == 'pending'
    ? { ...object, output: 'notification' }
    : source
}

function canonicalLegacyInputs(value: Readonly<Record<string, InputMapping>>, resolutionIds: ReadonlySet<string>): JsonValue {
  const inputs = canonicalInputs(value) as Readonly<Record<string, JsonValue>>
  return Object.fromEntries(
    entries(inputs).map(([handle, mapping]) => {
      const object = mapping != null && typeof mapping == 'object' && !Array.isArray(mapping) ? (mapping as Readonly<Record<string, JsonValue>>) : undefined
      if (object?.kind != 'sources' || !Array.isArray(object.sources)) {
        return [handle, mapping]
      }
      return [handle, { ...object, sources: object.sources.map((source) => canonicalLegacySource(source, resolutionIds)) }]
    }),
  )
}

function canonicalLegacyGraph(graph: Graph): JsonValue {
  const resolutionIds = resolutionNodeIds(graph)
  return {
    edges: graph.edges
      .map((edge) => (resolutionIds.has(edge.source) && edge.sourceHandle == 'pending' ? { ...edge, sourceHandle: 'notification' } : { ...edge }))
      .toSorted((left, right) => {
        const a = canonicalText(left)
        const b = canonicalText(right)
        return a < b ? -1 : a > b ? 1 : 0
      }),
    nodes: Object.fromEntries(
      entries(graph.nodes).map(([id, node]) => {
        const value = canonicalNode(node) as Readonly<Record<string, JsonValue>>
        if (node.kind != 'approval' && node.kind != 'wait') {
          return [id, 'inputs' in node ? { ...value, inputs: canonicalLegacyInputs(node.inputs, resolutionIds) } : value]
        }
        const { inputDefinitions: _, ...legacyValue } = value
        const legacyInput = node.inputDefinitions[0]!
        return [
          id,
          {
            ...legacyValue,
            actions: node.kind == 'wait' ? ['continue'] : ['approve', 'reject'],
            input: { handle: legacyInput.handle, ...canonicalPort(legacyInput) },
            inputs: canonicalLegacyInputs(node.inputs, resolutionIds),
            kind: 'wait',
          },
        ]
      }),
    ),
  }
}

function canonicalLegacyOutputs(value: readonly (OutputMapping & Port)[], graph: Graph): JsonValue {
  const resolutionIds = resolutionNodeIds(graph)
  return value.map((output) => ({
    ...(output.description == null ? {} : { description: output.description }),
    handle: output.handle,
    jsonSchema: output.jsonSchema,
    nullable: output.nullable,
    sources: output.sources.map((source) => canonicalLegacySource(source as unknown as JsonValue, resolutionIds)),
  }))
}

export function canonicalRevisionGraph(content: RevisionContent, graph: Graph): JsonValue {
  return content.modelVersion == 2 ? canonicalLegacyGraph(graph) : canonicalGraph(graph)
}

export function canonicalRevisionOutputs(content: RevisionContent, value: readonly (OutputMapping & Port)[], graph: Graph): JsonValue {
  return content.modelVersion == 2 ? canonicalLegacyOutputs(value, graph) : canonicalOutputs(value)
}

export function canonicalTask(task: FlowDocument['tasks'][string]): JsonValue {
  return {
    executor: task.executor as unknown as JsonValue,
    inputs: canonicalPorts(task.inputs),
    name: task.name,
    outputs: canonicalPorts(task.outputs),
  }
}

function canonicalInlineTask(task: InlineTaskDefinition): JsonValue {
  return {
    ...(task.capabilities == null
      ? {}
      : {
          capabilities: task.capabilities as unknown as JsonValue,
        }),
    inputs: canonicalPorts(task.inputs),
    moduleId: task.moduleId,
    name: task.name,
    outputs: canonicalPorts(task.outputs),
  }
}

function canonicalTriggerDefinition(snapshot: TriggerKeySnapshot): JsonValue {
  return {
    configInputs: canonicalPorts(snapshot.configInputs),
    definitionVersion: snapshot.definitionVersion,
    description: snapshot.description,
    displayName: snapshot.displayName,
    ...(snapshot.type == 'integration'
      ? {
          endpoint: {
            body: {
              allowArray: snapshot.endpoint.body.allowArray,
              allowEmpty: snapshot.endpoint.body.allowEmpty,
              formats: snapshot.endpoint.body.formats,
            },
            methods: snapshot.endpoint.methods,
            successStatus: snapshot.endpoint.successStatus,
          },
        }
      : {}),
    key: snapshot.key,
    name: snapshot.name,
    outputs: canonicalPorts(snapshot.outputs),
    provider: snapshot.provider,
    type: snapshot.type,
  }
}

function canonicalWebhookOptions(value: WebhookOptions): JsonValue {
  return {
    ...(value.allowedOrigins == null ? {} : { allowedOrigins: value.allowedOrigins }),
    ...(value.responseData == null ? {} : { responseData: value.responseData }),
    ...(value.responseHeaders == null ? {} : { responseHeaders: value.responseHeaders }),
    ...(value.responseStatusCode == null ? {} : { responseStatusCode: value.responseStatusCode }),
  }
}

function canonicalTriggerSchedule(value: TriggerSchedule): JsonValue {
  switch (value.type) {
    case 'cron':
      return { expression: value.expression, timezone: value.timezone, type: value.type }
    case 'every':
      return { type: value.type, unit: value.unit, value: value.value }
  }
}

function canonicalTriggerNode(trigger: TriggerNode): JsonValue {
  const common = (kind: TriggerNode['kind']): { readonly [key: string]: JsonValue } => ({
    ...(trigger.description == null ? {} : { description: trigger.description }),
    ...(trigger.icon == null ? {} : { icon: trigger.icon }),
    kind,
    name: trigger.name,
  })
  switch (trigger.kind) {
    case 'manual':
      return common(trigger.kind)
    case 'webhook':
      return {
        ...common(trigger.kind),
        bodyFields: trigger.bodyFields.map((input) => ({ handle: input.handle, ...canonicalPort(input) })),
        method: trigger.method,
        ...(trigger.options == null ? {} : { options: canonicalWebhookOptions(trigger.options) }),
      }
    case 'cron':
      return { ...common(trigger.kind), cronTimes: trigger.cronTimes.map(canonicalTriggerSchedule) }
    case 'poll':
      return {
        ...common(trigger.kind),
        bindingId: trigger.bindingId,
        config: trigger.config,
        definition: canonicalTriggerDefinition(trigger.definition),
        pollTimes: trigger.pollTimes.map(canonicalTriggerSchedule),
      }
    case 'integration':
      return {
        ...common(trigger.kind),
        bindingId: trigger.bindingId,
        config: trigger.config,
        definition: canonicalTriggerDefinition(trigger.definition),
      }
  }
}

export function triggerRuntimeJson(trigger: TriggerNode): string {
  const { name: _name, description: _description, icon: _icon, ...runtime } = trigger
  return canonicalText(runtime as unknown as JsonValue)
}

export function canonicalDocument(document: FlowDocument): JsonValue {
  return {
    bindings: Object.fromEntries(entries(document.bindings)),
    graph: canonicalGraph(document.graph),
    subflows: Object.fromEntries(
      entries(document.subflows).map(([id, subflow]) => [
        id,
        {
          graph: canonicalGraph(subflow.graph),
          inputs: canonicalPorts(subflow.inputs),
          name: subflow.name,
          outputs: canonicalOutputs(subflow.outputs),
        },
      ]),
    ),
    tasks: Object.fromEntries(entries(document.tasks).map(([id, task]) => [id, canonicalTask(task)])),
  }
}

function canonicalRevisionDocument(content: RevisionContent): JsonValue {
  if (content.modelVersion != 2) return canonicalDocument(content.document)
  const { document } = content
  return {
    bindings: Object.fromEntries(entries(document.bindings)),
    graph: canonicalLegacyGraph(document.graph),
    subflows: Object.fromEntries(
      entries(document.subflows).map(([id, subflow]) => [
        id,
        {
          graph: canonicalLegacyGraph(subflow.graph),
          inputs: canonicalPorts(subflow.inputs),
          name: subflow.name,
          outputs: canonicalLegacyOutputs(subflow.outputs, subflow.graph),
        },
      ]),
    ),
    tasks: Object.fromEntries(entries(document.tasks).map(([id, task]) => [id, canonicalTask(task)])),
  }
}

export function canonicalModule(module: CodeModule): JsonValue {
  return { imports: module.imports.toSorted(), name: module.name, source: module.source }
}

function canonicalRevision(content: RevisionContent): JsonValue {
  return {
    document: canonicalRevisionDocument(content),
    kind: 'open-flow-flow-revision',
    modelVersion: content.modelVersion,
    modules: Object.fromEntries(entries(content.modules).map(([id, module]) => [id, canonicalModule(module)])),
    version: 1,
  }
}

export function encodeRevision(content: RevisionContent): Uint8Array {
  return canonicalJsonBytes(canonicalRevision(content))
}

export function decodeRevision(bytes: Uint8Array): RevisionContent {
  const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  return decodeRevisionEnvelope(value)
}

function revisionValue(bytes: Uint8Array): unknown {
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
}

export type RevisionRepairKind = 'repair' | 'upgrade'

export function revisionRepairKind(bytes: Uint8Array): RevisionRepairKind | undefined {
  let value: unknown
  try {
    value = revisionValue(bytes)
    decodeRevisionEnvelope(value)
    return
  } catch {
    // A failed current decode may still be recoverable from its immutable source bytes.
  }
  try {
    repairRevisionEnvelope(value)
  } catch {
    return
  }
  const source = value as { readonly modelVersion?: unknown }
  return typeof source.modelVersion == 'number' && source.modelVersion < currentFlowModelVersion ? 'upgrade' : 'repair'
}

export function repairRevision(bytes: Uint8Array): RevisionContent {
  return repairRevisionEnvelope(revisionValue(bytes))
}
