import type { RunDetails, RunEvent } from '../../src/control/common/api.ts'
import type { UiLanguage } from '../../src/localization/common/languages.ts'
import type { FrontendStory, LogAction } from './stories.tsx'

import { useEffect, useState } from 'react'
import { I18nProvider } from 'val-i18n-react'
import { WorkbenchClient } from '../../src/workbench/browser/runtime/api.ts'
import { createI18n } from '../../src/workbench/browser/runtime/i18n.ts'
import { RunDrawer } from '../../src/workbench/browser/runtime/runs/runDrawer.tsx'
import { RunsView } from '../../src/workbench/browser/runtime/runs/runsView.tsx'
import { WorkbenchStore } from '../../src/workbench/browser/runtime/stores/workbenchStore.ts'
import { useStoryActions } from './storyActions.tsx'

const waits: RunDetails['waits'] = [
  {
    waitId: 'release',
    nodeId: 'release',
    actions: ['approve', 'reject'],
    prompt: 'Approve the release?',
    waitingSince: '2026-09-15T08:00:00Z',
    expiresAt: '2026-09-22T08:00:00Z',
  },
  {
    waitId: 'review',
    nodeId: 'review',
    actions: ['continue'],
    prompt: 'Continue after reviewing the report.',
    waitingSince: '2026-09-15T08:00:00Z',
    expiresAt: '2026-09-22T08:00:00Z',
  },
]
const base: RunDetails = {
  version: 1,
  runId: 'sample',
  flowId: 'flow',
  revisionId: 'revision',
  source: 'draft',
  status: 'running',
  createdAt: '2026-09-15T08:00:00Z',
  startedAt: '2026-09-15T08:00:00Z',
  closureDigest: 'lab',
  engineContract: 'open-flow-engine/v5',
  engineDigest: 'lab',
  modelVersion: 2,
  revisionDigest: 'lab',
  waits,
}

function WaitHistory({ language, log }: { readonly language: UiLanguage; readonly log: LogAction }) {
  const [store, setStore] = useState<WorkbenchStore>()
  useEffect(() => {
    let run: RunDetails = { ...base, status: 'waiting' }
    const client = new WorkbenchClient(async (path, init) => {
      const url = new URL(String(path), 'https://lab.invalid')
      if (url.pathname == '/v1/flows/flow/runs') {
        const status = url.searchParams.get('status')
        const source = url.searchParams.get('source')
        const runId = url.searchParams.get('runId')
        const createdFrom = url.searchParams.get('createdFrom')
        const createdBefore = url.searchParams.get('createdBefore')
        const pendingWait = url.searchParams.get('pendingWait')
        const hasPendingWait = run.waits.length > 0
        const visible =
          (status == null || status == run.status) &&
          (source == null || source == run.source) &&
          (runId == null || runId == run.runId) &&
          (createdFrom == null || Date.parse(run.createdAt) >= Date.parse(createdFrom)) &&
          (createdBefore == null || Date.parse(run.createdAt) < Date.parse(createdBefore)) &&
          (pendingWait == null || (pendingWait == 'true') == hasPendingWait)
        return Response.json({ flowId: run.flowId, runs: visible ? [run] : [], version: 1 })
      }
      if (url.pathname == '/v1/runs/sample') return Response.json(run)
      if (url.pathname == '/v1/runs/sample/events')
        return Response.json({ runId: run.runId, events: [], done: true, historyComplete: true, nextAfter: 0, version: 1 })
      if (url.pathname.endsWith('/resolve')) {
        const waitId = url.pathname.split('/').at(-2)!
        const { action } = JSON.parse(String(init?.body))
        log('history.wait.resolve', { waitId, action })
        await new Promise((resolve) => setTimeout(resolve, 500))
        run = { ...run, status: 'running', waits: run.waits.filter((wait) => wait.waitId != waitId) }
        return Response.json({ runId: run.runId, waitId, action, status: run.status, resolutionAccepted: true, resolvedAt: base.createdAt, version: 1 })
      }
      throw new Error(`Unexpected Lab request: ${path}`)
    })
    const next = new WorkbenchStore(client, { getItem: () => null, setItem: () => {} }, undefined, createI18n(language))
    setStore(next)
    void next.runs.load('flow')
    return () => next.dispose()
  }, [language, log])
  return (
    <section className="min-w-0 xl:col-span-2">
      <h3 className="mb-2 font-medium">Run history · resolve waits without opening the canvas</h3>
      <div className="open-flow-workbench grid" style={{ height: 560 }}>
        {store != null && <RunsView store={store} onLocateEvent={() => {}} onLocateWait={(nodeId) => log('history.wait.locate', nodeId)} />}
      </div>
    </section>
  )
}

function WaitRuns({ language, log }: { readonly language: UiLanguage; readonly log: LogAction }) {
  const [pending, setPending] = useState(waits)
  const [generation, setGeneration] = useState(0)
  useStoryActions([
    {
      label: 'Reset approvals',
      onClick: () => {
        setPending(waits)
        setGeneration((value) => value + 1)
      },
    },
  ])
  const states = [
    { title: 'Notification running · independent approvals', run: { ...base, waits: pending }, events: [] as RunEvent[] },
    { title: 'Frozen · all waits remain actionable', run: { ...base, status: 'waiting' as const }, events: [] as RunEvent[] },
    {
      title: 'Ordinary notification failure',
      run: { ...base, status: 'failed' as const, waits: [] },
      events: [
        {
          kind: 'node.failed',
          sequence: 1,
          createdAt: base.createdAt,
          payload: {
            executionId: 'send',
            scopeId: 'sample',
            flowId: 'flow',
            nodeId: 'send',
            error: { code: 'node.failed', message: 'Notification delivery failed.' },
          },
        },
      ] as RunEvent[],
    },
  ]
  return (
    <I18nProvider i18n={createI18n(language)}>
      <div className="grid gap-4 p-4 xl:grid-cols-2">
        <WaitHistory key={generation} language={language} log={log} />
        {states.map(({ title, run, events }, index) => (
          <section key={title} className="min-w-0">
            <h3 className="mb-2 font-medium">{title}</h3>
            <div className="open-flow-workbench" style={{ height: 360 }}>
              <RunDrawer
                cancelDisabled={false}
                canceling={false}
                events={events}
                eventsExpiresAt={undefined}
                eventFilter="all"
                eventNodes={new Map()}
                historyComplete
                onCancel={() => log('run.cancel', run.runId)}
                onClose={() => {}}
                onEventFilterChange={() => {}}
                onLocateEvent={() => {}}
                onLocateWait={(nodeId) => log('run.locate', nodeId)}
                onResolve={(waitId, action) => {
                  log('wait.resolve', { waitId, action })
                  if (index == 0) setPending((items) => items.filter((item) => item.waitId != waitId))
                }}
                onRetryObservation={() => {}}
                onToggle={() => {}}
                open
                observationFailed={false}
                result={undefined}
                resolvingActions={new Map()}
                run={run}
                submitting={false}
                visible
              />
            </div>
          </section>
        ))}
      </div>
    </I18nProvider>
  )
}

export const waitRunsStory: FrontendStory = {
  group: 'Node Wait',
  id: 'wait-runs',
  title: 'Run decisions',
  standalone: true,
  description: 'Approve either wait independently while the notification branch continues. Frozen waits and ordinary notification failure are shown alongside.',
  render: (log, _dark, language) => <WaitRuns language={language} log={log} />,
}
