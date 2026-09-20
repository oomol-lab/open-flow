import type { ReactElement } from 'react'
import type { ConnectorAccessCapability, ConnectorCapability } from '../../../../flow/common/change.ts'
import type { ConnectorAccess, ConnectorConnection, ConnectorProvider } from '../api.ts'
import type { ConnectorStore } from '../stores/connectorStore.ts'
import type { WorkspaceStore } from '../stores/workspaceStore.ts'
import type { ConnectorActionView } from '../workspace.ts'

import { useCallback, useState } from 'react'
import { useVal } from 'use-value-enhancer'
import { useLang, useTranslate } from 'val-i18n-react'
import { Button } from '../../../../ui/browser/button.tsx'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle, DialogTrigger } from '../../../../ui/browser/dialog.tsx'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../../ui/browser/select.tsx'
import { ActionPicker } from './actionPicker.tsx'

interface PreparedAction {
  readonly action: ConnectorActionView
  readonly connections: readonly ConnectorConnection[]
}

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

function callSource(context: string, actionId: string, connectionId?: string): string {
  const options = connectionId == null ? '' : `, { connectionId: ${JSON.stringify(connectionId)} }`
  return `await ${context}.actions.call(${JSON.stringify(actionId)}, {}${options})`
}

export function CodeActions({
  access,
  capabilities,
  connectors,
  disabled,
  nodeId,
  onInsert,
  prepareAction,
  store,
  context,
}: {
  readonly access?: ConnectorAccess
  readonly capabilities: readonly ConnectorCapability[]
  readonly connectors: ConnectorStore
  readonly disabled: boolean
  readonly nodeId: string
  readonly onInsert: (source: string) => void
  readonly prepareAction?: (action: ConnectorActionView) => Promise<PreparedAction | undefined>
  readonly store: WorkspaceStore
  readonly context: string
}): ReactElement {
  const t = useTranslate()
  const language = useLang()
  const [saving, setSaving] = useState(false)
  const [pending, setPending] = useState<PreparedAction>()
  const [connectionId, setConnectionId] = useState<string>()
  const [root, setRoot] = useState<HTMLElement | null>(null)
  const portal = useCallback((element: HTMLDivElement | null) => setRoot(element?.closest<HTMLElement>('.open-flow-workbench') ?? null), [])
  const connections = useVal(connectors.$.connections)
  const providers = useVal(store.catalogs.providers.get(undefined, language)).data
  const connectionGroups = availableConnectionGroups(connections, providers, language, access)
  const locked = disabled || saving
  const insert = async (action: ConnectorActionView, selectedConnectionId?: string): Promise<boolean> => {
    setSaving(true)
    try {
      if (!(await store.saveCodeActions(nodeId, [hintedCapability(capabilities, action, selectedConnectionId)]))) return false
      onInsert(callSource(context, action.actionId, selectedConnectionId))
      setPending(undefined)
      setConnectionId(undefined)
      return true
    } finally {
      setSaving(false)
    }
  }
  const refreshPending = async (): Promise<void> => {
    if (pending == null || prepareAction == null) return
    const prepared = await prepareAction(pending.action)
    if (prepared != null) setPending(prepared)
  }

  return (
    <section className="code-action-panel" aria-label={t('inspector.actions.title')} aria-busy={saving} ref={portal}>
      <p className="code-action-description">{t('inspector.actions.connectorCapabilityDescription')}</p>
      <div className="code-action-entrypoints">
        <ActionPicker
          connectors={connectors}
          disabled={locked}
          label={t('inspector.actions.addAction')}
          prepare={prepareAction}
          onSelect={async (action, actionConnections) => {
            if (!action.authenticated) return await insert(action)
            else {
              setPending({ action, connections: actionConnections })
              setConnectionId(action.defaultConnection?.connectionId)
            }
            return true
          }}
        />
        <Dialog>
          <DialogTrigger disabled={locked} render={<Button type="button" variant="ghost" size="xs" />}>
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
      </div>
      <Dialog open={pending != null} onOpenChange={(open) => !open && setPending(undefined)}>
        <DialogContent container={root} className="sm:max-w-md">
          <DialogTitle>{t('inspector.actions.chooseConnection', { provider: pending?.action.serviceName ?? '' })}</DialogTitle>
          <DialogDescription>{t('inspector.actions.connectionDescription')}</DialogDescription>
          {pending != null && pending.connections.length > 0 ? (
            <Select
              items={pending.connections.map((connection) => ({
                label: `${connection.displayName}${connection.isDefault ? ` · ${t('inspector.actions.defaultConnection')}` : ''}`,
                value: connection.connectionId,
              }))}
              value={connectionId ?? null}
              onValueChange={(value) => setConnectionId(typeof value == 'string' ? value : undefined)}
            >
              <SelectTrigger aria-label={t('inspector.actions.chooseConnection', { provider: pending.action.serviceName })} className="w-full">
                <SelectValue placeholder={t('inspector.account.chooseAccount')} />
              </SelectTrigger>
              <SelectContent>
                {pending.connections.map((connection) => (
                  <SelectItem key={connection.connectionId} value={connection.connectionId}>
                    {connection.displayName}
                    {connection.isDefault ? ` · ${t('inspector.actions.defaultConnection')}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">{t('inspector.actions.noConnections')}</p>
              <div className="flex gap-2">
                <Button onClick={() => pending != null && void connectors.connect(pending.action.serviceId)} size="sm" type="button" variant="secondary">
                  {t('inspector.account.addAccount')}
                </Button>
                <Button onClick={() => void refreshPending()} size="sm" type="button" variant="ghost">
                  {t('contextPanel.retry')}
                </Button>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setPending(undefined)} type="button" variant="ghost">
              {t('common.cancel')}
            </Button>
            <Button disabled={connectionId == null || saving} onClick={() => pending != null && void insert(pending.action, connectionId)} type="button">
              {t('inspector.actions.insertAction')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
