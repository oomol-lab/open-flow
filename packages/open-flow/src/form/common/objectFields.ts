import { objectValue } from './value.ts'

export function objectFieldNames(schema: unknown, value?: unknown): string[] {
  const source = objectValue(schema) ?? {}
  const properties = objectValue(source.properties) ?? {}
  const available = [...new Set([...Object.keys(properties), ...Object.keys(objectValue(value) ?? {})])]
  const order = Array.isArray(source['ui:order']) ? source['ui:order'].filter((key): key is string => typeof key === 'string' && available.includes(key)) : []
  return [...new Set([...order, ...available])]
}

export function renameFieldDefinition(schema: unknown, name: string, next: string) {
  const source = objectValue(schema) ?? {}
  const properties = objectValue(source.properties) ?? {}
  if (!next || (next !== name && Object.hasOwn(properties, next))) return undefined
  return {
    ...source,
    properties: Object.fromEntries(Object.entries(properties).map(([key, value]) => [key === name ? next : key, value])),
    ...(Array.isArray(source['ui:order']) ? { 'ui:order': source['ui:order'].map((key) => (key === name ? next : key)) } : {}),
    ...(Array.isArray(source.required) ? { required: source.required.map((key) => (key === name ? next : key)) } : {}),
  }
}
export function removeFieldDefinition(schema: unknown, name: string) {
  const source = objectValue(schema) ?? {}
  return {
    ...source,
    properties: Object.fromEntries(Object.entries(objectValue(source.properties) ?? {}).filter(([key]) => key !== name)),
    ...(Array.isArray(source['ui:order']) ? { 'ui:order': source['ui:order'].filter((key) => key !== name) } : {}),
    ...(Array.isArray(source.required) ? { required: source.required.filter((key) => key !== name) } : {}),
  }
}
