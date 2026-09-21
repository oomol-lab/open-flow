import type { ReactElement } from 'react'
import type { ConnectorAccess, ConnectorConnection } from '../api.ts'
import type { ConnectorActionView } from '../connectionCatalog.ts'
import type { WorkbenchTheme } from '../contract.ts'
import type { ResolvedNode } from '../revisionView.ts'
import type { ConnectorStore } from '../stores/connectorStore.ts'
import type { WorkspaceStore } from '../stores/workspaceStore.ts'
import type { DiagnosticFocus } from './diagnostics.ts'

import { useEffect, useMemo } from 'react'
import { useVal } from 'use-value-enhancer'
import { useLang, useTranslate } from 'val-i18n-react'
import { compute } from 'value-enhancer'
import { Button } from '../../../../ui/browser/button.tsx'
import { CodeActions } from './codeActions.tsx'
import { CodeEditor } from './codeEditor.tsx'
import { codeTyping } from './codeTyping.ts'

export function CodeTaskSection({
  connectorAccess,
  connectors,
  prepareConnectorAction,
  disabled,
  focus,
  selection,
  store,
  theme,
}: {
  readonly connectorAccess?: ConnectorAccess
  readonly connectors: ConnectorStore
  readonly prepareConnectorAction?: (
    action: ConnectorActionView,
  ) => Promise<{ readonly action: ConnectorActionView; readonly connections: readonly ConnectorConnection[] } | undefined>
  readonly disabled: boolean
  readonly focus?: DiagnosticFocus
  readonly selection: Extract<ResolvedNode, { readonly kind: 'task' }>
  readonly store: WorkspaceStore
  readonly theme: WorkbenchTheme
}): ReactElement | null {
  const hintedCatalog = useVal(connectors.$.actions)
  const connections = useVal(connectors.$.connections)
  const providerIds =
    connectorAccess?.mode == 'selectable'
      ? connectorAccess.bindings.filter((binding) => binding.status == 'active').map((binding) => binding.providerId)
      : connections.filter((connection) => connection.status == 'active').map((connection) => connection.serviceId)
  const providerKey = JSON.stringify([...new Set(providerIds)].toSorted())
  const language = useLang()
  const flowId = useVal(store.$.flowId)
  const catalog = useMemo(
    () =>
      compute((get) => {
        const ids: string[] = JSON.parse(providerKey)
        return Object.fromEntries(
          ids.flatMap((id) => (get(store.catalogs.actions.get(id, flowId, language)).data ?? []).map((action) => [action.actionId, action])),
        )
      }),
    [store, providerKey, language, flowId],
  )
  useEffect(() => () => catalog.dispose(), [catalog])
  const actionCatalog = { ...hintedCatalog, ...useVal(catalog) }
  const t = useTranslate()
  const task = selection.definition
  const module = selection.module
  const moduleEditor = useVal(store.$.moduleEditor)
  const moduleLocation = focus?.section == 'module' ? focus.diagnostic : undefined

  if (task == null) return <div className="inspector-section section-error">{t('inspector.task.missing')}</div>
  return module != null && 'moduleId' in task && moduleEditor?.moduleId == task.moduleId ? (
    <form
      className="inspector-form code-section"
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
      <div className="inspector-section-title">{t('inspector.task.javascriptModule')}</div>
      <div className="code-section-content">
        <CodeActions
          access={connectorAccess}
          capabilities={task.capabilities ?? []}
          nodeId={selection.id}
          prepareAction={prepareConnectorAction}
          key={`${moduleEditor.moduleId}-${selection.id}`}
          connectors={connectors}
          disabled={disabled || moduleEditor.status == 'saving'}
          store={store}
        />
        <CodeEditor
          ariaLabel={t('inspector.task.source')}
          disabled={disabled}
          errorLabel={t('inspector.task.editorUnavailable')}
          loadingLabel={t('inspector.task.editorLoading')}
          location={moduleLocation == null ? undefined : { column: moduleLocation.column, line: moduleLocation.line }}
          onBlur={() => {
            if (store.hasUnsavedCode) void store.saveModuleEditor()
          }}
          onChange={(value) => store.updateModuleSource(value)}
          theme={theme}
          typing={codeTyping(task, task.capabilities, actionCatalog, providerIds)}
          uri={`file:///modules/${moduleEditor.moduleId}.js`}
          value={moduleEditor.source}
        />
        <span className="code-source-note">{t('inspector.task.importsFromSource')}</span>
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
