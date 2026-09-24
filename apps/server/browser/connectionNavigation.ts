export interface ConnectionConsole {
  readonly origin: string
  readonly teamScoped: boolean
}

/** Deployment-specific routes stay in the host; Workbench receives ordinary links. */
export function connectionHref(
  console: ConnectionConsole | undefined,
  teamName: string | undefined,
  providerId: string,
  connectionId?: string,
): string | undefined {
  if (console == null || (console.teamScoped && teamName == null)) return
  const path = console.teamScoped
    ? `team/${encodeURIComponent(teamName!)}/connections/${encodeURIComponent(providerId)}`
    : `providers/${encodeURIComponent(providerId)}`
  const url = new URL(path, console.origin)
  if (connectionId != null) url.searchParams.set('app', connectionId)
  return url.href
}
