import type { TFunction } from 'val-i18n'
import type { JsonValue } from '../../../../flow/common/change.ts'
import type { SchemaMismatch } from '../../../../flow/common/schema.ts'

function schemaPath(path: readonly (string | number)[]): string | undefined {
  const parts: string[] = []
  for (let index = 0; index < path.length; index++) {
    if (path[index] == 'properties' && typeof path[index + 1] == 'string') parts.push(String(path[++index]))
    else if (path[index] == 'items') parts.push('[]')
  }
  return parts.join('.').replaceAll('.[]', '[]') || undefined
}

function schemaType(value: JsonValue | undefined, t: TFunction): string {
  const types = (Array.isArray(value) ? value : [value]).filter((item): item is string => typeof item == 'string')
  if (types.length == 0) return t('inspector.sources.unknownType')
  return types.map((type) => (type == 'integer' ? t('inspector.sources.integer') : t(`valueEditor.${type}`))).join(t('inspector.sources.typeSeparator'))
}

function displayValue(value: JsonValue | undefined): string {
  const text = JSON.stringify(value)
  return text == null ? '' : text.length <= 80 ? text : `${text.slice(0, 77)}…`
}

export function schemaMismatchMessage(mismatch: SchemaMismatch, t: TFunction): string {
  switch (mismatch.kind) {
    case 'artifact':
      return t('inspector.sources.artifactIncompatible')
    case 'binary':
      return t('inspector.sources.binaryIncompatible')
    case 'nullable':
      return t('inspector.sources.nullableIncompatible')
    case 'schema': {
      const path = schemaPath(mismatch.path ?? [])
      return path == null ? t('inspector.sources.schemaIncompatible') : t('inspector.sources.schemaPathIncompatible', { path })
    }
    case 'keyword': {
      const path = schemaPath(mismatch.path)
      const subject = path == null ? '' : t('inspector.sources.constraintSubject', { path })
      switch (mismatch.keyword) {
        case 'type':
          return t(path == null ? 'inspector.sources.typeIncompatible' : 'inspector.sources.propertyTypeIncompatible', {
            path,
            source: schemaType(mismatch.source, t),
            target: schemaType(mismatch.target, t),
          })
        case 'required': {
          const source = new Set(Array.isArray(mismatch.source) ? mismatch.source : [])
          const property = (Array.isArray(mismatch.target) ? mismatch.target : []).find((item) => typeof item == 'string' && !source.has(item))
          return property == null ? t('inspector.sources.schemaIncompatible') : t('inspector.sources.requiredIncompatible', { property })
        }
        case 'enum': {
          const accepted = new Set((Array.isArray(mismatch.target) ? mismatch.target : []).map((value) => JSON.stringify(value)))
          const values = (Array.isArray(mismatch.source) ? mismatch.source : []).filter((item) => !accepted.has(JSON.stringify(item))).slice(0, 3)
          return values.length == 0
            ? t('inspector.sources.schemaIncompatible')
            : t('inspector.sources.enumIncompatible', { values: values.map(displayValue).join(', ') })
        }
        case 'const':
          return t('inspector.sources.constIncompatible', { source: displayValue(mismatch.source), target: displayValue(mismatch.target) })
        default:
          return t(`inspector.sources.${mismatch.keyword}`, { subject, value: displayValue(mismatch.target) })
      }
    }
  }
}
