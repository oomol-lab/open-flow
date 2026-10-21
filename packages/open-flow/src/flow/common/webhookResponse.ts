import type { Port, PortDefinition } from './change.ts'

export const webhookResponseTimeout = {
  defaultMs: 30_000,
  minMs: 1000,
  maxMs: 60_000,
} as const

export const webhookStatusCodePort = { jsonSchema: { type: 'number' }, nullable: true } as const

export function webhookResponseAllowsBody(status: number): boolean {
  return status !== 204 && status !== 205 && status !== 304
}

export const webhookHeaderValuePort = { jsonSchema: { type: ['string', 'number', 'boolean'] }, nullable: true } as const
export const webhookHeadersPort = {
  jsonSchema: { type: 'object', additionalProperties: { type: ['string', 'number', 'boolean'] } },
  nullable: true,
} as const

export function workflowOutputsPort(outputs: readonly Port[]): PortDefinition {
  return {
    jsonSchema: {
      type: 'object',
      properties: Object.fromEntries(outputs.map((port) => [port.handle, port.jsonSchema])),
      additionalProperties: false,
      required: outputs.map((port) => port.handle),
    },
    nullable: false,
  } as const
}

/** Header names are case-insensitive; never silently combine duplicate business fields. */
export function webhookHeaderNameIssue(name: string, names: readonly string[]): 'invalid' | 'duplicate' | undefined {
  if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)) return 'invalid'
  if (names.some((candidate) => candidate.toLowerCase() === name.toLowerCase())) return 'duplicate'
}
