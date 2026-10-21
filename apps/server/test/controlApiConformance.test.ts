import type { ConnectorAccess, ConnectorAction, ConnectorConnection, ConnectorProvider } from '@oomol-lab/open-flow/control-api'
import type { ControlApiConformanceHarness } from '@oomol-lab/open-flow/control-api-conformance'
import type { PollDefinition } from '@oomol-lab/open-flow/poll-trigger'
import type { JsonValue, TaskNode } from '../../../packages/open-flow/src/flow/common/change.ts'
import type { ManagedTaskDefinition } from '../../../packages/open-flow/src/flow/common/change.ts'
import type { ConnectorAccessHost } from '../node/deployment/connector-access.ts'
import type { ConnectorHost } from '../node/deployment/connector-contract.ts'

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
import { ConnectorTaskError } from '../node/deployment/connector-contract.ts'
import { ConnectorClient } from '../node/deployment/connector.ts'
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
    trigger: async () => [{ value: teamId, label: 'Engineering (ENG)' }],
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
        waitPublicOrigin: () => new URL('https://server.local'),
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
    resolveControlActor: (request: Request) => (request.headers.get('authorization') == 'Bearer control-api-conformance' ? 'operator' : undefined),
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
      if (request.method == 'PUT' && new URL(request.url).pathname.endsWith('/enabled') && response.ok) {
        await closeService(service)
        service = await open()
        app = createServerApp(service, options)
      }
      return response
    },
  }
}

it('creates, edits and runs a Leina notification with a team-scoped robot selection', async () => {
  const bot = { leinaId: 'default', name: 'Team assistant', status: 'ready', platforms: ['feishu'] }
  const execute = vi.fn<ConnectorHost['execute']>(
    async (action, _connection, input): Promise<JsonValue> =>
      action == 'leina.list_bots' ? { bots: [bot] } : { leinaId: input.leinaId!, status: 'delivered', requestId: 'delivery-1' },
  )
  const field = { jsonSchema: { type: 'string' } as const, nullable: false }
  const action: ConnectorAction = {
    actionId: 'leina.send_notification',
    authenticated: false,
    description: 'Send a notification.',
    name: 'Send notification',
    serviceId: 'leina',
    serviceName: 'Leina',
    inputs: { leinaId: field, message: { jsonSchema: { type: 'string', minLength: 1, pattern: '\\S' }, nullable: false } },
    outputs: { leinaId: field, status: field, requestId: field },
  }
  const harness = await createHarness(true, undefined, {
    execute,
    getAction: async () => action,
    listActions: async () => [action],
    listProviders: async () => [{ serviceId: 'leina', serviceName: 'Leina', noSetup: true }],
    listAllConnections: async () => [],
    listConnections: async () => [],
  })
  try {
    const api = new ControlClient((route, init) => harness.request(new Request(new URL(route, harness.origin), init)))
    const flow = await api.createFlow('Leina notification', 'leina')
    const database = Database.open(harness.file)
    try {
      new Store(database).connectorTeams.bind(flow.flowId, teamId)
    } finally {
      database.close()
    }
    expect(await api.listLeinaBots(flow.flowId)).toEqual([bot])
    expect(execute.mock.calls[0]).toEqual([
      'leina.list_bots',
      undefined,
      {},
      expect.any(String),
      expect.any(AbortSignal),
      expect.objectContaining({
        actorId: 'operator',
        flowId: flow.flowId,
        teamId,
        scope: 'action',
        action: 'leina.list_bots',
        purpose: 'execute',
        providerAccess: expect.objectContaining({ sharedBindings: [], selectedBindings: [] }),
      }),
    ])
    await expect(api.listLeinaBots('missing-flow')).rejects.toMatchObject({ status: 404 })
    expect(execute).toHaveBeenCalledTimes(1)
    const created = await api.editAuthoring(flow.flowId, {
      baseRevision: flow.draftRevisionId,
      requestId: 'create-notification',
      edits: [
        { op: 'node.add', type: 'start', as: 'start', name: 'Start' },
        {
          op: 'node.add',
          type: 'value',
          as: 'report',
          name: 'Report',
          config: {
            outputs: { message: { schema: { type: 'string', minLength: 1, pattern: '\\S' }, nullable: false } },
            values: { message: 'Upstream report' },
          },
        },
        { op: 'node.add', type: 'connector', as: 'notify', name: 'Leina notification', config: { action: action.actionId } },
        { op: 'input.set', node: '$notify', input: 'leinaId', source: { kind: 'value', value: bot.leinaId } },
        { op: 'input.set', node: '$notify', input: 'message', source: { kind: 'value', value: 'Report ready' } },
        { op: 'edge.connect', source: '$start', target: '$report' },
        { op: 'edge.connect', source: '$report', target: '$notify' },
      ],
    })
    expect(created.validation.status).toBe('valid')
    const changed = await api.editAuthoring(flow.flowId, {
      baseRevision: created.revision,
      requestId: 'edit-message',
      edits: [{ op: 'input.set', node: created.nodes.notify!, input: 'message', source: { kind: 'value', value: '  Report updated\n' } }],
    })
    expect(await api.checkAuthoring(flow.flowId, changed.revision)).toMatchObject({ valid: true })
    expect((await api.readAuthoring(flow.flowId, { nodes: [created.nodes.notify!] })).data.nodes).toEqual([
      expect.objectContaining({
        config: expect.objectContaining({ action: action.actionId }),
        inputs: expect.objectContaining({ leinaId: { kind: 'value', value: 'default' }, message: { kind: 'value', value: '  Report updated\n' } }),
      }),
    ])
    const run = await api.createDraftRun(flow.flowId, changed.revision, {
      trigger: { nodeId: created.nodes.start!, outputs: {} },
      idempotencyKey: 'notify-once',
    })
    await expect.poll(async () => (await api.getRun(run.runId)).status).toBe('completed')
    expect(execute.mock.calls[1]).toEqual([
      action.actionId,
      undefined,
      { leinaId: 'default', message: '  Report updated\n' },
      expect.any(String),
      expect.any(AbortSignal),
      expect.objectContaining({ teamId, scope: 'action', action: action.actionId }),
    ])
    const replay = await api.createDraftRun(flow.flowId, changed.revision, {
      trigger: { nodeId: created.nodes.start!, outputs: {} },
      idempotencyKey: 'notify-once',
    })
    expect(replay.runId).toBe(run.runId)
    expect(execute).toHaveBeenCalledTimes(2)
    const bound = await api.editAuthoring(flow.flowId, {
      baseRevision: changed.revision,
      requestId: 'bind-report',
      edits: [{ op: 'input.set', node: created.nodes.notify!, input: 'message', source: { kind: 'output', node: created.nodes.report!, port: 'message' } }],
    })
    expect(bound.validation).toMatchObject({ status: 'valid' })
    const next = await api.createDraftRun(flow.flowId, bound.revision, {
      trigger: { nodeId: created.nodes.start!, outputs: {} },
      idempotencyKey: 'notify-again',
    })
    await expect.poll(async () => (await api.getRun(next.runId)).status).toBe('completed')
    expect(execute.mock.calls[2]?.[2]).toEqual({ leinaId: 'default', message: 'Upstream report' })
    expect(execute.mock.calls[2]?.[3]).not.toBe(execute.mock.calls[1]?.[3])
    const approvalFlow = await api.createFlow('Approval notification', 'leina-approval')
    const approval = await api.editAuthoring(approvalFlow.flowId, {
      baseRevision: approvalFlow.draftRevisionId,
      requestId: 'approval-message',
      edits: [
        { op: 'node.add', type: 'start', as: 'start', name: 'Start' },
        { op: 'node.add', type: 'approval', as: 'approval', name: 'Review', prompt: 'Publish the report?' },
        { op: 'node.add', type: 'connector', as: 'notify', name: 'Leina notification', config: { action: action.actionId } },
        { op: 'input.set', node: '$notify', input: 'leinaId', source: { kind: 'value', value: 'default' } },
        { op: 'edge.connect', source: '$start', target: '$approval' },
        { op: 'edge.connect', source: '$approval', branch: 'pending', target: '$notify' },
      ],
    })
    expect(approval.validation, JSON.stringify(approval.validation)).toMatchObject({ status: 'valid' })
    expect(await api.checkAuthoring(approvalFlow.flowId, approval.revision)).toMatchObject({ valid: true })
    const waiting = await api.createDraftRun(approvalFlow.flowId, approval.revision, {
      trigger: { nodeId: approval.nodes.start!, outputs: {} },
      idempotencyKey: 'approval-notification',
    })
    await expect.poll(() => execute.mock.calls.length).toBe(4)
    const message = execute.mock.calls[3]![2].message
    expect(message).toEqual(expect.stringContaining('Publish the report?'))
    const url = String(message).match(/https:\/\/server.local\/v1\/wait-actions\/[A-Za-z0-9_-]{43}\/approve/)?.[0]
    expect(url).toBeDefined()
    const page = await harness.request(new Request(url!, { headers: { accept: 'text/html' } }))
    expect(await page.text()).toContain('Publish the report?')
    expect((await api.getRun(waiting.runId)).status).not.toBe('completed')
    const decision = await harness.request(
      new Request(url!, { method: 'POST', headers: { 'accept': 'text/html', 'content-type': 'application/x-www-form-urlencoded' }, body: 'comment=Reviewed' }),
    )
    expect(decision.status).toBe(200)
    await expect.poll(async () => (await api.getRun(waiting.runId)).status).toBe('completed')
    expect(execute).toHaveBeenCalledTimes(4)
  } finally {
    await harness.dispose()
  }
})

it('propagates a failed Leina lookup without allowing caller-supplied team or action overrides', async () => {
  const execute = vi.fn<ConnectorHost['execute']>(async () => {
    throw new ConnectorTaskError('connector.unavailable', 'Leina unavailable')
  })
  const harness = await createHarness(false, undefined, { execute })
  try {
    const api = new ControlClient((route, init) => harness.request(new Request(new URL(route, harness.origin), init)))
    const flow = await api.createFlow('Leina', 'leina-error')
    await expect(api.listLeinaBots(flow.flowId)).rejects.toMatchObject({ code: 'connector.unavailable' })
    for (const query of ['', `flowId=${flow.flowId}&teamId=other`, `flowId=${flow.flowId}&action=leina.send_notification`]) {
      const response = await harness.request(new Request(`${harness.origin}/v1/connector/leina/bots?${query}`))
      expect(response.status).toBe(400)
    }
    expect(execute).toHaveBeenCalledTimes(1)
  } finally {
    await harness.dispose()
  }
})

function selectableConnectorAccess(): ConnectorAccessHost {
  const accesses = new Map<string, ConnectorAccess>()
  const current = (flowId: string): ConnectorAccess =>
    accesses.get(flowId) ?? { accessRevision: 0, bindings: [], mode: 'selectable', sharedAccessDigest: 'selectable:0', version: 1 }
  return {
    removeConnection(flowId, connectionId, expectedAccessRevision) {
      const access = current(flowId)
      if (access.accessRevision != expectedAccessRevision) return { kind: 'conflict' }
      const next = {
        ...access,
        accessRevision: access.accessRevision + 1,
        bindings: access.bindings.filter((binding) => binding.connectionId != connectionId),
        sharedAccessDigest: `selectable:${access.accessRevision + 1}`,
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
        sharedAccessDigest:
          !selected && access.bindings.some((binding) => binding.providerId == providerId)
            ? `selectable:${access.accessRevision + 1}`
            : access.sharedAccessDigest,
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
        sharedAccessDigest: `selectable:${access.accessRevision + 1}`,
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
        sharedAccessDigest: `selectable:${access.accessRevision + 1}`,
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
      { kind: 'graph.node.create', nodeId: 'start', node: { kind: 'manual', name: 'Start' } },
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
      { kind: 'graph.node.create', nodeId: 'start', node: { kind: 'manual', name: 'Start' } },
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
        kind: 'graph.node.create',
        nodeId: 'send',
        node: {
          kind: 'task',
          task: { name: 'Send', inputs: [], outputs: [], executor: { kind: 'connector', action: 'mail.send', connectionId: 'fixture-account' } },
          name: 'Send',
          inputs: {},
        },
      },
    ])
    const added = await api.addProviderAccessBinding(flow.flowId, 'mail', 'editors', 0)
    await expect(api.removeConnectionUsage(flow.flowId, 'fixture-account', changed.revision.revisionId, 0, 'stale-access')).rejects.toMatchObject({
      code: 'connector.access-conflict',
    })
    expect((await api.getFlow(flow.flowId)).draftRevisionId).toBe(changed.revision.revisionId)
    expect((await api.getConnectorAccess(flow.flowId)).bindings).toHaveLength(1)
    const removed = await api.removeConnectionUsage(flow.flowId, 'fixture-account', changed.revision.revisionId, added.accessRevision, 'remove-account')
    expect((((await api.getDraft(flow.flowId)).content.document.graph.nodes['send'] as TaskNode).task as ManagedTaskDefinition)?.executor).toEqual({
      kind: 'connector',
      action: 'mail.send',
    })
    expect((await api.getConnectorAccess(flow.flowId)).bindings).toEqual([])
    expect(
      (((await api.getRevision(flow.flowId, changed.revision.revisionId)).content.document.graph.nodes['send'] as TaskNode).task as ManagedTaskDefinition)
        ?.executor,
    ).toHaveProperty('connectionId', 'fixture-account')
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
