import type { ReactElement } from 'react'
import type { ConnectorAccess } from '../api.ts'
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
import { Tooltip, TooltipContent, TooltipTrigger } from '../../../../ui/browser/tooltip.tsx'
import { CodeEditor } from './codeEditor.tsx'
import { codeTyping } from './codeTyping.ts'

export function CodeTaskSection({
  connectorAccess,
  connectors,
  onConfigureAccess,
  disabled,
  focus,
  selection,
  store,
  theme,
}: {
  readonly connectorAccess?: ConnectorAccess
  readonly connectors: ConnectorStore
  readonly onConfigureAccess?: (() => void) | undefined
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
        {onConfigureAccess != null && (
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
      </h3>
      <div className="inspector-section-content" data-inset>
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
