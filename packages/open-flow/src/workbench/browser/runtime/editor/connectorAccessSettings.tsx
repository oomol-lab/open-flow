import type { ReactElement, ReactNode } from 'react'
import type { ConnectorAccess, ConnectorAccessSnapshot, ConnectorConnection, ConnectorProvider } from '../../../../control/common/api.ts'
import type { ConnectionHref } from '../contract.ts'
import type { ConnectorAccountReference } from '../revisionView.ts'
import type { WorkbenchStore } from '../stores/workbenchStore.ts'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useVal } from 'use-value-enhancer'
import { useLang, useTranslate } from 'val-i18n-react'
import { CanvasTooltip } from '../../../../canvas/browser/components/tooltip.tsx'
import { codeSharedPermissionsEnabled } from '../../../../flow/common/codePermissions.ts'
import { Button, buttonVariants } from '../../../../ui/browser/button.tsx'
import { Checkbox } from '../../../../ui/browser/checkbox.tsx'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../../../ui/browser/dialog.tsx'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../../../../ui/browser/dropdown-menu.tsx'
import { ContentIcon } from '../../../../ui/browser/icons/ContentIcon.tsx'
import { Label } from '../../../../ui/browser/label.tsx'
import { Popover, PopoverPanelContent, PopoverTrigger } from '../../../../ui/browser/popover.tsx'
import { NativeScrollArea, ScrollArea } from '../../../../ui/browser/scroll-area.tsx'
import { cn } from '../../../../ui/browser/utils.ts'
import { providerIcon } from '../providerIcon.ts'
import { semanticNodeIcon, triggerNodeIcon } from '../workspace.ts'
import { AccountName, accountDisplayName } from './accountName.tsx'
import { connectorAccessPermissionGroupLabel, connectorAccessPermissionLabel } from './connectorAccessPresentation.ts'
import { ServicePicker } from './servicePicker.tsx'

function connectorAccessProviderIds(access: ConnectorAccess | undefined, requestedProviderId?: string): readonly string[] {
  const ids = new Set(access?.bindings.map((binding) => binding.providerId))
  for (const providerId of access?.providerIds ?? []) ids.add(providerId)
  if (requestedProviderId != null) ids.add(requestedProviderId)
  return [...ids].toSorted()
}

function pendingConnectionUses(
  uses: readonly ConnectorAccountReference[],
  providers: readonly ConnectorProvider[] | undefined,
): readonly ConnectorAccountReference[] {
  if (providers == null) return []
  return uses.filter((use) => use.connectionId == null && !providers.some((provider) => provider.serviceId == use.providerId && provider.noSetup))
}

function hasConnectionUsageIssue(
  uses: readonly ConnectorAccountReference[],
  access: ConnectorAccess | ConnectorAccessSnapshot | undefined,
  providers: readonly ConnectorProvider[] | undefined,
  connections: readonly ConnectorConnection[] | undefined,
): boolean {
  if (pendingConnectionUses(uses, providers).length > 0) return true
  if (access?.version == 1 && access.bindings.some((binding) => binding.connectionId == null || binding.status != 'active')) return true
  if (connections == null) return false

  const connectionIds = new Set(uses.flatMap((use) => (use.connectionId == null ? [] : [use.connectionId])))
  for (const binding of access == null ? [] : access.version == 2 ? access.sharedBindings : access.bindings) {
    if (binding.connectionId != null) connectionIds.add(binding.connectionId)
  }
  return [...connectionIds].some((id) => connections.find((connection) => connection.connectionId == id)?.status != 'active')
}

export function ConnectionUsageButton(props: Parameters<typeof ConnectorAccessSettings>[0]): ReactElement {
  const t = useTranslate()
  const language = useLang()
  const flowId = useVal(props.store.workspace.$.flowId)
  const revision = useVal(props.store.workspace.$.revision)
  const access = useVal(props.store.connectorAccess.$).access
  const providers = useVal(props.store.workspace.catalogs.providers.get(undefined, language)).data
  const connections = useVal(props.store.workspace.catalogs.connections.get(undefined, flowId)).data
  const hasIssue = flowId != null && hasConnectionUsageIssue(revision?.connectorReferences.accounts ?? [], access, providers, connections)
  const label = t(hasIssue ? 'connectionUsage.needsAttention' : 'connectionUsage.title')
  const [open, setOpen] = useState(false)
  const [container, setContainer] = useState<HTMLElement | null>(null)
  const portal = useCallback((element: HTMLButtonElement | null) => {
    setContainer(element?.closest<HTMLElement>('.open-flow-workbench') ?? null)
  }, [])
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <CanvasTooltip placement="bottom" title={label}>
        <PopoverTrigger ref={portal} render={<Button size="icon" variant="ghost" aria-label={label} />}>
          <i aria-hidden="true" className="i-lucide-light:plug" data-corner-icon style={hasIssue ? { color: 'var(--warning-foreground)' } : undefined} />
        </PopoverTrigger>
      </CanvasTooltip>
      <PopoverPanelContent
        container={container}
        side="bottom"
        align="end"
        sideOffset={8}
        title={<span className="text-[14px]">{t('connectionUsage.title')}</span>}
        closeLabel={t('connectionUsage.close')}
        className="w-96"
      >
        <ConnectorAccessSettings
          {...props}
          onSelectReference={
            props.onSelectReference == null
              ? undefined
              : (reference) => {
                  setOpen(false)
                  props.onSelectReference?.(reference)
                }
          }
        />
      </PopoverPanelContent>
    </Popover>
  )
}

export function ConnectorAccessSettings({
  connectionHref,
  onManage,
  onSelectReference,
  store,
}: {
  readonly connectionHref?: ConnectionHref | undefined
  readonly onManage?: ((flowId: string) => void) | undefined
  readonly onSelectReference?: ((reference: ConnectorAccountReference) => void) | undefined
  readonly store: WorkbenchStore
}): ReactElement | null {
  const t = useTranslate()
  const language = useLang()
  const providers = useVal(store.workspace.catalogs.providers.get(undefined, language))
  const flowId = useVal(store.workspace.$.flowId)
  const revision = useVal(store.workspace.$.revision)
  const state = useVal(store.connectorAccess.$)
  const live = useVal(store.workspace.$.live)
  const [publishedFlow, setPublishedFlow] = useState<string>()
  const published = publishedFlow == flowId && live?.publication != null
  const [snapshot, setSnapshot] = useState<Awaited<ReturnType<WorkbenchStore['publishedConnectionUsage']>>>()
  const [snapshotError, setSnapshotError] = useState(false)
  const [snapshotAttempt, setSnapshotAttempt] = useState(0)
  const publication = live?.publication
  useEffect(() => {
    setRemoving(undefined)
    setSnapshot(undefined)
    setSnapshotError(false)
    if (!published || flowId == null || publication == null) return
    const controller = new AbortController()
    void store.publishedConnectionUsage(flowId, publication.publicationId, publication.revisionId, controller.signal).then(
      (next) => {
        if (!controller.signal.aborted) setSnapshot(next)
      },
      () => {
        if (!controller.signal.aborted) setSnapshotError(true)
      },
    )
    return () => controller.abort()
  }, [published, flowId, publication?.publicationId, store, snapshotAttempt])
  const fixedSnapshot = snapshot?.publicationId == publication?.publicationId ? snapshot : undefined
  const connectionState = useVal(store.workspace.catalogs.connections.get(undefined, flowId))
  const connections = connectionState.data ?? []
  const builtInName = t('inspector.account.oomolBuiltIn')
  const actions = useVal(store.connectors.$.actions)
  const panel = useRef<HTMLElement | null>(null)
  const [root, setRoot] = useState<HTMLElement | null>(null)
  const [removing, setRemoving] = useState<string>()
  const [pending, setPending] = useState(false)
  const portal = useCallback((element: HTMLElement | null) => {
    panel.current = element
    setRoot(element?.closest<HTMLElement>('.open-flow-workbench') ?? element?.closest<HTMLElement>('.open-flow-theme') ?? null)
  }, [])
  if (flowId == null) return null
  const displayed = published ? fixedSnapshot?.revision : revision
  const selectedAccess = published ? fixedSnapshot?.access : state.access
  const uses = displayed?.connectorReferences.accounts ?? []
  const accounts = new Map<string, { name: string; providerId: string; code: boolean; nodes: readonly ConnectorAccountReference[] }>()
  for (const use of uses) {
    if (use.connectionId == null || accounts.has(use.connectionId)) continue
    const connection = connections.find((item) => item.connectionId == use.connectionId)
    accounts.set(use.connectionId, {
      name:
        (published ? fixedSnapshot?.access.selectedBindings.find((binding) => binding.connectionId == use.connectionId)?.connectionDisplayName : undefined) ??
        connection?.displayName ??
        use.connectionId,
      providerId: use.providerId,
      code: false,
      nodes: uses.filter((item) => item.connectionId == use.connectionId),
    })
  }
  for (const binding of selectedAccess == null ? [] : selectedAccess.version == 2 ? selectedAccess.sharedBindings : selectedAccess.bindings) {
    if (binding.connectionId == null) continue
    const account = accounts.get(binding.connectionId)
    accounts.set(binding.connectionId, { name: binding.connectionDisplayName, providerId: binding.providerId, code: true, nodes: account?.nodes ?? [] })
  }
  const pendingUses = pendingConnectionUses(uses, providers.data)
  const providerMetadata = Object.fromEntries((providers.data ?? []).map((provider) => [provider.serviceId, provider]))
  const referenceIcon = (reference: ConnectorAccountReference): string | undefined => {
    const node = displayed?.node(reference.target, reference.nodeId)
    if (node == null) return
    return node.kind == 'trigger' ? triggerNodeIcon(node.trigger, providerMetadata) : semanticNodeIcon(node, actions)
  }
  const affected = removing == null ? undefined : accounts.get(removing)
  return (
    <section className="flex min-h-0 flex-col gap-3 outline-none" tabIndex={-1} ref={portal}>
      {publication != null && (
        <div className="flex gap-1" role="group" aria-label={t('connectionUsage.version')}>
          <Button size="xs" aria-pressed={!published} variant={published ? 'ghost' : 'secondary'} onClick={() => setPublishedFlow(undefined)}>
            {t('connectionUsage.draft')}
          </Button>
          <Button size="xs" aria-pressed={published} variant={published ? 'secondary' : 'ghost'} onClick={() => setPublishedFlow(flowId)}>
            {t('connectionUsage.published')}
          </Button>
        </div>
      )}
      <p className="m-0 text-xs text-muted-foreground">{t(published ? 'connectionUsage.publishedDescription' : 'connectionUsage.description')}</p>
      {(published && snapshotError) || (!published && !state.loading && state.access == null) ? (
        <p role="alert">
          {t('connectionUsage.loadFailed')}{' '}
          <Button size="xs" variant="link" onClick={() => (published ? setSnapshotAttempt((value) => value + 1) : void store.connectorAccess.load(flowId))}>
            {t('connectorAccess.retry')}
          </Button>
        </p>
      ) : (!published && (state.loading || revision == null)) || (published && fixedSnapshot == null) ? (
        <p className="text-xs">{t('connectionUsage.loading')}</p>
      ) : accounts.size == 0 && pendingUses.length == 0 ? (
        <p className="text-xs text-muted-foreground">{t(published ? 'connectionUsage.publishedEmpty' : 'connectionUsage.empty')}</p>
      ) : (
        <div className="flex flex-col gap-4">
          {pendingUses.length > 0 && (
            <div className="rounded-md bg-[var(--warning-subtle-surface)] p-2 [--ui-control-hover-background:var(--warning-subtle-hover)]">
              <AccountReferences
                icon={referenceIcon}
                references={pendingUses}
                label={t('connectionUsage.needsConnection')}
                labelClassName="text-[var(--warning-foreground)]"
                onSelect={published ? undefined : onSelectReference}
              />
            </div>
          )}
          <div className="flex flex-col gap-4">
            {[...new Set([...accounts.values()].map((account) => account.providerId))].map((providerId) => {
              const provider = providers.data?.find((item) => item.serviceId == providerId) ?? { serviceId: providerId, serviceName: providerId }
              const providerAccounts = [...accounts].filter(([, account]) => account.providerId == providerId)
              return (
                <section key={providerId} aria-label={provider.serviceName} className="text-xs">
                  <div className="flex min-w-0 items-center gap-2 font-medium">
                    <ConnectionConsoleLink href={connectionHref?.(flowId, providerId)}>
                      <ContentIcon src={providerIcon(provider)} className="size-4 shrink-0 data-[icon-kind=initials]:text-[20px]" />
                      <span className="min-w-0 wrap-anywhere">{provider.serviceName}</span>
                    </ConnectionConsoleLink>
                    <span className="ml-auto shrink-0 text-xs font-normal text-muted-foreground">{providerAccounts.length}</span>
                  </div>
                  <div className="mt-2 flex flex-col gap-2">
                    {providerAccounts.map(([id, account]) => {
                      const connection = connections.find((item) => item.connectionId == id)
                      return (
                        <div key={id} className="flex flex-col gap-1.5 rounded-md border border-border/50 p-2.5">
                          <div className="flex items-center justify-between gap-2">
                            <ConnectionConsoleLink href={connectionHref?.(flowId, providerId, id)}>
                              <i aria-hidden="true" className="i-codicon:credit-card size-3.5 shrink-0 text-sm text-muted-foreground" />
                              <AccountName name={accountDisplayName(connection, account.name, builtInName)} builtIn={connection?.builtInAccount} />
                            </ConnectionConsoleLink>
                            {!published && (
                              <DropdownMenu>
                                <DropdownMenuTrigger
                                  render={
                                    <Button
                                      size="icon-xs"
                                      variant="ghost"
                                      className="shrink-0 text-muted-foreground"
                                      aria-label={t('connectionUsage.accountActions', { account: accountDisplayName(connection, account.name, builtInName) })}
                                    />
                                  }
                                >
                                  <i aria-hidden="true" className="i-lucide-light:ellipsis size-4" />
                                </DropdownMenuTrigger>
                                <DropdownMenuContent container={root} align="end">
                                  <DropdownMenuItem variant="destructive" onClick={() => setRemoving(id)}>
                                    {t('connectionUsage.stopUsing')}
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            )}
                          </div>
                          {connectionState.data != null && connection?.status != 'active' && (
                            <p className="text-xs text-destructive">
                              {t(connection == null ? 'inspector.account.unavailable' : `inspector.account.status.${connection.status}`)}
                            </p>
                          )}
                          <AccountReferences
                            hierarchy
                            icon={referenceIcon}
                            references={account.nodes}
                            code={account.code}
                            label={t('connectionUsage.usedBy')}
                            onSelect={published ? undefined : onSelectReference}
                          />
                        </div>
                      )
                    })}
                  </div>
                </section>
              )
            })}
          </div>
        </div>
      )}
      {accounts.size > 0 && (connectionState.error != null || connectionState.data == null) && (
        <p className="text-xs text-muted-foreground" role="status">
          {t(connectionState.error != null ? 'connectorAccess.accountsFailed' : 'inspector.account.loading')}
          {connectionState.error != null && (
            <Button size="xs" variant="link" onClick={() => store.workspace.catalogs.connections.get(undefined, flowId, true)}>
              {t('connectorAccess.retry')}
            </Button>
          )}
        </p>
      )}
      {selectedAccess?.version == 1 && selectedAccess.bindings.some((binding) => binding.connectionId == null || binding.status != 'active') && (
        <div role="status" className="text-xs text-destructive">
          {t('connectorAccess.summaryIssues', {
            count: selectedAccess.bindings.filter((binding) => binding.connectionId == null || binding.status != 'active').length,
          })}
        </div>
      )}
      {codeSharedPermissionsEnabled && !published && state.access?.mode == 'selectable' && (
        <Button size="xs" variant="ghost" className="self-start" onClick={() => store.connectorAccess.configure()}>
          {t('connectionUsage.configureCode')}
        </Button>
      )}
      <Dialog
        open={codeSharedPermissionsEnabled && state.configuration != null}
        onOpenChange={(open) => {
          if (!open) store.connectorAccess.closeConfiguration()
        }}
      >
        <DialogContent container={root} closeLabel={t('contextPanel.close')} className="flex max-h-[80dvh] flex-col overflow-auto sm:max-w-xl">
          <DialogTitle className="sr-only">{t('connectorAccess.title')}</DialogTitle>
          <CodeConnectionSettings store={store} onManage={onManage} />
        </DialogContent>
      </Dialog>
      <Dialog
        open={removing != null}
        onOpenChange={(open) => {
          if (!open && !pending) setRemoving(undefined)
        }}
      >
        <DialogContent container={root} finalFocus={panel} className="flex max-h-[80dvh] flex-col" closeLabel={t('connectionUsage.cancel')}>
          <div className="flex flex-col gap-2">
            <DialogTitle className="pr-6 text-[14px] leading-5">{t('connectionUsage.stopUsingTitle')}</DialogTitle>
            <DialogDescription className="m-0 text-xs leading-5">{t('connectionUsage.stopUsingDescription')}</DialogDescription>
          </div>
          {affected != null && (
            <ScrollArea className="min-h-0 h-auto" defer={false}>
              <div className="flex flex-col gap-1.5 rounded-md border border-border/50 p-2.5">
                <div className="flex min-w-0 items-center gap-2 text-[13px] font-medium">
                  <i aria-hidden="true" className="i-codicon:credit-card size-3.5 shrink-0 text-sm text-muted-foreground" />
                  <AccountName
                    name={accountDisplayName(
                      connections.find((connection) => connection.connectionId == removing),
                      affected.name,
                      builtInName,
                    )}
                    builtIn={connections.some((connection) => connection.connectionId == removing && connection.builtInAccount)}
                  />
                </div>
                <AccountReferences hierarchy icon={referenceIcon} references={affected.nodes} label={t('connectionUsage.usedBy')} />
              </div>
            </ScrollArea>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" disabled={pending} onClick={() => setRemoving(undefined)}>
              {t('connectionUsage.cancel')}
            </Button>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={async () => {
                if (removing == null) return
                setPending(true)
                try {
                  if (await store.removeConnectionUsage(removing)) setRemoving(undefined)
                } finally {
                  setPending(false)
                }
              }}
            >
              {t('connectionUsage.stopUsing')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  )
}

export function CodeConnectionSettings({
  onManage,
  store,
}: {
  readonly onManage?: ((flowId: string) => void) | undefined
  readonly store: WorkbenchStore
}): ReactElement | null {
  const t = useTranslate()
  const titleId = useId()
  const [menuContainer, setMenuContainer] = useState<HTMLElement | null>(null)
  const language = useLang()
  const flowId = useVal(store.workspace.$.flowId)
  const state = useVal(store.connectorAccess.$)
  const providers = useVal(store.workspace.catalogs.providers.get(undefined, language))
  const connections = useVal(store.workspace.catalogs.connections.get(undefined, flowId)).data ?? []
  const builtInName = t('inspector.account.oomolBuiltIn')
  const access = state.access
  const providerMetadata = new Map(providers.data?.map((provider) => [provider.serviceId, provider]))
  const providerIds = connectorAccessProviderIds(access, state.configuration?.providerId)
  const providerRows = providerIds.map((serviceId) => ({
    serviceId,
    serviceName: providerMetadata.get(serviceId)?.serviceName ?? serviceId,
    noSetup: providerMetadata.get(serviceId)?.noSetup === true,
    icon: providerIcon(providerMetadata.get(serviceId) ?? { serviceId, serviceName: serviceId }),
  }))
  const availableProviders = (providers.data ?? [])
    .filter((provider) => !provider.noSetup && !providerIds.includes(provider.serviceId))
    .toSorted((left, right) => left.serviceName.localeCompare(right.serviceName, language))
  const requiresAuthorization = providerRows.some((provider) => !provider.noSetup)
  const providersPending = providers.data == null
  const providerKey = providerRows
    .filter((provider) => !provider.noSetup)
    .map((provider) => provider.serviceId)
    .join('\0')
  useEffect(() => {
    if (flowId == null || access?.mode != 'selectable' || providersPending) return
    void store.connectorAccess.loadCandidates(providerKey.split('\0').filter(Boolean))
  }, [access?.mode, flowId, providerKey, providersPending, state.candidates, store])
  if (flowId == null) return null

  const requiredBindings = access?.mode == 'selectable' ? access.bindings.filter((binding) => !providerMetadata.get(binding.providerId)?.noSetup) : []
  const activeBindings = requiredBindings.filter((binding) => binding.status == 'active')
  const activeProviderCount = new Set(activeBindings.map((binding) => binding.providerId)).size
  const issueCount = requiredBindings.length - activeBindings.length

  const addService =
    access?.mode == 'selectable' && availableProviders.length > 0 ? (
      <ServicePicker connectors={store.connectors} exclude={providerIds} onSelect={(providerId) => store.connectorAccess.setService(providerId, true)} />
    ) : null

  return (
    <section tabIndex={-1} ref={setMenuContainer} className="flex min-h-0 shrink-0 flex-col gap-2" aria-labelledby={titleId}>
      {(access?.discardedBindingCount ?? 0) > 0 && (
        <p role="status" className="text-xs text-destructive">
          {t('connectorAccess.discardedBindings')}
        </p>
      )}
      <h3 className="m-0 text-xs font-medium" id={titleId}>
        {t('connectorAccess.title')}
      </h3>
      {!state.loading && !providersPending && access?.mode == 'selectable' && providerRows.length > 0 && (
        <p className="m-0 text-[11px] leading-4 text-muted-foreground">
          {!requiresAuthorization
            ? t('connectorAccess.summaryNoAuthorization')
            : activeBindings.length == 0
              ? t('connectorAccess.summaryEmpty')
              : t('connectorAccess.summary', { connections: activeBindings.length, providers: activeProviderCount })}
        </p>
      )}
      {onManage != null && requiresAuthorization && (
        <Button className="mt-1 -ml-2 self-start" onClick={() => onManage(flowId)} size="xs" type="button" variant="ghost">
          {t('connectorAccess.manage')}
        </Button>
      )}
      {state.loading ? (
        <p className="mt-1 text-xs text-muted-foreground">{t('connectorAccess.loading')}</p>
      ) : access == null ? (
        <p className="mt-1 text-xs text-destructive">
          {t('connectorAccess.loadFailed')}{' '}
          <Button className="h-auto p-0 underline" onClick={() => void store.connectorAccess.load(flowId)} size="xs" type="button" variant="link">
            {t('connectorAccess.retry')}
          </Button>
        </p>
      ) : access.mode == 'implicit' ? (
        <p className="mt-1 text-xs text-muted-foreground">{t('connectorAccess.deploymentManaged')}</p>
      ) : providersPending ? (
        <p className="mt-1 text-xs text-muted-foreground">{t(providers.error == null ? 'connectorAccess.loading' : 'connectorAccess.providersFailed')}</p>
      ) : (
        <div className="flex min-h-0 flex-col gap-2">
          {providerRows.length == 0 ? (
            <>
              <p className="text-xs text-muted-foreground">{t('connectorAccess.empty')}</p>
              {addService}
            </>
          ) : (
            <>
              {issueCount > 0 && <p className="shrink-0 text-xs text-destructive">{t('connectorAccess.summaryIssues', { count: issueCount })}</p>}
              <NativeScrollArea aria-labelledby={titleId} className="h-auto max-h-[min(60dvh,480px)] min-h-0" tabIndex={0}>
                <div className="flex flex-col gap-3 pb-1">
                  {requiresAuthorization && <p className="m-0 text-[11px] leading-4 text-muted-foreground">{t('connectorAccess.description')}</p>}
                  <div className="flex flex-col gap-2">
                    {providerRows.map((provider) => {
                      if (provider.noSetup) {
                        return (
                          <div
                            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/60 bg-background/40 p-2"
                            key={provider.serviceId}
                          >
                            <span className="flex min-w-0 items-center gap-2 text-xs font-medium">
                              <ContentIcon src={provider.icon} className="size-4 shrink-0 data-[icon-kind=initials]:text-[20px]" />
                              <span>{provider.serviceName}</span>
                            </span>
                            <span className="text-xs text-muted-foreground">{t('connectorAccess.noAuthorization')}</span>
                          </div>
                        )
                      }
                      const bindings = access.bindings.filter((item) => item.providerId == provider.serviceId)
                      const candidates = state.candidates[provider.serviceId]?.candidates
                      const loading = state.loadingCandidates.includes(provider.serviceId)
                      const saving = state.savingProviderId == provider.serviceId
                      const options = [
                        ...(candidates ?? []),
                        ...bindings.filter((binding) => !candidates?.some((candidate) => candidate.accessBindingId == binding.accessBindingId)),
                      ].toSorted(
                        (left, right) =>
                          left.connectionDisplayName.localeCompare(right.connectionDisplayName) ||
                          (left.permissionGroupName ?? '').localeCompare(right.permissionGroupName ?? '') ||
                          left.accessBindingId.localeCompare(right.accessBindingId),
                      )
                      return (
                        <div
                          aria-label={provider.serviceName}
                          className="flex flex-col gap-1 rounded-lg border border-border/60 bg-background/40 p-2 outline-none"
                          key={provider.serviceId}
                          tabIndex={-1}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="flex min-w-0 items-center gap-2 text-xs font-medium">
                              <ContentIcon src={provider.icon} className="size-4 shrink-0 data-[icon-kind=initials]:text-[20px]" />
                              <span>{provider.serviceName}</span>
                            </span>
                            <div className="ml-auto flex items-center gap-2">
                              {saving && (
                                <span role="status" className="text-[11px] text-muted-foreground">
                                  {t('connectorAccess.saving')}
                                </span>
                              )}
                              {!saving && bindings.length == 0 && (candidates?.length ?? 0) > 0 && !loading && (
                                <span className="text-[11px] text-muted-foreground">{t('connectorAccess.noAccountSelected')}</span>
                              )}
                              <DropdownMenu>
                                <DropdownMenuTrigger
                                  render={
                                    <Button
                                      aria-label={t('connectorAccess.manageServiceAccounts', { service: provider.serviceName })}
                                      className="text-muted-foreground"
                                      size="icon-xs"
                                      type="button"
                                      variant="ghost"
                                    />
                                  }
                                >
                                  <i aria-hidden="true" className="i-lucide-light:ellipsis size-4" />
                                </DropdownMenuTrigger>
                                <DropdownMenuContent container={menuContainer} align="end">
                                  <DropdownMenuItem onClick={() => void store.connectors.connect(provider.serviceId)}>
                                    {t('inspector.account.addAccount')}
                                  </DropdownMenuItem>
                                  {(bindings.length > 0 || (access.providerIds?.includes(provider.serviceId) ?? false)) && (
                                    <DropdownMenuItem
                                      disabled={state.savingProviderId != null}
                                      variant="destructive"
                                      onClick={() => void store.connectorAccess.setService(provider.serviceId, false)}
                                    >
                                      {t('connectorAccess.removeService')}
                                    </DropdownMenuItem>
                                  )}
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                          </div>
                          {options.map((option) => {
                            const optionConnection = connections.find((connection) => connection.connectionId == option.connectionId)
                            const binding = bindings.find((item) => item.accessBindingId == option.accessBindingId)
                            const pending =
                              state.pendingSelection?.providerId == provider.serviceId && state.pendingSelection.accessBindingId == option.accessBindingId
                                ? state.pendingSelection
                                : undefined
                            const groupLabel = connectorAccessPermissionGroupLabel(option, t)
                            const permissionLabel = connectorAccessPermissionLabel(option, t)
                            return (
                              <div key={option.accessBindingId}>
                                <Label className="min-w-0 items-start py-1 text-xs font-normal">
                                  <Checkbox
                                    checked={pending?.selected ?? binding != null}
                                    aria-busy={pending != null || undefined}
                                    className="mt-px"
                                    disabled={state.savingProviderId != null}
                                    onCheckedChange={(checked) =>
                                      void store.connectorAccess.select(provider.serviceId, option.accessBindingId, checked === true)
                                    }
                                  />
                                  <span className="min-w-0 flex-1 leading-4">
                                    <span className="block wrap-anywhere">
                                      <AccountName
                                        name={accountDisplayName(optionConnection, option.connectionDisplayName, builtInName)}
                                        builtIn={optionConnection?.builtInAccount}
                                      />
                                    </span>
                                    <span className="block text-[11px] text-muted-foreground wrap-anywhere">
                                      {permissionLabel == null ? groupLabel : `${groupLabel} · ${permissionLabel}`}
                                    </span>
                                  </span>
                                  {binding != null && binding.status != 'active' && (
                                    <span className="shrink-0 leading-4 text-destructive">{t('connectorAccess.status', { status: binding.status })}</span>
                                  )}
                                </Label>
                              </div>
                            )
                          })}
                          {loading && <p className="text-xs text-muted-foreground">{t('connectorAccess.loadingCandidates')}</p>}
                          {candidates?.length == 0 && !loading && !state.candidateErrors.includes(provider.serviceId) && (
                            <ConnectorAccessEmptyState store={store} serviceId={provider.serviceId} />
                          )}
                          {state.candidateErrors.includes(provider.serviceId) && (
                            <p className="text-xs text-destructive">
                              {t('connectorAccess.candidatesFailed')}{' '}
                              <Button
                                className="h-auto p-0 underline"
                                onClick={() => void store.connectorAccess.loadCandidates([provider.serviceId], true)}
                                size="xs"
                                type="button"
                                variant="link"
                              >
                                {t('connectorAccess.retry')}
                              </Button>
                            </p>
                          )}
                        </div>
                      )
                    })}
                  </div>
                  {addService}
                  {providers.error != null && <p className="text-xs text-destructive">{t('connectorAccess.providersFailed')}</p>}
                </div>
              </NativeScrollArea>
            </>
          )}
        </div>
      )}
    </section>
  )
}

export function ConnectorAccessEmptyState({ store, serviceId }: { readonly store: WorkbenchStore; readonly serviceId: string }): ReactElement {
  const t = useTranslate()
  const connections = useVal(store.workspace.catalogs.connections.get(serviceId))
  if (connections.error != null) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-destructive">{t('connectorAccess.accountsFailed')}</span>
        <Button onClick={() => store.workspace.catalogs.connections.get(serviceId, undefined, true)} size="xs" variant="secondary">
          {t('connectorAccess.retry')}
        </Button>
      </div>
    )
  }
  if (connections.data == null) return <p className="text-xs text-muted-foreground">{t('connectorAccess.loading')}</p>
  const hasAccounts = connections.data.length > 0
  const hasActiveAccounts = connections.data.some((connection) => connection.status == 'active')
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="m-0 min-w-0 flex-1 basis-48 text-[11px] leading-4 text-muted-foreground" role="status">
        {t(hasActiveAccounts ? 'connectorAccess.noAvailablePermissions' : hasAccounts ? 'connectorAccess.reconnectAccount' : 'connectorAccess.noAccount')}
      </p>
      <Button onClick={() => void store.connectors.connect(serviceId)} size="xs" type="button" variant="secondary">
        {t(hasActiveAccounts ? 'inspector.account.manageAccount' : hasAccounts ? 'connectorAccess.reconnect' : 'connectorAccess.connect')}
      </Button>
    </div>
  )
}

function AccountReferences({
  hierarchy = false,
  icon,
  code = false,
  references,
  label,
  labelClassName,
  onSelect,
}: {
  readonly hierarchy?: boolean
  readonly icon: (reference: ConnectorAccountReference) => string | undefined
  readonly code?: boolean
  readonly references: readonly ConnectorAccountReference[]
  readonly label: string
  readonly labelClassName?: string
  readonly onSelect?: ((reference: ConnectorAccountReference) => void) | undefined
}): ReactElement | null {
  const t = useTranslate()
  if (references.length == 0 && !code) return null
  return (
    <div className="flex min-w-0 flex-col gap-1">
      {(!hierarchy || references.length == 0) && (
        <span className={cn('text-xs text-muted-foreground', labelClassName)}>{references.length > 0 ? label : t('connectionUsage.codeAccess')}</span>
      )}
      {references.length > 0 && (
        <ul
          className="m-0 flex list-none flex-col gap-1 p-0 [--branch-radius:4px] [--branch-color:color-mix(in_srgb,var(--ui-muted-foreground)_20%,var(--ui-popover))]"
          aria-label={label}
        >
          {references.map((reference, index) => {
            const content = (
              <>
                <ContentIcon src={icon(reference)} className="size-4 shrink-0 data-[icon-kind=initials]:text-[20px]" />
                <span className="min-w-0 flex-1 wrap-anywhere">{reference.name}</span>
                {reference.kind != null && <span className="shrink-0 text-xs text-muted-foreground">{t(`connectionUsage.${reference.kind}`)}</span>}
              </>
            )
            return (
              <li key={JSON.stringify([reference.target, reference.nodeId, reference.kind])} className={hierarchy ? 'relative min-w-0 pl-4' : 'min-w-0'}>
                {hierarchy && (
                  <>
                    <span
                      aria-hidden="true"
                      className={cn(
                        'pointer-events-none absolute left-1.5 border-l border-[var(--branch-color)]',
                        index == 0 ? '-top-1.5' : '-top-1',
                        index == references.length - 1 ? 'bottom-[calc(50%+var(--branch-radius))]' : 'bottom-0',
                      )}
                    />
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute bottom-1/2 left-1.5 h-[var(--branch-radius)] w-2.5 rounded-bl-[var(--branch-radius)] border-b border-l border-[var(--branch-color)]"
                    />
                  </>
                )}
                {onSelect == null ? (
                  <div className="flex min-h-7 items-center gap-2 px-2 py-1 text-[13px]">{content}</div>
                ) : (
                  <Button
                    className="h-auto min-h-7 w-full justify-start gap-2 px-2 py-1 text-left text-[13px] font-normal whitespace-normal"
                    variant="ghost"
                    size="xs"
                    type="button"
                    onClick={() => onSelect(reference)}
                  >
                    {content}
                    <i aria-hidden="true" className="i-lucide-light:arrow-up-right size-3 shrink-0 text-muted-foreground" />
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {code && <p className="m-0 px-2 py-1 text-xs text-muted-foreground">{t('connectionUsage.codeAllowed')}</p>}
    </div>
  )
}

function ConnectionConsoleLink({ href, children }: { readonly href?: string; readonly children: ReactNode }) {
  const className = cn(
    buttonVariants({ variant: 'ghost', size: 'xs' }),
    '-my-1 -ml-2 min-w-0 h-auto min-h-6 shrink justify-start gap-2 py-1 text-left text-[13px] text-foreground whitespace-normal',
  )
  return href == null ? (
    <span className={cn(className, 'pointer-events-none')}>{children}</span>
  ) : (
    <a className={className} href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  )
}
