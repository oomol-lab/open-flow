import type { ConnectorProvider } from './api.ts'
import type { ConnectorActionView } from './connectionCatalog.ts'

import { providerIcon } from './providerIcon.ts'

/** Keep provider order by first selection, while counting every action. */
export function actionSummary(
  entries: readonly { readonly action: string }[],
  actions: Readonly<Record<string, ConnectorActionView>>,
  providers: readonly ConnectorProvider[],
) {
  const unique = new Map<string, { id: string; icon: string; label: string }>()
  for (const entry of entries) {
    const action = actions[entry.action]
    const serviceId = action?.serviceId ?? entry.action.split('.')[0]!
    if (unique.has(serviceId)) continue
    const provider = action ?? providers.find((item) => item.serviceId === serviceId) ?? { serviceId, serviceName: serviceId }
    unique.set(serviceId, { id: serviceId, icon: providerIcon(provider), label: provider.serviceName })
  }
  return { count: entries.length, providers: [...unique.values()] }
}
