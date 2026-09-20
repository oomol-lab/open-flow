import type { ReactElement } from 'react'
import type { ConnectorAccess } from '../../../../control/common/api.ts'
import type { RevisionView } from '../revisionView.ts'
import type { WorkbenchStore } from '../stores/workbenchStore.ts'

import { useEffect, useState } from 'react'
import { useVal } from 'use-value-enhancer'
import { useLang, useTranslate } from 'val-i18n-react'
import { Button } from '../../../../ui/browser/button.tsx'
import { Checkbox } from '../../../../ui/browser/checkbox.tsx'
import { Label } from '../../../../ui/browser/label.tsx'
import { connectorAccessPermissionGroupLabel, connectorAccessPermissionLabel } from './connectorAccessPresentation.ts'

function connectorAccessProviderIds(revision: RevisionView | undefined, access: ConnectorAccess | undefined): readonly string[] {
  const ids = new Set(access?.bindings.map((binding) => binding.providerId))
  for (const providerId of revision?.connectorProviderIds ?? []) ids.add(providerId)
  return [...ids].toSorted()
}

export function ConnectorAccessSettings({
  onManage,
  store,
}: {
  readonly onManage?: ((flowId: string) => void) | undefined
  readonly store: WorkbenchStore
}): ReactElement | null {
  const t = useTranslate()
  const language = useLang()
  const flowId = useVal(store.workspace.$.flowId)
  const revision = useVal(store.workspace.$.revision)
  const state = useVal(store.connectorAccess.$)
  const [expandedFlowId, setExpandedFlowId] = useState<string>()
  const providers = useVal(store.workspace.catalogs.providers.get(undefined, language))
  const access = state.access
  const expanded = flowId != null && expandedFlowId == flowId
  const providerNames = new Map(providers.data?.map((provider) => [provider.serviceId, provider.serviceName]))
  const providerRows = connectorAccessProviderIds(revision, access).map((serviceId) => ({ serviceId, serviceName: providerNames.get(serviceId) ?? serviceId }))
  const providerKey = providerRows.map((provider) => provider.serviceId).join('\0')
  useEffect(() => {
    if (!expanded || flowId == null || access?.mode != 'selectable') return
    for (const providerId of providerKey.split('\0').filter(Boolean)) {
      if (state.candidates[providerId] == null) void store.connectorAccess.loadCandidates(providerId)
    }
  }, [access?.mode, expanded, flowId, providerKey, state.candidates, store])
  if (flowId == null) return null

  const activeBindings = access?.mode == 'selectable' ? access.bindings.filter((binding) => binding.status == 'active') : []
  const activeProviderCount = new Set(activeBindings.map((binding) => binding.providerId)).size
  const issueCount = access?.mode == 'selectable' ? access.bindings.length - activeBindings.length : 0

  return (
    <section className="border-b border-border px-2.5 py-3" aria-labelledby="connector-access-title">
      <h3 className="text-xs font-medium" id="connector-access-title">
        {t('connectorAccess.title')}
      </h3>
      {onManage != null && (
        <Button className="mt-1 -ml-2" onClick={() => onManage(flowId)} size="xs" type="button" variant="ghost">
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
      ) : (
        <div className="mt-2 flex flex-col gap-2">
          {providerRows.length == 0 ? (
            <p className="text-xs text-muted-foreground">{t('connectorAccess.empty')}</p>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2">
                <p className="min-w-0 text-xs text-muted-foreground">
                  {activeBindings.length == 0
                    ? t('connectorAccess.summaryEmpty')
                    : t('connectorAccess.summary', { connections: activeBindings.length, providers: activeProviderCount })}
                </p>
                <Button
                  aria-expanded={expanded}
                  className="shrink-0"
                  onClick={() => setExpandedFlowId(expanded ? undefined : flowId)}
                  size="xs"
                  type="button"
                  variant="disclosure"
                >
                  {t(expanded ? 'connectorAccess.collapse' : 'connectorAccess.manageConnections')}
                </Button>
              </div>
              {issueCount > 0 && <p className="text-xs text-destructive">{t('connectorAccess.summaryIssues', { count: issueCount })}</p>}
              {expanded && (
                <div className="flex flex-col gap-2">
                  <p className="text-xs text-muted-foreground">{t('connectorAccess.description')}</p>
                  {providerRows.map((provider) => {
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
                      <div className="flex flex-col gap-1" key={provider.serviceId}>
                        <span className="text-xs font-medium">{provider.serviceName}</span>
                        {options.map((option) => {
                          const binding = bindings.find((item) => item.accessBindingId == option.accessBindingId)
                          const groupLabel = connectorAccessPermissionGroupLabel(option, t)
                          const permissionLabel = connectorAccessPermissionLabel(option, t)
                          return (
                            <Label className="min-w-0 items-start py-1 text-xs font-normal" key={option.accessBindingId}>
                              <Checkbox
                                checked={binding != null}
                                className="mt-px"
                                disabled={saving}
                                onCheckedChange={(checked) => void store.connectorAccess.select(provider.serviceId, option.accessBindingId, checked === true)}
                              />
                              <span className="min-w-0 flex-1 leading-4">
                                <span className="block truncate">{option.connectionDisplayName}</span>
                                <span className="block text-[11px] text-muted-foreground">
                                  {permissionLabel == null ? groupLabel : `${groupLabel} · ${permissionLabel}`}
                                </span>
                              </span>
                              {binding != null && binding.status != 'active' && (
                                <span className="shrink-0 leading-4 text-destructive">{t('connectorAccess.status', { status: binding.status })}</span>
                              )}
                            </Label>
                          )
                        })}
                        {loading && <p className="text-xs text-muted-foreground">{t('connectorAccess.loadingCandidates')}</p>}
                        {candidates?.length == 0 && <p className="text-xs text-muted-foreground">{t('connectorAccess.noCandidates')}</p>}
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
                  {providers.error != null && <p className="text-xs text-destructive">{t('connectorAccess.providersFailed')}</p>}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </section>
  )
}
