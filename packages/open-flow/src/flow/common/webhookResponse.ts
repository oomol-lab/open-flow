import type { InputPort, JsonValue, Port, PortDefinition } from './model.ts'

import { httpHeaderNameIssue } from '../../http/common/headers.ts'

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

/** Fixed inputs belong to the node, not author-supplied definitions. */
export const webhookResponseInputs: readonly InputPort[] = [
  { handle: 'body', jsonSchema: {}, nullable: true, value: '' },
  { handle: 'statusCode', jsonSchema: { type: 'number' }, nullable: false, value: 200 },
  { handle: 'headers', jsonSchema: webhookHeadersPort.jsonSchema, nullable: false, value: {} },
]

export interface WebhookResponseSnapshot {
  readonly body: string
  readonly contentType: string
  readonly status: number
  readonly headers: Readonly<Record<string, string>>
}

export function validWebhookStatus(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 200 && value <= 599 && webhookResponseAllowsBody(value)
}

/** Portable validation also runs in the isolated engine, which has no HTTP globals. */
export function webhookHeaderValues(source: unknown): Readonly<Record<string, string>> | undefined {
  if (source == null || typeof source !== 'object' || Array.isArray(source)) return
  const headers: Record<string, string> = {}
  const names: string[] = []
  for (const [name, value] of Object.entries(source)) {
    if (httpHeaderNameIssue(name, names) != null) return
    if (typeof value !== 'string' && typeof value !== 'boolean' && !(typeof value === 'number' && Number.isFinite(value))) return
    const text = String(value)
    if ([...text].some((character) => character.charCodeAt(0) > 255 || /[\0\r\n]/.test(character))) return
    names.push(name)
    Object.defineProperty(headers, name, { value: text, enumerable: true, configurable: true })
  }
  return headers
}

export function encodeWebhookBody(value: JsonValue): Pick<WebhookResponseSnapshot, 'body' | 'contentType'> {
  return typeof value === 'string' ? { body: value, contentType: 'text/plain;charset=UTF-8' } : { body: JSON.stringify(value), contentType: 'application/json' }
}
