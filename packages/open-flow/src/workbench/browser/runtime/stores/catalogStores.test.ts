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
  it('keeps directory responses cached and service views derived', async () => {
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

  it.each(['providers', 'actions', 'connections'] as const)('keeps %s requests on the selected Flow after deleting the previous Flow', async (kind) => {
    let deleted = false
    const requestedFlows: (string | null)[] = []
    const request = async (path: string) => {
      const flowId = new URL(path, 'https://open-flow.invalid').searchParams.get('flowId')
      requestedFlows.push(flowId)
      if (deleted && flowId == 'old-flow') {
        return Response.json({ version: 1, error: { code: 'flow.not-found', message: 'Deleted Flow' } }, { status: 404 })
      }
      return Response.json(kind == 'connections' ? { version: 1, connections: [] } : { success: true, data: [] })
    }
    const stores = new CatalogStores(new WorkbenchClient(request), {
      sessionId: crypto.randomUUID(),
      environment: 'test',
      connectorOwnerId: crypto.randomUUID(),
    })
    const read = async (flowId: string, force = false) => {
      const state =
        kind == 'providers'
          ? stores.providers.get(flowId, 'en', force)
          : kind == 'actions'
            ? stores.actions.get('github', flowId, 'en', force)
            : stores.connections.get(undefined, flowId, force)
      await Promise.resolve()
      return await resourceValue<readonly unknown[]>(state, undefined, true)
    }
    try {
      await read('old-flow')
      deleted = true
      await expect(read('new-flow')).resolves.toEqual([])
      expect([...new Set(requestedFlows)]).toEqual(['old-flow', 'new-flow'])
      await expect(read('new-flow', true)).resolves.toEqual([])
      expect(requestedFlows.at(-1)).toBe('new-flow')
      await expect(read('old-flow', true)).rejects.toThrow('Deleted Flow')
      await expect(read('new-flow', true)).resolves.toEqual([])
      expect(requestedFlows.at(-1)).toBe('new-flow')
    } finally {
      stores.dispose()
    }
  })

  it.each(['providers', 'actions', 'connections'] as const)('isolates %s responses between owners in the same session', async (kind) => {
    const response = () => Response.json(kind == 'connections' ? { version: 1, connections: [] } : { success: true, data: [] })
    const firstRequest = vi.fn(async () => response())
    const secondRequest = vi.fn(async () => response())
    const scope = { sessionId: crypto.randomUUID(), environment: 'test' }
    const first = new CatalogStores(new WorkbenchClient(firstRequest), { ...scope, connectorOwnerId: 'first-owner' })
    const second = new CatalogStores(new WorkbenchClient(secondRequest), { ...scope, connectorOwnerId: 'second-owner' })
    try {
      for (const stores of [first, second]) {
        if (kind == 'providers') await resourceValue(stores.providers.get('same-flow', 'en'))
        else if (kind == 'actions') await resourceValue(stores.actions.get('github', 'same-flow', 'en'))
        else await resourceValue(stores.connections.get(undefined, 'same-flow'))
      }
      expect(firstRequest).toHaveBeenCalled()
      expect(secondRequest).toHaveBeenCalled()
    } finally {
      first.dispose()
      second.dispose()
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
