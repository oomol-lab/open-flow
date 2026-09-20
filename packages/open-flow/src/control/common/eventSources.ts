import { z } from 'zod'

const id = z.string().min(1).max(256)
const eventType = z.string().regex(/^[a-z][a-z0-9_.]{0,127}$/)
const name = z.string().trim().min(1).max(128)

const eventSourceSchema = z.strictObject({
  version: z.literal(1),
  sourceId: id,
  revision: z.int().positive(),
  name,
  provider: z.enum(['feishu', 'feishu_app_bot']),
  appId: id,
  connectionId: id,
  teamId: id.nullable(),
  enabled: z.boolean(),
  eventTypes: z.array(eventType),
  manageSubscriptions: z.boolean(),
  verificationTokenConfigured: z.boolean(),
  encryptKeyConfigured: z.boolean(),
  endpointUrl: z.string().nullable(),
  verifiedAt: z.string().nullable(),
  lastReceivedAt: z.string().nullable(),
  updatedAt: z.string(),
  consumers: z.array(z.strictObject({ flowId: id, flowName: z.string(), triggerNodeId: id })),
})

export interface CreateEventSource {
  readonly version: 1
  readonly name: string
  readonly connectionId: string
  readonly teamId: string | null
  readonly verificationToken: string
  readonly encryptKey: string
  readonly eventTypes: string[]
  readonly manageSubscriptions: boolean
}

export interface UpdateEventSource {
  readonly version: 1
  readonly expectedRevision: number
  readonly name: string
  readonly enabled: boolean
  readonly eventTypes: string[]
  readonly verificationToken?: string
  readonly encryptKey?: string
}

export interface EventSource {
  readonly version: 1
  readonly sourceId: string
  readonly revision: number
  readonly name: string
  readonly provider: 'feishu' | 'feishu_app_bot'
  readonly appId: string
  readonly connectionId: string
  readonly teamId: string | null
  readonly enabled: boolean
  readonly eventTypes: string[]
  readonly manageSubscriptions: boolean
  readonly verificationTokenConfigured: boolean
  readonly encryptKeyConfigured: boolean
  readonly endpointUrl: string | null
  readonly verifiedAt: string | null
  readonly lastReceivedAt: string | null
  readonly updatedAt: string
  readonly consumers: { flowId: string; flowName: string; triggerNodeId: string }[]
}

export function decodeEventSource(value: unknown): EventSource {
  return eventSourceSchema.parse(value)
}

export function decodeEventSources(value: unknown): { readonly version: 1; readonly sources: readonly EventSource[]; readonly teamId?: string | null } {
  return z.strictObject({ version: z.literal(1), sources: z.array(eventSourceSchema), teamId: id.nullable().optional() }).parse(value)
}
