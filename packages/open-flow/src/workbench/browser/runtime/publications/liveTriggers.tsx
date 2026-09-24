import type { ReactElement } from 'react'
import type { TFunction } from 'val-i18n'
import type { TriggerActivityKind, TriggerBinding } from '../api.ts'
import type { RevisionView } from '../revisionView.ts'
import type { WorkbenchStore } from '../stores/workbenchStore.ts'

import { Fragment, useEffect, useState } from 'react'
import { useVal } from 'use-value-enhancer'
import { useLang, useTranslate } from 'val-i18n-react'
import { Button } from '../../../../ui/browser/button.tsx'
import { collapseAllNested, JSONViewer } from '../../../../ui/browser/json-viewer/index.ts'
import { Icon } from '../icons.tsx'

function triggerLabel(binding: TriggerBinding, t: TFunction): string {
  if (binding.currentPublicationId == null) return t('publication.retired')
  if (binding.operatorState == 'paused') return t('publication.suspended')
  if (binding.listener?.health == 'healthy' && (binding.health == 'failed' || binding.health == 'needs_reauth')) return t('publication.listenerDegraded')
  switch (binding.listener?.health == 'failed' || binding.listener?.health == 'needs_reauth' ? binding.listener.health : binding.health) {
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
  if (binding.listener?.health == 'healthy' && (binding.health == 'failed' || binding.health == 'needs_reauth')) return 'running'
  switch (binding.listener?.health == 'failed' || binding.listener?.health == 'needs_reauth' ? binding.listener.health : binding.health) {
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

export function TriggerStatus({ binding }: { readonly binding: TriggerBinding }) {
  const t = useTranslate()
  return <span className={'trigger-binding-state ' + triggerClass(binding)}>{triggerLabel(binding, t)}</span>
}

export function ListenerHealth({ binding }: { readonly binding: TriggerBinding }) {
  const t = useTranslate()
  if (binding.listener == null || binding.currentPublicationId == null || binding.operatorState == 'paused') return null
  return (
    <p className="trigger-recovery">
      {t(
        binding.listener.health == 'healthy'
          ? 'publication.listenerScanning'
          : binding.listener.health == 'needs_reauth'
            ? 'publication.needsReauthDescription'
            : 'publication.listenerScanFailed',
      )}
      {binding.listener.lastErrorCode == null ? '' : ` (${binding.listener.lastErrorCode})`}
    </p>
  )
}

export function LiveTriggers({ store }: { readonly store: WorkbenchStore }): ReactElement {
  const language = useLang()
  const t = useTranslate()
  const activities = useVal(store.publications.$.activities)
  const activitiesLoadFailed = useVal(store.publications.$.activitiesLoadFailed)
  const activitiesLoading = useVal(store.publications.$.activitiesLoading)
  const activitiesLoadingMore = useVal(store.publications.$.activitiesLoadingMore)
  const activitiesNextCursor = useVal(store.publications.$.activitiesNextCursor)
  const bindings = useVal(store.publications.$.bindings)
  const detail = useVal(store.publications.$.detail)
  const detailLoading = useVal(store.publications.$.detailLoading)
  const selectedTriggerId = useVal(store.publications.$.selectedTriggerId)
  const testingTriggerId = useVal(store.publications.$.testingTriggerId)
  const testResult = useVal(store.publications.$.testResult)
  const busy = useVal(store.$.busy)
  const changingTriggerId = useVal(store.publications.$.changingTriggerId)
  const revision = useVal(store.workspace.$.revision)
  const [copiedEndpoint, setCopiedEndpoint] = useState<string>()
  useEffect(() => setCopiedEndpoint(undefined), [detail?.binding.endpointUrl])
  return (
    <section className="publication-triggers">
      <header>
        <div>
          <h2>{t('publication.triggers')}</h2>
          <span>{t('publication.triggerDescription')}</span>
        </div>
      </header>
      {bindings.length == 0 ? (
        <div className="publication-trigger-empty">{t('publication.triggerEmpty')}</div>
      ) : (
        <div className="trigger-binding-list">
          {bindings.map((binding) => {
            const changing = changingTriggerId == binding.triggerNodeId
            const selected = selectedTriggerId == binding.triggerNodeId
            const resumable = binding.operatorState == 'paused'
            return (
              <Fragment key={binding.triggerNodeId}>
                <div className="trigger-binding-row">
                  <Button
                    aria-expanded={selected}
                    className="trigger-binding-summary"
                    onClick={() => (selected ? store.publications.closeTrigger() : void store.publications.openTrigger(binding.triggerNodeId))}
                    type="button"
                    variant="ghost"
                  >
                    <span className={`status-dot ${triggerClass(binding)}`} />
                    <strong title={binding.triggerNodeId}>{triggerName(binding, revision)}</strong>
                    <TriggerStatus binding={binding} />
                    <code className="trigger-binding-kind">{binding.kind}</code>
                    <span className="trigger-binding-detail-label">{t(selected ? 'publication.hideTriggerDetails' : 'publication.triggerDetails')}</span>
                    <Icon name={selected ? 'chevron-up' : 'chevron-down'} />
                  </Button>
                  {binding.currentPublicationId != null && (
                    <Button disabled={busy != null} onClick={() => void store.publications.toggleTrigger(binding)} size="sm" variant="outline">
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
                            <dd>
                              <span>{t(detail.binding.operatorState == 'paused' ? 'publication.suspended' : 'publication.active')}</span>{' '}
                              <code>{detail.binding.operatorState}</code>
                            </dd>
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
                        <ListenerHealth binding={detail.binding} />
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
                                    <time dateTime={activity.createdAt}>{new Date(activity.createdAt).toLocaleString(language)}</time>
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
  )
}
