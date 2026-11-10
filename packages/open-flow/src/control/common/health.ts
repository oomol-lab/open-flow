export type BindingHealth = 'failed' | 'healthy' | 'initializing' | 'needs_reauth' | 'unobservable'
export type ListenerHealth = 'failed' | 'healthy' | 'needs_reauth'
export type DisplayHealth = 'active' | 'failed' | 'listener-degraded' | 'needs-reauth' | 'reconciling' | 'retired' | 'suspended'

export interface TriggerHealthView {
  readonly currentPublicationId?: string
  readonly health: BindingHealth
  readonly listener?: { readonly health: ListenerHealth }
}

/**
 * The only trigger-health projection. `health` describes the binding channel;
 * `unobservable` means the deployment has no failure signal for that kind, so
 * it must not be displayed as healthy or failed.
 */
export function displayHealth(binding: TriggerHealthView, enabled: boolean): DisplayHealth {
  if (binding.currentPublicationId == null) return 'retired'
  if (!enabled) return 'suspended'
  const listener = binding.listener?.health
  if (listener == 'healthy' && (binding.health == 'failed' || binding.health == 'needs_reauth')) return 'listener-degraded'
  const health = listener == 'failed' || listener == 'needs_reauth' ? listener : binding.health
  switch (health) {
    case 'healthy':
    case 'unobservable':
      return 'active'
    case 'failed':
      return 'failed'
    case 'needs_reauth':
      return 'needs-reauth'
    case 'initializing':
      return 'reconciling'
  }
}

/** Callback delivery requires an observed healthy binding. */
export function admitsCallback(health: BindingHealth): boolean {
  return health == 'healthy'
}

/**
 * A listener page may advance while a callback channel is degraded, but only
 * when that listener itself reports healthy.
 */
export function admitsListenerPage(bindingHealth: BindingHealth, listenerHealth: ListenerHealth | undefined): boolean {
  return admitsCallback(bindingHealth) || listenerHealth == 'healthy'
}
