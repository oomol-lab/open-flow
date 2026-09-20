import type { TFunction } from 'val-i18n'
import type { ProviderAccessBinding, ProviderAccessBindingCandidate } from '../../../../control/common/api.ts'

type PresentedPermissionGroup = Pick<ProviderAccessBinding | ProviderAccessBindingCandidate, 'permissionGroupName'>
type PresentedPermissions = Pick<ProviderAccessBindingCandidate, 'permissions' | 'providerId'>

export function connectorAccessPermissionGroupLabel(binding: PresentedPermissionGroup, t: TFunction): string {
  const group =
    binding.permissionGroupName === undefined ? t('connectorAccess.savedPermissionGroup') : (binding.permissionGroupName ?? t('inspector.account.teamDefault'))
  return t('connectorAccess.permissionGroup', { group })
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
