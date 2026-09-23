import type { ReactElement } from 'react'
import type { TFunction } from 'val-i18n'
import type { Run, RunStatus, TriggerRun } from '../api.ts'
import type { WorkbenchStore } from '../stores/workbenchStore.ts'
import type { RunFilter } from './runStore.ts'

import { useEffect, useId, useRef, useState } from 'react'
import { useVal } from 'use-value-enhancer'
import { useLang, useTranslate } from 'val-i18n-react'
import { Badge } from '../../../../ui/browser/badge.tsx'
import { Button } from '../../../../ui/browser/button.tsx'
import { Checkbox } from '../../../../ui/browser/checkbox.tsx'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '../../../../ui/browser/empty.tsx'
import { Field, FieldError, FieldLabel } from '../../../../ui/browser/field.tsx'
import { Input } from '../../../../ui/browser/input.tsx'
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '../../../../ui/browser/popover.tsx'
import { ScrollArea } from '../../../../ui/browser/scroll-area.tsx'
import { Tabs, TabsList, TabsTrigger } from '../../../../ui/browser/tabs.tsx'
import { Icon } from '../icons.tsx'
import { WorkbenchSelect } from '../shell/workbenchSelect.tsx'
import { ActiveWait, initialRunLogFilters, RunLog, RunLogButton, RunLogFilters } from './runDrawer.tsx'
import { RunResultView } from './runOutput.tsx'
import { duration, runLabel, statusClass } from './runPresentation.ts'
import { canCancelRun, hasRunFilter } from './runStore.ts'

interface RunFilterDraft {
  readonly createdBefore: string
  readonly createdFrom: string
  readonly pendingWait: boolean
  readonly runId: string
  readonly source: Run['source'] | ''
  readonly status: RunStatus | ''
}

const emptyFilterDraft: RunFilterDraft = { createdBefore: '', createdFrom: '', pendingWait: false, runId: '', source: '', status: '' }

function localDateTime(value: string | undefined): string {
  if (value == null) return ''
  const date = new Date(value)
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}

function filterDraft(filter: RunFilter): RunFilterDraft {
  return {
    createdBefore: localDateTime(filter.createdBefore),
    createdFrom: localDateTime(filter.createdFrom),
    pendingWait: filter.pendingWait === true,
    runId: filter.runId ?? '',
    source: filter.source ?? '',
    status: filter.status ?? '',
  }
}

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

export function RunsView({
  onConfigureConnector,
  onLocateEvent,
  onLocateWait,
  store,
}: {
  readonly onConfigureConnector?: (() => void) | undefined
  readonly onLocateEvent: (sequence: number) => void
  readonly onLocateWait: (nodeId: string) => void
  readonly store: WorkbenchStore
}): ReactElement {
  const language = useLang()
  const t = useTranslate()
  const eventFilter = useVal(store.runs.$.eventFilter)
  const eventNodes = useVal(store.$.runEventNodes)
  const cancelingRunId = useVal(store.runs.$.cancelingRunId)
  const events = useVal(store.runs.$.events)
  const eventsExpiresAt = useVal(store.runs.$.eventsExpiresAt)
  const filter = useVal(store.runs.$.filter)
  const historyComplete = useVal(store.runs.$.historyComplete)
  const loadFailed = useVal(store.runs.$.loadFailed)
  const loading = useVal(store.runs.$.loading)
  const loadMoreFailed = useVal(store.runs.$.loadMoreFailed)
  const loadingMore = useVal(store.runs.$.loadingMore)
  const nextCursor = useVal(store.runs.$.nextCursor)
  const result = useVal(store.runs.$.result)
  const refreshing = useVal(store.runs.$.refreshing)
  const run = useVal(store.runs.$.run)
  const resolvingActions = useVal(store.runs.$.resolvingActions)
  const runs = useVal(store.runs.$.runs)
  const observationFailed = useVal(store.runs.$.observationFailed)
  const revision = useVal(store.workspace.$.revision)
  const root = useRef<HTMLElement>(null)
  const filterId = useId()
  const filterErrorId = `${filterId}-error`
  const selectedRun = useRef<HTMLButtonElement | null>(null)
  const [narrow, setNarrow] = useState(false)
  const [narrowDetailOpen, setNarrowDetailOpen] = useState(false)
  const [tab, setTab] = useState<'output' | 'timeline'>('timeline')
  const [raw, setRaw] = useState(false)
  const [filters, setFilters] = useState(() => initialRunLogFilters(eventFilter))
  const [filterOpen, setFilterOpen] = useState(false)
  const [filterForm, setFilterForm] = useState(() => filterDraft(filter))
  const filterActive = hasRunFilter(filter)
  const invalidRange =
    filterForm.createdFrom.length > 0 && filterForm.createdBefore.length > 0 && Date.parse(filterForm.createdFrom) >= Date.parse(filterForm.createdBefore)
  const filterField = <Key extends keyof RunFilterDraft>(key: Key, value: RunFilterDraft[Key]): void => {
    setFilterForm((current) => ({ ...current, [key]: value }))
  }
  const statusOptions = [
    { label: t('run.filterAllStatuses'), value: '' },
    { label: t('run.statusQueued'), value: 'queued' },
    { label: t('run.statusStarting'), value: 'starting' },
    { label: t('run.statusRunning'), value: 'running' },
    { label: t('run.statusWaiting'), value: 'waiting' },
    { label: t('run.statusSucceeded'), value: 'completed' },
    { label: t('run.statusFailed'), value: 'failed' },
    { label: t('run.statusCanceled'), value: 'canceled' },
    { label: t('run.statusIndeterminate'), value: 'indeterminate' },
  ]
  const sourceOptions = [
    { label: t('run.filterAllSources'), value: '' },
    { label: t('run.sourceDraft'), value: 'draft' },
    { label: t('run.sourceLive'), value: 'live' },
    { label: t('run.sourceTrigger'), value: 'trigger' },
  ]
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
      aria-label={t('workspace.runs')}
      className={`runs-view${narrow ? ' narrow' : ''}${narrowDetailOpen ? ' narrow-detail-open' : ''}`}
      id="workspace-panel-runs"
      ref={root}
      role="region"
      tabIndex={0}
    >
      <aside aria-busy={loading || refreshing} className="run-list-panel">
        <header className="run-list-header">
          <strong>{t('run.history')}</strong>
          <Popover
            onOpenChange={(open) => {
              if (open) setFilterForm(filterDraft(filter))
              setFilterOpen(open)
            }}
            open={filterOpen}
          >
            <PopoverTrigger
              render={
                <Button
                  aria-label={t('run.filterRuns')}
                  aria-pressed={filterActive}
                  size="icon-sm"
                  title={t('run.filterRuns')}
                  type="button"
                  variant={filterActive ? 'secondary' : 'ghost'}
                />
              }
            >
              <i aria-hidden="true" className="i-lucide-light:funnel size-4" />
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 max-w-[calc(100vw-24px)]" container={root.current} initialFocus>
              <PopoverTitle>{t('run.filterRuns')}</PopoverTitle>
              <form
                className="flex flex-col gap-3"
                onSubmit={(event) => {
                  event.preventDefault()
                  if (invalidRange) return
                  const runId = filterForm.runId.trim()
                  void store.runs.applyFilter({
                    ...(filterForm.status == '' ? {} : { status: filterForm.status }),
                    ...(filterForm.source == '' ? {} : { source: filterForm.source }),
                    ...(filterForm.pendingWait ? { pendingWait: true } : {}),
                    ...(filterForm.createdFrom == '' ? {} : { createdFrom: new Date(filterForm.createdFrom).toISOString() }),
                    ...(filterForm.createdBefore == '' ? {} : { createdBefore: new Date(filterForm.createdBefore).toISOString() }),
                    ...(runId == '' ? {} : { runId }),
                  })
                  setFilterOpen(false)
                }}
              >
                <Field>
                  <FieldLabel htmlFor={`${filterId}-status`}>{t('run.filterStatus')}</FieldLabel>
                  <WorkbenchSelect
                    ariaLabel={t('run.filterStatus')}
                    className="w-full"
                    id={`${filterId}-status`}
                    onValueChange={(value) => filterField('status', value as RunFilterDraft['status'])}
                    options={statusOptions}
                    portalRoot={root.current}
                    value={filterForm.status}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor={`${filterId}-source`}>{t('run.filterSource')}</FieldLabel>
                  <WorkbenchSelect
                    ariaLabel={t('run.filterSource')}
                    className="w-full"
                    id={`${filterId}-source`}
                    onValueChange={(value) => filterField('source', value as RunFilterDraft['source'])}
                    options={sourceOptions}
                    portalRoot={root.current}
                    value={filterForm.source}
                  />
                </Field>
                <Field orientation="horizontal">
                  <Checkbox
                    checked={filterForm.pendingWait}
                    id={`${filterId}-pending-wait`}
                    onCheckedChange={(checked) => filterField('pendingWait', checked === true)}
                  />
                  <FieldLabel htmlFor={`${filterId}-pending-wait`}>{t('run.filterPendingWait')}</FieldLabel>
                </Field>
                <Field data-invalid={invalidRange || undefined}>
                  <FieldLabel htmlFor={`${filterId}-created-from`}>{t('run.filterCreatedFrom')}</FieldLabel>
                  <Input
                    aria-describedby={invalidRange ? filterErrorId : undefined}
                    aria-invalid={invalidRange || undefined}
                    id={`${filterId}-created-from`}
                    onChange={(event) => filterField('createdFrom', event.target.value)}
                    type="datetime-local"
                    value={filterForm.createdFrom}
                  />
                </Field>
                <Field data-invalid={invalidRange || undefined}>
                  <FieldLabel htmlFor={`${filterId}-created-before`}>{t('run.filterCreatedBefore')}</FieldLabel>
                  <Input
                    aria-describedby={invalidRange ? filterErrorId : undefined}
                    aria-invalid={invalidRange || undefined}
                    id={`${filterId}-created-before`}
                    onChange={(event) => filterField('createdBefore', event.target.value)}
                    type="datetime-local"
                    value={filterForm.createdBefore}
                  />
                  {invalidRange && <FieldError id={filterErrorId}>{t('run.filterInvalidRange')}</FieldError>}
                </Field>
                <Field>
                  <FieldLabel htmlFor={`${filterId}-run-id`}>{t('run.filterRunId')}</FieldLabel>
                  <Input
                    id={`${filterId}-run-id`}
                    onChange={(event) => filterField('runId', event.target.value)}
                    placeholder={t('run.filterRunIdPlaceholder')}
                    value={filterForm.runId}
                  />
                </Field>
                <div className="flex justify-end gap-2 border-t border-border/50 pt-3">
                  <Button
                    onClick={() => {
                      setFilterForm(emptyFilterDraft)
                      void store.runs.applyFilter({})
                      setFilterOpen(false)
                    }}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    {t('run.filterClear')}
                  </Button>
                  <Button disabled={invalidRange} size="sm" type="submit">
                    {t('run.filterApply')}
                  </Button>
                </div>
              </form>
            </PopoverContent>
          </Popover>
        </header>
        <ScrollArea className="run-list run-content-scroll" defer={false} tabIndex={-1}>
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
                <EmptyTitle>{t(filterActive ? 'run.filterEmpty' : 'run.historyEmpty')}</EmptyTitle>
                <EmptyDescription>{t(filterActive ? 'run.filterEmptyDescription' : 'run.historyEmptyDescription')}</EmptyDescription>
              </EmptyHeader>
              {filterActive && (
                <Button onClick={() => void store.runs.applyFilter({})} size="sm" variant="outline">
                  {t('run.filterClear')}
                </Button>
              )}
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
        </ScrollArea>
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
            <div>
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
              <ActiveWait
                onLocate={onLocateWait}
                onResolve={(waitId, action, comment) => void store.runs.resolve(waitId, action, comment)}
                resolvingActions={resolvingActions}
                run={run}
              />
            </div>
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
                {tab == 'timeline' && (
                  <div className="run-toolbar-actions">
                    <Button aria-pressed={raw} onClick={() => setRaw(!raw)} size="sm" variant="ghost">
                      {t(raw ? 'run.groupedView' : 'run.rawView')}
                    </Button>
                    <RunLogFilters
                      container={root.current}
                      events={events}
                      filters={filters}
                      onChange={(next) => {
                        setFilters(next)
                        store.runs.setEventFilter(next.length == 1 ? next[0]! : 'all')
                      }}
                    />
                  </div>
                )}
              </div>
              {tab == 'timeline' ? (
                <div aria-labelledby="run-history-timeline-tab" className="run-tab-panel" id="run-history-timeline-panel" role="tabpanel" tabIndex={0}>
                  <RunLog
                    raw={raw}
                    events={events}
                    eventsExpiresAt={eventsExpiresAt}
                    eventNodes={eventNodes}
                    filters={filters}
                    historyComplete={historyComplete}
                    observationFailed={observationFailed}
                    onConfigureConnector={onConfigureConnector}
                    onLocateEvent={onLocateEvent}
                    onRetryObservation={() => store.runs.retryObservation()}
                    result={result}
                    run={run}
                    submitting={false}
                  />
                </div>
              ) : (
                <div aria-labelledby="run-history-output-tab" className="run-tab-panel" id="run-history-output-panel" role="tabpanel" tabIndex={0}>
                  {observationFailed && (
                    <div className="run-observation-error" role="alert">
                      <span>{t('run.observationFailed')}</span>
                      <Button onClick={() => store.runs.retryObservation()} size="sm" type="button" variant="secondary">
                        {t('empty.retry')}
                      </Button>
                    </div>
                  )}
                  {result == null ? (
                    <div className="run-empty">{t('run.outputPending')}</div>
                  ) : (
                    <ScrollArea className="run-output-scroll run-content-scroll" defer={false} tabIndex={-1}>
                      <RunResultView result={result} />
                    </ScrollArea>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </section>
    </section>
  )
}
