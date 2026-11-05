import type { WorkflowBundle, WorkflowExportPreview } from '../../../../flow/common/workflowBundle.ts'
import type { WorkspaceStore } from '../stores/workspaceStore.ts'

import { useId, useState } from 'react'
import { useVal } from 'use-value-enhancer'
import { useTranslate } from 'val-i18n-react'
import { Button } from '../../../../ui/browser/button.tsx'
import { Checkbox } from '../../../../ui/browser/checkbox.tsx'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../../../../ui/browser/dialog.tsx'
import { Field, FieldLabel } from '../../../../ui/browser/field.tsx'

function WorkflowListItem({ name }: { readonly name: string }) {
  return (
    <li className="flex items-start gap-2">
      <i aria-hidden="true" className="i-lucide-light:workflow mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 break-words">{name}</span>
    </li>
  )
}

export function WorkflowBundleSummary({ bundle, entryName }: { readonly bundle: WorkflowBundle; readonly entryName: string }) {
  const t = useTranslate()
  return (
    <details className="group text-sm">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-muted-foreground [&::-webkit-details-marker]:hidden">
        <i aria-hidden="true" className="i-lucide-light:chevron-right shrink-0 group-open:rotate-90" />
        {t('workflowTransfer.workflowCount', { count: bundle.workflows.length })}
      </summary>
      <ul className="m-0 mt-2 max-h-40 list-none space-y-1 overflow-y-auto p-0 pl-5">
        {bundle.workflows.map(({ flowId, file }) => (
          <WorkflowListItem key={flowId} name={flowId == bundle.entryFlowId ? entryName : (file.name ?? t('workflowTransfer.unnamed'))} />
        ))}
      </ul>
    </details>
  )
}

function ExportDialog({
  preview,
  workspace,
  container,
}: {
  readonly preview: WorkflowExportPreview
  readonly workspace: WorkspaceStore
  readonly container: HTMLElement | null
}) {
  const t = useTranslate()
  const id = useId()
  const [includeDependencies, setIncludeDependencies] = useState(true)
  const workflows = includeDependencies ? preview.workflows : preview.workflows.filter((item) => item.flowId == preview.entryFlowId)
  const missing = includeDependencies ? preview.unavailableFlowIds.length : 0
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) workspace.closeExport()
      }}
    >
      <DialogContent container={container} showCloseButton={false} className="max-h-[calc(100dvh-2rem)] grid-rows-[auto_auto_minmax(0,1fr)_auto]">
        <DialogHeader>
          <DialogTitle>{t('resource.exportFlow')}</DialogTitle>
        </DialogHeader>
        <Field orientation="horizontal">
          <Checkbox id={id} checked={includeDependencies} onCheckedChange={setIncludeDependencies} />
          <FieldLabel htmlFor={id}>{t('workflowTransfer.includeDependencies')}</FieldLabel>
        </Field>
        <div className="min-h-0 overflow-y-auto">
          <p className="m-0 mb-2 text-xs text-muted-foreground">{t('workflowTransfer.workflowCount', { count: workflows.length + missing })}</p>
          <ul className="m-0 list-none space-y-2 p-0">
            {workflows.map(({ flowId, file }) => (
              <WorkflowListItem key={flowId} name={file.name ?? t('workflowTransfer.unnamed')} />
            ))}
          </ul>
          {missing > 0 && (
            <p role="alert" className="m-0 mt-2 text-sm text-destructive">
              {t('workflowTransfer.unavailable', { count: missing })}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => workspace.closeExport()}>
            {t('common.cancel')}
          </Button>
          <Button disabled={missing > 0} onClick={() => workspace.completeExport(includeDependencies)}>
            {t('workflowTransfer.export')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function WorkflowExportDialog({ workspace, container }: { readonly workspace: WorkspaceStore; readonly container: HTMLElement | null }) {
  const preview = useVal(workspace.exportPreview)
  return preview == null ? null : <ExportDialog key={preview.entryFlowId} preview={preview} workspace={workspace} container={container} />
}
