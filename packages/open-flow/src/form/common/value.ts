export type ValueType = 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array' | 'null'

export function objectValue(value: unknown): Record<string, unknown> | undefined {
  if (value == null || typeof value != 'object' || Array.isArray(value)) return
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null ? (value as Record<string, unknown>) : undefined
}

export function valueType(schema: unknown, value: unknown): ValueType {
  const type = objectValue(schema)?.type
  if (typeof type == 'string' && ['string', 'number', 'integer', 'boolean', 'object', 'array', 'null'].includes(type)) return type as ValueType
  if (Array.isArray(value)) return 'array'
  if (objectValue(value)) return 'object'
  if (value === null) return 'null'
  if (typeof value == 'boolean') return 'boolean'
  if (typeof value == 'number') return 'number'
  return 'string'
}

/** Defaults are only inserted by an explicit editor action, never by reading a field. */
export function initialValue(schema: unknown, type = valueType(schema, undefined)): unknown {
  const source = objectValue(schema)
  if (source && Object.hasOwn(source, 'default')) return structuredClone(source.default)
  if (source && Object.hasOwn(source, 'const')) return structuredClone(source.const)
  if (Array.isArray(source?.enum) && source.enum.length) return structuredClone(source.enum[0])
  switch (type) {
    case 'object':
      return {}
    case 'array':
      return []
    case 'boolean':
      return false
    case 'number':
    case 'integer':
      return 0
    case 'null':
      return null
    default:
      return ''
  }
}

export function setObjectField(value: unknown, name: string, next: unknown): Record<string, unknown> {
  return Object.fromEntries([
    ...Object.entries(objectValue(value) ?? {}).filter(([key]) => key != name),
    ...(next === undefined ? [] : [[name, next] as const]),
  ])
}

export function renameObjectField(value: unknown, name: string, nextName: string): Record<string, unknown> | undefined {
  const object = objectValue(value)
  if (!object || !Object.hasOwn(object, name) || (name != nextName && Object.hasOwn(object, nextName))) return
  return Object.fromEntries(Object.entries(object).map(([key, item]) => [key == name ? nextName : key, item]))
}

export function isJsonValue(value: unknown, ancestors = new Set<object>()): boolean {
  if (value === null || typeof value == 'string' || typeof value == 'boolean') return true
  if (typeof value == 'number') return Number.isFinite(value)
  if (value == null || typeof value != 'object' || ancestors.has(value)) return false
  const object = objectValue(value)
  if (!Array.isArray(value) && object == null) return false
  ancestors.add(value)
  const valid = (Array.isArray(value) ? Array.from(value) : Object.values(object!)).every((item) => isJsonValue(item, ancestors))
  ancestors.delete(value)
  return valid
}
