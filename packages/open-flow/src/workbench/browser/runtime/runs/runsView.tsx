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
import { Popover, PopoverPanelContent, PopoverTrigger } from '../../../../ui/browser/popover.tsx'
import { ScrollArea } from '../../../../ui/browser/scroll-area.tsx'
import { Tabs, TabsList, TabsTrigger } from '../../../../ui/browser/tabs.tsx'
import { Icon } from '../icons.tsx'
import { IdTooltip } from '../shell/idTooltip.tsx'
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

function invalidFilterRange(draft: RunFilterDraft): boolean {
  return draft.createdFrom !== '' && draft.createdBefore !== '' && Date.parse(draft.createdFrom) >= Date.parse(draft.createdBefore)
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
  flowName,
  onClose,
  onConfigureConnector,
  onLocateEvent,
  onLocateWait,
  store,
}: {
  readonly flowName: string
  readonly onClose: () => void
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
  const runsByDate = new Map<string, Run[]>()
  for (const candidate of runs) {
    const date = new Date(candidate.createdAt).toDateString()
    const group = runsByDate.get(date)
    if (group == null) runsByDate.set(date, [candidate])
    else group.push(candidate)
  }
  const observationFailed = useVal(store.runs.$.observationFailed)
  const revision = useVal(store.workspace.$.revision)
  const root = useRef<HTMLElement>(null)
  const filterId = useId()
  const filterErrorId = `${filterId}-error`
  const selectedRun = useRef<HTMLButtonElement | null>(null)
  const [narrow, setNarrow] = useState(false)
  const [narrowDetailOpen, setNarrowDetailOpen] = useState(false)
  const [tab, setTab] = useState<'output' | 'timeline'>('output')
  const [raw, setRaw] = useState(false)
  const [filters, setFilters] = useState(() => initialRunLogFilters(eventFilter))
  const [filterOpen, setFilterOpen] = useState(false)
  const [filterContainer, setFilterContainer] = useState<HTMLElement | null>(null)
  const [filterForm, setFilterForm] = useState(() => filterDraft(filter))
  const filterTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const filterActive = hasRunFilter(filter)
  const filterCount = Object.values(filter).filter((value) => value != null).length
  const filterLabel = filterActive ? t('run.filterRunsActive', { count: filterCount }) : t('run.filterRuns')
  const invalidRange = invalidFilterRange(filterForm)
  const filterField = <Key extends keyof RunFilterDraft>(key: Key, value: RunFilterDraft[Key]): void => {
    const next = { ...filterForm, [key]: value }
    setFilterForm(next)
    clearTimeout(filterTimer.current)
    filterTimer.current = undefined
    if (
      (next.createdFrom !== '' && !Number.isFinite(Date.parse(next.createdFrom))) ||
      (next.createdBefore !== '' && !Number.isFinite(Date.parse(next.createdBefore))) ||
      invalidFilterRange(next)
    )
      return
    const apply = (): void => {
      filterTimer.current = undefined
      const runId = next.runId.trim()
      void store.runs.applyFilter({
        ...(next.status == '' ? {} : { status: next.status }),
        ...(next.source == '' ? {} : { source: next.source }),
        ...(next.pendingWait ? { pendingWait: true } : {}),
        ...(next.createdFrom == '' ? {} : { createdFrom: new Date(next.createdFrom).toISOString() }),
        ...(next.createdBefore == '' ? {} : { createdBefore: new Date(next.createdBefore).toISOString() }),
        ...(runId == '' ? {} : { runId }),
      })
    }
    if (key === 'runId') filterTimer.current = setTimeout(apply, 300)
    else apply()
  }
  const clearFilter = (): void => {
    clearTimeout(filterTimer.current)
    filterTimer.current = undefined
    setFilterForm(emptyFilterDraft)
    void store.runs.applyFilter({})
  }
  useEffect(() => () => clearTimeout(filterTimer.current), [])

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
      <Button className="absolute right-3 top-3" aria-label={t('common.close')} onClick={onClose} size="icon-sm" variant="ghost">
        <Icon name="close" />
      </Button>
      <aside aria-busy={loading || refreshing} className="run-list-panel">
        <header className="run-list-header">
          <h2 className="m-0 min-w-0 text-base leading-6 font-semibold">{t('run.history')}</h2>
          <div className="col-start-1 row-start-2 flex min-w-0 items-center gap-1.5 text-xs leading-4 text-muted-foreground" title={flowName}>
            <i aria-hidden="true" className="i-lucide-light:workflow size-3.5 shrink-0" />
            <span className="truncate">{flowName}</span>
          </div>
          <div className="col-start-2 row-start-1 flex items-center gap-1">
            <Popover
              onOpenChange={(open) => {
                if (open && filterTimer.current == null) setFilterForm(filterDraft(filter))
                setFilterOpen(open)
              }}
              open={filterOpen}
            >
              <PopoverTrigger
                render={
                  <Button
                    aria-label={filterLabel}
                    aria-pressed={filterActive}
                    size={filterActive ? 'sm' : 'icon-sm'}
                    title={filterLabel}
                    type="button"
                    variant={filterActive ? 'secondary' : 'ghost'}
                  />
                }
              >
                <i aria-hidden="true" className="i-lucide-light:funnel size-4" />
                {filterActive && (
                  <span aria-hidden="true" className="tabular-nums">
                    {filterCount}
                  </span>
                )}
              </PopoverTrigger>
              <PopoverPanelContent
                title={t('run.filterRuns')}
                closeLabel={t('common.close')}
                collisionBoundary={root.current ?? []}
                side="bottom"
                align="end"
                sideOffset={4}
                className="open-flow-property-panel bg-popover"
                container={root.current}
                initialFocus
              >
                <div ref={setFilterContainer} className="flex flex-col gap-3">
                  <Field>
                    <FieldLabel className="text-xs" htmlFor={`${filterId}-status`}>
                      {t('run.filterStatus')}
                    </FieldLabel>
                    <WorkbenchSelect
                      ariaLabel={t('run.filterStatus')}
                      className="w-full text-xs"
                      size="field"
                      id={`${filterId}-status`}
                      onValueChange={(value) => filterField('status', value as RunFilterDraft['status'])}
                      options={statusOptions}
                      portalRoot={filterContainer}
                      value={filterForm.status}
                    />
                  </Field>
                  <Field>
                    <FieldLabel className="text-xs" htmlFor={`${filterId}-source`}>
                      {t('run.filterSource')}
                    </FieldLabel>
                    <WorkbenchSelect
                      ariaLabel={t('run.filterSource')}
                      className="w-full text-xs"
                      size="field"
                      id={`${filterId}-source`}
                      onValueChange={(value) => filterField('source', value as RunFilterDraft['source'])}
                      options={sourceOptions}
                      portalRoot={filterContainer}
                      value={filterForm.source}
                    />
                  </Field>
                  <Field orientation="horizontal">
                    <Checkbox
                      checked={filterForm.pendingWait}
                      id={`${filterId}-pending-wait`}
                      onCheckedChange={(checked) => filterField('pendingWait', checked === true)}
                    />
                    <FieldLabel className="text-xs" htmlFor={`${filterId}-pending-wait`}>
                      {t('run.filterPendingWait')}
                    </FieldLabel>
                  </Field>
                  <Field data-invalid={invalidRange || undefined}>
                    <FieldLabel className="text-xs" htmlFor={`${filterId}-created-from`}>
                      {t('run.filterCreatedFrom')}
                    </FieldLabel>
                    <Input
                      controlSize="field"
                      aria-describedby={invalidRange ? filterErrorId : undefined}
                      aria-invalid={invalidRange || undefined}
                      id={`${filterId}-created-from`}
                      onChange={(event) => filterField('createdFrom', event.target.value)}
                      type="datetime-local"
                      value={filterForm.createdFrom}
                    />
                  </Field>
                  <Field data-invalid={invalidRange || undefined}>
                    <FieldLabel className="text-xs" htmlFor={`${filterId}-created-before`}>
                      {t('run.filterCreatedBefore')}
                    </FieldLabel>
                    <Input
                      controlSize="field"
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
                    <FieldLabel className="text-xs" htmlFor={`${filterId}-run-id`}>
                      {t('run.filterRunId')}
                    </FieldLabel>
                    <Input
                      controlSize="field"
                      id={`${filterId}-run-id`}
                      onChange={(event) => filterField('runId', event.target.value)}
                      placeholder={t('run.filterRunIdPlaceholder')}
                      value={filterForm.runId}
                    />
                  </Field>
                  <div className="flex justify-end gap-2 border-t border-border/50 pt-3">
                    <Button onClick={clearFilter} size="sm" type="button" variant="ghost">
                      {t('run.filterClear')}
                    </Button>
                  </div>
                </div>
              </PopoverPanelContent>
            </Popover>
          </div>
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
                <Button onClick={clearFilter} size="sm" variant="outline">
                  {t('run.filterClear')}
                </Button>
              )}
            </Empty>
          ) : (
            Array.from(runsByDate, ([date, dateRuns]) => (
              <section key={date} className="mb-3 last:mb-0">
                <h3 className="sticky top-0 z-10 m-0 bg-card px-2.5 py-2 text-xs font-medium text-muted-foreground">
                  <time dateTime={dateRuns[0]!.createdAt}>
                    {new Date(dateRuns[0]!.createdAt).toLocaleDateString(language, { year: 'numeric', month: 'long', day: 'numeric' })}
                  </time>
                </h3>
                {dateRuns.map((candidate) => (
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
                    <span className="flex min-w-0 items-center justify-between gap-2">
                      <span className="truncate text-xs font-medium">{runLabel(candidate, t)}</span>
                      <span className="run-list-meta shrink-0">{duration(candidate)}</span>
                    </span>
                    <span className="run-list-meta col-start-2 flex min-w-0 items-center justify-between gap-2">
                      <span className="truncate" title={`${new Date(candidate.createdAt).toLocaleString(language)} · ${sourceLabel(candidate, t)}`}>
                        <time dateTime={candidate.createdAt}>
                          {new Date(candidate.createdAt).toLocaleTimeString(language, { hour: '2-digit', minute: '2-digit' })}
                        </time>
                        {' · '}
                        {sourceLabel(candidate, t)}
                      </span>
                      <code className="shrink-0" title={candidate.runId}>
                        <span aria-hidden="true">{shortRunId(candidate.runId)}</span>
                        <span className="sr-only">{candidate.runId}</span>
                      </code>
                    </span>
                  </Button>
                ))}
              </section>
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
                <div className="run-detail-summary">
                  {narrow && (
                    <div className="flex min-w-0 items-center gap-2">
                      <Button aria-label={t('run.history')} onClick={closeNarrowDetail} size="icon-sm" variant="ghost">
                        <i aria-hidden="true" className="i-lucide-light:list size-4" />
                      </Button>
                      <span className="truncate text-xs text-muted-foreground" title={flowName}>
                        {flowName}
                      </span>
                    </div>
                  )}
                  <div className="flex min-h-7 flex-wrap items-center gap-2">
                    <span className={`status-dot ${statusClass(run)}`} />
                    <strong>{runLabel(run, t)}</strong>
                    <Badge variant="secondary">{sourceLabel(run, t)}</Badge>
                  </div>
                </div>
                <div className="run-detail-actions pr-9">
                  <RunLogButton events={events} eventsExpiresAt={eventsExpiresAt} historyComplete={historyComplete} run={run} />
                  {canCancelRun(run) && (
                    <Button disabled={cancelingRunId != null} onClick={() => void store.runs.cancel()} size="sm" variant="destructive">
                      {t(cancelingRunId == run.runId ? 'run.canceling' : 'run.cancel')}
                    </Button>
                  )}
                </div>
                <div className="run-detail-meta">
                  <time dateTime={run.createdAt}>
                    {new Date(run.createdAt).toLocaleString(language, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </time>
                  <span>
                    {t('run.duration')}: {duration(run)}
                  </span>
                  <IdTooltip
                    key={run.runId}
                    value={run.runId}
                    label={t('run.runId', { id: shortRunId(run.runId) })}
                    trigger={<span className="cursor-help text-xs" tabIndex={0} />}
                    container={root.current}
                  >
                    {triggerRun != null && (
                      <>
                        <span className="break-all">
                          {t('run.triggerNode')}: {triggerName ?? triggerRun.triggerNodeId}
                        </span>
                        <span className="break-all">
                          {t('run.triggerOccurrence')}: {triggerRun.occurrenceId}
                        </span>
                        <span className="break-all">
                          {t('run.triggerPublication')}: {triggerRun.publicationId}
                        </span>
                      </>
                    )}
                  </IdTooltip>
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
                    <TabsTrigger aria-controls="run-history-output-panel" id="run-history-output-tab" value="output">
                      {t('run.output')}
                    </TabsTrigger>
                    <TabsTrigger aria-controls="run-history-timeline-panel" id="run-history-timeline-tab" value="timeline">
                      {t('run.timeline')}
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
                {tab == 'timeline' && (
                  <div className="run-toolbar-actions">
                    <Tabs
                      value={raw ? 'events' : 'steps'}
                      onValueChange={(value) => {
                        if (value != null) setRaw(value === 'events')
                      }}
                    >
                      <TabsList aria-label={t('run.timelineView')} variant="flat" size="sm">
                        <TabsTrigger value="steps" title={t('run.stepsViewHint')} aria-controls="run-history-timeline-panel">
                          {t('run.stepsView')}
                        </TabsTrigger>
                        <TabsTrigger value="events" title={t('run.eventsViewHint')} aria-controls="run-history-timeline-panel">
                          {t('run.eventsView')}
                        </TabsTrigger>
                      </TabsList>
                    </Tabs>
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
