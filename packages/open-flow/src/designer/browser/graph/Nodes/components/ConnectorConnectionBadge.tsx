import styles from './ConnectorConnectionBadge.module.scss'

import { clsx } from 'clsx'
import { useTranslate } from 'val-i18n-react'
import { defaultTooltipClassName } from '../../../components/label.tsx'
import { DesignerTooltip } from '../../../components/tooltip.tsx'
import { useConnectorConnections } from '../../../connectorConnection.ts'

export interface ConnectorConnectionBadgeProps {
  readonly action: string
  readonly className?: string
  readonly connection: string | undefined
}

export function ConnectorConnectionBadge(props: ConnectorConnectionBadgeProps) {
  const t = useTranslate()
  const connections = useConnectorConnections(props.action)
  const selected = props.connection == null ? undefined : connections?.find((connection) => connection.id == props.connection)
  const unresolved = connections === null || (connections !== undefined && selected?.status != 'active')
  const label = selected?.displayName ?? (props.connection == null ? t('blockEditor.executor.connectionUnresolved') : compactConnectionId(props.connection))
  const connectionLabel = t('blockEditor.executor.connection')
  const status = selected?.status ?? (connections === undefined ? undefined : 'unresolved')

  return (
    <DesignerTooltip
      className={clsx(defaultTooltipClassName, styles.tooltip)}
      placement="top"
      title={
        <div>
          <div className={styles.detailsTitle}>{t('blockEditor.executor.connectionDetails')}</div>
          <dl className={styles.details}>
            <dt>{t('blockEditor.executor.connectionAccount')}</dt>
            <dd>{selected?.displayName ?? '—'}</dd>
            <dt>{t('blockEditor.executor.connectionId')}</dt>
            <dd>
              <code>{props.connection ?? '—'}</code>
            </dd>
            {status != null && (
              <>
                <dt>{t('blockEditor.executor.connectionStatus')}</dt>
                <dd className={unresolved ? styles.statusUnresolved : undefined}>
                  {status == 'unresolved' ? t('blockEditor.executor.connectionUnresolved') : t(`blockEditor.executor.connectionStatus_${status}`)}
                </dd>
              </>
            )}
          </dl>
        </div>
      }
    >
      <span aria-label={`${connectionLabel}: ${label}`} className={clsx(styles.container, unresolved && styles.unresolved, props.className)}>
        <i className={unresolved ? 'i-codicon:warning' : 'i-carbon:user-avatar'} />
        <span>{label}</span>
      </span>
    </DesignerTooltip>
  )
}

function compactConnectionId(connection: string): string {
  return connection.length > 13 ? `${connection.slice(0, 8)}…${connection.slice(-4)}` : connection
}
