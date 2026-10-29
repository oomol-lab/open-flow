import type { ConnectorProvider } from './api.ts'
import type { ConnectorActionView } from './connectionCatalog.ts'

import { providerIcon } from './providerIcon.ts'

/** Keep provider order by first selection, while counting every action. */
export function actionSummary(
  entries: readonly (
    | { readonly action: string; readonly kind?: 'connector' }
    | { readonly kind: 'workflow'; readonly flowId: string; readonly name: string }
  )[],
  actions: Readonly<Record<string, ConnectorActionView>>,
  providers: readonly ConnectorProvider[],
) {
  const unique = new Map<string, { id: string; icon: string; label: string }>()
  for (const entry of entries) {
    if (entry.kind == 'workflow') {
      unique.set(`workflow:${entry.flowId}`, { id: `workflow:${entry.flowId}`, icon: 'i-lucide-light:workflow', label: entry.name })
      continue
    }
    const action = actions[entry.action]
    const serviceId = action?.serviceId ?? entry.action.split('.')[0]!
    if (unique.has(serviceId)) continue
    const provider = action ?? providers.find((item) => item.serviceId === serviceId) ?? { serviceId, serviceName: serviceId }
    unique.set(serviceId, { id: serviceId, icon: providerIcon(provider), label: provider.serviceName })
  }
  return { count: entries.length, workflows: entries.filter((entry) => entry.kind == 'workflow').length, providers: [...unique.values()] }
}
