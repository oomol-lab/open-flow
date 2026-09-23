import type { ConnectorAccess, ConnectorAction, ConnectorConnection, ConnectorProvider } from '@oomol-lab/open-flow/control-api'
import type { ControlApiConformanceHarness } from '@oomol-lab/open-flow/control-api-conformance'
import type { PollDefinition } from '@oomol-lab/open-flow/poll-trigger'
import type { ConnectorAccessHost } from '../node/deployment/connector-access.ts'
import type { ConnectorHost } from '../node/deployment/connector.ts'

import { ControlClient } from '@oomol-lab/open-flow/control-api'
import {
  connectorControlApiConformanceCases,
  connectorScopeControlApiConformanceCases,
  draftRepairControlApiConformanceCases,
  controlApiConformanceCases,
  controlRecoveryConformanceCases,
  eventSourceControlApiConformanceCases,
  runResultControlApiConformanceCases,
  pollControlApiConformanceCases,
  publicationControlApiConformanceCases,
  selectableConnectorAccessControlApiConformanceCases,
  triggerControlApiConformanceCases,
} from '@oomol-lab/open-flow/control-api-conformance'
import { digestBytes } from '@oomol-lab/open-flow/flow-encoding'
import { eventsPollOutputs } from '@oomol-lab/open-flow/poll-trigger'
import { triggerDefinitions } from '@oomol-lab/open-flow/provider-triggers'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it, vi } from 'vitest'
import { ConnectorClient, ConnectorTaskError } from '../node/deployment/connector.ts'
import { Database } from '../node/storage/database.ts'
import { Store } from '../node/storage/store.ts'
import { createServerApp } from '../node/transport/http.ts'
import { createConnectorHost } from './connectorHost.ts'
import { closeService, openService, startService } from './serviceFixture.ts'

const connectorProvider: ConnectorProvider = {
  icon: 'https://connector.example/icons/mail.svg',
  serviceId: 'mail',
  serviceName: 'Mail',
}

const connectorConnection: ConnectorConnection = {
  connectionId: 'mail-work',
  displayName: 'Work mailbox',
  isDefault: true,
  serviceId: 'mail',
  status: 'active',
}

const connectorAction: ConnectorAction = {
  actionId: 'mail.send',
  authenticated: true,
  description: 'Send one message.',
  inputs: {
    to: {
      description: 'Recipient.',
      jsonSchema: { description: 'Recipient.', type: 'string' },
      nullable: false,
    },
  },
  name: 'send',
  outputs: {
    message: {
      jsonSchema: { type: 'object' },
      nullable: false,
    },
  },
  serviceId: 'mail',
  serviceName: 'Mail',
}

const eventConnection: ConnectorConnection = {
  connectionId: 'feishu-app',
  providerAccountId: 'cli_conformance',
  displayName: 'Feishu',
  isDefault: true,
  serviceId: 'feishu_app_bot',
  status: 'active',
}
const linear = triggerDefinitions.find((item) => item.snapshot.key == 'linear.on_issue_changed')!
const pollDefinition: PollDefinition = {
  snapshot: { ...linear.snapshot, type: 'poll' },
  buildOutputs: eventsPollOutputs,
  async poll({ checkpoint }) {
    return checkpoint == null
      ? { checkpoint: 'baseline', events: [] }
      : { checkpoint: 'preview', events: [{ dedupeKey: 'preview', payload: { value: 'event' } }], filtered: 2, hasMore: true }
  },
}
const teamId = '72b2a2dc-6f4f-4423-9d34-24b5bd10634a'

async function createHarness(
  start = false,
  connectorAccess?: ConnectorAccessHost,
  connectorOverrides: Partial<ConnectorHost> = {},
): Promise<ControlApiConformanceHarness & { readonly file: string; restart(): Promise<void> }> {
  const directory = await mkdtemp(path.join(tmpdir(), 'open-flow-control-conformance-'))
  const file = path.join(directory, 'open-flow.sqlite')
  const connector = createConnectorHost({
    getAction: async (actionId) => {
      if (actionId != connectorAction.actionId) throw new ConnectorTaskError('connector.action-not-found', 'The Connector Action was not found.')
      return connectorAction
    },
    listActions: async () => [connectorAction],
    listAllConnections: async () => [connectorConnection],
    listConnections: async (serviceId) =>
      serviceId == 'feishu_app_bot'
        ? [eventConnection]
        : serviceId == 'linear'
          ? [{ ...connectorConnection, serviceId: 'linear' }]
          : serviceId == connectorConnection.serviceId
            ? [connectorConnection]
            : [],
    proxy: async () => ({
      status: 200,
      data: { data: { teams: { nodes: [{ id: teamId, name: 'Engineering', key: 'ENG' }], pageInfo: { hasNextPage: false } } } },
    }),
    listProviders: async () => [connectorProvider],
    ready: async () => true,
    searchActions: async () => [connectorAction],
    ...connectorOverrides,
  })
  let now = Date.UTC(2026, 7, 22)
  const open = async () => {
    const service = await openService(file, {
      triggerDefinitions: triggerDefinitions.map((definition) => (definition.snapshot.key == pollDefinition.snapshot.key ? pollDefinition : definition)),
      capabilities: {
        connector: connector == null ? undefined : () => connector,
        connectorAccess,
        connectorConsoleOrigin: () => new URL('https://connector.example'),
      },
      clock: () => {
        now += 1_000
        return now
      },
    })
    if (start) await startService(service)
    return service
  }
  const options = {
    resolveControlActor: (request: Request) => (request.headers.get('authorization') == 'Bearer control-api-conformance' ? 'server-operator' : undefined),
  }
  let service = await open()
  let app = createServerApp(service, options)
  return {
    file,
    async restart() {
      await closeService(service)
      service = await open()
      app = createServerApp(service, options)
    },
    async dispose() {
      await closeService(service)
      await rm(directory, { force: true, recursive: true })
    },
    origin: 'http://server.local',
    async request(request) {
      const headers = new Headers(request.headers)
      headers.set('authorization', 'Bearer control-api-conformance')
      if (request.method == 'GET' && new URL(request.url).pathname.includes('/publish-operations/')) {
        await service.tickListeners()
        await service.tickMaintenance()
      }
      const response = await app.request(new Request(request, { headers }))
      if (request.method == 'POST' && new URL(request.url).pathname.endsWith('/pause') && response.ok) {
        await closeService(service)
        service = await open()
        app = createServerApp(service, options)
      }
      return response
    },
  }
}

function selectableConnectorAccess(): ConnectorAccessHost {
  const accesses = new Map<string, ConnectorAccess>()
  const current = (flowId: string): ConnectorAccess =>
    accesses.get(flowId) ?? { accessRevision: 0, bindings: [], mode: 'selectable', providerAccessDigest: 'selectable:0', version: 1 }
  return {
    removeConnection(flowId, connectionId, expectedAccessRevision) {
      const access = current(flowId)
      if (access.accessRevision != expectedAccessRevision) return { kind: 'conflict' }
      const next = {
        ...access,
        accessRevision: access.accessRevision + 1,
        bindings: access.bindings.filter((binding) => binding.connectionId != connectionId),
        providerAccessDigest: `selectable:${access.accessRevision + 1}`,
      }
      accesses.set(flowId, next)
      return { kind: 'saved', access: next }
    },
    async setService(_actorId, flowId, providerId, selected, expectedAccessRevision) {
      const access = current(flowId)
      if (access.accessRevision != expectedAccessRevision) return { kind: 'conflict' }
      const next = {
        ...access,
        accessRevision: access.accessRevision + 1,
        providerIds: selected ? [...new Set([...(access.providerIds ?? []), providerId])] : (access.providerIds ?? []).filter((id) => id != providerId),
        bindings: selected ? access.bindings : access.bindings.filter((binding) => binding.providerId != providerId),
        providerAccessDigest:
          !selected && access.bindings.some((binding) => binding.providerId == providerId)
            ? `selectable:${access.accessRevision + 1}`
            : access.providerAccessDigest,
      }
      accesses.set(flowId, next)
      return { kind: 'saved', access: next }
    },
    async remove(_actorId, flowId, providerId, accessBindingId, expectedAccessRevision) {
      const access = current(flowId)
      if (access.accessRevision != expectedAccessRevision) return { kind: 'conflict' }
      if (!access.bindings.some((binding) => binding.providerId == providerId && binding.accessBindingId == accessBindingId)) return { kind: 'invalid' }
      const next = {
        ...access,
        accessRevision: access.accessRevision + 1,
        bindings: access.bindings.filter((binding) => binding.providerId != providerId || binding.accessBindingId != accessBindingId),
        providerAccessDigest: `selectable:${access.accessRevision + 1}`,
      }
      accesses.set(flowId, next)
      return { access: next, kind: 'saved' }
    },
    current,
    delete(flowId) {
      accesses.delete(flowId)
      return true
    },
    async listCandidates(_actorId, _flowId, providerIds) {
      return {
        results: providerIds.map((providerId) => ({
          candidates:
            providerId == 'mail'
              ? [
                  {
                    connectionId: 'fixture-account',
                    source: { kind: 'policy' as const, ruleId: 'Editors' },
                    accessBindingId: 'editors',
                    connectionDisplayName: 'Work account',
                    permissionGroupName: 'Editors',
                    providerId,
                  },
                ]
              : [],
          mode: 'selectable',
          providerId,
          version: 1,
        })),
        version: 1,
      }
    },
    read(_actorId, flowId) {
      return current(flowId)
    },
    async add(_actorId, flowId, providerId, accessBindingId, expectedAccessRevision) {
      const access = current(flowId)
      if (access.accessRevision != expectedAccessRevision) return { kind: 'conflict' }
      if (providerId != 'mail' || accessBindingId != 'editors') return { kind: 'invalid' }
      const next = {
        ...access,
        accessRevision: access.accessRevision + 1,
        bindings: [
          ...access.bindings.filter((binding) => binding.accessBindingId != accessBindingId),
          {
            connectionId: 'fixture-account',
            source: { kind: 'policy' as const, ruleId: 'Editors' },
            accessBindingId,
            connectionDisplayName: 'Work account',
            permissionGroupName: 'Editors',
            providerId,
            status: 'active' as const,
          },
        ],
        providerAccessDigest: `selectable:${access.accessRevision + 1}`,
      }
      accesses.set(flowId, next)
      return { access: next, kind: 'saved' }
    },
  }
}

describe('Server P0 Control API conformance', () => {
  for (const conformance of controlApiConformanceCases) {
    it(conformance.name, async () => {
      const harness = await createHarness(conformance.runtime)
      try {
        await conformance.verify(harness)
      } finally {
        await harness.dispose()
      }
    })
  }
})

describe('Server P1 Publication Control API conformance', () => {
  for (const conformance of publicationControlApiConformanceCases) {
    it(conformance.name, async () => {
      const harness = await createHarness()
      try {
        await conformance.verify(harness)
      } finally {
        await harness.dispose()
      }
    })
  }
})

describe('Server P2 Trigger Control API conformance', () => {
  for (const conformance of triggerControlApiConformanceCases) {
    it(conformance.name, async () => {
      const harness = await createHarness()
      try {
        await conformance.verify(harness)
      } finally {
        await harness.dispose()
      }
    })
  }
})

describe('Server P3 Connector Control API conformance', () => {
  for (const conformance of connectorControlApiConformanceCases) {
    it(conformance.name, async () => {
      const harness = await createHarness()
      try {
        await conformance.verify(harness)
      } finally {
        await harness.dispose()
      }
    })
  }
})

describe('Server selectable Connector access conformance', () => {
  for (const conformance of selectableConnectorAccessControlApiConformanceCases({
    connectionId: 'fixture-account',
    source: { kind: 'policy' as const, ruleId: 'Editors' },
    accessBindingId: 'editors',
    connectionDisplayName: 'Work account',
    permissionGroupName: 'Editors',
    providerId: 'mail',
  })) {
    it(conformance.name, async () => {
      const harness = await createHarness(false, selectableConnectorAccess())
      try {
        await conformance.verify(harness)
      } finally {
        await harness.dispose()
      }
    })
  }
})

describe('Server recovery conformance', () => {
  for (const conformance of controlRecoveryConformanceCases) {
    it(conformance.name, async () => {
      const harness = await createHarness()
      try {
        await conformance.verify(harness)
      } finally {
        await harness.dispose()
      }
    })
  }
})

describe('Server event source Control API conformance', () => {
  for (const conformance of eventSourceControlApiConformanceCases({
    connection: eventConnection,
    teamId: null,
    connectionPageUrl: 'https://connector.example/providers/feishu_app_bot',
  })) {
    it(conformance.name, async () => {
      const harness = await createHarness()
      try {
        await conformance.verify(harness)
      } finally {
        await harness.dispose()
      }
    })
  }
})

describe('Server Poll Control API conformance', () => {
  for (const conformance of pollControlApiConformanceCases({
    definition: pollDefinition.snapshot,
    connectionId: connectorConnection.connectionId,
    config: { teamId },
    field: 'teamId',
    options: [{ value: teamId, label: 'Engineering (ENG)' }],
    preview: { events: [{ value: 'event' }], filtered: 2, hasMore: true, version: 1 },
  })) {
    it(conformance.name, async () => {
      const harness = await createHarness()
      try {
        await conformance.verify(harness)
      } finally {
        await harness.dispose()
      }
    })
  }
})

it('Server stored tool result Control API conformance', async () => {
  const harness = await createHarness()
  try {
    const api = new ControlClient((route, init) => harness.request(new Request(new URL(route, harness.origin), init)))
    const flow = await api.createFlow('Stored results', 'stored-results')
    const changed = await api.changeDraft(flow.flowId, flow.draftRevisionId, [
      { kind: 'graph.node.create', nodeId: 'start', target: { kind: 'flow' }, node: { kind: 'manual', name: 'Start' } },
    ])
    const run = await api.createDraftRun(flow.flowId, changed.revision.revisionId, { trigger: { nodeId: 'start', outputs: {} }, idempotencyKey: 'results-run' })
    const other = await api.createDraftRun(flow.flowId, changed.revision.revisionId, {
      trigger: { nodeId: 'start', outputs: {} },
      idempotencyKey: 'other-results-run',
    })
    const database = Database.open(harness.file)
    try {
      const store = new Store(database)
      if (store.runs.claim()?.runId != run.runId) throw new Error('Expected result Run claim.')
      store.runs.start(run.runId, { kind: 'run.started', payload: { flowId: flow.flowId, scopeId: run.runId } })
      const value = { rows: [10, 20, 30] }
      const result = store.results.put(run.runId, 'agent', 'data', { id: 'fetch', kind: 'connector', action: 'data.fetch' }, {}, value)
      const results = [result]
      for (let index = 0; index < 50; index++) results.push(store.results.put(run.runId, 'agent', `code-${index}`, { id: 'run_code', kind: 'code' }, {}, index))
      for (const conformance of runResultControlApiConformanceCases({ runId: run.runId, otherRunId: other.runId, results, resultId: result.resultId, value })) {
        await conformance.verify(harness)
      }
    } finally {
      database.close()
    }
  } finally {
    await harness.dispose()
  }
})

it('Server Connector Flow scope conformance', async () => {
  const scopes = new Map<string, readonly ConnectorConnection[]>()
  const harness = await createHarness(false, undefined, {
    listAllConnections: async (_signal, access) => scopes.get(access?.flowId ?? '') ?? [],
    listConnections: async (serviceId, _signal, access) => (scopes.get(access?.flowId ?? '') ?? []).filter((item) => item.serviceId == serviceId),
  })
  try {
    const api = new ControlClient((route, init) => harness.request(new Request(new URL(route, harness.origin), init)))
    const first = await api.createFlow('First scope', 'first-scope')
    const second = await api.createFlow('Second scope', 'second-scope')
    scopes.set(first.flowId, [connectorConnection])
    scopes.set(second.flowId, [])
    for (const conformance of connectorScopeControlApiConformanceCases({
      scopes: [
        { flowId: first.flowId, connections: [connectorConnection] },
        { flowId: second.flowId, connections: [] },
      ],
    }))
      await conformance.verify(harness)
  } finally {
    await harness.dispose()
  }
})

it('Server unreadable Draft repair conformance', async () => {
  const harness = await createHarness()
  try {
    const api = new ControlClient((route, init) => harness.request(new Request(new URL(route, harness.origin), init)))
    const flow = await api.createFlow('Unreadable Draft', 'unreadable-draft')
    const changed = await api.changeDraft(flow.flowId, flow.draftRevisionId, [
      { kind: 'graph.node.create', nodeId: 'start', target: { kind: 'flow' }, node: { kind: 'manual', name: 'Start' } },
    ])
    const draft = await api.getDraft(flow.flowId)
    const stored = {
      ...draft.content,
      modelVersion: 1,
      kind: 'open-flow-flow-revision',
      version: 1,
      document: {
        ...draft.content.document,
        graph: { ...draft.content.document.graph, nodes: { ...draft.content.document.graph.nodes, broken: { kind: 'unknown' } } },
      },
    }
    const content = JSON.stringify(stored)
    const database = new DatabaseSync(harness.file)
    try {
      const delta = database.prepare('SELECT 1 FROM revision_deltas WHERE revision_id = ?').get(changed.revision.revisionId)
      if (delta != null) {
        database
          .prepare('INSERT INTO revisions (revision_id, digest, content) VALUES (?, ?, ?)')
          .run(changed.revision.revisionId, changed.revision.digest, JSON.stringify(draft.content))
        database.prepare('DELETE FROM revision_deltas WHERE revision_id = ?').run(changed.revision.revisionId)
      }
      database
        .prepare('UPDATE revisions SET content = ?, digest = ? WHERE revision_id = ?')
        .run(content, await digestBytes(new TextEncoder().encode(content)), changed.revision.revisionId)
      for (const conformance of draftRepairControlApiConformanceCases({ flowId: flow.flowId, revisionId: draft.revisionId, content: draft.content })) {
        await conformance.verify(harness)
      }
      const original = database.prepare('SELECT content FROM revisions WHERE revision_id = ?').get(draft.revisionId)
      if (original?.content != content) throw new Error('Repair mutated original Revision.')
    } finally {
      database.close()
    }
  } finally {
    await harness.dispose()
  }
})

it.each([
  ['missing repair route', controlApiConformanceCases.find((item) => item.name.startsWith('repairs a Draft'))!, '/draft/repair', 'missing'],
  [
    'missing event source route',
    eventSourceControlApiConformanceCases({
      connection: eventConnection,
      teamId: null,
      connectionPageUrl: 'https://connector.example/providers/feishu_app_bot',
    })[0]!,
    '/v1/event-sources',
    'missing',
  ],
  ['missing activities route', triggerControlApiConformanceCases.find((item) => item.name.startsWith('operates and retires'))!, '/activities', 'missing'],
  [
    'incompatible Connector response',
    connectorControlApiConformanceCases.find((item) => item.name.startsWith('projects the deployment'))!,
    '/connector/providers',
    'version',
  ],
  ['incompatible Trigger catalog', triggerControlApiConformanceCases[0]!, '/trigger-keys/catalog', 'version'],
  [
    'missing conditional responses',
    connectorControlApiConformanceCases.find((item) => item.name.startsWith('projects the deployment'))!,
    '/connector/providers',
    'conditional',
  ],
] as const)('public conformance detects %s', async (_name, conformance, route, fault) => {
  const harness = await createHarness()
  let injected = false
  try {
    await expect(
      conformance.verify({
        ...harness,
        async request(request) {
          if (!new URL(request.url).pathname.includes(route)) return harness.request(request)
          injected = true
          if (fault == 'missing') return Response.json({ error: { code: 'route.not-found', message: 'Missing route.' }, version: 1 }, { status: 404 })
          if (fault == 'conditional') {
            const headers = new Headers(request.headers)
            headers.delete('if-none-match')
            return harness.request(new Request(request, { headers }))
          }
          const response = await harness.request(request)
          return Response.json({ ...(await response.json()), version: 99 }, { status: response.status, headers: response.headers })
        },
      }),
    ).rejects.toThrow()
    expect(injected).toBe(true)
  } finally {
    await harness.dispose()
  }
})

it('Server event source Team scope and authorization page conformance', async () => {
  const connector = new ConnectorClient('https://connector.oomol.com', 'conformance-token')
  vi.spyOn(connector, 'listTeams').mockResolvedValue([
    { id: 'team-a', name: 'team_a', systemCreated: false },
    { id: 'team-b', name: 'team_b', systemCreated: true },
  ])
  vi.spyOn(connector, 'listConnections').mockResolvedValue([eventConnection])
  const service = await openService(':memory:', { capabilities: { connector: () => connector } })
  const app = createServerApp(service, { resolveControlActor: () => 'operator' })
  const harness: ControlApiConformanceHarness = {
    origin: 'http://server.local',
    request: async (request) => app.request(request),
    dispose: () => closeService(service),
  }
  try {
    for (const conformance of eventSourceControlApiConformanceCases({
      connection: eventConnection,
      teamId: 'team-a',
      connectionPageUrl: 'https://console.oomol.com/team/team_a/connections/feishu_app_bot',
    }))
      await conformance.verify(harness)
  } finally {
    await harness.dispose()
  }
})

it('removes Draft node and Code usage together, detects conflicts and preserves immutable revisions', async () => {
  const host = selectableConnectorAccess()
  const harness = await createHarness(false, host)
  try {
    const api = new ControlClient((route, init) => harness.request(new Request(new URL(route, harness.origin), init)))
    const flow = await api.createFlow('Connection usage', 'usage-create')
    const changed = await api.changeDraft(flow.flowId, flow.draftRevisionId, [
      {
        kind: 'task.create',
        taskId: 'send',
        task: { name: 'Send', inputs: [], outputs: [], executor: { kind: 'connector', action: 'mail.send', connectionId: 'fixture-account' } },
      },
      { kind: 'graph.node.create', target: { kind: 'flow' }, nodeId: 'send', node: { kind: 'task', taskId: 'send', name: 'Send', inputs: {} } },
    ])
    const added = await api.addProviderAccessBinding(flow.flowId, 'mail', 'editors', 0)
    await expect(api.removeConnectionUsage(flow.flowId, 'fixture-account', changed.revision.revisionId, 0, 'stale-access')).rejects.toMatchObject({
      code: 'connector.access-conflict',
    })
    expect((await api.getFlow(flow.flowId)).draftRevisionId).toBe(changed.revision.revisionId)
    expect((await api.getConnectorAccess(flow.flowId)).bindings).toHaveLength(1)
    const removed = await api.removeConnectionUsage(flow.flowId, 'fixture-account', changed.revision.revisionId, added.accessRevision, 'remove-account')
    expect((await api.getDraft(flow.flowId)).content.document.tasks.send?.executor).toEqual({ kind: 'connector', action: 'mail.send' })
    expect((await api.getConnectorAccess(flow.flowId)).bindings).toEqual([])
    expect((await api.getRevision(flow.flowId, changed.revision.revisionId)).content.document.tasks.send?.executor).toHaveProperty(
      'connectionId',
      'fixture-account',
    )
    expect(await api.removeConnectionUsage(flow.flowId, 'fixture-account', changed.revision.revisionId, added.accessRevision, 'remove-account')).toEqual(
      removed,
    )
    await expect(api.removeConnectionUsage(flow.flowId, 'fixture-account', changed.revision.revisionId, 2, 'stale-revision')).rejects.toMatchObject({
      code: 'flow.revision-conflict',
    })
  } finally {
    await harness.dispose()
  }
})
