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

const webhookArtifactInputs: readonly InputPort[] = [
  { handle: 'body', jsonSchema: { contentMediaType: 'oomol/artifact' }, nullable: false },
  ...webhookResponseInputs.slice(1),
]

/** Artifact mode requires a Run Artifact as `body`; the default accepts any JSON. */
export function webhookResponseInputPorts(node: { readonly bodyFormat?: 'artifact' }): readonly InputPort[] {
  return node.bodyFormat === 'artifact' ? webhookArtifactInputs : webhookResponseInputs
}

/**
 * The response a Run selected. An `artifactId` response carries no inline body: the host sends the bytes of that Run
 * Artifact with its stored media type, or fails when the Run does not own it.
 */
export interface WebhookResponseSnapshot {
  readonly artifactId?: string
  readonly body: string
  readonly contentType: string
  readonly status: number
  readonly headers: Readonly<Record<string, string>>
}

/** The Artifact identity of a JSON value shaped as an ArtifactRef. */
export function webhookArtifactId(value: unknown): string | undefined {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return
  const record = value as Readonly<Record<string, unknown>>
  return record.kind === 'artifact' && typeof record.id === 'string' && record.id.length > 0 ? record.id : undefined
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
