import type { ConnectorProxy } from '../../connector/common/proxy.ts'
import type { IntegrationEndpointMethod, JsonValue, TriggerKeySnapshot } from '../../flow/common/change.ts'

import { dequal } from 'dequal/lite'

export const maximumIntegrationBodyBytes = 64 * 1024
export const maximumIntegrationDeliveryPages = 5

const endpointPattern = /^\/v1\/integrations\/(endpoint_[0-9a-f]{32})$/
const encoder = new TextEncoder()

export type IntegrationReceiveResult =
  | {
      readonly checkpoint?: JsonValue
      readonly continue?: boolean
      readonly dedupeKey?: string
      readonly outcome: 'event'
      readonly payload: Readonly<Record<string, JsonValue>>
    }
  | { readonly checkpoint?: JsonValue; readonly continue?: boolean; readonly outcome: 'ignored'; readonly reason: string }
  | {
      readonly body: string
      readonly contentType: string
      readonly headers?: Readonly<Record<string, string>>
      readonly outcome: 'respond'
      readonly status: number
    }

export interface IntegrationStateContext {
  readonly checkpoint: JsonValue
  readonly subscription: Readonly<Record<string, JsonValue>>
  readonly saveCheckpoint: (checkpoint: JsonValue) => Promise<void>
  readonly saveSubscription: (subscription: Readonly<Record<string, JsonValue>>, reconcileAt: Date) => Promise<void>
}

export interface IntegrationReceiveContext {
  readonly admit: boolean
  readonly allow?: () => Promise<boolean>
  readonly bindingId: string
  readonly callbackSecret: string
  readonly config: Readonly<Record<string, JsonValue>>
  readonly connector: ConnectorProxy
  readonly current: boolean
  readonly header: (name: string) => string | undefined
  readonly method: IntegrationEndpointMethod
  readonly now: Date
  readonly payload: JsonValue
  readonly query: (name: string) => string | undefined
  readonly rawBody: Uint8Array
  readonly state?: IntegrationStateContext
}

export interface IntegrationReconcileContext {
  readonly active: boolean
  readonly callbackSecret: string
  readonly config: Readonly<Record<string, JsonValue>>
  readonly connector: ConnectorProxy
  readonly endpointUrl: string
  readonly idempotencyKey: string
  readonly now: Date
  readonly signal?: AbortSignal
  readonly state?: IntegrationStateContext
}

export interface IntegrationReconcileResult {
  readonly outcome: 'pending' | 'ready'
}

export interface IntegrationDefinition {
  readonly initialState?: { readonly checkpoint: JsonValue; readonly subscription: Readonly<Record<string, JsonValue>> }
  readonly receive: (context: IntegrationReceiveContext) => IntegrationReceiveResult | Promise<IntegrationReceiveResult>
  readonly reconcile: (context: IntegrationReconcileContext) => Promise<IntegrationReconcileResult>
  readonly snapshot: TriggerKeySnapshot & { readonly type: 'integration' }
}

export class IntegrationConnectionError extends Error {
  override readonly name = 'IntegrationConnectionError'
}

export class PermanentIntegrationError extends Error {
  override readonly name = 'PermanentIntegrationError'
}

export class TransientIntegrationError extends Error {
  override readonly name = 'TransientIntegrationError'
}

export function integrationEndpointId(url: URL): string | undefined {
  return endpointPattern.exec(url.pathname)?.[1]
}

export async function integrationCallbackSecret(callbackKey: string | undefined, endpointId: string): Promise<string> {
  if (callbackKey == null || callbackKey.length == 0) throw new TypeError('Integration callback key is required.')
  const key = await crypto.subtle.importKey('raw', encoder.encode(callbackKey), { hash: 'SHA-256', name: 'HMAC' }, false, ['sign'])
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(`open-flow-integration/v1/${endpointId}`)))
  return btoa(String.fromCharCode(...signature))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '')
}

export async function integrationOccurrenceId(bindingId: string, runtimeVersion: number, definitionKey: string, dedupeKey: string | null): Promise<string> {
  if (dedupeKey == null) return `integration_${crypto.randomUUID().replaceAll('-', '')}`
  const source = JSON.stringify([1, 'integration-occurrence', bindingId, runtimeVersion, definitionKey, dedupeKey])
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(source)))
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export interface IntegrationConformanceFixture {
  readonly config: Readonly<Record<string, JsonValue>>
  readonly connectionId: string
  readonly definition: Pick<IntegrationDefinition, 'initialState' | 'receive' | 'reconcile'>
  readonly publishedAt: string
}

export interface IntegrationConformanceState {
  readonly checkpoint: JsonValue | null
  readonly health: 'healthy' | 'initializing'
  readonly payloads: readonly JsonValue[]
  readonly receiveCalls: number
  readonly reconcileCalls: number
  readonly runtimeVersion: number
  readonly subscription: Readonly<Record<string, JsonValue>> | null
}

export interface IntegrationConformanceHarness {
  readonly callbackSecret: string
  readonly endpointUrl: string
  dispose(): Promise<void>
  reconcile(at: string): Promise<void>
  republish(at: string): Promise<void>
  request(request: Request): Promise<Response>
  restart(): Promise<void>
  retire(at: string): Promise<void>
  state(): Promise<IntegrationConformanceState>
}

export interface IntegrationConformanceCase {
  readonly fixture: IntegrationConformanceFixture
  readonly name: string
  verify(harness: IntegrationConformanceHarness): Promise<void>
}

const conformanceDefinition: IntegrationConformanceFixture['definition'] = {
  initialState: { checkpoint: null, subscription: {} },
  receive(context): IntegrationReceiveResult {
    if (context.header('x-integration-secret') != context.callbackSecret) {
      return { body: '', contentType: 'text/plain', outcome: 'respond', status: 404 }
    }
    const value = record(context.payload)
    if (value?.action == 'handshake') {
      return {
        body: 'accepted',
        contentType: 'text/plain',
        headers: { 'x-integration-response': 'conformance' },
        outcome: 'respond',
        status: 201,
      }
    }
    if (value?.action == 'ignored') return { outcome: 'ignored', reason: 'Conformance delivery was ignored.' }
    if (value?.action == 'pages') {
      const checkpoint = record(context.state?.checkpoint)
      const page = typeof checkpoint?.page == 'number' ? checkpoint.page + 1 : 1
      const pages = typeof value.pages == 'number' ? value.pages : 1
      const deliveryId = typeof value.deliveryId == 'string' ? value.deliveryId : 'pages'
      return {
        checkpoint: { page },
        continue: page < pages,
        dedupeKey: `${deliveryId}:${page}`,
        outcome: 'event',
        payload: { body: { page }, deliveryId, event: 'conformance' },
      }
    }
    const deliveryId = typeof value?.deliveryId == 'string' ? value.deliveryId : 'delivery'
    const body = record(value?.body) ?? {}
    return {
      checkpoint: { deliveryId },
      dedupeKey: deliveryId,
      outcome: 'event',
      payload: { body, deliveryId, event: 'conformance' },
    }
  },
  async reconcile(context) {
    if (context.state == null) throw new PermanentIntegrationError('Conformance Integration state is missing.')
    await context.state.saveSubscription(context.active ? { endpointUrl: context.endpointUrl } : {}, new Date(context.now.getTime() + 60_000))
    return { outcome: 'ready' }
  },
}

const fixture: IntegrationConformanceFixture = {
  config: { source: 'primary' },
  connectionId: 'connection-primary',
  definition: conformanceDefinition,
  publishedAt: '2026-08-21T00:00:30.000Z',
}

export const integrationConformanceCases: readonly IntegrationConformanceCase[] = [
  {
    fixture,
    name: 'enforces callback routing, method, body, and handshake boundaries',
    async verify(harness) {
      const base = new URL(harness.endpointUrl)
      await response(await call(harness, { url: new URL('/v1/integrations/not-an-endpoint', base).href }), { status: 404 }, 'Malformed endpoint')
      await response(
        await call(harness, { url: new URL('/v1/integrations/endpoint_00000000000000000000000000000000', base).href }),
        { status: 404 },
        'Unknown endpoint',
      )
      await response(await call(harness, { method: 'GET' }), { headers: { allow: 'POST' }, status: 405 }, 'Method')
      await response(await call(harness, { body: '{' }), { status: 400 }, 'Invalid JSON')
      await response(
        await call(harness, { body: 'a=1', headers: { 'content-type': 'application/x-www-form-urlencoded' } }),
        { status: 400 },
        'Unsupported body format',
      )
      await response(await call(harness, { body: 'x'.repeat(maximumIntegrationBodyBytes + 1) }), { status: 413 }, 'Oversized body')
      await response(
        await delivery(harness, { action: 'handshake' }),
        { body: 'accepted', headers: { 'content-type': 'text/plain', 'x-integration-response': 'conformance' }, status: 201 },
        'Handshake',
      )
    },
  },
  {
    fixture,
    name: 'verifies initializing callbacks before activating the subscription',
    async verify(harness) {
      await response(await delivery(harness, { action: 'event', body: { value: 'before' }, deliveryId: 'before' }, false), { status: 404 }, 'Secret')
      await response(await delivery(harness, { action: 'event', body: { value: 'before' }, deliveryId: 'before' }), { status: 202 }, 'Initializing delivery')
      equal(
        await harness.state(),
        {
          checkpoint: null,
          health: 'initializing',
          payloads: [],
          receiveCalls: 2,
          reconcileCalls: 0,
          runtimeVersion: 1,
          subscription: {},
        },
        'Initializing state',
      )
      await harness.reconcile('2026-08-21T00:00:31.000Z')
      equal(
        await harness.state(),
        {
          checkpoint: null,
          health: 'healthy',
          payloads: [],
          receiveCalls: 2,
          reconcileCalls: 1,
          runtimeVersion: 1,
          subscription: { endpointUrl: harness.endpointUrl },
        },
        'Active subscription',
      )
    },
  },
  {
    fixture,
    name: 'deduplicates keyed events and rejects conflicting payloads',
    async verify(harness) {
      await harness.reconcile('2026-08-21T00:00:31.000Z')
      const first = { action: 'event', body: { value: 'first' }, deliveryId: 'delivery-1' }
      await response(await delivery(harness, first), { status: 202 }, 'Initial event')
      await response(await delivery(harness, first), { status: 202 }, 'Repeated event')
      await response(await delivery(harness, { ...first, body: { value: 'changed' } }), { status: 409 }, 'Conflicting event')
      const state = await harness.state()
      equal(state.checkpoint, { deliveryId: 'delivery-1' }, 'Event checkpoint')
      equal(state.payloads, [{ body: { value: 'first' }, deliveryId: 'delivery-1', event: 'conformance' }], 'Event payloads')
    },
  },
  {
    fixture,
    name: 'bounds callback pages and resumes from the durable checkpoint',
    async verify(harness) {
      await harness.reconcile('2026-08-21T00:00:31.000Z')
      const pages = { action: 'pages', deliveryId: 'delivery-pages', pages: 7 }
      await response(await delivery(harness, pages), { status: 202 }, 'First page batch')
      let state = await harness.state()
      equal(state.checkpoint, { page: 5 }, 'Bounded checkpoint')
      equal(state.payloads.length, 5, 'Bounded payload count')
      await response(await delivery(harness, pages), { status: 202 }, 'Resumed page batch')
      state = await harness.state()
      equal(state.checkpoint, { page: 7 }, 'Resumed checkpoint')
      equal(state.payloads.length, 7, 'Resumed payload count')
    },
  },
  {
    fixture,
    name: 'restores subscription state and callback admission after restart',
    async verify(harness) {
      await harness.reconcile('2026-08-21T00:00:31.000Z')
      await delivery(harness, { action: 'event', body: { value: 'before' }, deliveryId: 'before' })
      await harness.restart()
      await delivery(harness, { action: 'event', body: { value: 'after' }, deliveryId: 'after' })
      const state = await harness.state()
      equal(state.checkpoint, { deliveryId: 'after' }, 'Restart checkpoint')
      equal(
        state.payloads,
        [
          { body: { value: 'before' }, deliveryId: 'before', event: 'conformance' },
          { body: { value: 'after' }, deliveryId: 'after', event: 'conformance' },
        ],
        'Restart payloads',
      )
    },
  },
  {
    fixture,
    name: 'retires the old runtime before activating a republished target',
    async verify(harness) {
      await harness.reconcile('2026-08-21T00:00:31.000Z')
      const event = { action: 'event', body: { value: 'event' }, deliveryId: 'same-delivery' }
      await delivery(harness, event)
      const endpointUrl = harness.endpointUrl
      await harness.republish('2026-08-21T00:00:40.000Z')
      equal(harness.endpointUrl, endpointUrl, 'Republished endpoint')
      await response(await delivery(harness, event), { status: 202 }, 'Old runtime delivery')
      equal((await harness.state()).payloads.length, 1, 'Old runtime payload count')
      await harness.reconcile('2026-08-21T00:00:41.000Z')
      await response(await delivery(harness, event), { status: 202 }, 'New runtime delivery')
      const state = await harness.state()
      equal(state.runtimeVersion, 2, 'Republished runtime')
      equal(state.health, 'healthy', 'Republished health')
      equal(state.payloads.length, 2, 'Republished payload count')
    },
  },
  {
    fixture,
    name: 'retires the remote subscription and rejects later callbacks',
    async verify(harness) {
      await harness.reconcile('2026-08-21T00:00:31.000Z')
      await harness.retire('2026-08-21T00:00:40.000Z')
      await response(await delivery(harness, { action: 'event', deliveryId: 'retired' }), { status: 404 }, 'Retired callback')
      await harness.reconcile('2026-08-21T00:00:41.000Z')
      await response(await delivery(harness, { action: 'event', deliveryId: 'retired' }), { status: 404 }, 'Reconciled retirement')
      equal((await harness.state()).payloads, [], 'Retired payloads')
    },
  },
]

function call(
  harness: IntegrationConformanceHarness,
  input: { readonly body?: string; readonly headers?: Readonly<Record<string, string>>; readonly method?: string; readonly url?: string } = {},
): Promise<Response> {
  return harness.request(
    new Request(input.url ?? harness.endpointUrl, {
      ...(input.body == null ? {} : { body: input.body }),
      headers: { ...(input.body == null ? {} : { 'content-type': 'application/json' }), ...input.headers },
      method: input.method ?? 'POST',
    }),
  )
}

function delivery(harness: IntegrationConformanceHarness, body: Readonly<Record<string, JsonValue>>, authenticated = true): Promise<Response> {
  return call(harness, {
    body: JSON.stringify(body),
    headers: authenticated ? { 'x-integration-secret': harness.callbackSecret } : {},
  })
}

function equal(actual: unknown, expected: unknown, message: string): void {
  if (!dequal(actual, expected)) throw new Error(`${message}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}.`)
}

function record(value: unknown): Readonly<Record<string, JsonValue>> | undefined {
  return value != null && typeof value == 'object' && !Array.isArray(value) ? (value as Readonly<Record<string, JsonValue>>) : undefined
}

async function response(
  actual: Response,
  expected: { readonly body?: string; readonly headers?: Readonly<Record<string, string | null>>; readonly status: number },
  message: string,
): Promise<void> {
  equal(actual.status, expected.status, `${message} status`)
  if (expected.body != null) equal(await actual.text(), expected.body, `${message} body`)
  for (const [name, value] of Object.entries(expected.headers ?? {})) equal(actual.headers.get(name), value, `${message} header ${name}`)
}
