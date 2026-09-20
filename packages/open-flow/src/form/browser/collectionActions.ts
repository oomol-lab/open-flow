import type { FieldValueEditorProps } from './fieldValueEditor.tsx'

import { objectFieldNames } from '../common/objectFields.ts'
import { initialValue, objectValue, setObjectField, valueType } from '../common/value.ts'

export function objectFieldAdder(props: FieldValueEditorProps) {
  const { schema, value, onChange } = props
  const source = objectValue(schema) ?? {}
  const properties = objectValue(source.properties) ?? {}
  const names = objectFieldNames(schema, value)
  return (after?: string) => {
    let name = 'field'
    let index = 1
    while (names.includes(name)) name = `field${index++}`
    const order = [...names]
    order.splice(after == null ? order.length : order.indexOf(after) + 1, 0, name)
    const fieldSchema = props.onDefinitionChange ? { type: 'string' } : (source.additionalProperties ?? {})
    const next = setObjectField(value, name, initialValue(fieldSchema))
    if (props.onDefinitionChange) {
      props.onDefinitionChange({ ...source, 'properties': { ...properties, [name]: fieldSchema }, 'ui:order': order }, next)
    } else {
      onChange(Object.fromEntries(order.filter((key) => Object.hasOwn(next, key)).map((key) => [key, next[key]])))
    }
  }
}

/** Materialize a collection value without changing its definition. */
export function collectionCreateAction(props: FieldValueEditorProps): (() => void) | undefined {
  if (props.disabled || props.valueEditable === false) return
  const source = objectValue(props.schema) ?? {}
  if (valueType(props.schema, props.value) === 'object') return () => props.onChange({})
  if (valueType(props.schema, props.value) === 'array') {
    if (typeof source.maxItems === 'number' && source.maxItems <= 0) return
    return () => props.onChange([initialValue(Array.isArray(source.items) ? (source.items[0] ?? source.additionalItems ?? {}) : (source.items ?? {}))])
  }
}
