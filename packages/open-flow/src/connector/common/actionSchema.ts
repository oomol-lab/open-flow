import { toPlainObject } from '@wopjs/cast'

export interface ConnectorActionPorts {
  readonly inputs: readonly {
    readonly description?: string
    readonly handle: string
    readonly json_schema: unknown
    readonly nullable: boolean
    readonly value?: unknown
  }[]
  readonly initialInputs: readonly { readonly handle: string; readonly value: unknown }[]
  readonly outputs: readonly {
    readonly description?: string
    readonly handle: string
    readonly json_schema: unknown
    readonly nullable: boolean
  }[]
}

export interface ConnectorRuntimeInputPort {
  readonly handle: string
  readonly jsonSchema: unknown
  readonly nullable: boolean
}

export function connectorActionPorts(inputSchema: unknown, outputSchema: unknown): ConnectorActionPorts {
  const inputs = inputPorts(inputSchema)
  return {
    inputs,
    initialInputs: inputs.flatMap((input) => (input.value === undefined ? [] : [{ handle: input.handle, value: input.value }])),
    outputs: outputPorts(outputSchema),
  }
}

export function normalizeConnectorRuntimeInputs<Value>(
  ports: readonly ConnectorRuntimeInputPort[],
  inputs: Readonly<Record<string, Value>>,
): Readonly<Record<string, Value>> {
  const definitions: ReadonlyMap<string, ConnectorRuntimeInputPort> = new Map(ports.map((port) => [port.handle, port]))
  const result: Record<string, Value> = {}
  for (const [handle, value] of Object.entries(inputs) as [string, Value][]) {
    const port = definitions.get(handle)
    if (value == null && port?.nullable == true && !schemaAllowsNull(port.jsonSchema)) continue
    result[handle] = value
  }
  return result
}

function inputPorts(schema: unknown): ConnectorActionPorts['inputs'] {
  const root = toPlainObject(schema)
  if (root == null || (root.type != 'object' && root.properties == null)) {
    throw new Error('Connector action inputSchema must be an object schema.')
  }
  const properties = toPlainObject(root.properties)
  if (properties == null) return []
  const required = stringSet(root.required)
  return Object.entries(properties).map(([handle, propertySchema]) => {
    const isRequired = required.has(handle)
    const nullable = !isRequired || schemaAllowsNull(propertySchema, root)
    return {
      description: schemaDescription(root, propertySchema),
      handle,
      json_schema: propertySchemaWithDefinitions(root, propertySchema),
      nullable,
      value: schemaDefault(root, propertySchema, nullable),
    }
  })
}

export function connectorOutputMode(schema: unknown): 'fields' | 'value' {
  const root = toPlainObject(schema)
  const properties = toPlainObject(root?.properties)
  return (properties != null && Object.keys(properties).length > 0) || (root?.type == 'object' && root.additionalProperties === false) ? 'fields' : 'value'
}

function outputPorts(schema: unknown): ConnectorActionPorts['outputs'] {
  const root = toPlainObject(schema)
  if (connectorOutputMode(schema) == 'value') {
    return [{ description: schemaDescription(root, schema), handle: 'output', json_schema: schema, nullable: schemaAllowsNull(schema) }]
  }
  const properties = toPlainObject(root?.properties) ?? {}
  const required = stringSet(root?.required)
  return Object.entries(properties).map(([handle, propertySchema]) => ({
    description: schemaDescription(root, propertySchema),
    handle,
    json_schema: propertySchemaWithDefinitions(root!, propertySchema),
    nullable: !required.has(handle) || schemaAllowsNull(propertySchema, root),
  }))
}

function propertySchemaWithDefinitions(root: Record<string, unknown>, schema: unknown): unknown {
  const property = toPlainObject(schema)
  if (property == null) return schema
  const result: Record<string, unknown> = Object.assign({}, property)
  if (result.$defs == null && root.$defs != null) result.$defs = root.$defs
  if (result.definitions == null && root.definitions != null) result.definitions = root.definitions
  return result
}

function schemaDescription(root: unknown, schema: unknown): string | undefined {
  for (const object of referencedSchemas(root, schema)) {
    if (typeof object.description == 'string') return object.description
  }
  return undefined
}

function schemaDefault(root: unknown, schema: unknown, nullable: boolean): unknown {
  for (const object of referencedSchemas(root, schema)) {
    if (Object.hasOwn(object, 'default')) return object.default
  }
  return nullable ? null : undefined
}

function stringSet(value: unknown): ReadonlySet<string> {
  if (!Array.isArray(value)) return new Set()
  return new Set(value.filter((item): item is string => typeof item == 'string'))
}

function schemaAllowsNull(schema: unknown, root: unknown = schema, references: ReadonlySet<string> = new Set()): boolean {
  const object = toPlainObject(schema)
  if (object == null) return false
  if (Object.hasOwn(object, 'type')) {
    return object.type == 'null' || (Array.isArray(object.type) && object.type.includes('null'))
  }
  if (Object.hasOwn(object, 'enum')) return Array.isArray(object.enum) && object.enum.includes(null)
  for (const key of ['anyOf', 'oneOf'] as const) {
    if (Object.hasOwn(object, key)) {
      return Array.isArray(object[key]) && object[key].some((item) => schemaAllowsNull(item, root, references))
    }
  }
  const reference = typeof object.$ref == 'string' ? object.$ref : undefined
  if (reference == null || references.has(reference)) return false
  const target = resolveLocalReference(root, reference)
  if (target === undefined) return false
  const nextReferences = new Set(references)
  nextReferences.add(reference)
  return schemaAllowsNull(target, root, nextReferences)
}

function referencedSchemas(root: unknown, schema: unknown): readonly Record<string, unknown>[] {
  const result: Record<string, unknown>[] = []
  const references = new Set<string>()
  let current = schema
  while (true) {
    const object = toPlainObject(current)
    if (object == null) return result
    result.push(object)
    const reference = typeof object.$ref == 'string' ? object.$ref : undefined
    if (reference == null || references.has(reference)) return result
    const target = resolveLocalReference(root, reference)
    if (target === undefined) return result
    references.add(reference)
    current = target
  }
}

function resolveLocalReference(root: unknown, reference: string): unknown {
  if (reference == '#') return root
  if (!reference.startsWith('#/')) return undefined
  let current = root
  for (const encodedToken of reference.slice(2).split('/')) {
    const object = toPlainObject(current)
    const token = encodedToken.replaceAll('~1', '/').replaceAll('~0', '~')
    if (object == null || !Object.hasOwn(object, token)) return undefined
    current = object[token]
  }
  return current
}
