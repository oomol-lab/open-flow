import type { ConnectorProxy, ConnectorProxyRequest, ConnectorProxyResult } from '../src/connector/common/proxy.ts'
import type { JsonValue } from '../src/flow/common/change.ts'
import type {
  IntegrationDefinition,
  IntegrationReceiveContext,
  IntegrationReconcileContext,
  IntegrationStateContext,
} from '../src/trigger/common/integration.ts'
import type { PollContext, PollDefinition } from '../src/trigger/common/poll.ts'

import { describe, expect, it } from 'vitest'
import { IntegrationConnectionError } from '../src/trigger/common/integration.ts'
import { PermanentPollError, PollConnectionError } from '../src/trigger/common/poll.ts'
import { triggerDefinitions } from '../src/trigger/providers/definitions.ts'

const byKey = new Map(triggerDefinitions.map((definition) => [definition.snapshot.key, definition]))

function getDefinition(key: string) {
  const value = byKey.get(key)
  if (value == null) throw new Error(`Unknown Trigger definition ${key}.`)
  return value
}

function poll(key: string): PollDefinition {
  const value = getDefinition(key)
  if (!('poll' in value)) throw new Error(`${key} must be Poll.`)
  return value
}

function integration(key: string): IntegrationDefinition {
  const value = getDefinition(key)
  if (!('receive' in value)) throw new Error(`${key} must be Integration.`)
  return value
}

function connector(execute: (request: ConnectorProxyRequest, index: number) => ConnectorProxyResult | Promise<ConnectorProxyResult>): {
  readonly calls: ConnectorProxyRequest[]
  readonly value: ConnectorProxy
} {
  const calls: ConnectorProxyRequest[] = []
  return {
    calls,
    value: {
      async execute(request) {
        calls.push(request)
        return await execute(request, calls.length - 1)
      },
    },
  }
}

function pollContext(target: ConnectorProxy, config: Readonly<Record<string, JsonValue>>, checkpoint: JsonValue = null): PollContext {
  return { checkpoint, config, connector: target, now: new Date('2026-08-20T12:34:20.000Z') }
}

function state(initial: { readonly checkpoint?: JsonValue; readonly subscription?: Readonly<Record<string, JsonValue>> } = {}): {
  readonly subscription: () => Readonly<Record<string, JsonValue>>
  readonly value: IntegrationStateContext
} {
  let checkpoint: JsonValue = initial.checkpoint ?? null
  let subscription: Readonly<Record<string, JsonValue>> = initial.subscription ?? {}
  return {
    subscription: () => subscription,
    value: {
      get checkpoint() {
        return checkpoint
      },
      get subscription() {
        return subscription
      },
      async saveCheckpoint(value) {
        checkpoint = value
      },
      async saveSubscription(value) {
        subscription = value
      },
    },
  }
}

function reconcileContext(target: ConnectorProxy, runtime: IntegrationStateContext, config: Readonly<Record<string, JsonValue>>): IntegrationReconcileContext {
  return {
    active: true,
    callbackSecret: 'secret',
    config,
    connector: target,
    endpointUrl: 'https://flow.example/v1/integrations/endpoint_11111111111111111111111111111111',
    idempotencyKey: 'integration-test',
    now: new Date('2026-08-20T12:34:20.000Z'),
    state: runtime,
  }
}

function receiveContext(config: Readonly<Record<string, JsonValue>>, headers: Readonly<Record<string, string>>, payload: JsonValue): IntegrationReceiveContext {
  return {
    admit: true,
    bindingId: `sha256:${'1'.repeat(64)}`,
    callbackSecret: 'secret',
    config,
    connector: connector(() => ({ data: {}, status: 200 })).value,
    current: true,
    header: (name) => headers[name],
    method: 'POST',
    now: new Date('2026-08-20T12:34:20.000Z'),
    payload,
    query: () => undefined,
    rawBody: new TextEncoder().encode(JSON.stringify(payload)),
  }
}

async function signature(secret: string, source: Uint8Array, format: 'base64' | 'hex'): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { hash: 'SHA-256', name: 'HMAC' }, false, ['sign'])
  const value = new Uint8Array(await crypto.subtle.sign('HMAC', key, new Uint8Array(source).buffer))
  if (format == 'hex') return [...value].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return btoa(String.fromCharCode(...value))
}

describe('provider Poll Trigger definitions', () => {
  it('exposes the complete built-in Provider catalog', () => {
    expect(triggerDefinitions.map(({ snapshot }) => `${snapshot.type}:${snapshot.key}`)).toEqual([
      'poll:airtable.on_record_changed',
      'poll:gmail.on_message_received',
      'integration:github.on_repo_event',
      'integration:gitlab.on_project_event',
      'poll:googlecalendar.on_event_changed',
      'integration:googledrive.changes_detected',
      'poll:googledrive.on_file_change',
      'poll:googlesheets.on_row_added',
      'poll:notion.on_database_page_event',
      'poll:one_drive.on_item_changed',
      'poll:outlook.on_message_received',
      'integration:shopify.on_shop_event',
      'poll:slack.on_message_posted',
      'integration:stripe.on_event',
      'integration:telegram.on_update',
      'integration:woocommerce.on_store_event',
      'integration:zendesk.on_event',
    ])
    for (const key of [
      'github.on_repo_event',
      'gitlab.on_project_event',
      'shopify.on_shop_event',
      'stripe.on_event',
      'woocommerce.on_store_event',
      'zendesk.on_event',
    ]) {
      expect(integration(key).snapshot.endpoint).toMatchObject({ methods: ['POST'], successStatus: 202 })
    }
  })

  it('establishes Airtable and Gmail provider-owned baselines', async () => {
    const airtable = connector(() => ({ data: { records: [{ fields: { Changed: '2026-08-20T12:30:00Z' }, id: 'rec1' }] }, status: 200 }))
    await expect(
      poll('airtable.on_record_changed').poll(pollContext(airtable.value, { baseId: 'app12345678901234', tableIdOrName: 'Tasks', triggerField: 'Changed' })),
    ).resolves.toEqual({ checkpoint: { boundaryIds: ['rec1'], cursor: '2026-08-20T12:30:00.000Z' }, events: [] })
    expect(airtable.calls[0]).toMatchObject({ endpoint: '/app12345678901234/Tasks/listRecords', method: 'POST' })

    const gmail = connector(() => ({ data: { historyId: '900' }, status: 200 }))
    await expect(poll('gmail.on_message_received').poll(pollContext(gmail.value, {}))).resolves.toEqual({ checkpoint: { historyId: '900' }, events: [] })
  })

  it('classifies and emits Gmail and Google Calendar changes', async () => {
    const gmail = connector((request) => {
      if (request.endpoint == '/users/me/history') {
        return { data: { history: [{ messagesAdded: [{ message: { id: 'm1' } }] }], historyId: '11' }, status: 200 }
      }
      if (request.endpoint == '/users/me/messages/m1') {
        return {
          data: {
            id: 'm1',
            internalDate: '1787229260000',
            labelIds: ['INBOX', 'UNREAD'],
            payload: { headers: [{ name: 'Subject', value: 'Hello' }] },
            threadId: 't1',
          },
          status: 200,
        }
      }
      throw new Error(`Unexpected Gmail request ${request.endpoint}.`)
    })
    await expect(poll('gmail.on_message_received').poll(pollContext(gmail.value, {}, { historyId: '10' }))).resolves.toMatchObject({
      checkpoint: { historyId: '11' },
      events: [{ dedupeKey: 'm1', payload: { messageId: 'm1', subject: 'Hello', threadId: 't1' } }],
    })

    const calendar = connector(() => ({
      data: {
        items: [
          { created: '2026-08-20T12:35:00.000Z', id: 'e1', status: 'confirmed', updated: '2026-08-20T12:35:00.400Z' },
          { created: '2026-08-19T12:00:00Z', id: 'e2', status: 'cancelled', updated: '2026-08-20T12:36:00Z' },
        ],
        nextSyncToken: 'sync-2',
      },
      status: 200,
    }))
    await expect(
      poll('googlecalendar.on_event_changed').poll(pollContext(calendar.value, { calendarId: 'primary' }, { calendarId: 'primary', syncToken: 'sync-1' })),
    ).resolves.toMatchObject({
      checkpoint: { calendarId: 'primary', syncToken: 'sync-2' },
      events: [{ payload: { changeType: 'created', eventId: 'e1' } }, { payload: { changeType: 'cancelled', eventId: 'e2' } }],
    })
  })

  it('deduplicates Airtable timestamp boundaries and rejects a stuck Outlook boundary', async () => {
    const airtable = connector(() => ({
      data: {
        records: [
          { fields: { Changed: '2026-08-20T12:30:00Z' }, id: 'rec1' },
          { fields: { Changed: '2026-08-20T12:30:00Z' }, id: 'rec2' },
        ],
      },
      status: 200,
    }))
    await expect(
      poll('airtable.on_record_changed').poll(
        pollContext(
          airtable.value,
          { baseId: 'app12345678901234', tableIdOrName: 'Tasks', triggerField: 'Changed' },
          { boundaryIds: ['rec1'], cursor: '2026-08-20T12:30:00.000Z' },
        ),
      ),
    ).resolves.toMatchObject({
      checkpoint: { boundaryIds: ['rec1', 'rec2'], cursor: '2026-08-20T12:30:00.000Z' },
      events: [{ dedupeKey: 'rec2:2026-08-20T12:30:00.000Z' }],
    })

    const outlook = connector(() => ({ data: { value: [{ id: 'm1', receivedDateTime: '2026-08-20T12:30:00Z' }] }, status: 200 }))
    await expect(
      poll('outlook.on_message_received').poll(
        pollContext(outlook.value, { maxMessagesPerPoll: 1 }, { boundaryMessageIds: ['m1'], lastReceivedDateTime: '2026-08-20T12:30:00Z' }),
      ),
    ).rejects.toBeInstanceOf(PermanentPollError)
  })

  it('validates Drive folders and anchors Google Sheets without replaying rows', async () => {
    const drive = connector(() => ({ data: { driveId: 'drive-1', mimeType: 'application/vnd.google-apps.folder' }, status: 200 }))
    await expect(
      poll('googledrive.on_file_change').poll(pollContext(drive.value, { changeType: 'updated', driveId: 'drive-1', folderId: 'folder_1' })),
    ).resolves.toEqual({
      checkpoint: { changeType: 'updated', floor: '2026-08-20T12:34:20.000Z', since: '2026-08-20T12:34:20.000Z' },
      events: [],
    })

    const sheets = connector((request) =>
      request.endpoint.includes('/values/')
        ? { data: { values: [['old']] }, status: 200 }
        : {
            data: { sheets: [{ properties: { gridProperties: { rowCount: 100 }, sheetId: 7, sheetType: 'GRID', title: 'Orders' } }] },
            status: 200,
          },
    )
    await expect(poll('googlesheets.on_row_added').poll(pollContext(sheets.value, { sheet: 'Orders', spreadsheetId: 'sheet-1' }))).resolves.toEqual({
      checkpoint: { lastRowNumber: 2, sheetId: 7, spreadsheetId: 'sheet-1' },
      events: [],
    })
  })

  it('resolves Notion data sources and seeds OneDrive and Outlook cursors', async () => {
    const notion = connector((request) =>
      request.method == 'GET'
        ? { data: { data_sources: [{ id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' }] }, status: 200 }
        : { data: { results: [] }, status: 200 },
    )
    await expect(
      poll('notion.on_database_page_event').poll(pollContext(notion.value, { databaseId: '11111111222233334444555555555555' })),
    ).resolves.toMatchObject({
      checkpoint: { cursorField: 'created_time', dataSourceId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', since: '2026-08-20T12:35:00.000Z' },
      events: [],
    })

    const oneDrive = connector(() => ({ data: { '@odata.deltaLink': "https://graph.example/delta(token='latest-token')", 'value': [] }, status: 200 }))
    await expect(poll('one_drive.on_item_changed').poll(pollContext(oneDrive.value, {}))).resolves.toEqual({
      checkpoint: { deltaToken: 'latest-token', lastPolledAt: '2026-08-20T12:34:20.000Z' },
      events: [],
    })

    const outlook = connector((_request, index) =>
      index == 0 ? { data: { value: [{ id: 'm1', receivedDateTime: '2026-08-20T12:30:00Z' }] }, status: 200 } : { data: { value: [] }, status: 200 },
    )
    await expect(poll('outlook.on_message_received').poll(pollContext(outlook.value, {}))).resolves.toEqual({
      checkpoint: { boundaryMessageIds: ['m1'], lastReceivedDateTime: '2026-08-20T12:30:00Z' },
      events: [],
    })
    expect(outlook.calls).toHaveLength(2)
  })

  it('baselines, filters, and classifies Slack messages', async () => {
    const baseline = connector(() => ({ data: { messages: [{ ts: '1787229200.000001' }], ok: true }, status: 200 }))
    await expect(poll('slack.on_message_posted').poll(pollContext(baseline.value, { channelId: 'C012ABC' }))).resolves.toEqual({
      checkpoint: { lastTs: '1787229200.000001' },
      events: [],
    })

    const history = connector(() => ({
      data: {
        messages: [
          { bot_id: 'B1', text: 'deploy complete', ts: '1787229202.000001' },
          { text: 'deploy complete', ts: '1787229201.000001', user: 'U123' },
        ],
        ok: true,
      },
      status: 200,
    }))
    await expect(
      poll('slack.on_message_posted').poll(pollContext(history.value, { channelId: 'C012ABC', textContains: 'DEPLOY' }, { lastTs: '1787229200.000001' })),
    ).resolves.toMatchObject({
      checkpoint: { lastTs: '1787229202.000001' },
      events: [{ dedupeKey: 'C012ABC:1787229201.000001', payload: { text: 'deploy complete', userId: 'U123' } }],
      filtered: 1,
    })

    const unauthorized = connector(() => ({ data: { error: 'invalid_auth', ok: false }, status: 200 }))
    await expect(poll('slack.on_message_posted').poll(pollContext(unauthorized.value, { channelId: 'C012ABC' }))).rejects.toBeInstanceOf(PollConnectionError)
  })
})

describe('provider Integration Trigger definitions', () => {
  it('rejects unauthenticated provider deliveries', async () => {
    const fixtures: readonly [string, Readonly<Record<string, JsonValue>>, Readonly<Record<string, string>>, JsonValue][] = [
      ['github.on_repo_event', { events: ['push'], owner: 'oomol', repo: 'flow' }, { 'x-github-event': 'push' }, {}],
      ['gitlab.on_project_event', { events: ['pipeline'], project: 'oomol/flow' }, { 'x-gitlab-event': 'Pipeline Hook' }, {}],
      ['shopify.on_shop_event', { topics: ['orders/create'] }, { 'x-shopify-topic': 'orders/create' }, {}],
      ['stripe.on_event', { events: ['invoice.paid'] }, {}, { id: 'evt_1', type: 'invoice.paid' }],
      ['woocommerce.on_store_event', { events: ['order.created'] }, { 'x-wc-webhook-topic': 'order.created' }, {}],
      ['zendesk.on_event', { events: ['zen:event-type:ticket.created'] }, {}, { id: 'd6', type: 'zen:event-type:ticket.created' }],
    ]

    for (const [key, config, headers, payload] of fixtures) {
      await expect(Promise.resolve(integration(key).receive(receiveContext(config, headers, payload))), key).resolves.toMatchObject({
        outcome: 'respond',
        status: 404,
      })
    }
  })

  it('normalizes provider deliveries and rejects unsubscribed events', async () => {
    const encoder = new TextEncoder()
    const githubPayload = { ref: 'main' }
    const githubBody = encoder.encode(JSON.stringify(githubPayload))
    expect(
      await integration('github.on_repo_event').receive({
        ...receiveContext(
          { events: ['push'], owner: 'oomol', repo: 'flow' },
          { 'x-github-delivery': 'd1', 'x-github-event': 'push', 'x-hub-signature-256': `sha256=${await signature('secret', githubBody, 'hex')}` },
          githubPayload,
        ),
        rawBody: githubBody,
      }),
    ).toMatchObject({ dedupeKey: 'd1', outcome: 'event', payload: { event: 'push' } })
    expect(
      await integration('gitlab.on_project_event').receive(
        receiveContext(
          { events: ['pipeline'], project: 'oomol/flow' },
          { 'idempotency-key': 'd2', 'x-gitlab-event': 'Pipeline Hook', 'x-gitlab-token': 'secret' },
          {},
        ),
      ),
    ).toMatchObject({ dedupeKey: 'd2', outcome: 'event', payload: { event: 'pipeline' } })
    expect(
      await integration('shopify.on_shop_event').receive({
        ...receiveContext({ topics: ['orders/create'] }, { 'x-shopify-topic': 'orders/create', 'x-shopify-webhook-id': 'd3' }, { id: 1 }),
        query: (name) => (name == 'open_flow_callback' ? 'secret' : undefined),
      }),
    ).toMatchObject({ dedupeKey: 'd3', outcome: 'event', payload: { topic: 'orders/create' } })
    const stripePayload = { id: 'evt_1', livemode: true, type: 'invoice.paid' }
    const stripeBody = encoder.encode(JSON.stringify(stripePayload))
    const stripeTimestamp = String(Date.parse('2026-08-20T12:34:20.000Z') / 1_000)
    expect(
      await integration('stripe.on_event').receive({
        ...receiveContext(
          { events: ['invoice.paid'] },
          {
            'stripe-signature': `t=${stripeTimestamp},v1=${await signature('whsec_test', encoder.encode(`${stripeTimestamp}.${JSON.stringify(stripePayload)}`), 'hex')}`,
          },
          stripePayload,
        ),
        rawBody: stripeBody,
        state: state({ subscription: { endpointId: 'we_4', signingSecret: 'whsec_test' } }).value,
      }),
    ).toMatchObject({ dedupeKey: 'evt_1', outcome: 'event', payload: { event: 'invoice.paid', livemode: true } })
    const wooPayload = { id: 1 }
    const wooBody = encoder.encode(JSON.stringify(wooPayload))
    expect(
      await integration('woocommerce.on_store_event').receive({
        ...receiveContext(
          { events: ['order.created'] },
          {
            'x-wc-webhook-delivery-id': 'd5',
            'x-wc-webhook-signature': await signature('secret', wooBody, 'base64'),
            'x-wc-webhook-topic': 'order.created',
          },
          wooPayload,
        ),
        rawBody: wooBody,
      }),
    ).toMatchObject({ dedupeKey: 'd5', outcome: 'event', payload: { topic: 'order.created' } })
    const zendeskPayload = { id: 'd6', type: 'zen:event-type:ticket.created' }
    const zendeskBody = encoder.encode(JSON.stringify(zendeskPayload))
    const zendeskTimestamp = '2026-08-20T12:34:20.000Z'
    expect(
      await integration('zendesk.on_event').receive({
        ...receiveContext(
          { events: ['zen:event-type:ticket.created'] },
          {
            'x-zendesk-webhook-signature': await signature('zendesk-secret', encoder.encode(`${zendeskTimestamp}${JSON.stringify(zendeskPayload)}`), 'base64'),
            'x-zendesk-webhook-signature-timestamp': zendeskTimestamp,
          },
          zendeskPayload,
        ),
        rawBody: zendeskBody,
        state: state({ subscription: { signingSecret: 'zendesk-secret', webhookId: 'wh_6' } }).value,
      }),
    ).toMatchObject({ dedupeKey: 'd6', outcome: 'event', payload: { event: 'zen:event-type:ticket.created' } })
  })

  it('creates and persists one remote subscription for each provider', async () => {
    const cases: readonly {
      readonly config: Readonly<Record<string, JsonValue>>
      readonly key: string
      readonly responses: readonly ConnectorProxyResult[]
      readonly subscription: Readonly<Record<string, JsonValue>>
    }[] = [
      {
        config: { events: ['push'], owner: 'oomol', repo: 'flow' },
        key: 'github.on_repo_event',
        responses: [
          { data: { id: 1 }, status: 201 },
          { data: { id: 1 }, status: 200 },
        ],
        subscription: { hookId: '1' },
      },
      {
        config: { events: ['push'], project: 'oomol/flow' },
        key: 'gitlab.on_project_event',
        responses: [
          { data: [], status: 200 },
          { data: { id: 2 }, status: 201 },
        ],
        subscription: { hookId: '2' },
      },
      {
        config: { topics: ['orders/create'] },
        key: 'shopify.on_shop_event',
        responses: [
          { data: { webhooks: [] }, status: 200 },
          { data: { webhook: { id: '3' } }, status: 201 },
        ],
        subscription: { webhookIds: ['3'] },
      },
      {
        config: { events: ['invoice.paid'] },
        key: 'stripe.on_event',
        responses: [
          { data: { data: [], has_more: false }, status: 200 },
          { data: { id: 'we_4', secret: 'whsec_4' }, status: 200 },
          { data: { id: 'we_4' }, status: 200 },
        ],
        subscription: { endpointId: 'we_4', signingSecret: 'whsec_4' },
      },
      {
        config: { events: ['order.created'] },
        key: 'woocommerce.on_store_event',
        responses: [
          { data: [], status: 200 },
          { data: { id: 5 }, status: 201 },
        ],
        subscription: { webhookIds: ['5'] },
      },
      {
        config: { events: ['zen:event-type:ticket.created'] },
        key: 'zendesk.on_event',
        responses: [
          { data: { meta: { has_more: false }, webhooks: [] }, status: 200 },
          { data: { webhook: { id: 'wh_6' } }, status: 201 },
          { data: { signing_secret: { algorithm: 'SHA256', secret: 'zendesk-secret' } }, status: 200 },
        ],
        subscription: { signingSecret: 'zendesk-secret', webhookId: 'wh_6' },
      },
    ]

    for (const test of cases) {
      const runtime = state()
      const target = connector((_request, index) => test.responses[index]!)
      await expect(integration(test.key).reconcile(reconcileContext(target.value, runtime.value, test.config))).resolves.toEqual({ outcome: 'ready' })
      expect(runtime.subscription(), test.key).toEqual(test.subscription)
      expect(target.calls.length, test.key).toBe(test.responses.length)
    }
  })

  it('removes Shopify subscriptions created before a later topic fails', async () => {
    const runtime = state()
    const target = connector((_request, index) => {
      const responses: readonly ConnectorProxyResult[] = [
        { data: { webhooks: [] }, status: 200 },
        { data: { webhook: { id: 'created-1' } }, status: 201 },
        { data: {}, status: 422 },
        { data: { webhooks: [] }, status: 200 },
        { data: {}, status: 200 },
      ]
      return responses[index]!
    })

    await expect(
      integration('shopify.on_shop_event').reconcile(reconcileContext(target.value, runtime.value, { topics: ['orders/create', 'orders/delete'] })),
    ).rejects.toThrow('Shopify subscription create rejected the subscription.')
    expect(target.calls.map(({ endpoint, method }) => `${method} ${endpoint}`)).toEqual([
      'GET /webhooks.json',
      'POST /webhooks.json',
      'POST /webhooks.json',
      'GET /webhooks.json',
      'DELETE /webhooks/created-1.json',
    ])
    expect(runtime.subscription()).toEqual({})
  })

  it('authenticates, filters, and reconciles Telegram updates', async () => {
    const definition = integration('telegram.on_update')
    const message = { chat: { id: -100 }, from: { id: 42 }, text: 'hello' }
    const config = { chatIds: ['-100'], updates: ['message'], userIds: ['42'] }

    expect(await definition.receive(receiveContext(config, { 'x-telegram-bot-api-secret-token': 'wrong' }, { message, update_id: 7 }))).toMatchObject({
      outcome: 'respond',
      status: 404,
    })
    expect(
      await definition.receive(receiveContext(config, { 'x-telegram-bot-api-secret-token': 'secret' }, { edited_message: message, update_id: 8 })),
    ).toMatchObject({ outcome: 'ignored', reason: 'Telegram update type is not subscribed.' })
    expect(await definition.receive(receiveContext(config, { 'x-telegram-bot-api-secret-token': 'secret' }, { message, update_id: 9 }))).toMatchObject({
      dedupeKey: '9',
      outcome: 'event',
      payload: { deliveryId: '9', event: 'message' },
    })

    const target = connector((_request, index) =>
      index == 0 ? { data: { ok: true, result: { url: '' } }, status: 200 } : { data: { ok: true, result: true }, status: 200 },
    )
    await expect(definition.reconcile(reconcileContext(target.value, state().value, config))).resolves.toEqual({ outcome: 'ready' })
    expect(target.calls).toEqual([
      { endpoint: '/getWebhookInfo', method: 'GET' },
      {
        body: {
          allowed_updates: ['message'],
          drop_pending_updates: true,
          secret_token: 'secret',
          url: 'https://flow.example/v1/integrations/endpoint_11111111111111111111111111111111',
        },
        endpoint: '/setWebhook',
        method: 'POST',
      },
    ])

    const unauthorized = connector(() => ({ data: { description: 'Unauthorized', ok: false }, status: 401 }))
    await expect(definition.reconcile(reconcileContext(unauthorized.value, state().value, config))).rejects.toBeInstanceOf(IntegrationConnectionError)
  })

  it('creates, receives from, and retires a Google Drive changes channel', async () => {
    const definition = integration('googledrive.changes_detected')
    const runtime = state({ subscription: { channels: [] } })
    const created = connector((_request, index) =>
      index == 0
        ? { data: { startPageToken: 'page-1' }, status: 200 }
        : { data: { expiration: String(Date.parse('2026-08-26T00:00:00.000Z')), resourceId: 'resource-1' }, status: 200 },
    )
    await expect(definition.reconcile(reconcileContext(created.value, runtime.value, {}))).resolves.toEqual({ outcome: 'ready' })
    expect(created.calls.map(({ endpoint, method }) => `${method} ${endpoint}`)).toEqual(['GET /changes/startPageToken', 'POST /changes/watch'])

    const watchBody = created.calls[1]!.body as Readonly<Record<string, JsonValue>>
    const channelId = watchBody.id as string
    const token = watchBody.token as string
    expect(runtime.value.checkpoint).toEqual({ pageToken: 'page-1' })
    expect(runtime.subscription()).toMatchObject({ channels: [{ id: channelId, resourceId: 'resource-1', state: 'active' }] })

    const changed = connector(() => ({
      data: {
        changes: [
          {
            changeType: 'file',
            driveId: 'drive-1',
            file: { id: 'file-1', name: 'Report' },
            fileId: 'file-1',
            removed: false,
            time: '2026-08-20T12:35:00.000Z',
          },
        ],
        newStartPageToken: 'page-2',
      },
      status: 200,
    }))
    const headers = {
      'x-goog-changed': 'content, parents',
      'x-goog-channel-id': channelId,
      'x-goog-channel-token': token,
      'x-goog-message-number': '2',
      'x-goog-resource-id': 'resource-1',
      'x-goog-resource-state': 'change',
      'x-goog-resource-uri': 'https://drive.example/changes',
    }
    await expect(definition.receive({ ...receiveContext({}, headers, {}), connector: changed.value, state: runtime.value })).resolves.toMatchObject({
      checkpoint: { pageToken: 'page-2' },
      continue: false,
      dedupeKey: 'my-drive:page-1',
      outcome: 'event',
      payload: {
        events: [
          {
            changeId: 'drive-1:file-1:2026-08-20T12:35:00.000Z:file:present',
            notification: { changedTypes: ['content', 'parents'], messageNumber: '2', resourceState: 'change' },
          },
        ],
      },
    })
    await expect(
      definition.receive({ ...receiveContext({}, { ...headers, 'x-goog-channel-token': 'wrong' }, {}), connector: changed.value, state: runtime.value }),
    ).resolves.toMatchObject({ outcome: 'respond', status: 404 })

    const retired = connector(() => ({ data: {}, status: 204 }))
    await expect(definition.reconcile({ ...reconcileContext(retired.value, runtime.value, {}), active: false })).resolves.toEqual({ outcome: 'ready' })
    expect(retired.calls).toEqual([{ body: { id: channelId, resourceId: 'resource-1' }, endpoint: '/channels/stop', method: 'POST' }])
    expect(runtime.subscription()).toEqual({ channels: [] })
  })
})
