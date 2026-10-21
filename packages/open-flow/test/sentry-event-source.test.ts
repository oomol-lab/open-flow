import { createHmac } from 'node:crypto'
import { expect, it } from 'vitest'
import { sentryApplication } from '../src/event-source/common/sentry.ts'

const input = {
  kind: 'sentry' as const,
  version: 1 as const,
  name: 'Alerts',
  teamId: null,
  connectionId: 'connection',
  appId: 'application',
  installationId: 'installation',
  organizationId: 'organization',
  signingSecret: 'key',
  eventTypes: ['issue.alert'],
}
const source = sentryApplication.initialize(input, 'organization')
function receive(payload: unknown, secret = 'key', resource = 'event_alert') {
  const body = JSON.stringify(payload)
  return sentryApplication.receive(
    source,
    new TextEncoder().encode(body),
    new Headers({ 'sentry-hook-resource': resource, 'sentry-hook-signature': createHmac('sha256', secret).update(body).digest('hex') }),
    1800000000000,
  )
}
const payload = {
  action: 'triggered',
  installation: { uuid: 'installation' },
  data: { event: { event_id: 'event1', issue_id: 'issue', project: 1 }, triggered_rule: 'Customer errors' },
}
it('binds the verified installation to the current organization and application', async () => {
  expect(sentryApplication.ready(source)).toBe(false)
  const identity = { accountId: 'organization', appId: 'application', installationId: 'installation', organizationSlug: 'acme', organizationId: 'organization' }
  expect(await sentryApplication.verifyIdentity!(source, async () => identity)).toMatchObject({
    config: { organizationSlug: 'acme', organizationId: 'organization' },
  })
  for (const field of ['accountId', 'appId', 'installationId'])
    await expect(sentryApplication.verifyIdentity!(source, async () => ({ ...identity, [field]: 'other' }))).rejects.toThrow('does not belong')
})
it('verifies alert signatures and distinguishes subsequent alerts for the same issue', async () => {
  const first = await receive(payload)
  expect(first).toMatchObject({
    state: { verifiedAt: 1800000000000 },
    event: { type: 'issue.alert', payload: { issueId: 'issue', organizationId: 'organization' } },
  })
  expect(await receive(payload)).toEqual(first)
  const second = await receive({ ...payload, data: { ...payload.data, event: { ...payload.data.event, event_id: 'event2' } } })
  expect('event' in first && 'event' in second && first.event.id !== second.event.id).toBe(true)
  await expect(receive(payload, 'wrong')).rejects.toThrow('signature')
  expect(await receive({ ...payload, installation: { uuid: 'other' } })).toHaveProperty('response')
  expect(await receive(payload, 'key', 'issue')).toHaveProperty('response')
  expect(await receive({ ...payload, action: 'created' })).toHaveProperty('response')
})

it('filters projects and alert rule labels only when requested', async () => {
  const result = await receive(payload)
  if (!('event' in result)) throw new Error('Expected alert')
  expect(sentryApplication.matches({ eventTypes: ['issue.alert'], projectIds: ['1'], ruleNames: ['Customer errors'] }, result.event)).toBe(true)
  expect(sentryApplication.matches({ eventTypes: ['issue.alert'], projectIds: ['2'] }, result.event)).toBe(false)
  expect(sentryApplication.matches({ eventTypes: ['issue.alert'], ruleNames: ['Other'] }, result.event)).toBe(false)
})
