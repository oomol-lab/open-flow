import type { ComponentProps, KeyboardEvent, PointerEvent, ReactElement } from 'react'
import type { TFunction } from 'val-i18n'
import type { VListHandle, CustomItemComponentProps } from 'virtua'
import type { Run, RunDetails, RunEvent, RunResult, WaitAction } from '../api.ts'
import type { RunResultsClient } from './runResults.tsx'
import type { RunEventFilter } from './runStore.ts'

import { forwardRef, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useLang, useTranslate } from 'val-i18n-react'
import { waitCommentSchema } from '../../../../execution/common/wait.ts'
import { Alert, AlertDescription, AlertTitle } from '../../../../ui/browser/alert.tsx'
import { Button } from '../../../../ui/browser/button.tsx'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuTrigger,
} from '../../../../ui/browser/dropdown-menu.tsx'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '../../../../ui/browser/empty.tsx'
import { Field, FieldLabel, FieldError } from '../../../../ui/browser/field.tsx'
import { ScrollArea, VirtualScrollArea } from '../../../../ui/browser/scroll-area.tsx'
import { Tabs, TabsList, TabsTrigger } from '../../../../ui/browser/tabs.tsx'
import { Textarea } from '../../../../ui/browser/textarea.tsx'
import { Tooltip, TooltipContent, TooltipTrigger } from '../../../../ui/browser/tooltip.tsx'
import { Icon } from '../icons.tsx'
import { ErrorHandling } from './errorHandling.tsx'
import { continuesLog, executionKey, executionOverview, agentSummary, eventSubject, savedToolResults } from './runGroups.ts'
import { downloadRunLog } from './runLogExport.ts'
import { eventHasDetails, RunEventDetail, RunResultContent, RunText } from './runOutput.tsx'
import { duration } from './runPresentation.ts'
import { RunResults } from './runResults.tsx'
import { canCancelRun } from './runStore.ts'

const RunVirtualItem = forwardRef<HTMLDivElement, CustomItemComponentProps>(function RunVirtualItem({ index, ...props }, ref) {
  return <div {...props} role="listitem" aria-posinset={index + 1} ref={ref} />
})

export function RunTooltipButton({ 'aria-label': label, ...props }: ComponentProps<typeof Button> & { readonly 'aria-label': string }): ReactElement {
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null)
  return (
    <Tooltip>
      <TooltipTrigger ref={setAnchor} render={<Button {...props} aria-label={label} />} />
      <TooltipContent container={anchor?.closest<HTMLElement>('.open-flow-workbench')}>{label}</TooltipContent>
    </Tooltip>
  )
}

function eventTime(createdAt: string, language: string): string {
  return new Intl.DateTimeFormat(language, { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(createdAt))
}

const minHeight = 160
const maxHeight = 640
const minCanvasHeight = 160
const defaultHeight = 360
const resizeStep = 24
const eventFollowThreshold = 32

interface Props {
  readonly resultClient?: RunResultsClient | undefined
  readonly cancelDisabled: boolean
  readonly canceling: boolean
  readonly events: readonly RunEvent[]
  readonly eventsExpiresAt: string | undefined
  readonly eventFilter: RunEventFilter
  readonly eventNodes: ReadonlyMap<number, string>
  readonly historyComplete: boolean
  readonly onCancel: () => void
  readonly onClose: () => void
  readonly onOpenRuns: () => void
  readonly onConfigureConnector?: (() => void) | undefined
  readonly onEventFilterChange: (filter: RunEventFilter) => void
  readonly onLocateEvent: (sequence: number) => void
  readonly onLocateWait: (nodeId: string) => void
  readonly onResolve: (waitId: string, action: WaitAction, comment?: string) => void
  readonly onRetryObservation: () => void
  readonly panelId?: string
  readonly open: boolean
  readonly observationFailed: boolean
  readonly result: RunResult | undefined
  readonly resolvingActions: ReadonlyMap<string, WaitAction>
  readonly run: Run | RunDetails | undefined
  readonly submitting: boolean
}

type EventObservation = 'expired' | 'truncated'
type EventCategory = Exclude<RunEventFilter, 'all'>

const eventCategories: readonly EventCategory[] = ['lifecycle', 'progress', 'log', 'output', 'artifact']

function waitActionLabel(action: WaitAction, t: TFunction): string {
  switch (action) {
    case 'approve':
      return t('run.actionApprove')
    case 'continue':
      return t('run.actionContinue')
    case 'reject':
      return t('run.actionReject')
  }
}

type ActiveWaitProps = {
  readonly onLocate: (nodeId: string) => void
  readonly onResolve: (waitId: string, action: WaitAction, comment?: string) => void
  readonly resolvingActions: ReadonlyMap<string, WaitAction>
  readonly run: Run | RunDetails
}

function WaitDecision({
  waiting,
  onLocate,
  onResolve,
  resolvingActions,
}: Omit<ActiveWaitProps, 'run'> & { readonly waiting: RunDetails['waits'][number] }): ReactElement {
  const language = useLang()
  const t = useTranslate()
  const [comment, setComment] = useState('')
  const commentId = useId()
  const resolving = resolvingActions.has(waiting.waitId)
  const tooLong = !waitCommentSchema.safeParse(comment).success
  return (
    <div className="shrink-0 px-2 pt-2">
      <Alert>
        <Icon name="wait" />
        <AlertTitle>{waiting.prompt}</AlertTitle>
        <AlertDescription>
          <div>{t('run.waitExpires', { date: new Date(waiting.expiresAt).toLocaleString(language) })}</div>
          <Field className="mt-2">
            <FieldLabel htmlFor={commentId}>{t('run.waitComment')}</FieldLabel>
            <Textarea
              id={commentId}
              rows={2}
              value={comment}
              disabled={resolving}
              aria-invalid={tooLong}
              onChange={(event) => setComment(event.target.value)}
            />
            {tooLong && <FieldError>{t('run.waitCommentTooLong')}</FieldError>}
          </Field>
          <div className="mt-2 flex flex-wrap gap-2">
            {waiting.actions.map((action) => (
              <Button
                disabled={resolving || tooLong}
                key={action}
                onClick={() => onResolve(waiting.waitId, action, comment)}
                size="sm"
                type="button"
                variant={action == 'reject' ? 'destructive' : 'default'}
              >
                {resolvingActions.get(waiting.waitId) == action ? t('run.resolving') : waitActionLabel(action, t)}
              </Button>
            ))}
            <Button onClick={() => onLocate(waiting.nodeId)} size="sm" type="button" variant="secondary">
              <Icon name="fit" /> {t('run.locateWait')}
            </Button>
          </div>
        </AlertDescription>
      </Alert>
    </div>
  )
}

export function ActiveWait({ run, ...props }: ActiveWaitProps): ReactElement {
  const waits = 'waits' in run ? run.waits : []
  return (
    <>
      {waits.map((waiting) => (
        <WaitDecision key={`${run.runId}/${waiting.waitId}`} waiting={waiting} {...props} />
      ))}
    </>
  )
}

function eventObservation(events: readonly RunEvent[], historyComplete: boolean): EventObservation | undefined {
  if (!historyComplete) return 'expired'
  return events.some((event) => event.kind == 'run.events-truncated') ? 'truncated' : undefined
}

function eventCategory(event: RunEvent): EventCategory {
  switch (event.kind) {
    case 'node.progress':
    case 'run.progress':
      return 'progress'
    case 'node.log':
      return 'log'
    case 'node.artifact':
      return 'artifact'
    case 'node.completed':
    case 'node.failed':
    case 'node.started':
    case 'run.canceled':
    case 'run.completed':
    case 'run.events-truncated':
    case 'run.failed':
    case 'run.indeterminate':
    case 'run.queued':
    case 'run.resolved':
    case 'run.started':
    case 'wait.created':
    case 'run.waiting':
      return 'lifecycle'
  }
}

function filterEventsBy(events: readonly RunEvent[], filters: readonly RunEventFilter[]): readonly RunEvent[] {
  return events.filter(
    (event) =>
      filters.includes(eventCategory(event)) ||
      (filters.includes('output') && (event.kind == 'node.completed' || event.kind == 'run.completed') && eventHasDetails(event)),
  )
}

export function initialRunLogFilters(filter: RunEventFilter): readonly RunEventFilter[] {
  return filter == 'all' ? eventCategories.filter((candidate) => candidate != 'progress') : [filter]
}

export function RunLogFilters({
  container,
  events,
  presentation,
  onChange,
}: {
  readonly container: HTMLElement | null
  readonly events: readonly RunEvent[]
  readonly presentation: LogPresentation
  readonly onChange: (filters: readonly RunEventFilter[]) => void
}): ReactElement | null {
  const t = useTranslate()
  const { view, filters, statusFilter, setStatusFilter } = presentation
  const label = t(view == 'overview' ? 'run.executionStatus' : 'run.filterEvents')
  if (events.length == 0) return null
  const counts = new Map<EventCategory, number>()
  for (const event of events) {
    const category = eventCategory(event)
    counts.set(category, (counts.get(category) ?? 0) + 1)
    if ((event.kind == 'node.completed' || event.kind == 'run.completed') && eventHasDetails(event)) counts.set('output', (counts.get('output') ?? 0) + 1)
  }
  return (
    <DropdownMenu>
      <Tooltip>
        <DropdownMenuTrigger
          render={
            <Button render={<TooltipTrigger />} aria-label={label} size="icon-sm" type="button" variant="ghost">
              <i aria-hidden="true" className="i-lucide-light:funnel size-4" />
            </Button>
          }
        />
        <TooltipContent container={container}>{label}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="run-log-filter" container={container} side="bottom">
        {view == 'overview' ? (
          <DropdownMenuRadioGroup value={statusFilter} onValueChange={setStatusFilter}>
            {['all', 'running', 'waiting', 'completed', 'failed', 'unknown'].map((status) => (
              <DropdownMenuRadioItem key={status} value={status}>
                {t(`run.executionStatusLabels.${status}`)}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        ) : (
          <DropdownMenuGroup>
            {eventCategories.map((filter) => (
              <DropdownMenuCheckboxItem
                checked={filters.includes(filter)}
                key={filter}
                onCheckedChange={(checked) => onChange(checked ? [...filters, filter] : filters.filter((candidate) => candidate != filter))}
              >
                <span>{t(`run.filter.${filter}`)}</span>
                <span className="run-log-filter-count">{counts.get(filter) ?? 0}</span>
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuGroup>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function RunLogButton({
  events,
  eventsExpiresAt,
  historyComplete,
  run,
}: {
  readonly events: readonly RunEvent[]
  readonly eventsExpiresAt: string | undefined
  readonly historyComplete: boolean
  readonly run: Run
}): ReactElement {
  const t = useTranslate()
  return (
    <RunTooltipButton
      aria-label={t('run.exportLog')}
      onClick={() => downloadRunLog(run, events, historyComplete, eventsExpiresAt)}
      size="icon-sm"
      type="button"
      variant="ghost"
    >
      <Icon name="download" />
    </RunTooltipButton>
  )
}

function eventIcon(event: RunEvent): string {
  switch (event.kind) {
    case 'node.started':
    case 'run.started':
    case 'run.resolved':
      return 'i-lucide-light:play'
    case 'node.completed':
    case 'run.completed':
      return 'i-lucide-light:check'
    case 'node.failed':
    case 'run.failed':
      return 'i-lucide-light:circle-x'
    case 'wait.created':
    case 'run.waiting':
      return 'i-lucide-light:pause'
    case 'node.progress':
    case 'run.progress':
      return 'i-lucide-light:loader-circle'
    case 'run.canceled':
      return 'i-lucide-light:ban'
    case 'run.queued':
    case 'run.indeterminate':
      return 'i-lucide-light:ellipsis'
    default:
      return 'i-lucide-light:text'
  }
}

function eventTone(event: RunEvent): string {
  if (event.kind.includes('failed') || event.kind == 'run.indeterminate') return 'danger'
  if (event.kind == 'node.completed' || event.kind == 'run.completed') return 'success'
  return 'neutral'
}

function eventSummary(event: RunEvent, t: TFunction): string {
  switch (event.kind) {
    case 'run.queued':
      return t('run.eventEnqueued')
    case 'run.resolved':
      return t('run.eventWaitResolved')
    case 'wait.created':
    case 'run.waiting':
      return t('run.statusWaiting')
    case 'run.started':
    case 'node.started':
      return t('run.eventStarted')
    case 'run.progress':
    case 'node.progress': {
      return t('run.eventProgress', { progress: Math.round(event.payload.progress) })
    }
    case 'node.artifact':
      return t('run.eventArtifact')
    case 'node.log':
      return t('run.nodeLog', { level: event.payload.level })
    case 'node.completed':
    case 'run.completed':
      return t('run.eventCompleted')
    case 'node.failed':
    case 'run.failed':
      return t('run.statusFailed')
    case 'run.indeterminate':
      return t('run.statusIndeterminate')
    case 'run.canceled':
      return t('run.statusCanceled')
    case 'run.events-truncated':
      return t('run.eventTruncated')
  }
}

function nodeTitleIndex(events: readonly RunEvent[]): ReadonlyMap<string, string> {
  const titles = new Map<string, string>()
  const ambiguous = new Set<string>()
  for (const event of events) {
    if (event.kind != 'node.started') continue
    const title = event.payload.nodeTitle
    if (typeof title != 'string') continue
    const executionId = event.payload.executionId
    const nodeId = event.payload.nodeId
    if (titles.has(nodeId) && titles.get(nodeId) != title) ambiguous.add(nodeId)
    titles.set(nodeId, title)
    titles.set(executionId, title)
    titles.set(JSON.stringify([event.payload.scopeId, nodeId]), title)
  }
  for (const nodeId of ambiguous) titles.delete(nodeId)
  return titles
}

export type RunLogView = 'timeline' | 'overview'

export function useRunLogPresentation(filter: RunEventFilter, runId: string | undefined) {
  const panelId = useId()
  const [view, setView] = useState<RunLogView>('timeline')
  const [statusFilter, setStatusFilter] = useState('all')
  const [filters, setFilters] = useState<readonly RunEventFilter[]>(() => initialRunLogFilters(filter))
  const [target, setTarget] = useState<{ runId: string | undefined; key: string; sequence: number }>()
  const focus = target?.runId == runId ? target : undefined
  useEffect(() => setTarget(undefined), [runId])
  function inspect(events: readonly RunEvent[]) {
    const first = events[0]!
    setFilters([...new Set([...initialRunLogFilters('all'), ...events.map(eventCategory)])])
    setTarget({ runId, key: executionKey(first)!, sequence: first.sequence })
    setView('timeline')
  }
  return { panelId, view, setView, statusFilter, setStatusFilter, filters, setFilters, focus, inspect, clearFocus: () => setTarget(undefined) }
}

type LogPresentation = ReturnType<typeof useRunLogPresentation>

export function RunLogClearHighlight({ presentation }: { readonly presentation: LogPresentation }): ReactElement | null {
  const t = useTranslate()
  if (presentation.view != 'timeline' || presentation.focus == null) return null
  return (
    <Button size="xs" variant="ghost" onClick={presentation.clearFocus}>
      {t('run.clearHighlight')}
    </Button>
  )
}

export function RunLogViewSwitch({ presentation }: { readonly presentation: LogPresentation }): ReactElement {
  const t = useTranslate()
  return (
    <Tabs
      value={presentation.view}
      onValueChange={(value) => {
        if (value == 'timeline' || value == 'overview') presentation.setView(value)
      }}
    >
      <TabsList aria-label={t('run.timelineView')} variant="flat" size="sm">
        <TabsTrigger aria-controls={presentation.panelId} value="timeline">
          {t('run.timeline')}
        </TabsTrigger>
        <TabsTrigger aria-controls={presentation.panelId} value="overview">
          {t('run.overview')}
        </TabsTrigger>
      </TabsList>
    </Tabs>
  )
}

export function RunLog({
  presentation,
  resultClient,
  events,
  eventsExpiresAt,
  eventNodes,
  historyComplete,
  observationFailed,
  onConfigureConnector,
  onLocateEvent,
  onRetryObservation,
  result,
  run,
  submitting,
}: Pick<
  Props,
  | 'resultClient'
  | 'events'
  | 'eventsExpiresAt'
  | 'eventNodes'
  | 'historyComplete'
  | 'observationFailed'
  | 'onConfigureConnector'
  | 'onLocateEvent'
  | 'onRetryObservation'
  | 'result'
  | 'run'
  | 'submitting'
> & {
  readonly presentation: LogPresentation
}): ReactElement {
  const language = useLang()
  const t = useTranslate()
  const virtualList = useRef<VListHandle>(null)
  const followedRun = useRef<string>()
  const followEvents = useRef(true)
  const manualScroll = useRef(false)
  const nodeTitles = useMemo(() => nodeTitleIndex(events), [events])
  const { view, filters, focus, statusFilter } = presentation
  const observation = eventObservation(events, historyComplete)
  const visibleEvents = useMemo(() => filterEventsBy(events, filters), [events, filters])
  const previousEvents = useMemo(() => new Map(events.map((event, index) => [event.sequence, events[index - 1]])), [events])
  const overview = useMemo(() => (view == 'overview' ? executionOverview(events, run?.status) : []), [events, run?.status, view])
  const executions = useMemo(() => overview.filter((item) => statusFilter == 'all' || item.status == statusFilter), [overview, statusFilter])
  const focusElement = useRef<HTMLDivElement>(null)
  const located = useRef<typeof focus>()
  const sources = useMemo(() => new Map(events.filter((event) => event.kind == 'run.started').map((event) => [event.payload.scopeId, event.payload])), [events])
  const lastEventSequence = events.at(-1)?.sequence
  const completedEvent = events.findLast((event) => event.kind == 'run.completed')
  const emptyTitle = t(run == null ? 'run.historyEmpty' : events.length == 0 ? 'run.eventsEmpty' : 'run.noFilteredEvents')
  const emptyMessage = submitting
    ? t('run.submitting')
    : run == null
      ? t('run.timelineEmpty')
      : events.length == 0 && result == null
        ? t('run.waiting')
        : (view == 'timeline' ? visibleEvents.length : executions.length) == 0 && result == null
          ? t('run.noFilteredEvents')
          : undefined
  const hasResult = (view == 'overview' && completedEvent != null) || (completedEvent == null && result != null)
  type Row =
    | { kind: 'event'; event: RunEvent; index: number }
    | { kind: 'execution'; group: (typeof executions)[number] }
    | { kind: 'notice' | 'result' | 'empty' }
  const rows = useMemo<Row[]>(
    () => [
      ...(observation != null ? [{ kind: 'notice' as const }] : []),
      ...(view == 'overview'
        ? executions.map((group) => ({ kind: 'execution' as const, group }))
        : visibleEvents.map((event, index) => ({ kind: 'event' as const, event, index }))),
      ...(hasResult ? [{ kind: 'result' as const }] : []),
      ...(emptyMessage != null ? [{ kind: 'empty' as const }] : []),
    ],
    [observation, view, executions, visibleEvents, hasResult, emptyMessage],
  )
  const focusIndex = focus == null ? -1 : rows.findIndex((row) => row.kind == 'event' && row.event.sequence == focus.sequence)

  useEffect(() => {
    if (focus == null || view == 'overview') located.current = undefined
    if (followedRun.current != run?.runId) {
      followedRun.current = run?.runId
      followEvents.current = true
    }
    if (view == 'timeline' && focus != null && located.current != focus && focusIndex >= 0) {
      located.current = focus
      manualScroll.current = false
      followEvents.current = false
      virtualList.current?.scrollToIndex(focusIndex, { align: 'start' })
      focusElement.current?.focus({ preventScroll: true })
      return
    }
    if (view == 'timeline' && followEvents.current && rows.length > 0) {
      virtualList.current?.scrollToIndex(rows.length - 1, { align: 'end' })
    }
  }, [filters, historyComplete, lastEventSequence, result, run?.runId, view, focus, focusIndex, rows.length])

  useEffect(() => {
    if (view == 'overview') virtualList.current?.scrollTo(0)
  }, [view, run?.runId, statusFilter])

  function beginManualScroll(): void {
    manualScroll.current = true
    followEvents.current = false
  }

  function renderRow(row: Row): ReactElement {
    if (row.kind == 'notice')
      return (
        <div aria-live="polite" className="run-log-notice">
          <Icon name="alert" size={14} />
          <span>
            {observation == 'expired'
              ? t('run.historyExpired')
              : eventsExpiresAt == null
                ? t('run.eventsTruncatedNotice')
                : t('run.eventsTruncatedUntil', { date: new Date(eventsExpiresAt).toLocaleString(language) })}
          </span>
        </div>
      )
    if (row.kind == 'execution') {
      const group = row.group
      const event = group.events[0]!
      const subject = eventSubject(group.started ?? event, t, nodeTitles)
      const source = sources.get(String(event.payload.scopeId))
      return (
        <div
          className={`run-log-event run-execution ${group.status == 'failed' ? 'danger' : group.status == 'completed' ? 'success' : 'neutral'}`}
          key={group.key}
        >
          <span className="run-log-icon">
            <i
              aria-hidden="true"
              className={
                group.status == 'completed'
                  ? 'i-lucide-light:check'
                  : group.status == 'failed'
                    ? 'i-lucide-light:circle-x'
                    : group.status == 'waiting'
                      ? 'i-lucide-light:pause'
                      : group.status == 'running'
                        ? 'i-lucide-light:loader-circle'
                        : 'i-lucide-light:ellipsis'
              }
            />
          </span>
          <div className="run-log-main">
            <div className="run-log-title">
              <strong>{subject}</strong>
              <span>{t(observation == null ? 'run.executionNumber' : 'run.recordedExecutionNumber', { count: group.count })}</span>
              <span>{t(`run.executionStatusLabels.${group.status}`)}</span>
              <span className="run-execution-time" title={`${group.started?.createdAt ?? '?'} → ${group.terminal?.createdAt ?? '?'}`}>
                {duration(
                  group.started == null || (group.terminal == null && group.status == 'unknown')
                    ? undefined
                    : { startedAt: group.started.createdAt, finishedAt: group.terminal?.createdAt },
                )}
              </span>
              <div className="run-log-actions">
                {eventNodes.has(event.sequence) && (
                  <RunTooltipButton
                    aria-label={t('run.locateNode', { name: subject })}
                    onClick={() => onLocateEvent(event.sequence)}
                    size="icon-xs"
                    variant="ghost"
                  >
                    <Icon name="fit" />
                  </RunTooltipButton>
                )}
                <RunTooltipButton size="icon-xs" variant="ghost" aria-label={t('run.inspectExecution')} onClick={() => presentation.inspect(group.events)}>
                  <i aria-hidden="true" className="i-lucide-light:list-ordered" />
                </RunTooltipButton>
              </div>
            </div>
            {(source?.parentScopeId != null || source == null) && (
              <p className="run-source" title={`${source?.parentScopeId ?? '?'} / ${event.payload.scopeId}`}>
                {String(event.payload.flowId)} · {String(event.payload.scopeId).slice(-8)}
              </p>
            )}
            {group.terminal != null ? (
              <RunEventDetail event={group.terminal} onConfigureConnector={onConfigureConnector} />
            ) : (
              group.latest != null && (
                <RunText
                  text={agentSummary(group.latest, t) ?? (group.latest.kind == 'node.log' ? group.latest.payload.message : eventSummary(group.latest, t))}
                />
              )
            )}
            {(group.completedCalls > 0 || group.toolResults.length > 0) && (
              <div className="flex flex-wrap items-center gap-1">
                {group.agent && group.completedCalls > 0 && <span className="run-source">{t('run.agentCompletedCalls', { count: group.completedCalls })}</span>}
                {resultClient != null && run != null && <RunResults key={run.runId} client={resultClient} runId={run.runId} results={group.toolResults} />}
              </div>
            )}
          </div>
        </div>
      )
    }
    if (row.kind == 'event') {
      const { event, index } = row
      const subject = eventSubject(event, t, nodeTitles)
      const continuation = continuesLog(event, visibleEvents[index - 1]) && previousEvents.get(event.sequence) == visibleEvents[index - 1]
      const highlighted = focus != null && executionKey(event) == focus.key
      return (
        <div
          className={`run-log-event ${eventTone(event)}${continuation ? ' is-continuation' : ''}${highlighted ? ' is-highlighted' : ''}`}
          key={event.sequence}
          ref={focus?.sequence == event.sequence ? focusElement : undefined}
          tabIndex={-1}
        >
          <time dateTime={event.createdAt} title={new Date(event.createdAt).toLocaleString(language)}>
            {eventTime(event.createdAt, language)}
          </time>
          <span className="run-log-icon" title={event.kind}>
            <i aria-hidden="true" className={eventIcon(event)} />
          </span>
          <div className="run-log-main">
            {!continuation && (
              <div className="run-log-title">
                <strong>{subject}</strong>
                <span>{agentSummary(event, t) ?? eventSummary(event, t)}</span>
                <div className="run-log-actions">
                  {resultClient != null && run != null && (
                    <RunResults key={run.runId} client={resultClient} runId={run.runId} results={savedToolResults([event])} />
                  )}
                  {eventNodes.has(event.sequence) && (
                    <RunTooltipButton
                      aria-label={t('run.locateNode', { name: subject })}
                      onClick={() => onLocateEvent(event.sequence)}
                      size="icon-xs"
                      variant="ghost"
                    >
                      <Icon name="fit" />
                    </RunTooltipButton>
                  )}
                </div>
              </div>
            )}
            <RunEventDetail event={event} onConfigureConnector={onConfigureConnector} />
          </div>
        </div>
      )
    }
    if (row.kind == 'result')
      return (
        <div
          className={`run-log-event run-log-result ${view == 'overview' ? 'run-execution' : ''} ${completedEvent != null || result?.status == 'completed' ? 'success' : result?.status == 'canceled' ? 'neutral' : 'danger'}`}
        >
          {view == 'timeline' && result != null && (
            <time dateTime={result.finishedAt} title={new Date(result.finishedAt).toLocaleString(language)}>
              {eventTime(result.finishedAt, language)}
            </time>
          )}
          <span className="run-log-icon">
            <i
              aria-hidden="true"
              className={
                completedEvent != null || result?.status == 'completed'
                  ? 'i-lucide-light:check'
                  : result?.status == 'canceled'
                    ? 'i-lucide-light:ban'
                    : 'i-lucide-light:circle-x'
              }
            />
          </span>
          <div className="run-log-main">
            <div className="run-log-title">
              <strong>{t('run.flowSubject')}</strong>
              <span>
                {t(
                  completedEvent != null || result?.status == 'completed'
                    ? 'run.eventCompleted'
                    : result?.status == 'canceled'
                      ? 'run.statusCanceled'
                      : result?.status == 'indeterminate'
                        ? 'run.statusIndeterminate'
                        : 'run.statusFailed',
                )}
              </span>
              {view == 'overview' && (
                <span className="run-execution-time" title={`${run?.startedAt ?? '?'} → ${completedEvent?.createdAt ?? result?.finishedAt ?? '?'}`}>
                  {duration({ startedAt: run?.startedAt, finishedAt: completedEvent?.createdAt ?? result?.finishedAt })}
                </span>
              )}
            </div>
            {completedEvent != null ? (
              <RunEventDetail event={completedEvent} />
            ) : result != null ? (
              <div className="event-detail">
                <strong>{t('run.terminalResult')}</strong>
                <RunResultContent result={result} />
              </div>
            ) : null}
          </div>
        </div>
      )
    return (
      <div className="run-log-empty" aria-live="polite">
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <i aria-hidden="true" className="i-lucide-light:workflow size-5" />
            </EmptyMedia>
            <EmptyTitle>{emptyTitle}</EmptyTitle>
            {emptyMessage != emptyTitle && <EmptyDescription>{emptyMessage}</EmptyDescription>}
          </EmptyHeader>
        </Empty>
      </div>
    )
  }

  return (
    <div className="run-log" id={presentation.panelId} role="tabpanel" aria-label={t(view == 'timeline' ? 'run.timeline' : 'run.overview')} tabIndex={0}>
      {observationFailed && (
        <div className="run-observation-error" role="alert">
          <span>{t('run.observationFailed')}</span>
          <Button onClick={onRetryObservation} size="sm" type="button" variant="secondary">
            {t('empty.retry')}
          </Button>
        </div>
      )}

      {emptyMessage != null && rows.every((row) => row.kind == 'empty' || row.kind == 'notice') ? (
        <ScrollArea className="run-log-scroll run-content-scroll">
          <ol className="run-log-list run-log-empty-list">
            {rows.map((row) => (
              <li key={row.kind} className={row.kind == 'empty' ? 'run-log-empty' : undefined}>
                {renderRow(row)}
              </li>
            ))}
          </ol>
        </ScrollArea>
      ) : (
        <VirtualScrollArea
          key={`${run?.runId ?? 'empty'}:${view}:${view == 'timeline' ? filters.join(',') : statusFilter}`}
          className="run-log-scroll run-content-scroll"
          listRef={virtualList}
          role="list"
          tabIndex={-1}
          data={rows}
          item={RunVirtualItem}
          // Client-only lists must measure immediately, even before they are large enough to scroll.
          ssrCount={typeof window == 'undefined' ? Math.min(20, rows.length) : undefined}
          keepMounted={focusIndex >= 0 ? [focusIndex] : []}
          onScrollIntent={beginManualScroll}
          onKeyDown={(event) => {
            if (event.target == event.currentTarget && (event.key == 'Home' || event.key == 'End') && rows.length > 0) {
              event.preventDefault()
              virtualList.current?.scrollToIndex(event.key == 'Home' ? 0 : rows.length - 1, { align: event.key == 'Home' ? 'start' : 'end' })
            }
          }}
          onScrollEnd={() => {
            const list = virtualList.current
            if (list != null && manualScroll.current) {
              followEvents.current = list.scrollSize - list.scrollOffset - list.viewportSize <= eventFollowThreshold
              manualScroll.current = false
            }
          }}
        >
          {renderRow}
        </VirtualScrollArea>
      )}
    </div>
  )
}

export function RunDrawer({
  resultClient,
  cancelDisabled,
  canceling,
  events,
  eventsExpiresAt,
  eventFilter,
  eventNodes,
  historyComplete,
  onCancel,
  onClose,
  onOpenRuns,
  onConfigureConnector,
  onEventFilterChange,
  onLocateEvent,
  onLocateWait,
  onResolve,
  onRetryObservation,
  panelId,
  observationFailed,
  open,
  result,
  resolvingActions,
  run,
  submitting,
}: Props): ReactElement | null {
  const t = useTranslate()
  const presentation = useRunLogPresentation(eventFilter, run?.runId)
  const drawer = useRef<HTMLElement>(null)
  const resize = useRef<{ height: number; pointerId: number; y: number }>()
  const [resized, setResized] = useState<{ height: number; runId: string | undefined }>()
  const preferredHeight = resized != null && resized.runId == run?.runId ? resized.height : undefined
  const height = preferredHeight ?? defaultHeight

  function availableHeight(): number {
    return Math.max(minHeight, Math.min(maxHeight, drawer.current!.parentElement!.clientHeight - minCanvasHeight))
  }

  function changeHeight(value: number): void {
    setResized({ height: Math.max(minHeight, Math.min(availableHeight(), value)), runId: run?.runId })
  }

  function startResize(event: PointerEvent<HTMLDivElement>): void {
    if (event.button != 0) return
    resize.current = { height, pointerId: event.pointerId, y: event.clientY }
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
  }

  function moveResize(event: PointerEvent<HTMLDivElement>): void {
    const current = resize.current
    if (current?.pointerId != event.pointerId) return
    changeHeight(current.height + current.y - event.clientY)
  }

  function stopResize(event: PointerEvent<HTMLDivElement>): void {
    if (resize.current?.pointerId != event.pointerId) return
    resize.current = undefined
    event.currentTarget.releasePointerCapture(event.pointerId)
  }

  function resizeWithKeyboard(event: KeyboardEvent<HTMLDivElement>): void {
    let next: number
    switch (event.key) {
      case 'ArrowUp':
        next = height + resizeStep
        break
      case 'ArrowDown':
        next = height - resizeStep
        break
      case 'Home':
        next = minHeight
        break
      case 'End':
        next = availableHeight()
        break
      default:
        return
    }
    event.preventDefault()
    changeHeight(next)
  }

  if (!open) return null
  return (
    <section className="run-drawer" id={panelId} ref={drawer} style={{ height }}>
      <div
        aria-label={t('run.resize')}
        aria-orientation="horizontal"
        aria-valuemax={maxHeight}
        aria-valuemin={minHeight}
        aria-valuenow={height}
        className="run-resize-handle"
        onKeyDown={resizeWithKeyboard}
        onLostPointerCapture={() => (resize.current = undefined)}
        onPointerCancel={stopResize}
        onPointerDown={startResize}
        onPointerMove={moveResize}
        onPointerUp={stopResize}
        role="separator"
        tabIndex={0}
      />
      <header className="run-header">
        <RunLogViewSwitch presentation={presentation} />
        <span className="run-header-spacer" />
        <RunTooltipButton aria-label={t('run.history')} onClick={onOpenRuns} size="icon-sm" variant="ghost">
          <i aria-hidden="true" className="i-lucide-light:history size-4" />
        </RunTooltipButton>
        <RunLogClearHighlight presentation={presentation} />
        <RunLogFilters
          container={drawer.current}
          events={events}
          presentation={presentation}
          onChange={(next) => {
            presentation.setFilters(next)
            onEventFilterChange(next.length == 1 ? next[0]! : 'all')
          }}
        />
        {run != null && <RunLogButton events={events} eventsExpiresAt={eventsExpiresAt} historyComplete={historyComplete} run={run} />}
        {canCancelRun(run) && (
          <Button disabled={cancelDisabled} onClick={onCancel} size="sm" variant="destructive">
            {t(canceling ? 'run.canceling' : 'run.cancel')}
          </Button>
        )}
        <RunTooltipButton aria-label={t('run.collapse')} onClick={onClose} size="icon-sm" variant="ghost">
          <Icon name="chevron-down" />
        </RunTooltipButton>
      </header>
      <div className="run-content">
        <ErrorHandling run={run} />
        {run != null && <ActiveWait onLocate={onLocateWait} onResolve={onResolve} resolvingActions={resolvingActions} run={run} />}
        <RunLog
          presentation={presentation}
          resultClient={resultClient}
          events={events}
          eventsExpiresAt={eventsExpiresAt}
          eventNodes={eventNodes}
          historyComplete={historyComplete}
          observationFailed={observationFailed}
          onConfigureConnector={onConfigureConnector}
          onLocateEvent={onLocateEvent}
          onRetryObservation={onRetryObservation}
          result={result}
          run={run}
          submitting={submitting}
        />
      </div>
    </section>
  )
}
