import type { ReactElement } from 'react'
import type { Publication } from '../api.ts'
import type { WorkbenchTheme } from '../contract.ts'
import type { WorkbenchStore } from '../stores/workbenchStore.ts'

import { useEffect, useId, useRef, useState } from 'react'
import { useVal } from 'use-value-enhancer'
import { useLang, useTranslate } from 'val-i18n-react'
import { Badge } from '../../../../ui/browser/badge.tsx'
import { Button } from '../../../../ui/browser/button.tsx'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '../../../../ui/browser/empty.tsx'
import { Label } from '../../../../ui/browser/label.tsx'
import { ScrollArea } from '../../../../ui/browser/scroll-area.tsx'
import { Switch } from '../../../../ui/browser/switch.tsx'
import { Icon } from '../icons.tsx'
import { IdTooltip } from '../shell/idTooltip.tsx'
import { LiveTriggers } from './liveTriggers.tsx'
import { PublicationActor } from './publicationActor.tsx'
import { PublicationSnapshot } from './publicationSnapshot.tsx'

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

function CurrentLiveBadge({ enabled }: { readonly enabled: boolean }): ReactElement {
  const t = useTranslate()
  return (
    <Badge variant="secondary" title={t(enabled ? 'publication.enabled' : 'publication.disabled')}>
      <span aria-hidden="true" className={`status-dot ${enabled ? 'success' : 'neutral'}`} />
      {t('publication.current')}
    </Badge>
  )
}

export function PublicationsView({
  store,
  onClose,
  theme = 'light',
}: {
  readonly theme?: WorkbenchTheme
  readonly store: WorkbenchStore
  readonly onClose: () => void
}): ReactElement {
  const language = useLang()
  const t = useTranslate()
  const busy = useVal(store.$.busy)
  const flow = useVal(store.workspace.$.targetFlow)
  const live = useVal(store.publications.$.live)
  const loadFailed = useVal(store.publications.$.loadFailed)
  const loadingPublications = useVal(store.publications.$.loading)
  const loading = loadingPublications || (!loadFailed && live == null)
  const loadMoreFailed = useVal(store.publications.$.loadMoreFailed)
  const loadingMore = useVal(store.publications.$.loadingMore)
  const nextCursor = useVal(store.publications.$.nextCursor)
  const publications = useVal(store.publications.$.publications)
  const flowId = useVal(store.workspace.$.flowId)
  const refreshing = useVal(store.publications.$.refreshing)
  const rollingBackPublicationId = useVal(store.publications.$.rollingBackPublicationId)
  const [confirming, setConfirming] = useState<string>()
  // Keep the viewed version across pagination, while refreshing its Live end metadata.
  const [selection, setSelected] = useState<Publication>()
  const selected = publications.find((publication) => publication.publicationId === selection?.publicationId) ?? selection ?? publications[0]
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
  const select = (publication: Publication, button: HTMLButtonElement): void => {
    opener.current = button
    setSelected(publication)
    setConfirming(undefined)
    setDetailOpen(true)
  }
  useEffect(() => {
    if (detailOpen) heading.current?.focus({ preventScroll: true })
    else if (opener.current != null) (opener.current.isConnected ? opener.current : sidebarHeading.current)?.focus({ preventScroll: true })
  }, [selected?.publicationId, detailOpen])

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

  const currentPublicationId = live?.publication?.publicationId

  const disabled = busy != null || loading || loadFailed || refreshing || changingEnabled
  const retry = (
    <Button onClick={() => flowId != null && void store.publications.load(flowId)} size="sm" variant="outline">
      {t('empty.retry')}
    </Button>
  )
  const identifier = (value: string) => (
    <IdTooltip key={value} value={value} label={compactId(value)} trigger={<span tabIndex={0} className="font-mono cursor-help" />} container={root.current} />
  )

  return (
    <section ref={root} aria-label={t('workspace.publications')} className="publication-view" id="workspace-panel-publications" role="region">
      <span className="sr-only" role="status">
        {loading || refreshing ? t('publication.loading') : ''}
      </span>
      <div className={`publication-layout${detailOpen ? ' detail-open' : ''}${selected == null ? ' history-only' : ''}`}>
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
          <ScrollArea className="publication-list" defer={false} tabIndex={-1}>
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
                <section key={date} className="pb-3">
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
                      <span
                        aria-hidden="true"
                        className={`status-dot ${publication.publicationId == currentPublicationId && live?.status == 'runnable' ? 'success' : 'neutral'}`}
                        title={
                          publication.publicationId == currentPublicationId
                            ? t(live?.status == 'runnable' ? 'publication.enabled' : 'publication.disabled')
                            : undefined
                        }
                      />
                      <span className="flex min-w-0 items-baseline justify-between gap-2 text-xs font-medium">
                        <span>{t(publication.operation == 'publish' ? 'publication.published' : 'publication.rolledBack')}</span>
                        {publication.publicationId == currentPublicationId && (
                          <span className="sr-only">{t('publication.current')}</span>
                        )}
                        <time className="publication-list-meta shrink-0 font-normal" dateTime={publication.createdAt}>
                          {new Date(publication.createdAt).toLocaleTimeString(language, { hour: '2-digit', minute: '2-digit' })}
                        </time>
                      </span>
                      <span className="publication-list-meta col-start-2 font-normal">
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
        {selected != null && (
          <section className="publication-detail">
            <header className="publication-detail-header">
              <Button className="publication-back" onClick={() => setDetailOpen(false)} size="sm" variant="ghost">
                <Icon name="chevron-left" />
                {t('publication.history')}
              </Button>
              <div className="publication-detail-title">
                <h2 ref={heading} tabIndex={-1} className="flex flex-wrap items-center gap-2">
                  {t('publication.versionTitle')} {identifier(selected.publicationId)}
                </h2>
                {selected.publicationId == currentPublicationId && <CurrentLiveBadge enabled={live?.status == 'runnable'} />}
              </div>
              <div className="publication-detail-actions">
                {selected.publicationId == currentPublicationId && flow.live != null && (
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
                    {t(flow.live.enabled ? 'publication.enabled' : 'publication.disabled')}
                  </Label>
                )}
                {selected.publicationId != currentPublicationId && currentPublicationId != null && (
                  <Button
                    ref={rollbackButton}
                    aria-expanded={confirming == selected.publicationId}
                    aria-controls={confirming == selected.publicationId ? confirmationId : undefined}
                    disabled={disabled}
                    onClick={() => setConfirming(selected.publicationId)}
                    size="xs"
                    variant="outline"
                  >
                    {t('publication.rollbackToVersion')}
                  </Button>
                )}
              </div>
              <div className="publication-detail-meta">
                {selected.sourcePublicationId != null && (
                  <span>
                    {t('publication.rollbackSource')} {identifier(selected.sourcePublicationId)}
                  </span>
                )}
                <time dateTime={selected.createdAt}>{new Date(selected.createdAt).toLocaleString(language, { dateStyle: 'medium', timeStyle: 'short' })}</time>
                <span className="inline-flex min-w-0 items-center gap-2">
                  <span>{t(selected.operation === 'rollback' ? 'publication.restoredBy' : 'publication.actor')}:</span>
                  <PublicationActor key={selected.actorId} actorId={selected.actorId} store={store.actors} />
                </span>
              </div>
            </header>
            <div className="publication-content">
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
                            setSelected((viewed) =>
                              viewed == null || viewed.publicationId == selected.publicationId
                                ? (store.publications.$.live.value?.publication ?? undefined)
                                : viewed,
                            )
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
                {selected.publicationId === currentPublicationId && live != null && (
                  <section className="publication-live-triggers">
                    <LiveTriggers store={store} />
                  </section>
                )}
                <PublicationSnapshot key={selected.publicationId} publication={selected} store={store} theme={theme} />
              </div>
            </div>
          </section>
        )}
      </div>
    </section>
  )
}
