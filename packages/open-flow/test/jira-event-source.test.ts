import { expect, it } from 'vitest'
import { jiraProject } from '../src/event-source/common/jira.ts'

const source = jiraProject.initialize(
  { kind: 'jira', version: 1, name: 'Project', connectionId: 'connection', teamId: null, project: 'DEMO', eventTypes: ['jira:issue_created'] },
  'jira:cloud:user',
)
const read = async () => ({
  accountId: 'jira:cloud:user',
  cloudId: 'cloud',
  userId: 'user',
  projectId: '100',
  projectKey: 'DEMO',
  siteUrl: 'https://acme.atlassian.net',
})
it('requires confirmed unexpired subscriptions and preserves identity across reconciliation', async () => {
  const verified = await jiraProject.verifyIdentity!(source, read)
  expect((await jiraProject.verifyIdentity!(verified, read)).identity).toBe(verified.identity)
  expect(jiraProject.ready(verified, 100)).toBe(false)
  const active = { ...verified, state: { resourceStatus: 'ready', resource: { webhookId: 1, expiresAt: 200 } } }
  expect(jiraProject.ready(active, 199)).toBe(true)
  expect(jiraProject.ready(active, 200)).toBe(false)
  expect(jiraProject.view(active, 200)).toMatchObject({ subscriptionStatus: 'error' })
  await expect(jiraProject.verifyIdentity!(verified, async () => ({ ...(await read()), userId: 'other' }))).rejects.toThrow('changed')
})
it('forwards protected callback input and admits only verified event results', async () => {
  const active = {
    ...source,
    config: { ...source.config, cloudId: 'cloud', projectId: '100' },
    state: { resourceStatus: 'ready', resource: { webhookId: 1, expiresAt: 200 } },
  }
  const bytes = new TextEncoder().encode('{}')
  const headers = new Headers({ 'authorization': 'Bearer token', 'x-atlassian-webhook-identifier': 'delivery', 'cookie': 'ignored' })
  const unauthorized = await jiraProject.receive(active, bytes, headers, 100, async (request) => {
    expect(request).toMatchObject({
      operation: 'sourceReceive',
      config: { webhookId: 1, cloudId: 'cloud' },
      headers: { authorization: 'Bearer token' },
      rawBody: '{}',
    })
    expect('headers' in request && request.headers).not.toHaveProperty('cookie')
    return { outcome: 'unauthorized' }
  })
  expect('response' in unauthorized && unauthorized.response.status).toBe(401)
  const event = await jiraProject.receive(active, bytes, headers, 100, async () => ({
    outcome: 'event',
    id: 'delivery',
    type: 'jira:issue_created',
    payload: { deliveryId: 'delivery' },
  }))
  expect(event).toMatchObject({ event: { id: 'delivery', type: 'jira:issue_created' } })
})
