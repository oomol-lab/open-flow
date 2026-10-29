import type { Run, RunDetails } from '../api.ts'

import { useContext } from 'react'
import { useTranslate } from 'val-i18n-react'
import { WorkbenchLinkContext } from '../linkContext.ts'
import { runLabel } from './runPresentation.ts'

export function WorkflowCalls({ run }: { readonly run: Run | RunDetails }) {
  const t = useTranslate()
  const hrefFor = useContext(WorkbenchLinkContext)
  if (!('waits' in run)) return null
  const link = (flowId: string, runId: string, label: string) =>
    hrefFor == null ? (
      <span>
        {label}: {runId}
      </span>
    ) : (
      <a className="text-foreground underline underline-offset-2 hover:text-muted-foreground" href={hrefFor({ flowId, runId, view: 'runs' })}>
        {label}
      </a>
    )
  return (
    <div className="flex flex-col gap-2 px-4 py-2 text-sm">
      {run.caller != null && (
        <div>
          {link(run.caller.flowId, run.caller.runId, t('workflow.parent'))} · {run.caller.nodeId}
        </div>
      )}
      {run.calls?.map((call) => (
        <div key={call.runId} className="flex flex-wrap items-center gap-2">
          <span>
            {call.nodeId} → {call.flowId}
            {call.callId == null ? null : <span className="ml-2 text-xs text-muted-foreground">{call.callId}</span>}
          </span>
          <span className="text-muted-foreground">{call.status == null ? t('workflow.unavailable') : runLabel({ status: call.status }, t)}</span>
          {link(call.flowId, call.runId, t('workflow.viewRun'))}
        </div>
      ))}
    </div>
  )
}
