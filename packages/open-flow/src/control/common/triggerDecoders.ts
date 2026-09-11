import type { TriggerKeySnapshot } from '../../flow/common/change.ts'
import type {
  PollTriggerTestResult,
  TriggerActivity,
  TriggerActivityKind,
  TriggerActivityPage,
  TriggerBinding,
  TriggerBindingDetail,
  TriggerKeySummary,
} from './api.ts'

import { integer, invalidResponse, jsonValue, optionalString, record, string } from './decoding.ts'

export function triggerKeySummary(value: unknown): TriggerKeySummary {
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

export function triggerKey(value: unknown): TriggerKeySnapshot {
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

export function triggerBinding(value: unknown): TriggerBinding {
  const source = record(value)
  const health = source.health
  const listener = source.listener == null ? undefined : record(source.listener)
  if (listener != null && listener.health != 'healthy' && listener.health != 'failed' && listener.health != 'needs_reauth') return invalidResponse()
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
    ...(listener == null
      ? {}
      : {
          listener: {
            health: listener.health as NonNullable<TriggerBinding['listener']>['health'],
            ...(listener.lastErrorCode == null ? {} : { lastErrorCode: string(listener.lastErrorCode) }),
          },
        }),
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

export function triggerBindingDetail(value: unknown): TriggerBindingDetail {
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

export function triggerActivityPage(value: unknown): TriggerActivityPage {
  const source = record(value)
  const nextCursor = optionalString(source.nextCursor)
  if (source.version != 1 || !Array.isArray(source.activities)) return invalidResponse()
  return {
    activities: source.activities.map(triggerActivity),
    ...(nextCursor == null ? {} : { nextCursor }),
    version: 1,
  }
}

export function pollTriggerTestResult(value: unknown): PollTriggerTestResult {
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
