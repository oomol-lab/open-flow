import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConfiguredConnectorAccessHost } from '../node/deployment/connector-access.ts'
import { ConnectorClient } from '../node/deployment/connector.ts'
import {
  providerAccessBindingCandidates,
  resolveProviderAccessBinding,
  providerAccessAllowsAction,
  providerAccessAllowsProxy,
} from '../node/deployment/provider-access.ts'
import { ConnectorTeamStore } from '../node/storage/connector-team-store.ts'
import { Database } from '../node/storage/database.ts'

const directories: string[] = []
const databases: Database[] = []

afterEach(async () => {
  vi.unstubAllGlobals()
  for (const storage of databases.splice(0)) storage.close()
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })))
})

async function openDatabase(): Promise<Database> {
  const directory = await mkdtemp(path.join(tmpdir(), 'open-flow-provider-access-'))
  directories.push(directory)
  const storage = Database.open(path.join(directory, 'open-flow.sqlite'))
  databases.push(storage)
  storage.connection.prepare('INSERT INTO flow_connector_teams (flow_id, team_id) VALUES (?, ?)').run('flow-1', 'team-1')
  return storage
}

function success(data: unknown): unknown {
  return { data, message: 'OK', meta: {}, success: true }
}

describe('configured Connector access', () => {
  it('projects the team default separately from the connection name', async () => {
    await expect(
      providerAccessBindingCandidates({
        actorId: 'operator',
        connections: [
          {
            connectionId: 'connection-work',
            displayName: 'Work account',
            isDefault: true,
            serviceId: 'example',
            status: 'active',
          },
        ],
        policy: {
          'role::connector-app:connection-work': {
            connector: [
              {
                app: 'connection-work',
                method: 'POST',
                permissionRules: { assignments: {}, rules: [], teamDefault: { actions: ['echo'] } },
                provider: 'example',
              },
            ],
          },
        },
        providerId: 'example',
        teamId: 'team-1',
      }),
    ).resolves.toEqual([
      {
        connectionId: 'connection-work',
        source: { kind: 'policy' as const, ruleId: null },
        accessBindingId: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
        connectionDisplayName: 'Work account',
        isDefault: true,
        permissions: { actionIds: ['example.echo'], allActions: false, configured: false, proxy: false },
        permissionGroupName: null,
        providerId: 'example',
      },
    ])
  })

  it('stays implicit for OpenConnector deployments', async () => {
    const storage = await openDatabase()
    const connector = new ConnectorClient('https://connector.example.com', 'token')
    const access = new ConfiguredConnectorAccessHost(storage, new ConnectorTeamStore(storage.connection), () => connector)

    expect(access.current('flow-1')).toMatchObject({ bindings: [], mode: 'implicit' })
    await expect(access.listCandidates('operator', 'flow-1', ['example'])).resolves.toEqual({
      results: [
        {
          candidates: [],
          mode: 'implicit',
          providerId: 'example',
          version: 1,
        },
      ],
      version: 1,
    })
  })

  it('persists only bindings assignable to the OOMOL user from the profile API', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input)
        if (url == 'https://relation-control.oomol.dev/v1/me/teams')
          return Response.json({ teams: [{ id: 'team-1', role: 'member', status: 'normal', deleted: false }] })
        if (url == 'https://api.oomol.dev/v1/users/profile') return Response.json({ uid: 'oomol-user' })
        if (url == 'https://relation-control.oomol.dev/v1/teams/team-1/app-access') {
          return Response.json({
            'role::connector-app:connection-personal': {
              connector: [
                {
                  app: 'connection-personal',
                  method: 'POST',
                  permissionRules: { assignments: {}, rules: [], teamDefault: { actions: ['echo'] } },
                  provider: 'example',
                },
              ],
            },
            'role::connector-app:connection-work': {
              connector: [
                {
                  app: 'connection-work',
                  method: 'POST',
                  permissionRules: {
                    assignments: { 'oomol-user': 'editor' },
                    rules: [{ actions: ['echo'], id: 'editor', name: 'Editors' }],
                    teamDefault: { actions: [] },
                  },
                  provider: 'example',
                },
              ],
            },
          })
        }
        if (url == 'https://connector.oomol.dev/v1/apps/services/example') {
          return Response.json(
            success([
              { alias: 'personal', displayName: 'Personal account', id: 'connection-personal', isDefault: false, service: 'example', status: 'active' },
              { alias: 'work', displayName: 'Work account', id: 'connection-work', isDefault: true, service: 'example', status: 'active' },
            ]),
          )
        }
        throw new Error(`Unexpected request: ${url}`)
      }),
    )
    const storage = await openDatabase()
    const connector = new ConnectorClient('https://connector.oomol.dev', 'token')
    const teams = new ConnectorTeamStore(storage.connection)
    const access = new ConfiguredConnectorAccessHost(storage, teams, () => connector)

    expect(access.current('flow-1')).toMatchObject({ accessRevision: 0, bindings: [], mode: 'selectable' })
    const batch = await access.listCandidates('local-operator', 'flow-1', ['example'])
    const result = batch.results[0]!
    if ('error' in result) throw new Error(result.error.message)
    const candidates = result
    expect(candidates.candidates).toEqual([
      expect.objectContaining({ connectionDisplayName: 'Personal account', isDefault: false, permissionGroupName: null, providerId: 'example' }),
      expect.objectContaining({ connectionDisplayName: 'Work account', isDefault: true, permissionGroupName: 'Editors', providerId: 'example' }),
    ])
    await expect(access.add('local-operator', 'flow-1', 'example', 'forged', 0)).resolves.toEqual({ kind: 'invalid' })

    const personal = candidates.candidates[0]!
    const work = candidates.candidates[1]!
    const first = await access.add('local-operator', 'flow-1', 'example', personal.accessBindingId, 0)
    expect(first).toMatchObject({
      access: { accessRevision: 1, bindings: [expect.objectContaining({ accessBindingId: personal.accessBindingId })] },
      kind: 'saved',
    })
    if (first.kind == 'saved') expect(first.access.bindings[0]).not.toHaveProperty('permissions')
    const second = await access.add('local-operator', 'flow-1', 'example', work.accessBindingId, 1)
    expect(second).toMatchObject({
      access: {
        accessRevision: 2,
        bindings: expect.arrayContaining([
          expect.objectContaining({ accessBindingId: personal.accessBindingId }),
          expect.objectContaining({ accessBindingId: work.accessBindingId }),
        ]),
      },
      kind: 'saved',
    })
    expect(new ConfiguredConnectorAccessHost(storage, teams, () => connector).current('flow-1')).toEqual(second.kind == 'saved' ? second.access : undefined)
    await expect(access.remove('local-operator', 'flow-1', 'example', personal.accessBindingId, 0)).resolves.toEqual({ kind: 'conflict' })
    await expect(access.remove('local-operator', 'flow-1', 'example', personal.accessBindingId, 2)).resolves.toMatchObject({
      access: { accessRevision: 3, bindings: [expect.objectContaining({ accessBindingId: work.accessBindingId })] },
      kind: 'saved',
    })
    await expect(access.setService('local-operator', 'flow-1', 'example', false, 3)).resolves.toMatchObject({
      kind: 'saved',
      access: { accessRevision: 4, providerIds: [], bindings: [] },
    })
    expect(access.current('flow-1')).toMatchObject({ providerIds: [], bindings: [] })
  })

  it('uses the binding for the requested Connection when a Provider has multiple bindings', async () => {
    const appIds: (string | null)[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input)
        if (url == 'https://relation-control.oomol.dev/v1/me/teams')
          return Response.json({ teams: [{ id: 'team-1', role: 'member', status: 'normal', deleted: false }] })
        if (url == 'https://api.oomol.dev/v1/users/profile') return Response.json({ uid: 'oomol-user' })
        if (url == 'https://relation-control.oomol.dev/v1/teams/team-1/app-access') {
          return Response.json(
            Object.fromEntries(
              ['personal', 'work'].map((name) => [
                `role::connector-app:connection-${name}`,
                {
                  connector: [
                    {
                      app: `connection-${name}`,
                      method: 'POST',
                      permissionRules: { assignments: {}, rules: [], teamDefault: { actions: ['echo'] } },
                      provider: 'example',
                    },
                  ],
                },
              ]),
            ),
          )
        }
        if (url == 'https://connector.oomol.dev/v1/apps/services/example' || url == 'https://connector.oomol.dev/v1/apps') {
          return Response.json(
            success(
              ['personal', 'work'].map((name) => ({
                alias: name,
                displayName: `${name} account`,
                id: `connection-${name}`,
                isDefault: name == 'work',
                service: 'example',
                status: 'active',
              })),
            ),
          )
        }
        if (url == 'https://connector.oomol.dev/v1/actions/example.echo') {
          appIds.push(new Headers(init?.headers).get('x-oo-connector-app-id'))
          return Response.json(success('ok'))
        }
        throw new Error(`Unexpected request: ${url}`)
      }),
    )
    const connector = new ConnectorClient('https://connector.oomol.dev', 'token')
    const batch = await connector.listProviderAccessBindingCandidates('team-1', ['example'])
    const result = batch.results[0]!
    if ('error' in result) throw new Error(result.error.message)
    const candidates = result
    const access = {
      flowId: 'flow-1',
      providerAccess: {
        accessRevision: 1,
        bindings: candidates.candidates.map((candidate) => Object.assign({ status: 'active' as const }, candidate)),
        mode: 'selectable' as const,
        providerAccessDigest: 'multiple',
        version: 1 as const,
      },
      purpose: 'execute' as const,
      source: 'run' as const,
      teamId: 'team-1',
    }

    const requests = vi.mocked(fetch)
    requests.mockClear()
    await expect(connector.listConnections('example', undefined, access)).resolves.toHaveLength(2)
    expect(requests.mock.calls.filter(([url]) => String(url) == 'https://connector.oomol.dev/v1/apps/services/example')).toHaveLength(1)
    requests.mockClear()
    await expect(connector.listAllConnections(undefined, access)).resolves.toHaveLength(2)
    expect(requests.mock.calls.filter(([url]) => String(url).startsWith('https://connector.oomol.dev/v1/apps'))).toHaveLength(1)
    await expect(connector.execute('example.echo', 'connection-personal', {}, 'invocation-1', new AbortController().signal, access)).resolves.toBe('ok')
    expect(appIds).toEqual(['connection-personal'])
    await expect(connector.execute('example.echo', 'connection-other', {}, 'invocation-2', new AbortController().signal, access)).rejects.toMatchObject({
      code: 'connector.access-invalid',
    })
  })
})

it('persists an unconnected service across database reopen and removes it with revision checks', async () => {
  const storage = await openDatabase()
  const connector = new ConnectorClient('https://connector.oomol.dev', 'token')
  vi.spyOn(connector, 'listProviders').mockResolvedValue([{ serviceId: '2chat', serviceName: '2Chat' }])
  const access = new ConfiguredConnectorAccessHost(storage, new ConnectorTeamStore(storage.connection), () => connector)
  const before = access.current('flow-1')
  const added = await access.setService('actor', 'flow-1', '2chat', true, 0)
  expect(added).toMatchObject({
    kind: 'saved',
    access: { providerIds: ['2chat'], bindings: [], accessRevision: 1, providerAccessDigest: before.providerAccessDigest },
  })
  storage.close()
  databases.splice(databases.indexOf(storage), 1)
  const reopened = Database.open(path.join(directories.at(-1)!, 'open-flow.sqlite'))
  databases.push(reopened)
  const restored = new ConfiguredConnectorAccessHost(reopened, new ConnectorTeamStore(reopened.connection), () => connector)
  expect(restored.current('flow-1')).toMatchObject({ providerIds: ['2chat'], bindings: [] })
  expect(restored.current('other-flow')).toMatchObject({ providerIds: [], bindings: [] })
  expect(await restored.setService('actor', 'flow-1', '2chat', false, 0)).toEqual({ kind: 'conflict' })
  expect(await restored.setService('actor', 'flow-1', '2chat', false, 1)).toMatchObject({
    kind: 'saved',
    access: { providerIds: [], bindings: [], accessRevision: 2 },
  })
  expect(await restored.setService('actor', 'flow-1', 'unknown', true, 2)).toEqual({ kind: 'invalid' })
})

it('keeps a named team-default rule restricted and never falls back after its deletion', async () => {
  const permissionRules = {
    assignments: { reader: 'team-default' },
    rules: [{ id: 'team-default', name: 'Readers', actions: ['read'] }],
    teamDefault: {},
  }
  const input = {
    teamId: 'team-1',
    providerId: 'example',
    connections: [{ connectionId: 'account', displayName: 'Account', isDefault: true, serviceId: 'example', status: 'active' as const }],
    policy: { 'role::connector-app:account': { connector: [{ method: 'POST', provider: 'example', permissionRules }] } },
  }
  const [reader] = await providerAccessBindingCandidates({ ...input, actorId: 'reader' })
  const [defaultAccess] = await providerAccessBindingCandidates({ ...input, actorId: 'other-member' })
  expect(reader!.source).toEqual({ kind: 'policy', ruleId: 'team-default' })
  expect(defaultAccess!.source).toEqual({ kind: 'policy', ruleId: null })
  expect(reader!.accessBindingId).not.toBe(defaultAccess!.accessBindingId)
  const resolved = await resolveProviderAccessBinding({ ...input, ...reader! })
  expect(resolved!.accessGrant).toEqual({ actions: ['read'] })
  expect(providerAccessAllowsAction(resolved!, { actionId: 'example.delete', serviceId: 'example' })).toBe(false)
  expect(providerAccessAllowsProxy(resolved!)).toBe(false)
  await expect(resolveProviderAccessBinding({ ...input, ...defaultAccess! })).resolves.toMatchObject({ accessGrant: {} })
  await expect(resolveProviderAccessBinding({ ...input, ...reader!, source: defaultAccess!.source })).resolves.toBeUndefined()
  await expect(resolveProviderAccessBinding({ ...input, ...reader!, connectionId: 'other-account' })).resolves.toBeUndefined()
  await expect(resolveProviderAccessBinding({ ...input, ...reader!, teamId: 'other-team' })).resolves.toBeUndefined()
  await expect(resolveProviderAccessBinding({ ...input, ...defaultAccess!, policy: {} })).resolves.toBeUndefined()
  permissionRules.rules = []
  await expect(resolveProviderAccessBinding({ ...input, ...reader! })).resolves.toBeUndefined()
})

it('reads mixed old and current saved authorization without losing valid bindings and permits removing the old one', async () => {
  const storage = await openDatabase()
  const connector = new ConnectorClient('https://connector.oomol.dev', 'token')
  const access = new ConfiguredConnectorAccessHost(storage, new ConnectorTeamStore(storage.connection), () => connector)
  const valid = {
    accessBindingId: 'new',
    providerId: 'example',
    connectionId: 'account',
    source: { kind: 'policy', ruleId: null },
    connectionDisplayName: 'Current',
    permissionGroupName: null,
    status: 'active',
  }
  const old = { accessBindingId: 'old', providerId: 'example', connectionDisplayName: 'Old', status: 'active' }
  storage.connection
    .prepare('INSERT INTO flow_provider_access (flow_id, access_revision, bindings_json, provider_access_digest) VALUES (?, ?, ?, ?)')
    .run('flow-1', 3, JSON.stringify([old, valid, null]), 'saved')
  expect(access.current('flow-1')).toMatchObject({
    accessRevision: 3,
    discardedBindingCount: 1,
    bindings: [{ accessBindingId: 'old', source: null, connectionId: null, status: 'invalid' }, valid],
  })
  await expect(access.remove('actor', 'flow-1', 'example', 'old', 3)).resolves.toMatchObject({
    kind: 'saved',
    access: { accessRevision: 4, bindings: [valid] },
  })
  const invalid = { ...old, connectionId: null, source: null } as const
  await expect(resolveProviderAccessBinding({ ...invalid, connections: [], policy: {}, teamId: 'team-1' })).resolves.toBeUndefined()
})

it.each(['creator', 'admin'])('offers %s delegation without policy and retains it after membership changes', async (role) => {
  let currentRole = role
  let active = true
  const remote = vi.fn(async (input: string | URL | Request) => {
    const url = String(input)
    if (url.endsWith('/v1/me/teams')) return Response.json({ teams: [{ id: 'team-1', role: currentRole, status: 'normal', deleted: false }] })
    if (url.endsWith('/v1/users/profile')) return Response.json({ uid: 'member' })
    if (url.endsWith('/app-access')) return Response.json({})
    if (url.endsWith('/v1/apps/services/example'))
      return Response.json(
        success([
          { id: 'active', displayName: 'Work', service: 'example', status: active ? 'active' : 'disconnected', isDefault: true },
          { id: 'disconnected', displayName: 'Old', service: 'example', status: 'disconnected', isDefault: false },
        ]),
      )
    throw new Error(`Unexpected request: ${url}`)
  })
  vi.stubGlobal('fetch', remote)
  const storage = await openDatabase()
  const connector = new ConnectorClient('https://connector.oomol.dev', 'token')
  const access = new ConfiguredConnectorAccessHost(storage, new ConnectorTeamStore(storage.connection), () => connector)
  const batch = await access.listCandidates('operator', 'flow-1', ['example'])
  const result = batch.results[0]!
  if ('error' in result) throw new Error(result.error.message)
  const candidates = result
  expect(candidates.candidates).toHaveLength(1)
  const candidate = candidates.candidates[0]!
  expect(candidate).toMatchObject({ source: { kind: 'admin-delegation' }, connectionId: 'active', permissions: { allActions: true, proxy: true } })
  expect(remote.mock.calls.some(([url]) => String(url).endsWith('/app-access') || String(url).endsWith('/v1/users/profile'))).toBe(false)
  const saved = await access.add('operator', 'flow-1', 'example', candidate.accessBindingId, 0)
  expect(saved.kind).toBe('saved')
  if (saved.kind != 'saved') throw new Error('Expected saved delegation')
  currentRole = 'member'
  await expect(access.add('operator', 'flow-1', 'example', candidate.accessBindingId, 1)).resolves.toEqual({ kind: 'invalid' })
  remote.mockClear()
  const context = { flowId: 'flow-1', teamId: 'team-1', providerAccess: saved.access, purpose: 'execute' as const, source: 'run' as const }
  await expect(connector.listConnections('example', undefined, context)).resolves.toHaveLength(1)
  expect(remote.mock.calls.every(([url]) => String(url).endsWith('/v1/apps/services/example'))).toBe(true)
  active = false
  await expect(connector.listConnections('example', undefined, context)).rejects.toMatchObject({ code: 'connector.access-invalid' })
})

it.each([
  { teams: [] },
  { teams: [{ id: 'team-1', role: 'admin', deleted: true, status: 'normal' }] },
  { teams: [{ id: 'team-1', role: 'admin', deleted: false, status: 'disabled' }] },
  { teams: [{ id: 'team-1', role: 'unknown', deleted: false, status: 'normal' }] },
])('rejects unverified Team membership', async (membership) => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json(membership)),
  )
  const connector = new ConnectorClient('https://connector.oomol.dev', 'token')
  await expect(connector.listProviderAccessBindingCandidates('team-1', ['example'])).rejects.toMatchObject({ code: 'connector.access-invalid' })
  expect(fetch).toHaveBeenCalledTimes(1)
})

it('does not confuse a team-admin policy rule with administrator delegation', async () => {
  const input = {
    actorId: 'member',
    teamId: 'team-1',
    providerId: 'example',
    connections: [{ connectionId: 'account', displayName: 'Account', isDefault: true, serviceId: 'example', status: 'active' as const }],
    policy: {
      'role::connector-app:account': {
        connector: [
          {
            method: 'POST',
            provider: 'example',
            permissionRules: {
              teamDefault: {},
              rules: [{ id: 'team-admin', name: 'Readers', actions: ['read'] }],
              assignments: { member: 'team-admin' },
            },
          },
        ],
      },
    },
  }
  const [member] = await providerAccessBindingCandidates(input)
  const [admin] = await providerAccessBindingCandidates({ ...input, teamAdmin: true })
  expect(member!.accessBindingId).not.toBe(admin!.accessBindingId)
  const resolved = await resolveProviderAccessBinding({ ...input, ...member! })
  expect(resolved!.accessGrant).toEqual({ actions: ['read'] })
  expect(providerAccessAllowsProxy(resolved!)).toBe(false)
  await expect(resolveProviderAccessBinding({ ...input, ...member!, source: admin!.source })).resolves.toBeUndefined()
  await expect(resolveProviderAccessBinding({ ...input, ...admin!, source: member!.source })).resolves.toBeUndefined()
})

it.each([Response.json({ teams: 'invalid' }), new Response(null, { status: 503 })])(
  'does not grant delegation when membership cannot be verified',
  async (response) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response),
    )
    const connector = new ConnectorClient('https://connector.oomol.dev', 'token')
    await expect(connector.listProviderAccessBindingCandidates('team-1', ['example'])).rejects.toMatchObject({ code: 'connector.unavailable' })
    expect(fetch).toHaveBeenCalledTimes(1)
  },
)
