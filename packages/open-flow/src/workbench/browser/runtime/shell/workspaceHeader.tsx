import type { ReactElement } from 'react'
import type { TFunction } from 'val-i18n'
import type { WorkbenchStore } from '../stores/workbenchStore.ts'
import type { WorkspaceStatus } from '../stores/workspaceModel.ts'

import { useEffect, useRef, useState } from 'react'
import { useVal } from 'use-value-enhancer'
import { useTranslate } from 'val-i18n-react'
import { Button } from '../../../../ui/browser/button.tsx'
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from '../../../../ui/browser/dropdown-menu.tsx'
import { Tabs, TabsList, TabsTrigger } from '../../../../ui/browser/tabs.tsx'
import { Icon } from '../icons.tsx'
import { followWorkbenchLink } from '../navigationLink.ts'
import { DiagnosticsPanel } from './diagnosticsPanel.tsx'

const savingStatusDelayMs = 400
const minimumSavingStatusMs = 400

interface Props {
  readonly activeView: 'design' | 'publications' | 'runs'
  readonly flowHref: string
  readonly flowsHref: string
  readonly onOpenDesign: () => void
  readonly onOpenFlow: () => void
  readonly onOpenFlows: () => void
  readonly onOpenPublications: () => void
  readonly onOpenRuns: () => void
  readonly onRunDraft: () => void
  readonly onRunLive: () => void
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
  const savingStarted = useRef<number>()
  useEffect(() => {
    if (status == 'saving') {
      if (displayed == 'saving') return
      const timer = setTimeout(() => {
        savingStarted.current = Date.now()
        setDisplayed('saving')
      }, savingStatusDelayMs)
      return () => clearTimeout(timer)
    }
    if (displayed != 'saving' || status != 'saved' || savingStarted.current == null) {
      savingStarted.current = undefined
      setDisplayed(status)
      return
    }
    const remaining = minimumSavingStatusMs - (Date.now() - savingStarted.current)
    const timer = setTimeout(
      () => {
        savingStarted.current = undefined
        setDisplayed('saved')
      },
      Math.max(0, remaining),
    )
    return () => clearTimeout(timer)
  }, [displayed, status])
  return displayed
}

export function WorkspaceHeader({
  activeView,
  flowHref,
  flowsHref,
  onOpenDesign,
  onOpenFlow,
  onOpenFlows,
  onOpenPublications,
  onOpenRuns,
  onRunDraft,
  onRunLive,
  store,
}: Props): ReactElement {
  const t = useTranslate()
  const busy = useVal(store.$.busy)
  const checkLoading = useVal(store.workspace.$.checkLoading)
  const diagnostics = useVal(store.workspace.$.diagnostics)
  const diagnosticItems = useVal(store.workspace.$.diagnosticItems)
  const draft = useVal(store.workspace.$.draft)
  const flow = useVal(store.workspace.$.flow)
  const live = useVal(store.workspace.$.live)
  const status = useVal(store.workspace.$.status)
  const displayedStatus = useDisplayedStatus(status)
  const runInputRequest = useVal(store.runRequests.$.inputRequest)
  const target = useVal(store.workspace.$.target)
  const targetName = useVal(store.workspace.$.targetName)
  const workspaceLoading = useVal(store.workspace.$.workspaceLoading)
  const diagnosticsButton = useRef<HTMLButtonElement>(null)
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false)
  const [menuRoot, setMenuRoot] = useState<HTMLDivElement | null>(null)
  const invalid = diagnostics?.valid == false
  const subflow = target?.kind == 'subflow'
  const draftRunUnavailable = invalid ? t('workspace.fixIssuesToRun') : subflow ? t('workspace.openFlowToRun') : undefined
  const publishUnavailable = invalid ? t('workspace.fixIssuesToPublish') : subflow ? t('workspace.subflowPublishHelp') : undefined

  useEffect(() => {
    if (runInputRequest != null) setDiagnosticsOpen(false)
  }, [runInputRequest])

  return (
    <header className="workspace-header">
      <div className="workspace-title">
        <Button
          aria-label={t('resource.workflows')}
          nativeButton={false}
          onClick={(event) => followWorkbenchLink(event, onOpenFlows)}
          render={<a href={flowsHref} />}
          size="icon-sm"
          title={t('resource.workflows')}
          variant="ghost"
        >
          <Icon name="chevron-left" />
        </Button>
        <Button
          className="workspace-flow-link"
          nativeButton={false}
          onClick={(event) => followWorkbenchLink(event, onOpenFlow)}
          render={<a href={flowHref} />}
          size="default"
          variant="ghost"
        >
          <Icon data-icon="inline-start" name="flow" />
          {flow?.name ?? flow?.flowId}
        </Button>
        {subflow && (
          <>
            <span className="workspace-title-separator">/</span>
            <strong>{targetName}</strong>
          </>
        )}
        {live?.hasUnpublishedChanges && (
          <span className="draft-change" title={t('workspace.unpublishedChanges')}>
            <span className="status-dot neutral" />
            <span>{t('workspace.unpublishedChanges')}</span>
          </span>
        )}
      </div>
      <Tabs
        className="workspace-tabs-root"
        onValueChange={(view) => {
          if (view == 'design') onOpenDesign()
          else if (view == 'runs') onOpenRuns()
          else if (view == 'publications') onOpenPublications()
        }}
        value={activeView}
      >
        <TabsList aria-label={t('workspace.views')} className="workspace-tabs" variant="line">
          <TabsTrigger aria-controls="workspace-panel-design" id="workspace-tab-design" value="design">
            {t('workspace.design')}
          </TabsTrigger>
          <TabsTrigger aria-controls="workspace-panel-runs" id="workspace-tab-runs" value="runs">
            {t('workspace.runs')}
          </TabsTrigger>
          <TabsTrigger aria-controls="workspace-panel-publications" id="workspace-tab-publications" value="publications">
            {t('workspace.publications')}
          </TabsTrigger>
        </TabsList>
      </Tabs>
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
          {validationLabel(diagnostics?.valid, diagnostics?.diagnostics.length ?? 0, checkLoading, t)}
        </Button>
        <span aria-atomic="true" aria-live="polite" className="saved-state">
          {workspaceLoading || draft == null ? null : <Icon name="check" size={16} />}
          <span>{t(`workspace.status.${displayedStatus}`)}</span>
        </span>
        <span className="action-help" title={draftRunUnavailable}>
          <Button
            aria-controls="run-input-panel"
            aria-expanded={runInputRequest?.source == 'draft'}
            disabled={busy != null || invalid || subflow || runInputRequest != null}
            onClick={onRunDraft}
            size="default"
            variant="outline"
          >
            <Icon data-icon="inline-start" name="play" />
            {t(busy == 'run' ? 'workspace.starting' : 'workspace.runDraft')}
          </Button>
        </span>
        <span className="action-help" title={publishUnavailable}>
          <Button
            disabled={busy != null || invalid || subflow || live?.hasUnpublishedChanges == false}
            onClick={() => void store.publications.publish()}
            size="default"
          >
            <Icon data-icon="inline-start" name="publish" />
            {t(busy == 'publish' ? 'workspace.publishing' : 'publication.publishDraft')}
          </Button>
        </span>
        {live?.publication != null && (
          <div className="workspace-more" ref={setMenuRoot}>
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label={t('workspace.moreActions')}
                render={
                  <Button size="icon" title={t('workspace.moreActions')} variant="ghost">
                    <Icon name="more" />
                  </Button>
                }
              />
              <DropdownMenuContent align="end" className="min-w-40" container={menuRoot} side="bottom">
                <DropdownMenuGroup>
                  <DropdownMenuItem disabled={busy != null || live.status == 'suspended' || runInputRequest != null} onClick={onRunLive}>
                    <Icon name="play" />
                    {t(busy == 'run' ? 'workspace.starting' : 'workspace.runLive')}
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>
      {diagnosticsOpen && (
        <DiagnosticsPanel
          checked={diagnostics != null}
          checking={checkLoading}
          items={diagnosticItems}
          onClose={() => {
            setDiagnosticsOpen(false)
            diagnosticsButton.current?.focus()
          }}
          onRefresh={() => void store.workspace.check()}
          onSelect={(item) => {
            onOpenDesign()
            if (store.workspace.locateDiagnostic(item)) setDiagnosticsOpen(false)
          }}
        />
      )}
    </header>
  )
}
