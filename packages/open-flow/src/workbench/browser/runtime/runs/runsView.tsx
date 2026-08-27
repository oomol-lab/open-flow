import type { ReactElement } from 'react'
import type { TFunction } from 'val-i18n'
import type { Run, TriggerRun } from '../api.ts'
import type { WorkbenchStore } from '../stores/workbenchStore.ts'

import { useEffect, useRef, useState } from 'react'
import { useVal } from 'use-value-enhancer'
import { useLang, useTranslate } from 'val-i18n-react'
import { Badge } from '../../../../ui/browser/badge.tsx'
import { Button } from '../../../../ui/browser/button.tsx'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '../../../../ui/browser/empty.tsx'
import { Tabs, TabsList, TabsTrigger } from '../../../../ui/browser/tabs.tsx'
import { Icon } from '../icons.tsx'
import { duration, RunDetails, RunEventFilters, RunLogButton, runLabel, statusClass } from './runDrawer.tsx'
import { canCancelRun } from './runStore.ts'

function sourceLabel(run: Run, t: TFunction): string {
  switch (run.source) {
    case 'draft':
      return t('run.sourceDraft')
    case 'live':
      return t('run.sourceLive')
    case 'trigger':
      return t('run.sourceTrigger')
  }
}

function shortRunId(runId: string): string {
  return runId.slice(-8)
}

export function RunsView({ onLocateEvent, store }: { readonly onLocateEvent: (sequence: number) => void; readonly store: WorkbenchStore }): ReactElement {
  const language = useLang()
  const t = useTranslate()
  const eventFilter = useVal(store.runs.$.eventFilter)
  const eventNodes = useVal(store.$.runEventNodes)
  const cancelingRunId = useVal(store.runs.$.cancelingRunId)
  const events = useVal(store.runs.$.events)
  const eventsExpiresAt = useVal(store.runs.$.eventsExpiresAt)
  const historyComplete = useVal(store.runs.$.historyComplete)
  const loadFailed = useVal(store.runs.$.loadFailed)
  const loading = useVal(store.runs.$.loading)
  const loadMoreFailed = useVal(store.runs.$.loadMoreFailed)
  const loadingMore = useVal(store.runs.$.loadingMore)
  const nextCursor = useVal(store.runs.$.nextCursor)
  const result = useVal(store.runs.$.result)
  const run = useVal(store.runs.$.run)
  const runs = useVal(store.runs.$.runs)
  const observationFailed = useVal(store.runs.$.observationFailed)
  const revision = useVal(store.workspace.$.revision)
  const root = useRef<HTMLElement>(null)
  const selectedRun = useRef<HTMLButtonElement | null>(null)
  const [narrow, setNarrow] = useState(false)
  const [narrowDetailOpen, setNarrowDetailOpen] = useState(false)
  const [tab, setTab] = useState<'output' | 'timeline'>('timeline')
  const triggerRun = run?.source == 'trigger' && 'triggerNodeId' in run ? (run as TriggerRun) : undefined
  const triggerName =
    triggerRun != null && revision?.revision.revisionId == triggerRun.revisionId ? revision.trigger(triggerRun.triggerNodeId)?.name : undefined

  useEffect(() => {
    const element = root.current
    if (element == null || typeof ResizeObserver == 'undefined') return
    const observer = new ResizeObserver(([entry]) => setNarrow(entry != null && entry.contentRect.width <= 720))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (run == null) setNarrowDetailOpen(false)
  }, [run])

  const closeNarrowDetail = (): void => {
    setNarrowDetailOpen(false)
    requestAnimationFrame(() => selectedRun.current?.focus({ preventScroll: true }))
  }

  return (
    <section
      aria-labelledby="workspace-tab-runs"
      className={`runs-view${narrow ? ' narrow' : ''}${narrowDetailOpen ? ' narrow-detail-open' : ''}`}
      id="workspace-panel-runs"
      ref={root}
      role="tabpanel"
      tabIndex={0}
    >
      <aside className="run-list-panel">
        <header className="run-list-header">
          <strong>{t('run.history')}</strong>
        </header>
        <div className="run-list">
          {loading ? (
            <div className="run-list-empty">{t('run.loading')}</div>
          ) : loadFailed ? (
            <div className="run-list-empty" role="alert">
              <strong>{t('run.historyLoadFailed')}</strong>
              <Button onClick={() => void store.runs.retryLoad()} size="sm" variant="outline">
                {t('empty.retry')}
              </Button>
            </div>
          ) : runs.length == 0 ? (
            <Empty className="h-full">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Icon name="play" />
                </EmptyMedia>
                <EmptyTitle>{t('run.historyEmpty')}</EmptyTitle>
                <EmptyDescription>{t('run.historyEmptyDescription')}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            runs.map((candidate) => (
              <Button
                aria-current={candidate.runId == run?.runId ? 'true' : undefined}
                className="run-list-item"
                key={candidate.runId}
                onClick={(event) => {
                  selectedRun.current = event.currentTarget
                  store.runs.select(candidate.runId)
                  if (narrow) setNarrowDetailOpen(true)
                }}
                type="button"
                variant="ghost"
              >
                <span className={`status-dot ${statusClass(candidate)}`} />
                <span className="run-list-copy">
                  <code className="run-list-id" title={candidate.runId}>
                    <span aria-hidden="true">{shortRunId(candidate.runId)}</span>
                    <span className="sr-only">{candidate.runId}</span>
                  </code>
                  <span className="run-list-meta">
                    {runLabel(candidate, t)} · {sourceLabel(candidate, t)}
                  </span>
                </span>
                <span className="run-list-time">
                  <time dateTime={candidate.createdAt}>{new Date(candidate.createdAt).toLocaleString(language)}</time>
                  <span>{duration(candidate)}</span>
                </span>
              </Button>
            ))
          )}
        </div>
        {nextCursor != null && (
          <Button className="mx-2 mb-2" disabled={loadingMore} onClick={() => void store.runs.loadMore()} size="lg" variant="outline">
            {t(loadingMore ? 'run.loadingMore' : loadMoreFailed ? 'run.retryLoadMore' : 'run.loadMore')}
          </Button>
        )}
      </aside>
      <section className="run-detail-panel">
        {run == null ? (
          <div className="run-detail-empty">{t('run.selectRun')}</div>
        ) : (
          <>
            <header className="run-detail-header">
              {narrow && (
                <Button onClick={closeNarrowDetail} size="sm" variant="ghost">
                  <Icon name="chevron-left" /> {t('run.history')}
                </Button>
              )}
              <div>
                <span className={`status-dot ${statusClass(run)}`} />
                <strong>{runLabel(run, t)}</strong>
                <Badge variant="secondary">{sourceLabel(run, t)}</Badge>
              </div>
              <div className="run-detail-actions">
                <div className="run-detail-meta">
                  <span>
                    {t('run.duration')}: {duration(run)}
                  </span>
                  <time dateTime={run.createdAt}>{new Date(run.createdAt).toLocaleString(language)}</time>
                  {triggerRun != null && (
                    <>
                      <span title={triggerRun.triggerNodeId}>
                        {t('run.triggerNode')}: {triggerName ?? triggerRun.triggerNodeId}
                      </span>
                      <span title={triggerRun.occurrenceId}>
                        {t('run.triggerOccurrence')}: {triggerRun.occurrenceId}
                      </span>
                      <span title={triggerRun.publicationId}>
                        {t('run.triggerPublication')}: {triggerRun.publicationId}
                      </span>
                    </>
                  )}
                  <code>{run.runId}</code>
                </div>
                <RunLogButton events={events} eventsExpiresAt={eventsExpiresAt} historyComplete={historyComplete} run={run} />
                {canCancelRun(run) && (
                  <Button disabled={cancelingRunId != null} onClick={() => void store.runs.cancel()} size="sm" variant="destructive">
                    {t(cancelingRunId == run.runId ? 'run.canceling' : 'run.cancel')}
                  </Button>
                )}
              </div>
            </header>
            <div className="run-history-content">
              <div className="run-toolbar">
                <Tabs className="run-tabs-root" onValueChange={(value) => value != null && setTab(value as 'output' | 'timeline')} value={tab}>
                  <TabsList aria-label={t('run.detailViews')} variant="line">
                    <TabsTrigger aria-controls="run-history-timeline-panel" id="run-history-timeline-tab" value="timeline">
                      {t('run.timeline')}
                    </TabsTrigger>
                    <TabsTrigger aria-controls="run-history-output-panel" id="run-history-output-tab" value="output">
                      {t('run.output')}
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
                {tab == 'timeline' && <RunEventFilters events={events} filter={eventFilter} onChange={(filter) => store.runs.setEventFilter(filter)} />}
              </div>
              <RunDetails
                events={events}
                eventsExpiresAt={eventsExpiresAt}
                eventFilter={eventFilter}
                eventNodes={eventNodes}
                historyComplete={historyComplete}
                observationFailed={observationFailed}
                onLocateEvent={onLocateEvent}
                onRetryObservation={() => store.runs.retryObservation()}
                panelId={`run-history-${tab}-panel`}
                result={result}
                run={run}
                submitting={false}
                tab={tab}
                tabId={`run-history-${tab}-tab`}
              />
            </div>
          </>
        )}
      </section>
    </section>
  )
}
