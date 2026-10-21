import { createHmac } from 'node:crypto'
import { expect, it } from 'vitest'
import { intercomApplication } from '../src/event-source/common/intercom.ts'

const input = {
  kind: 'intercom' as const,
  version: 1 as const,
  name: 'Support',
  teamId: null,
  connectionId: 'connection',
  appId: 'developer-app',
  signingSecret: 'key',
  eventTypes: ['conversation.user.created', 'conversation.user.replied', 'ticket.created'],
}
const source = intercomApplication.initialize(input, 'workspace:admin')
function receive(payload: unknown, secret = 'key') {
  const body = JSON.stringify(payload)
  return intercomApplication.receive(
    source,
    new TextEncoder().encode(body),
    new Headers({ 'x-hub-signature': `sha1=${createHmac('sha1', secret).update(body).digest('hex')}` }),
    1800000000000,
  )
}
it('requires a verified workspace identity and a signed ping before readiness', async () => {
  expect(() => intercomApplication.initialize(input, 'admin-only')).toThrow('identity')
  expect(intercomApplication.ready(source)).toBe(false)
  expect(await receive({ type: 'notification_event', app_id: 'workspace', topic: 'ping' })).toMatchObject({ state: { verifiedAt: 1800000000000 } })
  expect(await receive({ type: 'notification_event', app_id: 'other', topic: 'ping' })).toMatchObject({ state: {} })
  await expect(receive({ type: 'notification_event', topic: 'ping' }, 'bad')).rejects.toThrow('signature')
})
it('accepts customer events with stable notification identity and ignores administrator replies and other workspaces', async () => {
  const payload = {
    type: 'notification_event',
    app_id: 'workspace',
    id: 'notification',
    topic: 'conversation.user.replied',
    data: { item: { id: 'conversation', text: '你好' } },
  }
  expect(await receive(payload)).toMatchObject({
    event: { id: 'notification', type: 'conversation.user.replied', payload: { objectId: 'conversation', body: payload.data.item } },
  })
  expect(await receive({ ...payload, topic: 'conversation.admin.replied' })).toHaveProperty('response')
  expect(await receive({ ...payload, app_id: 'other' })).toHaveProperty('response')
  expect(intercomApplication.matches({ eventTypes: ['ticket.created'] }, { id: 'notification', type: payload.topic, payload: {} })).toBe(false)
  await expect(receive({ ...payload, data: {} })).rejects.toThrow('Incomplete')
})
