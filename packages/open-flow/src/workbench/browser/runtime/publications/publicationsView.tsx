import type { ReactElement } from 'react'
import type { TFunction } from 'val-i18n'
import type { Live, TriggerActivityKind, TriggerBinding } from '../api.ts'
import type { RevisionView } from '../revisionView.ts'
import type { WorkbenchStore } from '../stores/workbenchStore.ts'

import { Fragment, useEffect, useState } from 'react'
import { useVal } from 'use-value-enhancer'
import { useLang, useTranslate } from 'val-i18n-react'
import { collapseAllNested, JSONViewer } from '../../../../designer/browser/jsonViewer/index.ts'
import { Badge } from '../../../../ui/browser/badge.tsx'
import { Button } from '../../../../ui/browser/button.tsx'
import { Icon } from '../icons.tsx'

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

function triggerLabel(binding: TriggerBinding, t: TFunction): string {
  if (binding.currentPublicationId == null) return t('publication.retired')
  if (binding.operatorState == 'paused') return t('publication.suspended')
  switch (binding.health) {
    case 'healthy':
      return t('publication.active')
    case 'failed':
      return t('publication.failed')
    case 'needs_reauth':
      return t('publication.needsReauth')
    case 'initializing':
      return t('publication.reconciling')
    case 'suspended':
      return t('publication.suspended')
  }
}

function activityLabel(kind: TriggerActivityKind, t: TFunction): string {
  switch (kind) {
    case 'delivery.failed':
      return t('publication.activityDeliveryFailed')
    case 'health.failed':
      return t('publication.activityHealthFailed')
    case 'health.needs_reauth':
      return t('publication.activityHealthNeedsReauth')
    case 'health.recovered':
      return t('publication.activityHealthRecovered')
    case 'health.suspended':
      return t('publication.activityHealthSuspended')
    case 'operator.paused':
      return t('publication.activityOperatorPaused')
    case 'operator.resumed':
      return t('publication.activityOperatorResumed')
  }
}

function triggerName(binding: TriggerBinding, revision: RevisionView | undefined): string {
  if (revision == null || binding.currentRevisionId != revision.revision.revisionId) return binding.triggerNodeId
  return revision.trigger(binding.triggerNodeId)?.name ?? binding.triggerNodeId
}

function triggerClass(binding: TriggerBinding): string {
  if (binding.currentPublicationId == null || binding.operatorState == 'paused') return 'neutral'
  switch (binding.health) {
    case 'healthy':
      return 'success'
    case 'failed':
    case 'needs_reauth':
      return 'danger'
    case 'initializing':
      return 'running'
    case 'suspended':
      return 'neutral'
  }
}

export function PublicationsView({ store }: { readonly store: WorkbenchStore }): ReactElement {
  const language = useLang()
  const t = useTranslate()
  const activities = useVal(store.publications.$.activities)
  const activitiesLoadFailed = useVal(store.publications.$.activitiesLoadFailed)
  const activitiesLoading = useVal(store.publications.$.activitiesLoading)
  const activitiesLoadingMore = useVal(store.publications.$.activitiesLoadingMore)
  const activitiesNextCursor = useVal(store.publications.$.activitiesNextCursor)
  const busy = useVal(store.$.busy)
  const bindings = useVal(store.publications.$.bindings)
  const changingTriggerId = useVal(store.publications.$.changingTriggerId)
  const detail = useVal(store.publications.$.detail)
  const detailLoading = useVal(store.publications.$.detailLoading)
  const diagnostics = useVal(store.workspace.$.diagnostics)
  const draft = useVal(store.workspace.$.draft)
  const flow = useVal(store.workspace.$.targetFlow)
  const live = useVal(store.publications.$.live)
  const loadFailed = useVal(store.publications.$.loadFailed)
  const loading = useVal(store.publications.$.loading)
  const loadMoreFailed = useVal(store.publications.$.loadMoreFailed)
  const loadingMore = useVal(store.publications.$.loadingMore)
  const nextCursor = useVal(store.publications.$.nextCursor)
  const publications = useVal(store.publications.$.publications)
  const flowId = useVal(store.workspace.$.flowId)
  const publishing = useVal(store.publications.$.publishing)
  const rollingBackPublicationId = useVal(store.publications.$.rollingBackPublicationId)
  const revision = useVal(store.workspace.$.revision)
  const selectedTriggerId = useVal(store.publications.$.selectedTriggerId)
  const testingTriggerId = useVal(store.publications.$.testingTriggerId)
  const testResult = useVal(store.publications.$.testResult)
  const total = useVal(store.publications.$.total)
  const [copiedEndpoint, setCopiedEndpoint] = useState<string>()
  const [confirming, setConfirming] = useState<string>()

  useEffect(() => setConfirming(undefined), [flow?.flowId, live?.publication?.publicationId])
  useEffect(() => setCopiedEndpoint(undefined), [detail?.binding.endpointUrl])

  if (flow == null)
    return (
      <section aria-labelledby="workspace-tab-publications" className="publication-empty" id="workspace-panel-publications" role="tabpanel" tabIndex={0}>
        {t('publication.selectFlow')}
      </section>
    )

  const invalid = diagnostics?.valid == false
  const currentPublicationId = live?.publication?.publicationId

  return (
    <section aria-labelledby="workspace-tab-publications" className="publication-view" id="workspace-panel-publications" role="tabpanel" tabIndex={0}>
      <section className="publication-summary">
        <div className="publication-summary-heading">
          <div>
            <h2>{t('publication.live')}</h2>
            <p>{t('publication.liveDescription')}</p>
          </div>
          {loading ? (
            <span className="publication-loading">{t('publication.loading')}</span>
          ) : live != null ? (
            <span className="publication-status">
              <span className={`status-dot ${liveClass(live)}`} /> {liveLabel(live, t)}
            </span>
          ) : null}
        </div>

        {loadFailed ? (
          <div className="publication-load-error">
            <span>{t('publication.loadFailed')}</span>
            <Button disabled={flowId == null} onClick={() => flowId != null && void store.publications.load(flowId)} size="sm" variant="outline">
              {t('empty.retry')}
            </Button>
          </div>
        ) : (
          <div className="publication-precondition">
            {draft != null && (
              <div className="publication-publish-action">
                <div>
                  <strong>{t(live?.hasUnpublishedChanges ? 'workspace.unpublishedChanges' : 'publication.upToDate')}</strong>
                  {live?.hasUnpublishedChanges && <span>{t(invalid ? 'workspace.fixIssuesToPublish' : 'publication.publishDescription')}</span>}
                </div>
                {live?.hasUnpublishedChanges && (
                  <Button disabled={busy != null || invalid} onClick={() => void store.publications.publish()}>
                    <Icon data-icon="inline-start" name="publish" />
                    {t(publishing ? 'workspace.publishing' : 'publication.publishDraft')}
                  </Button>
                )}
              </div>
            )}
            <div className="publication-revision-overview">
              <div className="publication-revision-group">
                <strong>{t('workspace.draft')}</strong>
                <dl>
                  <div>
                    <dt>{t('publication.draftRevision')}</dt>
                    <dd>{draft == null ? t('publication.noDraft') : <CompactId value={draft.revisionId} />}</dd>
                  </div>
                </dl>
              </div>
              <div className="publication-revision-group">
                <strong>{t('publication.live')}</strong>
                <dl>
                  <div>
                    <dt>{t('publication.livePublication')}</dt>
                    <dd>{live?.publication == null ? t('publication.none') : <CompactId value={live.publication.publicationId} />}</dd>
                  </div>
                  <div>
                    <dt>{t('publication.liveRevision')}</dt>
                    <dd>{live?.publication == null ? '—' : <CompactId value={live.publication.revisionId} />}</dd>
                  </div>
                  <div>
                    <dt>{t('publication.liveVersion')}</dt>
                    <dd>{live?.revision ?? 0}</dd>
                  </div>
                </dl>
              </div>
            </div>
          </div>
        )}
      </section>

      <section className="publication-triggers">
        <header>
          <div>
            <h2>{t('publication.triggers')}</h2>
            <span>{t('publication.triggerDescription')}</span>
          </div>
        </header>
        {loading ? (
          <div className="publication-trigger-empty">{t('publication.loading')}</div>
        ) : loadFailed ? (
          <div className="publication-trigger-empty">{t('publication.loadFailed')}</div>
        ) : bindings.length == 0 ? (
          <div className="publication-trigger-empty">{t('publication.triggerEmpty')}</div>
        ) : (
          <div className="trigger-binding-list">
            {bindings.map((binding) => {
              const changing = changingTriggerId == binding.triggerNodeId
              const selected = selectedTriggerId == binding.triggerNodeId
              const resumable = binding.operatorState == 'paused'
              return (
                <Fragment key={binding.triggerNodeId}>
                  <div className={`trigger-binding-row${selected ? ' selected' : ''}`}>
                    <Button
                      aria-expanded={selected}
                      className="trigger-binding-summary"
                      onClick={() => (selected ? store.publications.closeTrigger() : void store.publications.openTrigger(binding.triggerNodeId))}
                      type="button"
                      variant="ghost"
                    >
                      <span className={`status-dot ${triggerClass(binding)}`} />
                      <strong title={binding.triggerNodeId}>{triggerName(binding, revision)}</strong>
                      <span className={'trigger-binding-state ' + triggerClass(binding)}>{triggerLabel(binding, t)}</span>
                      <code className="trigger-binding-kind">{binding.kind}</code>
                      <span className="trigger-binding-detail-label">{t(selected ? 'publication.hideTriggerDetails' : 'publication.triggerDetails')}</span>
                    </Button>
                    {binding.currentPublicationId != null && (
                      <Button
                        disabled={busy != null || changingTriggerId != null}
                        onClick={() => void store.publications.toggleTrigger(binding)}
                        size="sm"
                        variant="outline"
                      >
                        {t(
                          changing
                            ? resumable
                              ? 'publication.resumingTrigger'
                              : 'publication.pausingTrigger'
                            : resumable
                              ? 'publication.resumeTrigger'
                              : 'publication.pauseTrigger',
                        )}
                      </Button>
                    )}
                  </div>
                  {selected && (
                    <div className="trigger-binding-detail">
                      {detailLoading ? (
                        <div className="publication-trigger-empty">{t('publication.loadingTrigger')}</div>
                      ) : detail != null ? (
                        <>
                          <dl>
                            <div>
                              <dt>{t('publication.triggerKind')}</dt>
                              <dd>{detail.binding.kind}</dd>
                            </div>
                            <div>
                              <dt>{t('publication.runtimeVersion')}</dt>
                              <dd>{detail.binding.runtimeVersion}</dd>
                            </div>
                            <div>
                              <dt>{t('publication.triggerHealth')}</dt>
                              <dd>{triggerLabel(detail.binding, t)}</dd>
                            </div>
                            <div>
                              <dt>{t('publication.operatorState')}</dt>
                              <dd>{detail.binding.operatorState}</dd>
                            </div>
                            <div>
                              <dt>{t('publication.updatedAt')}</dt>
                              <dd>{new Date(detail.binding.updatedAt).toLocaleString(language)}</dd>
                            </div>
                            {detail.binding.lastErrorCode != null && (
                              <div>
                                <dt>{t('publication.lastError')}</dt>
                                <dd>{detail.binding.lastErrorCode}</dd>
                              </div>
                            )}
                          </dl>
                          {detail.binding.health == 'needs_reauth' && <p className="trigger-recovery">{t('publication.needsReauthDescription')}</p>}
                          {detail.binding.endpointUrl != null && (
                            <div className="trigger-webhook">
                              <span>{t('publication.webhookUrl')}</span>
                              <div>
                                <code title={detail.binding.endpointUrl}>{detail.binding.endpointUrl}</code>
                                <Button
                                  onClick={async () => {
                                    await navigator.clipboard.writeText(detail.binding.endpointUrl!)
                                    setCopiedEndpoint(detail.binding.endpointUrl)
                                  }}
                                  size="sm"
                                  variant="outline"
                                >
                                  {t(copiedEndpoint == detail.binding.endpointUrl ? 'publication.webhookCopied' : 'publication.webhookCopy')}
                                </Button>
                              </div>
                            </div>
                          )}
                          <div className="trigger-binding-detail-sections">
                            {detail.binding.kind == 'poll' && detail.binding.currentPublicationId != null && (
                              <section className="trigger-test">
                                <header>
                                  <div>
                                    <h3>{t('publication.pollTest')}</h3>
                                    <p>{t('publication.pollTestDescription')}</p>
                                  </div>
                                  <Button disabled={testingTriggerId != null} onClick={() => void store.publications.testTrigger()} size="sm" variant="outline">
                                    {t(testingTriggerId == detail.binding.triggerNodeId ? 'publication.pollTesting' : 'publication.pollTest')}
                                  </Button>
                                </header>
                                {testResult != null && (
                                  <div className="trigger-test-result">
                                    <strong>{t('publication.pollTestResult')}</strong>
                                    <div className="trigger-test-summary">
                                      <span>{t('publication.pollTestEvents', { count: testResult.events.length })}</span>
                                      <span>{t('publication.pollTestFiltered', { count: testResult.filtered })}</span>
                                      {testResult.hasMore && <span>{t('publication.pollTestHasMore')}</span>}
                                    </div>
                                    {testResult.events.length == 0 ? (
                                      <p>{t('publication.pollTestNoEvents')}</p>
                                    ) : (
                                      <div className="trigger-test-events">
                                        <JSONViewer data={testResult.events} shouldExpandNode={collapseAllNested} />
                                      </div>
                                    )}
                                  </div>
                                )}
                              </section>
                            )}
                            <section className="trigger-activities">
                              <h3>{t('publication.activities')}</h3>
                              <p className="trigger-activities-description">{t('publication.activitiesDescription')}</p>
                              {activitiesLoading ? (
                                <div className="trigger-activities-empty">{t('publication.loadingTriggerActivities')}</div>
                              ) : activities.length == 0 ? (
                                <div className="trigger-activities-empty">
                                  {t(activitiesLoadFailed ? 'publication.activitiesLoadFailed' : 'publication.activitiesEmpty')}
                                </div>
                              ) : (
                                <div className="trigger-activity-list">
                                  {activities.map((activity) => (
                                    <div className="trigger-activity" key={activity.activityId}>
                                      <span className="status-dot neutral" />
                                      <div>
                                        <strong>{activityLabel(activity.kind, t)}</strong>
                                        {activity.errorCode != null && <code>{activity.errorCode}</code>}
                                        {activity.errorMessage != null && <p className="trigger-activity-message">{activity.errorMessage}</p>}
                                      </div>
                                      <time>{new Date(activity.createdAt).toLocaleString(language)}</time>
                                    </div>
                                  ))}
                                </div>
                              )}
                              {(activitiesNextCursor != null || activitiesLoadFailed) && !activitiesLoading && (
                                <Button
                                  className="trigger-activities-more"
                                  disabled={activitiesLoadingMore}
                                  onClick={() =>
                                    void (activitiesNextCursor == null
                                      ? store.publications.openTrigger(detail.binding.triggerNodeId)
                                      : store.publications.loadMoreTriggerActivities())
                                  }
                                  size="sm"
                                  variant="outline"
                                >
                                  {t(
                                    activitiesLoadingMore
                                      ? 'publication.loadingTriggerActivities'
                                      : activitiesLoadFailed
                                        ? 'empty.retry'
                                        : 'publication.loadMoreActivities',
                                  )}
                                </Button>
                              )}
                            </section>
                          </div>
                        </>
                      ) : null}
                    </div>
                  )}
                </Fragment>
              )
            })}
          </div>
        )}
      </section>

      <section className="publication-history">
        <header>
          <div>
            <h2>{t('publication.history')}</h2>
            <span>{t('publication.historyCount', { count: total ?? publications.length })}</span>
          </div>
        </header>
        {loading ? (
          <div className="publication-history-empty">{t('publication.loading')}</div>
        ) : publications.length == 0 ? (
          <div className="publication-history-empty">
            <span className="empty-icon">
              <Icon name="publish" size={20} />
            </span>
            <strong>{t('publication.historyEmpty')}</strong>
            <span>{t('publication.historyEmptyDescription')}</span>
          </div>
        ) : (
          <div className="publication-table-wrap">
            <table className="publication-table">
              <thead>
                <tr>
                  <th>{t('publication.operation')}</th>
                  <th>{t('publication.revision')}</th>
                  <th>{t('publication.actor')}</th>
                  <th>{t('publication.createdAt')}</th>
                  <th aria-label={t('publication.actions')} />
                </tr>
              </thead>
              <tbody>
                {publications.map((publication) => {
                  const current = publication.publicationId == currentPublicationId
                  const confirm = confirming == publication.publicationId
                  return (
                    <Fragment key={publication.publicationId}>
                      <tr>
                        <td>
                          <span className="publication-operation">
                            {t(publication.operation == 'publish' ? 'publication.published' : 'publication.rolledBack')}
                            {current && <Badge variant="secondary">{t('publication.current')}</Badge>}
                          </span>
                          <CompactId value={publication.publicationId} />
                        </td>
                        <td>
                          <CompactId value={publication.revisionId} />
                          {publication.sourcePublicationId != null && (
                            <span title={publication.sourcePublicationId}>
                              {t('publication.fromPublication', { id: compactId(publication.sourcePublicationId) })}
                            </span>
                          )}
                        </td>
                        <td>
                          <CompactId value={publication.actorId} />
                        </td>
                        <td>
                          <time dateTime={publication.createdAt}>{new Date(publication.createdAt).toLocaleString(language)}</time>
                        </td>
                        <td>
                          {!current && currentPublicationId != null && (
                            <Button
                              disabled={busy != null}
                              onClick={() => setConfirming(confirm ? undefined : publication.publicationId)}
                              size="sm"
                              variant="outline"
                            >
                              {t('publication.rollback')}
                            </Button>
                          )}
                        </td>
                      </tr>
                      {confirm && (
                        <tr className="publication-confirm-row">
                          <td colSpan={5}>
                            <div className="publication-confirm" role="group" aria-label={t('publication.rollback')}>
                              <div>
                                <strong>{t('publication.rollbackConfirm')}</strong>
                                <span>
                                  {t('publication.rollbackTarget', {
                                    publication: compactId(publication.publicationId),
                                    revision: compactId(publication.revisionId),
                                  })}
                                </span>
                              </div>
                              <div>
                                <Button disabled={rollingBackPublicationId != null} onClick={() => setConfirming(undefined)} size="sm" variant="outline">
                                  {t('common.cancel')}
                                </Button>
                                <Button disabled={busy != null} onClick={() => void store.publications.rollback(publication)} size="sm" variant="destructive">
                                  {t(rollingBackPublicationId == publication.publicationId ? 'publication.rollingBack' : 'publication.rollback')}
                                </Button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        {nextCursor != null && (
          <Button className="m-2" disabled={loadingMore} onClick={() => void store.publications.loadMore()} size="lg" variant="outline">
            {t(loadingMore ? 'run.loadingMore' : loadMoreFailed ? 'run.retryLoadMore' : 'run.loadMore')}
          </Button>
        )}
      </section>
    </section>
  )
}
