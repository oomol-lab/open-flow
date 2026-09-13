import type { ConnectorProxyRequest, ConnectorProxyResult } from '../../../connector/common/proxy.ts'
import type { JsonValue, TriggerKeySnapshot } from '../../../flow/common/change.ts'
import type { IntegrationDefinition, IntegrationReconcileContext, IntegrationStateContext } from '../../common/integration.ts'

import { IntegrationConnectionError, PermanentIntegrationError, TransientIntegrationError } from '../../common/integration.ts'
import { sameSecret } from '../signature.ts'

const topics = [
  'app/scopes_update',
  'app/uninstalled',
  'app_purchases_one_time/update',
  'app_subscriptions/approaching_capped_amount',
  'app_subscriptions/update',
  'bulk_operations/finish',
  'carts/create',
  'carts/update',
  'channels/delete',
  'checkout_and_accounts_configurations/update',
  'checkouts/create',
  'checkouts/delete',
  'checkouts/update',
  'collection_listings/add',
  'collection_listings/remove',
  'collection_listings/update',
  'collection_publications/create',
  'collection_publications/delete',
  'collection_publications/update',
  'collections/create',
  'collections/delete',
  'collections/update',
  'companies/create',
  'companies/delete',
  'companies/update',
  'company_contact_roles/assign',
  'company_contact_roles/revoke',
  'company_contacts/create',
  'company_contacts/delete',
  'company_contacts/update',
  'company_locations/create',
  'company_locations/delete',
  'company_locations/update',
  'customer.joined_segment',
  'customer.left_segment',
  'customer.tags_added',
  'customer.tags_removed',
  'customer_account_settings/update',
  'customer_groups/create',
  'customer_groups/delete',
  'customer_groups/update',
  'customers/create',
  'customers/delete',
  'customers/disable',
  'customers/enable',
  'customers/purchasing_summary',
  'customers/update',
  'customers_email_marketing_consent/update',
  'customers_marketing_consent/update',
  'delivery_promise_settings/update',
  'disputes/create',
  'disputes/update',
  'domains/create',
  'domains/destroy',
  'domains/update',
  'draft_orders/create',
  'draft_orders/delete',
  'draft_orders/update',
  'fulfillment_events/create',
  'fulfillment_events/delete',
  'fulfillment_holds/added',
  'fulfillment_holds/released',
  'fulfillment_orders/cancellation_request_accepted',
  'fulfillment_orders/cancellation_request_rejected',
  'fulfillment_orders/cancellation_request_submitted',
  'fulfillment_orders/cancelled',
  'fulfillment_orders/fulfillment_request_accepted',
  'fulfillment_orders/fulfillment_request_rejected',
  'fulfillment_orders/fulfillment_request_submitted',
  'fulfillment_orders/fulfillment_service_failed_to_complete',
  'fulfillment_orders/hold_released',
  'fulfillment_orders/line_items_prepared_for_local_delivery',
  'fulfillment_orders/line_items_prepared_for_pickup',
  'fulfillment_orders/manually_reported_progress_stopped',
  'fulfillment_orders/merged',
  'fulfillment_orders/moved',
  'fulfillment_orders/order_routing_complete',
  'fulfillment_orders/placed_on_hold',
  'fulfillment_orders/progress_reported',
  'fulfillment_orders/rescheduled',
  'fulfillment_orders/scheduled_fulfillment_order_ready',
  'fulfillment_orders/split',
  'fulfillments/create',
  'fulfillments/update',
  'inventory_items/create',
  'inventory_items/delete',
  'inventory_items/update',
  'inventory_levels/connect',
  'inventory_levels/disconnect',
  'inventory_levels/update',
  'locales/create',
  'locales/destroy',
  'locales/update',
  'locations/activate',
  'locations/create',
  'locations/deactivate',
  'locations/delete',
  'locations/update',
  'machine_translation_batch/completed',
  'metafield_definitions/create',
  'metafield_definitions/delete',
  'metafield_definitions/update',
  'order_transactions/create',
  'orders/cancelled',
  'orders/create',
  'orders/delete',
  'orders/edited',
  'orders/fulfilled',
  'orders/link_requested',
  'orders/paid',
  'orders/partially_fulfilled',
  'orders/risk_assessment_changed',
  'orders/shopify_protect_eligibility_changed',
  'orders/updated',
  'payment_schedules/due',
  'payment_terms/create',
  'payment_terms/delete',
  'payment_terms/update',
  'product_feeds/create',
  'product_feeds/full_sync',
  'product_feeds/full_sync_finish',
  'product_feeds/incremental_sync',
  'product_feeds/update',
  'product_listings/add',
  'product_listings/remove',
  'product_listings/update',
  'product_publications/create',
  'product_publications/delete',
  'product_publications/update',
  'products/create',
  'products/delete',
  'products/update',
  'profiles/create',
  'profiles/delete',
  'profiles/update',
  'publications/delete',
  'refunds/create',
  'returns/approve',
  'returns/cancel',
  'returns/close',
  'returns/decline',
  'returns/process',
  'returns/reopen',
  'returns/request',
  'returns/update',
  'reverse_deliveries/attach_deliverable',
  'reverse_fulfillment_orders/dispose',
  'scheduled_product_listings/add',
  'scheduled_product_listings/remove',
  'scheduled_product_listings/update',
  'segments/create',
  'segments/delete',
  'segments/update',
  'selling_plan_groups/create',
  'selling_plan_groups/delete',
  'selling_plan_groups/update',
  'shop/update',
  'subscription_billing_attempts/challenged',
  'subscription_billing_attempts/failure',
  'subscription_billing_attempts/success',
  'subscription_billing_cycle_edits/create',
  'subscription_billing_cycle_edits/delete',
  'subscription_billing_cycle_edits/update',
  'subscription_billing_cycles/skip',
  'subscription_billing_cycles/unskip',
  'subscription_contracts/activate',
  'subscription_contracts/cancel',
  'subscription_contracts/create',
  'subscription_contracts/expire',
  'subscription_contracts/fail',
  'subscription_contracts/pause',
  'subscription_contracts/update',
  'tax_partners/update',
  'tax_summaries/create',
  'tender_transactions/create',
  'themes/create',
  'themes/delete',
  'themes/publish',
  'themes/update',
  'variants/in_stock',
  'variants/out_of_stock',
] as const

const snapshot = {
  configSchema: {
    additionalProperties: false,
    properties: { topics: { items: { enum: topics, type: 'string' }, maxItems: 20, minItems: 1, type: 'array', uniqueItems: true } },
    required: ['topics'],
    title: 'Shopify Store Event Config',
    type: 'object',
  },
  definitionVersion: 2,
  description: 'Triggers when selected Shopify webhook topics occur in the connected store.',
  displayName: 'Store Event',
  endpoint: { body: { allowArray: false, allowEmpty: false, formats: ['json'] }, methods: ['POST'], successStatus: 202 },
  key: 'shopify.on_shop_event',
  name: 'on_shop_event',
  payloadSchema: {
    additionalProperties: false,
    properties: {
      apiVersion: { type: 'string' },
      body: { type: 'object' },
      eventId: { type: 'string' },
      shopDomain: { type: 'string' },
      topic: { type: 'string' },
      triggeredAt: { type: 'string' },
      webhookId: { type: 'string' },
    },
    required: ['topic', 'webhookId', 'eventId', 'shopDomain', 'apiVersion', 'triggeredAt', 'body'],
    title: 'Shopify Store Event Payload',
    type: 'object',
  },
  provider: 'shopify',
  type: 'integration',
} as const satisfies TriggerKeySnapshot & { readonly type: 'integration' }

export const shopifyShopEvent: IntegrationDefinition = {
  initialState: { checkpoint: null, subscription: {} },
  snapshot,
  receive(context) {
    if (!sameSecret(context.query('open_flow_callback'), context.callbackSecret)) {
      return { body: '', contentType: 'text/plain', outcome: 'respond', status: 404 }
    }
    const topic = context.header('x-shopify-topic')?.trim()
    if (!topic) return { outcome: 'ignored', reason: 'Shopify topic header is missing.' }
    if (!configuredTopics(context.config).includes(topic)) return { outcome: 'ignored', reason: 'Shopify topic is not subscribed.' }
    const webhookId = context.header('x-shopify-webhook-id') ?? ''
    return {
      dedupeKey: webhookId.length == 0 ? undefined : webhookId,
      outcome: 'event',
      payload: {
        apiVersion: context.header('x-shopify-api-version') ?? '',
        body: context.payload as Readonly<Record<string, JsonValue>>,
        eventId: context.header('x-shopify-event-id') ?? '',
        shopDomain: context.header('x-shopify-shop-domain') ?? '',
        topic,
        triggeredAt: context.header('x-shopify-triggered-at') ?? '',
        webhookId,
      },
    }
  },
  async reconcile(context) {
    const state = requireState(context.state)
    const subscriptions = await list(context)
    if (subscriptions == null) {
      if (!context.active) return { outcome: 'ready' }
      throw new PermanentIntegrationError('The Shopify store or webhook resource is unavailable.')
    }
    if (!context.active) {
      for (const id of subscriptions.values()) await remove(context, id)
      await state.saveSubscription({}, later(context.now))
      return { outcome: 'ready' }
    }
    const wanted = configuredTopics(context.config)
    const ids: string[] = []
    const created: string[] = []
    try {
      for (const topic of wanted) {
        const existing = subscriptions.get(topic)
        if (existing != null) ids.push(existing)
        else {
          const subscription = await create(context, topic)
          ids.push(subscription.id)
          if (subscription.created) created.push(subscription.id)
        }
      }
    } catch (cause) {
      await Promise.allSettled(created.map((id) => remove(context, id)))
      throw cause
    }
    for (const [topic, id] of subscriptions) if (!wanted.includes(topic)) await remove(context, id)
    await state.saveSubscription({ webhookIds: ids }, later(context.now))
    return { outcome: 'ready' }
  },
}

function configuredTopics(value: Readonly<Record<string, JsonValue>>): readonly string[] {
  return [...new Set(value.topics as readonly string[])]
}

async function create(context: IntegrationReconcileContext, topic: string): Promise<{ readonly created: boolean; readonly id: string }> {
  const address = callbackUrl(context)
  const result = await request(context, 'subscription create', {
    body: { webhook: { address, format: 'json', topic } },
    endpoint: '/webhooks.json',
    method: 'POST',
  })
  if (result.status == 422) {
    const subscriptions = await list(context)
    const winner = subscriptions?.get(topic)
    if (winner != null) return { created: false, id: winner }
  }
  success(result, 'subscription create')
  const id = normalizeId(record(record(result.data)?.webhook)?.id)
  if (id == null) throw new TransientIntegrationError('Shopify subscription response is missing its ID.')
  return { created: true, id }
}

async function list(context: IntegrationReconcileContext): Promise<Map<string, string> | null> {
  const address = callbackUrl(context)
  const result = await request(context, 'subscription list', {
    endpoint: '/webhooks.json',
    method: 'GET',
    query: { address, limit: 250 },
  })
  if (result.status == 404) return null
  success(result, 'subscription list')
  const raw = record(result.data)?.webhooks
  const subscriptions = new Map<string, string>()
  if (!Array.isArray(raw)) return subscriptions
  for (const item of raw) {
    const value = record(item)
    const id = normalizeId(value?.id)
    if (value?.address === address && typeof value.topic == 'string' && id != null) subscriptions.set(value.topic, id)
  }
  return subscriptions
}

function callbackUrl(context: IntegrationReconcileContext): string {
  const url = new URL(context.endpointUrl)
  url.searchParams.set('open_flow_callback', context.callbackSecret)
  return url.href
}

async function remove(context: IntegrationReconcileContext, id: string): Promise<void> {
  const result = await request(context, 'subscription delete', { endpoint: `/webhooks/${encodeURIComponent(id)}.json`, method: 'DELETE' })
  if (result.status != 404) success(result, 'subscription delete')
}

async function request(context: IntegrationReconcileContext, operation: string, value: ConnectorProxyRequest): Promise<ConnectorProxyResult> {
  try {
    return await context.connector.execute(value, context.signal)
  } catch (cause) {
    if (cause instanceof IntegrationConnectionError) throw cause
    throw new TransientIntegrationError(`Shopify ${operation} request failed.`, { cause })
  }
}

function success(result: ConnectorProxyResult, operation: string): void {
  if (result.status >= 200 && result.status < 300) return
  if (result.status == 401 || result.status == 403) throw new IntegrationConnectionError(`Shopify ${operation} rejected the Connection.`)
  if ([402, 404, 422, 423, 501].includes(result.status)) throw new PermanentIntegrationError(`Shopify ${operation} rejected the subscription.`)
  throw new TransientIntegrationError(`Shopify ${operation} failed with status ${result.status}.`)
}

function normalizeId(value: unknown): string | null {
  if (typeof value == 'string') return value.trim().length == 0 ? null : value
  return typeof value == 'number' && Number.isFinite(value) ? String(value) : null
}

function requireState(value: IntegrationStateContext | undefined): IntegrationStateContext {
  if (value == null) throw new PermanentIntegrationError('Shopify Integration state is missing.')
  return value
}

function later(now: Date): Date {
  return new Date(now.getTime() + 30 * 24 * 60 * 60 * 1_000)
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value != null && typeof value == 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
}
