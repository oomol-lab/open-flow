import { describe, expect, it, vi } from 'vitest'
import { WorkbenchClient } from '../api.ts'
import { CatalogStores } from './catalogStores.ts'
import { resourceValue } from './resource.ts'

const provider = { service: 'github', displayName: 'GitHub', authTypes: ['oauth'] }
const secondProvider = { service: 'slack', displayName: 'Slack', authTypes: ['oauth'] }
const action = {
  id: 'github.create_issue',
  service: 'github',
  name: 'Create issue',
  description: '',
  inputSchema: { type: 'object', properties: {} },
  outputSchema: { type: 'object', properties: {} },
}
const secondAction = {
  ...action,
  id: 'slack.send_message',
  service: 'slack',
}
const connection = { connectionId: 'github-1', displayName: 'Personal', isDefault: true, serviceId: 'github', status: 'active' }

describe('CatalogStores', () => {
  it('uses the OOMOL owner-scoped caches for directory responses and keeps service views derived', async () => {
    const request = vi.fn(async (path: string) => {
      if (path.startsWith('/v1/connector/proxy/providers')) return Response.json({ success: true, data: [provider, secondProvider] })
      if (path.startsWith('/v1/connector/proxy/actions')) {
        return Response.json({ success: true, data: [path.includes('service=slack') ? secondAction : action] })
      }
      if (path.startsWith('/v1/connector/connections')) return Response.json({ version: 1, connections: [connection] })
      throw new Error(`Unexpected request: ${path}`)
    })
    const stores = new CatalogStores(new WorkbenchClient(request), { sessionId: 'session-1', environment: 'test', connectorOwnerId: 'owner-1' })
    try {
      expect(await resourceValue(stores.providers.get('flow-1', 'en'))).toEqual([
        expect.objectContaining({ serviceId: 'github' }),
        expect.objectContaining({ serviceId: 'slack' }),
      ])
      expect(await resourceValue(stores.actions.get('github', 'flow-1', 'en'))).toEqual([expect.objectContaining({ actionId: 'github.create_issue' })])
      expect(await resourceValue(stores.actions.get('slack', 'flow-1', 'en'))).toEqual([expect.objectContaining({ actionId: 'slack.send_message' })])
      expect(await resourceValue(stores.connections.get('github', 'flow-1'))).toEqual([connection])
      expect(request).toHaveBeenCalledTimes(4)
    } finally {
      stores.dispose()
    }
  })

  it('keeps action searches transient and separate from the directory cache', async () => {
    const request = vi.fn(async (path: string) =>
      path.includes('/connector/action-metadata') ? Response.json({ version: 1, actions: [] }) : Response.json({ success: true, data: [] }),
    )
    const stores = new CatalogStores(new WorkbenchClient(request), { sessionId: 'session-2', environment: 'test' })
    const controller = new AbortController()
    try {
      const search = stores.actions.search('issue', 'flow-1', 'en', controller.signal)
      const result = await resourceValue(search.get())
      expect(result).toEqual([])
      expect(request).toHaveBeenCalledTimes(1)
    } finally {
      stores.dispose()
    }
  })
})
