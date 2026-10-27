import type { CreateEventSource, UpdateEventSource } from '@oomol-lab/open-flow/control-api'
import type { SourceReferenceOperation } from '@oomol-lab/open-flow/event-source'

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import { runEnvironment } from '../node/application/run-environment.ts'
import { ImplicitConnectorAccessHost } from '../node/deployment/connector-access.ts'
import { ConnectorTaskError } from '../node/deployment/connector-contract.ts'
import { EventSourceRuntime } from '../node/runtime/event-source-runtime.ts'
import { isolatedVmEngineDigest } from '../node/runtime/isolated-vm.ts'
import { Database } from '../node/storage/database.ts'
import { Store } from '../node/storage/store.ts'
import { createConnectorHost } from './connectorHost.ts'
import { sourceReferenceFixture } from './sourceProtocolFixture.ts'

const input: Extract<CreateEventSource, { kind: 'slack' }> = {
  kind: 'slack',
  version: 1,
  name: 'Slack',
  connectionId: 'connection',
  teamId: null,
  appId: 'A123',
  workspaceId: 'T123',
  signingSecret: 'source-private-key',
  eventTypes: ['app_mention'],
}
const signal = () => new AbortController().signal
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'source-reference-'))
  const file = join(directory, 'runtime.db')
  let database = Database.open(file)
  let store = new Store(database, runEnvironment(isolatedVmEngineDigest), Date.now)
  const respond = sourceReferenceFixture()
  const requests: SourceReferenceOperation[] = []
  let fail: SourceReferenceOperation['action'] | undefined
  let rejectEdit = false
  let disconnected = false
  let gate: { action: SourceReferenceOperation['action']; entered: () => void; wait: Promise<void>; reject: boolean } | undefined
  let receiveGate: Promise<void> | undefined
  const connector = createConnectorHost({
    listConnections: async () =>
      disconnected
        ? []
        : [{ connectionId: 'connection', providerAccountId: 'U123', displayName: 'Slack', serviceId: 'slackbot', status: 'active', isDefault: true }],
    trigger: async (_provider, _connection, _trigger, request) => {
      if (request.operation !== 'sourceReference') throw new Error('Slack must only use references')
      requests.push(structuredClone(request.request))
      if (disconnected && request.request.action !== 'delete') throw new ConnectorTaskError('connector.unavailable', 'Connection removed')
      const delayed = gate?.action === request.request.action ? gate : undefined
      if (delayed) gate = undefined
      if (request.request.action === 'update' && rejectEdit) {
        rejectEdit = false
        throw new ConnectorTaskError('connector.input-invalid', 'The Source changed.', 409)
      }
      const result = structuredClone(respond(request.request))
      if (delayed) {
        delayed.entered()
        await delayed.wait
        if (delayed.reject) throw new ConnectorTaskError('connector.input-invalid', 'Concurrent create conflict', 409)
      }
      if (request.request.action === 'receive' && receiveGate != null) await receiveGate
      if (request.request.action === fail) {
        fail = undefined
        throw new ConnectorTaskError('connector.unavailable', 'Response lost')
      }
      return result
    },
  })
  const runtime = () =>
    new EventSourceRuntime(
      store,
      () => connector,
      new ImplicitConnectorAccessHost(),
      () => ({ callbackKey: 'key', publicOrigin: 'https://flow.example' }),
      Date.now,
      () => {},
    )
  onTestFinished(() => {
    database.close()
    rmSync(directory, { recursive: true, force: true })
  })
  return {
    runtime,
    requests,
    get store() {
      return store
    },
    get database() {
      return database
    },
    disconnect() {
      disconnected = true
    },
    delay(action: SourceReferenceOperation['action'], reject = false) {
      const entered = Promise.withResolvers<void>()
      const release = Promise.withResolvers<void>()
      gate = { action, entered: entered.resolve, wait: release.promise, reject }
      return { entered: entered.promise, release: release.resolve }
    },
    rejectEdit() {
      rejectEdit = true
    },
    loseResponse(action: SourceReferenceOperation['action']) {
      fail = action
    },
    delayReceive(wait: Promise<void>) {
      receiveGate = wait
    },
    reopen() {
      database.close()
      database = Database.open(file)
      store = new Store(database, runEnvironment(isolatedVmEngineDigest), Date.now)
    },
  }
}
const challenge = () =>
  new Request('https://flow.example/events', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ verify: true, response: { status: 200, body: 'verified', headers: {} } }),
  })

it('recovers creation, editing and deletion after lost responses and restart without storing Slack secrets', async () => {
  const test = fixture()
  test.loseResponse('create')
  await expect(test.runtime().create(input, signal())).rejects.toThrow('Response lost')
  const reserved = test.store.eventSources.list('https://flow.example')[0]!
  expect(reserved.lastError).toContain('unfinished')
  expect(test.store.eventSources.ready(reserved.sourceId, 'binding')).toBe(false)
  test.reopen()
  const source = await test.runtime().create(input, signal())
  expect(source.sourceId).toBe(reserved.sourceId)
  const creates = test.requests.filter((request) => request.action === 'create')
  expect(creates[0]!.requestKey).toBe(creates[1]!.requestKey)
  expect(creates[0]!.deploymentId).toBe(creates[1]!.deploymentId)
  expect((await test.runtime().receive(source.sourceId, challenge())).status).toBe(200)
  expect((await test.runtime().list()).sources[0]!.verifiedAt).not.toBeNull()
  const edit: UpdateEventSource = {
    version: 1,
    expectedRevision: source.revision,
    name: 'Renamed',
    enabled: true,
    eventTypes: ['message.im'],
    signingSecret: 'replacement-private-key',
  }
  test.loseResponse('update')
  await expect(test.runtime().update(source.sourceId, edit, signal())).rejects.toThrow('Response lost')
  expect((await test.runtime().receive(source.sourceId, challenge())).status).toBe(503)
  await expect(test.runtime().update(source.sourceId, { ...edit, name: 'Other' }, signal())).rejects.toThrow('unfinished')
  test.reopen()
  const updated = await test.runtime().update(source.sourceId, edit, signal())
  expect(updated).toMatchObject({ name: 'Renamed', eventTypes: ['message.im'], verifiedAt: null, revision: source.revision + 1 })
  expect((await test.runtime().receive(source.sourceId, challenge())).status).toBe(200)
  const stored = test.database.connection.prepare('SELECT * FROM event_sources').all()
  expect(JSON.stringify(stored)).not.toContain(input.signingSecret)
  expect(JSON.stringify(stored)).not.toContain(edit.signingSecret!)
  expect(test.database.connection.prepare('SELECT * FROM event_source_apps').all()).toEqual([])
  expect(test.store.eventSources.require(source.sourceId).secrets).toEqual({})
  expect(test.store.eventSources.require(source.sourceId).state).not.toHaveProperty('verifiedAt')
  expect(
    test.requests.filter((request) => !['create', 'update'].includes(request.action)).every((request) => !JSON.stringify(request).includes('signingSecret')),
  ).toBe(true)
  test.loseResponse('delete')
  await expect(test.runtime().delete(source.sourceId, updated.revision, signal())).rejects.toThrow('Response lost')
  expect(test.store.eventSources.require(source.sourceId).pending?.action).toBe('delete')
  test.reopen()
  await test.runtime().delete(source.sourceId, updated.revision, signal())
  expect((await test.runtime().list()).sources).toEqual([])
})

it('keeps names and enabled state local and rejects an old callback after a shared secret edit', async () => {
  const test = fixture()
  const a = await test.runtime().create(input, signal())
  const b = await test.runtime().create({ ...input, workspaceId: 'T456', name: 'Second' }, signal())
  const before = test.requests.length
  const local = await test
    .runtime()
    .update(a.sourceId, { version: 1, expectedRevision: a.revision, name: 'Local', enabled: false, eventTypes: a.eventTypes }, signal())
  expect(test.requests).toHaveLength(before)
  expect(local).toMatchObject({ name: 'Local', enabled: false })
  const gate = Promise.withResolvers<void>()
  test.delayReceive(gate.promise)
  const receive = test.runtime().receive(b.sourceId, challenge())
  await Promise.resolve()
  const edited = await test
    .runtime()
    .update(
      a.sourceId,
      { version: 1, expectedRevision: local.revision, name: 'Local', enabled: true, eventTypes: a.eventTypes, signingSecret: 'replacement-private-key' },
      signal(),
    )
  expect(edited.verifiedAt).toBeNull()
  gate.resolve()
  expect((await receive).status).toBe(409)
  expect(test.store.eventSources.ready(b.sourceId, 'binding')).toBe(false)
  expect((await test.runtime().list()).sources.every((source) => source.verifiedAt == null)).toBe(true)
})

it('releases a rejected edit without changing the live configuration or leaving the application blocked', async () => {
  const test = fixture()
  const source = await test.runtime().create(input, signal())
  expect((await test.runtime().receive(source.sourceId, challenge())).status).toBe(200)
  test.rejectEdit()
  await expect(
    test.runtime().update(
      source.sourceId,
      {
        version: 1,
        expectedRevision: source.revision,
        name: 'Rejected',
        enabled: true,
        eventTypes: ['message.im'],
      },
      signal(),
    ),
  ).rejects.toMatchObject({ status: 409 })
  const stored = test.store.eventSources.require(source.sourceId)
  expect(stored).toMatchObject({ name: source.name, eventTypes: source.eventTypes, pending: null, revision: source.revision })
  expect(test.store.eventSources.ready(source.sourceId, 'binding')).toBe(true)
})

it.each(['create', 'update'] as const)('deletes an unfinished %s after the connection disappears and the server restarts', async (action) => {
  const test = fixture()
  if (action === 'create') {
    test.loseResponse('create')
    await expect(test.runtime().create(input, signal())).rejects.toThrow('Response lost')
  } else {
    const source = await test.runtime().create(input, signal())
    test.loseResponse('update')
    await expect(
      test.runtime().update(
        source.sourceId,
        {
          version: 1,
          expectedRevision: source.revision,
          name: 'Edited',
          enabled: true,
          eventTypes: ['message.im'],
        },
        signal(),
      ),
    ).rejects.toThrow('Response lost')
  }
  test.disconnect()
  test.reopen()
  const source = test.store.eventSources.list('https://flow.example')[0]!
  test.loseResponse('delete')
  await expect(test.runtime().delete(source.sourceId, source.revision, signal())).rejects.toThrow('Response lost')
  test.reopen()
  await test.runtime().delete(source.sourceId, source.revision, signal())
  expect(test.store.eventSources.list('https://flow.example')).toEqual([])
})

it.each(['create', 'update'] as const)('keeps deletion pending when an older %s response arrives', async (action) => {
  const test = fixture()
  const initial = action === 'update' ? await test.runtime().create(input, signal()) : undefined
  const delayed = test.delay(action)
  const operation =
    initial == null
      ? test.runtime().create(input, signal())
      : test.runtime().update(
          initial.sourceId,
          {
            version: 1,
            expectedRevision: initial.revision,
            name: 'Edited',
            enabled: true,
            eventTypes: ['message.im'],
          },
          signal(),
        )
  const rejected = expect(operation).rejects.toThrow('unfinished')
  await delayed.entered
  const source = test.store.eventSources.list('https://flow.example')[0]!
  test.loseResponse('delete')
  await expect(test.runtime().delete(source.sourceId, source.revision, signal())).rejects.toThrow('Response lost')
  delayed.release()
  await rejected
  expect(test.store.eventSources.require(source.sourceId).pending?.action).toBe('delete')
  await test.runtime().delete(source.sourceId, source.revision, signal())
  expect(test.store.eventSources.list('https://flow.example')).toEqual([])
})

it('does not remove a completed Source when a concurrent create returns a conflict', async () => {
  const test = fixture()
  const delayed = test.delay('create', true)
  const first = test.runtime().create(input, signal())
  const rejected = expect(first).rejects.toMatchObject({ status: 409 })
  await delayed.entered
  const created = await test.runtime().create(input, signal())
  delayed.release()
  await rejected
  expect(test.store.eventSources.require(created.sourceId)).toMatchObject({ pending: null, connector: { reference: expect.any(Object) } })
})

it.each([false, true])('preserves application callback cancellation when the Connector response is lost: %s', async (lost) => {
  const test = fixture()
  await test.runtime().create(input, signal())
  const delayed = test.delay('route')
  if (lost) test.loseResponse('route')
  const controller = new AbortController()
  const receiving = test.runtime().receiveApplication('slack', input.appId, new Request(challenge(), { signal: controller.signal }))
  await delayed.entered
  controller.abort()
  delayed.release()
  await expect(receiving).rejects.toMatchObject({ name: 'AbortError' })
  expect(test.requests.filter((request) => request.action === 'receive')).toEqual([])
})
