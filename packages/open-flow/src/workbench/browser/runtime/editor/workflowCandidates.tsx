import type { ReactNode } from 'react'
import type { WorkflowCandidate } from '../../../../workflow/common/workflow.ts'

import { useTranslate } from 'val-i18n-react'
import { selectionMenuItemClass } from '../../../../form/browser/selectionMenuStyles.ts'
import { workflowCandidateGroup } from '../../../../workflow/common/workflow.ts'

export const workflowCandidateItemClass = `flex w-full cursor-default items-center gap-2 pr-2 pl-6 text-left hover:bg-accent data-highlighted:bg-accent ${selectionMenuItemClass}`

export function WorkflowCandidateStatusDot({ group }: { readonly group: ReturnType<typeof workflowCandidateGroup> }) {
  return <span aria-hidden="true" className={`status-dot ${group == 'published' ? 'success' : group == 'missingStart' ? 'warning' : 'neutral'}`} />
}

export function WorkflowCandidateGroup({
  group,
  empty,
  children,
}: {
  readonly group: ReturnType<typeof workflowCandidateGroup>
  readonly empty?: string
  readonly children: ReactNode
}) {
  const t = useTranslate()
  return (
    <>
      <div className="flex items-center gap-2 px-2 py-1 text-xs text-muted-foreground">
        <WorkflowCandidateStatusDot group={group} />
        {t(`workflow.groups.${group}`)}
      </div>
      <div>
        {empty && <div className={`pr-2 pl-6 text-muted-foreground ${selectionMenuItemClass}`}>{empty}</div>}
        {children}
      </div>
    </>
  )
}

export function WorkflowCandidateName({ item }: { readonly item: WorkflowCandidate }) {
  return (
    <>
      <i aria-hidden="true" className="i-lucide-light:workflow shrink-0 text-sm" />
      <span className="min-w-0 flex-1 truncate">{item.name}</span>
    </>
  )
}
