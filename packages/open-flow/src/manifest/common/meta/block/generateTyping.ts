import type { InputHandleDef, OutputHandleDef } from '../../../../schema/index.ts'

export type TypingLanguage = 'typescript' | 'javascript'

const generatedMetaStart = '//#region generated meta'
const generatedMetaEnd = '//#endregion'

export function mergeTypingIntoSourceFile(contents: string, typing: string): string {
  const start = contents.indexOf(generatedMetaStart)
  if (start < 0) return contents
  const beforeEnd = contents.indexOf(`\n${generatedMetaEnd}`, start)
  if (beforeEnd < 0) return contents
  let end = contents.indexOf('\n', beforeEnd + 1)
  if (end < 0) end = contents.length
  return `${contents.slice(0, start)}${generatedMetaStart}\n${typing}${generatedMetaEnd}${contents.slice(end)}`
}

export function generateTyping(
  language: TypingLanguage,
  inputsDef: readonly (Omit<InputHandleDef, 'handle'> & { readonly handle: string })[] | undefined,
  outputsDef: readonly (Omit<OutputHandleDef, 'handle'> & { readonly handle: string })[] | undefined,
): string {
  if (language === 'typescript') {
    return genTypeScript(inputsDef, outputsDef) + '\n'
  } else {
    return genJavaScript(inputsDef, outputsDef) + '\n'
  }
}

const knownWidgetTypes = new Set<string>(['color', 'text'])

const quote = (s: string): string => (s.includes(' | ') ? `(${s})` : s)

function containsArtifact(schema: any): boolean {
  if (!schema || typeof schema !== 'object') return false
  if (schema.contentMediaType === 'oomol/artifact') return true
  if (Array.isArray(schema.anyOf)) return schema.anyOf.some(containsArtifact)
  if (schema.type === 'object') return Object.values(schema.properties || {}).some(containsArtifact)
  if (schema.type === 'array') return containsArtifact(schema.items)
  return false
}

function defsContainArtifact(
  inputsDef: readonly (Omit<InputHandleDef, 'handle'> & { readonly handle: string })[],
  outputsDef: readonly (Omit<OutputHandleDef, 'handle'> & { readonly handle: string })[],
): boolean {
  return [...inputsDef, ...outputsDef].some((def) => containsArtifact(def.json_schema))
}

function genTypeScript(
  inputsDef: readonly (Omit<InputHandleDef, 'handle'> & { readonly handle: string })[] | undefined = [],
  outputsDef: readonly (Omit<OutputHandleDef, 'handle'> & { readonly handle: string })[] | undefined = [],
): string {
  const out = ['type Inputs = {']
  for (const def of inputsDef) {
    out.push(`  ${def.handle}: ${typescriptOf(def.json_schema, def.nullable)};`)
  }
  out.push('};')
  out.push('type Outputs = {')
  for (const def of outputsDef) {
    out.push(`  ${def.handle}: ${typescriptOf(def.json_schema, def.nullable)};`)
  }
  out.push('};')
  if (defsContainArtifact(inputsDef, outputsDef)) {
    out.unshift("import type { ArtifactRef } from '@oomol-lab/open-flow'", '')
  }
  return out.join('\n')
}

function genJavaScript(
  inputsDef: readonly (Omit<InputHandleDef, 'handle'> & { readonly handle: string })[] | undefined = [],
  outputsDef: readonly (Omit<OutputHandleDef, 'handle'> & { readonly handle: string })[] | undefined = [],
): string {
  const out = ['@typedef {{']
  for (const def of inputsDef) {
    out.push(`  ${def.handle}: ${typescriptOf(def.json_schema, def.nullable)};`)
  }
  out.push('}} Inputs;')
  out.push('@typedef {{')
  for (const def of outputsDef) {
    out.push(`  ${def.handle}: ${typescriptOf(def.json_schema, def.nullable)};`)
  }
  out.push('}} Outputs;')
  if (defsContainArtifact(inputsDef, outputsDef)) {
    out.unshift('@import { ArtifactRef } from "@oomol-lab/open-flow"')
  }
  const out2 = out.map((line) => ` * ${line}`)
  out2.unshift('/**')
  out2.push(' */')
  return out2.join('\n')
}

export function typescriptOf(schema: any, nullable: boolean | undefined): string {
  if (!schema) return 'any'

  switch (schema.contentMediaType) {
    case 'oomol/bin':
      return nullable ? 'Uint8Array | null' : 'Uint8Array'
    case 'oomol/artifact':
      return nullable ? 'ArtifactRef | null' : 'ArtifactRef'
  }

  // color, text, dir, file, save => All string
  if (knownWidgetTypes.has(schema['ui:widget'])) {
    return nullable ? 'string | null' : 'string'
  }

  if (Array.isArray(schema.anyOf)) {
    const a = nullable ? schema.anyOf.concat({ type: 'null' }) : schema.anyOf
    return union(a.map((s: any) => quote(typescriptOf(s, false)))) || 'any'
  }

  if (Array.isArray(schema.enum)) {
    const a = nullable ? schema.enum.concat(null) : schema.enum
    return union(a.map((s: string) => JSON.stringify(s))) || 'any'
  }

  switch (schema.type) {
    case 'null':
      return 'null'
    case 'boolean':
      return nullable ? 'boolean | null' : 'boolean'
    case 'integer':
    case 'number':
      return nullable ? 'number | null' : 'number'
    case 'string':
      return nullable ? 'string | null' : 'string'
    case 'object': {
      const keys = Object.keys(schema.properties || {})
      if (keys.length === 0) return 'Record<string, any>'
      const r = Array.isArray(schema?.required) ? new Set(schema.required) : undefined
      const s = `{ ${keys.map((k) => `${k}${r && !r.has(k) ? '?' : ''}: ${typescriptOf(schema.properties[k], false)}`).join('; ')} }`
      return nullable ? `${s} | null` : s
    }
    case 'array': {
      if (schema.uniqueItems && Array.isArray(schema.items?.enum)) {
        const s = `${quote(typescriptOf(schema.items, false))}[]`
        return nullable ? `${s} | null` : s
      } else {
        const s = `${quote(typescriptOf(schema.items, false))}[]`
        return nullable ? `${s} | null` : s
      }
    }
    default:
      return 'any'
  }
}

function union(types: string[]): string {
  const unique = Array.from(new Set(types.filter((x) => !!x)))
  if (unique.length === 0 || unique.includes('any')) {
    return 'any'
  }
  return unique.join(' | ')
}
