import dayjs from 'dayjs'
import { isDateFormat } from './dateValue.ts'
import { objectValue } from './value.ts'

export type WidgetType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'integer'
  | 'color'
  | 'text'
  | 'object'
  | 'array'
  | 'select'
  | 'multiSelect'
  | 'date'
  | 'any'
  | 'anyOf'
  | 'allOf'
  | 'oneOf'
  | 'binary'
  | 'literal'
  | 'null'

export const ui_widget = 'ui:widget'
export const ui_options = 'ui:options'
export const ContentMediaType = { binary: 'oomol/bin' }
const widgets = new Set<WidgetType>([
  'string',
  'number',
  'boolean',
  'integer',
  'color',
  'text',
  'object',
  'array',
  'select',
  'multiSelect',
  'date',
  'any',
  'anyOf',
  'allOf',
  'oneOf',
  'binary',
  'literal',
  'null',
])
export function isWidgetType(value: unknown): value is WidgetType {
  return typeof value == 'string' && widgets.has(value as WidgetType)
}

/** Widget inference is independent of canvas rendering and schema-editor icon choices. */
export function typeOfSchema(source: unknown): WidgetType {
  const schema = objectValue(source)
  if (!schema) return 'any'
  if (schema.contentMediaType === ContentMediaType.binary) return 'binary'
  if (isWidgetType(schema[ui_widget])) return schema[ui_widget]
  if (schema.anyOf) return 'anyOf'
  if (schema.oneOf) return 'oneOf'
  if (schema.allOf) return 'any'
  if (Object.hasOwn(schema, 'const')) return 'literal'
  if (schema.enum) return 'select'
  switch (schema.type) {
    case 'null':
    case 'boolean':
    case 'integer':
    case 'number':
    case 'object':
      return schema.type
    case 'array':
      return schema.uniqueItems ? 'multiSelect' : 'array'
    case 'string':
      return isDateFormat(schema.format) ? 'date' : 'string'
    default:
      return 'any'
  }
}

/** Used only when a user explicitly creates a widget value; unconstrained values remain unset. */
export function getDefaultValue(type: WidgetType, source?: unknown): unknown {
  const schema = objectValue(source)
  switch (type) {
    case 'null':
      return null
    case 'boolean':
      return false
    case 'integer':
    case 'number':
      return 0
    case 'string':
    case 'text':
      return ''
    case 'color':
      return '#7d7fe9'
    case 'select':
      return Array.isArray(schema?.enum) ? structuredClone(schema.enum[0] ?? null) : null
    case 'multiSelect':
    case 'array':
      return []
    case 'object':
      return {}
    case 'literal':
      return structuredClone(schema?.const)
    case 'date': {
      const format = schema?.format
      return dayjs().format(format === 'date' ? 'YYYY-MM-DD' : format === 'time' ? 'HH:mm:ssZ' : 'YYYY-MM-DDTHH:mm:ssZ')
    }
    default:
      return undefined
  }
}
