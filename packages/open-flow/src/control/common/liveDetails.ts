import type { RevisionContent } from '../../flow/common/change.ts'
import type { Publication, TriggerBinding } from './api.ts'

import { z } from 'zod'
import { webhookSupportsBody } from '../../flow/common/webhookMethod.ts'
import { flowInputFieldsView, authoringConfigurations } from './authoringSchema.ts'
import { triggerConfiguration } from './authoringTriggers.ts'
import { invalidResponse, record, string } from './decoding.ts'
import { publication } from './publicationDecoders.ts'
import { triggerBinding } from './triggerDecoders.ts'

const metadata = { nodeId: z.string().min(1), name: z.string(), description: z.string().optional() }
const binding = z.unknown().transform(triggerBinding)
const provider = {
  provider: z.string().min(1),
  inputs: z.record(z.string(), z.discriminatedUnion('kind', [z.object({ kind: z.literal('value'), value: z.json() }), z.object({ kind: z.literal('unset') })])),
}
const entrySchema = z.discriminatedUnion('type', [
  z.object({ ...metadata, type: z.literal('start'), config: authoringConfigurations.start }),
  z.object({ ...metadata, type: z.literal('manual'), config: z.object({}) }),
  z.object({ ...metadata, type: z.literal('webhook'), config: authoringConfigurations.webhook, binding }),
  z.object({ ...metadata, type: z.literal('cron'), config: authoringConfigurations.cron, binding }),
  z.object({ ...metadata, type: z.literal('error'), config: authoringConfigurations.error, binding }),
  z.object({ ...metadata, ...provider, type: z.literal('poll'), config: authoringConfigurations.poll, binding }),
  z.object({ ...metadata, ...provider, type: z.literal('integration'), config: authoringConfigurations.integration, binding }),
])

export type LiveEntry = z.infer<typeof entrySchema>
export type LiveDetails = { readonly flowId: string; readonly version: 1 } & (
  | { readonly inputDefs: null; readonly publication: null; readonly status: 'not-published'; readonly entries: readonly [] }
  | {
      readonly inputDefs: z.infer<typeof flowInputFieldsView>
      readonly publication: Publication
      readonly status: 'runnable' | 'suspended'
      readonly enabled: boolean
      readonly entries: readonly LiveEntry[]
    }
)

/** Project only the selected published definition and its current bindings. */
export function liveEntries(content: RevisionContent, current: Publication, bindings: readonly TriggerBinding[]): readonly LiveEntry[] {
  const byNode = new Map(
    bindings
      .filter((item) => item.flowId == current.flowId && item.currentPublicationId == current.publicationId && item.currentRevisionId == current.revisionId)
      .map((item) => [item.triggerNodeId, item]),
  )
  const entries = Object.entries(content.document.graph.nodes)
    .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .flatMap(([nodeId, node]) => {
      if (
        node.kind != 'start' &&
        node.kind != 'manual' &&
        node.kind != 'webhook' &&
        node.kind != 'cron' &&
        node.kind != 'error' &&
        node.kind != 'poll' &&
        node.kind != 'integration'
      )
        return []
      const config = triggerConfiguration(node, content.document)
      const value = {
        nodeId,
        name: node.name,
        type: node.kind,
        ...(node.description == null ? {} : { description: node.description }),
        config: node.kind == 'webhook' && !webhookSupportsBody(node.method) ? { ...config, body: {} } : config,
        ...(node.kind == 'start' || node.kind == 'manual' ? {} : { binding: byNode.get(nodeId) }),
        ...(node.kind == 'poll' || node.kind == 'integration' ? { provider: node.definition.provider, inputs: node.config } : {}),
      }
      return [value]
    })
  return decodeEntries(entries, current)
}

export function decodeLiveDetails(value: unknown): LiveDetails {
  const source = record(value)
  const flowId = string(source.flowId)
  if (source.version != 1 || !Array.isArray(source.entries)) return invalidResponse()
  if (source.publication === null) {
    if (source.inputDefs !== null || source.status != 'not-published' || source.entries.length != 0 || Object.hasOwn(source, 'enabled'))
      return invalidResponse()
    return { flowId, inputDefs: null, publication: null, status: 'not-published', entries: [], version: 1 }
  }
  const current = publication(source.publication)
  const status = source.status
  if (current.flowId != flowId || typeof source.enabled != 'boolean') return invalidResponse()
  if (status != 'runnable' && status != 'suspended') return invalidResponse()
  if (!source.enabled && source.status == 'runnable') return invalidResponse()
  const inputDefs = flowInputFieldsView.safeParse(source.inputDefs)
  if (!inputDefs.success) return invalidResponse()
  return {
    flowId,
    inputDefs: inputDefs.data,
    publication: current,
    status: status as 'runnable' | 'suspended',
    enabled: source.enabled,
    entries: decodeEntries(source.entries, current),
    version: 1,
  }
}

/** Both producers and consumers enforce the same published-entry invariants. */
function decodeEntries(values: unknown, current: Publication): readonly LiveEntry[] {
  const parsed = z.array(entrySchema).safeParse(values)
  if (!parsed.success) return invalidResponse()
  const ids = new Set<string>()
  for (const entry of parsed.data) {
    if (ids.has(entry.nodeId)) return invalidResponse()
    ids.add(entry.nodeId)
    if (
      entry.type != 'start' &&
      entry.type != 'manual' &&
      (entry.binding.flowId != current.flowId ||
        entry.binding.triggerNodeId != entry.nodeId ||
        entry.binding.kind != entry.type ||
        entry.binding.currentPublicationId != current.publicationId ||
        entry.binding.currentRevisionId != current.revisionId)
    )
      return invalidResponse()
    if (entry.type == 'webhook' && (!entry.binding.endpointUrl || (!webhookSupportsBody(entry.config.method) && Object.keys(entry.config.body).length > 0)))
      return invalidResponse()
  }
  return parsed.data
}
