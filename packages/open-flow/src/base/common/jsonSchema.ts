import { toPlainObject } from '@wopjs/cast'

/** Keep local definition references usable when a property becomes a standalone schema. */
export function propertySchemaWithDefinitions(root: Readonly<Record<string, unknown>>, schema: unknown): unknown {
  const property = toPlainObject(schema)
  if (property == null) return schema
  const result: Record<string, unknown> = Object.assign({}, property)
  if (result.$defs == null && root.$defs != null) result.$defs = root.$defs
  if (result.definitions == null && root.definitions != null) result.definitions = root.definitions
  return result
}
