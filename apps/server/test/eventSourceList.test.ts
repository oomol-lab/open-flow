import type { ConnectorHost } from '../node/deployment/connector-contract.ts'

import { decodeEventSources } from '@oomol-lab/open-flow/control-api'
import { sourceResultSchema } from '@oomol-lab/open-flow/event-source'
import { expect, it, onTestFinished, vi } from 'vitest'
import { ImplicitConnectorAccessHost } from '../node/deployment/connector-access.ts'
import { EventSourceRuntime } from '../node/runtime/event-source-runtime.ts'
import { Database } from '../node/storage/database.ts'
import { Store } from '../node/storage/store.ts'
import { createConnectorHost } from './connectorHost.ts'
import { sourceProtocolFixture } from './sourceProtocolFixture.ts'

function fixture(trigger: ConnectorHost['trigger']) {
  const database = Database.open(':memory:')
  onTestFinished(() => database.close())
  const store = new Store(database, Date.now)
  const connector = createConnectorHost({ trigger })
  const runtime = new EventSourceRuntime(
    store,
    () => connector,
    new ImplicitConnectorAccessHost(),
    () => ({ callbackKey: 'key', publicOrigin: 'https://flow.example' }),
    Date.now,
    () => {},
  )
  function create(name: string, projected = false) {
    const input = {
      version: 1 as const,
      name,
      connectionId: name,
      teamId: null,
      verificationToken: 'secret',
      encryptKey: 'secret',
      eventTypes: ['im.message.receive_v1'],
      manageSubscriptions: false,
    }
    const { source } = sourceResultSchema.parse(sourceProtocolFixture({ action: 'initialize', input }, 'cli_' + name))
    return store.eventSources.create(input, 'feishu', { ...source, state: projected ? source.state : {} })
  }
  return { database, store, runtime, create }
}

it.each(['connector', 'kind', 'projection', 'application'])('isolates a %s failure from a healthy source', async (failure) => {
  const context = fixture(async (_provider, connection, _trigger, request) => {
    if (connection === 'bad') throw new Error('Connector unavailable')
    if (request.operation !== 'source') throw new Error('Unexpected operation')
    return sourceProtocolFixture(request.request)
  })
  const bad = context.create('bad', failure !== 'connector' && failure !== 'kind')
  const good = context.create('good')
  if (failure === 'kind') context.database.connection.prepare("UPDATE event_sources SET kind = 'unknown' WHERE source_id = ?").run(bad.sourceId)
  if (failure === 'projection')
    context.database.connection.prepare('UPDATE event_sources SET state_json = \'{"projection":{}}\' WHERE source_id = ?').run(bad.sourceId)
  if (failure === 'application') context.database.connection.prepare("UPDATE event_sources SET kind = 'slack' WHERE source_id = ?").run(bad.sourceId)
  const result = decodeEventSources(await context.runtime.list())
  expect(result.sources).toHaveLength(2)
  expect(result.sources.find((source) => source.sourceId === bad.sourceId)).toMatchObject({ appId: null, lastError: expect.any(String) })
  expect(result.sources.find((source) => source.sourceId === good.sourceId)).toMatchObject({ appId: 'cli_good', name: 'good' })
  if (failure !== 'connector') expect(result.sources.find((source) => source.sourceId === bad.sourceId)?.endpointUrl).toBeNull()
})

it.each(['caller', 'budget'])('bounds concurrent inspection and stops queued work on %s cancellation', async (cancellation) => {
  const calls: AbortSignal[] = []
  const pending = Promise.withResolvers<void>()
  const context = fixture(async (_provider, _connection, _trigger, request, signal) => {
    calls.push(signal)
    await pending.promise
    if (request.operation !== 'source') throw new Error('Unexpected operation')
    return sourceProtocolFixture(request.request)
  })
  for (let index = 0; index < 8; index++) context.create('source' + index)
  const controller = new AbortController()
  const listing = context.runtime.list(undefined, controller.signal)
  expect(calls).toHaveLength(4)
  if (cancellation === 'caller') {
    controller.abort()
    await expect(listing).rejects.toMatchObject({ name: 'AbortError' })
  } else {
    const result = await listing
    expect(result.sources).toHaveLength(8)
    expect(result.sources.every((source) => source.appId === null)).toBe(true)
  }
  expect(calls.every((signal) => signal.aborted)).toBe(true)
  pending.resolve()
  await new Promise((resolve) => setImmediate(resolve))
  expect(calls).toHaveLength(4)
  expect(context.store.eventSources.unprojected()).toHaveLength(8)
})

it('continues queued inspection within the concurrency limit', async () => {
  const first = Promise.withResolvers<void>()
  let active = 0
  let maximum = 0
  const inspect = vi.fn(async (_provider, _connection, _trigger, request) => {
    active++
    maximum = Math.max(maximum, active)
    await first.promise
    active--
    if (request.operation !== 'source') throw new Error('Unexpected operation')
    return sourceProtocolFixture(request.request)
  }) satisfies NonNullable<ConnectorHost['trigger']>
  const context = fixture(inspect)
  for (let index = 0; index < 9; index++) context.create('source' + index)
  const listing = context.runtime.list()
  expect(inspect).toHaveBeenCalledTimes(4)
  first.resolve()
  expect((await listing).sources.every((source) => source.appId != null)).toBe(true)
  expect(inspect).toHaveBeenCalledTimes(9)
  expect(maximum).toBe(4)
})
