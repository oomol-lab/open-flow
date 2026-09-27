import type { WorkbenchHost } from './contract.ts'

/** Resolve the identity namespace at the browser boundary, before creating its session cache. */
export function actorResolver(
  host: Pick<WorkbenchHost, 'resolveActor'>,
  origin: string | undefined,
  request: typeof fetch = fetch,
): WorkbenchHost['resolveActor'] {
  if (host.resolveActor != null) return (actorId, signal) => host.resolveActor!(actorId, signal)
  const apiOrigin =
    origin === 'https://console.oomol.com' ? 'https://api.oomol.com' : origin === 'https://console.oomol.dev' ? 'https://api.oomol.dev' : undefined
  if (apiOrigin == null) return
  return async (actorId, signal) => {
    const url = new URL('/v1/users/summaries', apiOrigin)
    url.searchParams.set('user_ids', actorId)
    const response = await request(url, { credentials: 'include', signal })
    if (!response.ok) throw new Error(`Could not load OOMOL user summary (${response.status}).`)
    const summaries: unknown = await response.json()
    if (summaries == null || typeof summaries != 'object' || Array.isArray(summaries)) throw new Error('Invalid OOMOL user summaries.')
    if (!Object.hasOwn(summaries, actorId)) return null
    const summary = (summaries as Record<string, unknown>)[actorId]
    if (summary == null || typeof summary != 'object' || Array.isArray(summary)) throw new Error('Invalid OOMOL user summary.')
    const { nickname, username, url: avatarUrl } = summary as Record<string, unknown>
    if (typeof nickname != 'string' || typeof username != 'string' || typeof avatarUrl != 'string') throw new Error('Invalid OOMOL user summary.')
    return { name: nickname || username, avatarUrl: avatarUrl || undefined }
  }
}
