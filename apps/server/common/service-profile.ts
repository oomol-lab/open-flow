export interface ServiceProfileDraft {
  readonly connectorOrigin: string
  readonly connectorToken: string
  readonly consoleOrigin: string
  readonly llmOrigin: string
  readonly llmToken: string
}

export type ServiceProfileIssue = 'required' | 'connectorUrl' | 'origin' | 'hosted'
export type ServiceProfileErrors = Partial<Record<keyof ServiceProfileDraft, ServiceProfileIssue>>

/** Shared validation for the service profile editor and persistence boundary. */
export function validateServiceProfile(mode: 'oomol' | 'custom', draft: ServiceProfileDraft): ServiceProfileErrors {
  const errors: ServiceProfileErrors = {}
  if (!draft.connectorOrigin.trim()) errors.connectorOrigin = 'required'
  else {
    try {
      const url = new URL(draft.connectorOrigin)
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) errors.connectorOrigin = 'connectorUrl'
      const hosted = ['connector.oomol.com', 'connector.oomol.dev'].includes(url.hostname)
      if ((mode == 'oomol') != hosted) errors.connectorOrigin = 'hosted'
    } catch {
      errors.connectorOrigin = 'connectorUrl'
    }
  }
  if (mode == 'oomol') {
    if (!draft.connectorToken.trim()) errors.connectorToken = 'required'
    return errors
  }
  for (const key of ['consoleOrigin', 'llmOrigin'] as const) {
    if (!draft[key]) continue
    try {
      const url = new URL(draft[key])
      const loopback = ['127.0.0.1', '::1', '[::1]', 'localhost'].includes(url.hostname)
      if ((url.protocol != 'https:' && !(url.protocol == 'http:' && loopback)) || url.username || url.password || url.pathname != '/' || url.search || url.hash)
        errors[key] = 'origin'
    } catch {
      errors[key] = 'origin'
    }
  }
  if (draft.llmOrigin && !draft.llmToken.trim()) errors.llmToken = 'required'
  return errors
}
