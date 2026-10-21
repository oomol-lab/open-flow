import { createHmac } from 'node:crypto'
import { expect, it } from 'vitest'
import { zoomApplication } from '../src/event-source/common/zoom.ts'

const now = 1800000000000
const input = {
  kind: 'zoom' as const,
  version: 1 as const,
  name: 'Recordings',
  teamId: null,
  connectionId: 'connection',
  appId: 'application',
  signingSecret: 'key',
  eventTypes: ['recording.completed'],
}
const initial = zoomApplication.initialize(input, 'user')
const source = { ...initial, config: { ...initial.config, userId: 'user', zoomAccountId: 'account' } }
function receive(payload: unknown, at = now, secret = 'key') {
  const body = JSON.stringify(payload)
  const timestamp = String(now / 1000)
  return zoomApplication.receive(
    source,
    new TextEncoder().encode(body),
    new Headers({
      'x-zm-request-timestamp': timestamp,
      'x-zm-signature': `v0=${createHmac('sha256', secret).update(`v0:${timestamp}:${body}`).digest('hex')}`,
    }),
    at,
  )
}
it('validates the connected Zoom user and rejects changed accounts', async () => {
  const identity = { accountId: 'user', userId: 'user', zoomAccountId: 'account' }
  expect(await zoomApplication.verifyIdentity!(initial, async () => identity)).toEqual(source)
  await expect(zoomApplication.verifyIdentity!(source, async () => ({ ...identity, zoomAccountId: 'other' }))).rejects.toThrow('changed')
})
it('answers signed CRC challenges including revalidation and rejects stale or invalid signatures', async () => {
  const challenge = { event: 'endpoint.url_validation', payload: { plainToken: 'challenge' } }
  const result = await receive(challenge)
  expect(result).toMatchObject({ state: { verifiedAt: now } })
  expect('response' in result && (await result.response.json())).toEqual({
    plainToken: 'challenge',
    encryptedToken: createHmac('sha256', 'key').update('challenge').digest('hex'),
  })
  await expect(receive(challenge, now + 301000)).rejects.toThrow('timestamp')
  await expect(receive(challenge, now, 'wrong')).rejects.toThrow('signature')
})
it('uses meeting instance identity and excludes other hosts, accounts and incomplete files', async () => {
  const object = {
    id: 'recurring-meeting',
    uuid: 'instance1',
    host_id: 'user',
    recording_files: [
      { id: 'file', status: 'completed' },
      { id: 'pending', status: 'processing' },
    ],
  }
  const payload = { event: 'recording.completed', payload: { account_id: 'account', object }, download_token: 'do-not-emit' }
  const first = await receive(payload)
  expect(first).toMatchObject({
    event: { id: 'instance1', payload: { meetingUuid: 'instance1', body: { recording_files: [{ id: 'file', status: 'completed' }] } } },
  })
  expect(JSON.stringify(first)).not.toContain('do-not-emit')
  expect(await receive({ ...payload, payload: { ...payload.payload, object: { ...object, uuid: 'instance2' } } })).toMatchObject({ event: { id: 'instance2' } })
  expect(await receive({ ...payload, payload: { ...payload.payload, account_id: 'other' } })).toHaveProperty('response')
  expect(await receive({ ...payload, payload: { ...payload.payload, object: { ...object, host_id: 'other' } } })).toHaveProperty('response')
})
