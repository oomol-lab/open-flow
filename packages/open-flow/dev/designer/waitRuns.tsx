import type { RunDetails, RunEvent } from '../../src/control/common/api.ts'
import type { UiLanguage } from '../../src/localization/common/languages.ts'
import type { FrontendStory, LogAction } from './stories.tsx'

import { currentFlowModelVersion } from '@oomol-lab/open-flow/flow-change'
import { ReactFlowProvider } from '@xyflow/react'
import { useEffect, useId, useState } from 'react'
import { I18nProvider } from 'val-i18n-react'
import { CanvasBottomRightControls } from '../../src/canvas/browser/graph/ReactFlowContainer/CanvasControls.tsx'
import { normalizeWaitComment } from '../../src/execution/common/wait.ts'
import { WorkbenchClient } from '../../src/workbench/browser/runtime/api.ts'
import { createI18n } from '../../src/workbench/browser/runtime/i18n.ts'
import { RunDrawer } from '../../src/workbench/browser/runtime/runs/runDrawer.tsx'
import { RunStatusIsland } from '../../src/workbench/browser/runtime/runs/runStatusIsland.tsx'
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
  modelVersion: currentFlowModelVersion,
  sharedAccessDigest: 'implicit:lab',
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
        const { action, comment } = JSON.parse(String(init?.body))
        log('history.wait.resolve', { waitId, action, comment })
        await new Promise((resolve) => setTimeout(resolve, 500))
        run = { ...run, status: 'running', waits: run.waits.filter((wait) => wait.waitId != waitId) }
        return Response.json({
          runId: run.runId,
          waitId,
          action,
          comment: normalizeWaitComment(comment),
          status: run.status,
          resolutionAccepted: true,
          resolvedAt: base.createdAt,
          version: 1,
        })
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
        {store != null && (
          <RunsView
            flowName="Release approval"
            onClose={() => log('history.close')}
            store={store}
            onLocateEvent={() => {}}
            onLocateWait={(nodeId) => log('history.wait.locate', nodeId)}
          />
        )}
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
                onResolve={(waitId, action, comment) => {
                  log('wait.resolve', { waitId, action, comment })
                  if (index == 0) setPending((items) => items.filter((item) => item.waitId != waitId))
                }}
                onRetryObservation={() => {}}
                open
                observationFailed={false}
                result={undefined}
                resolvingActions={new Map()}
                run={run}
                submitting={false}
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
  description:
    'Add separate optional comments and resolve either wait while the notification branch continues. Frozen waits and ordinary notification failure are shown alongside.',
  render: (log, _dark, language) => <WaitRuns language={language} log={log} />,
}

function RunStatusSample({
  title,
  run,
  submitting,
  dark,
}: {
  readonly title: string
  readonly run?: RunDetails
  readonly submitting: boolean
  readonly dark: boolean
}) {
  const [open, setOpen] = useState(false)
  const panelId = useId()
  return (
    <section className="min-w-0">
      <h3 className="mb-2 font-medium">{title}</h3>
      <div className="open-flow-workbench open-flow-theme grid grid-rows-[minmax(0,1fr)_auto]" data-theme={dark ? 'dark' : 'light'} style={{ height: 640 }}>
        <div className="run-control-story-stage">
          <ReactFlowProvider>
            <CanvasBottomRightControls>
              <RunStatusIsland onToggle={() => setOpen((value) => !value)} open={open} panelId={panelId} run={run} submitting={submitting} />
            </CanvasBottomRightControls>
          </ReactFlowProvider>
        </div>
        <RunDrawer
          cancelDisabled={false}
          canceling={false}
          events={[]}
          eventsExpiresAt={undefined}
          eventFilter="all"
          eventNodes={new Map()}
          historyComplete
          onCancel={() => {}}
          onClose={() => setOpen(false)}
          onEventFilterChange={() => {}}
          onLocateEvent={() => {}}
          onLocateWait={() => {}}
          onResolve={() => {}}
          onRetryObservation={() => {}}
          panelId={panelId}
          observationFailed={false}
          open={open}
          result={undefined}
          resolvingActions={new Map()}
          run={run}
          submitting={submitting}
        />
      </div>
    </section>
  )
}

export const runStatusIslandStory: FrontendStory = {
  group: 'Workbench',
  id: 'run-status-island',
  title: 'Run status island',
  standalone: true,
  description: 'Compare the empty, running, succeeded, and failed controls. Open and close each real run log panel from its canvas corner.',
  render: (_log, dark, language) => (
    <I18nProvider i18n={createI18n(language)}>
      <div className="grid gap-4 p-4 xl:grid-cols-2">
        <RunStatusSample dark={dark} title="No run" submitting={false} />
        <RunStatusSample dark={dark} title="Submitting" submitting />
        <RunStatusSample dark={dark} title="Succeeded" run={{ ...base, status: 'completed', waits: [] }} submitting={false} />
        <RunStatusSample dark={dark} title="Failed" run={{ ...base, status: 'failed', waits: [] }} submitting={false} />
      </div>
    </I18nProvider>
  ),
}

function RunHistory({ language, dark, log }: { readonly language: UiLanguage; readonly dark: boolean; readonly log: LogAction }) {
  const [store, setStore] = useState<WorkbenchStore>()
  const [open, setOpen] = useState(true)
  useStoryActions([{ label: 'Open run history', disabled: open, onClick: () => setOpen(true) }])
  useEffect(() => {
    const samples = [
      { status: 'completed', duration: 2350 },
      { status: 'failed', duration: 192_000 },
      { status: 'running' },
      { status: 'canceled', duration: 3_720_000 },
      { status: 'completed', duration: 93_600_000 },
      { status: 'completed', duration: 128 },
    ] as const
    const runs: RunDetails[] = Array.from(samples, (sample, index) => {
      const startedAt = `2026-09-${24 - Math.floor(index / 2)}T08:0${6 - index}:00Z`
      return {
        ...base,
        runId: `65fbbd9e-395a-4b4d-a002-635058e2589${index}`,
        status: sample.status,
        waits: [],
        createdAt: startedAt,
        startedAt,
        ...('duration' in sample ? { finishedAt: new Date(Date.parse(startedAt) + sample.duration).toISOString() } : {}),
      }
    })
    const client = new WorkbenchClient(async (path) => {
      const url = new URL(String(path), 'https://lab.invalid')
      if (url.pathname == '/v1/flows/flow/runs') {
        return Response.json({
          version: 1,
          flowId: 'flow',
          runs: runs.filter(
            (run) =>
              ['status', 'source', 'runId'].every(
                (key) => !url.searchParams.has(key) || url.searchParams.get(key) == run[key as 'status' | 'source' | 'runId'],
              ) &&
              (!url.searchParams.has('pendingWait') || url.searchParams.get('pendingWait') == 'false') &&
              (!url.searchParams.has('createdFrom') || run.createdAt >= url.searchParams.get('createdFrom')!) &&
              (!url.searchParams.has('createdBefore') || run.createdAt < url.searchParams.get('createdBefore')!),
          ),
        })
      }
      const run = runs.find((item) => url.pathname.includes(item.runId))!
      if (url.pathname.endsWith('/cancel')) {
        const canceled: RunDetails = { ...run, status: 'canceled', finishedAt: new Date(Date.parse(run.createdAt) + 3000).toISOString() }
        runs[runs.indexOf(run)] = canceled
        return Response.json(canceled)
      }
      if (url.pathname.endsWith('/events')) {
        const payload = { executionId: 'task', scopeId: 'sample', flowId: 'flow', nodeId: 'report' }
        const events: RunEvent[] = [{ kind: 'node.started', sequence: 1, createdAt: run.createdAt, payload }]
        if (run.status == 'completed')
          events.push({ kind: 'node.completed', sequence: 2, createdAt: run.finishedAt!, payload: { ...payload, outputs: { rows: 128 } } })
        if (run.status == 'failed')
          events.push({
            kind: 'node.failed',
            sequence: 2,
            createdAt: run.finishedAt!,
            payload: { ...payload, error: { code: 'binding.unresolved', message: 'Variable API_TOKEN could not be resolved.' } },
          })
        return Response.json({ runId: run.runId, events, done: true, historyComplete: true, nextAfter: events.length, version: 1 })
      }
      if (url.pathname.endsWith('/result'))
        return Response.json({
          runId: run.runId,
          version: 1,
          status: run.status,
          finishedAt: run.finishedAt,
          ...(run.status == 'completed'
            ? { result: { report: 'September sales', rows: 128, delivered: true } }
            : run.status == 'failed'
              ? { error: { code: 'binding.unresolved', message: 'Variable API_TOKEN could not be resolved.' } }
              : {}),
        })
      return Response.json(run)
    })
    const next = new WorkbenchStore(client, { getItem: () => null, setItem: () => {} }, undefined, createI18n(language))
    setStore(next)
    void next.runs.load('flow')
    return () => next.dispose()
  }, [language])
  return (
    <I18nProvider i18n={createI18n(language)}>
      <div className="open-flow-workbench open-flow-theme grid h-full min-h-0" data-theme={dark ? 'dark' : 'light'}>
        {store != null && open && (
          <RunsView
            flowName="Monthly sales report"
            onClose={() => {
              setOpen(false)
              log('history.close')
            }}
            store={store}
            onLocateEvent={(sequence) => log('history.locate', sequence)}
            onLocateWait={() => {}}
          />
        )}
      </div>
    </I18nProvider>
  )
}

export const runHistoryStory: FrontendStory = {
  group: 'Workbench',
  id: 'run-history',
  title: 'Run history',
  standalone: true,
  description:
    'Inspect results, failures, timeline, full run IDs and filters. Close and reopen the page, or narrow the viewport to switch between list and detail.',
  render: (log, dark, language) => <RunHistory language={language} dark={dark} log={log} />,
}
