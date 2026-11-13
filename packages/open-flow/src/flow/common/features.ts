import type { EngineCapability, EngineContract } from '../../runtime/common/engineContract.ts'
import type { GraphNode, RevisionContent } from './change.ts'

import { engineCapabilityRevisions } from '../../runtime/common/engineContract.ts'
import { nodeWorkflowReferences } from './workflowReferences.ts'

/**
 * Optional Flow functionality that only takes effect when a Revision uses it. Engine capabilities are the features
 * whose execution needs Engine support.
 *
 * Names and detection rules are permanent once published. A new feature may only detect content that every earlier
 * package rejects (a new node, executor or Capability kind, or a new field), so existing documents never start
 * requiring a feature they did not declare.
 */
export type FlowFeature = EngineCapability

/** The first Flow model whose serialized documents declare non-baseline features in `features`. */
export const flowFeaturesModelVersion = 16

/** A document uses features this package does not know; it must not be repaired or rewritten. */
export class UnsupportedFlowFeaturesError extends TypeError {
  readonly features: readonly string[]
  constructor(features: readonly string[]) {
    super(`This Flow uses features this package does not support: ${features.join(', ')}.`)
    this.features = features
    this.name = 'UnsupportedFlowFeaturesError'
  }
}

interface FlowFeatureDefinition {
  /** Known to every Model v16 reader, so documents never declare it in `features`. */
  readonly baseline: boolean
  readonly detect: (content: RevisionContent) => boolean
}

const someNode = (predicate: (node: GraphNode) => boolean) => (content: RevisionContent) => Object.values(content.document.graph.nodes).some(predicate)
const executorKind = (node: GraphNode) => (node.kind == 'task' && 'executor' in node.task ? node.task.executor.kind : undefined)

const flowFeatures: Readonly<Record<FlowFeature, FlowFeatureDefinition>> = {
  'webhook-response': {
    baseline: true,
    detect: someNode((node) => node.kind == 'webhook-response' || (node.kind == 'webhook' && node.options?.responseBody?.kind == 'webhook-response')),
  },
  'wait-auto-continue': { baseline: true, detect: someNode((node) => node.kind == 'wait' && node.autoContinue != null) },
  'workflow-tools': { baseline: true, detect: someNode((node) => nodeWorkflowReferences(node).some((ref) => ref.tool != null)) },
  'http-request': { baseline: true, detect: someNode((node) => executorKind(node) == 'http-request') },
  'code-http': {
    baseline: true,
    detect: someNode((node) => node.kind == 'task' && 'moduleId' in node.task && node.task.capabilities?.some((item) => item.kind == 'http') == true),
  },
  'skip-duplicates': { baseline: true, detect: someNode((node) => executorKind(node) == 'skip-duplicates') },
  'connector-proxy': { baseline: true, detect: someNode((node) => executorKind(node) == 'connector-proxy') },
  'delay': { baseline: true, detect: someNode((node) => node.kind == 'delay') },
}

const featureNames = (Object.keys(flowFeatures) as FlowFeature[]).toSorted()

export function isKnownFlowFeature(name: string): name is FlowFeature {
  return Object.hasOwn(flowFeatures, name)
}

/** Features a Revision uses, sorted. */
export function usedFlowFeatures(content: RevisionContent): readonly FlowFeature[] {
  return featureNames.filter((name) => flowFeatures[name].detect(content))
}

/** Features a Model v16 document must declare: the used features outside the v16 baseline, sorted. */
export function declaredFlowFeatures(content: RevisionContent): readonly FlowFeature[] {
  return featureNames.filter((name) => !flowFeatures[name].baseline && flowFeatures[name].detect(content))
}

/** Engine capabilities a Revision needs, sorted. */
export function requiredEngineCapabilities(content: RevisionContent): readonly EngineCapability[] {
  return usedFlowFeatures(content).filter((name) => Object.hasOwn(engineCapabilityRevisions, name))
}

/** Engine capabilities a Revision needs that the contract does not provide, sorted. */
export function missingEngineCapabilities(content: RevisionContent, engine: EngineContract): readonly EngineCapability[] {
  return requiredEngineCapabilities(content).filter((name) => !engine.capabilities.has(name))
}

/** Revision content in its wire form. Model v16 and later carry the derived `features` list. */
export type SerializedRevisionContent = RevisionContent & { readonly features?: readonly FlowFeature[] }

/**
 * The wire form of Revision content for Control API bodies and workflow files. Decoders verify and drop `features`,
 * so every serialized exit must use this function. Earlier models serialize unchanged.
 */
export function serializeRevisionContent(content: RevisionContent): SerializedRevisionContent {
  return content.modelVersion >= flowFeaturesModelVersion ? { ...content, features: declaredFlowFeatures(content) } : content
}
