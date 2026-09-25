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
import { Spinner } from '../../../../ui/browser/spinner.tsx'
import { Tooltip, TooltipTrigger, TooltipContent } from '../../../../ui/browser/tooltip.tsx'
import { Icon } from '../icons.tsx'
import { AccountName, accountDisplayName } from './accountName.tsx'

const manageAccountOption = '__manage-account__'

function ConnectionAlert({
  detail,
  disabled,
  message,
  onRetry,
}: {
  readonly detail?: string
  readonly disabled: boolean
  readonly message: string
  readonly onRetry?: () => void
}): ReactElement {
  const t = useTranslate()
  return (
    <div className="connection-alert" role="alert">
      <Icon name="alert" size={14} />
      <div className="connection-alert-message">
        <p>{message}</p>
        {detail != null && <p>{detail}</p>}
      </div>
      {onRetry != null && (
        <Button disabled={disabled} onClick={onRetry} size="sm" type="button" variant="secondary">
          {t('inspector.account.retry')}
        </Button>
      )}
    </div>
  )
}

export function AccountControlButton({
  disabled,
  status,
  label,
  hint,
  onClick,
}: {
  readonly disabled: boolean
  readonly status: 'warning' | 'danger'
  readonly label: string
  readonly hint?: string
  readonly onClick?: () => void
}): ReactElement {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="account-control justify-between font-normal"
            data-status={status}
            disabled={disabled}
            onClick={onClick}
          >
            <span className="truncate">{label}</span>
            <i aria-hidden="true" className={status === 'warning' ? 'i-lucide-light:plus size-3.5' : 'i-lucide-light:rotate-cw size-3.5'} />
          </Button>
        }
      />
      <TooltipContent>{hint ?? label}</TooltipContent>
    </Tooltip>
  )
}

export function AccountSelect({
  connections,
  disabled,
  loading = false,
  id,
  invalid,
  warning,
  addWhenEmpty,
  label,
  selectedConnection,
  selectedId,
  onChange,
  onManage,
}: {
  readonly connections: readonly ConnectorConnection[]
  readonly loading?: boolean
  readonly disabled: boolean
  readonly id?: string
  readonly warning?: boolean
  readonly addWhenEmpty?: boolean
  readonly invalid?: boolean
  readonly label?: string
  readonly selectedConnection?: ConnectorConnection
  readonly selectedId?: string
  readonly onChange: (connectionId: string | undefined) => void
  readonly onManage: (() => void) | undefined
}): ReactElement {
  const t = useTranslate()
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  const selected = selectedConnection ?? connections.find((candidate) => candidate.connectionId == selectedId)
  const builtInName = t('inspector.account.oomolBuiltIn')
  const displayName = (connection: ConnectorConnection) => accountDisplayName(connection, connection.displayName, builtInName)
  const selectedLabel =
    selected == null
      ? selectedId == null
        ? undefined
        : `${selectedId} (${t('inspector.account.unavailable')})`
      : `${displayName(selected)}${selected.isDefault ? ` (${t('inspector.account.teamDefault')})` : ''}`
  const missingSelected = selectedId != null && !connections.some((candidate) => candidate.connectionId == selectedId)
  const items = [
    ...(missingSelected ? [{ value: selectedId, label: selectedLabel!, disabled: true }] : []),
    ...connections.map((candidate) => ({
      value: candidate.connectionId,
      label: `${displayName(candidate)}${candidate.isDefault ? ` (${t('inspector.account.teamDefault')})` : ''}`,
    })),
    ...(onManage == null ? [] : [{ value: manageAccountOption, label: t('inspector.account.addAccount') }]),
  ]
  if (!loading && addWhenEmpty && connections.length === 0 && selectedId == null) {
    return <AccountControlButton disabled={disabled} status="warning" onClick={onManage} label={t('inspector.account.addAccount')} />
  }
  return (
    <div ref={setContainer} className="account-select relative min-w-0">
      <Select
        disabled={disabled || loading}
        items={items}
        value={selectedId ?? null}
        onValueChange={(value) => {
          if (value == null) return
          if (value == manageAccountOption) onManage?.()
          else onChange(value)
        }}
      >
        <SelectTrigger
          id={id}
          size="field"
          aria-label={label ?? t('inspector.account.connection')}
          aria-busy={loading || undefined}
          aria-invalid={invalid || undefined}
          data-status={invalid ? 'danger' : warning ? 'warning' : undefined}
          className={`${fieldSelectTriggerClass} account-control`}
        >
          <SelectValue className={!loading && selectedId != null ? 'mr-5' : undefined} placeholder={t('inspector.account.chooseAccount')}>
            {loading ? (
              <span role="status" className="flex min-w-0 items-center gap-2 text-muted-foreground">
                <Spinner />
                <span className="truncate">{t('inspector.account.loading')}</span>
              </span>
            ) : selected == null ? (
              selectedLabel
            ) : (
              <>
                <AccountName name={displayName(selected)} builtIn={selected.builtInAccount} truncate />
                {selected.isDefault ? ` (${t('inspector.account.teamDefault')})` : ''}
              </>
            )}
          </SelectValue>
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
              <AccountName name={displayName(candidate)} builtIn={candidate.builtInAccount} truncate />
              {candidate.isDefault ? ` (${t('inspector.account.teamDefault')})` : ''}
            </SelectItem>
          ))}
          {onManage != null && (
            <>
              <SelectSeparator className="mx-2 bg-border/50" />
              <SelectItem value={manageAccountOption} className={selectionMenuItemClass}>
                {t('inspector.account.addAccount')}
              </SelectItem>
            </>
          )}
        </SelectContent>
      </Select>
      {!loading && selectedId != null && (
        <Button
          className="account-select-clear absolute top-1/2 right-7 -translate-y-1/2 text-muted-foreground"
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={t('connectionUsage.stopUsing')}
          title={t('connectionUsage.stopUsing')}
          disabled={disabled}
          onPointerDown={(event) => {
            if (event.button == 0) onChange(undefined)
          }}
          onClick={(event) => {
            if (event.detail == 0) onChange(undefined)
          }}
        >
          <i aria-hidden="true" className="i-lucide-light:x" />
        </Button>
      )}
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
    content = <p>{accessIssue}</p>
  } else if (actionError != null || action == null) {
    const canRetry = actionError?.code != 'authorization.denied' && actionError?.code != 'connector.action-not-found'
    content = (
      <ConnectionAlert
        disabled={disabled}
        message={
          actionError?.code == 'authorization.denied'
            ? t('inspector.account.contactAdmin')
            : (actionError?.message ?? t('inspector.account.statusUnavailable', { action: actionId }))
        }
        onRetry={canRetry ? () => void connectors.refresh(true) : undefined}
      />
    )
  } else if (connectionError != null) {
    content = (
      <ConnectionAlert
        detail={connectionError}
        disabled={disabled}
        message={t('inspector.account.refreshFailed')}
        onRetry={() => void connectors.refresh(true)}
      />
    )
  } else if (connectionId == null && available.length == 0) {
    content = (
      <>
        {authorizationPending && <p>{t('inspector.account.authorizationPending')}</p>}
        <div className="connection-prompt">
          <p>{t('inspector.account.connectBeforeRun', { service: action.serviceName })}</p>
          <Button disabled={disabled || onConfigureAccess == null} onClick={onConfigureAccess} size="sm" type="button">
            <Icon data-icon="inline-start" name="plus" />
            {t('inspector.account.manageAccount')}
          </Button>
        </div>
      </>
    )
  } else {
    onManage = onConfigureAccess
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
            disabled={disabled}
            id={`${fieldIdPrefix}-connection`}
            selectedConnection={connection}
            selectedId={connectionId}
            onChange={(next) => void connectors.setConnection(taskId, next)}
            onManage={onConfigureAccess}
          />
        </Field>
        {status != null && <p>{status}</p>}
      </>
    )
  }
  return (
    <section className={`connection-state ${required ? 'required' : ''}`} data-inspector-section="account">
      <h3 className="inspector-section-title">
        {t(!pending && accessIssue != null ? 'inspector.account.accessTitle' : required ? 'inspector.account.required' : 'inspector.account.title')}
        {onManage != null && (
          <Button className="ml-auto" disabled={disabled} onClick={onManage} size="xs" type="button" variant="ghost">
            {t('inspector.account.manageAccount')}
          </Button>
        )}
      </h3>
      <div className="connection-state-content">
        {content}
        {!pending && onConfigureAccess != null && accessIssue != null && (
          <Button className="self-start" disabled={disabled} onClick={onConfigureAccess} size="sm" type="button" variant="default">
            {t('inspector.account.manageAccount')}
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
  onConfigureAccess,
  triggers,
}: {
  readonly activeConnections?: readonly ConnectorConnection[]
  readonly authorizationPending: boolean
  readonly connection?: ConnectorConnection
  readonly connectionError?: string
  readonly connectionLoading: boolean
  readonly disabled: boolean
  readonly selection: Extract<ResolvedSelection, { readonly kind: 'trigger' }>
  readonly onConfigureAccess?: ((providerId: string) => void) | undefined
  readonly triggers: TriggerStore
}): ReactElement | null {
  const t = useTranslate()
  const trigger = selection.trigger
  const providerTrigger = trigger.kind == 'poll' || trigger.kind == 'integration' ? trigger : undefined
  const fieldIdPrefix = `trigger-${selection.id}`
  const canManage = onConfigureAccess != null && !connectionLoading && connectionError == null && (activeConnections?.length ?? 0) > 0
  const connectionSection =
    providerTrigger == null ? null : (
      <section className={`connection-state ${connection?.status == 'active' ? '' : 'required'}`} data-inspector-section="account">
        <h3 className="inspector-section-title">
          {t(connection?.status == 'active' ? 'inspector.account.title' : 'inspector.account.required')}
          {canManage && (
            <Button
              className="ml-auto"
              disabled={disabled}
              onClick={() => onConfigureAccess?.(providerTrigger.definition.provider)}
              size="xs"
              type="button"
              variant="ghost"
            >
              {t('inspector.account.manageAccount')}
            </Button>
          )}
        </h3>
        <div className="connection-state-content">
          {authorizationPending && <p>{t('inspector.account.authorizationPending')}</p>}
          {connectionLoading ? (
            <p>{t('inspector.account.loading')}</p>
          ) : connectionError != null ? (
            <ConnectionAlert
              detail={connectionError}
              disabled={disabled}
              message={t('inspector.account.refreshFailed')}
              onRetry={() => void triggers.refresh(true)}
            />
          ) : (activeConnections?.length ?? 0) == 0 ? (
            <div className="connection-prompt">
              <p>{t('inspector.account.connectBeforeRun', { service: providerTrigger.definition.provider })}</p>
              <Button
                disabled={disabled || onConfigureAccess == null}
                onClick={() => onConfigureAccess?.(providerTrigger.definition.provider)}
                size="sm"
                type="button"
              >
                {t('inspector.account.manageAccount')}
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
                  onManage={onConfigureAccess == null ? undefined : () => onConfigureAccess(providerTrigger.definition.provider)}
                />
              </Field>
            </>
          )}
        </div>
      </section>
    )

  return connectionSection
}
