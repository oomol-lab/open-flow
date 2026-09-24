import type { ChangeOperation, FlowDocument, JsonValue, RevisionContent } from './change.ts'

import { z } from 'zod'
import { checkJsonDepth } from './json.ts'
import { triggerScheduleSchema } from './triggerScheduleSchema.ts'
import { webhookMethods } from './webhookMethod.ts'

export const currentFlowModelVersion = 4
const text = z.string()
const json = z.json()
const strings = z.array(text)
const port = z.object({ description: text.optional(), jsonSchema: json, nullable: z.boolean(), handle: text })
const input = port.extend({ value: json.optional() })
const group = z.object({ collapsed: z.boolean().optional(), group: text })
const nodeSource = z.object({ kind: z.literal('node'), nodeId: text, output: text, field: text.optional() })
const flowSource = z.object({ kind: z.literal('flow'), input: text })
const source = z.union([nodeSource, flowSource, z.object({ kind: z.literal('binding'), bindingId: text })])
const fixedInput = z.union([z.object({ kind: z.literal('unset') }), z.object({ kind: z.literal('value'), value: json })])
const mapping = z.union([fixedInput, z.object({ kind: z.literal('sources'), sources: z.array(source) })])
const inputs = z.record(text, mapping)
const ports = { inputs: z.array(z.union([input, group])), outputs: z.array(z.union([port, group])) }
const legacyCapability = z.strictObject({
  kind: z.literal('connector'),
  action: text,
  connectionId: text.optional(),
  connections: z.array(z.strictObject({ connectionId: text, alias: text.optional() })),
})
const capability = z.union([
  legacyCapability,
  z.strictObject({ kind: z.literal('connector'), mode: z.literal('shared') }),
  z.strictObject({
    kind: z.literal('connector'),
    mode: z.literal('independent'),
    actions: z.array(z.strictObject({ action: text, connectionId: text.optional() })),
  }),
  z.strictObject({
    kind: z.literal('connector'),
    actionHints: z.array(text).optional(),
    connectionHints: z.array(z.strictObject({ action: text, connectionId: text, alias: text.optional() })).optional(),
  }),
])
const inline = z.object({ ...ports, name: text, moduleId: text, capabilities: z.array(capability).optional() })
const agentValue = z.union([z.object({ kind: z.literal('value'), value: json }), z.object({ kind: z.literal('input'), input: text })])
const agentInput = z.union([agentValue, z.object({ kind: z.literal('model') })])
const managed = z.object({
  ...ports,
  name: text,
  executor: z.union([
    z.object({ kind: z.literal('connector'), action: text, connectionId: text.optional() }),
    z.object({ kind: z.literal('llm'), mode: z.enum(['chat', 'json']) }),
    z.object({
      kind: z.literal('agent'),
      code: z.boolean().optional(),
      model: text,
      prompt: agentValue,
      system: text,
      maxRounds: z.number(),
      tools: z.array(
        z.object({
          id: text,
          name: text,
          description: text,
          action: text,
          connectionId: text.optional(),
          approval: z.boolean(),
          inputs: z.array(input.extend({ source: agentInput })),
        }),
      ),
      notification: z.object({ taskId: text, messageHandle: text, inputs: z.record(text, agentValue) }).optional(),
    }),
  ]),
})
const operand = z.union([
  z.object({ kind: z.literal('value'), value: json.optional(), jsonSchema: json.optional() }),
  z.object({ kind: z.literal('source'), source }),
])
const condition = {
  matchMode: z.enum(['first', 'all']),
  cases: z.array(
    z.object({
      description: text.optional(),
      output: text,
      groups: z.array(
        z.object({
          expressions: z.array(
            z.object({
              left: operand,
              operator: z.enum([
                '!=',
                '<',
                '<=',
                '==',
                '>',
                '>=',
                'contains',
                'endsWith',
                'hasKey',
                'hasValue',
                'isEmpty',
                'isFalse',
                'isNotEmpty',
                'isNotNull',
                'isNull',
                'isTrue',
                'notContains',
                'notHasKey',
                'notHasValue',
                'startsWith',
              ]),
              right: operand.optional(),
            }),
          ),
        }),
      ),
    }),
  ),
}
const wait = {
  inputDefinitions: z.array(input),
  prompt: text,
}
const webhookOptions = z.object({
  allowedMethods: z.never().optional(),
  allowedOrigins: strings.optional(),
  noResponseBody: z.never().optional(),
  responseData: text.optional(),
  responseHeaders: z.record(text, text).optional(),
  responseStatusCode: z.number().int().min(200).max(599).optional(),
})
const webhook = {
  bodyFields: z.array(input),
  method: z.enum(webhookMethods),
  options: webhookOptions.optional(),
}
const definition = {
  configInputs: ports.inputs,
  definitionVersion: z.literal(2),
  description: text,
  displayName: text,
  key: text,
  name: text,
  outputs: z
    .array(port)
    .refine((definitions) => new Set(definitions.map((output) => output.handle)).size === definitions.length, 'Duplicate Trigger output handle.'),
  provider: text,
}
const endpoint = z.object({
  body: z.object({ allowArray: z.boolean(), allowEmpty: z.boolean(), formats: z.array(z.enum(['form', 'json', 'multipart', 'text'])) }),
  methods: z.array(z.enum(['DELETE', 'GET', 'HEAD', 'PATCH', 'POST', 'PUT'])),
  successStatus: z.number(),
})
const trigger = { name: text, description: text.optional(), icon: text.optional() }
const base = {
  maxExecutions: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
  inputs,
  name: text.optional(),
  description: text.optional(),
  icon: text.optional(),
  timeoutMs: z.number().optional(),
}
const node = z.union([
  z.object({ ...base, inputs: z.record(text, z.never()), kind: z.literal('condition'), ...condition }),
  z.object({
    ...base,
    inputs: z
      .unknown()
      .transform(() => ({}))
      .default({}),
    kind: z.literal('value'),
    values: z.array(input),
  }),
  z.object({ ...base, kind: z.literal('subflow'), subflowId: text }),
  z.object({ ...base, kind: z.literal('task'), task: inline, additionalInputs: z.array(input).optional() }),
  z.object({ ...base, kind: z.literal('task'), taskId: text, additionalInputs: z.array(input).optional() }),
  z.strictObject({ ...base, kind: z.literal('approval'), ...wait }).omit({ timeoutMs: true }),
  z.strictObject({ ...base, kind: z.literal('wait'), ...wait }).omit({ timeoutMs: true }),
  z.object({ ...trigger, kind: z.literal('manual') }),
  z.object({ ...trigger, kind: z.literal('webhook'), ...webhook }),
  z.object({ ...trigger, kind: z.literal('cron'), cronTimes: triggerScheduleSchema }),
  z.object({
    ...trigger,
    kind: z.literal('poll'),
    connectionId: text.min(1).optional(),
    config: z.record(text, fixedInput),
    definition: z.object({ ...definition, type: z.literal('poll') }),
    pollTimes: triggerScheduleSchema,
  }),
  z.object({
    ...trigger,
    kind: z.literal('integration'),
    connectionId: text.min(1).optional(),
    config: z.record(text, fixedInput),
    definition: z.object({ ...definition, type: z.literal('integration'), endpoint }),
  }),
])
const target = z.union([z.object({ kind: z.literal('flow') }), z.object({ kind: z.literal('subflow'), id: text })])
const edge = z.object({ source: text, target: text, sourceHandle: text.optional() })
const at = { nodeId: text, target }
const subflow = z.object({ name: text, inputs: z.array(input), outputs: z.array(port.extend({ sources: z.array(z.union([nodeSource, flowSource])) })) })
const graph = z.object({ nodes: z.record(text, node), edges: z.array(edge).default([]) })
const binding = z.object({ kind: z.literal('variable'), target: text })
const module = z.object({ name: text, imports: strings, source: text })
const document = z.object({
  bindings: z.record(text, binding),
  graph,
  subflows: z.record(text, subflow.extend({ graph })),
  tasks: z.record(text, managed),
})
const revision = z.object({ modelVersion: z.union([z.literal(2), z.literal(currentFlowModelVersion)]), document, modules: z.record(text, module) })
const envelope = revision.extend({ kind: z.literal('open-flow-flow-revision'), version: z.literal(1) })

function record(value: unknown): Record<string, unknown> {
  return value != null && typeof value == 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function upgradeLegacySources(value: unknown, resolutionIds: ReadonlySet<string>): unknown {
  if (!Array.isArray(value)) return value
  return value.map((sourceCandidate) => {
    const candidate = record(sourceCandidate)
    return candidate.kind == 'node' && typeof candidate.nodeId == 'string' && resolutionIds.has(candidate.nodeId) && candidate.output == 'notification'
      ? { ...candidate, output: 'pending' }
      : sourceCandidate
  })
}

function upgradeLegacyInputs(value: unknown, resolutionIds: ReadonlySet<string>): unknown {
  return Object.fromEntries(
    Object.entries(record(value)).map(([handle, inputCandidate]) => {
      const inputMapping = record(inputCandidate)
      return [handle, inputMapping.kind == 'sources' ? { ...inputMapping, sources: upgradeLegacySources(inputMapping.sources, resolutionIds) } : inputCandidate]
    }),
  )
}

function upgradeLegacyGraph(value: unknown): { readonly graph: unknown; readonly resolutionIds: ReadonlySet<string> } {
  const candidate = record(value)
  const resolutionIds = new Set<string>()
  const nodes = Object.fromEntries(
    Object.entries(record(candidate.nodes)).map(([id, nodeCandidate]) => {
      const graphNode = record(nodeCandidate)
      if (graphNode.kind == 'approval') throw new TypeError('Legacy Flow models do not support Approval nodes.')
      if (graphNode.kind != 'wait') return [id, nodeCandidate]
      const actions = graphNode.actions
      let kind: 'approval' | 'wait'
      if (Array.isArray(actions) && actions.length == 1 && actions[0] == 'continue') kind = 'wait'
      else if (Array.isArray(actions) && actions.length == 2 && actions[0] == 'approve' && actions[1] == 'reject') kind = 'approval'
      else throw new TypeError('Legacy Wait actions are invalid.')
      resolutionIds.add(id)
      const { actions: _, input: legacyInput, ...upgraded } = graphNode
      return [id, { ...upgraded, inputDefinitions: [legacyInput], kind }]
    }),
  )
  for (const [id, nodeCandidate] of Object.entries(nodes)) {
    const graphNode = record(nodeCandidate)
    if (graphNode.inputs != null) nodes[id] = { ...graphNode, inputs: upgradeLegacyInputs(graphNode.inputs, resolutionIds) }
  }
  const edges = Array.isArray(candidate.edges)
    ? candidate.edges.map((edgeCandidate) => {
        const graphEdge = record(edgeCandidate)
        return typeof graphEdge.source == 'string' && resolutionIds.has(graphEdge.source) && graphEdge.sourceHandle == 'notification'
          ? { ...graphEdge, sourceHandle: 'pending' }
          : edgeCandidate
      })
    : candidate.edges
  return { graph: { ...candidate, nodes, edges }, resolutionIds }
}

function upgradeLegacyDocument(value: unknown): unknown {
  const candidate = record(value)
  const root = upgradeLegacyGraph(candidate.graph)
  const subflows = Object.fromEntries(
    Object.entries(record(candidate.subflows)).map(([id, subflowCandidate]) => {
      const legacySubflow = record(subflowCandidate)
      const upgraded = upgradeLegacyGraph(legacySubflow.graph)
      const outputs = Array.isArray(legacySubflow.outputs)
        ? legacySubflow.outputs.map((outputCandidate) => {
            const output = record(outputCandidate)
            return { ...output, sources: upgradeLegacySources(output.sources, upgraded.resolutionIds) }
          })
        : legacySubflow.outputs
      return [id, { ...legacySubflow, graph: upgraded.graph, outputs }]
    }),
  )
  return { ...candidate, graph: root.graph, subflows }
}

function repairedEntries<Value>(value: unknown, schema: z.ZodType<Value>, repair?: (value: unknown) => unknown): Record<string, Value> {
  return Object.fromEntries(
    Object.entries(record(value)).flatMap(([key, candidate]) => {
      const result = schema.safeParse(repair?.(candidate) ?? candidate)
      return result.success ? [[key, result.data] as const] : []
    }),
  )
}

function repairTriggerNode(value: unknown): unknown {
  const candidate = record(value)
  if (candidate.kind == 'webhook' && candidate.bodyFields == null && candidate.inputsDef != null)
    return { ...candidate, bodyFields: candidate.inputsDef, inputsDef: undefined }
  if ((candidate.kind == 'poll' || candidate.kind == 'integration') && candidate.definition != null) {
    const legacyDefinition = record(candidate.definition)
    if (legacyDefinition.outputs == null && legacyDefinition.payloadSchema != null) {
      return {
        ...candidate,
        definition: {
          ...legacyDefinition,
          definitionVersion: 2,
          outputs: [{ handle: 'payload', jsonSchema: legacyDefinition.payloadSchema, nullable: false }],
          payloadSchema: undefined,
        },
      }
    }
  }
  return candidate
}

function repairGraph(value: unknown, bindings: Record<string, unknown>): z.infer<typeof graph> {
  const candidate = record(value)
  const nodes = repairedEntries(candidate.nodes, node, (entry) => {
    const repaired = record(repairTriggerNode(entry))
    if ((repaired.kind == 'poll' || repaired.kind == 'integration') && repaired.connectionId == null && typeof repaired.bindingId == 'string') {
      const connection = record(bindings[repaired.bindingId])
      if (connection.kind == 'connection' && typeof connection.target == 'string' && connection.target.length > 0)
        return { ...repaired, connectionId: connection.target }
    }
    return repaired
  })
  const webhookIds = new Set(Object.entries(nodes).flatMap(([id, graphNode]) => (graphNode.kind == 'webhook' ? [id] : [])))
  for (const graphNode of Object.values(nodes)) {
    if (!('inputs' in graphNode)) continue
    for (const inputMapping of Object.values(graphNode.inputs)) {
      if (inputMapping.kind != 'sources') continue
      for (const inputSource of inputMapping.sources) {
        if (inputSource.kind == 'node' && inputSource.output == 'payload' && webhookIds.has(inputSource.nodeId)) inputSource.output = 'body'
      }
    }
  }
  return {
    nodes,
    edges: Array.isArray(candidate.edges) ? candidate.edges.flatMap((edgeCandidate) => edge.safeParse(edgeCandidate).data ?? []) : [],
  }
}

/** Best-effort recovery for a parseable Revision envelope. Invalid collection entries are discarded. */
export function repairRevisionEnvelope(value: unknown): RevisionContent {
  checkJsonDepth(value)
  const envelopeSource = record(value)
  if (envelopeSource.kind != 'open-flow-flow-revision' || envelopeSource.version != 1) throw new TypeError('The value is not an Open Flow Revision envelope.')
  if (typeof envelopeSource.modelVersion == 'number' && envelopeSource.modelVersion > currentFlowModelVersion)
    throw new TypeError('The Flow model is newer than this package.')
  const sourceDocument = record(
    envelopeSource.modelVersion == 1 || envelopeSource.modelVersion == 2 ? upgradeLegacyDocument(envelopeSource.document) : envelopeSource.document,
  )
  const bindings = record(sourceDocument.bindings)
  const sourceGraph = repairGraph(sourceDocument.graph, bindings)
  const subflows = Object.fromEntries(
    Object.entries(record(sourceDocument.subflows)).flatMap(([id, subflowCandidate]) => {
      const legacySubflow = record(subflowCandidate)
      const result = subflow.extend({ graph }).safeParse({ ...legacySubflow, graph: repairGraph(legacySubflow.graph, bindings) })
      return result.success ? [[id, result.data] as const] : []
    }),
  )
  return decodeRevisionContent({
    modelVersion: currentFlowModelVersion,
    document: {
      bindings: repairedEntries(sourceDocument.bindings, binding),
      graph: sourceGraph,
      subflows,
      tasks: repairedEntries(sourceDocument.tasks, managed),
    },
    modules: repairedEntries(envelopeSource.modules, module),
  })
}

export function decodeFlowDocument(value: unknown): FlowDocument {
  checkJsonDepth(value)
  return document.parse(value) as FlowDocument
}

export function decodeRevisionContent(value: unknown): RevisionContent {
  checkJsonDepth(value)
  return revision.parse(value) as RevisionContent
}

export function decodeRevisionEnvelope(value: unknown): RevisionContent {
  checkJsonDepth(value)
  const revisionSource = record(value)
  const candidate = revisionSource.modelVersion == 2 ? { ...revisionSource, document: upgradeLegacyDocument(revisionSource.document) } : value
  const content = envelope.parse(candidate) as RevisionContent
  return { modelVersion: content.modelVersion, document: content.document, modules: content.modules }
}

const shapes = {
  'binding.create': { bindingId: text, binding },
  'binding.delete': { bindingId: text },
  'binding.target.set': { bindingId: text, before: text, value: text },
  'graph.edge.connect': { target, edge },
  'graph.edge.disconnect': { target, edge },
  'graph.node.create': { ...at, node },
  'graph.node.delete': at,
  'graph.node.field.set': z.union([
    z.object({
      ...at,
      kind: z.literal('graph.node.field.set'),
      field: z.literal('connectionId'),
      before: text.min(1).optional(),
      value: text.min(1).optional(),
    }),
    z.object({
      ...at,
      kind: z.literal('graph.node.field.set'),
      field: z.enum(['description', 'icon', 'name']),
      before: text.optional(),
      value: text.optional(),
    }),
    z.object({
      ...at,
      kind: z.literal('graph.node.field.set'),
      field: z.literal('maxExecutions'),
      before: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
      value: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
    }),
    z.object({
      ...at,
      kind: z.literal('graph.node.field.set'),
      field: z.literal('timeoutMs'),
      before: z.number().optional(),
      value: z.number().optional(),
    }),
  ]),
  'graph.node.input.set': { ...at, handle: text, before: mapping.optional(), value: mapping.optional() },
  'graph.node.additional-inputs.set': { ...at, before: z.array(input).optional(), value: z.array(input).optional() },
  'graph.node.condition.set': { ...at, before: z.object(condition), value: z.object(condition) },
  'graph.node.values.set': { ...at, before: z.array(input), value: z.array(input) },
  'graph.node.resolution.set': { ...at, target: z.object({ kind: z.literal('flow') }), before: z.object(wait), value: z.object(wait) },
  'graph.node.webhook.set': {
    ...at,
    target: z.object({ kind: z.literal('flow') }),
    before: z.object(webhook),
    value: z.object(webhook),
  },
  'graph.node.task.ports.set': { ...at, before: z.object(ports), value: z.object(ports) },
  'graph.node.task.name.set': { ...at, before: text, value: text },
  'graph.node.task.capabilities.set': { ...at, before: z.array(capability).optional(), value: z.array(capability).optional() },
  'graph.trigger.config.set': { nodeId: text, name: text, before: fixedInput.optional(), value: fixedInput.optional() },
  'graph.trigger.schedule.set': { nodeId: text, before: triggerScheduleSchema, value: triggerScheduleSchema },
  'module.create': { moduleId: text, module },
  'module.delete': { moduleId: text },
  'module.rename': { moduleId: text, before: text, name: text },
  'module.source.replace': { moduleId: text, beforeImports: strings, beforeSource: text, imports: strings, source: text },
  'subflow.create': { subflowId: text, subflow: subflow.extend({ graph }) },
  'subflow.definition.set': { subflowId: text, before: subflow, definition: subflow },
  'subflow.delete': { subflowId: text },
  'task.create': { taskId: text, task: managed },
  'task.delete': { taskId: text },
  'task.connector.connection.set': { taskId: text, before: text.optional(), value: text.optional() },
  'task.agent.set': { taskId: text, before: managed, value: managed },
  'task.llm.mode.set': { taskId: text, before: z.enum(['chat', 'json']), value: z.enum(['chat', 'json']) },
  'task.name.set': { taskId: text, before: text, value: text },
} satisfies Record<ChangeOperation['kind'], z.ZodRawShape | z.ZodType>
const variants = new Map(
  Object.entries(shapes).map(([kind, shape]) => [kind, shape instanceof z.ZodType ? shape : z.object({ kind: z.literal(kind), ...shape })]),
)
const operations = z.array(z.union([...variants.values()])).min(1)

export function parseOperation<Value>(candidate: unknown, index: number, parse: (value: unknown) => Value): Value {
  try {
    return parse(candidate)
  } catch (error) {
    if (!(error instanceof z.ZodError)) throw error
    throw new TypeError(`operations[${index}]: ${error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`, { cause: error })
  }
}

export function decodeChangeOperation(candidate: unknown, index: number): ChangeOperation {
  const { kind } = parseOperation(candidate, index, z.object({ kind: text }).parse)
  const schema = variants.get(kind)
  if (schema == null) throw new TypeError(`operations[${index}]: Unknown operation ${JSON.stringify(kind)}.`)
  return parseOperation<unknown>(candidate, index, schema.parse) as ChangeOperation
}

export function decodeChangeOperations(value: unknown): readonly ChangeOperation[] {
  checkJsonDepth(value)
  return z.array(z.unknown()).min(1).parse(value).map(decodeChangeOperation)
}

export function changeOperationsSchema(kind?: string): JsonValue {
  const schema = kind == null ? operations : variants.get(kind)
  if (schema == null) throw new TypeError(`Unknown operation ${JSON.stringify(kind)}.`)
  return z.toJSONSchema(schema, { io: 'input' }) as JsonValue
}
