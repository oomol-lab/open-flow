import type { TFunction } from 'val-i18n'
import type { Port, ResolutionNode, TriggerNode } from '../../../../flow/common/change.ts'

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
  if (trigger.kind !== 'cron') return ports
  return withDescriptions(ports, (handle) => (handle === 'scheduledAt' ? t('inspector.ports.builtIn.cron.scheduledAt') : undefined))
}

/** Adds canvas-owned branch copy to built-in Wait and Approval outputs for inspector display only. */
export function presentResolutionOutputs(node: ResolutionNode, t: TFunction): readonly Port[] {
  const ports = Object.entries(resolutionOutputPorts(node)).map(([handle, port]) => Object.assign({ handle }, port))
  return withDescriptions(ports, (handle) => waitBranchDescription(t, node.kind, handle))
}
