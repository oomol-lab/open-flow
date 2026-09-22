import type { TFunction } from 'val-i18n'
import type { ProviderAccessBinding, ProviderAccessBindingCandidate } from '../../../../control/common/api.ts'

type PresentedPermissionGroup = Pick<ProviderAccessBinding | ProviderAccessBindingCandidate, 'permissionGroupName' | 'source'>
type PresentedPermissions = Pick<ProviderAccessBindingCandidate, 'permissions' | 'providerId'>

export function connectorAccessPermissionGroupLabel(binding: PresentedPermissionGroup, t: TFunction): string {
  if (binding.source == null) return t('connectorAccess.reauthorize')
  if (binding.source.kind == 'admin-delegation') return t('connectorAccess.adminDelegation')
  if (binding.source.ruleId == null) return t('connectorAccess.defaultPolicy')
  return t('connectorAccess.permissionGroup', { group: binding.permissionGroupName ?? t('connectorAccess.savedPermissionGroup') })
}

export function connectorAccessPermissionLabel(candidate: PresentedPermissions, t: TFunction): string | undefined {
  const permissions = candidate.permissions
  if (permissions == null) return
  const prefix = `${candidate.providerId}.`
  const actions = permissions.actionIds.map((actionId) => (actionId.startsWith(prefix) ? actionId.slice(prefix.length) : actionId))
  const shown = actions.slice(0, 3).join(', ')
  const label = permissions.allActions
    ? t('connectorAccess.permissionAllActions')
    : actions.length > 3
      ? t('connectorAccess.permissionActionsMore', { actions: shown, count: actions.length - 3 })
      : t('connectorAccess.permissionActions', { actions: shown })
  return [
    label,
    permissions.proxy ? t('connectorAccess.permissionProxy') : undefined,
    permissions.configured ? t('connectorAccess.permissionConfigured') : undefined,
  ]
    .filter(Boolean)
    .join(' · ')
}
