import type { ReactElement } from 'react'
import type { ConnectorAction, ConnectorConnection } from '../api.ts'
import type { ResolvedSelection } from '../revisionView.ts'
import type { ConnectorActionError, ConnectorStore } from '../stores/connectorStore.ts'
import type { TriggerStore } from '../stores/triggerStore.ts'

import { useState } from 'react'
import { useTranslate } from 'val-i18n-react'
import { fieldSelectTriggerClass } from '../../../../form/browser/fieldSelect.tsx'
import { selectionMenuContentClass, selectionMenuItemClass } from '../../../../form/browser/selectionMenuStyles.ts'
import { Button } from '../../../../ui/browser/button.tsx'
import { Field, FieldLabel } from '../../../../ui/browser/field.tsx'
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from '../../../../ui/browser/select.tsx'
import { Icon } from '../icons.tsx'

const manageAccountOption = '__manage-account__'

function AccountSelect({
  connections,
  disabled,
  id,
  selectedConnection,
  selectedId,
  onChange,
  onManage,
}: {
  readonly connections: readonly ConnectorConnection[]
  readonly disabled: boolean
  readonly id: string
  readonly selectedConnection?: ConnectorConnection
  readonly selectedId?: string
  readonly onChange: (connectionId: string) => void
  readonly onManage: () => void
}): ReactElement {
  const t = useTranslate()
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  const selected = selectedConnection ?? connections.find((candidate) => candidate.connectionId == selectedId)
  const selectedLabel =
    selected == null
      ? selectedId == null
        ? undefined
        : `${selectedId} (${t('inspector.account.unavailable')})`
      : `${selected.displayName}${selected.isDefault ? ` (${t('inspector.account.teamDefault')})` : ''}`
  const missingSelected = selectedId != null && !connections.some((candidate) => candidate.connectionId == selectedId)
  const items = [
    ...(missingSelected ? [{ value: selectedId, label: selectedLabel!, disabled: true }] : []),
    ...connections.map((candidate) => ({
      value: candidate.connectionId,
      label: `${candidate.displayName}${candidate.isDefault ? ` (${t('inspector.account.teamDefault')})` : ''}`,
    })),
    { value: manageAccountOption, label: t('inspector.account.addAccount') },
  ]
  return (
    <div ref={setContainer} className="min-w-0">
      <Select
        disabled={disabled}
        items={items}
        value={selectedId ?? null}
        onValueChange={(value) => {
          if (value == null) return
          if (value == manageAccountOption) onManage()
          else onChange(value)
        }}
      >
        <SelectTrigger id={id} size="field" aria-label={t('inspector.account.connection')} className={fieldSelectTriggerClass}>
          <SelectValue placeholder={t('inspector.account.chooseAccount')}>{selectedLabel}</SelectValue>
        </SelectTrigger>
        <SelectContent
          container={container}
          align="start"
          alignItemWithTrigger={false}
          className={`${selectionMenuContentClass} w-max min-w-[max(9rem,var(--anchor-width))] max-w-(--available-width)`}
        >
          {missingSelected && (
            <SelectItem value={selectedId} disabled className={selectionMenuItemClass}>
              {selectedLabel}
            </SelectItem>
          )}
          {connections.map((candidate) => (
            <SelectItem key={candidate.connectionId} value={candidate.connectionId} className={selectionMenuItemClass}>
              {candidate.displayName}
              {candidate.isDefault ? ` (${t('inspector.account.teamDefault')})` : ''}
            </SelectItem>
          ))}
          <SelectSeparator className="mx-2 bg-border/50" />
          <SelectItem value={manageAccountOption} className={selectionMenuItemClass}>
            {t('inspector.account.addAccount')}
          </SelectItem>
        </SelectContent>
      </Select>
    </div>
  )
}

export function ConnectorAccount({
  accessError,
  onConfigureAccess,
  action,
  actionError,
  actionId,
  activeConnections,
  authorizationPending,
  connection,
  connectionError,
  connectionId,
  connectors,
  disabled,
  fieldIdPrefix,
  loading,
  taskId,
}: {
  readonly onConfigureAccess?: (() => void) | undefined
  readonly accessError?: string | undefined
  readonly action: ConnectorAction | undefined
  readonly actionError: ConnectorActionError | undefined
  readonly actionId: string
  readonly activeConnections: readonly ConnectorConnection[] | undefined
  readonly authorizationPending: boolean
  readonly connection: ConnectorConnection | undefined
  readonly connectionError: string | undefined
  readonly connectionId: string | undefined
  readonly connectors: ConnectorStore
  readonly disabled: boolean
  readonly fieldIdPrefix: string
  readonly loading: boolean
  readonly taskId: string
}): ReactElement {
  const t = useTranslate()
  const available = activeConnections ?? []
  const accessIssue =
    accessError ?? (actionError?.code == 'connector.access-required' || actionError?.code == 'connector.access-invalid' ? actionError.message : undefined)
  const pending = loading || (accessIssue == null && actionError == null && (action == null || (activeConnections == null && connectionError == null)))
  const required =
    !pending &&
    (accessIssue != null || (action?.authenticated == true && (connectionId == null || (activeConnections != null && connection?.status != 'active'))))
  let onManage: (() => void) | undefined
  let content: ReactElement
  if (pending) {
    content = <p>{t('inspector.account.loading')}</p>
  } else if (accessIssue != null) {
    if (action != null) onManage = () => void connectors.connect(action.serviceId)
    content = <p>{accessIssue}</p>
  } else if (actionError != null || action == null) {
    content = (
      <>
        <p>
          {actionError?.code == 'authorization.denied'
            ? t('inspector.account.contactAdmin')
            : (actionError?.message ?? t('inspector.account.statusUnavailable', { action: actionId }))}
        </p>
        {actionError?.code != 'authorization.denied' && actionError?.code != 'connector.action-not-found' && (
          <Button className="self-start" disabled={disabled} onClick={() => void connectors.refresh(true)} size="sm" type="button" variant="secondary">
            {t('inspector.account.retry')}
          </Button>
        )}
      </>
    )
  } else if (connectionError != null) {
    content = (
      <>
        <p>{t('inspector.account.refreshFailed')}</p>
        <p className="connection-detail">{connectionError}</p>
        <Button className="self-start" disabled={disabled} onClick={() => void connectors.refresh(true)} size="sm" type="button" variant="secondary">
          {t('inspector.account.retry')}
        </Button>
      </>
    )
  } else if (connectionId == null && available.length == 0) {
    content = (
      <>
        {authorizationPending && <p>{t('inspector.account.authorizationPending')}</p>}
        <div className="connection-prompt">
          <p>{t('inspector.account.connectBeforeRun', { service: action.serviceName })}</p>
          <Button disabled={disabled} onClick={() => void connectors.connect(action.serviceId)} size="sm" type="button">
            <Icon data-icon="inline-start" name="plus" />
            {t('inspector.account.connectService', { service: action.serviceName })}
          </Button>
        </div>
      </>
    )
  } else {
    onManage = () => void connectors.connect(action.serviceId)
    let status: string | undefined
    if (connectionId != null) {
      if (connection == null) status = t('inspector.account.missing')
      else if (connection.status != 'active') status = t(`inspector.account.status.${connection.status}`)
    }
    content = (
      <>
        {authorizationPending && <p>{t('inspector.account.authorizationPending')}</p>}
        <Field className="connection-field">
          <FieldLabel className="sr-only" htmlFor={`${fieldIdPrefix}-connection`}>
            {t('inspector.account.connection')}
          </FieldLabel>
          <AccountSelect
            connections={available}
            disabled={disabled || available.length == 0}
            id={`${fieldIdPrefix}-connection`}
            selectedConnection={connection}
            selectedId={connectionId}
            onChange={(next) => void connectors.setConnection(taskId, next)}
            onManage={() => void connectors.connect(action.serviceId)}
          />
        </Field>
        {status != null && <p>{status}</p>}
      </>
    )
  }
  return (
    <section className={`connection-state ${required ? 'required' : ''}`} data-inspector-section="account">
      <h3 className="inspector-section-title">
        <Icon name="connection" size={15} />{' '}
        {t(accessIssue != null ? 'inspector.account.accessTitle' : required ? 'inspector.account.required' : 'inspector.account.title')}
        {onManage != null && (
          <Button className="ml-auto" disabled={disabled} onClick={onManage} size="xs" type="button" variant="ghost">
            {t('inspector.account.manageAccount')}
          </Button>
        )}
      </h3>
      <div className="connection-state-content">
        {content}
        {!pending && onConfigureAccess != null && (accessIssue != null || (action != null && actionError == null)) && (
          <Button
            className="self-start"
            disabled={disabled}
            onClick={onConfigureAccess}
            size="sm"
            type="button"
            variant={accessIssue != null ? 'default' : 'secondary'}
          >
            {t('inspector.account.configureAccess')}
          </Button>
        )}
      </div>
    </section>
  )
}

export function TriggerConnection({
  activeConnections,
  authorizationPending,
  connection,
  connectionError,
  connectionLoading,
  disabled,
  selection,
  triggers,
}: {
  readonly activeConnections?: readonly ConnectorConnection[]
  readonly authorizationPending: boolean
  readonly connection?: ConnectorConnection
  readonly connectionError?: string
  readonly connectionLoading: boolean
  readonly disabled: boolean
  readonly selection: Extract<ResolvedSelection, { readonly kind: 'trigger' }>
  readonly triggers: TriggerStore
}): ReactElement | null {
  const t = useTranslate()
  const trigger = selection.trigger
  const providerTrigger = trigger.kind == 'poll' || trigger.kind == 'integration' ? trigger : undefined
  const fieldIdPrefix = `trigger-${selection.id}`
  const canManage = !connectionLoading && connectionError == null && (activeConnections?.length ?? 0) > 0
  const connectionSection =
    providerTrigger == null ? null : (
      <section className={`connection-state ${connection?.status == 'active' ? '' : 'required'}`} data-inspector-section="account">
        <h3 className="inspector-section-title">
          <Icon name="connection" size={15} /> {t(connection?.status == 'active' ? 'inspector.account.title' : 'inspector.account.required')}
          {canManage && (
            <Button
              className="ml-auto"
              disabled={disabled}
              onClick={() => void triggers.connect(providerTrigger.definition.provider)}
              size="xs"
              type="button"
              variant="ghost"
            >
              {t('inspector.account.manage')}
            </Button>
          )}
        </h3>
        <div className="connection-state-content">
          <p className="connection-detail">{t('inspector.account.inheritsFlowAccess')}</p>
          {authorizationPending && <p>{t('inspector.account.authorizationPending')}</p>}
          {connectionLoading ? (
            <p>{t('inspector.account.loading')}</p>
          ) : connectionError != null ? (
            <>
              <p>{t('inspector.account.refreshFailed')}</p>
              <p className="connection-detail">{connectionError}</p>
              <Button disabled={disabled} onClick={() => void triggers.refresh(true)} size="sm" type="button" variant="secondary">
                {t('inspector.account.retry')}
              </Button>
            </>
          ) : (activeConnections?.length ?? 0) == 0 ? (
            <div className="connection-prompt">
              <p>{t('inspector.account.connectBeforeRun', { service: providerTrigger.definition.provider })}</p>
              <Button disabled={disabled} onClick={() => void triggers.connect(providerTrigger.definition.provider)} size="sm" type="button">
                {t('inspector.account.connectService', { service: providerTrigger.definition.provider })}
              </Button>
            </div>
          ) : (
            <>
              <Field className="connection-field">
                <FieldLabel className="sr-only" htmlFor={`${fieldIdPrefix}-connection`}>
                  {t('inspector.account.connection')}
                </FieldLabel>
                <AccountSelect
                  connections={activeConnections!}
                  disabled={disabled}
                  id={`${fieldIdPrefix}-connection`}
                  selectedConnection={connection}
                  selectedId={connection?.connectionId}
                  onChange={(next) => void triggers.setConnection(selection.id, next)}
                  onManage={() => void triggers.connect(providerTrigger.definition.provider)}
                />
              </Field>
            </>
          )}
        </div>
      </section>
    )

  return connectionSection
}
