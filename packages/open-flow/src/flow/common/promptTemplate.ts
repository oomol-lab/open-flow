import type { JsonValue } from './change.ts'

export const promptReferencePattern = /\{\{\s*([^{}\s]+)\s*\}\}/g

export function renderPrompt(template: string, input: Readonly<Record<string, JsonValue>>): string {
  return template.replace(promptReferencePattern, (match, name: string) => {
    if (!Object.hasOwn(input, name)) return match
    const value = input[name]!
    return typeof value == 'string' ? value : JSON.stringify(value)
  })
}

export function renamePromptInput(template: string, before: string, after: string): string {
  return template.replace(promptReferencePattern, (match, name: string) => (name == before ? '{{' + after + '}}' : match))
}
