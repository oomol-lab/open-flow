import type { TFunction } from 'val-i18n'
import type { TriggerBinding } from '../api.ts'

import { useTranslate } from 'val-i18n-react'
import { displayHealth } from '../../../../control/common/health.ts'

export function triggerLabel(binding: TriggerBinding, enabled: boolean, t: TFunction): string {
  switch (displayHealth(binding, enabled)) {
    case 'retired':
      return t('publication.retired')
    case 'suspended':
      return t('publication.suspended')
    case 'listener-degraded':
      return t('publication.listenerDegraded')
    case 'active':
      return t('publication.active')
    case 'failed':
      return t('publication.failed')
    case 'needs-reauth':
      return t('publication.needsReauth')
    case 'reconciling':
      return t('publication.reconciling')
  }
}

export function triggerClass(binding: TriggerBinding, enabled: boolean): string {
  switch (displayHealth(binding, enabled)) {
    case 'retired':
    case 'suspended':
      return 'neutral'
    case 'listener-degraded':
    case 'reconciling':
      return 'running'
    case 'active':
      return 'success'
    case 'failed':
    case 'needs-reauth':
      return 'danger'
  }
}

export function TriggerStatus({ binding, enabled }: { readonly binding: TriggerBinding; readonly enabled: boolean }) {
  const t = useTranslate()
  return <span className={'trigger-binding-state ' + triggerClass(binding, enabled)}>{triggerLabel(binding, enabled, t)}</span>
}

export function ListenerHealth({ binding, enabled }: { readonly binding: TriggerBinding; readonly enabled: boolean }) {
  const t = useTranslate()
  if (binding.listener == null || binding.currentPublicationId == null || !enabled) return null
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
