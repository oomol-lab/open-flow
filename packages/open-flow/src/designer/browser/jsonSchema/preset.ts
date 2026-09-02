/* @unocss-include */

import type { JsonSchema } from './types.ts'

import { isArray } from '@wopjs/cast'
import { asArray, filterMap, isFunction, Negative, toArray, toPlainObject } from '../base/trivial.ts'
import { asDateTimeFormat, formatDate, isDateTimeFormat } from '../components/constants.ts'

type UnoIconLiteral = `i-${string}:${string}`

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

export interface WidgetTypeOption {
  icon: UnoIconLiteral
  label: string
  value: WidgetType
}

export interface WidgetTypeOptionGroup {
  icon: UnoIconLiteral
  label: string
  value: string
  options: WidgetTypeOption[]
}

const WIDGET_TYPE_OPTIONS: Readonly<Record<WidgetType, WidgetTypeOption>> = {
  string: { icon: 'i-carbon:quotes', value: 'string', label: 'String' },
  number: { icon: 'i-carbon:number-0', value: 'number', label: 'Number' },
  boolean: { icon: 'i-carbon:boolean', value: 'boolean', label: 'Boolean' },
  integer: { icon: 'i-carbon:number-0', value: 'integer', label: 'Integer' },
  color: { icon: 'i-codicon:symbol-color', value: 'color', label: 'Color' },
  text: { icon: 'i-carbon:text-long-paragraph', value: 'text', label: 'Text' },
  object: { icon: 'i-carbon:object', value: 'object', label: 'Object' },
  array: { icon: 'i-carbon:array', value: 'array', label: 'Array' },
  select: { icon: 'i-carbon:radio-button-checked', value: 'select', label: 'Single' },
  multiSelect: { icon: 'i-carbon:checkbox-checked', value: 'multiSelect', label: 'Multi' },
  date: { icon: 'i-carbon:calendar', value: 'date', label: 'Date' },
  any: { icon: 'i-carbon:json', value: 'any', label: 'Any' },
  anyOf: { icon: 'i-carbon:json', value: 'anyOf', label: 'AnyOf' },
  allOf: { icon: 'i-carbon:json', value: 'allOf', label: 'AllOf' },
  oneOf: { icon: 'i-carbon:json', value: 'oneOf', label: 'OneOf' },
  binary: { icon: 'i-carbon:transform-binary', value: 'binary', label: 'Binary' },
  literal: { icon: 'i-carbon:code', value: 'literal', label: 'Literal' },
  null: { icon: 'i-carbon:null-sign', value: 'null', label: 'Null' },
}

export const isWidgetType = (type: string): type is WidgetType => Object.hasOwn(WIDGET_TYPE_OPTIONS, type)

export interface AdditionalIcons {
  close: UnoIconLiteral
  gotoFile: UnoIconLiteral
  objectAdd: UnoIconLiteral
  objectDelete: UnoIconLiteral
  package: UnoIconLiteral
  settings: UnoIconLiteral
  tool: UnoIconLiteral
}

const ADDITIONAL_ICONS: AdditionalIcons = {
  close: 'i-codicon:close',
  gotoFile: 'i-codicon:go-to-file',
  objectAdd: 'i-carbon:add-alt',
  objectDelete: 'i-carbon:subtract-alt',
  package: 'i-codicon:package',
  settings: 'i-codicon:gear',
  tool: 'i-codicon:symbol-property',
}

export type AdditionalIconsKey = keyof typeof ADDITIONAL_ICONS

export type IconKey = WidgetType | AdditionalIconsKey

export const iconOf = (key: IconKey): UnoIconLiteral => (isWidgetType(key) ? WIDGET_TYPE_OPTIONS[key].icon : ADDITIONAL_ICONS[key])

/**
 * Returns a string from {@link Icons}.
 */
export const iconOfSchema = (schema?: unknown): UnoIconLiteral => iconOf(typeOfSchema(schema))

export const optionOf = (t: (key: string) => string, type: WidgetType): WidgetTypeOption => {
  const opt = WIDGET_TYPE_OPTIONS[type]
  return { ...opt, label: t(`preset.${opt.value}`) }
}

export type WidgetSelectOption = WidgetTypeOption | WidgetTypeOptionGroup

export const widgetSelectOptions = (t: (key: string) => string, predicate: (type: WidgetType) => boolean): WidgetSelectOption[] => {
  const options: WidgetSelectOption[] = [
    WIDGET_TYPE_OPTIONS.string,
    WIDGET_TYPE_OPTIONS.number,
    WIDGET_TYPE_OPTIONS.boolean,
    WIDGET_TYPE_OPTIONS.integer,
    WIDGET_TYPE_OPTIONS.color,
    WIDGET_TYPE_OPTIONS.text,
    WIDGET_TYPE_OPTIONS.object,
    WIDGET_TYPE_OPTIONS.array,
    {
      icon: 'i-carbon:checkbox-checked',
      label: 'Select',
      value: 'select',
      options: [WIDGET_TYPE_OPTIONS.select, WIDGET_TYPE_OPTIONS.multiSelect],
    },
    WIDGET_TYPE_OPTIONS.date,
    WIDGET_TYPE_OPTIONS.any,
    WIDGET_TYPE_OPTIONS.binary,
    WIDGET_TYPE_OPTIONS.null,
    {
      icon: 'i-carbon:branch',
      label: 'Applicators',
      value: 'applicators',
      options: [WIDGET_TYPE_OPTIONS.anyOf, WIDGET_TYPE_OPTIONS.allOf, WIDGET_TYPE_OPTIONS.oneOf],
    },
  ]
  return filterMap(options, (optOrGroup) => {
    if (isWidgetTypeOptionGroup(optOrGroup)) {
      const groupOptions = filterMap(optOrGroup.options, (opt) => {
        return predicate(opt.value) ? { ...opt, label: t(`preset.${opt.value}`) } : Negative
      })
      if (groupOptions.length > 0) {
        return {
          ...optOrGroup,
          label: t(`preset.${optOrGroup.label}`),
          options: groupOptions,
        }
      }
      // if (optOrGroup.options.length === 1) {
      //   return optOrGroup.options[0];
      // }
    } else if (predicate(optOrGroup.value)) {
      return { ...optOrGroup, label: t(`preset.${optOrGroup.value}`) }
    }
    return Negative
  })
}

const isWidgetTypeOptionGroup = (opt: WidgetTypeOption | WidgetTypeOptionGroup): opt is WidgetTypeOptionGroup => 'options' in opt

export const ui_widget = 'ui:widget'
export const ui_options = 'ui:options'

export const ContentMediaType = {
  binary: 'oomol/bin',
}

// Use getBaseSchema to clone one of these default JSON Schemas.
const BaseSchema: Record<WidgetType, JsonSchema> = {
  // Binary values do not have a literal value editor.
  binary: { contentMediaType: ContentMediaType.binary },
  literal: {},
  // Accept any JSON value.
  any: {},
  null: { type: 'null' },
  boolean: { type: 'boolean' },
  integer: { type: 'integer' },
  number: { type: 'number' },
  // String schemas.
  string: { type: 'string' },
  date: { type: 'string', format: 'date-time' },
  color: {
    type: 'string',
    [ui_widget]: 'color',
    [ui_options]: { colorType: 'HEX' },
  },
  text: { type: 'string', [ui_widget]: 'text' },
  // Labels and types match enum values by index. The editor currently creates string values.
  select: {
    enum: [],
    [ui_options]: { labels: [], types: void 0 },
  },
  // Array schemas.
  multiSelect: {
    type: 'array',
    uniqueItems: true,
    // The editor currently creates string values.
    items: { enum: [] },
    // Labels and types match items.enum values by index.
    [ui_options]: { labels: [], types: void 0 },
  },
  array: { type: 'array' },
  // Object
  object: { type: 'object', additionalProperties: false, properties: void 0 },
  // Schema applicators.
  anyOf: { anyOf: [], [ui_options]: { labels: [] } },
  oneOf: { oneOf: [], [ui_options]: { labels: [] } },
  allOf: { allOf: [], [ui_options]: { labels: [] } },
  // A type array is intentionally not exposed until the editor can preserve it without loss.
  // multiTypes: { type: [] },
}

/** Pass oldSchema to preserve compatible editor options. */
export function getBaseSchema(type: WidgetType, oldSchema?: unknown): JsonSchema {
  const schema = structuredClone(BaseSchema[type])
  if (oldSchema) {
    applyOldSchema(schema, oldSchema as JsonSchema)
  }
  return schema
}

export function getDefaultSchemaForNewHandle(
  defs?: readonly ({ json_schema?: unknown; readonly group?: undefined } | { readonly group: string })[],
): JsonSchema {
  if (defs && defs.length > 0) {
    // Use the last definition before the first group divider.
    let result: JsonSchema | undefined
    for (const def of defs) {
      if (def.group != null) {
        break
      }
      const schema = def.json_schema
      if (schema) {
        result = schema as JsonSchema
      }
    }
    return result || getBaseSchema('any')
  }
  return getBaseSchema('any')
}

export function getDefaultValueForNewHandle(): unknown {
  return undefined
}

const DefaultValue: Record<WidgetType, unknown> = {
  null: null,
  boolean: false,
  integer: 0,
  number: 0,
  string: '',
  color: '#7d7fe9',
  select: (schema: unknown) => {
    const v = asArray((schema as JsonSchema | null)?.enum)?.[0]
    return v === undefined ? null : v
  },
  multiSelect: [],
  date: (schema: unknown) => formatDate(new Date(), asDateTimeFormat((schema as JsonSchema | null)?.format)),
  text: '',
  any: void 0,
  object: {},
  array: [],
  anyOf: void 0,
  allOf: void 0,
  oneOf: void 0,
  binary: void 0,
  literal: (schema: unknown) => (schema as JsonSchema | null)?.const,
}

export function getDefaultValue(type: WidgetType, schema?: unknown): unknown {
  const v = DefaultValue[type]
  return isFunction(v) ? v(schema) : v
}

export function typeOfSchema(source: unknown): WidgetType {
  const schema = source as JsonSchema | null

  if (!schema) return 'any'

  switch (schema.contentMediaType) {
    case BaseSchema.binary.contentMediaType:
      return 'binary'
  }

  if (schema[ui_widget]) {
    if (isWidgetType(schema[ui_widget])) return schema[ui_widget]
  }

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
      return isDateTimeFormat(schema.format) ? 'date' : 'string'
    default:
      return 'any'
  }
}

export function isAny(schemaType: WidgetType): boolean {
  return schemaType == 'any'
}

// These schema kinds can be overridden at a node input.
export function isUndecidable(schemaType: WidgetType): boolean {
  return schemaType == 'any' || schemaType == 'anyOf' || schemaType == 'oneOf' || schemaType == 'allOf'
}

/**
 * Not {@link isUndecidable} plus not `binary`.
 */
export function isPrimitive(schemaType: WidgetType): boolean {
  return !isUndecidable(schemaType) && schemaType !== 'binary'
}

export type PrimitiveType = 'string' | 'number' | 'boolean' | 'object' | 'array' | 'null' | 'bigint' | 'symbol' | 'function' | 'undefined'

/**
 * Converts an editor widget type to its JavaScript primitive type.
 *
 * Undefined means that the widget accepts any value except undefined itself.
 */
export function asPrimitiveType(type: WidgetType): PrimitiveType | undefined {
  // Select options may contain any JSON primitive.
  switch (type) {
    case 'string':
    case 'text':
    case 'color':
    case 'date':
      return 'string'
    case 'number':
    case 'integer':
      return 'number'
    case 'boolean':
      return 'boolean'
    case 'object':
      return 'object'
    case 'null':
      return 'null'
    case 'multiSelect':
    case 'array':
      return 'array'
  }
}

/**
 * Infers a JavaScript primitive type from a value.
 */
export function inferPrimitiveType(value: unknown): PrimitiveType {
  if (value === null) return 'null'
  const t = typeof value
  if (t === 'object' && Array.isArray(value)) return 'array'
  return t
}

export function inferSchemaTypeFromPrimitive(t: PrimitiveType): WidgetType {
  switch (t) {
    case 'string':
    case 'number':
    case 'boolean':
    case 'object':
    case 'array':
    case 'null':
      return t
    default:
      return 'any'
  }
}

/**
 * Estimates the number of first-level editor rows for a schema.
 */
export function sizeOfSchema(schema: unknown): number {
  const t = typeOfSchema(schema)

  if (t === 'anyOf' || t === 'oneOf' || t === 'allOf') {
    const size = (schema as JsonSchema)[t]?.length ?? 0
    return size || 1 // Keep one row for the add button.
  }

  if (t === 'string') return 4 // format, regex, minLen, maxLen

  if (t === 'array') return 3 // min, max, type

  if (t === 'color') return 1 // colorType

  if (t === 'date') return 1 // format

  if (t === 'integer' || t === 'number') return 5 // min, max, step

  if (t === 'object') {
    const properties = toPlainObject((schema as JsonSchema).properties)
    const size = properties ? Object.keys(properties).length : 1 // Keep one row for the add button.
    return size + 1 // additionalProperties
  }

  if (t === 'select') {
    const size = toArray((schema as JsonSchema).enum)?.length ?? 0
    return size ? size * 2 : 1 // Each option uses a value and label row.
  }

  if (t === 'multiSelect') {
    const items = toPlainObject((schema as JsonSchema).items)
    const size = toArray(items?.enum)?.length ?? 0
    return size ? size * 2 : 1 // Each option uses a value and label row.
  }

  return 0
}

//#region Transform Schema

/**
 * Copies compatible editor options from oldSchema into schema.
 */
function applyOldSchema(schema: JsonSchema, oldSchema: JsonSchema): void {
  const enumLikeData = fetchEnumLikeData(oldSchema)
  if (enumLikeData) {
    applyEnumLikeData(schema, enumLikeData)
  }
}

interface EnumLikeData {
  enum: string[]
  labels?: string[]
}

function fetchEnumLikeData(schema: JsonSchema): EnumLikeData | undefined {
  switch (typeOfSchema(schema)) {
    case 'select':
      return makeEnumLikeData(schema.enum, schema[ui_options]?.labels)
    case 'multiSelect':
      return makeEnumLikeData(toPlainObject(schema.items)?.enum, schema[ui_options]?.labels)
  }
}

function makeEnumLikeData(values: unknown, labels: unknown): EnumLikeData | undefined {
  if (isArrayCompat(values) && values.length > 0) {
    return { enum: values, labels: isArrayCompat(labels) ? labels : undefined }
  }
}

// This preserves the array narrowing required by the schema editor.
function isArrayCompat(value: unknown): value is string[] {
  return isArray(value)
}

function applyEnumLikeData(schema: JsonSchema, data: EnumLikeData): void {
  switch (typeOfSchema(schema)) {
    case 'select':
      schema.enum = data.enum
      schema[ui_options] = { ...toPlainObject(schema[ui_options]), labels: data.labels ?? [] }
      break
    case 'multiSelect':
      schema.items = { ...toPlainObject(schema.items), enum: data.enum }
      schema[ui_options] = { ...toPlainObject(schema[ui_options]), labels: data.labels ?? [] }
      break
  }
}

//#endregion
