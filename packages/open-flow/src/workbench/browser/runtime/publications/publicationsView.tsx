import type { ReactElement } from 'react'
import type { TFunction } from 'val-i18n'
import type { Publication, Live } from '../api.ts'
import type { WorkbenchStore } from '../stores/workbenchStore.ts'

import { useEffect, useId, useRef, useState } from 'react'
import { useVal } from 'use-value-enhancer'
import { useLang, useTranslate } from 'val-i18n-react'
import { Badge } from '../../../../ui/browser/badge.tsx'
import { Button } from '../../../../ui/browser/button.tsx'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '../../../../ui/browser/empty.tsx'
import { Label } from '../../../../ui/browser/label.tsx'
import { ScrollArea } from '../../../../ui/browser/scroll-area.tsx'
import { Switch } from '../../../../ui/browser/switch.tsx'
import { Icon } from '../icons.tsx'
import { IdTooltip } from '../shell/idTooltip.tsx'
import { LiveTriggers } from './liveTriggers.tsx'

function compactId(value: string): string {
  return value.slice(-8)
}

function CompactId({ value }: { readonly value: string }): ReactElement {
  return (
    <code title={value}>
      <span aria-hidden="true">{compactId(value)}</span>
      <span className="sr-only">{value}</span>
    </code>
  )
}

function liveLabel(live: Live, t: TFunction): string {
  switch (live.status) {
    case 'not-published':
      return t('publication.notPublished')
    case 'runnable':
      return t('publication.runnable')
    case 'suspended':
      return t('publication.suspended')
  }
}

function liveClass(live: Live): string {
  switch (live.status) {
    case 'not-published':
      return 'neutral'
    case 'runnable':
      return 'success'
    case 'suspended':
      return 'running'
  }
}

export function PublicationsView({ store, onClose }: { readonly store: WorkbenchStore; readonly onClose: () => void }): ReactElement {
  const language = useLang()
  const t = useTranslate()
  const busy = useVal(store.$.busy)
  const diagnostics = useVal(store.$.diagnostics)
  const draft = useVal(store.workspace.$.draft)
  const flow = useVal(store.workspace.$.targetFlow)
  const live = useVal(store.publications.$.live)
  const loadFailed = useVal(store.publications.$.loadFailed)
  const loadingPublications = useVal(store.publications.$.loading)
  const loading = loadingPublications || (!loadFailed && live == null)
  const loadMoreFailed = useVal(store.publications.$.loadMoreFailed)
  const loadingMore = useVal(store.publications.$.loadingMore)
  const nextCursor = useVal(store.publications.$.nextCursor)
  const operation = useVal(store.publications.$.operation)
  const publications = useVal(store.publications.$.publications)
  const flowId = useVal(store.workspace.$.flowId)
  const refreshing = useVal(store.publications.$.refreshing)
  const rollingBackPublicationId = useVal(store.publications.$.rollingBackPublicationId)
  const revision = useVal(store.workspace.$.revision)
  const total = useVal(store.publications.$.total)
  const [confirming, setConfirming] = useState<string>()
  // Publication records are immutable; pagination refreshes must not change the viewed version.
  const [selected, setSelected] = useState<Publication>()
  const [detailOpen, setDetailOpen] = useState(false)
  const [changingEnabled, setChangingEnabled] = useState(false)
  const root = useRef<HTMLElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const sidebarHeading = useRef<HTMLHeadingElement>(null)
  const opener = useRef<HTMLButtonElement>()
  const rollbackButton = useRef<HTMLButtonElement>(null)
  const cancelRollback = useRef<HTMLButtonElement>(null)
  const confirmationId = useId()
  useEffect(() => {
    if (confirming != null) cancelRollback.current?.focus()
  }, [confirming])
  const groups = new Map<string, Publication[]>()
  for (const publication of publications) {
    const date = new Date(publication.createdAt).toDateString()
    const group = groups.get(date)
    if (group == null) groups.set(date, [publication])
    else group.push(publication)
  }
  const select = (publication: Publication | undefined, button: HTMLButtonElement): void => {
    opener.current = button
    setSelected(publication)
    setConfirming(undefined)
    setDetailOpen(true)
  }
  useEffect(() => {
    if (detailOpen) heading.current?.focus({ preventScroll: true })
    else if (opener.current != null) (opener.current.isConnected ? opener.current : sidebarHeading.current)?.focus({ preventScroll: true })
  }, [selected, detailOpen])

  let operationClass = 'neutral'
  let operationDetail: ReactElement | undefined
  let operationLabel = ''
  switch (operation?.status) {
    case 'pending':
      operationClass = 'running'
      operationDetail = <span>{t('publication.publishingDescription')}</span>
      operationLabel = t('workspace.publishing')
      break
    case 'failed': {
      operationClass = 'danger'
      const nodeId = operation.issue.nodeId
      const nodeTitle = nodeId == null ? undefined : revision?.node({ kind: 'flow' }, nodeId)?.node.name
      operationDetail = (
        <>
          <span>{operation.issue.message}</span>
          <span className="publication-progress-meta">
            <code>{operation.issue.code}</code>
            {nodeId != null && <code title={nodeId}>{t('publication.failureNode', { id: nodeTitle ?? nodeId })}</code>}
          </span>
        </>
      )
      operationLabel = t('publication.publishFailed')
      break
    }
    case undefined:
      break
  }

  useEffect(() => setConfirming(undefined), [live?.publication?.publicationId])

  if (flow == null)
    return (
      <section aria-label={t('workspace.publications')} className="publication-empty" id="workspace-panel-publications" role="region" tabIndex={0}>
        {t('publication.selectFlow')}
        <Button onClick={onClose} size="sm" variant="outline">
          {t('common.close')}
        </Button>
      </section>
    )

  const invalid = diagnostics?.valid == false
  const currentPublicationId = live?.publication?.publicationId

  const disabled = busy != null || loading || loadFailed || refreshing || changingEnabled
  const retry = (
    <Button onClick={() => flowId != null && void store.publications.load(flowId)} size="sm" variant="outline">
      {t('empty.retry')}
    </Button>
  )
  const identifier = (value: string) => (
    <IdTooltip
      key={value}
      value={value}
      label={compactId(value)}
      trigger={<span tabIndex={0} className="font-mono text-xs cursor-help" />}
      container={root.current}
    />
  )

  return (
    <section ref={root} aria-label={t('workspace.publications')} className="publication-view" id="workspace-panel-publications" role="region">
      <span className="sr-only" role="status">
        {loading || refreshing ? t('publication.loading') : ''}
      </span>
      <div className={`publication-layout${detailOpen ? ' detail-open' : ''}`}>
        <Button className="publication-close" aria-label={t('common.close')} onClick={onClose} size="icon-sm" variant="ghost">
          <Icon name="close" />
        </Button>
        <aside className="publication-sidebar" aria-label={t('publication.history')} aria-busy={loading || refreshing}>
          <header className="publication-sidebar-header">
            <h2 ref={sidebarHeading} tabIndex={-1}>
              {t('workspace.publications')}
            </h2>
            <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground" title={flow.name}>
              <i aria-hidden="true" className="i-lucide-light:workflow size-3.5 shrink-0" />
              <span className="truncate">{flow.name}</span>
            </div>
          </header>
          <div className="publication-live-link">
            <Button
              aria-current={selected == null ? 'true' : undefined}
              className="publication-list-item"
              onClick={(event) => select(undefined, event.currentTarget)}
              variant="ghost"
            >
              <span className={`status-dot ${live == null ? 'neutral' : liveClass(live)}`} />
              <span className="text-xs font-medium">{t('publication.live')}</span>
              <span className="publication-list-meta col-start-2">
                {loading ? t('publication.loading') : loadFailed || live == null ? '—' : liveLabel(live, t)}
              </span>
            </Button>
          </div>
          <ScrollArea className="publication-list" defer={false} tabIndex={-1}>
            <h3 className="publication-list-heading">
              {t('publication.history')}
              {!loading && !loadFailed && <span>{total ?? publications.length}</span>}
            </h3>
            {loading ? (
              <p className="publication-empty">{t('publication.loading')}</p>
            ) : loadFailed ? (
              <div className="publication-empty" role="alert">
                <p>{t('publication.loadFailed')}</p>
                {retry}
              </div>
            ) : publications.length == 0 ? (
              <Empty>
                <EmptyHeader>
                  <EmptyTitle>{t('publication.historyEmpty')}</EmptyTitle>
                  <EmptyDescription>{t('publication.historyEmptyDescription')}</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              Array.from(groups, ([date, items]) => (
                <section key={date} className="mb-3">
                  <h3 className="publication-date">
                    <time dateTime={items[0]!.createdAt}>
                      {new Date(items[0]!.createdAt).toLocaleDateString(language, { year: 'numeric', month: 'long', day: 'numeric' })}
                    </time>
                  </h3>
                  {items.map((publication) => (
                    <Button
                      key={publication.publicationId}
                      aria-current={selected?.publicationId == publication.publicationId ? 'true' : undefined}
                      className="publication-list-item"
                      variant="ghost"
                      onClick={(event) => select(publication, event.currentTarget)}
                    >
                      <span className={`status-dot ${publication.publicationId == currentPublicationId ? 'success' : 'neutral'}`} />
                      <span className="flex min-w-0 items-center justify-between gap-2 text-xs font-medium">
                        <span>{t(publication.operation == 'publish' ? 'publication.published' : 'publication.rolledBack')}</span>
                        {publication.publicationId == currentPublicationId && <Badge variant="secondary">{t('publication.current')}</Badge>}
                      </span>
                      <span className="publication-list-meta col-start-2 flex justify-between gap-2">
                        <time dateTime={publication.createdAt}>
                          {new Date(publication.createdAt).toLocaleTimeString(language, { hour: '2-digit', minute: '2-digit' })}
                        </time>
                        <CompactId value={publication.publicationId} />
                      </span>
                    </Button>
                  ))}
                </section>
              ))
            )}
          </ScrollArea>
          {nextCursor != null && (
            <Button className="m-2" disabled={loadingMore} onClick={() => void store.publications.loadMore()} size="sm" variant="outline">
              {t(loadingMore ? 'run.loadingMore' : loadMoreFailed ? 'run.retryLoadMore' : 'run.loadMore')}
            </Button>
          )}
        </aside>
        <section className="publication-detail">
          <header className="publication-detail-header">
            <Button className="publication-back" onClick={() => setDetailOpen(false)} size="sm" variant="ghost">
              <Icon name="chevron-left" />
              {t('publication.history')}
            </Button>
            <div className="publication-detail-title">
              <h2 ref={heading} tabIndex={-1}>
                {selected == null ? t('publication.live') : t(selected.operation == 'publish' ? 'publication.published' : 'publication.rolledBack')}
              </h2>
              {selected != null && selected.publicationId == currentPublicationId && <Badge variant="secondary">{t('publication.current')}</Badge>}
            </div>
            <div className="publication-detail-actions">
              {selected == null ? (
                <Button
                  disabled={disabled || invalid || draft == null || flow.status != 'active' || live?.hasUnpublishedChanges == false}
                  onClick={() => void store.publications.publish()}
                  size="sm"
                >
                  {t(busy == 'publish' ? 'workspace.publishing' : 'publication.publishDraft')}
                </Button>
              ) : selected.publicationId != currentPublicationId && currentPublicationId != null ? (
                <Button
                  ref={rollbackButton}
                  aria-expanded={confirming == selected.publicationId}
                  aria-controls={confirming == selected.publicationId ? confirmationId : undefined}
                  disabled={disabled}
                  onClick={() => setConfirming(selected.publicationId)}
                  size="sm"
                  variant="outline"
                >
                  {t('publication.rollbackToVersion')}
                </Button>
              ) : null}
            </div>
            {selected != null && (
              <div className="publication-detail-meta">
                <time dateTime={selected.createdAt}>{new Date(selected.createdAt).toLocaleString(language)}</time>
                <span>
                  {t('publication.actor')}: {identifier(selected.actorId)}
                </span>
              </div>
            )}
          </header>
          <ScrollArea className="publication-content" defer={false} tabIndex={-1}>
            {selected != null ? (
              <div className="publication-version">
                {confirming == selected.publicationId && (
                  <div id={confirmationId} className="publication-confirm" role="group" aria-label={t('publication.rollback')}>
                    <div>
                      <strong>{t('publication.rollbackConfirm')}</strong>
                      <p>{t('publication.rollbackTarget', { publication: compactId(selected.publicationId), revision: compactId(selected.revisionId) })}</p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <Button
                        ref={cancelRollback}
                        disabled={rollingBackPublicationId != null}
                        onClick={() => {
                          setConfirming(undefined)
                          rollbackButton.current?.focus()
                        }}
                        size="sm"
                        variant="outline"
                      >
                        {t('common.cancel')}
                      </Button>
                      <Button
                        disabled={disabled}
                        onClick={async () => {
                          if (await store.publications.rollback(selected)) {
                            setSelected((viewed) => (viewed?.publicationId == selected.publicationId ? undefined : viewed))
                            setConfirming(undefined)
                          }
                        }}
                        size="sm"
                        variant="destructive"
                      >
                        {t(rollingBackPublicationId == selected.publicationId ? 'publication.rollingBack' : 'publication.rollback')}
                      </Button>
                    </div>
                  </div>
                )}
                <dl className="publication-metadata">
                  <div>
                    <dt>{t('publication.publicationId')}</dt>
                    <dd>{identifier(selected.publicationId)}</dd>
                  </div>
                  <div>
                    <dt>{t('publication.revision')}</dt>
                    <dd>{identifier(selected.revisionId)}</dd>
                  </div>
                  {selected.sourcePublicationId != null && (
                    <div>
                      <dt>{t('publication.rollbackSource')}</dt>
                      <dd>{identifier(selected.sourcePublicationId)}</dd>
                    </div>
                  )}
                </dl>
                <Empty className="publication-snapshot">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <i aria-hidden="true" className="i-lucide-light:workflow size-5" />
                    </EmptyMedia>
                    <EmptyTitle>{t('publication.snapshot')}</EmptyTitle>
                    <EmptyDescription>{t('publication.snapshotUnavailable')}</EmptyDescription>
                  </EmptyHeader>
                </Empty>
              </div>
            ) : loading ? (
              <div className="publication-empty">{t('publication.loading')}</div>
            ) : loadFailed ? (
              <div className="publication-empty">
                <p>{t('publication.loadFailed')}</p>
                {retry}
              </div>
            ) : (
              <div className="publication-live-content">
                {operation != null && operation.status != 'succeeded' && (
                  <div className={`publication-progress ${operation.status}`} role={operation.status == 'failed' ? 'alert' : 'status'}>
                    <span className={`status-dot ${operationClass}`} />
                    <div>
                      <strong>{operationLabel}</strong>
                      {operationDetail}
                      {operation.status == 'failed' && (
                        <span>{t(currentPublicationId == null ? 'publication.stillUnpublished' : 'publication.liveUnchanged')}</span>
                      )}
                    </div>
                  </div>
                )}
                {live != null && (
                  <section className="publication-overview">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <span className={`status-dot ${liveClass(live)}`} />
                        <h3>{liveLabel(live, t)}</h3>
                      </div>
                      {flow.live != null && (
                        <Label className="text-xs">
                          <Switch
                            aria-label={t('resource.enableFlow', { name: flow.name })}
                            checked={flow.live.enabled}
                            disabled={disabled || flow.status != 'active'}
                            size="sm"
                            onCheckedChange={async (enabled) => {
                              setChangingEnabled(true)
                              try {
                                await store.workspace.setFlowEnabled(flow, enabled)
                                await store.publications.load(flow.flowId)
                              } finally {
                                setChangingEnabled(false)
                              }
                            }}
                          />
                          {t(flow.live.enabled ? 'resource.enabled' : 'resource.disabled')}
                        </Label>
                      )}
                    </div>
                    <p className="publication-description">{t(live.hasUnpublishedChanges ? 'workspace.unpublishedChanges' : 'publication.upToDate')}</p>
                    {live.hasUnpublishedChanges && (
                      <p className="publication-description">{t(invalid ? 'workspace.fixIssuesToPublish' : 'publication.publishDescription')}</p>
                    )}
                    {live.publication != null && (
                      <Button className="mt-3" variant="outline" size="sm" onClick={(event) => select(live.publication ?? undefined, event.currentTarget)}>
                        {t('publication.viewCurrent')}
                        <CompactId value={live.publication.publicationId} />
                      </Button>
                    )}
                    <details className="publication-technical">
                      <summary>{t('publication.technicalDetails')}</summary>
                      <dl className="publication-metadata">
                        <div>
                          <dt>{t('publication.draftRevision')}</dt>
                          <dd>{draft == null ? t('publication.noDraft') : identifier(draft.revisionId)}</dd>
                        </div>
                        {live.publication != null && (
                          <div>
                            <dt>{t('publication.liveRevision')}</dt>
                            <dd>{identifier(live.publication.revisionId)}</dd>
                          </div>
                        )}
                      </dl>
                    </details>
                  </section>
                )}
                {currentPublicationId != null && <LiveTriggers store={store} />}
              </div>
            )}
          </ScrollArea>
        </section>
      </div>
    </section>
  )
}
