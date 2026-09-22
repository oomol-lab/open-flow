import type { ReactElement } from 'react'
import type { ConnectorAccess } from '../../../../control/common/api.ts'
import type { RevisionView } from '../revisionView.ts'
import type { ConnectorAccountReference } from '../revisionView.ts'
import type { WorkbenchStore } from '../stores/workbenchStore.ts'

import { useEffect, useId, useRef, useState } from 'react'
import { useVal } from 'use-value-enhancer'
import { useLang, useTranslate } from 'val-i18n-react'
import { Button } from '../../../../ui/browser/button.tsx'
import { Checkbox } from '../../../../ui/browser/checkbox.tsx'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../../../../ui/browser/dropdown-menu.tsx'
import { ContentIcon } from '../../../../ui/browser/icons/ContentIcon.tsx'
import { Label } from '../../../../ui/browser/label.tsx'
import { NativeScrollArea } from '../../../../ui/browser/scroll-area.tsx'
import { providerIcon } from '../providerIcon.ts'
import { connectorAccessPermissionGroupLabel, connectorAccessPermissionLabel } from './connectorAccessPresentation.ts'
import { ServicePicker } from './servicePicker.tsx'

function connectorAccessProviderIds(revision: RevisionView | undefined, access: ConnectorAccess | undefined, requestedProviderId?: string): readonly string[] {
  const ids = new Set(access?.bindings.map((binding) => binding.providerId))
  for (const providerId of access?.providerIds ?? []) ids.add(providerId)
  if (requestedProviderId != null) ids.add(requestedProviderId)
  for (const providerId of revision?.connectorProviderIds ?? []) ids.add(providerId)
  return [...ids].toSorted()
}

export function ConnectorAccessSettings({
  onManage,
  onSelectReference,
  store,
}: {
  readonly onManage?: ((flowId: string) => void) | undefined
  readonly store: WorkbenchStore
  readonly onSelectReference?: ((reference: ConnectorAccountReference) => void) | undefined
}): ReactElement | null {
  const t = useTranslate()
  const titleId = useId()
  const [menuContainer, setMenuContainer] = useState<HTMLElement | null>(null)
  const contentId = useId()
  const language = useLang()
  const configurationTarget = useRef<HTMLDivElement>(null)
  const flowId = useVal(store.workspace.$.flowId)
  const revision = useVal(store.workspace.$.revision)
  const references = revision?.connectorReferences ?? { accounts: [], hasCode: false }
  const state = useVal(store.connectorAccess.$)
  const [expandedFlowId, setExpandedFlowId] = useState<string>()
  const providers = useVal(store.workspace.catalogs.providers.get(undefined, language))
  const access = state.access
  const expanded = flowId != null && expandedFlowId == flowId
  const providerMetadata = new Map(providers.data?.map((provider) => [provider.serviceId, provider]))
  const providerIds = connectorAccessProviderIds(revision, access, state.configuration?.providerId)
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
  useEffect(() => {
    if (state.configuration != null) setExpandedFlowId(flowId)
  }, [flowId, state.configuration])
  const providerKey = providerRows
    .filter((provider) => !provider.noSetup)
    .map((provider) => provider.serviceId)
    .join('\0')
  useEffect(() => {
    if (!expanded || flowId == null || access?.mode != 'selectable' || providersPending) return
    for (const providerId of providerKey.split('\0').filter(Boolean)) {
      if (state.candidates[providerId] == null) void store.connectorAccess.loadCandidates(providerId)
    }
  }, [access?.mode, expanded, flowId, providerKey, providersPending, state.candidates, store])
  useEffect(() => {
    if (!expanded || providersPending || state.configuration == null) return
    const target = configurationTarget.current ?? menuContainer
    target?.focus({ preventScroll: true })
    target?.scrollIntoView({ block: 'nearest' })
  }, [expanded, providersPending, state.configuration, menuContainer])
  if (flowId == null) return null

  const requiredBindings = access?.mode == 'selectable' ? access.bindings.filter((binding) => !providerMetadata.get(binding.providerId)?.noSetup) : []
  const activeBindings = requiredBindings.filter((binding) => binding.status == 'active')
  const activeProviderCount = new Set(activeBindings.map((binding) => binding.providerId)).size
  const issueCount = requiredBindings.length - activeBindings.length
  const collapsible = !state.loading && !providersPending && access?.mode == 'selectable' && providerRows.length > 0

  const addService =
    access?.mode == 'selectable' && availableProviders.length > 0 ? (
      <ServicePicker connectors={store.connectors} exclude={providerIds} onSelect={(providerId) => store.connectorAccess.setService(providerId, true)} />
    ) : null

  return (
    <section
      tabIndex={-1}
      ref={setMenuContainer}
      className="flex max-h-[60%] min-h-0 shrink-0 flex-col border-b border-border px-3 py-2"
      aria-labelledby={titleId}
    >
      {(access?.discardedBindingCount ?? 0) > 0 && (
        <p role="status" className="text-xs text-destructive">
          {t('connectorAccess.discardedBindings')}
        </p>
      )}
      {collapsible ? (
        <h3 className="shrink-0" id={titleId}>
          <Button
            aria-controls={contentId}
            aria-expanded={expanded}
            className="h-auto w-full justify-start gap-2 px-0 py-2 text-left whitespace-normal"
            onClick={() => setExpandedFlowId(expanded ? undefined : flowId)}
            type="button"
            variant="disclosure"
          >
            <i aria-hidden="true" className={`i-lucide-light:chevron-right size-4 shrink-0 ${expanded ? 'rotate-90' : ''}`} />
            <span className="min-w-0 flex-1">
              <span className="block text-xs font-medium text-foreground">{t('connectorAccess.title')}</span>
              <span className="mt-1 block text-[11px] leading-4 font-normal text-muted-foreground">
                {!requiresAuthorization
                  ? t('connectorAccess.summaryNoAuthorization')
                  : activeBindings.length == 0
                    ? t('connectorAccess.summaryEmpty')
                    : t('connectorAccess.summary', { connections: activeBindings.length, providers: activeProviderCount })}
              </span>
            </span>
          </Button>
        </h3>
      ) : (
        <h3 className="py-1 text-xs font-medium" id={titleId}>
          {t('connectorAccess.title')}
        </h3>
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
              <NativeScrollArea
                aria-labelledby={titleId}
                className="h-auto max-h-[min(40dvh,320px)] min-h-0"
                hidden={!expanded}
                id={contentId}
                tabIndex={expanded ? 0 : -1}
              >
                {expanded && (
                  <div className="flex flex-col gap-3 pb-1">
                    {requiresAuthorization && <p className="text-[11px] leading-4 text-muted-foreground">{t('connectorAccess.description')}</p>}
                    <div className="flex flex-col gap-2">
                      {providerRows.map((provider) => {
                        const usedByFlow = revision?.connectorProviderIds.has(provider.serviceId) ?? false
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
                              <AccountReferences
                                references={references.accounts.filter((item) => item.providerId == provider.serviceId)}
                                label={t('connectorAccess.nodeReferences')}
                                onSelect={onSelectReference}
                              />
                            </div>
                          )
                        }
                        const configuring = state.configuration?.providerId == provider.serviceId
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
                            ref={configuring ? configurationTarget : undefined}
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
                                    {(usedByFlow
                                      ? bindings.length > 0
                                      : bindings.length > 0 || (access.providerIds?.includes(provider.serviceId) ?? false)) && (
                                      <DropdownMenuItem
                                        disabled={state.savingProviderId != null}
                                        variant="destructive"
                                        onClick={() => void store.connectorAccess.setService(provider.serviceId, false)}
                                      >
                                        {t(usedByFlow ? 'connectorAccess.removeAuthorization' : 'connectorAccess.removeService')}
                                      </DropdownMenuItem>
                                    )}
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </div>
                            </div>
                            {options.map((option) => {
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
                                      <span className="block wrap-anywhere">{option.connectionDisplayName}</span>
                                      <span className="block text-[11px] text-muted-foreground wrap-anywhere">
                                        {permissionLabel == null ? groupLabel : `${groupLabel} · ${permissionLabel}`}
                                      </span>
                                    </span>
                                    {binding != null && binding.status != 'active' && (
                                      <span className="shrink-0 leading-4 text-destructive">{t('connectorAccess.status', { status: binding.status })}</span>
                                    )}
                                  </Label>
                                  {option.connectionId != null && (
                                    <div className="pl-6">
                                      <AccountReferences
                                        references={references.accounts.filter(
                                          (item) => item.providerId == provider.serviceId && item.connectionId == option.connectionId,
                                        )}
                                        label={t('connectorAccess.accountReferences')}
                                        onSelect={onSelectReference}
                                      />
                                    </div>
                                  )}
                                </div>
                              )
                            })}
                            <AccountReferences
                              references={references.accounts.filter((item) => item.providerId == provider.serviceId && item.connectionId == null)}
                              label={t('connectorAccess.pendingAccountReferences')}
                              onSelect={onSelectReference}
                            />
                            {loading && <p className="text-xs text-muted-foreground">{t('connectorAccess.loadingCandidates')}</p>}
                            {candidates?.length == 0 && !loading && !state.candidateErrors.includes(provider.serviceId) && (
                              <ConnectorAccessEmptyState store={store} serviceId={provider.serviceId} />
                            )}
                            {state.candidateErrors.includes(provider.serviceId) && (
                              <p className="text-xs text-destructive">
                                {t('connectorAccess.candidatesFailed')}{' '}
                                <Button
                                  className="h-auto p-0 underline"
                                  onClick={() => void store.connectorAccess.loadCandidates(provider.serviceId)}
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
                    {references.hasCode && <p className="m-0 text-[11px] leading-4 text-muted-foreground">{t('connectorAccess.dynamicCodeReferences')}</p>}
                    {providers.error != null && <p className="text-xs text-destructive">{t('connectorAccess.providersFailed')}</p>}
                  </div>
                )}
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
  references,
  label,
  onSelect,
}: {
  readonly references: readonly ConnectorAccountReference[]
  readonly label: string
  readonly onSelect?: ((reference: ConnectorAccountReference) => void) | undefined
}): ReactElement | null {
  const t = useTranslate()
  const [expanded, setExpanded] = useState(false)
  if (references.length == 0) return null
  return (
    <div className="flex min-w-0 flex-wrap items-baseline gap-x-1 text-[11px] leading-4 text-muted-foreground">
      <span>{label}</span>
      {(expanded ? references : references.slice(0, 2)).map((reference) => (
        <Button
          key={JSON.stringify([reference.target, reference.nodeId])}
          className="h-auto min-w-0 max-w-full p-0 text-left text-[11px] leading-4 font-normal whitespace-normal wrap-anywhere text-muted-foreground"
          variant="link"
          type="button"
          title={reference.name}
          disabled={onSelect == null}
          onClick={() => onSelect?.(reference)}
        >
          {reference.name}
        </Button>
      ))}
      {!expanded && references.length > 2 && (
        <Button className="h-auto p-0 text-[11px] leading-4 font-normal text-muted-foreground" variant="link" type="button" onClick={() => setExpanded(true)}>
          {t('connectorAccess.moreReferences', { count: references.length - 2 })}
        </Button>
      )}
    </div>
  )
}
