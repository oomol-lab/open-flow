import type { TFunction } from 'val-i18n'
import type { GraphNode, Port, ResolutionNode, TriggerNode } from '../../../../flow/common/change.ts'
import type { InputSourceCandidate } from '../../../../flow/common/graph.ts'

import { waitBranchDescription } from '../../../../canvas/browser/i18n/waitBranchLocales.ts'
import { resolutionOutputPorts } from '../../../../flow/common/graph.ts'
import { triggerOutputDefinitions } from '../../../../trigger/common/contract.ts'

function withDescriptions(ports: readonly Port[], descriptionFor: (handle: string) => string | undefined): readonly Port[] {
  return ports.map((port) => {
    const description = descriptionFor(port.handle)
    return description == null ? port : Object.assign({}, port, { description })
  })
}

/** Adds localized UI copy to built-in Trigger outputs without changing their runtime definitions. */
export function presentBuiltInTriggerOutputs(trigger: TriggerNode, t: TFunction): readonly Port[] {
  const ports = triggerOutputDefinitions(trigger)
  switch (trigger.kind) {
    case 'cron':
      return withDescriptions(ports, (handle) => (handle === 'scheduledAt' ? t('inspector.ports.builtIn.cron.scheduledAt') : undefined))
    case 'webhook':
      return withDescriptions(ports, (handle) => {
        switch (handle) {
          case 'headers':
            return t('inspector.ports.builtIn.webhook.headers')
          case 'query':
            return t('inspector.ports.builtIn.webhook.query')
          case 'body':
            return t('inspector.ports.builtIn.webhook.body')
          case 'webhookUrl':
            return t('inspector.ports.builtIn.webhook.webhookUrl')
          default:
            return
        }
      })
    default:
      return ports
  }
}

/** Adds canvas-owned branch copy to built-in Wait and Approval outputs for inspector display only. */
export function presentResolutionOutputs(node: ResolutionNode, t: TFunction): readonly Port[] {
  const ports = Object.entries(resolutionOutputPorts(node)).map(([handle, port]) => Object.assign({ handle }, port))
  return withDescriptions(ports, (handle) => waitBranchDescription(t, node.kind, handle))
}

function presentedBuiltInOutputs(node: GraphNode, t: TFunction): readonly Port[] | undefined {
  switch (node.kind) {
    case 'approval':
    case 'wait':
      return presentResolutionOutputs(node, t)
    case 'cron':
    case 'webhook':
      return presentBuiltInTriggerOutputs(node, t)
    default:
      return
  }
}

/** Applies localized built-in output copy to source candidates without changing graph-owned data. */
export function presentBuiltInSourceCandidates(node: GraphNode, candidates: readonly InputSourceCandidate[], t: TFunction): readonly InputSourceCandidate[] {
  const outputs = presentedBuiltInOutputs(node, t)
  if (outputs == null) return candidates
  const descriptions = new Map(outputs.map((port) => [port.handle, port.description]))
  return candidates.map((candidate) => {
    const description = descriptions.get(candidate.output)
    return description == null || description == candidate.description ? candidate : Object.assign({}, candidate, { description })
  })
}

/** Returns localized built-in copy when available, otherwise preserving the port-owned description. */
export function presentBuiltInOutputDescription(node: GraphNode, output: string, description: string | undefined, t: TFunction): string | undefined {
  return presentedBuiltInOutputs(node, t)?.find((port) => port.handle == output)?.description ?? description
}
