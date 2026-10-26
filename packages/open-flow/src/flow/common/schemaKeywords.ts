import type { JsonValue } from '../../types/index.ts'

export type SchemaKeyword =
  | 'const'
  | 'enum'
  | 'exclusiveMaximum'
  | 'exclusiveMinimum'
  | 'maximum'
  | 'maxItems'
  | 'maxLength'
  | 'maxProperties'
  | 'minimum'
  | 'minItems'
  | 'minLength'
  | 'minProperties'
  | 'multipleOf'
  | 'pattern'
  | 'required'
  | 'type'

export type SchemaMismatch =
  | { readonly kind: 'artifact' | 'binary' | 'nullable' }
  | {
      readonly kind: 'keyword'
      readonly keyword: SchemaKeyword
      readonly path: readonly (string | number)[]
      readonly source: JsonValue | undefined
      readonly target: JsonValue | undefined
    }
  | { readonly kind: 'schema'; readonly path?: readonly (string | number)[] }

const schemaKeywords: ReadonlySet<string> = new Set<SchemaKeyword>([
  'const',
  'enum',
  'exclusiveMaximum',
  'exclusiveMinimum',
  'maximum',
  'maxItems',
  'maxLength',
  'maxProperties',
  'minimum',
  'minItems',
  'minLength',
  'minProperties',
  'multipleOf',
  'pattern',
  'required',
  'type',
])

export function isSchemaKeyword(value: string): value is SchemaKeyword {
  return schemaKeywords.has(value)
}
