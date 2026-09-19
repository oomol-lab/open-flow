import type { NodeSource, PortDefinition } from './change.ts'

import { schemaObject } from './schema.ts'

/** Only explicitly declared, first-level object properties are selectable. */
export function sourceFields(output: PortDefinition): readonly { readonly field: string; readonly port: PortDefinition }[] {
  const schema = schemaObject(output.jsonSchema)
  if (schema == null) return []
  const properties = schemaObject(schema.properties ?? false)
  const types = Array.isArray(schema.type) ? schema.type : [schema.type]
  if (properties == null || (schema.type !== undefined && !types.includes('object'))) return []
  const required = Array.isArray(schema.required) ? schema.required : []
  const missingParent = output.nullable || types.some((type) => type !== 'object')
  return Object.entries(properties).map(([field, jsonSchema]) => ({
    field,
    port: {
      jsonSchema,
      nullable: missingParent || !required.includes(field),
    },
  }))
}

export function sourcePort(output: PortDefinition, field: string | undefined): PortDefinition | undefined {
  return field === undefined ? output : sourceFields(output).find((candidate) => candidate.field === field)?.port
}

/** Brackets keep literal keys (including dots and empty strings) unambiguous. */
export function sourceOutputLabel(source: Pick<NodeSource, 'output' | 'field'>): string {
  return source.field === undefined ? source.output : `${source.output}[${JSON.stringify(source.field)}]`
}
