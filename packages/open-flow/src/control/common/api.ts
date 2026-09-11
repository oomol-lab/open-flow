import type { ResultQuery } from './results.ts'

import { decodeResultList, decodeResultRead } from './results.ts'
export {
  readResult,
  parseResultQuery,
  decodeResultList,
  decodeResultRead,
  type ResultCall,
  type ResultInfo,
  type ResultPage,
  type ResultQuery,
} from './results.ts'
import type { RunStatus } from '../../execution/common/runLifecycle.ts'
import type {
  ChangeOperation,
  InputPortDefinition,
  JsonValue,
  PortDefinition,
  RevisionContent,
  TriggerKeySnapshot,
  WaitAction,
} from '../../flow/common/change.ts'

import { flowCheck } from './checkDecoders.ts'
import { connection, connectorAction, connectorProvider } from './connectorDecoders.ts'
import { exact, integer, invalidResponse, jsonValue, record, string } from './decoding.ts'
import { flow, flowPage, variable } from './flowDecoders.ts'
import { live, publication, publicationPage, publishOperation } from './publicationDecoders.ts'
import { draft, draftChange, draftSync, presentation } from './revisionDecoders.ts'
import { runCancellation, runDetails, runPage, runResult, waitResolution } from './runDecoders.ts'
import { pollTriggerTestResult, triggerActivityPage, triggerBinding, triggerBindingDetail, triggerKey, triggerKeySummary } from './triggerDecoders.ts'

export type { JsonValue, TriggerKeySnapshot, WaitAction } from '../../flow/common/change.ts'
export type { RunStatus } from '../../execution/common/runLifecycle.ts'
export { ApiError, controlErrorCode, controlErrorMetadata, type ControlErrorCode } from './errors.ts'
export type { FlowCatalogEvent, FlowChangeEvent } from './flowNotifications.ts'

import { ApiError } from './errors.ts'
import { randomId } from './random.ts'

export type ControlRequest = (path: string, init?: RequestInit) => Promise<Response>

export interface Flow {
  readonly live?: { readonly enabled: boolean; readonly publicationId: string; readonly revisionId: string }

  readonly createdAt: string
  readonly draftRevisionId: string
  readonly flowId: string
  readonly name: string
  readonly status: 'active' | 'retiring'
  readonly updatedAt: string
  readonly version: 1
}

export interface Presentation {
  readonly revision: number
  readonly updatedAt: string
  readonly value: Readonly<Record<string, JsonValue>>
  readonly version: 1
}

export interface FlowPage {
  readonly flows: readonly Flow[]
  readonly nextCursor?: string
  readonly total?: number
  readonly version: 1
}

export interface Variable {
  readonly name: string
  readonly updatedAt: string
  readonly value: string
  readonly version: 1
}

export interface TriggerKeySummary {
  readonly description: string
  readonly displayName: string
  readonly key: string
  readonly name: string
  readonly provider: string
  readonly type: TriggerKeySnapshot['type']
}

export interface TriggerBinding {
  readonly listener?: { readonly health: 'healthy' | 'failed' | 'needs_reauth'; readonly lastErrorCode?: string }
  readonly currentPublicationId?: string
  readonly currentRevisionId?: string
  readonly endpointUrl?: string
  readonly flowId: string
  readonly health: 'failed' | 'healthy' | 'initializing' | 'needs_reauth' | 'suspended'
  readonly kind: 'cron' | 'integration' | 'poll' | 'webhook'
  readonly lastErrorCode?: string
  readonly operatorState: 'active' | 'paused'
  readonly runtimeVersion: number
  readonly triggerNodeId: string
  readonly updatedAt: string
  readonly version: 1
}

export interface TriggerBindingDetail {
  readonly binding: TriggerBinding
  readonly version: 1
}

export type TriggerActivityKind =
  | 'delivery.failed'
  | 'health.failed'
  | 'health.needs_reauth'
  | 'health.recovered'
  | 'health.suspended'
  | 'operator.paused'
  | 'operator.resumed'

export interface TriggerActivity {
  readonly activityId: string
  readonly createdAt: string
  readonly errorCode?: string
  readonly errorMessage?: string
  readonly kind: TriggerActivityKind
}

export interface TriggerActivityPage {
  readonly activities: readonly TriggerActivity[]
  readonly nextCursor?: string
  readonly version: 1
}

export interface PollTriggerTestResult {
  readonly events: readonly Readonly<Record<string, JsonValue>>[]
  readonly filtered: number
  readonly hasMore: boolean
  readonly version: 1
}

export interface ConnectorConnection {
  readonly alias?: string
  readonly connectionId: string
  readonly displayName: string
  readonly isDefault: boolean
  readonly serviceId: string
  readonly status: 'active' | 'disconnected' | 'error' | 'reauth_required'
}

export interface ConnectorAction {
  readonly inputSchema?: JsonValue
  readonly outputSchema?: JsonValue
  readonly actionId: string
  readonly authenticated: boolean
  readonly defaultConnection?: ConnectorConnection
  readonly description: string
  readonly homepageUrl?: string
  readonly icon?: string
  readonly inputs: Readonly<Record<string, InputPortDefinition>>
  readonly name: string
  readonly outputs: Readonly<Record<string, PortDefinition>>
  readonly serviceId: string
  readonly serviceName: string
}

export interface ConnectorProvider {
  readonly homepageUrl?: string
  readonly icon?: string
  readonly serviceId: string
  readonly serviceName: string
}

export interface RevisionMetadata {
  readonly actorId: string
  readonly createdAt: string
  readonly digest: string
  readonly modelVersion: number
  readonly parentRevisionId: string | null
  readonly flowId: string
  readonly revisionId: string
  readonly version: 1
}

export interface Draft extends RevisionMetadata {
  readonly content: RevisionContent
}

export interface DraftChange {
  readonly revision: RevisionMetadata
  readonly version: 1
}

export interface DraftSync {
  readonly draft: Draft
  readonly kind: 'snapshot'
  readonly version: 1
}

export interface Publication {
  readonly actorId: string
  readonly closureDigest: string
  readonly createdAt: string
  readonly engineContract: string
  readonly flowId: string
  readonly modelVersion: number
  readonly operation: 'publish' | 'rollback'
  readonly publicationId: string
  readonly revisionDigest: string
  readonly revisionId: string
  readonly sourcePublicationId?: string
  readonly version: 1
}

export type PublishOperation =
  | {
      readonly createdAt: string
      readonly flowId: string
      readonly operationId: string
      readonly revisionId: string
      readonly status: 'pending'
      readonly updatedAt: string
      readonly version: 1
    }
  | {
      readonly createdAt: string
      readonly flowId: string
      readonly operationId: string
      readonly publicationId: string
      readonly revisionId: string
      readonly status: 'succeeded'
      readonly updatedAt: string
      readonly version: 1
    }
  | {
      readonly createdAt: string
      readonly flowId: string
      readonly issue: { readonly code: string; readonly message: string; readonly nodeId?: string }
      readonly operationId: string
      readonly revisionId: string
      readonly status: 'failed'
      readonly updatedAt: string
      readonly version: 1
    }

export interface Diagnostic {
  readonly code: string
  readonly column: number
  readonly line: number
  readonly message: string
  readonly path: string
  readonly values?: Readonly<Record<string, string | number>>
}

export interface FlowCheck {
  readonly closureDigest: string
  readonly diagnostics: readonly Diagnostic[]
  readonly engineContract: string
  readonly flowId: string
  readonly modelVersion: number
  readonly revisionDigest: string
  readonly revisionId: string
  readonly valid: boolean
  readonly version: 1
}

export interface Live {
  readonly flowId: string
  readonly hasUnpublishedChanges: boolean
  readonly publication: Publication | null
  readonly revision: number
  readonly status: 'not-published' | 'runnable' | 'suspended'
  readonly version: 1
}

export interface PublicationPage {
  readonly nextCursor?: string
  readonly publications: readonly Publication[]
  readonly total?: number
  readonly version: 1
}

export interface Run {
  readonly createdAt: string
  readonly finishedAt?: string
  readonly flowId: string
  readonly revisionId: string
  readonly runId: string
  readonly source: 'draft' | 'live' | 'trigger'
  readonly startedAt?: string
  readonly status: RunStatus
  readonly version: 1
}

type RunDetailsBase = Omit<Run, 'status'> & {
  readonly closureDigest: string
  readonly engineContract: string
  readonly engineDigest: string
  readonly eventsExpiresAt?: string
  readonly modelVersion: number
  readonly revisionDigest: string
} & (
    | { readonly status: Exclude<RunStatus, 'waiting'>; readonly waiting?: never }
    | {
        readonly status: 'waiting'
        readonly waiting: {
          readonly actions: readonly ['continue'] | readonly ['approve', 'reject']
          readonly expiresAt: string
          readonly nodeId: string
          readonly prompt: string
          readonly waitId: string
          readonly waitingSince: string
        }
      }
  )

export type DraftRun = RunDetailsBase & { readonly source: 'draft' }
export type LiveRun = RunDetailsBase & { readonly publicationId: string; readonly source: 'live' }
export type TriggerRun = RunDetailsBase & {
  readonly occurrenceId: string
  readonly publicationId: string
  readonly source: 'trigger'
  readonly triggerNodeId: string
}
export type RunDetails = DraftRun | LiveRun | TriggerRun

export interface RunPage {
  readonly flowId: string
  readonly nextCursor?: string
  readonly runs: readonly Run[]
  readonly version: 1
}

export type RunEvent = Readonly<ReturnType<typeof decodeRunEvent>>
export type RunEventKind = RunEvent['kind']

export interface RunEvents {
  readonly done: boolean
  readonly events: readonly RunEvent[]
  readonly eventsExpiresAt?: string
  readonly historyComplete: boolean
  readonly nextAfter: number
  readonly runId: string
  readonly version: 1
}

export interface RunCancellation {
  readonly cancelAccepted: boolean
  readonly runId: string
  readonly status: Extract<RunStatus, 'canceled' | 'completed' | 'failed' | 'indeterminate'>
  readonly version: 1
}

export type RunResult =
  | { readonly finishedAt: string; readonly result: JsonValue; readonly runId: string; readonly status: 'completed'; readonly version: 1 }
  | {
      readonly error: { readonly code: string; readonly message: string }
      readonly finishedAt: string
      readonly runId: string
      readonly status: 'failed' | 'indeterminate'
      readonly version: 1
    }
  | { readonly finishedAt: string; readonly runId: string; readonly status: 'canceled'; readonly version: 1 }

interface RunOptions {
  readonly trigger: { readonly nodeId: string; readonly payload: JsonValue }
  readonly idempotencyKey?: string
  readonly inputs?: Readonly<Record<string, Readonly<Record<string, JsonValue>>>>
}

interface PublicationOptions {
  readonly idempotencyKey?: string
}

export function decodeRunEvent(value: unknown) {
  const source = record(value)
  const sequence = integer(source.sequence)
  if (sequence < 0) return invalidResponse()
  const base = {
    createdAt: string(source.createdAt),
    sequence,
  }
  const payload = record(source.payload)
  const kind = source.kind
  switch (kind) {
    case 'run.queued':
      return { ...base, kind, payload: {} } as const
    case 'run.started':
      return {
        ...base,
        kind,
        payload: {
          flowId: string(payload.flowId),
          scopeId: string(payload.scopeId),
          ...(payload.parentScopeId === undefined ? {} : { parentScopeId: string(payload.parentScopeId) }),
        },
      } as const
    case 'run.progress':
      return {
        ...base,
        kind,
        payload: { flowId: string(payload.flowId), scopeId: string(payload.scopeId), progress: eventProgress(payload.progress) },
      } as const
    case 'run.waiting':
      return {
        ...base,
        kind,
        payload: {
          expiresAt: string(payload.expiresAt),
          nodeId: string(payload.nodeId),
          waitId: string(payload.waitId),
          waitingSince: string(payload.waitingSince),
        },
      } as const
    case 'run.resolved': {
      const action = payload.action
      if (action !== 'approve' && action !== 'continue' && action !== 'reject') return invalidResponse()
      return { ...base, kind, payload: { action, resolvedAt: string(payload.resolvedAt), waitId: string(payload.waitId) } } as const
    }
    case 'run.completed':
    case 'run.canceled':
    case 'run.failed':
    case 'run.indeterminate':
      return { ...base, kind, payload: { result: jsonValue(payload.result) } } as const
    case 'run.events-truncated':
      return { ...base, kind, payload: Object.fromEntries(Object.entries(payload).map(([key, item]) => [key, jsonValue(item)])) } as const
    case 'node.started':
    case 'node.completed':
    case 'node.failed':
    case 'node.log':
    case 'node.progress':
    case 'node.artifact': {
      const node = {
        flowId: string(payload.flowId),
        scopeId: string(payload.scopeId),
        nodeId: string(payload.nodeId),
        executionId: string(payload.executionId),
      }
      switch (kind) {
        case 'node.started': {
          const nodeKind = payload.nodeKind
          if (
            nodeKind !== undefined &&
            nodeKind !== 'condition' &&
            nodeKind !== 'connector' &&
            nodeKind !== 'javascript' &&
            nodeKind !== 'llm' &&
            nodeKind !== 'agent' &&
            nodeKind !== 'subflow' &&
            nodeKind !== 'value' &&
            nodeKind !== 'wait'
          )
            return invalidResponse()
          return {
            ...base,
            kind,
            payload: {
              ...node,
              ...(nodeKind === undefined ? {} : { nodeKind }),
              ...(payload.nodeTitle === undefined ? {} : { nodeTitle: string(payload.nodeTitle) }),
              ...(payload.operation === undefined ? {} : { operation: string(payload.operation) }),
            },
          } as const
        }
        case 'node.completed':
          return {
            ...base,
            kind,
            payload: { ...node, outputs: Object.fromEntries(Object.entries(record(payload.outputs)).map(([key, item]) => [key, jsonValue(item)])) },
          } as const
        case 'node.failed': {
          const error = record(payload.error)
          return { ...base, kind, payload: { ...node, error: { code: string(error.code), message: string(error.message) } } } as const
        }
        case 'node.log': {
          const level = payload.level
          if (level !== 'debug' && level !== 'info' && level !== 'warn' && level !== 'error') return invalidResponse()
          return { ...base, kind, payload: { ...node, level, message: string(payload.message) } } as const
        }
        case 'node.progress':
          return { ...base, kind, payload: { ...node, progress: eventProgress(payload.progress) } } as const
        case 'node.artifact': {
          const artifact = record(payload.artifact)
          const size = integer(artifact.size)
          const digest = string(artifact.digest)
          if (artifact.kind != 'artifact' || size < 0 || !/^sha256:[0-9a-f]{64}$/.test(digest)) return invalidResponse()
          return {
            ...base,
            kind,
            payload: {
              ...node,
              artifact: {
                kind: 'artifact',
                id: string(artifact.id),
                name: string(artifact.name),
                size,
                digest,
                ...(artifact.mediaType === undefined ? {} : { mediaType: string(artifact.mediaType) }),
              },
            },
          } as const
        }
      }
    }
    default:
      return invalidResponse()
  }
}

function eventProgress(value: unknown): number {
  return typeof value == 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? value : invalidResponse()
}

function runEvents(value: unknown): RunEvents {
  const source = record(value)
  const eventsExpiresAt = source.eventsExpiresAt
  const nextAfter = integer(source.nextAfter)
  if (source.version != 1 || !Array.isArray(source.events) || typeof source.done != 'boolean' || typeof source.historyComplete != 'boolean') {
    return invalidResponse()
  }
  if (eventsExpiresAt != null && typeof eventsExpiresAt != 'string') return invalidResponse()
  if (nextAfter < 0) return invalidResponse()
  return {
    done: source.done,
    events: source.events.map(decodeRunEvent),
    ...(eventsExpiresAt == null ? {} : { eventsExpiresAt }),
    historyComplete: source.historyComplete,
    nextAfter,
    runId: string(source.runId),
    version: 1,
  }
}

const segment = encodeURIComponent

function operationKey(operation: string): string {
  return `${operation}-${randomId()}`
}

export class ControlClient {
  private readonly requestControl: ControlRequest

  constructor(requestControl: ControlRequest) {
    this.requestControl = requestControl
  }

  async listFlows(options: { readonly cursor?: string; readonly includeTotal?: boolean; readonly limit?: number } = {}): Promise<FlowPage> {
    const parameters = new URLSearchParams()
    if (options.cursor != null) parameters.set('cursor', options.cursor)
    if (options.limit != null) parameters.set('limit', String(options.limit))
    if (options.includeTotal != null) parameters.set('includeTotal', String(options.includeTotal))
    const query = parameters.size == 0 ? '' : `?${parameters}`
    return flowPage(await this.request(`/v1/flows${query}`))
  }

  async listVariables(): Promise<{ readonly variables: readonly Variable[]; readonly version: 1 }> {
    const source = record(await this.request('/v1/variables'))
    exact(source, ['variables', 'version'])
    if (source.version != 1 || !Array.isArray(source.variables)) return invalidResponse()
    return { variables: source.variables.map(variable), version: 1 }
  }

  async getVariable(name: string): Promise<Variable> {
    return variable(await this.request(`/v1/variables/${segment(name)}`))
  }

  async putVariable(name: string, value: string): Promise<Variable> {
    return variable(
      await this.request(`/v1/variables/${segment(name)}`, {
        body: JSON.stringify({ value }),
        method: 'PUT',
      }),
    )
  }

  async deleteVariable(name: string): Promise<void> {
    const source = record(await this.request(`/v1/variables/${segment(name)}`, { method: 'DELETE' }))
    exact(source, ['version'])
    if (source.version != 1) return invalidResponse()
  }

  async createFlow(name: string, idempotencyKey = `flow-${randomId()}`): Promise<Flow> {
    return flow(
      await this.request('/v1/flows', {
        body: JSON.stringify({ name, version: 1 }),
        headers: { 'idempotency-key': idempotencyKey },
        method: 'POST',
      }),
    )
  }

  async getFlow(flowId: string): Promise<Flow> {
    return flow(await this.request(`/v1/flows/${segment(flowId)}`))
  }

  async renameFlow(flowId: string, name: string): Promise<Flow> {
    return flow(
      await this.request(`/v1/flows/${segment(flowId)}`, {
        body: JSON.stringify({ name, version: 1 }),
        method: 'PATCH',
      }),
    )
  }

  async deleteFlow(flowId: string): Promise<Flow> {
    return flow(await this.request(`/v1/flows/${segment(flowId)}`, { method: 'DELETE' }))
  }

  async listTriggerKeys(signal?: AbortSignal): Promise<readonly TriggerKeySummary[]> {
    const source = record(await this.request('/v1/trigger-keys', { signal }))
    if (source.version != 1 || !Array.isArray(source.keys)) return invalidResponse()
    return source.keys.map(triggerKeySummary)
  }

  async listTriggerDefinitions(signal?: AbortSignal): Promise<readonly TriggerKeySnapshot[]> {
    const source = record(await this.request('/v1/trigger-keys/catalog', { signal }))
    if (source.version != 1 || !Array.isArray(source.definitions)) return invalidResponse()
    return source.definitions.map(triggerKey)
  }

  async getTriggerKey(key: string, signal?: AbortSignal): Promise<TriggerKeySnapshot> {
    const source = record(await this.request(`/v1/trigger-keys/${segment(key)}`, { signal }))
    if (source.version != 1) return invalidResponse()
    return triggerKey(source.definition)
  }

  async listFlowTriggerBindings(flowId: string, signal?: AbortSignal): Promise<readonly TriggerBinding[]> {
    const source = record(await this.request(`/v1/flows/${segment(flowId)}/triggers`, { signal }))
    if (source.version != 1 || string(source.flowId) != flowId || !Array.isArray(source.bindings)) {
      return invalidResponse()
    }
    return source.bindings.map(triggerBinding)
  }

  async getFlowTriggerBinding(flowId: string, triggerNodeId: string): Promise<TriggerBindingDetail> {
    return triggerBindingDetail(await this.request(`/v1/flows/${segment(flowId)}/triggers/${segment(triggerNodeId)}`))
  }

  async listFlowTriggerActivities(
    flowId: string,
    triggerNodeId: string,
    options: { readonly cursor?: string; readonly limit?: number } = {},
  ): Promise<TriggerActivityPage> {
    const parameters = new URLSearchParams()
    if (options.cursor != null) parameters.set('cursor', options.cursor)
    if (options.limit != null) parameters.set('limit', String(options.limit))
    const query = parameters.size == 0 ? '' : `?${parameters}`
    return triggerActivityPage(await this.request(`/v1/flows/${segment(flowId)}/triggers/${segment(triggerNodeId)}/activities${query}`))
  }

  async pauseFlowTrigger(flowId: string, triggerNodeId: string): Promise<TriggerBinding> {
    return triggerBinding(
      await this.request(`/v1/flows/${segment(flowId)}/triggers/${segment(triggerNodeId)}/pause`, {
        body: JSON.stringify({ version: 1 }),
        method: 'POST',
      }),
    )
  }

  async resumeFlowTrigger(flowId: string, triggerNodeId: string): Promise<TriggerBinding> {
    return triggerBinding(
      await this.request(`/v1/flows/${segment(flowId)}/triggers/${segment(triggerNodeId)}/resume`, {
        body: JSON.stringify({ version: 1 }),
        method: 'POST',
      }),
    )
  }

  async testFlowPollTrigger(flowId: string, triggerNodeId: string): Promise<PollTriggerTestResult> {
    return pollTriggerTestResult(
      await this.request(`/v1/flows/${segment(flowId)}/triggers/${segment(triggerNodeId)}/test`, {
        body: JSON.stringify({ version: 1 }),
        method: 'POST',
      }),
    )
  }

  async getEditor(
    flowId: string,
  ): Promise<{ readonly flow: Flow; readonly draft: Draft; readonly live: Live; readonly presentation: Presentation; readonly version: 1 }> {
    const source = record(await this.request(`/v1/flows/${segment(flowId)}/editor`))
    exact(source, ['flow', 'draft', 'live', 'presentation', 'version'])
    if (source.version != 1) return invalidResponse()
    const result = {
      flow: flow(source.flow),
      draft: draft(source.draft),
      live: live(source.live),
      presentation: presentation(source.presentation),
      version: 1 as const,
    }
    if (result.flow.flowId != flowId || result.draft.flowId != flowId || result.live.flowId != flowId || result.flow.draftRevisionId != result.draft.revisionId)
      return invalidResponse()
    return result
  }

  async getPresentation(flowId: string): Promise<Presentation> {
    return presentation(await this.request(`/v1/flows/${segment(flowId)}/presentation`))
  }

  async getDraft(flowId: string): Promise<Draft> {
    return draft(await this.request(`/v1/flows/${segment(flowId)}/draft`))
  }

  async syncDraft(flowId: string): Promise<DraftSync> {
    return draftSync(await this.request(`/v1/flows/${segment(flowId)}/draft/sync`))
  }

  async getRevision(flowId: string, revisionId: string): Promise<Draft> {
    return draft(await this.request(`/v1/flows/${segment(flowId)}/revisions/${segment(revisionId)}`))
  }

  async listConnectorProviders(signal?: AbortSignal, flowId?: string): Promise<readonly ConnectorProvider[]> {
    const source = record(await this.request(`/v1/connector/providers${flowId == null ? '' : `?flowId=${segment(flowId)}`}`, { signal }))
    exact(source, ['providers', 'version'])
    if (source.version != 1 || !Array.isArray(source.providers)) return invalidResponse()
    return source.providers.map(connectorProvider)
  }

  async listConnectorActions(serviceId?: string, signal?: AbortSignal, flowId?: string): Promise<readonly ConnectorAction[]> {
    return await this.connectorActions({ ...(flowId == null ? {} : { flowId }), ...(serviceId == null ? {} : { service: serviceId }) }, signal)
  }

  async searchConnectorActions(query: string, signal?: AbortSignal, flowId?: string): Promise<readonly ConnectorAction[]> {
    return await this.connectorActions({ ...(flowId == null ? {} : { flowId }), q: query.trim() }, signal)
  }

  async getConnectorAction(actionId: string, signal?: AbortSignal, flowId?: string): Promise<ConnectorAction> {
    const source = record(await this.request(`/v1/connector/actions/${segment(actionId)}${flowId == null ? '' : `?flowId=${segment(flowId)}`}`, { signal }))
    exact(source, ['action', 'version'])
    if (source.version != 1) return invalidResponse()
    return connectorAction(source.action)
  }

  async listConnectorConnections(serviceId: string, signal?: AbortSignal, flowId?: string): Promise<readonly ConnectorConnection[]> {
    const source = record(
      await this.request(`/v1/connector/connections/${segment(serviceId)}${flowId == null ? '' : `?flowId=${segment(flowId)}`}`, { signal }),
    )
    exact(source, ['connections', 'serviceId', 'version'])
    if (source.version != 1 || string(source.serviceId) != serviceId || !Array.isArray(source.connections)) {
      return invalidResponse()
    }
    return source.connections.map(connection)
  }

  async createConnectorConnectionPage(serviceId: string, flowId?: string): Promise<string> {
    const source = record(
      await this.request(`/v1/connector/connections/${segment(serviceId)}/page${flowId == null ? '' : `?flowId=${segment(flowId)}`}`, {
        body: JSON.stringify({ version: 1 }),
        method: 'POST',
      }),
    )
    exact(source, ['url', 'version'])
    if (source.version != 1) return invalidResponse()
    try {
      const url = new URL(string(source.url))
      if (url.protocol != 'http:' && url.protocol != 'https:') return invalidResponse()
      return url.href
    } catch {
      return invalidResponse()
    }
  }

  async changeDraft(
    flowId: string,
    expectedRevisionId: string,
    operations: readonly ChangeOperation[],
    changeId = operationKey('change'),
  ): Promise<DraftChange> {
    return draftChange(
      await this.request(`/v1/flows/${segment(flowId)}/draft/changes`, {
        body: JSON.stringify({ expectedRevisionId, operations, version: 1 }),
        headers: { 'idempotency-key': changeId },
        method: 'POST',
      }),
    )
  }

  async checkFlow(flowId: string, revisionId: string): Promise<FlowCheck> {
    return flowCheck(
      await this.request(`/v1/flows/${segment(flowId)}/revisions/${segment(revisionId)}/check`, {
        body: JSON.stringify({ engineContract: 'open-flow-engine/v2', version: 1 }),
        method: 'POST',
      }),
    )
  }

  async getLive(flowId: string, signal?: AbortSignal): Promise<Live> {
    return live(await this.request(`/v1/flows/${segment(flowId)}/live`, { signal }))
  }

  async listPublications(
    flowId: string,
    options: { readonly cursor?: string; readonly includeTotal?: boolean; readonly limit?: number } = {},
    signal?: AbortSignal,
  ): Promise<PublicationPage> {
    const parameters = new URLSearchParams()
    if (options.cursor != null) parameters.set('cursor', options.cursor)
    if (options.limit != null) parameters.set('limit', String(options.limit))
    if (options.includeTotal != null) parameters.set('includeTotal', String(options.includeTotal))
    const query = parameters.size == 0 ? '' : `?${parameters}`
    return publicationPage(await this.request(`/v1/flows/${segment(flowId)}/publications${query}`, { signal }))
  }

  async createDraftRun(flowId: string, revisionId: string, options: RunOptions): Promise<DraftRun> {
    const created = runDetails(
      await this.request(`/v1/flows/${segment(flowId)}/revisions/${segment(revisionId)}/runs`, {
        body: JSON.stringify({ engineContract: 'open-flow-engine/v2', inputs: options.inputs ?? {}, trigger: options.trigger, version: 1 }),
        headers: { 'idempotency-key': options.idempotencyKey ?? operationKey('run') },
        method: 'POST',
      }),
    )
    return created.source == 'draft' ? created : invalidResponse()
  }

  async createLiveRun(publicationId: string, options: RunOptions): Promise<LiveRun> {
    const created = runDetails(
      await this.request('/v1/runs', {
        body: JSON.stringify({ inputs: options.inputs ?? {}, trigger: options.trigger, publicationId, version: 1 }),
        headers: { 'idempotency-key': options.idempotencyKey ?? operationKey('run') },
        method: 'POST',
      }),
    )
    return created.source == 'live' ? created : invalidResponse()
  }

  async setFlowEnabled(flowId: string, publicationId: string, enabled: boolean): Promise<Flow> {
    return flow(
      await this.request(`/v1/flows/${segment(flowId)}/enabled`, {
        method: 'PUT',
        body: JSON.stringify({ enabled, expectedPublicationId: publicationId, version: 1 }),
      }),
    )
  }

  async publishFlow(flowId: string, revisionId: string, expectedLivePublicationId: string | null, options: PublicationOptions = {}): Promise<PublishOperation> {
    return publishOperation(
      await this.request(`/v1/flows/${segment(flowId)}/revisions/${segment(revisionId)}/publications`, {
        body: JSON.stringify({ engineContract: 'open-flow-engine/v2', expectedLivePublicationId, version: 1 }),
        headers: { 'idempotency-key': options.idempotencyKey ?? operationKey('publication') },
        method: 'POST',
      }),
    )
  }

  async getPublishOperation(flowId: string, operationId: string, signal?: AbortSignal): Promise<PublishOperation> {
    return publishOperation(await this.request(`/v1/flows/${segment(flowId)}/publish-operations/${segment(operationId)}`, { signal }))
  }

  async rollbackFlow(flowId: string, publicationId: string, expectedLivePublicationId: string, options: PublicationOptions = {}): Promise<Publication> {
    return publication(
      await this.request(`/v1/flows/${segment(flowId)}/publications/${segment(publicationId)}/rollback`, {
        body: JSON.stringify({ expectedLivePublicationId, version: 1 }),
        headers: { 'idempotency-key': options.idempotencyKey ?? operationKey('publication') },
        method: 'POST',
      }),
    )
  }

  async getRun(runId: string, signal?: AbortSignal): Promise<RunDetails> {
    return runDetails(await this.request(`/v1/runs/${segment(runId)}`, { signal }))
  }

  async listRuns(flowId: string, options: { readonly cursor?: string; readonly limit?: number; readonly status?: RunStatus } = {}): Promise<RunPage> {
    const parameters = new URLSearchParams()
    if (options.cursor != null) parameters.set('cursor', options.cursor)
    if (options.limit != null) parameters.set('limit', String(options.limit))
    if (options.status != null) parameters.set('status', options.status)
    const query = parameters.size == 0 ? '' : `?${parameters}`
    return runPage(await this.request(`/v1/flows/${segment(flowId)}/runs${query}`))
  }

  async getRunEvents(runId: string, options: { readonly after?: number; readonly limit?: number } = {}, signal?: AbortSignal): Promise<RunEvents> {
    const parameters = new URLSearchParams()
    if (options.after != null) parameters.set('after', String(options.after))
    if (options.limit != null) parameters.set('limit', String(options.limit))
    const query = parameters.size == 0 ? '' : `?${parameters}`
    return runEvents(await this.request(`/v1/runs/${segment(runId)}/events${query}`, { signal }))
  }

  async listRunResults(runId: string, after?: string, signal?: AbortSignal): Promise<ReturnType<typeof decodeResultList>> {
    return decodeResultList(await this.request(`/v1/runs/${segment(runId)}/results${after == null ? '' : `?after=${encodeURIComponent(after)}`}`, { signal }))
  }

  async readRunResult(runId: string, resultId: string, options: ResultQuery = {}, signal?: AbortSignal): Promise<ReturnType<typeof decodeResultRead>> {
    const parameters = new URLSearchParams(Object.entries(options).map(([key, value]) => [key, String(value)]))
    return decodeResultRead(await this.request(`/v1/runs/${segment(runId)}/results/${segment(resultId)}?${parameters}`, { signal }))
  }

  async downloadRunResult(runId: string, resultId: string, signal?: AbortSignal): Promise<Blob> {
    return (await this.response(`/v1/runs/${segment(runId)}/results/${segment(resultId)}/content`, { signal })).blob()
  }

  async getRunResult(runId: string, signal?: AbortSignal): Promise<RunResult> {
    return runResult(await this.request(`/v1/runs/${segment(runId)}/result`, { signal }))
  }

  async cancelRun(runId: string): Promise<RunCancellation> {
    return runCancellation(
      await this.request(`/v1/runs/${segment(runId)}/cancel`, {
        body: JSON.stringify({ version: 1 }),
        method: 'POST',
      }),
    )
  }

  async resolveRunWait(
    runId: string,
    waitId: string,
    action: WaitAction,
  ): Promise<{
    readonly action: WaitAction | null
    readonly resolutionAccepted: boolean
    readonly resolvedAt: string | null
    readonly runId: string
    readonly status: RunStatus
    readonly version: 1
    readonly waitId: string
  }> {
    return waitResolution(
      await this.request(`/v1/runs/${segment(runId)}/waits/${segment(waitId)}/resolve`, {
        body: JSON.stringify({ action, version: 1 }),
        method: 'POST',
      }),
    )
  }

  private async connectorActions(parameters: Readonly<Record<string, string>>, signal?: AbortSignal): Promise<readonly ConnectorAction[]> {
    const query = Object.entries(parameters)
      .map(([key, value]) => `${segment(key)}=${segment(value)}`)
      .join('&')
    const suffix = query == '' ? '' : `?${query}`
    const source = record(await this.request(`/v1/connector/actions${suffix}`, { signal }))
    exact(source, ['actions', 'version'])
    if (source.version != 1 || !Array.isArray(source.actions)) return invalidResponse()
    return source.actions.map(connectorAction)
  }

  private async response(path: string, init: RequestInit): Promise<Response> {
    const headers = new Headers(init.headers)
    if (init.body != null) headers.set('content-type', 'application/json')
    const response = await this.requestControl(path, { ...init, headers })
    if (!response.ok) {
      let value: unknown
      try {
        value = await response.json()
      } catch {
        return invalidResponse()
      }
      const error = record(value).error
      const source = error == null ? undefined : record(error)
      throw new ApiError(
        response.status,
        typeof source?.code == 'string' ? source.code : 'request.failed',
        typeof source?.message == 'string' ? source.message : `Request failed with status ${response.status}.`,
      )
    }
    return response
  }

  protected async request<Value = unknown>(path: string, init: RequestInit = {}): Promise<Value> {
    const response = await this.response(path, init)
    try {
      return (await response.json()) as Value
    } catch {
      return invalidResponse()
    }
  }
}
