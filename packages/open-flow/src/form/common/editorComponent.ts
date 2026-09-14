import { typeOfSchema } from './schemaWidget.ts'
import { initialValue, objectValue, valueType } from './value.ts'

export const editorGroups = {
  strings: ['string', 'text'],
  numbers: ['number', 'integer'],
  choices: ['select', 'multiSelect', 'boolean'],
  dates: ['date', 'time', 'dateTime'],
  other: ['color', 'object', 'array', 'json', 'null'],
} as const
export type EditorComponent = (typeof editorGroups)[keyof typeof editorGroups][number]

export function editorComponent(schema: unknown): EditorComponent {
  const type = typeOfSchema(schema)
  if (type === 'date') {
    const format = objectValue(schema)?.format
    return format === 'time' ? 'time' : format === 'date-time' ? 'dateTime' : 'date'
  }
  return Object.values(editorGroups).some((group) => (group as readonly string[]).includes(type)) ? (type as EditorComponent) : 'json'
}

/** Changing the editor replaces incompatible constraints, retaining descriptive metadata. */
export function schemaForEditor(component: EditorComponent, previous: unknown): Record<string, unknown> {
  if (editorComponent(previous) === component) return { ...objectValue(previous) }
  const source = objectValue(previous) ?? {}
  const metadata = Object.fromEntries(
    ['title', 'description', '$comment', 'readOnly', 'writeOnly'].filter((key) => key in source).map((key) => [key, source[key]]),
  )
  const options = Array.isArray(source.enum) ? source.enum : objectValue(source.items)?.enum
  switch (component) {
    case 'text':
      return { ...metadata, 'type': 'string', 'ui:widget': 'text' }
    case 'color':
      return { ...metadata, 'type': 'string', 'ui:widget': 'color', 'ui:options': { colorType: 'HEX8' } }
    case 'date':
    case 'time':
    case 'dateTime':
      return { ...metadata, type: 'string', format: component === 'dateTime' ? 'date-time' : component }
    case 'select':
      return { ...metadata, enum: Array.isArray(options) ? options : [] }
    case 'multiSelect':
      return { ...metadata, type: 'array', uniqueItems: true, items: { enum: Array.isArray(options) ? options : [] } }
    case 'json':
      return { ...metadata, 'ui:widget': 'any' }
    default:
      return { ...metadata, type: component }
  }
}

/** Preserve compatible data and unset state instead of resetting on visual changes. */
export function valueForEditor(schema: unknown, value: unknown): unknown {
  if (value === undefined) return undefined
  const source = objectValue(schema) ?? {}
  if (Array.isArray(source.enum)) return source.enum.some((item) => JSON.stringify(item) === JSON.stringify(value)) ? value : undefined
  const itemEnum = objectValue(source.items)?.enum
  if (Array.isArray(itemEnum))
    return (Array.isArray(value) ? value : [value]).filter((item) => itemEnum.some((option) => JSON.stringify(option) === JSON.stringify(item)))
  if (source.type == null) return value
  const type = valueType(schema, value)
  if (
    (type === 'string' && typeof value === 'string') ||
    (type === 'boolean' && typeof value === 'boolean') ||
    (type === 'number' && typeof value === 'number') ||
    (type === 'integer' && typeof value === 'number' && Number.isInteger(value)) ||
    (type === 'object' && objectValue(value)) ||
    (type === 'array' && Array.isArray(value)) ||
    (type === 'null' && value === null)
  )
    return value
  return initialValue(schema)
}
