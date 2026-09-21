import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConfiguredConnectorAccessHost } from '../node/deployment/connector-access.ts'
import { ConnectorClient } from '../node/deployment/connector.ts'
import { providerAccessBindingCandidates } from '../node/deployment/provider-access.ts'
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
    await expect(access.listCandidates('operator', 'flow-1', 'example')).resolves.toEqual({
      candidates: [],
      mode: 'implicit',
      providerId: 'example',
      version: 1,
    })
  })

  it('persists only bindings assignable to the OOMOL user from the profile API', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input)
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
    const candidates = await access.listCandidates('local-operator', 'flow-1', 'example')
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
  })

  it('uses the binding for the requested Connection when a Provider has multiple bindings', async () => {
    const aliases: (string | null)[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input)
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
          aliases.push(new Headers(init?.headers).get('x-oo-connector-alias'))
          return Response.json(success('ok'))
        }
        throw new Error(`Unexpected request: ${url}`)
      }),
    )
    const connector = new ConnectorClient('https://connector.oomol.dev', 'token')
    const candidates = await connector.listProviderAccessBindingCandidates('team-1', 'example')
    const access = {
      flowId: 'flow-1',
      providerAccess: {
        accessRevision: 1,
        bindings: candidates.map((candidate) => Object.assign({ status: 'active' as const }, candidate)),
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
    expect(aliases).toEqual(['personal'])
    await expect(connector.execute('example.echo', 'connection-other', {}, 'invocation-2', new AbortController().signal, access)).rejects.toMatchObject({
      code: 'connector.access-invalid',
    })
  })
})
