import type { FlowDocument, TriggerNode, WebhookOptions } from '../../flow/common/change.ts'

import { fieldsView } from './authoringFields.ts'

/** Shared business configuration for authoring and published entry inspection. */
export function triggerConfiguration(node: TriggerNode, document: FlowDocument) {
  switch (node.kind) {
    case 'start':
      return { inputDefs: fieldsView(node.inputDefs) }
    case 'manual':
      return {}
    case 'webhook':
      return {
        body: fieldsView(node.bodyFields),
        method: node.method,
        ...(node.options == null ? {} : { options: webhookOptionsView(node.options, document) }),
      }
    case 'cron':
      return { schedule: node.cronTimes }
    case 'error':
      return node.sourceFlowIds == null ? {} : { sourceFlowIds: node.sourceFlowIds }
    case 'poll':
    case 'integration':
      return {
        key: node.definition.key,
        ...(node.connectionId == null ? {} : { connectionId: node.connectionId }),
        ...(node.kind == 'poll' ? { schedule: node.pollTimes } : {}),
      }
  }
}

/** Public authoring names the secret Variable; the internal binding identity stays private. */
function webhookOptionsView(options: WebhookOptions, document: FlowDocument) {
  const authentication = options.authentication
  if (authentication == null) return options
  const name = document.bindings[authentication.secret.bindingId]?.target ?? '[missing variable]'
  return { ...options, authentication: { ...authentication, secret: { kind: 'variable' as const, name } } }
}
