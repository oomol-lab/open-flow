import type { ReactElement } from 'react'
import type { TFunction } from 'val-i18n'
import type { WorkbenchStore } from '../stores/workbenchStore.ts'
import type { WorkspaceStatus } from '../stores/workspaceModel.ts'

import { useEffect, useRef, useState } from 'react'
import { useVal } from 'use-value-enhancer'
import { useTranslate } from 'val-i18n-react'
import { Button } from '../../../../ui/browser/button.tsx'
import { useDelayedTrue } from '../../../../ui/browser/hooks.ts'
import { Icon } from '../icons.tsx'
import { DiagnosticsPanel } from './diagnosticsPanel.tsx'
import { HostMenu } from './hostMenu.tsx'

const savingStatusDelayMs = 200

interface Props {
  readonly hostAction?: string | undefined
  readonly hostTitle?: string | undefined
  readonly onHostAction?: (() => void) | undefined
  readonly onOpenDesign: () => void
  readonly store: WorkbenchStore
}

function validationLabel(valid: boolean | undefined, issueCount: number, loading: boolean, t: TFunction): string {
  if (loading) return t('workspace.checking')
  if (valid == null) return t('workspace.notChecked')
  if (valid) return t('workspace.valid')
  return issueCount == 1 ? t('workspace.issueSingle') : t('workspace.issues', { count: issueCount })
}

function useDisplayedStatus(status: WorkspaceStatus): WorkspaceStatus {
  const [displayed, setDisplayed] = useState(status)
  useEffect(() => {
    if (status == 'saving') {
      if (displayed == 'saving') return
      const timer = setTimeout(() => setDisplayed('saving'), savingStatusDelayMs)
      return () => clearTimeout(timer)
    }
    setDisplayed(status)
  }, [displayed, status])
  return displayed
}

export function WorkspaceHeader({ hostAction, hostTitle, onHostAction, onOpenDesign, store }: Props): ReactElement {
  const t = useTranslate()
  const checkLoading = useVal(store.workspace.$.checkLoading)
  const diagnostics = useVal(store.$.diagnostics)
  const diagnosticItems = useVal(store.$.diagnosticItems)
  const designerNodes = useVal(store.$.designerNodeById)
  const draft = useVal(store.workspace.$.draft)
  const live = useVal(store.workspace.$.live)
  const status = useVal(store.workspace.$.status)
  const displayedStatus = useDisplayedStatus(status)
  const displayedCheckLoading = useDelayedTrue(checkLoading, 200)
  const runInputRequest = useVal(store.runRequests.$.inputRequest)
  const target = useVal(store.workspace.$.target)
  const targetName = useVal(store.workspace.$.targetName)
  const workspaceLoading = useVal(store.workspace.$.workspaceLoading)
  const diagnosticsButton = useRef<HTMLButtonElement>(null)
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false)
  const invalid = diagnostics?.valid == false
  const subflow = target?.kind == 'subflow'

  useEffect(() => {
    if (runInputRequest != null) setDiagnosticsOpen(false)
  }, [runInputRequest])

  return (
    <header className="workspace-header">
      <div className="workspace-header-context">
        {subflow && <strong>{targetName}</strong>}
        {live?.hasUnpublishedChanges && (
          <span className="draft-change" title={t('workspace.unpublishedChanges')}>
            <span className="status-dot neutral" />
            <span>{t('workspace.unpublishedChanges')}</span>
          </span>
        )}
      </div>
      <div className="workspace-actions">
        <Button
          aria-controls="diagnostics-panel"
          aria-expanded={diagnosticsOpen}
          className="validation-state"
          disabled={target == null || checkLoading}
          onClick={() => {
            store.runRequests.dismissInputs()
            setDiagnosticsOpen(!diagnosticsOpen)
          }}
          ref={diagnosticsButton}
          size="sm"
          title={t('diagnostics.open')}
          variant={invalid ? 'destructive' : 'ghost'}
        >
          <Icon data-icon="inline-start" name={invalid ? 'alert' : 'check'} />
          {validationLabel(diagnostics?.valid, diagnostics?.diagnostics.length ?? 0, displayedCheckLoading, t)}
        </Button>
        <span aria-atomic="true" aria-live="polite" className="saved-state">
          {workspaceLoading || draft == null ? null : (
            <Icon name={displayedStatus == 'failed' ? 'alert' : displayedStatus == 'saving' ? 'wait' : 'check'} size={16} />
          )}
          <span>{t(`workspace.status.${displayedStatus}`)}</span>
        </span>
        {hostAction != null && hostTitle != null && onHostAction != null && <HostMenu action={hostAction} onAction={onHostAction} title={hostTitle} />}
      </div>
      {diagnosticsOpen && (
        <DiagnosticsPanel
          checked={diagnostics != null}
          checking={checkLoading}
          items={diagnosticItems}
          nodes={designerNodes}
          onClose={() => {
            setDiagnosticsOpen(false)
            diagnosticsButton.current?.focus()
          }}
          onRefresh={() => void store.workspace.check()}
          onSelect={(item) => {
            onOpenDesign()
            if (store.workspace.locateDiagnostic(item)) setDiagnosticsOpen(false)
          }}
          onSelectNode={(nodeId) => {
            onOpenDesign()
            if (store.workspace.locateNode(nodeId)) setDiagnosticsOpen(false)
          }}
        />
      )}
    </header>
  )
}
