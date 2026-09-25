import type { ReactElement } from 'react'
import type { ReadonlyVal } from 'value-enhancer'
import type { ConnectorPermissionCapability } from '../../../../flow/common/change.ts'
import type { ConnectorAccess, ConnectorAccessCandidates, ConnectorActionMetadata, Diagnostic } from '../api.ts'
import type { ConnectorConnection } from '../api.ts'
import type { ConnectorActionView } from '../connectionCatalog.ts'
import type { WorkbenchTheme } from '../contract.ts'
import type { ResolvedNode } from '../revisionView.ts'
import type { ConnectorStore } from '../stores/connectorStore.ts'
import type { WorkspaceStore } from '../stores/workspaceStore.ts'
import type { DiagnosticFocus } from './diagnostics.ts'

import { useEffect, useMemo, useState } from 'react'
import { useVal } from 'use-value-enhancer'
import { useLang, useTranslate } from 'val-i18n-react'
import { compute, val } from 'value-enhancer'
import { codeSharedPermissionsEnabled } from '../../../../flow/common/codePermissions.ts'
import { ValueEditorFeedback } from '../../../../form/browser/fieldControl.tsx'
import { Button } from '../../../../ui/browser/button.tsx'
import { Field, FieldLabel } from '../../../../ui/browser/field.tsx'
import { ContentIcon } from '../../../../ui/browser/icons/ContentIcon.tsx'
import { Switch } from '../../../../ui/browser/switch.tsx'
import { Tooltip, TooltipContent, TooltipTrigger } from '../../../../ui/browser/tooltip.tsx'
import { providerIcon } from '../providerIcon.ts'
import { resourceData, resourceValue } from '../stores/resource.ts'
import { ActionSelectionDialog } from './actionSelectionDialog.tsx'
import { CodeEditor } from './codeEditor.tsx'
import { codeTyping } from './codeTyping.ts'
import { diagnosticMessage } from './diagnostics.ts'

export function CodeTaskSection({
  connectorAccess,
  connectorCandidates,
  connectors,
  prepareAction,
  onConfigureAccess,
  disabled,
  diagnostics,
  focus,
  selection,
  store,
  theme,
}: {
  readonly connectorCandidates?: Readonly<Record<string, ConnectorAccessCandidates | undefined>>
  readonly connectorAccess?: ConnectorAccess
  readonly connectors: ConnectorStore
  readonly prepareAction?: (
    action: ConnectorActionView,
  ) => Promise<{ readonly action: ConnectorActionView; readonly connections: readonly ConnectorConnection[] } | undefined>
  readonly onConfigureAccess?: (() => void) | undefined
  readonly disabled: boolean
  readonly diagnostics?: readonly Diagnostic[]
  readonly focus?: DiagnosticFocus
  readonly selection: Extract<ResolvedNode, { readonly kind: 'task' }>
  readonly store: WorkspaceStore
  readonly theme: WorkbenchTheme
}): ReactElement | null {
  const task = selection.definition
  const savedPermission = task != null && 'moduleId' in task ? task.capabilities?.find((capability) => 'mode' in capability) : undefined
  const [permission, setPermission] = useState<ConnectorPermissionCapability | undefined>(savedPermission)
  const sharedPermissions = permission?.mode != 'independent'
  const hintedCatalog = useVal(connectors.$.actions)
  const connections = useVal(connectors.$.connections)
  const accountCatalogs = useVal(connectors.$.catalogs)
  const language = useLang()
  const providers = useVal(store.catalogs.providers.get(undefined, language))
  const providerIds = [
    ...(connectorAccess?.mode == 'selectable'
      ? connectorAccess.bindings.filter((binding) => binding.status == 'active').map((binding) => binding.providerId)
      : connectorAccess?.mode == 'implicit'
        ? connections.filter((connection) => connection.status == 'active').map((connection) => connection.serviceId)
        : []),
    ...(providers.data ?? []).filter((provider) => provider.noSetup).map((provider) => provider.serviceId),
  ]
  const providerKey = JSON.stringify([...new Set(providerIds)].toSorted())
  const flowId = useVal(store.$.flowId)
  const completionCatalog = useMemo(() => {
    const ids: string[] = JSON.parse(providerKey)
    const sources = val<readonly ReadonlyVal<readonly ConnectorActionMetadata[] | undefined>[]>([])
    const catalog = compute((get) => Object.fromEntries(get(sources).flatMap((source) => (get(source) ?? []).map((action) => [action.actionId, action]))))
    return {
      catalog,
      async load() {
        // Only completion initiates reads. Subscriptions observe the same Store-owned responses.
        const requested = ids.map((id) => store.catalogs.actions.get(id, flowId, language))
        if (sources.value.length === 0 && requested.length > 0) sources.set(requested.map(resourceData))
        await Promise.all(requested.map((source) => resourceValue(source)))
      },
      dispose() {
        catalog.dispose()
        sources.dispose()
      },
    }
  }, [store, providerKey, language, flowId])
  useEffect(() => () => completionCatalog.dispose(), [completionCatalog])
  const allowSharedAction = (action: ConnectorActionView) =>
    !action.authenticated ||
    connectorAccess?.mode == 'implicit' ||
    connectorAccess?.bindings.some(
      (binding) =>
        binding.status == 'active' &&
        binding.providerId == action.serviceId &&
        connectorCandidates?.[action.serviceId]?.candidates.some(
          (candidate) =>
            candidate.accessBindingId == binding.accessBindingId &&
            (candidate.permissions == null || candidate.permissions.allActions || candidate.permissions.actionIds.includes(action.actionId)),
        ),
    )
  const sharedActionCatalog = Object.fromEntries(Object.entries(useVal(completionCatalog.catalog)).filter(([, action]) => allowSharedAction(action)))
  const t = useTranslate()
  const [saveError, setSaveError] = useState<string>()
  const [completionError, setCompletionError] = useState<string>()
  const [pending, setPending] = useState(false)
  useEffect(() => setPermission(savedPermission), [savedPermission, selection.id])
  const permissionActions = permission?.mode == 'independent' ? permission.actions.map((entry) => entry.action).join(',') : ''
  useEffect(() => {
    if (permissionActions == '') return
    const controller = new AbortController()
    void Promise.all(permissionActions.split(',').map((id) => connectors.loadCodeAction(id, controller.signal)))
      .then(() => {
        const services = new Set(permissionActions.split(',').map((id) => id.split('.')[0]!))
        return Promise.all([...services].map((id) => connectors.loadCodeConnections(id, controller.signal)))
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setSaveError(String(cause))
      })
    return () => controller.abort()
  }, [connectors, permissionActions])
  const savePermission = async (value: ConnectorPermissionCapability) => {
    setPending(true)
    setSaveError(undefined)
    try {
      if (!(await store.setCodeActions(selection.id, [value]))) {
        setSaveError(t('inspector.task.permissionSaveFailed'))
        return false
      }
      setPermission(value)
      return true
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : String(cause))
      return false
    } finally {
      setPending(false)
    }
  }
  const module = selection.module
  const moduleEditor = useVal(store.$.moduleEditor)
  const moduleLocation = focus?.section == 'module' ? focus.diagnostic : undefined
  const moduleDiagnostics = useMemo(
    () =>
      moduleEditor?.source == module?.source ? (diagnostics?.filter((diagnostic) => diagnostic.path == `/modules/${moduleEditor?.moduleId}/source`) ?? []) : [],
    [diagnostics, moduleEditor?.moduleId, moduleEditor?.source, module?.source],
  )
  const editorDiagnostics = useMemo(
    () =>
      module == null
        ? undefined
        : {
            source: module.source,
            items: moduleDiagnostics.map((diagnostic) => ({ ...diagnostic, message: diagnosticMessage(diagnostic, t) })),
          },
    [module?.source, moduleDiagnostics, t],
  )

  if (task == null) return <div className="inspector-section section-error">{t('inspector.task.missing')}</div>
  if (!('moduleId' in task)) return null
  const selectedActions = permission?.mode == 'independent' ? permission.actions : []
  const actionIssue =
    saveError != null ||
    diagnostics?.some((item) => item.path.includes('/task/capabilities')) ||
    selectedActions.some((entry) => {
      const action = hintedCatalog[entry.action]
      if (action == null || !action.authenticated) return false
      if (entry.connectionId == null) return true
      const catalog = accountCatalogs[action.serviceId]
      return catalog != null && catalog.byId.get(entry.connectionId)?.status !== 'active'
    })
  const typingFor = (shared: Readonly<Record<string, ConnectorActionView>>) =>
    codeTyping(
      task,
      permission == null ? task.capabilities : [permission],
      permission?.mode == 'shared' ? shared : { ...hintedCatalog, ...shared },
      providerIds,
    )
  const prepareCompletion = async () => {
    if (!sharedPermissions) return typingFor({})
    try {
      await completionCatalog.load()
      setCompletionError(undefined)
    } catch (cause) {
      setCompletionError(cause instanceof Error ? cause.message : String(cause))
    }
    return typingFor(Object.fromEntries(Object.entries(completionCatalog.catalog.value).filter(([, action]) => allowSharedAction(action))))
  }
  return module != null && moduleEditor?.moduleId == task.moduleId ? (
    <form
      className="inspector-section inspector-titled-section inspector-form code-section"
      data-inspector-section="module"
      onKeyDown={(event) => {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() == 's') {
          event.preventDefault()
          event.stopPropagation()
          if (!disabled) void store.saveModuleEditor()
        }
      }}
      onSubmit={(event) => {
        event.preventDefault()
        void store.saveModuleEditor()
      }}
    >
      <h3 className="inspector-section-title">
        <span className="min-w-0 flex-1">{t('inspector.task.javascriptModule')}</span>
        {codeSharedPermissionsEnabled && onConfigureAccess != null && (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  className="shrink-0 font-normal text-muted-foreground"
                  disabled={disabled}
                  onClick={onConfigureAccess}
                  size="xs"
                  type="button"
                  variant="ghost"
                />
              }
            >
              {t('inspector.actions.flowAccess')}
            </TooltipTrigger>
            <TooltipContent>{t('inspector.actions.flowAccessHint')}</TooltipContent>
          </Tooltip>
        )}
        <ActionSelectionDialog
          key={selection.id}
          title={t('actionPicker.configureActions')}
          trigger={
            <Button
              type="button"
              variant={actionIssue ? 'destructive' : 'ghost'}
              size="sm"
              aria-invalid={actionIssue || undefined}
              className={actionIssue ? 'gap-1.5 font-normal' : 'gap-1.5 font-normal text-muted-foreground'}
            >
              {actionIssue && <i aria-hidden="true" data-icon="inline-start" className="i-lucide-light:unplug size-3.5" />}
              {selectedActions.length === 0 ? (
                <>
                  {!actionIssue && <i aria-hidden="true" data-icon="inline-start" className="i-lucide-light:plus size-3.5" />}
                  {t('actionPicker.triggerLabel')}
                </>
              ) : (
                <>
                  <span aria-hidden="true" className="flex items-center -space-x-2">
                    {selectedActions.slice(0, 3).map((entry) => {
                      const action = hintedCatalog[entry.action]
                      const serviceId = action?.serviceId ?? entry.action.split('.')[0]!
                      const provider = providers.data?.find((item) => item.serviceId == serviceId)
                      return (
                        <span
                          key={entry.action}
                          className="relative flex size-6 shrink-0 items-center justify-center rounded-full border border-border/50 bg-popover"
                        >
                          <ContentIcon src={providerIcon(action ?? provider ?? { serviceId, serviceName: serviceId })} className="size-4" />
                        </span>
                      )
                    })}
                    <span className="relative flex size-6 shrink-0 items-center justify-center rounded-full border border-border/50 bg-muted text-[10px] font-medium tabular-nums text-foreground">
                      +{selectedActions.length}
                    </span>
                  </span>
                </>
              )}
            </Button>
          }
          entries={selectedActions}
          connectors={connectors}
          prepareAction={prepareAction}
          disabled={disabled || pending}
          createEntry={(action) => ({ action: action.actionId })}
          onSave={(actions) => savePermission({ kind: 'connector', mode: 'independent', actions })}
        />
      </h3>
      <div className="inspector-section-content" data-inset>
        {(codeSharedPermissionsEnabled || (saveError ?? completionError) != null) && (
          <div className="flex flex-col gap-2" data-inspector-section="code-permissions">
            {codeSharedPermissionsEnabled && (
              <Field orientation="horizontal" className="justify-between gap-3">
                <div className="flex min-w-0 items-center gap-1">
                  <FieldLabel className="text-xs font-normal" htmlFor={`${selection.id}-shared-permissions`}>
                    {t('inspector.task.sharedPermissions')}
                  </FieldLabel>
                  <Tooltip>
                    <TooltipTrigger
                      aria-label={t('inspector.task.sharedPermissions')}
                      className="inline-flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <i aria-hidden="true" className="i-codicon:question text-[13px]" />
                    </TooltipTrigger>
                    <TooltipContent>{t('inspector.task.sharedPermissionsHint')}</TooltipContent>
                  </Tooltip>
                  <span id={`${selection.id}-shared-permissions-hint`} className="sr-only">
                    {t('inspector.task.sharedPermissionsHint')}
                  </span>
                </div>
                <Switch
                  id={`${selection.id}-shared-permissions`}
                  aria-describedby={sharedPermissions ? `${selection.id}-shared-permissions-hint` : undefined}
                  size="sm"
                  checked={sharedPermissions}
                  disabled={disabled || pending}
                  onCheckedChange={(shared) =>
                    void savePermission(shared ? { kind: 'connector', mode: 'shared' } : { kind: 'connector', mode: 'independent', actions: [] })
                  }
                />
              </Field>
            )}

            {(saveError ?? completionError) != null && (
              <p role="alert" className="text-sm text-destructive">
                {saveError ?? completionError}
              </p>
            )}
          </div>
        )}
        <ValueEditorFeedback
          error={
            moduleDiagnostics.length > 0
              ? moduleDiagnostics.map((diagnostic) => (
                  <div key={`${diagnostic.path}:${diagnostic.line}:${diagnostic.column}:${diagnostic.code}`}>{diagnosticMessage(diagnostic, t)}</div>
                ))
              : undefined
          }
        >
          {(errorId) => (
            <CodeEditor
              ariaDescribedBy={errorId}
              ariaLabel={t('inspector.task.source')}
              disabled={disabled}
              diagnostics={editorDiagnostics}
              invalid={moduleDiagnostics.length > 0}
              errorLabel={t('inspector.task.editorUnavailable')}
              loadingLabel={t('inspector.task.editorLoading')}
              location={moduleLocation == null ? undefined : { column: moduleLocation.column, line: moduleLocation.line }}
              prepareCompletion={prepareCompletion}
              onBlur={() => {
                if (store.hasUnsavedCode) void store.saveModuleEditor()
              }}
              onChange={(value) => store.updateModuleSource(value)}
              theme={theme}
              typing={typingFor(sharedActionCatalog)}
              uri={`file:///modules/${moduleEditor.moduleId}.js`}
              value={moduleEditor.source}
            />
          )}
        </ValueEditorFeedback>
        {moduleEditor.status == 'failed' && (
          <div className="form-actions code-actions">
            <Button disabled={disabled} onClick={() => store.discardModuleChanges()} size="sm" type="button" variant="secondary">
              {t('inspector.task.discardCode')}
            </Button>
            <Button disabled={disabled} size="sm" type="submit">
              {t('inspector.task.retrySave')}
            </Button>
          </div>
        )}
      </div>
    </form>
  ) : null
}
