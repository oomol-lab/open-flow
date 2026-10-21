import { z } from 'zod'

const id = z.string().min(1).max(256)
const eventType = z.string().regex(/^[a-z][a-z0-9_.:]{0,127}$/)
const name = z.string().trim().min(1).max(128)

const eventSourceSchema = z.object({
  version: z.literal(1),
  sourceId: id,
  revision: z.int().positive(),
  name,
  provider: z.enum(['feishu', 'feishu_app_bot', 'slackbot', 'intercom', 'sentry', 'zoom', 'fireflies', 'jira']),
  appId: id,
  workspaceId: id.optional(),
  installationId: id.optional(),
  organizationId: id.optional(),
  projectId: id.optional(),
  projectKey: id.optional(),
  subscriptionStatus: z.enum(['idle', 'pending', 'ready', 'error']).optional(),
  lastError: z.string().optional(),
  signingSecretConfigured: z.boolean().optional(),
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
  consumers: z.array(z.object({ flowId: id, flowName: z.string(), triggerNodeId: id })),
})

export const eventSourceViewSchema = eventSourceSchema.pick({
  appId: true,
  workspaceId: true,
  installationId: true,
  organizationId: true,
  projectId: true,
  projectKey: true,
  subscriptionStatus: true,
  lastError: true,
  signingSecretConfigured: true,
  manageSubscriptions: true,
  verificationTokenConfigured: true,
  encryptKeyConfigured: true,
  verifiedAt: true,
})

export interface CreateFeishuEventSource {
  readonly kind?: 'feishu'
  readonly version: 1
  readonly name: string
  readonly connectionId: string
  readonly teamId: string | null
  readonly verificationToken: string
  readonly encryptKey: string
  readonly eventTypes: string[]
  readonly manageSubscriptions: boolean
}

export interface CreateSlackEventSource {
  readonly kind: 'slack'
  readonly version: 1
  readonly name: string
  readonly connectionId: string
  readonly teamId: string | null
  readonly appId: string
  readonly workspaceId: string
  readonly signingSecret: string
  readonly eventTypes: string[]
}

export interface CreateIntercomEventSource {
  readonly kind: 'intercom'
  readonly version: 1
  readonly name: string
  readonly connectionId: string
  readonly teamId: string | null
  readonly appId: string
  readonly signingSecret: string
  readonly eventTypes: string[]
}

export interface CreateSentryEventSource {
  readonly kind: 'sentry'
  readonly version: 1
  readonly name: string
  readonly connectionId: string
  readonly teamId: string | null
  readonly appId: string
  readonly installationId: string
  readonly organizationId: string
  readonly signingSecret: string
  readonly eventTypes: string[]
}

export interface CreateZoomEventSource {
  readonly kind: 'zoom'
  readonly version: 1
  readonly name: string
  readonly connectionId: string
  readonly teamId: string | null
  readonly appId: string
  readonly signingSecret: string
  readonly eventTypes: string[]
}

export interface CreateFirefliesEventSource {
  readonly kind: 'fireflies'
  readonly version: 1
  readonly name: string
  readonly connectionId: string
  readonly teamId: string | null
  readonly signingSecret: string
  readonly eventTypes: string[]
}

export interface CreateJiraEventSource {
  readonly kind: 'jira'
  readonly version: 1
  readonly name: string
  readonly connectionId: string
  readonly teamId: string | null
  readonly project: string
  readonly eventTypes: string[]
}

export type CreateEventSource =
  | CreateFeishuEventSource
  | CreateSlackEventSource
  | CreateIntercomEventSource
  | CreateSentryEventSource
  | CreateZoomEventSource
  | CreateFirefliesEventSource
  | CreateJiraEventSource

export interface UpdateEventSource {
  readonly signingSecret?: string
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
  readonly provider: 'feishu' | 'feishu_app_bot' | 'slackbot' | 'intercom' | 'sentry' | 'zoom' | 'fireflies' | 'jira'
  readonly appId: string
  readonly workspaceId?: string
  readonly installationId?: string
  readonly organizationId?: string
  readonly projectId?: string
  readonly projectKey?: string
  readonly subscriptionStatus?: 'idle' | 'pending' | 'ready' | 'error'
  readonly lastError?: string
  readonly signingSecretConfigured?: boolean
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
  return z.object({ version: z.literal(1), sources: z.array(eventSourceSchema), teamId: id.nullable().optional() }).parse(value)
}
