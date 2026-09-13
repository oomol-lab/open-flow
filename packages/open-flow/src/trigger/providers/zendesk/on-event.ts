import type { ConnectorProxyRequest, ConnectorProxyResult } from '../../../connector/common/proxy.ts'
import type { JsonValue, TriggerKeySnapshot } from '../../../flow/common/change.ts'
import type { IntegrationDefinition, IntegrationReconcileContext, IntegrationStateContext } from '../../common/integration.ts'

import { IntegrationConnectionError, PermanentIntegrationError, TransientIntegrationError } from '../../common/integration.ts'
import { bytes, verifyBase64Hmac } from '../signature.ts'

const signatureToleranceMs = 5 * 60 * 1_000

const events = [
  'zen:event-type:ticket.agent_assignment_changed',
  'zen:event-type:ticket.attachment_linked_to_comment',
  'zen:event-type:ticket.attachment_redacted_from_comment',
  'zen:event-type:ticket.brand_changed',
  'zen:event-type:ticket.comment_added',
  'zen:event-type:ticket.comment_made_private',
  'zen:event-type:ticket.comment_redacted',
  'zen:event-type:ticket.created',
  'zen:event-type:ticket.csat_received',
  'zen:event-type:ticket.csat_requested',
  'zen:event-type:ticket.custom_field_changed',
  'zen:event-type:ticket.custom_status_changed',
  'zen:event-type:ticket.description_changed',
  'zen:event-type:ticket.email_ccs_changed',
  'zen:event-type:ticket.external_id_changed',
  'zen:event-type:ticket.followers_changed',
  'zen:event-type:ticket.form_changed',
  'zen:event-type:ticket.group_assignment_changed',
  'zen:event-type:ticket.marked_as_spam',
  'zen:event-type:ticket.merged',
  'zen:event-type:ticket.next_sla_breach_changed',
  'zen:event-type:ticket.ola_policy_changed',
  'zen:event-type:ticket.organization_changed',
  'zen:event-type:ticket.permanently_deleted',
  'zen:event-type:ticket.priority_changed',
  'zen:event-type:ticket.problem_link_changed',
  'zen:event-type:ticket.requester_changed',
  'zen:event-type:ticket.schedule_changed',
  'zen:event-type:ticket.sla_policy_changed',
  'zen:event-type:ticket.soft_deleted',
  'zen:event-type:ticket.status_changed',
  'zen:event-type:ticket.subject_changed',
  'zen:event-type:ticket.submitter_changed',
  'zen:event-type:ticket.tags_changed',
  'zen:event-type:ticket.task_due_at_changed',
  'zen:event-type:ticket.type_changed',
  'zen:event-type:ticket.undeleted',
  'zen:event-type:organization.created',
  'zen:event-type:organization.custom_field_changed',
  'zen:event-type:organization.deleted',
  'zen:event-type:organization.external_id_changed',
  'zen:event-type:organization.name_changed',
  'zen:event-type:organization.tags_changed',
  'zen:event-type:user.active_changed',
  'zen:event-type:user.alias_changed',
  'zen:event-type:user.created',
  'zen:event-type:user.custom_field_changed',
  'zen:event-type:user.custom_role_changed',
  'zen:event-type:user.default_group_changed',
  'zen:event-type:user.deleted',
  'zen:event-type:user.details_changed',
  'zen:event-type:user.external_id_changed',
  'zen:event-type:user.group_membership_created',
  'zen:event-type:user.group_membership_deleted',
  'zen:event-type:user.identity_changed',
  'zen:event-type:user.identity_created',
  'zen:event-type:user.identity_deleted',
  'zen:event-type:user.last_login_changed',
  'zen:event-type:user.merged',
  'zen:event-type:user.name_changed',
  'zen:event-type:user.notes_changed',
  'zen:event-type:user.only_private_comments_changed',
  'zen:event-type:user.organization_membership_created',
  'zen:event-type:user.organization_membership_deleted',
  'zen:event-type:user.password_changed',
  'zen:event-type:user.photo_changed',
  'zen:event-type:user.role_changed',
  'zen:event-type:user.suspended_changed',
  'zen:event-type:user.tags_changed',
  'zen:event-type:user.time_zone_changed',
] as const
const endpoint = '/api/v2/webhooks'

const snapshot = {
  configSchema: {
    additionalProperties: false,
    properties: { events: { items: { enum: events, type: 'string' }, minItems: 1, type: 'array', uniqueItems: true } },
    required: ['events'],
    title: 'Zendesk Event Subscription Config',
    type: 'object',
  },
  definitionVersion: 2,
  description: 'Triggers when one of the selected Zendesk account events occurs.',
  displayName: 'Event Subscription',
  endpoint: { body: { allowArray: false, allowEmpty: false, formats: ['json'] }, methods: ['POST'], successStatus: 202 },
  key: 'zendesk.on_event',
  name: 'on_event',
  payloadSchema: {
    additionalProperties: false,
    properties: { body: { type: 'object' }, deliveryId: { type: 'string' }, event: { type: 'string' }, subject: { type: 'string' } },
    required: ['event', 'deliveryId', 'body'],
    title: 'Zendesk Event Payload',
    type: 'object',
  },
  provider: 'zendesk',
  type: 'integration',
} as const satisfies TriggerKeySnapshot & { readonly type: 'integration' }

export const zendeskEvent: IntegrationDefinition = {
  initialState: { checkpoint: null, subscription: {} },
  snapshot,
  async receive(context) {
    const signingSecret = subscriptionSecret(context.state)
    const timestamp = context.header('x-zendesk-webhook-signature-timestamp')
    const signedAt = timestamp == null ? Number.NaN : Date.parse(timestamp)
    if (
      signingSecret == null ||
      timestamp == null ||
      !Number.isFinite(signedAt) ||
      Math.abs(context.now.getTime() - signedAt) > signatureToleranceMs ||
      !(await verifyBase64Hmac(signingSecret, [bytes(timestamp), context.rawBody], context.header('x-zendesk-webhook-signature')))
    ) {
      return { body: '', contentType: 'text/plain', outcome: 'respond', status: 404 }
    }
    if (context.payload == null || typeof context.payload != 'object' || Array.isArray(context.payload)) {
      return { outcome: 'ignored', reason: 'Zendesk event body is missing.' }
    }
    const payload = context.payload as Readonly<Record<string, JsonValue>>
    const event = payload.type
    if (typeof event != 'string' || event.length == 0) return { outcome: 'ignored', reason: 'Zendesk event type is missing.' }
    if (!(context.config.events as readonly string[]).includes(event)) return { outcome: 'ignored', reason: 'Zendesk event is not subscribed.' }
    const deliveryId = typeof payload.id == 'string' ? payload.id : ''
    const subject = payload.subject
    return {
      dedupeKey: deliveryId.length == 0 ? undefined : deliveryId,
      outcome: 'event',
      payload: {
        body: payload,
        deliveryId,
        event,
        ...(typeof subject == 'string' ? { subject } : {}),
      },
    }
  },
  async reconcile(context) {
    const state = requireState(context.state)
    const listed = await findByEndpoint(context)
    const known = subscriptionId(state)
    if (!context.active) {
      for (const webhookId of known == null ? listed : [...new Set([known, ...listed])]) await remove(context, webhookId)
      await state.saveSubscription({}, later(context.now))
      return { outcome: 'ready' }
    }
    let webhookId = known ?? listed[0]
    if (webhookId == null) {
      const created = await request(context, 'webhook create', { body: desired(context), endpoint, method: 'POST' })
      success(created, 'webhook create')
      webhookId = readId(record(created.data)?.webhook)
    } else {
      const aligned = await request(context, 'webhook update', {
        body: desired(context),
        endpoint: `${endpoint}/${webhookId}`,
        method: 'PUT',
      })
      if (aligned.status == 404) {
        await state.saveSubscription({}, context.now)
        return { outcome: 'pending' }
      }
      success(aligned, 'webhook update')
    }
    for (const duplicate of listed.filter((value) => value != webhookId)) await remove(context, duplicate)
    await state.saveSubscription({ signingSecret: await readSigningSecret(context, webhookId), webhookId }, later(context.now))
    return { outcome: 'ready' }
  },
}

function desired(context: IntegrationReconcileContext): Readonly<Record<string, JsonValue>> {
  return {
    webhook: {
      description: 'Managed by Open Flow. Do not edit.',
      endpoint: context.endpointUrl,
      http_method: 'POST',
      name: name(context.endpointUrl),
      request_format: 'json',
      status: 'active',
      subscriptions: [...new Set(context.config.events as readonly string[])],
    },
  }
}

async function findByEndpoint(context: IntegrationReconcileContext): Promise<readonly string[]> {
  const matches: string[] = []
  let after: string | undefined
  for (let page = 0; page < 10; page += 1) {
    const result = await request(context, 'webhook list', {
      endpoint,
      method: 'GET',
      query: {
        'filter[name_contains]': name(context.endpointUrl),
        'page[size]': '100',
        ...(after == null ? {} : { 'page[after]': after }),
      },
    })
    success(result, 'webhook list')
    const listing = record(result.data)
    const webhooks = Array.isArray(listing?.webhooks) ? listing.webhooks : []
    for (const item of webhooks) {
      const value = record(item)
      if (value?.endpoint === context.endpointUrl && typeof value.id == 'string') matches.push(value.id)
    }
    const meta = record(listing?.meta)
    if (meta?.has_more !== true || typeof meta.after_cursor != 'string') return matches
    after = meta.after_cursor
  }
  return matches
}

async function remove(context: IntegrationReconcileContext, webhookId: string): Promise<void> {
  const result = await request(context, 'webhook delete', { endpoint: `${endpoint}/${webhookId}`, method: 'DELETE' })
  if (result.status != 404) success(result, 'webhook delete')
}

async function request(context: IntegrationReconcileContext, operation: string, value: ConnectorProxyRequest): Promise<ConnectorProxyResult> {
  try {
    return await context.connector.execute(value, context.signal)
  } catch (cause) {
    if (cause instanceof IntegrationConnectionError) throw cause
    throw new TransientIntegrationError(`Zendesk ${operation} request failed.`, { cause })
  }
}

function success(result: ConnectorProxyResult, operation: string): void {
  if (result.status >= 200 && result.status < 300) return
  if (result.status == 401 || result.status == 403) throw new IntegrationConnectionError(`Zendesk ${operation} rejected the Connection.`)
  if ([400, 404, 422].includes(result.status)) throw new PermanentIntegrationError(`Zendesk ${operation} rejected the subscription.`)
  throw new TransientIntegrationError(`Zendesk ${operation} failed with status ${result.status}.`)
}

function name(url: string): string {
  return `open-flow-${url.slice(url.lastIndexOf('/') + 1)}`
}

function readId(value: unknown): string {
  const webhookId = record(value)?.id
  if (typeof webhookId != 'string') throw new TransientIntegrationError('Zendesk webhook response is missing its ID.')
  return webhookId
}

function requireState(value: IntegrationStateContext | undefined): IntegrationStateContext {
  if (value == null) throw new PermanentIntegrationError('Zendesk Integration state is missing.')
  return value
}

function subscriptionId(state: IntegrationStateContext): string | null {
  const value = state.subscription.webhookId
  return typeof value == 'string' && value.length > 0 ? value : null
}

function subscriptionSecret(state: IntegrationStateContext | undefined): string | null {
  const value = state?.subscription.signingSecret
  return typeof value == 'string' && value.length > 0 ? value : null
}

async function readSigningSecret(context: IntegrationReconcileContext, webhookId: string): Promise<string> {
  const result = await request(context, 'webhook signing secret', { endpoint: `${endpoint}/${webhookId}/signing_secret`, method: 'GET' })
  success(result, 'webhook signing secret')
  const secret = record(record(result.data)?.signing_secret)?.secret
  if (typeof secret != 'string' || secret.length == 0) throw new TransientIntegrationError('Zendesk webhook signing secret response is invalid.')
  return secret
}

function later(now: Date): Date {
  return new Date(now.getTime() + 30 * 24 * 60 * 60 * 1_000)
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value != null && typeof value == 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
}
