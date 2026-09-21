import type { ReactElement } from 'react'
import type { ConnectorAccessCapability, ConnectorCapability } from '../../../../flow/common/change.ts'
import type { ConnectorAccess, ConnectorConnection, ConnectorProvider } from '../api.ts'
import type { ConnectorActionView } from '../connectionCatalog.ts'
import type { ConnectorStore } from '../stores/connectorStore.ts'
import type { WorkspaceStore } from '../stores/workspaceStore.ts'

import { useCallback, useState } from 'react'
import { useVal } from 'use-value-enhancer'
import { useLang, useTranslate } from 'val-i18n-react'
import { Button } from '../../../../ui/browser/button.tsx'
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '../../../../ui/browser/dialog.tsx'
import { ActionPicker } from './actionPicker.tsx'

export function availableConnectionGroups(
  connections: readonly ConnectorConnection[],
  providers: readonly ConnectorProvider[] | undefined,
  language: string,
  access?: ConnectorAccess,
): readonly { readonly connections: readonly ConnectorConnection[]; readonly name: string; readonly serviceId: string }[] {
  const providerNames = new Map(providers?.map((provider) => [provider.serviceId, provider.serviceName]))
  const bindings = new Set(access?.bindings.filter((binding) => binding.status == 'active').map((binding) => binding.providerId))
  const grouped = new Map<string, ConnectorConnection[]>()
  if (access?.mode == 'selectable') for (const providerId of bindings) grouped.set(providerId, [])
  for (const connection of connections) {
    if (connection.status != 'active' || (access?.mode == 'selectable' && !bindings.has(connection.serviceId))) continue
    const entries = grouped.get(connection.serviceId) ?? []
    entries.push(connection)
    grouped.set(connection.serviceId, entries)
  }
  return [...grouped]
    .map(([serviceId, entries]) => ({
      connections: entries.toSorted(
        (left, right) => Number(right.isDefault) - Number(left.isDefault) || left.displayName.localeCompare(right.displayName, language),
      ),
      name: providerNames.get(serviceId) ?? serviceId,
      serviceId,
    }))
    .toSorted((left, right) => left.name.localeCompare(right.name, language))
}

export function hintedCapability(capabilities: readonly ConnectorCapability[], action: ConnectorActionView, connectionId?: string): ConnectorAccessCapability {
  const current = capabilities.find((capability): capability is ConnectorAccessCapability => !('action' in capability))
  const actionHints = [
    ...new Set([
      ...(current?.actionHints ?? []),
      ...capabilities.flatMap((capability) => ('action' in capability ? [capability.action] : [])),
      action.actionId,
    ]),
  ]
  const legacyHints: { action: string; connectionId: string; alias?: string }[] = capabilities.flatMap((capability) =>
    'action' in capability
      ? [
          ...capability.connections.flatMap((connection) =>
            connection.alias == null ? [] : [{ action: capability.action, connectionId: connection.connectionId, alias: connection.alias }],
          ),
          ...(capability.connectionId == null ? [] : [{ action: capability.action, connectionId: capability.connectionId }]),
        ]
      : [],
  )
  const connectionHints = [...(current?.connectionHints ?? legacyHints)].filter(
    (hint) => hint.action != action.actionId || hint.alias != null || connectionId == null,
  )
  if (connectionId != null) connectionHints.push({ action: action.actionId, connectionId })
  return { kind: 'connector', actionHints, ...(connectionHints.length == 0 ? {} : { connectionHints }) }
}

export function CodeActions({
  access,
  connectors,
  disabled,
  store,
  capabilities,
  nodeId,
  prepareAction,
}: {
  readonly access?: ConnectorAccess
  readonly connectors: ConnectorStore
  readonly disabled: boolean
  readonly store: WorkspaceStore
  readonly capabilities: readonly ConnectorCapability[]
  readonly nodeId: string
  readonly prepareAction?: (
    action: ConnectorActionView,
  ) => Promise<{ readonly action: ConnectorActionView; readonly connections: readonly ConnectorConnection[] } | undefined>
}): ReactElement {
  const t = useTranslate()
  const language = useLang()
  const [root, setRoot] = useState<HTMLElement | null>(null)
  const portal = useCallback((element: HTMLDivElement | null) => setRoot(element?.closest<HTMLElement>('.open-flow-workbench') ?? null), [])
  const connections = useVal(connectors.$.connections)
  const providers = useVal(store.catalogs.providers.get(undefined, language)).data
  const connectionGroups = availableConnectionGroups(connections, providers, language, access)
  return (
    <section className="code-action-panel" aria-label={t('inspector.actions.title')} ref={portal}>
      <p className="code-action-description">{t('inspector.actions.connectorCapabilityDescription')}</p>
      <div className="code-action-entrypoints">
        <Dialog>
          <DialogTrigger disabled={disabled} render={<Button type="button" variant="ghost" size="xs" />}>
            {t('inspector.actions.availableConnections')}
          </DialogTrigger>
          <DialogContent container={root} className="sm:max-w-lg">
            <DialogTitle>{t('inspector.actions.availableConnectionsTitle')}</DialogTitle>
            <DialogDescription>
              {t(access?.mode == 'selectable' ? 'inspector.actions.availableConnectionsDescription' : 'inspector.actions.deploymentConnectionsDescription')}
            </DialogDescription>
            {connectionGroups.length == 0 ? (
              <p className="text-sm text-muted-foreground">{t('inspector.actions.noConnections')}</p>
            ) : (
              <div className="code-action-available-connections">
                {connectionGroups.map((group) => (
                  <section className="code-action-provider" key={group.serviceId}>
                    <h4>{group.name}</h4>
                    {group.connections.length == 0 ? (
                      <p className="text-xs text-muted-foreground">{t('inspector.actions.noConnections')}</p>
                    ) : (
                      group.connections.map((connection) => (
                        <div className="code-action-available-connection" key={connection.connectionId}>
                          <span>
                            {connection.displayName}
                            {connection.isDefault && <small>{t('inspector.actions.defaultConnection')}</small>}
                          </span>
                          <code>{connection.connectionId}</code>
                        </div>
                      ))
                    )}
                  </section>
                ))}
              </div>
            )}
          </DialogContent>
        </Dialog>
        <ActionPicker
          connectors={connectors}
          disabled={disabled}
          label={t('inspector.actions.addAction')}
          prepare={prepareAction}
          onSelect={(action) => store.saveCodeActions(nodeId, [hintedCapability(capabilities, action)])}
        />
      </div>
    </section>
  )
}
