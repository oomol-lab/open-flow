import { createHmac } from 'node:crypto'
import { expect, it } from 'vitest'
import { slackApplication } from '../src/event-source/common/slack.ts'

const now = 1_800_000_000_000
const source = slackApplication.initialize(
  {
    kind: 'slack',
    version: 1,
    name: 'Bot',
    connectionId: 'connection',
    teamId: 'team',
    appId: 'A123',
    workspaceId: 'T123',
    signingSecret: 'key',
    eventTypes: ['app_mention', 'message.im'],
  },
  'U123',
)
function signed(payload: unknown, timestamp = String(now / 1000)) {
  const body = JSON.stringify(payload)
  return {
    bytes: new TextEncoder().encode(body),
    headers: new Headers({
      'x-slack-request-timestamp': timestamp,
      'x-slack-signature': `v0=${createHmac('sha256', 'key').update(`v0:${timestamp}:${body}`).digest('hex')}`,
    }),
  }
}
const payload = {
  type: 'event_callback',
  api_app_id: 'A123',
  team_id: 'T123',
  event_id: 'Ev123',
  authorizations: [{ team_id: 'T123', user_id: 'U123', is_bot: true }],
  event: { type: 'app_mention', channel: 'C123', user: 'U456', text: '你好', ts: '123.456', thread_ts: '123.000' },
}
async function receive(value: unknown) {
  const request = signed(value)
  return slackApplication.receive(source, request.bytes, request.headers, now)
}
it('verifies the challenge and rejects stale or altered signatures', async () => {
  const request = signed({ type: 'url_verification', challenge: 'challenge' })
  const result = await slackApplication.receive(source, request.bytes, request.headers, now)
  expect(result).toMatchObject({ state: { verifiedAt: now } })
  expect('response' in result && (await result.response.json())).toEqual({ challenge: 'challenge' })
  await expect(slackApplication.receive(source, new TextEncoder().encode('{}'), request.headers, now)).rejects.toThrow('signature')
  await expect(slackApplication.receive(source, request.bytes, request.headers, now + 301000)).rejects.toThrow('timestamp')
})
it('routes only to the signed bot installation and preserves thread identity', async () => {
  expect(await receive(payload)).toMatchObject({ event: { id: 'Ev123', type: 'app_mention', payload: { teamId: 'T123', text: '你好', threadTs: '123.000' } } })
  for (const changed of [
    { ...payload, team_id: 'T456' },
    { ...payload, api_app_id: 'A456' },
    { ...payload, authorizations: [{ team_id: 'T123', user_id: 'U456', is_bot: true }] },
    { ...payload, is_ext_shared_channel: true },
  ])
    expect(await receive(changed)).toHaveProperty('response')
})
it('accepts new human direct messages and excludes bot messages, edits and deletions', async () => {
  expect(await receive({ ...payload, event: { ...payload.event, type: 'message', channel_type: 'im' } })).toMatchObject({ event: { type: 'message.im' } })
  for (const event of [
    { ...payload.event, bot_id: 'B123' },
    { ...payload.event, user: 'U123' },
    { ...payload.event, subtype: 'message_changed' },
    { ...payload.event, subtype: 'message_deleted' },
    { ...payload.event, type: 'message', channel_type: 'channel' },
  ])
    expect(await receive({ ...payload, event })).toHaveProperty('response')
})
it('keeps connection and Connector Team identities separate', () => {
  const other = slackApplication.initialize(
    {
      kind: 'slack',
      version: 1,
      name: 'Bot',
      connectionId: 'other',
      teamId: 'other-team',
      appId: 'A123',
      workspaceId: 'T123',
      signingSecret: 'key',
      eventTypes: ['app_mention'],
    },
    'U123',
  )
  expect(other.identity).not.toBe(source.identity)
  expect(slackApplication.matches({ eventTypes: ['app_mention'], channelIds: ['C456'] }, { id: 'Ev', type: 'app_mention', payload: { channel: 'C123' } })).toBe(
    false,
  )
})
