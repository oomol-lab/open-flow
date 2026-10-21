import { createHmac } from 'node:crypto'
import { expect, it, vi } from 'vitest'
import { firefliesAccount } from '../src/event-source/common/fireflies.ts'

const source = firefliesAccount.initialize(
  {
    kind: 'fireflies',
    version: 1,
    name: 'Meetings',
    teamId: null,
    connectionId: 'connection',
    signingSecret: 'key',
    eventTypes: ['meeting.transcribed', 'meeting.summarized'],
  },
  'account',
)
const access = async () => ({ accountId: 'account', meetingId: 'meeting', accessible: true })
function receive(payload: unknown, read = access, secret = 'key') {
  const body = JSON.stringify(payload)
  return firefliesAccount.receive(
    source,
    new TextEncoder().encode(body),
    new Headers({ 'x-hub-signature': `sha256=${createHmac('sha256', secret).update(body).digest('hex')}` }),
    1800000000000,
    read,
  )
}
it('checks signatures before reading meeting access and does not verify inaccessible meetings', async () => {
  const read = vi.fn(access)
  const payload = { event: 'meeting.transcribed', meeting_id: 'meeting', timestamp: 123 }
  await expect(receive(payload, read, 'wrong')).rejects.toThrow('signature')
  expect(read).not.toHaveBeenCalled()
  expect(await receive(payload, async () => ({ accountId: 'account', meetingId: 'meeting', accessible: false }))).toMatchObject({ state: {} })
  expect(await receive(payload)).toMatchObject({ state: { verifiedAt: 1800000000000 } })
})
it('normalizes changing delivery timestamps, separates readiness types and orders updates by reprocessed_at', async () => {
  const payload = { event: 'meeting.transcribed', meeting_id: 'meeting', timestamp: 123 }
  const initial = await receive(payload)
  expect(await receive({ ...payload, timestamp: 456 })).toEqual(initial)
  const summary = await receive({ ...payload, event: 'meeting.summarized' })
  expect('event' in initial && 'event' in summary && initial.event.id !== summary.event.id).toBe(true)
  expect(await receive({ ...payload, reprocessed_at: 789 })).toMatchObject({
    event: { ordering: { version: 789 }, payload: { body: { reprocessed_at: 789 } } },
  })
  await expect(receive({ ...payload, reprocessed_at: '789' })).rejects.toThrow('Incomplete')
})
