import type {
  CodeModule,
  FlowDocument,
  Graph,
  GraphEdge,
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

import { nextNodeName } from '@oomol-lab/open-flow/flow-change'
import { z } from 'zod'
import { decodeRevisionContent, decodeRevisionEnvelope } from './changeSchema.ts'
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

function canonicalNode(value: GraphNode): JsonValue {
  if (!('inputs' in value)) return canonicalTriggerNode(value)
  const common = {
    ...(value.description == null ? {} : { description: value.description }),
    ...(value.icon == null ? {} : { icon: value.icon }),
    inputs: canonicalInputs(value.inputs),
    ...(value.name == null ? {} : { name: value.name }),
    ...(value.timeoutMs == null ? {} : { timeoutMs: value.timeoutMs }),
  }
  switch (value.kind) {
    case 'condition':
      return {
        ...common,
        cases: value.cases.map((condition) => ({
          expressions: condition.expressions.map((expression) => ({
            input: expression.input,
            operator: expression.operator,
            ...(Object.hasOwn(expression, 'value') ? { value: expression.value! } : {}),
          })),
          output: condition.output,
          relation: condition.relation,
        })),
        ...(value.defaultOutput == null ? {} : { defaultOutput: value.defaultOutput }),
        input: { handle: value.input.handle, ...canonicalPort(value.input) },
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
    case 'wait':
      return {
        ...common,
        actions: value.actions,
        input: { handle: value.input.handle, ...canonicalPort(value.input) },
        kind: value.kind,
        ...(value.notification == null
          ? {}
          : {
              notification: {
                inputs: canonicalInputs(value.notification.inputs),
                messageHandle: value.notification.messageHandle,
                taskId: value.notification.taskId,
              },
            }),
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
    configSchema: snapshot.configSchema,
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
    payloadSchema: snapshot.payloadSchema,
    provider: snapshot.provider,
    type: snapshot.type,
  }
}

function canonicalWebhookOptions(value: WebhookOptions): JsonValue {
  return {
    ...(value.allowedMethods == null ? {} : { allowedMethods: value.allowedMethods }),
    ...(value.allowedOrigins == null ? {} : { allowedOrigins: value.allowedOrigins }),
    ...(value.noResponseBody == null ? {} : { noResponseBody: value.noResponseBody }),
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
        inputsDef: trigger.inputsDef.map((input) => ({ handle: input.handle, ...canonicalPort(input) })),
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

export function canonicalModule(module: CodeModule): JsonValue {
  return { imports: module.imports.toSorted(), name: module.name, source: module.source }
}

function canonicalRevision(content: RevisionContent): JsonValue {
  return {
    document: canonicalDocument(content.document),
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

const object = z.record(z.string(), z.unknown())
const port = z.object({ jsonSchema: z.unknown(), nullable: z.boolean(), value: z.unknown().optional(), description: z.string().optional() }).strict()
const ports = z.record(z.string(), port)
const mapping = z.union([
  z.object({ kind: z.literal('value'), value: z.unknown() }).strict(),
  z.object({ kind: z.literal('sources'), sources: z.array(z.object({ kind: z.literal('node'), nodeId: z.string(), output: z.string() }).strict()) }).strict(),
])
const metadata = { name: z.string().optional(), description: z.string().optional(), icon: z.string().optional() }
const node = z.union([
  z.object({ ...metadata, kind: z.literal('cron'), cronTimes: z.array(z.unknown()) }).strict(),
  z.object({ ...metadata, kind: z.literal('manual') }).strict(),
  z
    .object({
      ...metadata,
      kind: z.literal('task'),
      concurrency: z.literal(1).optional(),
      inputs: z.record(z.string(), mapping),
      task: z.object({ name: z.string(), moduleId: z.string(), inputs: ports, outputs: z.record(z.string(), port.omit({ value: true })) }).strict(),
    })
    .strict(),
])
const flow = z.object({ name: z.string(), graph: z.object({ nodes: z.record(z.string(), node) }).strict() }).strict()
const legacyProject = z
  .object({
    kind: z.literal('open-flow-project-revision'),
    version: z.literal(1),
    modelVersion: z.literal(1),
    modules: z.record(z.string(), z.object({ name: z.string(), source: z.string(), imports: z.array(z.string()) }).strict()),
    document: z.object({ bindings: object, flows: object, subflows: object, tasks: object }).strict(),
  })
  .strict()

function convertPorts(definitions: z.infer<typeof ports>) {
  return Object.entries(definitions).map(([handle, definition]) => Object.assign({ handle }, definition))
}

export function legacyProjectFlowIds(value: unknown): readonly string[] {
  return Object.keys(legacyProject.parse(value).document.flows).toSorted()
}

export function convertProjectFlow(value: unknown, flowId: string): { name: string; revision: RevisionContent; adjustments: readonly string[] } {
  const source = legacyProject.parse(value)
  if ([source.document.bindings, source.document.subflows, source.document.tasks].some((definitions) => Object.keys(definitions).length != 0)) {
    throw new Error('Project bindings, managed tasks and subflows require an explicit semantic conversion.')
  }
  const selected = flow.parse(source.document.flows[flowId])
  const adjustments: string[] = []
  const names = new Set<string>()
  const nodes = Object.fromEntries(
    Object.entries(selected.graph.nodes).map(([id, entry]) => {
      const originalName = entry.name ?? (entry.kind == 'task' ? entry.task.name : id)
      const name = nextNodeName(originalName, names)
      names.add(name)
      if (name != originalName) adjustments.push(`Renamed node ${id} to ${name}.`)
      if (entry.kind != 'task') return [id, { ...entry, name }]
      const { concurrency: _, ...taskNode } = entry
      return [
        id,
        {
          ...taskNode,
          name,
          task: { ...entry.task, inputs: convertPorts(entry.task.inputs), outputs: convertPorts(entry.task.outputs) },
        },
      ]
    }),
  )
  const revision = decodeRevisionContent({
    modelVersion: 1,
    modules: source.modules,
    document: { bindings: {}, subflows: {}, tasks: {}, graph: { nodes, edges: [] } },
  })
  const edges: GraphEdge[] = []
  const successors = new Set<string>()
  const triggers = Object.values(revision.document.graph.nodes).filter((entry) => entry.kind != 'task')
  let manualId: string | undefined
  if (Object.keys(nodes).length > 0 && triggers.length == 0) {
    manualId = 'migration-start'
    while (Object.hasOwn(nodes, manualId)) manualId += '-start'
    adjustments.push(`Added manual entry ${manualId}.`)
  } else if (triggers.length > 1) throw new Error('Multiple legacy triggers require an explicit execution-order decision.')
  for (const [id, entry] of Object.entries(revision.document.graph.nodes)) {
    if (entry.kind != 'task') continue
    const dependencies = new Set<string>()
    for (const input of Object.values(entry.inputs)) {
      if (input.kind == 'sources') {
        for (const dependency of input.sources) {
          if (dependency.kind != 'node') throw new Error('Only node input sources can be converted automatically.')
          dependencies.add(dependency.nodeId)
        }
      }
    }
    if (dependencies.size == 0 && manualId != null) dependencies.add(manualId)
    if (dependencies.size != 1) throw new Error(`Task ${id} does not have exactly one execution predecessor.`)
    const predecessor = [...dependencies][0]!
    if (successors.has(predecessor)) throw new Error('Parallel legacy branches require an explicit execution-order decision.')
    successors.add(predecessor)
    edges.push({ source: predecessor, target: id })
  }
  const convertedNodes = { ...revision.document.graph.nodes }
  if (manualId != null) convertedNodes[manualId] = { kind: 'manual', name: nextNodeName('Start', names) }
  return { name: selected.name, adjustments, revision: { ...revision, document: { ...revision.document, graph: { nodes: convertedNodes, edges } } } }
}
