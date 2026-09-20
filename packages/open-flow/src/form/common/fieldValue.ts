import { editorComponent } from './editorComponent.ts'
import { objectValue, valueType } from './value.ts'

/** Presentation never normalizes the stored value. */
export function fieldValueState(schema: unknown, value: unknown, nullable = false) {
  const source = objectValue(schema) ?? {}
  const allowsNull =
    nullable ||
    source.type === 'null' ||
    (Array.isArray(source.type) && source.type.includes('null')) ||
    (Array.isArray(source.enum) && source.enum.includes(null))
  const presence = value === undefined ? 'unset' : value === null ? 'null' : 'value'
  return {
    presence,
    allowsNull,
    display: allowsNull && value == null ? 'null' : presence,
    canClear: value !== undefined && !(allowsNull && value === null),
    missing: value === undefined && !allowsNull,
    invalidNull: value === null && !allowsNull,
    empty:
      value == null ||
      value === '' ||
      (Array.isArray(value) && value.length === 0) ||
      (objectValue(value) != null && Object.keys(value as object).length === 0),
  } as const
}

/** JSON arrays retain their position when an item is cleared. */
export function setArrayItem(values: readonly unknown[], index: number, value: unknown) {
  return values.map((entry, at) => (at === index ? (value === undefined ? null : value) : entry))
}

export interface FieldValueDeletion {
  readonly target: 'objectItem' | 'arrayItem' | 'option'
  readonly name: string
}

/** Editor shape is shared by rendering and the first-child connector endpoint. */
export function fieldValueShape(schema: unknown, value: unknown, options: { compactCollection?: boolean; objectChild?: boolean; depth?: number } = {}) {
  const source = objectValue(schema) ?? {}
  const type = valueType(schema, value)
  const component = editorComponent(schema)
  const inferredObjectChild =
    options.objectChild === true &&
    source.type == null &&
    source.enum == null &&
    !['const', 'oneOf', 'anyOf', 'allOf', '$ref'].some((key) => Object.hasOwn(source, key))
  const complex =
    (component === 'json' && !inferredObjectChild) ||
    (options.compactCollection === true && (component === 'object' || component === 'array')) ||
    (options.depth ?? 0) > 12
  const enumeration = Array.isArray(source.enum) ? source.enum : Object.hasOwn(source, 'const') ? [source.const] : undefined
  const choices = component === 'multiSelect' ? objectValue(source.items)?.enum : source.enum
  const choiceOptions = component === 'select' || component === 'multiSelect' ? (Array.isArray(choices) ? choices : []) : undefined
  const collection = !complex && !enumeration && (type === 'object' || (type === 'array' && !choiceOptions))
  const text = type === 'string' && source['ui:widget'] === 'text'
  return { type, complex, enumeration, choiceOptions, collection, text, expandable: collection || complex || text }
}
