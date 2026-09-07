import type { ChangeOperation, JsonValue } from './change.ts'

import { z } from 'zod'

const text = z.string()
const json = z.json()
const strings = z.array(text)
const port = z.strictObject({ description: text.optional(), jsonSchema: json, nullable: z.boolean(), handle: text })
const input = port.extend({ value: json.optional() })
const group = z.strictObject({ collapsed: z.boolean().optional(), group: text })
const nodeSource = z.strictObject({ kind: z.literal('node'), nodeId: text, output: text })
const flowSource = z.strictObject({ kind: z.literal('flow'), input: text })
const source = z.union([nodeSource, flowSource, z.strictObject({ kind: z.literal('binding'), bindingId: text })])
const mapping = z.union([z.strictObject({ kind: z.literal('value'), value: json }), z.strictObject({ kind: z.literal('sources'), sources: z.array(source) })])
const inputs = z.record(text, mapping)
const ports = { inputs: z.array(z.union([input, group])), outputs: z.array(z.union([port, group])) }
const capability = z.strictObject({
  kind: z.literal('connector'),
  action: text,
  connectionId: text.optional(),
  connections: z.array(z.strictObject({ connectionId: text, alias: text.optional() })),
})
const inline = z.strictObject({ ...ports, name: text, moduleId: text, capabilities: z.array(capability).optional() })
const managed = z.strictObject({
  ...ports,
  name: text,
  executor: z.union([
    z.strictObject({ kind: z.literal('connector'), action: text, connectionId: text.optional() }),
    z.strictObject({ kind: z.literal('llm'), mode: z.enum(['chat', 'json']) }),
  ]),
})
const condition = {
  input,
  cases: z.array(
    z.strictObject({
      output: text,
      relation: z.enum(['all', 'any']),
      expressions: z.array(
        z.strictObject({
          input: text,
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
          value: json.optional(),
        }),
      ),
    }),
  ),
  defaultOutput: text.optional(),
}
const wait = {
  actions: z.union([z.tuple([z.literal('continue')]), z.tuple([z.literal('approve'), z.literal('reject')])]),
  prompt: text,
  notification: z.strictObject({ inputs, messageHandle: text, taskId: text }).optional(),
}
const webhook = {
  inputsDef: z.array(input),
  options: z
    .strictObject({
      allowedMethods: strings.optional(),
      allowedOrigins: strings.optional(),
      noResponseBody: z.boolean().optional(),
      responseData: text.optional(),
      responseHeaders: z.record(text, text).optional(),
      responseStatusCode: z.number().optional(),
    })
    .optional(),
}
const schedule = z.array(
  z.union([
    z.strictObject({ type: z.literal('cron'), expression: text, timezone: text }),
    z.strictObject({ type: z.literal('every'), unit: z.enum(['day', 'hour', 'minute', 'month', 'week']), value: z.number() }),
  ]),
)
const definition = {
  configSchema: json,
  definitionVersion: z.number(),
  description: text,
  displayName: text,
  key: text,
  name: text,
  payloadSchema: json,
  provider: text,
}
const endpoint = z.strictObject({
  body: z.strictObject({ allowArray: z.boolean(), allowEmpty: z.boolean(), formats: z.array(z.enum(['form', 'json', 'multipart', 'text'])) }),
  methods: z.array(z.enum(['DELETE', 'GET', 'HEAD', 'PATCH', 'POST', 'PUT'])),
  successStatus: z.number(),
})
const trigger = { name: text, description: text.optional(), icon: text.optional() }
const base = { inputs, name: text.optional(), description: text.optional(), icon: text.optional(), timeoutMs: z.number().optional() }
const node = z.union([
  z.strictObject({ ...base, kind: z.literal('condition'), ...condition }),
  z.strictObject({ ...base, kind: z.literal('value'), values: z.array(input) }),
  z.strictObject({ ...base, kind: z.literal('subflow'), subflowId: text }),
  z.strictObject({ ...base, kind: z.literal('task'), task: inline, additionalInputs: z.array(input).optional() }),
  z.strictObject({ ...base, kind: z.literal('task'), taskId: text, additionalInputs: z.array(input).optional() }),
  z.strictObject({ ...base, kind: z.literal('wait'), input, ...wait }).omit({ timeoutMs: true }),
  z.strictObject({ ...trigger, kind: z.literal('manual') }),
  z.strictObject({ ...trigger, kind: z.literal('webhook'), ...webhook }),
  z.strictObject({ ...trigger, kind: z.literal('cron'), cronTimes: schedule }),
  z.strictObject({
    ...trigger,
    kind: z.literal('poll'),
    bindingId: text,
    config: z.record(text, json),
    definition: z.strictObject({ ...definition, type: z.literal('poll') }),
    pollTimes: schedule,
  }),
  z.strictObject({
    ...trigger,
    kind: z.literal('integration'),
    bindingId: text,
    config: z.record(text, json),
    definition: z.strictObject({ ...definition, type: z.literal('integration'), endpoint }),
  }),
])
const target = z.union([z.strictObject({ kind: z.literal('flow') }), z.strictObject({ kind: z.literal('subflow'), id: text })])
const edge = z.strictObject({ source: text, target: text, sourceHandle: text.optional() })
const at = { nodeId: text, target }
const subflow = z.strictObject({ name: text, inputs: z.array(input), outputs: z.array(port.extend({ sources: z.array(z.union([nodeSource, flowSource])) })) })
const shapes = {
  'binding.create': { bindingId: text, binding: z.strictObject({ kind: z.enum(['connection', 'variable']), target: text }) },
  'binding.delete': { bindingId: text },
  'binding.target.set': { bindingId: text, before: text, value: text },
  'graph.edge.connect': { target, edge },
  'graph.edge.disconnect': { target, edge },
  'graph.node.create': { ...at, node },
  'graph.node.delete': at,
  'graph.node.field.set': z.union([
    z.strictObject({
      ...at,
      kind: z.literal('graph.node.field.set'),
      field: z.enum(['description', 'icon', 'name']),
      before: text.optional(),
      value: text.optional(),
    }),
    z.strictObject({
      ...at,
      kind: z.literal('graph.node.field.set'),
      field: z.literal('timeoutMs'),
      before: z.number().optional(),
      value: z.number().optional(),
    }),
  ]),
  'graph.node.input.set': { ...at, handle: text, before: mapping.optional(), value: mapping.optional() },
  'graph.node.additional-inputs.set': { ...at, before: z.array(input).optional(), value: z.array(input).optional() },
  'graph.node.condition.set': { ...at, before: z.strictObject(condition), value: z.strictObject(condition) },
  'graph.node.values.set': { ...at, before: z.array(input), value: z.array(input) },
  'graph.node.wait.set': { ...at, target: z.strictObject({ kind: z.literal('flow') }), before: z.strictObject(wait), value: z.strictObject(wait) },
  'graph.node.webhook.set': { ...at, target: z.strictObject({ kind: z.literal('flow') }), before: z.strictObject(webhook), value: z.strictObject(webhook) },
  'graph.node.task.ports.set': { ...at, before: z.strictObject(ports), value: z.strictObject(ports) },
  'graph.node.task.name.set': { ...at, before: text, value: text },
  'graph.node.task.capabilities.set': { ...at, before: z.array(capability).optional(), value: z.array(capability).optional() },
  'graph.trigger.config.set': { nodeId: text, name: text, before: json.optional(), value: json.optional() },
  'graph.trigger.schedule.set': { nodeId: text, before: schedule, value: schedule },
  'module.create': { moduleId: text, module: z.strictObject({ name: text, imports: strings, source: text }) },
  'module.delete': { moduleId: text },
  'module.rename': { moduleId: text, before: text, name: text },
  'module.source.replace': { moduleId: text, beforeImports: strings, beforeSource: text, imports: strings, source: text },
  'subflow.create': { subflowId: text, subflow: subflow.extend({ graph: z.strictObject({ nodes: z.record(text, node), edges: z.array(edge) }) }) },
  'subflow.definition.set': { subflowId: text, before: subflow, definition: subflow },
  'subflow.delete': { subflowId: text },
  'task.create': { taskId: text, task: managed },
  'task.delete': { taskId: text },
  'task.connector.connection.set': { taskId: text, before: text.optional(), value: text.optional() },
  'task.llm.mode.set': { taskId: text, before: z.enum(['chat', 'json']), value: z.enum(['chat', 'json']) },
  'task.name.set': { taskId: text, before: text, value: text },
} satisfies Record<ChangeOperation['kind'], z.ZodRawShape | z.ZodType>
const variants = new Map(
  Object.entries(shapes).map(([kind, shape]) => [kind, shape instanceof z.ZodType ? shape : z.strictObject({ kind: z.literal(kind), ...shape })]),
)
const operations = z.array(z.union([...variants.values()])).min(1)

export function decodeChangeOperations(value: unknown): readonly ChangeOperation[] {
  return z
    .array(z.unknown())
    .min(1)
    .parse(value)
    .map((candidate, index) => {
      const { kind } = z.object({ kind: text }).parse(candidate)
      const schema = variants.get(kind)
      if (schema == null) throw new TypeError(`operations[${index}]: Unknown operation ${JSON.stringify(kind)}.`)
      const result = schema.safeParse(candidate)
      if (!result.success)
        throw new TypeError(`operations[${index}]: ${result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`)
      return result.data as ChangeOperation
    })
}

export function changeOperationsSchema(kind?: string): JsonValue {
  const schema = kind == null ? operations : variants.get(kind)
  if (schema == null) throw new TypeError(`Unknown operation ${JSON.stringify(kind)}.`)
  return z.toJSONSchema(schema) as JsonValue
}
