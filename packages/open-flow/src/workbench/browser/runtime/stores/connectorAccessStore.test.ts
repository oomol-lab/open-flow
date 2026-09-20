import { describe, expect, it, vi } from 'vitest'
import { WorkbenchClient } from '../api.ts'
import { ConnectorAccessStore } from './connectorAccessStore.ts'

const initial = {
  accessRevision: 0,
  bindings: [],
  mode: 'selectable',
  providerAccessDigest: 'access-0',
  version: 1,
} as const

describe('ConnectorAccessStore', () => {
  it('loads candidates and saves a Provider binding with the current access revision', async () => {
    const requests: { readonly body?: string; readonly method?: string; readonly path: string }[] = []
    const request = vi.fn(async (path: string, init?: RequestInit) => {
      requests.push({ path, method: init?.method, body: typeof init?.body == 'string' ? init.body : undefined })
      if (path == '/v1/flows/flow-1/connector-access' && init?.method == null) return Response.json(initial)
      if (path == '/v1/flows/flow-1/connector-access/mail/candidates') {
        return Response.json({
          candidates: [{ accessBindingId: 'editors', connectionDisplayName: 'Work account', permissionGroupName: 'Editors', providerId: 'mail' }],
          mode: 'selectable',
          providerId: 'mail',
          version: 1,
        })
      }
      if (path == '/v1/flows/flow-1/connector-access/mail' && init?.method == 'PUT') {
        return Response.json({
          ...initial,
          accessRevision: 1,
          bindings: [
            {
              accessBindingId: 'editors',
              connectionDisplayName: 'Work account',
              permissionGroupName: 'Editors',
              providerId: 'mail',
              status: 'active',
            },
          ],
          providerAccessDigest: 'access-1',
        })
      }
      throw new Error(`Unexpected request: ${path}`)
    })
    const store = new ConnectorAccessStore(new WorkbenchClient(request), vi.fn())

    await store.load('flow-1')
    await store.loadCandidates('mail')
    await store.select('mail', 'editors')

    expect(store.$.value.access).toMatchObject({ accessRevision: 1, providerAccessDigest: 'access-1' })
    expect(store.$.value.candidates.mail?.candidates).toEqual([
      { accessBindingId: 'editors', connectionDisplayName: 'Work account', permissionGroupName: 'Editors', providerId: 'mail' },
    ])
    expect(requests.at(-1)).toEqual({
      body: JSON.stringify({ accessBindingId: 'editors', expectedAccessRevision: 0, version: 1 }),
      method: 'PUT',
      path: '/v1/flows/flow-1/connector-access/mail',
    })
    store.dispose()
  })

  it('removes one Connection binding without clearing its Provider siblings', async () => {
    const first = {
      accessBindingId: 'personal',
      connectionDisplayName: 'Personal account',
      permissionGroupName: null,
      providerId: 'mail',
      status: 'active',
    } as const
    const second = { ...first, accessBindingId: 'work', connectionDisplayName: 'Work account', permissionGroupName: 'Editors' }
    const selected = { ...initial, accessRevision: 2, bindings: [first, second], providerAccessDigest: 'access-2' }
    const request = vi.fn(async (path: string, init?: RequestInit) => {
      if (path == '/v1/flows/flow-1/connector-access' && init?.method == null) return Response.json(selected)
      if (path == '/v1/flows/flow-1/connector-access/mail' && init?.method == 'DELETE') {
        return Response.json({ ...selected, accessRevision: 3, bindings: [second], providerAccessDigest: 'access-3' })
      }
      throw new Error(`Unexpected request: ${path}`)
    })
    const store = new ConnectorAccessStore(new WorkbenchClient(request), vi.fn())

    await store.load('flow-1')
    await store.select('mail', 'personal', false)

    expect(store.$.value.access?.bindings).toEqual([second])
    expect(JSON.parse(String(request.mock.calls.at(-1)?.[1]?.body))).toEqual({ accessBindingId: 'personal', expectedAccessRevision: 2, version: 1 })
    store.dispose()
  })

  it('does not replace a saved selection with an older refresh snapshot', async () => {
    let reads = 0
    let finishRefresh!: (response: Response) => void
    const refresh = new Promise<Response>((resolve) => {
      finishRefresh = resolve
    })
    const selected = {
      ...initial,
      accessRevision: 1,
      bindings: [
        {
          accessBindingId: 'editors',
          connectionDisplayName: 'Work account',
          permissionGroupName: 'Editors',
          providerId: 'mail',
          status: 'active',
        },
      ],
      providerAccessDigest: 'access-1',
    } as const
    const request = vi.fn(async (path: string, init?: RequestInit) => {
      if (path == '/v1/flows/flow-1/connector-access' && init?.method == null) return reads++ == 0 ? Response.json(initial) : await refresh
      if (path == '/v1/flows/flow-1/connector-access/mail' && init?.method == 'PUT') return Response.json(selected)
      throw new Error(`Unexpected request: ${path}`)
    })
    const store = new ConnectorAccessStore(new WorkbenchClient(request), vi.fn())

    await store.load('flow-1')
    const reload = store.load('flow-1')
    await vi.waitFor(() => expect(reads).toBe(2))
    await store.select('mail', 'editors')
    finishRefresh(Response.json(initial))
    await reload

    expect(store.$.value.access).toEqual(selected)
    store.dispose()
  })

  it('reloads after a conflicting mutation', async () => {
    const notice = vi.fn()
    let reads = 0
    const request = vi.fn(async (path: string, init?: RequestInit) => {
      if (path == '/v1/flows/flow-1/connector-access' && init?.method == null) {
        reads += 1
        return Response.json(reads == 1 ? initial : { ...initial, accessRevision: 2, providerAccessDigest: 'access-2' })
      }
      if (path == '/v1/flows/flow-1/connector-access/mail' && init?.method == 'PUT') {
        return Response.json({ error: { code: 'connector.access-conflict', message: 'Changed concurrently.' }, version: 1 }, { status: 409 })
      }
      throw new Error(`Unexpected request: ${path}`)
    })
    const store = new ConnectorAccessStore(new WorkbenchClient(request), notice)

    await store.load('flow-1')
    await store.select('mail', 'editors')

    expect(store.$.value.access).toMatchObject({ accessRevision: 2, providerAccessDigest: 'access-2' })
    expect(notice).toHaveBeenCalledOnce()
    store.dispose()
  })
})
