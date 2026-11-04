export interface ServiceProfileDraft {
  readonly connectorOrigin: string
  readonly connectorToken: string
  readonly consoleOrigin: string
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
  if (draft.consoleOrigin && !validServiceOrigin(draft.consoleOrigin)) errors.consoleOrigin = 'origin'
  return errors
}

/** A null token retains an existing key; a supplied key must contain non-whitespace characters. */
export function validateLlmConfiguration(origin: string, token: string | null): { readonly origin?: 'origin' | 'required'; readonly token?: 'required' } {
  let issue: 'origin' | 'required' | undefined
  if (origin.trim() == '') issue = 'required'
  else if (!validServiceOrigin(origin)) issue = 'origin'
  return { ...(issue == null ? {} : { origin: issue }), ...(token !== null && token.trim() == '' ? { token: 'required' as const } : {}) }
}

function validServiceOrigin(value: string): boolean {
  try {
    const url = new URL(value)
    const loopback = ['127.0.0.1', '::1', '[::1]', 'localhost'].includes(url.hostname)
    return (
      (url.protocol == 'https:' || (url.protocol == 'http:' && loopback)) && !url.username && !url.password && url.pathname == '/' && !url.search && !url.hash
    )
  } catch {
    return false
  }
}
