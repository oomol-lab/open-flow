import type { JsonValue } from '../src/flow/common/change.ts'
import type { IntegrationDefinition, IntegrationStateContext } from '../src/trigger/common/integration.ts'

import { expect, it, vi } from 'vitest'
import { IntegrationConnectionError } from '../src/trigger/common/integration.ts'
import { remoteTriggerDefinitions } from '../src/trigger/providers/remote.ts'

const listener = remoteTriggerDefinitions.find((definition) => definition.snapshot.key === 'googledrive.watch_changes') as IntegrationDefinition

it('reuses the owned subscription across publication keys and preserves listener progress on renewal', async () => {
  let checkpoint: JsonValue = { pageToken: 'advanced' }
  let subscription: Readonly<Record<string, JsonValue>> = { id: 'owned-subscription' }
  const state: IntegrationStateContext = {
    get checkpoint() {
      return checkpoint
    },
    get subscription() {
      return subscription
    },
    saveCheckpoint: async (value) => {
      checkpoint = value
    },
    saveSubscription: async (value) => {
      subscription = value
    },
  }
  const trigger = vi.fn(async () => ({
    outcome: 'ready',
    checkpoint: { pageToken: 'baseline' },
    subscription: { id: 'owned-subscription' },
    reconcileAt: 60_000,
  }))
  const execute = vi.fn()
  await listener.reconcile({
    active: true,
    config: {},
    callbackSecret: 'local-only',
    endpointUrl: 'https://flow.example/callback',
    idempotencyKey: 'published-runtime',
    now: new Date(),
    connector: { trigger, execute },
    state,
  })
  expect(trigger).toHaveBeenCalledWith(
    expect.objectContaining({ operation: 'reconcile', subscriptionId: 'owned-subscription', requestKey: 'published-runtime' }),
    undefined,
  )
  expect(checkpoint).toEqual({ pageToken: 'advanced' })
  expect(execute).not.toHaveBeenCalled()
})

it('persists callback subscription scheduling without advancing a listener checkpoint', async () => {
  const saveCheckpoint = vi.fn(async () => {})
  const saveSubscription = vi.fn(async () => {})
  const trigger = vi.fn(async () => ({ result: { outcome: 'wake' }, checkpoint: { pageToken: 'server' }, subscription: { id: 'owned' }, reconcileAt: 1000 }))
  const result = await listener.receive({
    bindingId: 'binding',
    admit: true,
    current: true,
    method: 'POST',
    callbackSecret: 'local-only',
    config: {},
    now: new Date(),
    payload: {},
    rawBody: new Uint8Array(),
    header: () => undefined,
    query: (name) => (name === 'connector_subscription' ? 'owned-nonce' : undefined),
    connector: {
      execute: vi.fn(),
      trigger,
    },
    state: { checkpoint: null, subscription: { id: 'owned' }, saveCheckpoint, saveSubscription },
  })
  expect(result).toEqual({ outcome: 'wake' })
  expect(trigger).toHaveBeenCalledWith(expect.objectContaining({ query: { connector_subscription: 'owned-nonce' } }), undefined)
  expect(saveCheckpoint).not.toHaveBeenCalled()
  expect(saveSubscription).toHaveBeenCalledWith({ id: 'owned' }, new Date(1000))
})

it('maps listener connection failures to Integration errors', async () => {
  const failure = Object.assign(new Error('Connection requires authorization'), { code: 'connector.connection-required' })
  await expect(
    listener.listener!.read({
      checkpoint: null,
      config: {},
      now: new Date(),
      connector: {
        execute: vi.fn(),
        trigger: async () => {
          throw failure
        },
      },
    }),
  ).rejects.toBeInstanceOf(IntegrationConnectionError)
})

it('rejects legacy remote identifiers before creating another subscription', async () => {
  const trigger = vi.fn()
  await expect(
    listener.reconcile({
      active: true,
      config: {},
      callbackSecret: 'local',
      endpointUrl: 'https://flow.example/callback',
      idempotencyKey: 'legacy',
      now: new Date(),
      connector: { execute: vi.fn(), trigger },
      state: { checkpoint: null, subscription: { channels: [] }, saveCheckpoint: vi.fn(), saveSubscription: vi.fn() },
    }),
  ).rejects.toThrow('predates connector-owned Triggers')
  expect(trigger).not.toHaveBeenCalled()
})

it('acknowledges Asana creation handshakes before a subscription exists without accepting or persisting the supplied key', async () => {
  const definition = remoteTriggerDefinitions.find((item) => item.snapshot.key === 'asana.on_task_event') as IntegrationDefinition
  const trigger = vi.fn()
  const saveSubscription = vi.fn()
  const secret = 'a'.repeat(64)
  const result = await definition.receive({
    bindingId: 'candidate',
    admit: false,
    current: true,
    method: 'POST',
    callbackSecret: 'local',
    config: { projectId: 'project' },
    now: new Date(),
    payload: null,
    rawBody: new Uint8Array(),
    header: (name) => (name === 'x-hook-secret' ? secret : undefined),
    query: () => undefined,
    connector: { execute: vi.fn(), trigger },
    state: { checkpoint: null, subscription: {}, saveCheckpoint: vi.fn(), saveSubscription },
  })
  expect(result).toEqual({ outcome: 'respond', status: 200, body: '', contentType: 'text/plain', headers: { 'x-hook-secret': secret } })
  expect(trigger).not.toHaveBeenCalled()
  expect(saveSubscription).not.toHaveBeenCalled()
})

it.each([
  ['typeform.on_form_response', { 'typeform-signature': 'signed' }, {}],
  ['clickup.on_task_event', { 'x-signature': 'signed' }, {}],
  ['resend.on_email_event', { 'svix-id': 'delivery', 'svix-timestamp': '123', 'svix-signature': 'signed' }, {}],
  ['calendly.on_booking_event', { 'calendly-webhook-signature': 'signed' }, {}],
  ['pipedrive.on_crm_event', { authorization: 'Basic signed' }, {}],
  ['pandadoc.on_document_event', {}, { signature: 'signed' }],
  ['asana.on_task_event', { 'x-hook-signature': 'signed' }, {}],
  ['vercel.on_deployment_event', { 'x-vercel-signature': 'signed' }, {}],
] as const)('forwards %s verification material and original bytes to its owner', async (key, suppliedHeaders, suppliedQuery) => {
  const definition = remoteTriggerDefinitions.find((item) => item.snapshot.key === key) as IntegrationDefinition
  const trigger = vi.fn(async () => ({ result: { outcome: 'respond', status: 401, body: '', contentType: 'text/plain' } }))
  const raw = new TextEncoder().encode('{ "message": "你好" }')
  const result = await definition.receive({
    bindingId: 'binding',
    admit: true,
    current: true,
    method: 'POST',
    callbackSecret: 'local',
    config: {},
    now: new Date(),
    payload: { message: '你好' },
    rawBody: raw,
    header: (name) => new Headers(suppliedHeaders).get(name) ?? undefined,
    query: (name) => new URLSearchParams(suppliedQuery).get(name) ?? undefined,
    connector: { execute: vi.fn(), trigger },
    state: { checkpoint: null, subscription: { id: 'owned' }, saveCheckpoint: vi.fn(), saveSubscription: vi.fn() },
  })
  expect(result).toMatchObject({ outcome: 'respond', status: 401 })
  expect(trigger).toHaveBeenCalledWith(
    expect.objectContaining({ headers: suppliedHeaders, query: suppliedQuery, rawBody: Buffer.from(raw).toString('base64') }),
    undefined,
  )
})
