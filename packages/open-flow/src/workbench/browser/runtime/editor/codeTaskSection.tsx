import type { ComponentProps, ReactElement, ReactNode } from 'react'
import type { ReadonlyVal } from 'value-enhancer'
import type { ConnectorPermissionCapability } from '../../../../flow/common/change.ts'
import type { ConnectorAccess, ConnectorAccessCandidates, ConnectorActionMetadata, Diagnostic } from '../api.ts'
import type { ConnectorConnection } from '../api.ts'
import type { ConnectorActionView } from '../connectionCatalog.ts'
import type { WorkbenchTheme } from '../contract.ts'
import type { ResolvedNode } from '../revisionView.ts'
import type { ConnectorStore } from '../stores/connectorStore.ts'
import type { WorkspaceStore } from '../stores/workspaceStore.ts'
import type { SelectedTool } from './actionSelectionDialog.tsx'
import type { DiagnosticFocus } from './diagnostics.ts'
import type { WorkflowToolSelection } from './workflowToolSelection.tsx'

import { dequal } from 'dequal'
import { useEffect, useMemo, useState } from 'react'
import { useVal } from 'use-value-enhancer'
import { useLang, useTranslate } from 'val-i18n-react'
import { compute, val } from 'value-enhancer'
import { codeSharedPermissionsEnabled } from '../../../../flow/common/codePermissions.ts'
import { ValueEditorFeedback } from '../../../../form/browser/fieldControl.tsx'
import { Button } from '../../../../ui/browser/button.tsx'
import { Field, FieldLabel } from '../../../../ui/browser/field.tsx'
import { IconStack } from '../../../../ui/browser/icon-stack.tsx'
import { JSONViewer } from '../../../../ui/browser/json-viewer/JSONViewer.tsx'
import { Switch } from '../../../../ui/browser/switch.tsx'
import { Tooltip, TooltipContent, TooltipTrigger } from '../../../../ui/browser/tooltip.tsx'
import { workflowCapability } from '../../../../workflow/common/workflow.ts'
import { actionSummary } from '../actionSummary.ts'
import { resourceData, resourceValue } from '../stores/resource.ts'
import { errorNotice } from '../stores/workbenchNotice.ts'
import { ActionSelectionDialog } from './actionSelectionDialog.tsx'
import { CodeEditor } from './codeEditor.tsx'
import { CodeHttpHosts } from './codeHttpHosts.tsx'
import { codeTyping } from './codeTyping.ts'
import { diagnosticMessage } from './diagnostics.ts'
import { availableWorkflowToolName } from './workflowToolSelection.tsx'

function EditableCodeTaskSection({
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
  const workflowTools = useMemo<WorkflowToolSelection<SelectedTool>>(
    () => ({
      list: (signal) => store.listWorkflowTargets(signal),
      load: (flowId, signal) => store.loadWorkflowContract(flowId, signal),
      create: (target, entries) =>
        workflowCapability(
          availableWorkflowToolName(
            target,
            entries.filter((entry) => entry.kind == 'workflow'),
          ),
          target,
        ),
      refresh: (entry, target) => (entry.kind == 'workflow' ? workflowCapability(entry.name, target) : entry),
    }),
    [store],
  )
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
  const [loadError, setLoadError] = useState<string>()
  const [completionError, setCompletionError] = useState<string>()
  const [pending, setPending] = useState(false)
  useEffect(() => setPermission(savedPermission), [savedPermission, selection.id])
  const permissionActions = permission?.mode == 'independent' ? permission.actions.map((entry) => entry.action).join(',') : ''
  useEffect(() => {
    setLoadError(undefined)
    if (permissionActions == '') return
    const controller = new AbortController()
    void Promise.all(permissionActions.split(',').map((id) => connectors.loadCodeAction(id, controller.signal)))
      .then(() => {
        const services = new Set(permissionActions.split(',').map((id) => id.split('.')[0]!))
        return Promise.all([...services].map((id) => connectors.loadCodeConnections(id, controller.signal)))
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setLoadError(String(cause))
      })
    return () => controller.abort()
  }, [connectors, permissionActions])
  const savePermission = async (
    value: ConnectorPermissionCapability | undefined,
    workflows = task != null && 'moduleId' in task ? (task.capabilities ?? []).filter((item) => item.kind == 'workflow') : [],
  ) => {
    setPending(true)
    try {
      const connectorCapabilities =
        value === permission && task != null && 'moduleId' in task
          ? (task.capabilities ?? []).filter((item) => item.kind == 'connector')
          : value == null
            ? []
            : [value]
      const http = task != null && 'moduleId' in task ? (task.capabilities ?? []).filter((item) => item.kind == 'http') : []
      if (!(await store.nodes.setCodeActions(selection.id, [...connectorCapabilities, ...workflows, ...http]))) return false
      setPermission(value)
      return true
    } catch (cause) {
      store.notify(errorNotice(cause, t))
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
  const httpHosts = (task.capabilities ?? []).find((item) => item.kind == 'http')?.hosts ?? []
  const saveHttpHosts = async (hosts: readonly string[]) => {
    try {
      const others = (task.capabilities ?? []).filter((item) => item.kind != 'http')
      return await store.nodes.setCodeActions(selection.id, hosts.length == 0 ? others : [...others, { kind: 'http', hosts }])
    } catch (cause) {
      store.notify(errorNotice(cause, t))
      return false
    }
  }
  const selectedActions = permission?.mode == 'independent' ? permission.actions : []
  const selectedTools: readonly SelectedTool[] = [...selectedActions, ...(task.capabilities ?? []).filter((item) => item.kind == 'workflow')]
  const summary = actionSummary(selectedTools, hintedCatalog, providers.data ?? [])
  const actionIssue =
    loadError != null ||
    diagnostics?.some((item) => item.path.includes('/task/capabilities')) ||
    selectedActions.some((entry) => {
      const action = hintedCatalog[entry.action]
      if (action == null || !action.authenticated) return false
      if (entry.connectionId === '') return false
      if (entry.connectionId == null) return true
      const catalog = accountCatalogs[action.serviceId]
      return catalog != null && catalog.byId.get(entry.connectionId)?.status !== 'active'
    })
  const typingFor = (shared: Readonly<Record<string, ConnectorActionView>>) =>
    codeTyping(
      task,
      permission == null ? task.capabilities : [permission, ...(task.capabilities ?? []).filter((item) => item.kind != 'connector')],
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
    <CodeTaskFrame
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
      actions={
        <>
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
            notify={store.notify}
            key={selection.id}
            title={t('actionPicker.configureActions')}
            triggerHint={
              selectedTools.length > 0
                ? summary.workflows > 0
                  ? t('toolPicker.summary', { tools: summary.count, workflows: summary.workflows })
                  : t('actionPicker.selectionSummary', { actions: selectedTools.length, providers: summary.providers.length })
                : undefined
            }
            trigger={
              <Button
                type="button"
                variant={actionIssue ? 'destructive' : 'ghost'}
                size="sm"
                aria-invalid={actionIssue || undefined}
                className={actionIssue ? 'gap-1.5 font-normal' : 'gap-1.5 font-normal text-muted-foreground'}
              >
                {actionIssue && <i aria-hidden="true" data-icon="inline-start" className="i-lucide-light:unplug size-3.5" />}
                {selectedTools.length === 0 ? (
                  <>
                    {!actionIssue && <i aria-hidden="true" data-icon="inline-start" className="i-lucide-light:plus size-3.5" />}
                    {t('actionPicker.triggerLabel')}
                  </>
                ) : (
                  <IconStack icons={summary.providers} count={summary.count} size="sm" />
                )}
              </Button>
            }
            entries={selectedTools}
            connectors={connectors}
            prepareAction={prepareAction}
            workflows={workflowTools}
            disabled={disabled || pending}
            createEntry={(action) => ({ action: action.actionId })}
            onSave={(entries) =>
              savePermission(
                dequal(
                  entries.filter((item) => item.kind != 'workflow'),
                  selectedActions,
                )
                  ? permission
                  : { kind: 'connector', mode: 'independent', actions: entries.filter((item) => item.kind != 'workflow') },
                entries.filter((item) => item.kind == 'workflow'),
              )
            }
          />
        </>
      }
    >
      {(codeSharedPermissionsEnabled || (loadError ?? completionError) != null) && (
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

          {(loadError ?? completionError) != null && (
            <p role="alert" className="text-sm text-destructive">
              {loadError ?? completionError}
            </p>
          )}
        </div>
      )}
      <CodeHttpHosts disabled={disabled || pending} hosts={httpHosts} onSave={saveHttpHosts} />
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
    </CodeTaskFrame>
  ) : null
}

function CodeTaskFrame({ actions, children, ...props }: ComponentProps<'form'> & { readonly actions?: ReactNode }) {
  const t = useTranslate()
  return (
    <form {...props} className="inspector-section inspector-titled-section inspector-form code-section" data-inspector-section="module">
      <h3 className="inspector-section-title">
        <span className="min-w-0 flex-1">{t('inspector.task.javascriptModule')}</span>
        {actions}
      </h3>
      <div className="inspector-section-content" data-inset>
        {children}
      </div>
    </form>
  )
}

export function CodeTaskSection(
  props: Omit<ComponentProps<typeof EditableCodeTaskSection>, 'store' | 'connectors'> & {
    readonly readOnly?: boolean
    readonly store?: WorkspaceStore
    readonly connectors?: ConnectorStore
  },
) {
  const t = useTranslate()
  if (!props.readOnly && props.store != null && props.connectors != null)
    return <EditableCodeTaskSection {...props} store={props.store} connectors={props.connectors} />
  const { selection, theme } = props
  const task = selection.definition
  if (task == null || !('moduleId' in task) || selection.module == null) return null
  return (
    <CodeTaskFrame>
      <CodeEditor
        ariaLabel={t('inspector.task.source')}
        disabled
        theme={theme}
        typing={codeTyping(task, task.capabilities)}
        uri={`publication:modules/${task.moduleId}.js`}
        value={selection.module.source}
        loadingLabel={t('inspector.task.editorLoading')}
        errorLabel={t('inspector.task.editorUnavailable')}
      />
      {task.capabilities != null && <JSONViewer data={task.capabilities} />}
    </CodeTaskFrame>
  )
}
