import type { JsonValue, RevisionContent } from '../../flow/common/change.ts'
import type { TriggerBinding } from './api.ts'

import { authoringNode } from './authoring.ts'
import { invalidResponse, jsonValue, record, string } from './decoding.ts'
import { triggerBinding } from './triggerDecoders.ts'

export interface PublicationResource {
  readonly resourceId: string
  readonly kind: 'trigger'
  readonly type: TriggerBinding['kind']
  readonly name: string
  readonly description?: string
  readonly config: JsonValue
  readonly inputs: JsonValue
  readonly runtime?: TriggerBinding
}

export interface PublicationResourceContext {
  readonly flowId: string
  readonly publicationId: string
  readonly revisionId: string
  readonly status: 'live' | 'historical'
  readonly enabled?: boolean
  readonly version: 1
}

export interface PublicationResources extends PublicationResourceContext {
  readonly resources: readonly PublicationResource[]
}

export interface PublicationResourceDetail extends PublicationResourceContext {
  readonly resource: PublicationResource
}

export function publicationResources(content: RevisionContent): readonly PublicationResource[] {
  return Object.entries(content.document.graph.nodes).flatMap(([resourceId, node]) => {
    if (node.kind != 'webhook' && node.kind != 'cron' && node.kind != 'poll' && node.kind != 'integration' && node.kind != 'error') return []
    const view = authoringNode(content, resourceId)
    return [
      {
        resourceId,
        kind: 'trigger' as const,
        type: node.kind,
        name: view.name,
        ...(view.description == null ? {} : { description: view.description }),
        config: view.config,
        inputs: view.inputs as JsonValue,
      },
    ]
  })
}

function context(source: Readonly<Record<string, unknown>>): PublicationResourceContext {
  if (source.version != 1 || (source.status != 'live' && source.status != 'historical')) return invalidResponse()
  if (source.status == 'live' ? typeof source.enabled != 'boolean' : source.enabled !== undefined) return invalidResponse()
  return {
    flowId: string(source.flowId),
    publicationId: string(source.publicationId),
    revisionId: string(source.revisionId),
    status: source.status as PublicationResourceContext['status'],
    ...(source.enabled == null ? {} : { enabled: source.enabled as boolean }),
    version: 1,
  }
}

function resource(value: unknown, scope: PublicationResourceContext): PublicationResource {
  const source = record(value)
  const type = source.type
  if (source.kind != 'trigger' || (type != 'webhook' && type != 'cron' && type != 'poll' && type != 'integration' && type != 'error')) return invalidResponse()
  if (source.description != null && typeof source.description != 'string') return invalidResponse()
  const resourceId = string(source.resourceId)
  const runtime = source.runtime == null ? undefined : triggerBinding(source.runtime)
  if (
    runtime != null &&
    (scope.status != 'live' ||
      runtime.flowId != scope.flowId ||
      runtime.currentPublicationId != scope.publicationId ||
      runtime.currentRevisionId != scope.revisionId ||
      runtime.triggerNodeId != resourceId ||
      runtime.kind != type)
  )
    return invalidResponse()
  return {
    resourceId,
    kind: 'trigger',
    type: type as PublicationResource['type'],
    name: string(source.name),
    ...(source.description == null ? {} : { description: source.description as string }),
    config: jsonValue(source.config),
    inputs: jsonValue(source.inputs),
    ...(runtime == null ? {} : { runtime }),
  }
}

export function decodePublicationResources(value: unknown): PublicationResources {
  const source = record(value)
  const scope = context(source)
  if (!Array.isArray(source.resources)) return invalidResponse()
  return { ...scope, resources: source.resources.map((item) => resource(item, scope)) }
}

export function decodePublicationResource(value: unknown): PublicationResourceDetail {
  const source = record(value)
  const scope = context(source)
  return { ...scope, resource: resource(source.resource, scope) }
}
