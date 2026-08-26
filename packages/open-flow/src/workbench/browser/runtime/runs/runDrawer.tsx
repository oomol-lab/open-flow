import type { EventListeners } from 'overlayscrollbars'
import type { KeyboardEvent, PointerEvent, ReactElement } from 'react'
import type { TFunction } from 'val-i18n'
import type { OverlayScrollbarRef } from '../../../../designer/browser/components/overlayScrollbar.tsx'
import type { JsonValue, Run, RunEvent, RunResult } from '../api.ts'
import type { IconName } from '../icons.tsx'
import type { RunEventFilter } from './runStore.ts'

import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useLang, useTranslate } from 'val-i18n-react'
import { OverlayScrollbar } from '../../../../designer/browser/components/overlayScrollbar.tsx'
import { collapseAllNested, CompactValue, JSONViewer } from '../../../../designer/browser/jsonViewer/index.ts'
import { Badge } from '../../../../ui/browser/badge.tsx'
import { Button } from '../../../../ui/browser/button.tsx'
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuGroup, DropdownMenuTrigger } from '../../../../ui/browser/dropdown-menu.tsx'
import { ToggleGroup, ToggleGroupItem } from '../../../../ui/browser/toggle-group.tsx'
import { Icon } from '../icons.tsx'
import { eventSubject } from '../workspace.ts'
import { downloadRunLog } from './runLogExport.ts'
import { eventHasDetails, RunEventDetails, RunResultView } from './runOutput.tsx'
import { canCancelRun } from './runStore.ts'

export function runLabel(run: Run | undefined, t: TFunction): string {
  if (run == null) return t('run.statusNone')
  switch (run.status) {
    case 'queued':
      return t('run.statusQueued')
    case 'starting':
      return t('run.statusStarting')
    case 'running':
      return t('run.statusRunning')
    case 'completed':
      return t('run.statusSucceeded')
    case 'failed':
      return t('run.statusFailed')
    case 'canceled':
      return t('run.statusCanceled')
    case 'indeterminate':
      return t('run.statusIndeterminate')
  }
}

export function statusClass(run: Run | undefined): string {
  if (run == null) return 'neutral'
  if (run.status == 'completed') return 'success'
  if (run.status == 'failed' || run.status == 'indeterminate') return 'danger'
  if (run.status == 'canceled') return 'neutral'
  return 'running'
}

export function duration(run: Run | undefined): string {
  if (run?.startedAt == null) return '—'
  const end = run.finishedAt == null ? Date.now() : Date.parse(run.finishedAt)
  const milliseconds = Math.max(0, end - Date.parse(run.startedAt))
  return milliseconds < 1000 ? `${milliseconds}ms` : `${(milliseconds / 1000).toFixed(1)}s`
}

function eventTime(createdAt: string, language: string): string {
  return new Intl.DateTimeFormat(language, { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(createdAt))
}

const minHeight = 160
const maxHeight = 640
const minCanvasHeight = 160
const defaultHeight = 360
const resizeStep = 24
const timelineChromeHeight = 64
const timelineEmptyHeight = 72
const timelineEventHeight = 36
const timelineDetailHeight = 52
const eventFollowThreshold = 32

interface Props {
  readonly cancelDisabled: boolean
  readonly canceling: boolean
  readonly events: readonly RunEvent[]
  readonly eventsExpiresAt: string | undefined
  readonly eventFilter: RunEventFilter
  readonly eventNodes: ReadonlyMap<number, string>
  readonly historyComplete: boolean
  readonly onCancel: () => void
  readonly onClose: () => void
  readonly onEventFilterChange: (filter: RunEventFilter) => void
  readonly onLocateEvent: (sequence: number) => void
  readonly onRetryObservation: () => void
  readonly onToggle: () => void
  readonly open: boolean
  readonly observationFailed: boolean
  readonly result: RunResult | undefined
  readonly run: Run | undefined
  readonly submitting: boolean
  readonly visible: boolean
}

type EventObservation = 'expired' | 'truncated'
type EventCategory = Exclude<RunEventFilter, 'all'>

const eventFilters: readonly RunEventFilter[] = ['all', 'lifecycle', 'progress', 'log', 'output', 'artifact']
const eventCategories: readonly EventCategory[] = ['lifecycle', 'progress', 'log', 'output', 'artifact']

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
    case 'node.output':
      return 'output'
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
    case 'run.started':
      return 'lifecycle'
  }
}

function filterEvents(events: readonly RunEvent[], filter: RunEventFilter): readonly RunEvent[] {
  return filter == 'all' ? events : events.filter((event) => eventCategory(event) == filter)
}

function filterEventsBy(events: readonly RunEvent[], filters: readonly RunEventFilter[]): readonly RunEvent[] {
  return events.filter((event) => filters.includes(eventCategory(event)))
}

interface TimelineEvent {
  readonly event: RunEvent
  readonly events: RunEvent[]
}

function timelineEvents(events: readonly RunEvent[]): readonly TimelineEvent[] {
  const result: TimelineEvent[] = []
  for (const event of events) {
    const previous = result.at(-1)
    const executionId = event.payload.executionId
    if (
      event.kind == 'node.output' &&
      typeof executionId == 'string' &&
      previous?.event.kind == 'node.output' &&
      previous.event.payload.executionId == executionId
    ) {
      previous.events.push(event)
    } else {
      result.push({ event, events: [event] })
    }
  }
  return result
}

export function RunEventFilters({
  events,
  filter,
  onChange,
}: {
  readonly events: readonly RunEvent[]
  readonly filter: RunEventFilter
  readonly onChange: (filter: RunEventFilter) => void
}): ReactElement | null {
  const t = useTranslate()
  if (events.length == 0) return null
  const groupedEvents = timelineEvents(events)
  const counts = new Map<EventCategory, number>()
  for (const { event } of groupedEvents) {
    const category = eventCategory(event)
    counts.set(category, (counts.get(category) ?? 0) + 1)
  }
  return (
    <ToggleGroup
      aria-label={t('run.filterEvents')}
      className="event-filters"
      onValueChange={(next) => {
        if (next[0] != null) onChange(next[0] as RunEventFilter)
      }}
      size="sm"
      value={[filter]}
    >
      {eventFilters.map((candidate) => {
        const count = candidate == 'all' ? groupedEvents.length : (counts.get(candidate) ?? 0)
        return (
          <ToggleGroupItem className="event-filter" key={candidate} value={candidate}>
            {t(`run.filter.${candidate}`)}
            <span>{count}</span>
          </ToggleGroupItem>
        )
      })}
    </ToggleGroup>
  )
}

function RunLogFilters({
  container,
  events,
  filters,
  onChange,
}: {
  readonly container: HTMLElement | null
  readonly events: readonly RunEvent[]
  readonly filters: readonly RunEventFilter[]
  readonly onChange: (filters: readonly RunEventFilter[]) => void
}): ReactElement | null {
  const t = useTranslate()
  if (events.length == 0) return null
  const groupedEvents = timelineEvents(events)
  const counts = new Map<EventCategory, number>()
  for (const { event } of groupedEvents) {
    const category = eventCategory(event)
    counts.set(category, (counts.get(category) ?? 0) + 1)
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button aria-label={t('run.filterEvents')} size="icon-sm" title={t('run.filterEvents')} type="button" variant="ghost">
            <Icon name="filter" />
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="run-log-filter" container={container} side="bottom">
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
    <Button
      aria-label={t('run.exportLog')}
      onClick={() => downloadRunLog(run, events, historyComplete, eventsExpiresAt)}
      size="icon-sm"
      title={t('run.exportLog')}
      type="button"
      variant="ghost"
    >
      <Icon name="download" />
    </Button>
  )
}

function eventIcon(event: RunEvent): IconName {
  if (event.kind.includes('failed')) return 'alert'
  return event.kind.startsWith('node.') ? 'task' : 'flow'
}

function eventTone(event: RunEvent): string {
  if (event.kind.includes('failed') || event.kind == 'run.indeterminate') return 'danger'
  if (event.kind == 'node.completed' || event.kind == 'run.completed') return 'success'
  return 'neutral'
}

function jsonRecord(value: unknown): Readonly<Record<string, JsonValue>> | undefined {
  if (value == null || typeof value != 'object' || Array.isArray(value)) return undefined
  return value as Readonly<Record<string, JsonValue>>
}

function terminalOutputs(result: RunResult | undefined): JsonValue | undefined {
  if (result?.status != 'completed') return undefined
  const value = jsonRecord(result.result)
  if (value?.kind == 'function-outputs') return jsonRecord(value.outputs)
  if (value?.kind != 'node-results' || !Array.isArray(value.nodes)) return undefined
  const outputs: JsonValue[] = []
  for (const nodeValue of value.nodes) {
    const node = jsonRecord(nodeValue)
    if (!Array.isArray(node?.jobs)) continue
    for (const jobValue of node.jobs) {
      const output = jsonRecord(jsonRecord(jobValue)?.outputs)
      if (output != null) outputs.push(output)
    }
  }
  return outputs.length == 1 ? outputs[0] : outputs
}

function latestOutputs(events: readonly RunEvent[]): JsonValue | undefined {
  const event = events.findLast((candidate) => candidate.kind == 'node.output')
  const output = jsonRecord(event?.payload.output)
  return output?.kind == 'inline' && Object.hasOwn(output, 'value') ? output.value : output
}

function eventSummary(event: RunEvent, t: TFunction): string {
  switch (event.kind) {
    case 'run.queued':
      return t('run.eventEnqueued')
    case 'run.started':
    case 'node.started':
      return t('run.eventStarted')
    case 'run.progress':
    case 'node.progress': {
      const progress = event.payload.progress
      return typeof progress == 'number' ? t('run.eventProgress', { progress: Math.round(progress) }) : t('run.eventRecorded')
    }
    case 'node.output':
      return t('run.eventOutput')
    case 'node.artifact':
      return t('run.eventArtifact')
    case 'node.log':
      return t('run.eventLog')
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
  for (const event of events) {
    const title = event.payload.nodeTitle
    if (typeof title != 'string') continue
    const executionId = event.payload.executionId
    const nodeId = event.payload.nodeId
    if (typeof executionId == 'string') titles.set(executionId, title)
    if (typeof nodeId == 'string') titles.set(nodeId, title)
  }
  return titles
}

export function RunDetails({
  events,
  eventsExpiresAt,
  eventFilter,
  eventNodes,
  historyComplete,
  observationFailed,
  onLocateEvent,
  onRetryObservation,
  panelId,
  result,
  run,
  submitting,
  tab,
  tabId,
}: Pick<
  Props,
  | 'events'
  | 'eventsExpiresAt'
  | 'eventFilter'
  | 'eventNodes'
  | 'historyComplete'
  | 'observationFailed'
  | 'onLocateEvent'
  | 'onRetryObservation'
  | 'result'
  | 'run'
  | 'submitting'
> & {
  readonly panelId: string
  readonly tab: 'output' | 'timeline'
  readonly tabId: string
}): ReactElement {
  const language = useLang()
  const t = useTranslate()
  const eventList = useRef<OverlayScrollbarRef>(null)
  const followedRun = useRef<string>()
  const followEvents = useRef(true)
  const nodeTitles = useMemo(() => nodeTitleIndex(events), [events])
  const observation = eventObservation(events, historyComplete)
  const visibleEvents = timelineEvents(filterEvents(events, eventFilter))
  const lastEventSequence = events.at(-1)?.sequence

  const eventScrollbarEvents = useMemo<EventListeners>(
    () => ({
      initialized(instance) {
        const list = instance.elements().scrollOffsetElement
        list.scrollTop = list.scrollHeight
      },
      scroll(instance) {
        const list = instance.elements().scrollOffsetElement
        followEvents.current = list.scrollHeight - list.scrollTop - list.clientHeight <= eventFollowThreshold
      },
    }),
    [],
  )

  useEffect(() => {
    if (followedRun.current != run?.runId) {
      followedRun.current = run?.runId
      followEvents.current = true
    }
    const instance = eventList.current?.osInstance()
    if (tab == 'timeline' && followEvents.current && instance != null) {
      instance.update()
      const list = instance.elements().scrollOffsetElement
      list.scrollTop = list.scrollHeight
    }
  }, [eventFilter, historyComplete, lastEventSequence, run?.runId, tab])

  let content: ReactElement
  if (submitting)
    content = (
      <div aria-live="polite" className="run-empty">
        {t('run.submitting')}
      </div>
    )
  else if (tab == 'output')
    content =
      result == null ? (
        <div className="run-empty">{t('run.outputPending')}</div>
      ) : (
        <OverlayScrollbar className="run-output-scroll run-content-scroll" defer={false} tabIndex={-1}>
          <RunResultView result={result} />
        </OverlayScrollbar>
      )
  else if (run == null) content = <div className="run-empty">{t('run.timelineEmpty')}</div>
  else
    content = (
      <OverlayScrollbar className="event-list run-content-scroll" defer={false} events={eventScrollbarEvents} ref={eventList} tabIndex={-1}>
        <div className="event-table" role="table">
          <div className="event-row event-heading" role="row">
            <span>{t('run.step')}</span>
            <span>{t('run.event')}</span>
            <span>{t('run.eventDetails')}</span>
            <span>{t('run.time')}</span>
          </div>
          {observation != null && (
            <div aria-live="polite" className="event-row event-observation" role="row">
              <span role="cell">
                <Icon name="alert" size={14} />
                {observation == 'expired'
                  ? t('run.historyExpired')
                  : eventsExpiresAt == null
                    ? t('run.eventsTruncatedNotice')
                    : t('run.eventsTruncatedUntil', { date: new Date(eventsExpiresAt).toLocaleString(language) })}
              </span>
            </div>
          )}
          {visibleEvents.map(({ event, events: groupedEvents }) => {
            const subject = eventSubject(event, t, nodeTitles)
            const nodeId = eventNodes.get(event.sequence)
            return (
              <Fragment key={event.sequence}>
                <div className="event-row" role="row">
                  {nodeId == null ? (
                    <span className="event-subject">
                      <Icon data-icon="inline-start" name={eventIcon(event)} />
                      {subject}
                    </span>
                  ) : (
                    <Button
                      aria-label={t('run.locateNode', { name: subject })}
                      className="event-subject event-locate"
                      onClick={() => onLocateEvent(event.sequence)}
                      size="xs"
                      title={t('run.locateNode', { name: subject })}
                      type="button"
                      variant="ghost"
                    >
                      <Icon name={eventIcon(event)} />
                      <span>{subject}</span>
                      <Icon data-icon="inline-end" name="fit" />
                    </Button>
                  )}
                  <code>{event.kind}</code>
                  <span className="event-summary">{eventSummary(event, t)}</span>
                  <time>{eventTime(event.createdAt, language)}</time>
                </div>
                <RunEventDetails events={groupedEvents} />
              </Fragment>
            )
          })}
          {events.length == 0 ? (
            <div className="run-empty">{t('run.waiting')}</div>
          ) : (
            visibleEvents.length == 0 && <div className="run-empty">{t('run.noFilteredEvents')}</div>
          )}
        </div>
      </OverlayScrollbar>
    )
  return (
    <div aria-labelledby={tabId} className="run-tab-panel" id={panelId} role="tabpanel" tabIndex={0}>
      {observationFailed && (
        <div className="run-observation-error" role="alert">
          <span>{t('run.observationFailed')}</span>
          <Button onClick={onRetryObservation} size="sm" type="button" variant="secondary">
            {t('empty.retry')}
          </Button>
        </div>
      )}
      {content}
    </div>
  )
}

function RunLog({
  events,
  eventsExpiresAt,
  filters,
  historyComplete,
  observationFailed,
  onRetryObservation,
  result,
  run,
  submitting,
}: Pick<Props, 'events' | 'eventsExpiresAt' | 'historyComplete' | 'observationFailed' | 'onRetryObservation' | 'result' | 'run' | 'submitting'> & {
  readonly filters: readonly RunEventFilter[]
}): ReactElement {
  const language = useLang()
  const t = useTranslate()
  const eventList = useRef<OverlayScrollbarRef>(null)
  const followedRun = useRef<string>()
  const followEvents = useRef(true)
  const nodeTitles = useMemo(() => nodeTitleIndex(events), [events])
  const observation = eventObservation(events, historyComplete)
  const visibleEvents = timelineEvents(filterEventsBy(events, filters))
  const lastEventSequence = events.at(-1)?.sequence
  const outputs = terminalOutputs(result)
  const eventScrollbarEvents = useMemo<EventListeners>(
    () => ({
      initialized(instance) {
        const list = instance.elements().scrollOffsetElement
        list.scrollTop = list.scrollHeight
      },
      scroll(instance) {
        const list = instance.elements().scrollOffsetElement
        followEvents.current = list.scrollHeight - list.scrollTop - list.clientHeight <= eventFollowThreshold
      },
    }),
    [],
  )

  useEffect(() => {
    if (followedRun.current != run?.runId) {
      followedRun.current = run?.runId
      followEvents.current = true
    }
    const instance = eventList.current?.osInstance()
    if (followEvents.current && instance != null) {
      instance.update()
      const list = instance.elements().scrollOffsetElement
      list.scrollTop = list.scrollHeight
    }
  }, [filters, historyComplete, lastEventSequence, result, run?.runId])

  return (
    <div className="run-log" tabIndex={0}>
      {observationFailed && (
        <div className="run-observation-error" role="alert">
          <span>{t('run.observationFailed')}</span>
          <Button onClick={onRetryObservation} size="sm" type="button" variant="secondary">
            {t('empty.retry')}
          </Button>
        </div>
      )}
      <OverlayScrollbar className="run-log-scroll run-content-scroll" defer={false} events={eventScrollbarEvents} ref={eventList} tabIndex={-1}>
        <ol className="run-log-list">
          {observation != null && (
            <li aria-live="polite" className="run-log-notice">
              <Icon name="alert" size={14} />
              <span>
                {observation == 'expired'
                  ? t('run.historyExpired')
                  : eventsExpiresAt == null
                    ? t('run.eventsTruncatedNotice')
                    : t('run.eventsTruncatedUntil', { date: new Date(eventsExpiresAt).toLocaleString(language) })}
              </span>
            </li>
          )}
          {visibleEvents.map(({ event, events: groupedEvents }) => {
            const subject = eventSubject(event, t, nodeTitles)
            return (
              <li className={`run-log-event ${eventTone(event)}`} key={event.sequence}>
                <span className="run-log-icon" title={event.kind}>
                  <Icon name={eventIcon(event)} size={14} />
                </span>
                <time dateTime={event.createdAt} title={new Date(event.createdAt).toLocaleString(language)}>
                  {eventTime(event.createdAt, language)}
                </time>
                <div className="run-log-main">
                  <div className="run-log-title">
                    <strong>{subject}</strong>
                    <Icon className="run-log-chevron" name="chevron-left" size={11} />
                    <span>{eventSummary(event, t)}</span>
                  </div>
                  <RunEventDetails events={groupedEvents} />
                </div>
              </li>
            )
          })}
          {outputs != null && result != null && (
            <li className="run-log-event run-log-result success">
              <span className="run-log-icon">
                <Icon name="check" size={14} />
              </span>
              <time dateTime={result.finishedAt} title={new Date(result.finishedAt).toLocaleString(language)}>
                {eventTime(result.finishedAt, language)}
              </time>
              <div className="run-log-main">
                <div className="run-log-title">
                  <strong>{t('run.terminalResult')}</strong>
                </div>
                <div className="run-log-outputs">
                  <JSONViewer data={outputs} shouldExpandNode={collapseAllNested} />
                </div>
              </div>
            </li>
          )}
          {submitting ? (
            <li aria-live="polite" className="run-log-empty">
              {t('run.submitting')}
            </li>
          ) : run == null ? (
            <li className="run-log-empty">{t('run.timelineEmpty')}</li>
          ) : events.length == 0 && result == null ? (
            <li className="run-log-empty">{t('run.waiting')}</li>
          ) : visibleEvents.length == 0 && result == null ? (
            <li className="run-log-empty">{t('run.noFilteredEvents')}</li>
          ) : null}
        </ol>
      </OverlayScrollbar>
    </div>
  )
}

export function RunDrawer({
  cancelDisabled,
  canceling,
  events,
  eventsExpiresAt,
  eventFilter,
  historyComplete,
  onCancel,
  onClose,
  onEventFilterChange,
  onRetryObservation,
  onToggle,
  observationFailed,
  open,
  result,
  run,
  submitting,
  visible,
}: Props): ReactElement | null {
  const t = useTranslate()
  const drawer = useRef<HTMLElement>(null)
  const resize = useRef<{ height: number; pointerId: number; y: number }>()
  const [resized, setResized] = useState<{ height: number; runId: string | undefined }>()
  const [filters, setFilters] = useState<readonly RunEventFilter[]>(() =>
    eventFilter == 'all' ? eventCategories.filter((filter) => filter != 'progress') : [eventFilter],
  )
  const groupedTimelineEvents = timelineEvents(events)
  const summaryOutputs = terminalOutputs(result) ?? latestOutputs(events)
  const timelineHeight = Math.max(
    minHeight,
    Math.min(
      maxHeight,
      timelineChromeHeight +
        (events.length == 0 ? timelineEmptyHeight : groupedTimelineEvents.length * timelineEventHeight) +
        groupedTimelineEvents.filter((group) => group.events.some(eventHasDetails)).length * timelineDetailHeight +
        (eventObservation(events, historyComplete) == null ? 0 : timelineEventHeight),
    ),
  )
  const preferredHeight = resized != null && resized.runId == run?.runId ? resized.height : undefined
  const height = preferredHeight ?? Math.max(defaultHeight, timelineHeight)

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

  if (!visible) return null
  return (
    <section className={`run-drawer ${open ? 'open' : ''}`} ref={drawer} style={open ? { height } : undefined}>
      {open && (
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
      )}
      {open && (
        <header className="run-header">
          <Badge variant="secondary">{t('run.timeline')}</Badge>
          <span className="run-header-spacer" />
          <RunLogFilters
            container={drawer.current}
            events={events}
            filters={filters}
            onChange={(next) => {
              setFilters(next)
              onEventFilterChange(next.length == 1 ? next[0]! : 'all')
            }}
          />
          {run != null && <RunLogButton events={events} eventsExpiresAt={eventsExpiresAt} historyComplete={historyComplete} run={run} />}
          {canCancelRun(run) && (
            <Button disabled={cancelDisabled} onClick={onCancel} size="sm" variant="destructive">
              {t(canceling ? 'run.canceling' : 'run.cancel')}
            </Button>
          )}
          <Button aria-label={t('run.close')} onClick={onClose} size="icon-sm" variant="ghost">
            <Icon name="trash" />
          </Button>
          <Button aria-label={t('run.collapse')} onClick={onToggle} size="icon-sm" variant="ghost">
            <Icon name="chevron-down" />
          </Button>
        </header>
      )}
      {open && (
        <div className="run-content">
          <RunLog
            events={events}
            eventsExpiresAt={eventsExpiresAt}
            filters={filters}
            historyComplete={historyComplete}
            observationFailed={observationFailed}
            onRetryObservation={onRetryObservation}
            result={result}
            run={run}
            submitting={submitting}
          />
        </div>
      )}
      <div className="run-summary">
        <span className={`status-dot ${submitting ? 'running' : statusClass(run)}`} />
        <div className="run-summary-text">
          <span>{events.at(-1) == null ? (submitting ? t('run.statusSubmitting') : runLabel(run, t)) : eventSummary(events.at(-1)!, t)}</span>
          {summaryOutputs != null && <CompactValue maxDepth={2} maxEntries={4} value={summaryOutputs} />}
        </div>
        <span className="run-meta">{duration(run)}</span>
        {run != null && <code className="run-id">{t('run.runId', { id: run.runId })}</code>}
        <Button aria-label={t(open ? 'run.collapse' : 'run.expand')} onClick={onToggle} size="icon-xs" variant="ghost">
          <Icon name={open ? 'chevron-down' : 'chevron-up'} />
        </Button>
      </div>
    </section>
  )
}
