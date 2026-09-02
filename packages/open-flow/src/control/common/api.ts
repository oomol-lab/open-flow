import type { RunStatus } from '../../execution/common/runLifecycle.ts'
import type { ChangeOperation, InputPortDefinition, JsonValue, PortDefinition, RevisionContent, TriggerKeySnapshot } from '../../flow/common/change.ts'

export type { JsonValue, TriggerKeySnapshot } from '../../flow/common/change.ts'
export type { RunStatus } from '../../execution/common/runLifecycle.ts'
export { controlErrorCode, controlErrorMetadata, type ControlErrorCode } from './errors.ts'
export type { FlowCatalogEvent, FlowChangeEvent } from './flowNotifications.ts'

import { runStatuses } from '../../execution/common/runLifecycle.ts'

export type ControlRequest = (path: string, init?: RequestInit) => Promise<Response>

export interface Flow {
  readonly createdAt: string
  readonly draftRevisionId: string
  readonly flowId: string
  readonly name: string
  readonly status: 'active' | 'retiring'
  readonly updatedAt: string
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
  readonly connectionId: string
  readonly displayName: string
  readonly isDefault: boolean
  readonly serviceId: string
  readonly status: 'active' | 'disconnected' | 'error' | 'reauth_required'
}

export interface ConnectorAction {
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

interface RunDetailsBase extends Run {
  readonly closureDigest: string
  readonly engineContract: string
  readonly engineDigest: string
  readonly eventsExpiresAt?: string
  readonly modelVersion: number
  readonly revisionDigest: string
}

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

export type RunEventKind =
  | 'node.artifact'
  | 'node.completed'
  | 'node.failed'
  | 'node.log'
  | 'node.output'
  | 'node.progress'
  | 'node.started'
  | 'run.canceled'
  | 'run.completed'
  | 'run.events-truncated'
  | 'run.failed'
  | 'run.indeterminate'
  | 'run.progress'
  | 'run.queued'
  | 'run.started'

export interface RunEvent {
  readonly createdAt: string
  readonly kind: RunEventKind
  readonly payload: Readonly<Record<string, JsonValue>>
  readonly sequence: number
  readonly sourceSequence?: number
}

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
  readonly idempotencyKey?: string
  readonly inputs?: Readonly<Record<string, Readonly<Record<string, JsonValue>>>>
}

interface PublicationOptions {
  readonly idempotencyKey?: string
}

export class ApiError extends Error {
  readonly code: string
  readonly status: number

  constructor(status: number, code: string, message: string) {
    super(message)
    this.code = code
    this.name = 'ApiError'
    this.status = status
  }
}

function invalidResponse(): never {
  throw new ApiError(502, 'response.invalid', 'The Control API returned an invalid response.')
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  if (value == null || typeof value != 'object' || Array.isArray(value)) return invalidResponse()
  return value as Readonly<Record<string, unknown>>
}

function string(value: unknown): string {
  return typeof value == 'string' && value.length > 0 ? value : invalidResponse()
}

function exact(value: Readonly<Record<string, unknown>>, keys: readonly string[]): void {
  const actual = Object.keys(value)
  if (actual.length != keys.length || actual.some((key) => !keys.includes(key))) invalidResponse()
}

function integer(value: unknown): number {
  return Number.isSafeInteger(value) ? (value as number) : invalidResponse()
}

function jsonValue(value: unknown): JsonValue {
  if (value === null || typeof value == 'boolean' || typeof value == 'string') return value
  if (typeof value == 'number' && Number.isFinite(value)) return value
  if (Array.isArray(value)) return value.map(jsonValue)
  const source = record(value)
  return Object.fromEntries(Object.entries(source).map(([key, item]) => [key, jsonValue(item)]))
}

function connection(value: unknown): ConnectorConnection {
  const source = record(value)
  exact(source, ['connectionId', 'displayName', 'isDefault', 'serviceId', 'status'])
  const status = source.status
  if (status != 'active' && status != 'disconnected' && status != 'error' && status != 'reauth_required') return invalidResponse()
  if (typeof source.isDefault != 'boolean') return invalidResponse()
  return {
    connectionId: string(source.connectionId),
    displayName: string(source.displayName),
    isDefault: source.isDefault,
    serviceId: string(source.serviceId),
    status: status as ConnectorConnection['status'],
  }
}

function port(value: unknown, input = false): InputPortDefinition {
  const source = record(value)
  const description = source.description
  const hasValue = input && Object.hasOwn(source, 'value')
  exact(source, ['jsonSchema', 'nullable', ...(description == null ? [] : ['description']), ...(hasValue ? ['value'] : [])])
  if (description != null && typeof description != 'string') return invalidResponse()
  if (typeof source.nullable != 'boolean') return invalidResponse()
  return {
    ...(description == null ? {} : { description }),
    jsonSchema: jsonValue(source.jsonSchema),
    nullable: source.nullable,
    ...(hasValue ? { value: jsonValue(source.value) } : {}),
  }
}

function inputPort(value: unknown): InputPortDefinition {
  return port(value, true)
}

function ports<Value>(value: unknown, decode: (value: unknown) => Value): Readonly<Record<string, Value>> {
  return Object.fromEntries(Object.entries(record(value)).map(([handle, candidate]) => [handle, decode(candidate)]))
}

function connectorAction(value: unknown): ConnectorAction {
  const source = record(value)
  const homepageUrl = source.homepageUrl
  const icon = source.icon
  const hasConnection = source.defaultConnection != null
  exact(source, [
    'actionId',
    'authenticated',
    ...(hasConnection ? ['defaultConnection'] : []),
    'description',
    ...(homepageUrl == null ? [] : ['homepageUrl']),
    ...(icon == null ? [] : ['icon']),
    'inputs',
    'name',
    'outputs',
    'serviceId',
    'serviceName',
  ])
  if ((homepageUrl != null && typeof homepageUrl != 'string') || (icon != null && typeof icon != 'string')) return invalidResponse()
  const result: ConnectorAction = {
    actionId: string(source.actionId),
    authenticated: typeof source.authenticated == 'boolean' ? source.authenticated : invalidResponse(),
    ...(hasConnection ? { defaultConnection: connection(source.defaultConnection) } : {}),
    description: typeof source.description == 'string' ? source.description : invalidResponse(),
    ...(homepageUrl == null ? {} : { homepageUrl }),
    ...(icon == null ? {} : { icon }),
    inputs: ports(source.inputs, inputPort),
    name: string(source.name),
    outputs: ports(source.outputs, port),
    serviceId: string(source.serviceId),
    serviceName: string(source.serviceName),
  }
  if (result.defaultConnection != null && (result.defaultConnection.serviceId != result.serviceId || result.defaultConnection.status != 'active')) {
    return invalidResponse()
  }
  return result
}

function connectorProvider(value: unknown): ConnectorProvider {
  const source = record(value)
  const homepageUrl = source.homepageUrl
  const icon = source.icon
  exact(source, ['serviceId', 'serviceName', ...(homepageUrl == null ? [] : ['homepageUrl']), ...(icon == null ? [] : ['icon'])])
  if ((homepageUrl != null && typeof homepageUrl != 'string') || (icon != null && typeof icon != 'string')) return invalidResponse()
  return {
    ...(homepageUrl == null ? {} : { homepageUrl }),
    ...(icon == null ? {} : { icon }),
    serviceId: string(source.serviceId),
    serviceName: string(source.serviceName),
  }
}

function triggerKeySummary(value: unknown): TriggerKeySummary {
  const source = record(value)
  const type = source.type
  if (type != 'integration' && type != 'poll') return invalidResponse()
  return {
    description: typeof source.description == 'string' ? source.description : invalidResponse(),
    displayName: string(source.displayName),
    key: string(source.key),
    name: string(source.name),
    provider: string(source.provider),
    type: type as TriggerKeySummary['type'],
  }
}

function triggerKey(value: unknown): TriggerKeySnapshot {
  const source = record(value)
  const summary = triggerKeySummary(source)
  const base = {
    configSchema: jsonValue(source.configSchema),
    definitionVersion: integer(source.definitionVersion),
    description: summary.description,
    displayName: summary.displayName,
    key: summary.key,
    name: summary.name,
    payloadSchema: jsonValue(source.payloadSchema),
    provider: summary.provider,
  }
  if (summary.type == 'poll') return { ...base, type: 'poll' }
  const endpoint = record(source.endpoint)
  const body = record(endpoint.body)
  if (!Array.isArray(endpoint.methods) || !Array.isArray(body.formats) || typeof body.allowArray != 'boolean' || typeof body.allowEmpty != 'boolean') {
    return invalidResponse()
  }
  const methods = endpoint.methods.map(string)
  const formats = body.formats.map(string)
  const successStatus = integer(endpoint.successStatus)
  if (
    methods.some((method) => !['DELETE', 'GET', 'HEAD', 'PATCH', 'POST', 'PUT'].includes(method)) ||
    formats.some((format) => !['form', 'json', 'multipart', 'text'].includes(format)) ||
    successStatus < 200 ||
    successStatus > 299
  ) {
    return invalidResponse()
  }
  return {
    ...base,
    endpoint: {
      body: {
        allowArray: body.allowArray,
        allowEmpty: body.allowEmpty,
        formats: formats as Extract<TriggerKeySnapshot, { readonly type: 'integration' }>['endpoint']['body']['formats'],
      },
      methods: methods as Extract<TriggerKeySnapshot, { readonly type: 'integration' }>['endpoint']['methods'],
      successStatus,
    },
    type: 'integration',
  }
}

const triggerKinds: ReadonlySet<TriggerBinding['kind']> = new Set(['cron', 'integration', 'poll', 'webhook'])
const triggerHealth: ReadonlySet<TriggerBinding['health']> = new Set(['failed', 'healthy', 'initializing', 'needs_reauth', 'suspended'])
const triggerActivityKinds: ReadonlySet<TriggerActivityKind> = new Set([
  'delivery.failed',
  'health.failed',
  'health.needs_reauth',
  'health.recovered',
  'health.suspended',
  'operator.paused',
  'operator.resumed',
])

function optionalString(value: unknown): string | undefined {
  if (value == null) return
  return string(value)
}

function triggerBinding(value: unknown): TriggerBinding {
  const source = record(value)
  const health = source.health
  const kind = source.kind
  const operatorState = source.operatorState
  const runtimeVersion = integer(source.runtimeVersion)
  if (source.version != 1 || typeof health != 'string' || !triggerHealth.has(health as TriggerBinding['health'])) return invalidResponse()
  if (typeof kind != 'string' || !triggerKinds.has(kind as TriggerBinding['kind'])) return invalidResponse()
  if (operatorState != 'active' && operatorState != 'paused') return invalidResponse()
  if (runtimeVersion <= 0) return invalidResponse()
  return {
    ...(source.currentPublicationId == null ? {} : { currentPublicationId: string(source.currentPublicationId) }),
    ...(source.currentRevisionId == null ? {} : { currentRevisionId: string(source.currentRevisionId) }),
    ...(source.endpointUrl == null ? {} : { endpointUrl: string(source.endpointUrl) }),
    flowId: string(source.flowId),
    health: health as TriggerBinding['health'],
    kind: kind as TriggerBinding['kind'],
    ...(source.lastErrorCode == null ? {} : { lastErrorCode: string(source.lastErrorCode) }),
    operatorState: operatorState as TriggerBinding['operatorState'],
    runtimeVersion,
    triggerNodeId: string(source.triggerNodeId),
    updatedAt: string(source.updatedAt),
    version: 1,
  }
}

function triggerBindingDetail(value: unknown): TriggerBindingDetail {
  const source = record(value)
  if (source.version != 1) return invalidResponse()
  return { binding: triggerBinding(source.binding), version: 1 }
}

function triggerActivity(value: unknown): TriggerActivity {
  const source = record(value)
  const kind = source.kind
  if (typeof kind != 'string' || !triggerActivityKinds.has(kind as TriggerActivityKind)) return invalidResponse()
  const errorCode = optionalString(source.errorCode)
  const errorMessage = optionalString(source.errorMessage)
  if (errorMessage != null && errorMessage.length > 512) return invalidResponse()
  return {
    activityId: string(source.activityId),
    createdAt: string(source.createdAt),
    ...(errorCode == null ? {} : { errorCode }),
    ...(errorMessage == null ? {} : { errorMessage }),
    kind: kind as TriggerActivityKind,
  }
}

function triggerActivityPage(value: unknown): TriggerActivityPage {
  const source = record(value)
  const nextCursor = optionalString(source.nextCursor)
  if (source.version != 1 || !Array.isArray(source.activities)) return invalidResponse()
  return {
    activities: source.activities.map(triggerActivity),
    ...(nextCursor == null ? {} : { nextCursor }),
    version: 1,
  }
}

function pollTriggerTestResult(value: unknown): PollTriggerTestResult {
  const source = record(value)
  const filtered = integer(source.filtered)
  if (source.version != 1 || !Array.isArray(source.events) || typeof source.hasMore != 'boolean' || filtered < 0) return invalidResponse()
  return {
    events: source.events.map((event) => {
      const object = record(event)
      return Object.fromEntries(Object.entries(object).map(([key, item]) => [key, jsonValue(item)]))
    }),
    filtered,
    hasMore: source.hasMore,
    version: 1,
  }
}

function flow(value: unknown): Flow {
  const source = record(value)
  const status = source.status
  if (source.version != 1) return invalidResponse()
  if (status != 'active' && status != 'retiring') return invalidResponse()
  return {
    createdAt: string(source.createdAt),
    draftRevisionId: string(source.draftRevisionId),
    flowId: string(source.flowId),
    name: string(source.name),
    status: status as Flow['status'],
    updatedAt: string(source.updatedAt),
    version: 1,
  }
}

function flowPage(value: unknown): FlowPage {
  const source = record(value)
  if (source.version != 1 || !Array.isArray(source.flows)) return invalidResponse()
  const nextCursor = source.nextCursor
  const total = source.total
  if (nextCursor != null && typeof nextCursor != 'string') return invalidResponse()
  if (total != null && !Number.isSafeInteger(total)) return invalidResponse()
  return {
    ...(nextCursor == null ? {} : { nextCursor }),
    flows: source.flows.map(flow),
    ...(total == null ? {} : { total: total as number }),
    version: 1,
  }
}

function variable(value: unknown): Variable {
  const source = record(value)
  exact(source, ['name', 'updatedAt', 'value', 'version'])
  if (source.version != 1 || typeof source.value != 'string') return invalidResponse()
  const updatedAt = string(source.updatedAt)
  try {
    if (new Date(updatedAt).toISOString() != updatedAt) return invalidResponse()
  } catch {
    return invalidResponse()
  }
  return { name: string(source.name), updatedAt, value: source.value, version: 1 }
}

function revisionMetadata(value: unknown): RevisionMetadata {
  const source = record(value)
  const parentRevisionId = source.parentRevisionId
  if (source.version != 1 || (parentRevisionId !== null && typeof parentRevisionId != 'string')) return invalidResponse()
  return {
    actorId: string(source.actorId),
    createdAt: string(source.createdAt),
    digest: string(source.digest),
    flowId: string(source.flowId),
    modelVersion: integer(source.modelVersion),
    parentRevisionId,
    revisionId: string(source.revisionId),
    version: 1,
  }
}

function draft(value: unknown): Draft {
  const source = record(value)
  const content = record(source.content)
  if (content.modelVersion != 1) return invalidResponse()
  record(content.document)
  record(content.modules)
  return { ...revisionMetadata(source), content: source.content as RevisionContent }
}

function draftChange(value: unknown): DraftChange {
  const source = record(value)
  if (source.version != 1) return invalidResponse()
  return { revision: revisionMetadata(source.revision), version: 1 }
}

function draftSync(value: unknown): DraftSync {
  const source = record(value)
  if (source.version != 1 || source.kind != 'snapshot') return invalidResponse()
  return { draft: draft(source.draft), kind: 'snapshot', version: 1 }
}

function publication(value: unknown): Publication {
  const source = record(value)
  const operation = source.operation
  const sourcePublicationId = source.sourcePublicationId
  if (source.version != 1) return invalidResponse()
  if (operation != 'publish' && operation != 'rollback') return invalidResponse()
  if (sourcePublicationId != null && typeof sourcePublicationId != 'string') return invalidResponse()
  return {
    actorId: string(source.actorId),
    closureDigest: string(source.closureDigest),
    createdAt: string(source.createdAt),
    engineContract: string(source.engineContract),
    flowId: string(source.flowId),
    modelVersion: integer(source.modelVersion),
    operation: operation as Publication['operation'],
    publicationId: string(source.publicationId),
    revisionDigest: string(source.revisionDigest),
    revisionId: string(source.revisionId),
    ...(sourcePublicationId == null ? {} : { sourcePublicationId }),
    version: 1,
  }
}

function publishOperation(value: unknown): PublishOperation {
  const source = record(value)
  const status = source.status
  const common = {
    createdAt: string(source.createdAt),
    flowId: string(source.flowId),
    operationId: string(source.operationId),
    revisionId: string(source.revisionId),
    updatedAt: string(source.updatedAt),
    version: 1 as const,
  }
  if (source.version != 1) return invalidResponse()
  switch (status) {
    case 'pending':
      exact(source, ['createdAt', 'flowId', 'operationId', 'revisionId', 'status', 'updatedAt', 'version'])
      return { ...common, status }
    case 'succeeded':
      exact(source, ['createdAt', 'flowId', 'operationId', 'publicationId', 'revisionId', 'status', 'updatedAt', 'version'])
      return { ...common, publicationId: string(source.publicationId), status }
    case 'failed': {
      exact(source, ['createdAt', 'flowId', 'issue', 'operationId', 'revisionId', 'status', 'updatedAt', 'version'])
      const issue = record(source.issue)
      const nodeId = issue.nodeId
      exact(issue, ['code', 'message', ...(nodeId == null ? [] : ['nodeId'])])
      return {
        ...common,
        issue: { code: string(issue.code), message: string(issue.message), ...(nodeId == null ? {} : { nodeId: string(nodeId) }) },
        status,
      }
    }
    default:
      return invalidResponse()
  }
}

function diagnostic(value: unknown): Diagnostic {
  const source = record(value)
  const values = source.values == null ? undefined : record(source.values)
  return {
    code: string(source.code),
    column: integer(source.column),
    line: integer(source.line),
    message: string(source.message),
    path: typeof source.path == 'string' ? source.path : invalidResponse(),
    ...(values == null
      ? {}
      : {
          values: Object.fromEntries(
            Object.entries(values).map(([key, candidate]) => [
              key,
              typeof candidate == 'string' || typeof candidate == 'number' ? candidate : invalidResponse(),
            ]),
          ),
        }),
  }
}

function flowCheck(value: unknown): FlowCheck {
  const source = record(value)
  if (source.version != 1 || typeof source.valid != 'boolean' || !Array.isArray(source.diagnostics)) return invalidResponse()
  return {
    closureDigest: string(source.closureDigest),
    diagnostics: source.diagnostics.map(diagnostic),
    engineContract: string(source.engineContract),
    flowId: string(source.flowId),
    modelVersion: integer(source.modelVersion),
    revisionDigest: string(source.revisionDigest),
    revisionId: string(source.revisionId),
    valid: source.valid,
    version: 1,
  }
}

function live(value: unknown): Live {
  const source = record(value)
  const status = source.status
  const candidate = source.publication
  if (source.version != 1 || typeof source.hasUnpublishedChanges != 'boolean') return invalidResponse()
  if (status != 'not-published' && status != 'runnable' && status != 'suspended') return invalidResponse()
  if (status == 'not-published' && candidate !== null) return invalidResponse()
  if (status != 'not-published' && candidate === null) return invalidResponse()
  return {
    flowId: string(source.flowId),
    hasUnpublishedChanges: source.hasUnpublishedChanges,
    publication: candidate === null ? null : publication(candidate),
    revision: integer(source.revision),
    status: status as Live['status'],
    version: 1,
  }
}

function publicationPage(value: unknown): PublicationPage {
  const source = record(value)
  const nextCursor = source.nextCursor
  const total = source.total
  if (source.version != 1 || !Array.isArray(source.publications)) return invalidResponse()
  if (nextCursor != null && typeof nextCursor != 'string') return invalidResponse()
  if (total != null && !Number.isSafeInteger(total)) return invalidResponse()
  return {
    ...(nextCursor == null ? {} : { nextCursor }),
    publications: source.publications.map(publication),
    ...(total == null ? {} : { total: total as number }),
    version: 1,
  }
}

const runStatusSet: ReadonlySet<RunStatus> = new Set(runStatuses)

function runStatus(value: unknown): RunStatus {
  return typeof value == 'string' && runStatusSet.has(value as RunStatus) ? (value as RunStatus) : invalidResponse()
}

function run(value: unknown): Run {
  const source = record(value)
  const kind = source.source
  const startedAt = source.startedAt
  const finishedAt = source.finishedAt
  if (source.version != 1 || (kind != 'draft' && kind != 'live' && kind != 'trigger')) return invalidResponse()
  if (startedAt != null && typeof startedAt != 'string') return invalidResponse()
  if (finishedAt != null && typeof finishedAt != 'string') return invalidResponse()
  return {
    createdAt: string(source.createdAt),
    ...(finishedAt == null ? {} : { finishedAt }),
    flowId: string(source.flowId),
    revisionId: string(source.revisionId),
    runId: string(source.runId),
    source: kind as Run['source'],
    ...(startedAt == null ? {} : { startedAt }),
    status: runStatus(source.status),
    version: 1,
  }
}

function runDetails(value: unknown): RunDetails {
  const source = record(value)
  const summary = run(source)
  const eventsExpiresAt = source.eventsExpiresAt
  if (eventsExpiresAt != null && typeof eventsExpiresAt != 'string') return invalidResponse()
  const details = {
    ...summary,
    closureDigest: string(source.closureDigest),
    engineContract: string(source.engineContract),
    engineDigest: string(source.engineDigest),
    ...(eventsExpiresAt == null ? {} : { eventsExpiresAt }),
    modelVersion: integer(source.modelVersion),
    revisionDigest: string(source.revisionDigest),
  }
  switch (summary.source) {
    case 'draft':
      return { ...details, source: 'draft' }
    case 'live':
      return { ...details, publicationId: string(source.publicationId), source: 'live' }
    case 'trigger':
      return {
        ...details,
        occurrenceId: string(source.occurrenceId),
        publicationId: string(source.publicationId),
        source: 'trigger',
        triggerNodeId: string(source.triggerNodeId),
      }
  }
}

function runPage(value: unknown): RunPage {
  const source = record(value)
  const nextCursor = source.nextCursor
  if (source.version != 1 || !Array.isArray(source.runs)) return invalidResponse()
  if (nextCursor != null && typeof nextCursor != 'string') return invalidResponse()
  return {
    flowId: string(source.flowId),
    ...(nextCursor == null ? {} : { nextCursor }),
    runs: source.runs.map(run),
    version: 1,
  }
}

const runEventKinds = new Set<RunEventKind>([
  'node.artifact',
  'node.completed',
  'node.failed',
  'node.log',
  'node.output',
  'node.progress',
  'node.started',
  'run.canceled',
  'run.completed',
  'run.events-truncated',
  'run.failed',
  'run.indeterminate',
  'run.progress',
  'run.queued',
  'run.started',
])

function runEvent(value: unknown): RunEvent {
  const source = record(value)
  const kind = source.kind
  const sequence = integer(source.sequence)
  const sourceSequence = source.sourceSequence
  if (typeof kind != 'string' || !runEventKinds.has(kind as RunEventKind) || sequence < 0) return invalidResponse()
  if (sourceSequence != null && (!Number.isSafeInteger(sourceSequence) || (sourceSequence as number) < 0)) return invalidResponse()
  return {
    createdAt: string(source.createdAt),
    kind: kind as RunEventKind,
    payload: record(source.payload) as Readonly<Record<string, JsonValue>>,
    sequence,
    ...(sourceSequence == null ? {} : { sourceSequence: sourceSequence as number }),
  }
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
    events: source.events.map(runEvent),
    ...(eventsExpiresAt == null ? {} : { eventsExpiresAt }),
    historyComplete: source.historyComplete,
    nextAfter,
    runId: string(source.runId),
    version: 1,
  }
}

function runCancellation(value: unknown): RunCancellation {
  const source = record(value)
  const status = runStatus(source.status)
  if (source.version != 1 || typeof source.cancelAccepted != 'boolean' || status == 'queued' || status == 'starting' || status == 'running') {
    return invalidResponse()
  }
  return { cancelAccepted: source.cancelAccepted, runId: string(source.runId), status, version: 1 }
}

function runResult(value: unknown): RunResult {
  const source = record(value)
  const status = source.status
  if (source.version != 1) return invalidResponse()
  const base = { finishedAt: string(source.finishedAt), runId: string(source.runId), version: 1 as const }
  if (status == 'completed') {
    if (!Object.hasOwn(source, 'result')) return invalidResponse()
    return { ...base, result: source.result as JsonValue, status: 'completed' }
  }
  if (status == 'canceled') return { ...base, status: 'canceled' }
  if (status == 'failed') {
    const error = record(source.error)
    return { ...base, error: { code: string(error.code), message: string(error.message) }, status: 'failed' }
  }
  if (status == 'indeterminate') {
    const error = record(source.error)
    return { ...base, error: { code: string(error.code), message: string(error.message) }, status: 'indeterminate' }
  }
  return invalidResponse()
}

const segment = encodeURIComponent

function operationKey(operation: string): string {
  return `${operation}-${crypto.randomUUID()}`
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

  async createFlow(name: string, idempotencyKey = `flow-${crypto.randomUUID()}`): Promise<Flow> {
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

  async listFlowTriggerBindings(flowId: string): Promise<readonly TriggerBinding[]> {
    const source = record(await this.request(`/v1/flows/${segment(flowId)}/triggers`))
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
        body: JSON.stringify({ engineContract: 'open-flow-engine/v1', version: 1 }),
        method: 'POST',
      }),
    )
  }

  async getLive(flowId: string): Promise<Live> {
    return live(await this.request(`/v1/flows/${segment(flowId)}/live`))
  }

  async listPublications(
    flowId: string,
    options: { readonly cursor?: string; readonly includeTotal?: boolean; readonly limit?: number } = {},
  ): Promise<PublicationPage> {
    const parameters = new URLSearchParams()
    if (options.cursor != null) parameters.set('cursor', options.cursor)
    if (options.limit != null) parameters.set('limit', String(options.limit))
    if (options.includeTotal != null) parameters.set('includeTotal', String(options.includeTotal))
    const query = parameters.size == 0 ? '' : `?${parameters}`
    return publicationPage(await this.request(`/v1/flows/${segment(flowId)}/publications${query}`))
  }

  async createDraftRun(flowId: string, revisionId: string, options: RunOptions = {}): Promise<DraftRun> {
    const created = runDetails(
      await this.request(`/v1/flows/${segment(flowId)}/revisions/${segment(revisionId)}/runs`, {
        body: JSON.stringify({ engineContract: 'open-flow-engine/v1', inputs: options.inputs ?? {}, version: 1 }),
        headers: { 'idempotency-key': options.idempotencyKey ?? operationKey('run') },
        method: 'POST',
      }),
    )
    return created.source == 'draft' ? created : invalidResponse()
  }

  async createLiveRun(publicationId: string, options: RunOptions = {}): Promise<LiveRun> {
    const created = runDetails(
      await this.request('/v1/runs', {
        body: JSON.stringify({ inputs: options.inputs ?? {}, publicationId, version: 1 }),
        headers: { 'idempotency-key': options.idempotencyKey ?? operationKey('run') },
        method: 'POST',
      }),
    )
    return created.source == 'live' ? created : invalidResponse()
  }

  async publishFlow(flowId: string, revisionId: string, expectedLivePublicationId: string | null, options: PublicationOptions = {}): Promise<PublishOperation> {
    return publishOperation(
      await this.request(`/v1/flows/${segment(flowId)}/revisions/${segment(revisionId)}/publications`, {
        body: JSON.stringify({ engineContract: 'open-flow-engine/v1', expectedLivePublicationId, version: 1 }),
        headers: { 'idempotency-key': options.idempotencyKey ?? operationKey('publication') },
        method: 'POST',
      }),
    )
  }

  async getPublishOperation(flowId: string, operationId: string): Promise<PublishOperation> {
    return publishOperation(await this.request(`/v1/flows/${segment(flowId)}/publish-operations/${segment(operationId)}`))
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

  async getRun(runId: string): Promise<RunDetails> {
    return runDetails(await this.request(`/v1/runs/${segment(runId)}`))
  }

  async listRuns(flowId: string, options: { readonly cursor?: string; readonly limit?: number; readonly status?: RunStatus } = {}): Promise<RunPage> {
    const parameters = new URLSearchParams()
    if (options.cursor != null) parameters.set('cursor', options.cursor)
    if (options.limit != null) parameters.set('limit', String(options.limit))
    if (options.status != null) parameters.set('status', options.status)
    const query = parameters.size == 0 ? '' : `?${parameters}`
    return runPage(await this.request(`/v1/flows/${segment(flowId)}/runs${query}`))
  }

  async getRunEvents(runId: string, options: { readonly after?: number; readonly limit?: number } = {}): Promise<RunEvents> {
    const parameters = new URLSearchParams()
    if (options.after != null) parameters.set('after', String(options.after))
    if (options.limit != null) parameters.set('limit', String(options.limit))
    const query = parameters.size == 0 ? '' : `?${parameters}`
    return runEvents(await this.request(`/v1/runs/${segment(runId)}/events${query}`))
  }

  async getRunResult(runId: string): Promise<RunResult> {
    return runResult(await this.request(`/v1/runs/${segment(runId)}/result`))
  }

  async cancelRun(runId: string): Promise<RunCancellation> {
    return runCancellation(
      await this.request(`/v1/runs/${segment(runId)}/cancel`, {
        body: JSON.stringify({ version: 1 }),
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

  protected async request<Value = unknown>(path: string, init: RequestInit = {}): Promise<Value> {
    const headers = new Headers(init.headers)
    if (init.body != null) headers.set('content-type', 'application/json')
    const response = await this.requestControl(path, { ...init, headers })
    let value: unknown
    try {
      value = await response.json()
    } catch {
      return invalidResponse()
    }
    if (!response.ok) {
      const error = record(value).error
      const source = error == null ? undefined : record(error)
      throw new ApiError(
        response.status,
        typeof source?.code == 'string' ? source.code : 'request.failed',
        typeof source?.message == 'string' ? source.message : `Request failed with status ${response.status}.`,
      )
    }
    return value as Value
  }
}
