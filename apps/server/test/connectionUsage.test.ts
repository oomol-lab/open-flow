import type { ConnectorAccess } from '@oomol-lab/open-flow/control-api'
import type { FlowDocument } from '@oomol-lab/open-flow/flow-change'

import { providerAccessBindingId } from '@oomol-lab/open-flow/control-api'
import { afterEach, expect, it, vi } from 'vitest'
import { captureConnectorAccess, ImplicitConnectorAccessHost } from '../node/deployment/connector-access.ts'
import { checkCodePermissions, ConnectorClient } from '../node/deployment/connector.ts'

const document: FlowDocument = {
  bindings: {},
  subflows: {},
  graph: { edges: [], nodes: { send: { kind: 'task', taskId: 'send', name: 'Send', inputs: {} } } },
  tasks: { send: { name: 'Send', inputs: [], outputs: [], executor: { kind: 'connector', action: 'mail.send', connectionId: 'account' } } },
}
const access: ConnectorAccess = { version: 1, mode: 'selectable', accessRevision: 0, bindings: [], sharedAccessDigest: 'empty' }
const candidate = {
  providerId: 'mail',
  connectionId: 'account',
  accessBindingId: 'binding',
  connectionDisplayName: 'Work',
  source: { kind: 'admin-delegation' as const },
  permissions: { allActions: true, actionIds: [], proxy: true, configured: false },
}

afterEach(() => vi.unstubAllGlobals())

const success = (data: unknown) => Response.json({ success: true, data })

it('captures only selected node connections without adding Code usage and rejects an unavailable selection', async () => {
  const host = new ImplicitConnectorAccessHost()
  const lookup = vi.spyOn(host, 'listCandidates').mockResolvedValue({
    version: 1,
    results: [
      { version: 1, providerId: 'mail', mode: 'selectable', candidates: [candidate, { ...candidate, connectionId: 'other', accessBindingId: 'other' }] },
    ],
  })
  const snapshot = await captureConnectorAccess(host, 'flow', document, access)
  expect(snapshot.sharedBindings).toEqual([])
  expect(snapshot.selectedBindings).toEqual([
    {
      providerId: 'mail',
      connectionId: 'account',
      accessBindingId: 'binding',
      connectionDisplayName: 'Work',
      source: { kind: 'admin-delegation' },
    },
  ])
  expect(access).not.toHaveProperty('selectedBindings')
  lookup.mockResolvedValue({
    version: 1,
    results: [
      {
        version: 1,
        providerId: 'mail',
        mode: 'selectable',
        candidates: [{ ...candidate, permissions: { ...candidate.permissions, allActions: false, actionIds: ['mail.read'] } }],
      },
    ],
  })
  await expect(captureConnectorAccess(host, 'flow', document, access)).rejects.toMatchObject({ code: 'connector.access-invalid' })
})

it('captures independent Code connections in root graphs and Subflows', async () => {
  const host = new ImplicitConnectorAccessHost()
  vi.spyOn(host, 'listCandidates').mockResolvedValue({
    version: 1,
    results: [{ version: 1, providerId: 'mail', mode: 'selectable', candidates: [candidate] }],
  })
  const code = {
    kind: 'task' as const,
    name: 'Code',
    inputs: {},
    task: {
      name: 'Code',
      moduleId: 'code',
      inputs: [],
      outputs: [],
      capabilities: [{ kind: 'connector' as const, mode: 'independent' as const, actions: [{ action: 'mail.send', connectionId: 'account' }] }],
    },
  }
  const source = {
    ...document,
    graph: { edges: [], nodes: { code } },
    subflows: { child: { name: 'Child', inputs: [], outputs: [], graph: { edges: [], nodes: { code } } } },
  } as FlowDocument
  const snapshot = await captureConnectorAccess(host, 'flow', source, access)
  expect(snapshot.sharedBindings).toEqual([])
  expect(snapshot.selectedBindings).toMatchObject([{ connectionId: 'account', providerId: 'mail' }])
})

it('executes nodes with fixed bindings while denying Code the same account, without resolving a new membership', async () => {
  const identity = { providerId: 'mail', connectionId: 'account', source: { kind: 'admin-delegation' as const } }
  const binding = { ...identity, accessBindingId: await providerAccessBindingId('team', identity), connectionDisplayName: 'Work' }
  const otherIdentity = { ...identity, connectionId: 'other' }
  const otherBinding = { ...otherIdentity, accessBindingId: await providerAccessBindingId('team', otherIdentity), connectionDisplayName: 'Other' }
  const snapshot = {
    version: 2 as const,
    mode: 'selectable' as const,
    sharedAccessDigest: 'empty',
    sharedBindings: [],
    selectedBindings: [binding, otherBinding],
  }
  const request = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input))
    if (url.pathname == '/v1/providers') return success([{ service: 'mail', displayName: 'Mail', authTypes: ['oauth2'] }])
    if (url.pathname == '/v1/apps/services/mail' || url.pathname == '/v1/apps')
      return success([
        { id: 'account', displayName: 'Work', alias: 'work', service: 'mail', status: 'active', isDefault: true },
        { id: 'other', displayName: 'Other', service: 'mail', status: 'active', isDefault: false },
      ])
    if (url.pathname == '/v1/actions/mail.send')
      return init?.method == 'POST'
        ? success({ sent: true })
        : success({ id: 'mail.send', name: 'send', description: 'Send', service: 'mail', inputSchema: { type: 'object' }, outputSchema: { type: 'object' } })
    throw new Error(`Unexpected request: ${url.pathname}`)
  })
  vi.stubGlobal('fetch', request)
  const connector = new ConnectorClient('https://connector.oomol.dev', 'token')
  const context = { flowId: 'flow', teamId: 'team', providerAccess: snapshot, purpose: 'execute' as const, source: 'run' as const }
  const independent = [{ kind: 'connector' as const, mode: 'independent' as const, actions: [{ action: 'mail.send', connectionId: 'account' }] }]
  await expect(checkCodePermissions(independent, connector, { ...context, purpose: 'eligibility', scope: 'shared' })).resolves.toBeUndefined()
  await expect(
    checkCodePermissions([{ kind: 'connector', mode: 'shared' }], connector, { ...context, purpose: 'eligibility', scope: 'shared' }),
  ).resolves.toBeUndefined()
  await expect(
    connector.execute('mail.send', 'account', {}, 'call', new AbortController().signal, {
      ...context,
      scope: 'action',
      action: 'mail.send',
      connectionId: 'account',
    }),
  ).resolves.toEqual({
    sent: true,
  })
  await expect(connector.execute('mail.send', 'account', {}, 'code-call', new AbortController().signal, { ...context, scope: 'shared' })).rejects.toMatchObject(
    {
      code: 'connector.access-required',
    },
  )
  await expect(
    connector.execute('mail.send', undefined, {}, 'missing-selection', new AbortController().signal, { ...context, scope: 'action', action: 'mail.send' }),
  ).rejects.toMatchObject({ code: 'connector.connection-required' })
  await expect(
    connector.execute('mail.send', undefined, {}, 'shared-call', new AbortController().signal, {
      ...context,
      scope: 'shared',
      providerAccess: { ...snapshot, sharedBindings: [binding], selectedBindings: [] },
    }),
  ).resolves.toEqual({ sent: true })
  expect(request.mock.calls.filter(([, init]) => init?.method == 'POST')).toHaveLength(2)
  await expect(
    connector.execute('mail.send', 'other', {}, 'other-call', new AbortController().signal, {
      ...context,
      scope: 'action',
      action: 'mail.send',
      connectionId: 'account',
    }),
  ).rejects.toMatchObject({
    code: 'connector.access-invalid',
  })
  await expect(
    connector.execute('mail.send', 'account', {}, 'unscoped-call', new AbortController().signal, {
      ...context,
      scope: 'selected',
    }),
  ).rejects.toMatchObject({ code: 'connector.access-invalid' })
  await expect(
    connector.execute('mail.delete', 'account', {}, 'wrong-action', new AbortController().signal, {
      ...context,
      scope: 'action',
      action: 'mail.send',
      connectionId: 'account',
    }),
  ).rejects.toMatchObject({ code: 'connector.access-invalid' })
  expect(request.mock.calls.filter(([, init]) => init?.method == 'POST')).toHaveLength(2)
})

it('captures Agent tools, notifications and Trigger proxy usage without Code permissions', async () => {
  const host = new ImplicitConnectorAccessHost()
  const lookup = vi
    .spyOn(host, 'listCandidates')
    .mockResolvedValue({ version: 1, results: [{ version: 1, mode: 'selectable', providerId: 'mail', candidates: [candidate] }] })
  const source: FlowDocument = {
    ...document,
    bindings: {},
    graph: {
      edges: [],
      nodes: {
        agent: { kind: 'task', taskId: 'agent', inputs: {} },
        poll: {
          name: 'Received',
          kind: 'poll',
          connectionId: 'account',
          config: {},
          pollTimes: [],
          definition: {
            type: 'poll',
            provider: 'mail',
            key: 'mail.received',
            name: 'received',
            displayName: 'Received',
            description: '',
            definitionVersion: 2,
            configInputs: [],
            outputs: [],
          },
        },
      },
    },
    tasks: {
      ...document.tasks,
      agent: {
        name: 'Agent',
        inputs: [],
        outputs: [],
        executor: {
          kind: 'agent',
          model: 'model',
          prompt: '',
          maxRounds: 1,
          tools: [{ id: 'send', action: 'mail.send', name: 'Send', connectionId: 'account', inputs: [], approval: false, description: '' }],
          notification: { taskId: 'send', messageHandle: 'message', inputs: {} },
        },
      },
    },
  }
  const captured = await captureConnectorAccess(host, 'flow', source, access)
  expect(captured.sharedBindings).toEqual([])
  expect(captured.selectedBindings).toHaveLength(1)
  lookup.mockResolvedValue({
    version: 1,
    results: [
      {
        version: 1,
        mode: 'selectable',
        providerId: 'mail',
        candidates: [{ ...candidate, permissions: { allActions: false, actionIds: ['mail.send'], proxy: false, configured: false } }],
      },
    ],
  })
  await expect(captureConnectorAccess(host, 'flow', source, access)).rejects.toMatchObject({ code: 'connector.access-invalid' })
})

it('allows actions without accounts with an empty separated snapshot', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input))
      if (url.pathname == '/v1/providers') return success([{ service: 'utility', displayName: 'Utility', authTypes: ['no_auth'] }])
      if (url.pathname == '/v1/actions/utility.echo')
        return init?.method == 'POST'
          ? success({ value: 'ok' })
          : success({
              id: 'utility.echo',
              name: 'echo',
              description: 'Echo',
              service: 'utility',
              inputSchema: { type: 'object' },
              outputSchema: { type: 'object' },
            })
      throw new Error(`Unexpected request: ${url.pathname}`)
    }),
  )
  const connector = new ConnectorClient('https://connector.oomol.dev', 'token')
  for (const scope of ['action', 'shared'] as const) {
    await expect(
      connector.execute('utility.echo', undefined, {}, scope, new AbortController().signal, {
        flowId: 'flow',
        teamId: 'team',
        providerAccess: { version: 2, mode: 'selectable', sharedAccessDigest: 'empty', sharedBindings: [], selectedBindings: [] },
        source: 'run',
        purpose: 'execute',
        scope,
        action: 'utility.echo',
      }),
    ).resolves.toEqual({ value: 'ok' })
  }
})

it('lists a new Flow’s accounts using the complete catalog even when no-auth placeholders are absent from service catalogs', async () => {
  const request = vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input))
    if (url.pathname == '/v1/me/teams') return Response.json({ teams: [{ id: 'team', role: 'creator', status: 'normal', deleted: false }] })
    if (url.pathname == '/v1/apps')
      return success([
        { id: 'gmail-account', service: 'gmail', displayName: 'Gmail', status: 'active', isDefault: true },
        { id: 'utility-placeholder', service: 'utility', displayName: 'Utility', status: 'active', isDefault: true },
      ])
    if (url.pathname == '/v1/apps/services/gmail')
      return success([{ id: 'gmail-account', service: 'gmail', displayName: 'Gmail', status: 'active', isDefault: true }])
    if (url.pathname == '/v1/apps/services/utility') return success([])
    throw new Error(`Unexpected request: ${url.pathname}`)
  })
  vi.stubGlobal('fetch', request)
  const connector = new ConnectorClient('https://connector.oomol.dev', 'token')
  const connections = await connector.listAllConnections(undefined, {
    flowId: 'new-flow',
    teamId: 'team',
    providerAccess: access,
    scope: 'catalog',
    purpose: 'catalog',
    source: 'draft',
  })
  expect(connections.map((connection) => connection.connectionId)).toEqual(['gmail-account', 'utility-placeholder'])
  expect(request.mock.calls.some(([input]) => String(input).includes('/v1/apps/services/'))).toBe(false)
})
