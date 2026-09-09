import type { AgentInput, AgentTool, InputPortDefinition, JsonValue, ManagedTaskDefinition, ManagedTaskExecutor } from './change.ts'

import { format } from '@cfworker/json-schema'
import { z } from 'zod'
import { portsByHandle } from './change.ts'
import { checkJsonDepth } from './json.ts'
import { matchesSchema, portsAssignable, schemaObject } from './schema.ts'

export type AgentConfig = Extract<ManagedTaskExecutor, { readonly kind: 'agent' }>

const schema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.boolean(),
    z
      .strictObject({
        type: z
          .union([
            z.enum(['array', 'boolean', 'integer', 'null', 'number', 'object', 'string']),
            z.array(z.enum(['array', 'boolean', 'integer', 'null', 'number', 'object', 'string'])).min(1),
          ])
          .optional(),
        const: z.json().optional(),
        allOf: z.array(schema).min(1).optional(),
        anyOf: z.array(schema).min(1).optional(),
        oneOf: z.array(schema).min(1).optional(),
        not: schema.optional(),
        if: schema.optional(),
        // eslint-disable-next-line unicorn/no-thenable -- JSON Schema defines a conditional keyword named then.
        then: schema.optional(),
        else: schema.optional(),
        $ref: z.string().optional(),
        $schema: z
          .enum([
            'http://json-schema.org/draft-07/schema#',
            'https://json-schema.org/draft-07/schema',
            'https://json-schema.org/draft/2019-09/schema',
            'https://json-schema.org/draft/2020-12/schema',
          ])
          .optional(),
        $defs: z.record(z.string(), schema).optional(),
        definitions: z.record(z.string(), schema).optional(),
        pattern: z
          .string()
          .refine((value) => {
            try {
              return new RegExp(value, 'u').source.length > 0
            } catch {
              return false
            }
          }, 'Invalid regular expression.')
          .optional(),
        format: z
          .string()
          .refine((value) => Object.hasOwn(format, value), 'Unsupported string format.')
          .optional(),
        multipleOf: z.number().positive().optional(),
        uniqueItems: z.boolean().optional(),
        contains: schema.optional(),
        minContains: z.number().int().nonnegative().optional(),
        maxContains: z.number().int().nonnegative().optional(),
        minProperties: z.number().int().nonnegative().optional(),
        maxProperties: z.number().int().nonnegative().optional(),
        propertyNames: schema.optional(),
        patternProperties: z
          .record(
            z.string().refine((value) => {
              try {
                return new RegExp(value, 'u').source.length > 0
              } catch {
                return false
              }
            }, 'Invalid regular expression.'),
            schema,
          )
          .optional(),
        dependentRequired: z.record(z.string(), z.array(z.string())).optional(),
        dependentSchemas: z.record(z.string(), schema).optional(),
        dependencies: z.record(z.string(), z.union([schema, z.array(z.string())])).optional(),
        prefixItems: z.array(schema).optional(),
        additionalItems: schema.optional(),
        unevaluatedItems: schema.optional(),
        unevaluatedProperties: schema.optional(),
        description: z.string().optional(),
        title: z.string().optional(),
        default: z.json().optional(),
        examples: z.array(z.json()).optional(),
        readOnly: z.boolean().optional(),
        writeOnly: z.boolean().optional(),
        deprecated: z.boolean().optional(),
        $comment: z.string().optional(),
        enum: z.array(z.json()).min(1).optional(),
        properties: z.record(z.string(), schema).optional(),
        required: z.array(z.string()).optional(),
        additionalProperties: schema.optional(),
        items: z.union([schema, z.array(schema)]).optional(),
        minItems: z.number().int().nonnegative().optional(),
        maxItems: z.number().int().nonnegative().optional(),
        minLength: z.number().int().nonnegative().optional(),
        maxLength: z.number().int().nonnegative().optional(),
        minimum: z.number().optional(),
        maximum: z.number().optional(),
        exclusiveMinimum: z.number().optional(),
        exclusiveMaximum: z.number().optional(),
      })
      .transform(
        ({
          title: _title,
          default: _default,
          examples: _examples,
          readOnly: _readOnly,
          writeOnly: _writeOnly,
          deprecated: _deprecated,
          $comment: _comment,
          ...value
        }) => value,
      ),
  ]),
)

const schemaMaps = new Set(['properties', 'patternProperties', 'dependentSchemas', '$defs', 'definitions'])
const schemaArrays = new Set(['allOf', 'anyOf', 'oneOf', 'prefixItems'])
const schemaChildren = new Set([
  'not',
  'if',
  'then',
  'else',
  'items',
  'additionalItems',
  'contains',
  'additionalProperties',
  'propertyNames',
  'unevaluatedProperties',
  'unevaluatedItems',
])

function modelSchema(original: JsonValue, expand = true): JsonValue {
  const root = schema.parse(original)
  const draft7 = schemaObject(root)?.$schema?.toString().includes('draft-07') == true
  let size = 0
  const visit = (value: JsonValue, refs: readonly string[], depth: number): JsonValue => {
    if (++size > 4096 || depth > 64) throw new Error('Expanded schema exceeds the size or depth limit.')
    const object = schemaObject(value)
    if (object == null) return value
    if (typeof object.$ref == 'string') {
      const ref = object.$ref
      if (ref != '#' && !ref.startsWith('#/')) throw new Error(`External or anchor reference is not supported: ${ref}`)
      if (refs.includes(ref)) {
        if (!expand) return value
        throw new Error(`Recursive reference cannot be expanded for the model: ${ref}`)
      }
      let target: JsonValue = root
      for (const part of ref == '#' ? [] : ref.slice(2).split('/')) {
        const key = decodeURIComponent(part).replace(/~1/g, '/').replace(/~0/g, '~')
        const item = Array.isArray(target) ? Object.fromEntries(target.map((entry, index) => [String(index), entry])) : schemaObject(target)
        if (item == null || !Object.hasOwn(item, key)) throw new Error(`Unresolved schema reference: ${ref}`)
        target = item[key]!
      }
      if (typeof target != 'boolean' && schemaObject(target) == null) throw new Error(`Reference does not point to a schema: ${ref}`)
      const resolved = visit(target, [...refs, ref], depth + 1)
      const { $ref: _ref, ...siblings } = object
      return draft7 || Object.keys(siblings).length == 0 ? resolved : { allOf: [resolved, visit(siblings, refs, depth + 1)] }
    }
    return Object.fromEntries(
      Object.entries(object).flatMap<[string, JsonValue]>(([key, child]) => {
        if (key == '$defs' || key == 'definitions' || key == '$schema') return []
        if (schemaMaps.has(key))
          return [[key, Object.fromEntries(Object.entries(schemaObject(child) ?? {}).map(([name, nested]) => [name, visit(nested, refs, depth + 1)]))]]
        if (schemaArrays.has(key) || (key == 'items' && Array.isArray(child)))
          return [[key, (child as readonly JsonValue[]).map((nested) => visit(nested, refs, depth + 1))]]
        if (schemaChildren.has(key)) return [[key, visit(child, refs, depth + 1)]]
        if (key == 'dependencies')
          return [
            [
              key,
              Object.fromEntries(
                Object.entries(schemaObject(child) ?? {}).map(([name, nested]) => [name, Array.isArray(nested) ? nested : visit(nested, refs, depth + 1)]),
              ),
            ],
          ]
        return [[key, child]]
      }),
    )
  }
  return visit(root, [], 0)
}

function schemaIssue(value: JsonValue, forModel = false): string | undefined {
  const result = schema.safeParse(value)
  if (result.success) {
    try {
      modelSchema(value, forModel)
      return
    } catch (error) {
      return error instanceof Error ? error.message : String(error)
    }
  }
  const issues = [...result.error.issues]
  for (let index = 0; index < issues.length; index++) {
    const issue = issues[index]!
    if (issue.code == 'invalid_union') issues.push(...issue.errors.flat())
  }
  const issue = issues.find((item) => item.code == 'unrecognized_keys') ?? issues.at(-1)!
  const message = issue.code == 'unrecognized_keys' ? `unsupported keywords: ${issue.keys.join(', ')}` : issue.message
  return `${issue.path.length == 0 ? '' : `${issue.path.map(String).join('.')}: `}${message}`
}

export function agentConfigIssues(task: ManagedTaskDefinition, tasks: Readonly<Record<string, ManagedTaskDefinition>>): readonly string[] {
  if (task.executor.kind != 'agent') return []
  const config = task.executor
  const issues: string[] = []
  const inputs = portsByHandle(task.inputs)
  const sourceIssue = (source: Exclude<AgentInput, { readonly kind: 'model' }>, port: InputPortDefinition): boolean => {
    if (source.kind == 'value') return !(source.value === null && port.nullable) && !matchesSchema(source.value, port.jsonSchema)
    const input = inputs[source.input]
    return input == null || !portsAssignable(input, port)
  }
  if (config.model.trim().length == 0) issues.push('Choose an Agent model.')
  if (!Number.isSafeInteger(config.maxRounds) || config.maxRounds < 1 || config.maxRounds > 100) issues.push('Agent maxRounds must be between 1 and 100.')
  if (sourceIssue(config.prompt, { jsonSchema: { type: 'string' }, nullable: false })) issues.push('Agent prompt must resolve to a string input or value.')
  const outputs = task.outputs.filter((port) => 'handle' in port)
  if (outputs.length != 1 || outputs[0]?.handle != 'output' || outputs[0].nullable || schemaIssue(outputs[0].jsonSchema) != null) {
    issues.push('Agent requires one non-nullable output named output with a supported JSON schema.')
  }
  if ((config.tools.length == 0 && config.code != true) || config.tools.length > 64)
    issues.push('Declare up to 64 Agent tools and enable at least one tool or code computation.')
  const ids = new Set<string>()
  const names = new Set<string>()
  for (const tool of config.tools) {
    if (tool.id.length == 0 || ids.has(tool.id)) issues.push('Agent tool identities must be non-empty and unique.')
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(tool.name) || names.has(tool.name)) issues.push('Agent tool names must be unique provider-compatible names.')
    if (tool.name == 'read_result' || tool.name == 'run_code') issues.push(`Tool name ${tool.name} is reserved for built-in Agent tools.`)
    ids.add(tool.id)
    names.add(tool.name)
    if (tool.description.trim().length == 0) issues.push(`Tool ${tool.name} requires a description.`)
    if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_.-]+$/.test(tool.action) || tool.connectionId === '')
      issues.push(`Tool ${tool.name} has an invalid Action or Connection.`)
    const fields = new Set<string>()
    for (const port of tool.inputs) {
      if (port.handle.length == 0 || fields.has(port.handle)) issues.push(`Tool ${tool.name} has an empty or duplicate input.`)
      fields.add(port.handle)
      const problem = schemaIssue(port.jsonSchema, port.source.kind == 'model')
      if (problem != null) issues.push(`Tool ${tool.name} input ${port.handle} has an invalid schema (${problem}).`)
      if (Object.hasOwn(port, 'value')) issues.push(`Tool ${tool.name} input ${port.handle} must specify its value through source.`)
      if (port.source.kind != 'model' && sourceIssue(port.source, port)) issues.push(`Tool ${tool.name} input ${port.handle} has an incompatible source.`)
    }
  }
  if (config.notification != null) {
    const notice = config.notification
    const target = tasks[notice.taskId]
    if (target?.executor.kind != 'connector') issues.push('Agent notification must reference a Connector Task.')
    else {
      const ports = portsByHandle(target.inputs)
      const message = ports[notice.messageHandle]
      if (message == null || !portsAssignable({ jsonSchema: { type: 'string' }, nullable: false }, message))
        issues.push('Agent notification requires a string message input.')
      if (Object.hasOwn(notice.inputs, notice.messageHandle)) issues.push('Agent notification message is supplied by the host.')
      for (const [handle, source] of Object.entries(notice.inputs)) {
        const port = ports[handle]
        if (port == null || sourceIssue(source, port)) issues.push(`Agent notification input ${handle} has an incompatible source.`)
      }
      for (const port of Object.values(ports)) {
        if (port.handle != notice.messageHandle && !Object.hasOwn(notice.inputs, port.handle) && !port.nullable && !Object.hasOwn(port, 'value')) {
          issues.push(`Agent notification input ${port.handle} requires a source.`)
        }
      }
    }
  }
  return issues
}

export function agentInput(source: Exclude<AgentInput, { readonly kind: 'model' }>, input: Readonly<Record<string, JsonValue>>): JsonValue {
  if (source.kind == 'value') return source.value
  if (!Object.hasOwn(input, source.input)) throw new Error(`Agent input ${source.input} is missing.`)
  return input[source.input]!
}

export function agentToolSchema(tool: AgentTool): JsonValue {
  const ports = tool.inputs.filter((port) => port.source.kind == 'model')
  return {
    type: 'object',
    additionalProperties: false,
    properties: Object.fromEntries(
      ports.map((port) => {
        const value = modelSchema(port.jsonSchema)
        return [
          port.handle,
          {
            ...(port.nullable ? { anyOf: [value, { type: 'null' }] } : typeof value == 'object' && value != null ? value : { allOf: [value] }),
            ...(port.description == null ? {} : { description: port.description }),
          },
        ]
      }),
    ),
    required: ports.map((port) => port.handle),
  }
}

export function agentToolInput(tool: AgentTool, input: Readonly<Record<string, JsonValue>>, argumentsValue: unknown): Readonly<Record<string, JsonValue>> {
  checkJsonDepth(argumentsValue)
  const args = z.record(z.string(), z.json()).parse(argumentsValue)
  if (!matchesSchema(args, agentToolSchema(tool))) throw new Error(`Tool ${tool.name} arguments do not match the model input schema.`)
  return Object.fromEntries(
    tool.inputs.map((port) => {
      const value = port.source.kind == 'model' ? args[port.handle] : agentInput(port.source, input)
      if (value === undefined || (!(value === null && port.nullable) && !matchesSchema(value, port.jsonSchema)))
        throw new Error(`Tool ${tool.name} input ${port.handle} is invalid.`)
      return [port.handle, value]
    }),
  )
}
