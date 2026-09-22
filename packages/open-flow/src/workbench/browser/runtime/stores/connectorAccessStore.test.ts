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
      if (path == '/v1/flows/flow-1/connector-access/candidates/query') {
        return Response.json({
          results: [
            {
              candidates: [
                {
                  connectionId: 'fixture-account',
                  source: { kind: 'policy' as const, ruleId: 'Editors' },
                  accessBindingId: 'editors',
                  connectionDisplayName: 'Work account',
                  permissionGroupName: 'Editors',
                  providerId: 'mail',
                },
              ],
              mode: 'selectable',
              providerId: 'mail',
              version: 1,
            },
          ],
          version: 1,
        })
      }
      if (path == '/v1/flows/flow-1/connector-access/mail' && init?.method == 'PUT') {
        return Response.json({
          ...initial,
          accessRevision: 1,
          bindings: [
            {
              connectionId: 'fixture-account',
              source: { kind: 'policy' as const, ruleId: 'Editors' },
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
    await store.loadCandidates(['mail'])
    await store.select('mail', 'editors')

    expect(store.$.value.access).toMatchObject({ accessRevision: 1, providerAccessDigest: 'access-1' })
    expect(store.$.value.candidates.mail?.candidates).toEqual([
      {
        connectionId: 'fixture-account',
        source: { kind: 'policy' as const, ruleId: 'Editors' },
        accessBindingId: 'editors',
        connectionDisplayName: 'Work account',
        permissionGroupName: 'Editors',
        providerId: 'mail',
      },
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
      connectionId: 'fixture-account',
      source: { kind: 'policy' as const, ruleId: null },
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
          connectionId: 'fixture-account',
          source: { kind: 'policy' as const, ruleId: 'Editors' },
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

it('refreshes available accounts when configuring access after connecting an account', async () => {
  let connected = false
  const candidate = {
    connectionId: 'fixture-account',
    source: { kind: 'policy' as const, ruleId: null },
    accessBindingId: 'work',
    connectionDisplayName: 'New account',
    providerId: 'mail',
  }
  const request = vi.fn(async (path: string) =>
    Response.json(
      path.endsWith('/candidates/query')
        ? { results: [{ candidates: connected ? [candidate] : [], mode: 'selectable', providerId: 'mail', version: 1 }], version: 1 }
        : initial,
    ),
  )
  const store = new ConnectorAccessStore(new WorkbenchClient(request), vi.fn())
  await store.load('flow-1')
  await store.loadCandidates(['mail'])
  expect(store.$.value.candidates.mail?.candidates).toEqual([])
  connected = true
  store.configure('mail')
  await vi.waitFor(() => expect(store.$.value.candidates.mail?.candidates).toEqual([candidate]))
  expect(store.$.value.configuration).toEqual({ providerId: 'mail' })
  expect(store.$.value.access?.bindings).toEqual([])
  store.dispose()
})

it('opens Flow authorization without choosing a provider or changing bindings', async () => {
  const request = vi.fn(async () => Response.json(initial))
  const store = new ConnectorAccessStore(new WorkbenchClient(request), vi.fn())
  await store.load('flow-1')
  store.configure()
  expect(store.$.value.configuration).toEqual({})
  expect(store.$.value.access).toEqual(initial)
  expect(request).toHaveBeenCalledTimes(1)
  store.dispose()
})

it('preserves a configuration request made while initial access is loading', async () => {
  const pending = Promise.withResolvers<Response>()
  const store = new ConnectorAccessStore(new WorkbenchClient(async () => pending.promise), vi.fn())
  const loading = store.load('flow-1')
  store.configure('mail')
  pending.resolve(Response.json(initial))
  await loading
  expect(store.$.value.configuration).toEqual({ providerId: 'mail' })
  expect(store.$.value.loading).toBe(false)
  store.dispose()
})

it('persists an unconnected service and restores it in a new Store', async () => {
  let access = { ...initial, accessRevision: 0 as number, providerIds: [] as string[] }
  const request = vi.fn(async (path: string, init?: RequestInit) => {
    if (path.endsWith('/service')) {
      access = { ...access, providerIds: init?.method == 'PUT' ? ['2chat'] : [], accessRevision: access.accessRevision + 1 }
    }
    if (path.endsWith('/candidates/query'))
      return Response.json({ results: [{ candidates: [], mode: 'selectable', providerId: '2chat', version: 1 }], version: 1 })
    return Response.json(access)
  })
  const store = new ConnectorAccessStore(new WorkbenchClient(request), vi.fn())
  await store.load('flow-1')
  expect(await store.setService('2chat', true)).toBe(true)
  expect(store.$.value.access?.bindings).toEqual([])
  store.dispose()
  const reopened = new ConnectorAccessStore(new WorkbenchClient(request), vi.fn())
  await reopened.load('flow-1')
  expect(reopened.$.value.access?.providerIds).toEqual(['2chat'])
  expect(await reopened.setService('2chat', false)).toBe(true)
  expect(reopened.$.value.access?.providerIds).toEqual([])
  reopened.dispose()
})

it.each([true, false])('preserves a newer refresh while setting service selection to %s', async (selected) => {
  const client = new WorkbenchClient(vi.fn())
  const read = vi.spyOn(client, 'getConnectorAccess').mockResolvedValue({ ...initial, accessRevision: 10, providerIds: selected ? [] : ['mail'] })
  const pending = Promise.withResolvers<Awaited<ReturnType<WorkbenchClient['setConnectorService']>>>()
  const save = vi.spyOn(client, 'setConnectorService').mockReturnValueOnce(pending.promise)
  vi.spyOn(client, 'listProviderAccessBindingCandidates').mockResolvedValue({
    results: [{ providerId: 'mail', candidates: [], mode: 'selectable', version: 1 }],
    version: 1,
  })
  const store = new ConnectorAccessStore(client, vi.fn())
  try {
    await store.load('flow-1')
    const saving = store.setService('mail', selected)
    await vi.waitFor(() => expect(save).toHaveBeenCalledWith('flow-1', 'mail', selected, 10))
    const newer = { ...initial, accessRevision: 12, providerIds: selected ? ['mail', 'github'] : ['github'], providerAccessDigest: 'access-12' }
    read.mockResolvedValue(newer)
    await store.load('flow-1')
    pending.resolve({ ...initial, accessRevision: 11, providerIds: selected ? ['mail'] : [], providerAccessDigest: 'access-11' })
    await expect(saving).resolves.toBe(true)
    expect(store.$.value.access).toEqual(newer)
    expect(store.$.value.savingProviderId).toBeUndefined()
    save.mockResolvedValue({ ...newer, accessRevision: 13 })
    await expect(store.setService('mail', !selected)).resolves.toBe(true)
    expect(save).toHaveBeenLastCalledWith('flow-1', 'mail', !selected, 12)
  } finally {
    store.dispose()
  }
})

it.each([true, false])('shows pending selection %s immediately without changing authoritative access and rolls back on failure', async (selected) => {
  const binding = {
    accessBindingId: 'account',
    connectionId: 'account',
    providerId: 'mail',
    source: { kind: 'admin-delegation' },
    connectionDisplayName: 'Work',
    permissionGroupName: null,
    status: 'active',
  }
  const snapshot = { ...initial, bindings: selected ? [] : [binding] }
  let rejectSave!: (error: Error) => void
  const save = new Promise<Response>((_, reject) => {
    rejectSave = reject
  })
  const notice = vi.fn()
  const request = vi.fn(async (_path: string, init?: RequestInit) => (init?.method == null ? Response.json(snapshot) : await save))
  const store = new ConnectorAccessStore(new WorkbenchClient(request), notice)
  await store.load('flow-1')
  const pending = store.select('mail', 'account', selected)
  expect(store.$.value.pendingSelection).toEqual({ providerId: 'mail', accessBindingId: 'account', selected })
  expect(store.$.value.access).toEqual(snapshot)
  await store.load('flow-1')
  expect(store.$.value.pendingSelection?.selected).toBe(selected)
  await expect(store.select('other', 'other')).resolves.toBe(false)
  rejectSave(new Error('Save failed'))
  await expect(pending).resolves.toBe(false)
  expect(store.$.value.pendingSelection).toBeUndefined()
  expect(store.$.value.savingProviderId).toBeUndefined()
  expect(store.$.value.access).toEqual(snapshot)
  expect(notice).toHaveBeenCalledOnce()
  store.dispose()
})

it.each([false, true])('clears pending feedback without applying a stale completion after navigation: %s', async (navigate) => {
  let finish!: (response: Response) => void
  const save = new Promise<Response>((resolve) => {
    finish = resolve
  })
  const newer = { ...initial, accessRevision: 3, providerAccessDigest: 'newer' }
  let reads = 0
  const request = vi.fn(async (_path: string, init?: RequestInit) => (init?.method == null ? Response.json(reads++ == 0 ? initial : newer) : await save))
  const onSaved = vi.fn()
  const store = new ConnectorAccessStore(new WorkbenchClient(request), vi.fn(), undefined, onSaved)
  await store.load('flow-1')
  const pending = store.select('mail', 'account')
  await store.load(navigate ? 'flow-2' : 'flow-1')
  finish(Response.json({ ...initial, accessRevision: 1 }))
  await expect(pending).resolves.toBe(!navigate)
  expect(store.$.value.access).toEqual(newer)
  expect(store.$.value.pendingSelection).toBeUndefined()
  expect(store.$.value.savingProviderId).toBeUndefined()
  expect(onSaved).toHaveBeenCalledTimes(navigate ? 0 : 1)
  store.dispose()
})

it('batches missing providers, preserves successful results and retries only the failed provider', async () => {
  const client = new WorkbenchClient(vi.fn())
  vi.spyOn(client, 'getConnectorAccess').mockResolvedValue(initial)
  const candidates = vi.spyOn(client, 'listProviderAccessBindingCandidates').mockResolvedValue({
    version: 1,
    results: [
      { providerId: 'mail', candidates: [], mode: 'selectable', version: 1 },
      { providerId: 'github', error: { code: 'connector.unavailable', message: 'Unavailable' } },
    ],
  })
  const store = new ConnectorAccessStore(client, vi.fn())
  try {
    await store.load('flow')
    const pending = store.loadCandidates(['mail', 'github', 'mail'])
    await store.loadCandidates(['mail', 'github'])
    await pending
    expect(candidates).toHaveBeenCalledExactlyOnceWith('flow', ['mail', 'github'], expect.any(AbortSignal))
    const mail = store.$.value.candidates.mail
    expect(mail?.candidates).toEqual([])
    expect(store.$.value.candidateErrors).toEqual(['github'])
    await store.loadCandidates(['mail', 'github'])
    expect(candidates).toHaveBeenCalledTimes(1)
    candidates.mockResolvedValue({ version: 1, results: [{ providerId: 'github', candidates: [], mode: 'selectable', version: 1 }] })
    await store.loadCandidates(['github'], true)
    expect(candidates).toHaveBeenLastCalledWith('flow', ['github'], expect.any(AbortSignal))
    expect(store.$.value.candidates.mail).toBe(mail)
    expect(store.$.value.candidateErrors).toEqual([])
    candidates.mockResolvedValue({ version: 1, results: [{ providerId: 'slack', candidates: [], mode: 'selectable', version: 1 }] })
    await store.loadCandidates(['mail', 'github', 'slack'])
    expect(candidates).toHaveBeenLastCalledWith('flow', ['slack'], expect.any(AbortSignal))
  } finally {
    store.dispose()
  }
})

it.each(['success', 'failure'] as const)('waits for overlapping candidate queries through %s without duplicating requests', async (outcome) => {
  const client = new WorkbenchClient(vi.fn())
  vi.spyOn(client, 'getConnectorAccess').mockResolvedValue(initial)
  const delayed = Promise.withResolvers<Awaited<ReturnType<WorkbenchClient['listProviderAccessBindingCandidates']>>>()
  const candidates = vi
    .spyOn(client, 'listProviderAccessBindingCandidates')
    .mockReturnValueOnce(delayed.promise)
    .mockResolvedValue({
      version: 1,
      results: [{ providerId: 'github', candidates: [], mode: 'selectable', version: 1 }],
    })
  const store = new ConnectorAccessStore(client, vi.fn())
  try {
    await store.load('flow')
    const first = store.loadCandidates(['mail'])
    const finished = vi.fn()
    const second = store.loadCandidates(['mail', 'github']).then(finished)
    await vi.waitFor(() => expect(store.$.value.candidates.github).toBeDefined())
    expect(finished).not.toHaveBeenCalled()
    expect(candidates).toHaveBeenCalledTimes(2)
    expect(candidates).toHaveBeenLastCalledWith('flow', ['github'], expect.any(AbortSignal))
    if (outcome == 'success') delayed.resolve({ version: 1, results: [{ providerId: 'mail', candidates: [], mode: 'selectable', version: 1 }] })
    else delayed.reject(new Error('Unavailable'))
    await Promise.all([first, second])
    expect(finished).toHaveBeenCalledOnce()
    expect(store.$.value.loadingCandidates).toEqual([])
    expect(store.$.value.candidateErrors).toEqual(outcome == 'failure' ? ['mail'] : [])
  } finally {
    store.dispose()
  }
})

it('cancels candidate queries when switching Flow and ignores an old response after switching back', async () => {
  const client = new WorkbenchClient(vi.fn())
  vi.spyOn(client, 'getConnectorAccess').mockResolvedValue(initial)
  const delayed = Promise.withResolvers<Awaited<ReturnType<WorkbenchClient['listProviderAccessBindingCandidates']>>>()
  const current = Promise.withResolvers<Awaited<ReturnType<WorkbenchClient['listProviderAccessBindingCandidates']>>>()
  const candidates = vi.spyOn(client, 'listProviderAccessBindingCandidates').mockReturnValueOnce(delayed.promise).mockReturnValueOnce(current.promise)
  const store = new ConnectorAccessStore(client, vi.fn())
  try {
    await store.load('a')
    const pending = store.loadCandidates(['mail'])
    const signal = candidates.mock.calls[0]![2]!
    await store.load('b')
    expect(signal.aborted).toBe(true)
    await store.load('a')
    const reloading = store.loadCandidates(['mail'])
    expect(candidates).toHaveBeenCalledTimes(2)
    delayed.resolve({ version: 1, results: [{ providerId: 'mail', candidates: [], mode: 'selectable', version: 1 }] })
    await pending
    expect(store.$.value.candidates).toEqual({})
    expect(store.$.value.loadingCandidates).toEqual(['mail'])
    const joined = store.loadCandidates(['mail'])
    expect(candidates).toHaveBeenCalledTimes(2)
    current.resolve({ version: 1, results: [{ providerId: 'mail', candidates: [], mode: 'selectable', version: 1 }] })
    await Promise.all([reloading, joined])
    expect(store.$.value.candidates.mail?.candidates).toEqual([])
    expect(store.$.value.loadingCandidates).toEqual([])
  } finally {
    store.dispose()
  }
})

it.each([true, false])('selects only an eligible default account when adding a service (default: %s)', async (isDefault) => {
  const client = new WorkbenchClient(vi.fn())
  const candidate = {
    accessBindingId: 'work',
    connectionId: 'work',
    connectionDisplayName: 'Work',
    providerId: 'mail',
    source: { kind: 'admin-delegation' as const },
    isDefault,
  }
  vi.spyOn(client, 'getConnectorAccess').mockResolvedValue(initial)
  vi.spyOn(client, 'listProviderAccessBindingCandidates').mockResolvedValue({
    results: [{ providerId: 'mail', mode: 'selectable', candidates: [candidate], version: 1 }],
    version: 1,
  })
  const add = vi.spyOn(client, 'addProviderAccessBinding').mockResolvedValue({
    ...initial,
    accessRevision: 1,
    providerIds: ['mail'],
    bindings: [{ ...candidate, status: 'active' }],
  })
  const service = vi.spyOn(client, 'setConnectorService').mockResolvedValue({ ...initial, accessRevision: 1, providerIds: ['mail'] })
  const store = new ConnectorAccessStore(client, vi.fn())
  try {
    await store.load('flow-1')
    expect(await store.setService('mail', true)).toBe(true)
    if (isDefault) {
      expect(add).toHaveBeenCalledWith('flow-1', 'mail', 'work', 0)
      expect(service).not.toHaveBeenCalled()
      expect(store.$.value.access?.bindings[0]?.connectionId).toBe('work')
    } else {
      expect(add).not.toHaveBeenCalled()
      expect(service).toHaveBeenCalledWith('flow-1', 'mail', true, 0)
      expect(store.$.value.access?.bindings).toEqual([])
    }
  } finally {
    store.dispose()
  }
})
